# Cereal Launcher — Refactor Plan

## Completed (Previous Sessions)

### Audit Round 1 — Bug Fixes
- [x] **CRITICAL**: `METADATA_CACHE` used in main.js but not imported → exported `invalidateMetadataCache` helper from metadata.js
- [x] Dead function `autoSetupChiakiIfMissing` → wired into `app.whenReady()`
- [x] Unused variable `const session` on chiaki launch path (line ~1154)
- [x] Unused imports: `fetchSteamMetadata`, `fetchSteamSearchMetadata`, `fetchWikipediaMetadata`, `fetchSteamGridDBArt`
- [x] Double-resolve race in `chiaki:registerConsole` and `chiaki:wakeConsole` → guarded `finish()` pattern
- [x] Indentation/style in `metadata:apply` handler
- [x] xCloud `stopXcloudSession` returns before async cleanup → synchronous view removal
- [x] safeStore: non-atomic credential writes → write-to-`.tmp`-then-`renameSync`

### Audit Round 2 — Cleanup
- [x] Unused imports `getLauncherExecutableCandidates`, `buildPlatformUris` from launcher.js
- [x] `saveDB`/`flushDB` non-atomic writes → atomic temp+rename pattern
- [x] Duplicate Steam path logic → extracted `findSteamRoot()` in detection.js, reused in playtime:sync
- [x] accounts.js exported 6 internal-only helpers → trimmed to `detachAccountSecrets` + `registerAccountIpcHandlers`
- [x] xcloud.js `chiaki:event` channel clarified with comment

### Extraction Round — Partially Complete
- [x] **settings.js** — `electron/modules/settings.js` created and wired into main.js
  - Contains: `DEFAULT_SETTINGS`, `getSettings()`, `registerSettingsIpcHandlers()`
  - main.js calls: `registerSettingsIpcHandlers({ createTray, destroyTray, DB_PATH })`

---

## In Progress — MUST FIX FIRST

### `electron/modules/metadataSearch.js` — Broken, needs rewrite
The file was created but has **two bugs**:
1. `searchSteam()` uses `await` inside a `.then()` callback (not async) → **syntax error**
2. Line 6 has circular dependency: `require('../main')` → **will crash at runtime**

**Fix**: Rewrite the entire file:
- Make `searchSteam()` a proper `async function` (replace `.then()` with `await`)
- Remove the `require('../main')` import entirely — this module doesn't need `safeStore`/`validateProviderKey`/`summarizeSecret`
- Remove unused imports: `dialog`, `shell`, `ctx` (only `net`, `ipcMain`, `crypto` + metadata.js imports needed)
- The `steamgriddb:login` handler should **stay in main.js** since it needs `safeStore`, `clipboard`, `dialog`, `shell`, `validateProviderKey`, `summarizeSecret`

**After fixing**, update main.js:
- Replace the `metadata:searchArt` handler (lines ~778–979) with:
  ```js
  const { registerMetadataSearchHandlers } = require('./modules/metadataSearch');
  registerMetadataSearchHandlers();
  ```
- Keep `metadata:fetch`, `metadata:apply`, `metadata:fetchForName`, `metadata:fetchAll` in main.js (they use `db`, `saveDB`, `sendToRenderer`, `enqueueCoverFetch` directly)
- Keep `steamgriddb:login` and `clipboard:readText` in main.js

---

## Remaining Extractions (E3)

### Move chiaki IPC handlers into chiaki.js (~508 lines)
Lines ~1500–2008 in main.js contain chiaki-specific IPC handlers that could move to `chiaki.js`:

**Candidates to move** (create `registerChiakiIpcHandlers()` in chiaki.js):
- `chiaki:status` — uses `getBundledChiakiExe`, `getBundledChiakiVersion`, `getChiakiDir`, `CHIAKI_SYSTEM_PATHS`
- `chiaki:checkUpdate` — uses `net.fetch`, `getBundledChiakiVersion`
- `chiaki:update` — uses `spawn`, `getBundledChiakiVersion`
- `chiaki:getConfig` / `chiaki:saveConfig` — uses `db.chiakiConfig`, `saveDB`
- `games:setChiakiStream` — uses `db.games`, `saveDB`
- `chiaki:startStreamDirect` / `chiaki:startStream` / `chiaki:stopStream` / `chiaki:getSessions`
- `chiaki:openGui` — uses `resolveChiakiExe`, `spawn`
- `chiaki:registerConsole` — uses `resolveChiakiExe`, `spawn`, guarded resolve
- `chiaki:discoverConsoles` — uses `dgram`, `os`, UDP broadcast
- `chiaki:wakeConsole` — uses `resolveChiakiExe`, `spawn`, `dgram`, guarded resolve
- `autoSetupChiakiIfMissing` function definition

