# Cereal Launcher — Full Code Audit
**Date:** April 2025 | **Scope:** All Electron main-process JS, providers, preload

---

## 1. Bugs (Correctness)

### B1 — `detection.js:66` — `heroUrl` field instead of `headerUrl` ⚠️ HIGH
Steam detection outputs `heroUrl` but every other module (metadata, gameCrud, settings, renderer) uses `headerUrl`. Auto-detected Steam games will **never** have their wide-banner art shown in the UI — the field is silently ignored.

**Fix:**
```js
// detection.js:66
headerUrl: `https://shared.steamstatic.com/store_item_assets/steam/apps/${appid[1]}/library_hero.jpg`,
```

---

### B2 — `covers.js:107` — Error message undercounts candidates ⚠️ MEDIUM
```js
const total = [game.coverUrl].filter(Boolean).length;
if (total > 0) throw new Error('All cover URLs failed (' + total + ' candidates)');
```
The candidate list on line 69 is `[game.coverUrl, game.sgdbCoverUrl]` — two items — but the error only counts `coverUrl`. When only `sgdbCoverUrl` is set, `total` is 0 and the error is silently suppressed (no throw), so no retry is scheduled either.

**Fix:** `const total = [game.coverUrl, game.sgdbCoverUrl].filter(Boolean).length;`

---

### B3 — `main.js:219` — Path traversal in `local-image://` handler ⚠️ MEDIUM
```js
if (!resolved.startsWith(coversDir)) return new Response('Forbidden', { status: 403 });
```
`String.startsWith` is prefix-only. A path like `C:\Users\user\AppData\Roaming\App\covers.evil\file.jpg` passes the check if `coversDir` is `...covers`. 

**Fix:** Append a path separator to the guard:
```js
if (!resolved.startsWith(coversDir + path.sep) && resolved !== coversDir) {
  return new Response('Forbidden', { status: 403 });
}
```

---

### B4 — `metadataSearch.js:146` — Typo: `gamLabel` ⚠️ LOW
```js
const gamLabel = searchData.data[0].name || gameName;  // should be: gameLabel
```
All subsequent uses reference `gamLabel`, so it technically works but is a misspelling.

---

### B5 — `settings.js:90` — Import dedup key uses `undefined|undefined` ⚠️ LOW
```js
const existingIds = new Set(ctx.db.games.map(g => g.name + '|' + g.platform));
```
If any game has `name` or `platform` as `undefined`, the key becomes `"undefined|undefined"` — causing all games with missing fields to be treated as duplicates of each other. The first such game is added, all others are silently dropped.

**Fix:** `const existingIds = new Set(ctx.db.games.map(g => (g.name || '') + '|' + (g.platform || '')));`

---

### B6 — `gameCrud.js:57` — ID collision risk on rapid import ⚠️ LOW
```js
game.id = Date.now().toString(36) + Math.random().toString(36).substring(2, 7);
```
When `games:add` is called in a tight loop (e.g., bulk import of 200 games), `Date.now()` can repeat within the same millisecond. The 5-character random suffix gives `36^5 ≈ 60M` possibilities — collision probability is low but non-zero. A 7-character random suffix or `crypto.randomBytes` would be safer.

---

### B7 — `chiaki.js:629-630` — Unused `db` closure; `saveDB` wrapper hides null-db risk ⚠️ LOW
```js
const db = () => ctx.db;      // used as db().games etc. — but ctx.db is already null-safe via ctx
const saveDB = () => ctx.saveDB(ctx.db);
```
`db()` is called in IPC handlers that run after `app.whenReady()`, so `ctx.db` is populated by then. But if `ctx.saveDB` is null (context not yet populated), `saveDB()` throws with a cryptic error instead of a clear message. Consider guarding: `ctx.saveDB?.(ctx.db)`.

---

## 2. Dead Code

### D1 — `metadataSearch.js:34-130` — Three unused functions ⚠️ MEDIUM
`searchDuckDuckGo`, `searchWikidata`, and `searchWikipedia` are defined (130 lines combined) but:
- Not exported from `module.exports`
- Not called from anywhere in the module or codebase
- Were removed from `handleSearchArt` in a previous refactor

These can be safely deleted, saving ~130 lines.

---

