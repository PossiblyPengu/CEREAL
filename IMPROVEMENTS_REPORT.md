# Cereal Launcher — Improvements Audit Report

**Date:** 2025-04-13
**Scope:** Architecture, performance, DRY, code quality, modernization, DX

---

## 1. Architecture — main.js Is a God File (HIGH)

`electron/main.js` is **1412 lines** with ~60 `ipcMain.handle` registrations inlined, plus DB management, window management, credential storage, metadata fetch-all orchestration, playtime sync, launch logic, detection handlers, and more.

### Recommended Extraction

| Lines | Responsibility | Suggested Module |
| --- | --- | --- |
| 20-52 | Credential store (`safeStore`) | `modules/credStore.js` |
| 84-141 | DB load/save/flush/backup | `modules/database.js` |
| 145-265 | Window creation + event handlers | `modules/window.js` |
| 279-297 | Tray icon management | `modules/tray.js` (or merge into window.js) |
| 554-681 | Game CRUD IPC handlers | `modules/games.js` |
| 683-769 | Key storage + validation IPC | Merge into `modules/accounts.js` |
| 776-891 | Metadata IPC orchestration | Merge into `modules/metadata.js` |
| 932-1007 | Launch handler | Merge into `modules/launcher.js` |
| 1075-1201 | Detection IPC handlers (8 handlers) | `modules/detectionIpc.js` |
| 1203-1287 | Playtime sync | `modules/playtime.js` |

**Impact:** Each module would register its own IPC handlers (pattern already used by `accounts.js`, `chiaki.js`, `settings.js`, `metadataSearch.js`). main.js would shrink to ~150 lines of bootstrapping.

---

## 2. Architecture — Detect Handler Boilerplate (MEDIUM)

Six detection handlers (`detect:ea`, `detect:battlenet`, `detect:itchio`, `detect:ubisoft`, `detect:xbox`) follow the exact same pattern:

```js
ipcMain.handle('detect:PLATFORM', async () => {
  try {
    if (!providers?.PLATFORM?.detectInstalled) return { games: [], appFound: false, error: '...' };
    const res = providers.PLATFORM.detectInstalled();
    return {
      games: res?.games || [],
      appFound: providers.PLATFORM.isAppInstalled ? !!providers.PLATFORM.isAppInstalled() : false,
      error: res?.error,
    };
  } catch (err) { return { games: [], appFound: false, error: err.message }; }
});
```

**Fix:** Replace with a single generic factory:

```js
function registerDetectHandler(platform) {
  ipcMain.handle(`detect:${platform}`, async () => {
    try {
      const p = providers?.[platform];
      if (!p?.detectInstalled) return { games: [], appFound: false, error: `${platform} provider not available` };
      const res = p.detectInstalled();
      return { games: res?.games || [], appFound: p.isAppInstalled?.() || false, error: res?.error };
    } catch (err) { return { games: [], appFound: false, error: err.message }; }
  });
}
['ea', 'battlenet', 'itchio', 'ubisoft'].forEach(registerDetectHandler);
```

Eliminates ~80 lines of copy-paste.

---

## 3. Architecture — Provider Interface Contract (MEDIUM)

Each provider (`steam.js`, `gog.js`, `epic.js`, `xbox.js`, `ea.js`, `battlenet.js`, `itchio.js`, `ubisoft.js`) implements a subset of:

- `detectInstalled()` → `{ games: [] }`
- `detectOwned()` → `[]`
- `isAppInstalled()` → `boolean`
- `importLibrary({ db, saveDB, notify, apiKey })` → `{ imported, updated, total, games }`
- `validateKey(apiKey)` → `{ ok, info?, error? }`

But there's **no formal interface** — it's all ad-hoc. EA and Ubisoft don't have `validateKey`. GOG and itch.io have it. Some providers export `detectOwned`, some don't.

**Fix:** Document the expected provider interface in `providers/README.md` or a `providers/types.d.ts`, and optionally validate at startup that each registered provider conforms to a minimum contract.

---

## 4. Architecture — Two HTTP Stacks (LOW)

- `providers/http.js` — raw Node.js `https` module with manual timeout, no redirect handling
- Various modules use `electron net.fetch` — full HTTP/2, redirect-aware, proxy-aware

