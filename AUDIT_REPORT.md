# Cereal Launcher — Full Repository Audit Report

**Date:** 2025-04-13
**Scope:** `electron/main.js`, `electron/modules/*`, `electron/providers/*`, `electron/preload.js`, `src/*`, config files

---

## 1. Bugs & Functional Issues

### 1.1 Dead IPC Handlers — Tab System (HIGH)
**Files:** `electron/preload.js:148-160`
- `switchTab` → `ipcRenderer.invoke('tabs:switch', ...)` — **no `ipcMain.handle` exists**
- `closeTab` → `ipcRenderer.invoke('tabs:close', ...)` — **no `ipcMain.handle` exists**
- `onTabsOpened` / `onTabsClosed` listen for `tabs:opened` / `tabs:closed` events — **never sent from main**
- **Impact:** Calling `window.api.switchTab()` or `closeTab()` from renderer will return a rejected promise (unhandled `ipcMain.handle` error). The tab system listeners silently do nothing.
- **Fix:** Either implement the missing IPC handlers or remove the dead preload entries.

### 1.2 Operator Precedence — Fragile (LOW)
**File:** `electron/modules/metadata.js:204-205`
```js
const coverUrl = covers.status === 'fulfilled' && covers.value?.data?.[0]?.url || '';
const headerUrl = heroes.status === 'fulfilled' && heroes.value?.data?.[0]?.url || '';
```
- `&&` binds tighter than `||`, so this evaluates as `(A && B) || ''`. It works by accident because when `A` is false, `false || ''` yields `''`, and when `A` is true it yields `B` (which could be `undefined`, then `|| ''` kicks in).
- **Fix:** Add parentheses for clarity: `(covers.status === 'fulfilled' ? covers.value?.data?.[0]?.url : '') || ''`

### 1.3 `window:ready` IPC Handler is a No-Op
**File:** `electron/main.js:211`
```js
ipcMain.on('window:ready', () => {});
```
- The preload sends this signal (`preload.js:163`), but the handler does nothing.
- **Low priority** — kept for future use per comment, but should be documented or removed if no future use is planned.

---

## 2. Unused Imports & Dead Code

### 2.1 main.js — Unused Imports from metadata.js (MEDIUM)
**File:** `electron/main.js:548`
```js
const { httpGet, fetchGameMetadata, applyMetadataToGame, getMetadataSettings, invalidateMetadataCache } = require('./modules/metadata');
```
- **`httpGet`** — never called in main.js (only used in metadata.js and metadataSearch.js internally)
- **`getMetadataSettings`** — never called in main.js (only used in metadata.js internally)
- **Fix:** Remove `httpGet` and `getMetadataSettings` from the destructure.

### 2.2 main.js — Unused Import from settings.js (LOW)
**File:** `electron/main.js:1290`
```js
const { DEFAULT_SETTINGS, registerSettingsIpcHandlers } = require('./modules/settings');
```
- **`DEFAULT_SETTINGS`** — never referenced in main.js. Only used inside `settings.js` itself.
- **Fix:** Remove from destructure.

### 2.3 main.js — Unused Import from discord.js (LOW)
**File:** `electron/main.js:66`
```js
const { connectDiscord, disconnectDiscord, setDiscordPresence, clearDiscordPresence, isDiscordEnabled, getDiscordStatus } = require('./modules/discord');
```
- **`clearDiscordPresence`** — never called in main.js. It's used in `chiaki.js` (which imports it separately).
- **Fix:** Remove from main.js destructure.

### 2.4 covers.js — Exported but Unused Externally (LOW)
**File:** `electron/modules/covers.js:146-152`
- **`downloadToFile`** — exported but only used internally within covers.js
- **`processCoverQueue`** — exported but only called internally via `enqueueCoverFetch`
- **Fix:** Remove from `module.exports` (or keep for testability).

### 2.5 xcloud.js — Exports Unused by main.js (LOW)
**File:** `electron/modules/xcloud.js:141-142`
- **`getXcloudBounds`** and **`updateXcloudBounds`** — exported but never imported externally. Only used internally.
- **Fix:** Remove from exports.