**Dependencies to pass via `ctx` or params**:
- `db`, `saveDB` → already on `ctx`
- `dgram`, `os` → import in chiaki.js
- `net` → import from electron
- `app.getPath('userData')` → pass or import `app`
- `DB_PATH` is NOT needed by chiaki handlers

**After moving**: main.js just calls `registerChiakiIpcHandlers()` after ctx is populated.

---

## Performance Improvements (P1, P2)

### P1: Parallel metadata:searchArt
Currently: SteamGridDB → if empty → Steam fallback (sequential).
Improvement: Run SteamGridDB + Steam in parallel via `Promise.allSettled`, prefer SGDB results but merge Steam if SGDB is sparse. This cuts search time roughly in half for the fallback case.

Implementation in `metadataSearch.js` `handleSearchArt()`:
```js
const [sgdb, steam] = await Promise.allSettled([
  searchSteamGridDB(gameName, ms.steamGridDbKey),
  searchSteam(gameName),
]);
// Prefer SGDB, append Steam results for any missing types
```

### P2: Reduce redundant saveDB calls
In `metadata:fetchAll`, `saveDB` + `sendToRenderer` is called after every batch of 3. If multiple batches complete quickly, debounce already collapses them — but the `sendToRenderer('games:refresh')` calls are not debounced and could thrash the renderer.

Fix: Only send `games:refresh` every N batches or after a minimum interval (e.g. 500ms).

---

## Robustness Improvements (R1, R2)

### R1: DB corruption recovery
Current: If `games.json` is corrupted (partial write, disk full), `loadDB` calls `JSON.parse` which throws, and the catch block creates a fresh empty DB — **losing all data**.

Fix in `loadDB()`:
1. Before every atomic write (in `saveDB`), copy current `DB_PATH` to `DB_PATH + '.bak'`
2. In `loadDB`, if `JSON.parse` fails on the primary file, try loading `.bak`
3. If both fail, then seed a fresh DB
4. Log a warning when falling back to backup

```js
function loadDB() {
  for (const filePath of [DB_PATH, DB_PATH + '.bak']) {
    try {
      if (!fs.existsSync(filePath)) continue;
      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      // ... validation and migration ...
      if (filePath !== DB_PATH) console.warn('[DB] Loaded from backup — primary was corrupt');
      return data;
    } catch (e) {
      console.error('[DB] Failed to load', filePath, e.message);
    }
  }
  // Both failed — seed fresh
  const seed = { /* ... */ };
  saveDB(seed);
  return seed;
}
```

And in `saveDB`:
```js
// Before writing, back up current file
try { if (fs.existsSync(DB_PATH)) fs.copyFileSync(DB_PATH, DB_PATH + '.bak'); } catch (_) {}
const tmp = DB_PATH + '.tmp';
fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
fs.renameSync(tmp, DB_PATH);
```

### R2: Timeout guards on child_process spawns
`chiaki:update` and `autoSetupChiakiIfMissing` spawn PowerShell processes with no timeout. If the script hangs (network issues, UAC prompt), the promise never resolves.

Fix: Add a 5-minute timeout to both:
```js
const SETUP_TIMEOUT = 5 * 60 * 1000;
setTimeout(() => {
  try { child.kill(); } catch (_) {}
  resolve({ error: 'Setup timed out after 5 minutes' });
}, SETUP_TIMEOUT);
```

---

## Verification Checklist (V1)
After all changes:
1. `node -c electron/main.js` — syntax check
2. `node -c electron/modules/*.js` — syntax check all modules
3. `npx vite build` — Vite build passes
4. `npx tsc --noEmit` — TypeScript check passes
5. Manual smoke test: launch app, verify settings, metadata search, chiaki status

---

## File Size Target
| File | Current | After | 
|------|---------|-------|
| main.js | ~2029 lines | ~1000–1200 lines |
| chiaki.js | 581 lines | ~1050 lines (absorbs IPC handlers) |
| metadataSearch.js | 220 lines (broken) | ~210 lines (fixed) |
| settings.js | 148 lines | 148 lines (done) |
