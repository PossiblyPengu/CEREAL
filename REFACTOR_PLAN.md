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

## Completed — Fixed

### `electron/modules/metadataSearch.js` — Fixed ✅
- [x] `searchSteam()` rewritten as proper `async function` (replaced `.then()` with `await`)
- [x] Removed circular `require('../main')` import
- [x] Removed unused imports: `dialog`, `shell`, `ctx`
- [x] main.js handler replaced with `registerMetadataSearchHandlers()` call
- [x] `steamgriddb:login` and `clipboard:readText` stay in main.js

---

## Completed Extractions (E3) ✅

### Chiaki IPC handlers moved into chiaki.js
- [x] All chiaki IPC handlers moved to `registerChiakiIpcHandlers()` in chiaki.js
- [x] `autoSetupChiakiIfMissing` moved to chiaki.js
- [x] `chiaki:setStreamBounds` moved to chiaki.js
- [x] Removed unused `dgram` import from main.js
- [x] main.js calls `registerChiakiIpcHandlers()` after ctx is populated

---

## Performance Improvements (P1, P2) ✅

### P1: Parallel metadata:searchArt — Done
- [x] SGDB + Steam run in parallel via `Promise.allSettled` in `handleSearchArt()`
- [x] Prefer SGDB results, append Steam when SGDB yields nothing

### P2: Reduce redundant saveDB calls — Done
- [x] `games:refresh` throttled to 500ms minimum interval in `metadata:fetchAll`
- [x] `saveDB` still called per-batch for durability, only renderer pushes are throttled

---

## Robustness Improvements (R1, R2) ✅

### R1: DB corruption recovery — Done
- [x] `saveDB` and `flushDB` copy primary to `.bak` before every write
- [x] `loadDB` tries primary, then `.bak` fallback, then seeds fresh
- [x] Warning logged when falling back to backup

### R2: Timeout guards on child_process spawns — Done
- [x] `autoSetupChiakiIfMissing`: 5-minute timeout with kill + renderer notification
- [x] `chiaki:update`: 5-minute timeout with kill + error resolve

---

## Verification Checklist (V1) ✅
1. [x] `node -c electron/main.js` — syntax check passed
2. [x] `node -c electron/modules/*.js` — all 12 modules passed
3. [x] `vite build` — client + electron + preload all built successfully
4. [ ] `npx tsc --noEmit` — skipped (execution policy restriction)
5. [ ] Manual smoke test: launch app, verify settings, metadata search, chiaki status

---

## Extraction Round — E4 (Session 3) ✅

### Core Infrastructure Modules
- [x] **credentials.js** — Secure credential store using Electron safeStorage
  - Exports: `safeStore` with `setPassword`, `getPassword`, `deletePassword`
  - Handles atomic writes to `credentials.json` with temp file pattern
- [x] **database.js** — Database persistence (games.json)
  - Exports: `DB_PATH`, `loadDB`, `saveDB`, `flushDB`, `writeDBSync`
  - Atomic writes with `.bak` fallback for corruption recovery

### IPC Handler Modules
- [x] **keys.js** — API key storage and validation
  - Handlers: `keys:set/get/delete/validate/validateStored`, `steamgriddb:login`, `clipboard:readText`
  - Includes `summarizeSecret` and `validateProviderKey` helpers
- [x] **gameCrud.js** — Game CRUD + Categories + Tabs
  - Handlers: `games:getAll/getCategories/add/update/delete/toggleFavorite`, `covers:fetchNow`
  - Handlers: `categories:add/remove`, `tabs:switch/close`
  - Handles image cache cleanup on cover/header URL changes
- [x] **metadataIpc.js** — Metadata fetch/apply handlers
  - Handlers: `metadata:fetch/apply/fetchForName/fetchAll`
  - Includes `registerMetadataSearchHandlers` from metadataSearch.js
  - Batch processing with throttled renderer refreshes (500ms interval)
- [x] **detectionIpc.js** — Platform detection + playtime sync
  - Handlers: `detect:steam/epic/gog/psremote/xbox` + generic provider factory
  - Handler: `playtime:sync` (Steam VDF localconfig parsing, GOG/Epic stubs)
  - Includes chiaki-ng bundled/system detection and console listing
- [x] **media.js** — xCloud + SMTC media controls
  - Handlers: `xcloud:startDirect/start/stop/getSessions`
  - Handlers: `media:getInfo/control` (native SMTC addon, lazy-loaded)

### main.js Cleanup
- [x] Removed unused imports: `crypto`, `clipboard`, `httpGetJson`, `canonicalizeName`, `ALLOWED_KEY_SERVICES`, `CONTROL_BAR_HEIGHT`
- [x] Updated `ctx.flushDB` to wrap and pass `db` explicitly
- [x] All inline handlers replaced with module imports

---

## Verification Checklist (V2) ✅
1. [x] `node -c electron/main.js` — syntax check passed
2. [x] `node -c electron/modules/*.js` — all 17 modules passed
3. [x] `vite build` — client + electron + preload all built successfully
4. [x] `npx tsc --noEmit` — TypeScript compilation clean
5. [x] `vitest run` — 14/14 tests passing
6. [ ] Manual smoke test: launch app, verify settings, metadata search, chiaki status

---

## File Size Results (E4)
| File | Before (E3) | After (E4) | Reduction |
|------|-------------|------------|-----------|
| main.js | 1407 lines | 641 lines | **−766 (54%)** |
| chiaki.js | 1048 lines | 1048 lines | unchanged |
| metadataSearch.js | 214 lines | 214 lines | unchanged |
| settings.js | 145 lines | 145 lines | unchanged |
| **New modules (E4)** | — | — | — |
| credentials.js | — | 44 lines | new |
| database.js | — | 69 lines | new |
| keys.js | — | 91 lines | new |
| gameCrud.js | — | 150 lines | new |
| metadataIpc.js | — | 102 lines | new |
| detectionIpc.js | — | 139 lines | new |
| media.js | — | 76 lines | new |