### 2.6 launcher.js — Exports Unused by main.js (LOW)
**File:** `electron/modules/launcher.js:187-188`
- **`getLauncherExecutableCandidates`** and **`buildPlatformUris`** — exported but only consumed internally by `openInPlatformClient`.
- Main.js only imports `normalizePlatform` and `openInPlatformClient`.
- **Fix:** Remove from exports.

---

## 3. Code Duplication

### 3.1 Duplicate Steam Root Detection (MEDIUM)
- **`electron/modules/detection.js:findSteamRoot()`** — hardcoded paths `[Program Files (x86)/Steam, Program Files/Steam, HOME/Steam]`
- **`electron/providers/steam.js:detectLocalLibrary()`** — hardcoded paths `[Program Files (x86)/Steam, Program Files/Steam, homedir()/Steam, + Linux/macOS paths]`
- Both also contain nearly identical VDF parsing logic for `libraryfolders.vdf`.
- **Fix:** Have `providers/steam.js` import and use `findSteamRoot()` from `detection.js`, or extract shared logic to a utility.

### 3.2 Duplicate canonicalizeName (LOW)
- `electron/main.js:559-561` — inline `canonicalizeName()` inside `games:add` handler
- `electron/providers/utils.js:9-12` — `canonicalize()` with slightly different logic (also strips editions)
- **Fix:** Import `canonicalize` from providers/utils or extract to shared constants.

---

## 4. Deprecation Warnings

### 4.1 `String.prototype.substr()` — Deprecated (LOW)
**Files:** `main.js:598`, `settings.js:94`, `chiaki.js:472`
```js
Math.random().toString(36).substr(2, 5)
```
- `.substr()` is deprecated in modern JS. Use `.substring(2, 7)` instead.
- Appears in 3 places for ID generation.

---

## 5. Potential Race Conditions

### 5.1 saveDB Debounce + flushDB Data Mismatch (LOW)
**File:** `electron/main.js:114-141`
- `saveDB(data)` accepts a `data` parameter and debounces the write with 150ms.
- `flushDB()` does not accept `data` — it writes the global `db` variable.
- If `saveDB(someData)` is called with a different reference than `db`, then `flushDB()` is called before the debounce fires, flushDB writes `db` (not `someData`).
- In practice, `saveDB` is always called with `db` or `seed`, so this is unlikely to cause issues, but the API is inconsistent.
- **Fix:** Have `flushDB` use the same data that was last passed to `saveDB`, or always reference the global `db`.

### 5.2 Cover Queue Retry Infinite Growth (LOW)
**File:** `electron/modules/covers.js:126-132`
- If a game's cover URL permanently 404s, it retries `MAX_COVER_RETRIES` (2) times, then stops. This is correct.
- However, if the same gameId is re-enqueued externally (e.g., by metadata:fetchAll calling `enqueueCoverFetch`), the retry counter has been deleted and the cycle restarts. Not a bug per se, but could cause redundant network requests for permanently broken URLs.

---

## 6. Security Review

### 6.1 Overall: GOOD
- **contextIsolation: true**, **nodeIntegration: false**, **sandbox: true** (auth windows)
- CSP is set on all responses with restrictive `connect-src`
- `shell:openExternal` validates against a safe protocol allowlist
- Navigation is restricted in the main window
- `safeStorage` used for credential storage
- OAuth state parameter + CSRF protection implemented
- Auth windows block navigation to unknown domains

### 6.2 Minor: GOG/Epic Client Secrets in Source (INFO)
**File:** `electron/providers/auth.js:14-28`
- GOG `clientSecret` and Epic `clientSecret` are hardcoded. These are public OAuth client secrets (same as used by Galaxy/EGS desktop clients), so this is standard practice for native apps. Not a vulnerability, but worth noting.

### 6.3 Minor: `execFileSync` in detect:psremote (LOW)
**File:** `electron/main.js:1126`
- Executes `chiaki.exe list` synchronously with a 5s timeout. The path is resolved internally (bundled or system), not user-supplied. Safe.

---