**Fix:** Standardize on `net.fetch` (available since Electron 28+, and you're on Electron 41). Drop `providers/http.js` or rewrite it as a thin wrapper around `net.fetch`. This removes ~77 lines of manual HTTP plumbing and gets redirect support for free.

---

## 5. Architecture — DB Write Duplication (LOW)

`saveDB()` and `flushDB()` share identical write logic (backup → write tmp → rename). The only difference is debounce vs immediate.

**Fix:** Extract a `writeDBSync(data)` helper and call it from both:

```js
function writeDBSync(data) {
  try { if (fs.existsSync(DB_PATH)) fs.copyFileSync(DB_PATH, DB_PATH + '.bak'); } catch (_) {}
  const tmp = DB_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, DB_PATH);
}
```

---

## 6. Code Quality — 70 Silent Catch Blocks (MEDIUM)

70 `catch (e) {}` or `catch (e) { /* ... */ }` blocks across 13 files. While many are intentional (filesystem probing, optional features), they make debugging extremely difficult.

**Recommended approach:**

- Add a lightweight logger: `function logDebug(tag, msg, err) { if (process.env.CEREAL_DEBUG) console.log(\`[\${tag}] \${msg}\`, err?.message); }`
- Replace empty catches with `catch (e) { logDebug('covers', 'download failed', e); }` — zero overhead in production, full visibility in debug mode.

### Worst offenders (by count)

| File | Empty catches |
| --- | --- |
| main.js | 17 |
| ubisoft.js | 10 |
| chiaki.js | 9 |
| metadata.js | 6 |
| metadataSearch.js | 5 |
| itchio.js | 5 |

---

## 7. Code Quality — App.tsx Is 1528 Lines with ~48 useState Hooks (HIGH)

The `App` component is a monolith with:

- 48 `useState` hooks
- 12 `useRef` hooks
- ~15 `useEffect` hooks
- Inline orbit camera math, parallax logic, drag handling, gamepad support, keyboard shortcuts
- Direct IPC calls scattered throughout

### Recommended Refactoring

| Concern | Extract To |
| --- | --- |
| Camera/zoom/drag/wheel | `hooks/useOrbitCamera.ts` |
| Parallax mouse tracking | `hooks/useParallax.ts` |
| Gamepad navigation | Already in `utils.ts` (`useGamepad`) — good |
| Panel visibility (8 `show*` booleans) | `hooks/usePanelState.ts` or a single `useReducer` |
| Games CRUD + filter/sort | `hooks/useGameLibrary.ts` |
| Settings + theme/scale | `hooks/useSettings.ts` |
| IPC listeners (chiaki, games:refresh, tabs, update) | `hooks/useIpcListeners.ts` |
| Toast system | `hooks/useToast.ts` |

This would reduce App.tsx to ~300 lines of layout composition.

---

## 8. Code Quality — Inline canonicalizeName in main.js (LOW)

`electron/main.js:559-562` defines `canonicalizeName()` **inside** the `games:add` IPC handler on every call. `providers/utils.js:9-12` has the standalone `canonicalize()`.

**Fix:** Import `canonicalize` from `providers/utils` instead of redefining it inline.

---

## 9. Code Quality — metadataSearch.js Dead Exports (LOW)

`searchDuckDuckGo`, `searchWikidata`, `searchWikipedia` are exported but never imported anywhere. Only `registerMetadataSearchHandlers` and `searchSteam`/`searchSteamGridDB` are used internally.

**Fix:** Remove dead exports, or keep them only if they serve as a public API for future use.

---

## 10. Performance — Cover Cleanup Runs on Every Launch (LOW)

`main.js:338-397` performs three sequential O(n) scans of the games array + filesystem on every app start:

1. Corrupt cover reference cleanup (lines 339-363)
2. Covers directory purge (lines 365-373)
3. Steam header backfill + re-enqueue (lines 376-397)

These were originally one-time migration fixes. Consider gating them behind a `db.migrationVersion` flag so they run once and are skipped on subsequent launches.

---

## 11. Performance — Playtime Sync VDF Parsing (LOW)

`main.js:1203-1287` parses Steam's `localconfig.vdf` twice with two different regex patterns (`appBlocks` then `appsSection`). The second pass re-scans the same VDF content.

**Fix:** Combine into a single regex pass, or better yet, write a minimal VDF parser (they're simple key-value trees) to avoid regex fragility.

---

## 12. DX — ESLint Doesn't Cover electron/*.js (MEDIUM)

`eslint.config.js` only lints `**/*.{ts,tsx}`. All 12 modules + 13 providers + main.js + preload.js are unlinted JavaScript.

**Fix:** Add a JS config block:

```js
{ files: ['electron/**/*.js'], languageOptions: { ecmaVersion: 2023, sourceType: 'commonjs' }, rules: { 'no-unused-vars': 'warn' } }
```

---

## 13. DX — No Test Infrastructure (MEDIUM)

Zero test files exist. The codebase has many pure functions ideal for unit testing:

- `providers/utils.js` — `canonicalize`, `isDlcTitle`, `stripEditionSuffix`
- `modules/detection.js` — manifest parsing
- `modules/launcher.js` — `normalizePlatform`, `buildPlatformUris`
- `modules/metadata.js` — `applyMetadataToGame`
- `providers/http.js` — response parsing

**Fix:** Add Vitest (already have Vite) with a `tests/` directory. Even 20-30 unit tests on these pure functions would catch regressions.

---

## 14. DX — No Dev Logging Toggle (LOW)

51 `console.log`/`console.error` calls are scattered across 8 files. No way to toggle verbosity.

**Fix:** Create a tiny `modules/logger.js`:

```js
const DEBUG = process.env.CEREAL_DEBUG === '1';
module.exports = {
  info: (tag, ...args) => console.log(`[${tag}]`, ...args),
  debug: (tag, ...args) => { if (DEBUG) console.log(`[${tag}]`, ...args); },
  error: (tag, ...args) => console.error(`[${tag}]`, ...args),
};
```

---

## 15. Modernization — providers/http.js Could Use net.fetch (MEDIUM)

The raw `https.get`/`https.request` code in `providers/http.js` (77 lines) doesn't handle:

- HTTP redirects (Steam/GOG APIs sometimes redirect)
- HTTP/2
- Proxy settings
- Response decompression

`net.fetch` handles all of these out of the box. Since providers are loaded after `app.whenReady()`, `net.fetch` is available.

---

## 16. CSS — Single 782-line File (LOW)

All styles are in `src/index.css`. For a 16-component app this is manageable, but could benefit from CSS modules or splitting by component for better maintainability.

---

## Summary Table

| # | Category | Impact | Effort |
| --- | --- | --- | --- |
| 1 | main.js god file extraction | High | High |
| 2 | Detect handler DRY | Medium | Low |
| 3 | Provider interface contract | Medium | Low |
| 4 | Two HTTP stacks | Low | Medium |
| 5 | DB write duplication | Low | Low |
| 6 | 70 silent catch blocks | Medium | Medium |
| 7 | App.tsx monolith (48 useState) | High | High |
| 8 | Inline canonicalizeName | Low | Low |
| 9 | metadataSearch dead exports | Low | Low |
| 10 | Cover cleanup on every launch | Low | Low |
| 11 | VDF double-parse | Low | Low |
| 12 | ESLint JS coverage | Medium | Low |
| 13 | No test infrastructure | Medium | Medium |
| 14 | No dev logging toggle | Low | Low |
| 15 | net.fetch modernization | Medium | Medium |
| 16 | Single CSS file | Low | Medium |

### Quick Wins (low effort, immediate value)

1. **#2** — Detect handler factory (eliminate ~80 lines)
2. **#5** — Extract `writeDBSync` helper
3. **#8** — Import `canonicalize` instead of inline
4. **#9** — Remove dead metadataSearch exports
5. **#10** — Gate cover cleanup behind migration version
6. **#12** — Add eslint JS block
7. **#14** — Add debug logger module

### Strategic Improvements (high effort, high value)

1. **#1** — Extract main.js into focused modules
2. **#7** — Decompose App.tsx into custom hooks
3. **#13** — Add Vitest test infrastructure
4. **#15** — Migrate providers/http.js to net.fetch