### D2 — `detection.js:9-19` — Steam path hardcoded instead of using env vars
```js
'C:\\Program Files (x86)\\Steam',
'C:\\Program Files\\Steam',
```
`launcher.js` consistently uses `process.env['ProgramFiles(x86)']` for the same paths. The hardcoded fallback works on default installs but is inconsistent and could miss non-default `%ProgramFiles%` locations.

---

### D3 — `chiaki.js:629` — `const db = () => ctx.db` is redundant
Only used via `db()` in 4 handlers in the same function scope. `ctx.db` is already accessible and used directly everywhere else. The closure adds indirection without benefit.

---

## 3. Security

### S1 — `main.js:603-611` — `dialog:pickImage` copies file without content validation ⚠️ MEDIUM
Any file the user picks is copied into `userData/covers/` with its original extension. An `.exe` renamed to `.jpg` would be accepted and stored. The file is only served via the `local-image://` scheme (not executed), so exploitability is low — but a compromised/malicious renderer could request it back.

**Fix:** After copying, verify the first 4 bytes match known image magic numbers (JPEG `FF D8 FF`, PNG `89 50 4E 47`, etc.) and reject otherwise.

---

### S2 — `detectionIpc.js:66-68` — `execFileSync` on a path from the database ⚠️ MEDIUM
```js
const listOutput = require('child_process').execFileSync(result.executablePath, ['list'], ...);
```
`result.executablePath` comes from the database (or CHIAKI_SYSTEM_PATHS). If a user or import corrupts `db.chiakiConfig.executablePath`, arbitrary executables could be run with `list` as their argument. Should validate the path ends in `chiaki.exe` or `chiaki-ng.exe` before executing.

---

### S3 — `credentials.js` — No backup on corrupted read ⚠️ LOW
`loadCredStore()` silently returns `{}` on any parse error. If `credentials.json` is corrupted, all credentials are silently lost and `saveCredStore` will overwrite with an empty object on the next write. There's no `.bak` fallback like `database.js` has.

---

## 4. Performance

### P1 — `credentials.js` — File I/O on every credential read ⚠️ MEDIUM
```js
function loadCredStore() {
  try { return JSON.parse(fs.readFileSync(credStorePath(), 'utf-8')); } catch { return {}; }
}
```
`getPassword()` reads the entire credentials file from disk synchronously on every call. During a multi-platform library import (`accounts:gog:import`, then `accounts:epic:import`, etc.), this is dozens of synchronous file reads in quick succession.

**Fix:** Cache the store in memory; invalidate on `saveCredStore`.
```js
let _credCache = null;
function loadCredStore() {
  if (_credCache) return _credCache;
  try { _credCache = JSON.parse(fs.readFileSync(credStorePath(), 'utf-8')); }
  catch { _credCache = {}; }
  return _credCache;
}
function saveCredStore(store) {
  _credCache = store;
  // ... write to disk
}
```

---

### P2 — `metadata.js:63-68` — Sequential HEAD requests for capsule validation ⚠️ LOW
```js
for (const url of capsuleUrls) {
  const probe = await net.fetch(url, { method: 'HEAD' });
  if (probe.ok) { coverUrl = url; break; }
}
```
`metadata:fetchAll` processes 3 games in parallel but within each game, capsule URL probes are sequential. For `fetchAll` on a 200-game library, this can add seconds. `Promise.any` would probe both in parallel and take the first success.

---

### P3 — `covers.js:66,112` — IIFE stat-check duplicated twice ⚠️ LOW
```js
(() => { try { return fs.statSync(game.localCoverPath).size >= 1024; } catch(e) { return false; } })()
```
This IIFE appears identically twice. Extract into a helper:
```js
function isValidLocalFile(p) {
  try { return !!p && fs.existsSync(p) && fs.statSync(p).size >= 1024; } catch { return false; }
}
```

---

### P4 — `detectionIpc.js:116-118` — Sync I/O on main process for playtime scan ⚠️ LOW
```js
const userDirs = fs.readdirSync(userdataDir).filter(d => {
  return fs.statSync(path.join(userdataDir, d)).isDirectory() ...
});
```
`readdirSync` + `statSync` per entry on the main process. For users with large Steam userdata dirs, this freezes the main process. Should use `fs.readdirSync(..., { withFileTypes: true })` to avoid the per-entry `statSync` calls.

