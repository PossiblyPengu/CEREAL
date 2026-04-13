# Provider Interface Contract

Each provider module in this directory represents a game storefront/platform.
All providers are aggregated and re-exported by `index.js`.

## Expected Exports

Every provider **SHOULD** implement the following interface. Not all methods are
required — providers export only what they support.

### Detection (local scanning)

```js
/**
 * Scan for locally installed games on this platform.
 * @returns {{ games: Array<{ name, platform, platformId, coverUrl?, headerUrl?, installed? }>, error?: string }}
 */
function detectInstalled() {}

/**
 * Detect all owned games (installed + cloud library).
 * @returns {Array<{ name, platform, platformId, coverUrl?, installed? }>}
 */
function detectOwned() {}

/**
 * Check whether the platform's launcher application is installed.
 * @returns {boolean}
 */
function isAppInstalled() {}
```

### Library Import (authenticated)

```js
/**
 * Import the user's full library using an API key or OAuth token.
 * @param {{ db, saveDB, notify: (progress) => void, apiKey?: string, accessToken?: string }} opts
 * @returns {{ imported: number, updated: number, total: number, games: Array }}
 */
async function importLibrary(opts) {}
```

### API Key Validation (optional)

```js
/**
 * Validate an API key before storing it.
 * @param {string} apiKey
 * @returns {{ ok: boolean, info?: string, error?: string }}
 */
async function validateKey(apiKey) {}
```

## Provider Matrix

| Provider    | detectInstalled | detectOwned | isAppInstalled | importLibrary | validateKey |
| ----------- | :-------------: | :---------: | :------------: | :-----------: | :---------: |
| steam       | ✓               | —           | —              | ✓             | ✓           |
| epic        | ✓               | —           | —              | ✓             | —           |
| gog         | ✓               | —           | —              | ✓             | ✓           |
| xbox        | ✓               | —           | —              | ✓             | —           |
| ea          | ✓               | —           | ✓              | —             | —           |
| battlenet   | ✓               | —           | ✓              | —             | —           |
| itchio      | ✓               | —           | ✓              | ✓             | ✓           |
| ubisoft     | ✓               | ✓           | ✓              | —             | —           |
| steamgriddb | —               | —           | —              | —             | ✓           |

## Shared Utilities

- **`utils.js`** — `canonicalize`, `stripEdition`, `isDlcTitle`, `findExisting`, `makeGameEntry`, `updateAccountSync`
- **`http.js`** — `httpGet`, `httpGetJson`, `httpPost` (legacy Node.js https; prefer `net.fetch` in modules)
- **`auth.js`** — OAuth config for Steam, GOG, Epic, Xbox
