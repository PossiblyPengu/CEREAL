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

## File Size Results
| File | Before | Target | Actual | 
|------|--------|--------|--------|
| main.js | ~2029 lines | ~1000–1200 lines | 1407 lines |
| chiaki.js | 581 lines | ~1050 lines | 1048 lines |
| metadataSearch.js | 220 lines (broken) | ~210 lines (fixed) | 214 lines |
| settings.js | 148 lines | 148 lines | 145 lines |