## 7. Type Mismatches (src/)

### 7.1 ElectronAPI Type vs Preload (LOW)
**File:** `src/types.ts:167-224`
- The `ElectronAPI` interface is a convenience type but is **loose** — many methods are optional (`?`) and there's a `[key: string]: unknown` catch-all.
- Several preload methods are not represented in the interface (e.g., `fetchCoverNow`, `installGame`, `openGameInClient`, `chiakiStartStreamDirect`, `chiakiOpenGui`, `chiakiRegisterConsole`, `chiakiDiscoverConsoles`, `chiakiWakeConsole`, `chiakiSetStreamBounds`, `xcloudStartDirect`, `xcloudStart`, `xcloudGetSessions`, `saveApiKey`, `getApiKeyInfo`, `deleteApiKey`, `validateApiKey`, `validateStoredApiKey`, `getDiscordStatus`, `getSystemSpecs`, `getMediaInfo`, `mediaControl`, `readClipboard`, `steamGridDbLogin`, `getChiakiStatus`, `chiakiCheckUpdate`, `chiakiUpdate`, `getChiakiConfig`, `saveChiakiConfig`, `setChiakiStream`, `pickExecutable`, `pickImage`, `addCategory`, `removeCategory`, `searchArt`, `fetchMetadataForName`, `detectPSRemote`, `detectEA`, `detectBattleNet`, `detectItchio`, `detectUbisoft`, `checkForUpdate`, `exportLibrary`, `importLibrary`, `clearAllGames`, `clearCovers`, `getDataPath`, `getAppVersion`, `resetSettings`, `platformAuth`, `platformImport`, `getAccounts`, `removeAccount`, `applyMetadata`, `fetchMetadata`).
- The catch-all `[key: string]: unknown` means TypeScript won't flag calls to missing methods, reducing type safety.
- **Fix:** Expand the interface to cover all preload methods, or at minimum remove the catch-all index signature.

---

## 8. Configuration Review

### 8.1 vite.config.ts — OK
- Main and preload entries correct. Providers externalized and copied.
- `copyElectronProviders` copies providers + scripts + native modules on both `buildStart` and `closeBundle`. Clean.

### 8.2 electron-builder.yml — OK
- `asar: true` with `asarUnpack` for native modules. Scripts in `extraResources`. Sensible NSIS config.

### 8.3 eslint.config.js — Limited Scope (INFO)
- Only lints `**/*.{ts,tsx}` — **all electron JS files are unlinted**. No ESLint rules apply to `electron/*.js` or `electron/modules/*.js` or `electron/providers/*.js`.
- **Fix:** Add a JS config block or extend the existing one to `**/*.{ts,tsx,js}`.

### 8.4 package.json — OK
- Dependencies are reasonable. `discord-rpc` is optional (lazy-loaded). `electron-updater` for auto-updates. No obvious unused deps.

---

## 9. Summary

| Category | High | Medium | Low | Info |
|---|---|---|---|---|
| Bugs | 1 | 0 | 2 | 0 |
| Unused Code | 0 | 2 | 4 | 0 |
| Duplication | 0 | 1 | 1 | 0 |
| Deprecation | 0 | 0 | 1 | 0 |
| Race Conditions | 0 | 0 | 2 | 0 |
| Security | 0 | 0 | 1 | 2 |
| Types | 0 | 0 | 1 | 0 |
| Config | 0 | 0 | 0 | 2 |
| **Total** | **1** | **3** | **12** | **4** |

### Priority Fixes:
1. **[HIGH]** Implement or remove dead tab IPC handlers (`tabs:switch`, `tabs:close`, `tabs:opened`, `tabs:closed`)
2. **[MEDIUM]** Remove unused imports from `main.js` (`httpGet`, `getMetadataSettings`, `DEFAULT_SETTINGS`, `clearDiscordPresence`)
3. **[MEDIUM]** Deduplicate Steam root detection between `detection.js` and `providers/steam.js`
4. **[LOW]** Replace 3× `.substr()` with `.substring()`
5. **[LOW]** Add eslint coverage for `.js` files