---

## 5. Code Quality

### Q1 — `media.js` — 6 raw `console.log` calls, ignores `log` module ⚠️ MEDIUM
`logger.js` exists specifically to gate debug output behind `CEREAL_DEBUG=1`, but `media.js` bypasses it entirely with raw `console.log`. In production, every `media:getInfo` call (which can be called on an interval) logs the full native result to stdout.

**Fix:** Replace all `console.log/error` in `media.js` with `log.info`/`log.debug` from `./logger`.

Same issue (partially) in `xcloud.js` (2 calls), `keys.js` (5 calls), `metadata.js` (4 calls).

---

### Q2 — `gameCrud.js:71-78` — Background promise silently swallows all errors ⚠️ LOW
```js
fetchGameMetadata(game).then(meta => {
  ...
}).catch(() => {});
```
Any failure in the auto-metadata fetch after `games:add` is invisible. Should at minimum log: `.catch(e => log.debug('gameCrud', 'auto-metadata failed', e))`.

---

### Q3 — `metadata.js:265-325` — `applyMetadataToGame` has two category-merge passes that can conflict ⚠️ LOW
Lines 277 set `game.categories = meta.genres` when categories are empty. Lines 287-310 then re-merge `meta.genres + meta.categories + meta.type` into whatever `game.categories` now is. This means on first apply, genres are set twice — once from the simple assignment and again from the merge block. The merge block overwrites the simple assignment if the normalized values differ in capitalization. Consider collapsing to one pass.

---

### Q4 — `covers.js:12` — Silent `mkdirSync` failure ⚠️ LOW
```js
try { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); } catch (e) {}
```
If the covers directory can't be created (disk full, permissions), the function returns a path that doesn't exist. All subsequent downloads will fail silently with cryptic errors. Should at minimum log the error.

---

### Q5 — `context.js` — Implicit temporal ordering is not enforced ⚠️ LOW
`ctx.db`, `ctx.saveDB`, etc. are `null` until `app.whenReady()` populates them. Any module that accidentally calls an IPC handler before `whenReady` runs (or during app startup in an error path) will get cryptic null-dereference errors. A defensive getter would surface this clearly:
```js
// context.js
function assertReady(field) {
  if (!module.exports[field]) throw new Error(`ctx.${field} not ready — called before app.whenReady()?`);
  return module.exports[field];
}
```

---

### Q6 — `metadataSearch.js:186-187` — Console expression side-effect in comma operator ⚠️ LOW
```js
const sgdb = sgdbResult.status === 'fulfilled' ? sgdbResult.value 
  : (console.log('[ArtSearch] SteamGridDB failed:', sgdbResult.reason?.message), []);
```
Using the comma operator for side effects in a ternary is non-obvious and hard to read. Should be a standard `if/else` or use `log.debug`.

---

## 6. Architecture

### A1 — `gameCrud.js:8` — Top-level `require` of providers before `app.whenReady()` ⚠️ MEDIUM
```js
const { canonicalize: canonicalizeName } = require(path.join(getProvidersDir(), 'utils'));
```
This runs when `gameCrud.js` is first `require()`d (line 46 of `main.js`, before `app.whenReady()`). While it works in practice because `utils.js` doesn't use any Electron APIs, it's inconsistent with the lazy-loading pattern in `accounts.js` and `keys.js`, and would silently break if `utils.js` ever needed `net` or `app`.

**Fix:** Move to a `function getUtils()` lazy loader, or move the `require()` inside `registerGameCrudIpcHandlers()`.

---

### A2 — `xcloud.js:11` — xCloud events sent on `chiaki:event` channel ⚠️ LOW
```js
function sendStreamEvent(gameId, type, data) {
  ctx.sendToRenderer('chiaki:event', { gameId, type, ...data });
}
```
Xbox Cloud Gaming events (connecting, streaming, disconnected) arrive on `chiaki:event`. The renderer distinguishes by `platform: 'xbox'` in the payload, but this naming is misleading and couples two unrelated features. Any renderer code filtering for chiaki events must also filter out Xbox events. Consider a `stream:event` channel shared by both.

---

### A3 — `providers/index.js` — All providers eagerly loaded at startup ⚠️ LOW
`index.js` requires all 9 providers at load time. Providers like `battlenet.js`, `ubisoft.js`, `itchio.js` are only used if the user has those platforms. This adds startup cost proportional to all provider code. Consider lazy-loading providers on first use.

---

## 7. Summary Table

| # | Severity | Category | File | Issue |
|---|----------|----------|------|-------|
| B1 | HIGH | Bug | `detection.js:66` | `heroUrl` → `headerUrl` — Steam detected games never show wide art |
| B2 | MEDIUM | Bug | `covers.js:107` | Error candidate count wrong — missed retries |
| B3 | MEDIUM | Bug | `main.js:219` | Path traversal via `startsWith` on `local-image://` |
| S2 | MEDIUM | Security | `detectionIpc.js:66` | `execFileSync` on db-sourced path |
| S1 | MEDIUM | Security | `main.js:603` | Copied image file not content-validated |
| P1 | MEDIUM | Perf | `credentials.js` | Disk read on every credential access |
| Q1 | MEDIUM | Quality | `media.js` | Raw `console.log` bypasses `log` module |
| A1 | MEDIUM | Arch | `gameCrud.js:8` | Top-level providers require before `app.whenReady()` |
| D1 | MEDIUM | Dead code | `metadataSearch.js:34-130` | 3 dead functions (~130 lines) |
| B4 | LOW | Bug | `metadataSearch.js:146` | Typo `gamLabel` |
| B5 | LOW | Bug | `settings.js:90` | `undefined\|undefined` dedup key |
| B6 | LOW | Bug | `gameCrud.js:57` | ID collision on rapid import |
| B7 | LOW | Bug | `chiaki.js:629` | Null-unsafe `saveDB` wrapper |
| S3 | LOW | Security | `credentials.js` | No backup on corrupted credentials |
| P2 | LOW | Perf | `metadata.js:63` | Sequential HEAD requests for capsule probe |
| P3 | LOW | Perf | `covers.js:66,112` | Duplicate IIFE stat-check |
| P4 | LOW | Perf | `detectionIpc.js:116` | Sync `statSync` per dir entry in main process |
| Q2 | LOW | Quality | `gameCrud.js:71` | Silent `.catch(() => {})` on auto-metadata |
| Q3 | LOW | Quality | `metadata.js:265` | Two-pass category merge can conflict |
| Q4 | LOW | Quality | `covers.js:12` | Silent `mkdirSync` failure |
| Q5 | LOW | Quality | `context.js` | No enforcement of init ordering |
| Q6 | LOW | Quality | `metadataSearch.js:186` | Comma-operator side-effect in ternary |
| A2 | LOW | Arch | `xcloud.js:11` | xCloud events sent on `chiaki:event` channel |
| A3 | LOW | Arch | `providers/index.js` | All providers eagerly loaded |
| D2 | LOW | Dead code | `detection.js:12-13` | Hardcoded Steam paths inconsistent with env vars |
| D3 | LOW | Dead code | `chiaki.js:629` | Redundant `db` closure |

---

## Quick Wins (low effort, immediate value)

1. **B1** — Rename `heroUrl` → `headerUrl` in `detection.js:66` (1 line)
2. **D1** — Delete `searchDuckDuckGo`, `searchWikidata`, `searchWikipedia` from `metadataSearch.js` (~130 lines removed)
3. **B3** — Fix path traversal guard in `main.js:219` (2 lines)
4. **B2** — Fix cover candidate count in `covers.js:107` (1 line)
5. **Q1** — Replace `console.log/error` in `media.js` with `log.*` calls (6 lines)
6. **P1** — Add in-memory cache to `credentials.js` (~8 lines)
7. **B4** — Fix `gamLabel` typo in `metadataSearch.js:146` (1 line)
8. **B5** — Fix import dedup key in `settings.js:90` (1 line)
9. **P3** — Extract `isValidLocalFile` helper in `covers.js` (eliminate 2 IIFEs)

## Highest Impact Fixes

1. **B1** — Every Steam game's wide art is broken. One-line fix.
2. **D1** — 130 lines of dead code in a hot module. No-risk deletion.
3. **P1** — Credential reads are sync disk I/O on every access. Affects all import flows.
4. **S2** — `execFileSync` on db-sourced path. Low exploitability but non-zero.
