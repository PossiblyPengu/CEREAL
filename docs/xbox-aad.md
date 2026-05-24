# Xbox sign-in — using your own Azure AD app

## TL;DR

By default Cereal uses the **legacy public Xbox client** (`0000000048093EE3`)
that the open-source Xbox Live ecosystem (`xboxreplay/xboxlive-auth`, OpenXBL,
Heroic, etc.) has shared for years. As of 2025–2026 Microsoft has been
tightening edge-policy on this endpoint — some accounts/networks now get
rejected with `HTTP 403 (no body)` from `user.auth.xboxlive.com/user/authenticate`,
which is undebuggable from the client side.

If you keep hitting that 403, register your own **Azure AD app** (free, ~5
min) and point Cereal at it via `appsettings.json`. Once configured, sign-in
goes through the modern `login.microsoftonline.com/consumers` flow which
isn't subject to the same edge limits.

## 1. Register the app

1. Go to <https://portal.azure.com/> → **App registrations** → **New registration**.
2. **Name**: anything (e.g. `Cereal Launcher`).
3. **Supported account types**: *Personal Microsoft accounts only*.
4. **Redirect URI**: choose **Public client/native (mobile & desktop)** from
   the dropdown and enter
   `https://login.microsoftonline.com/common/oauth2/nativeclient`.
5. Click **Register**, then copy the **Application (client) ID** from the
   Overview page — this is what goes in `appsettings.json`.
6. Open **API permissions** → **Add a permission** →
   *Microsoft APIs* tab → **Xbox Live Services**
   (note: the modal sometimes hides this behind "*See all APIs*")
   → **Delegated permissions** → check **`XboxLive.signin`** → **Add**.
   You do NOT need to add `XboxLive.offline_access`; on AAD v2 the
   refresh-token capability comes from the standard `offline_access` scope
   we send at sign-in time.
7. Open **Authentication** → set **Allow public client flows** to **Yes**
   → **Save**.

That's it for the portal.

## 2. Drop the client ID into `appsettings.json`

Cereal reads overrides from (later wins over earlier):

- `<repo-root>/appsettings.json` (dev only)
- `<install-dir>/appsettings.json` (packaged builds)
- `<userData>/appsettings.json` (survives upgrades — recommended)

`<userData>` resolves to:

- Windows: `%APPDATA%\cereal-launcher\appsettings.json`
- macOS: `~/Library/Application Support/cereal-launcher/appsettings.json`
- Linux: `~/.config/cereal-launcher/appsettings.json`

Create the file with:

```json
{
  "OAuth": {
    "xbox": {
      "clientId": "<paste your Application (client) ID here>",
      "redirectUri": "https://login.microsoftonline.com/common/oauth2/nativeclient",
      "authUrl": "https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize",
      "tokenUrl": "https://login.microsoftonline.com/consumers/oauth2/v2.0/token",
      "scope": "XboxLive.signin offline_access"
    }
  }
}
```

Restart Cereal and the wizard / Settings → Platforms → Xbox card will use
your app.

## 3. (Optional) override via environment variables

If you'd rather not write a file, every overridable key has a matching
`CEREAL_XBOX_<KEY>` env var:

```bash
CEREAL_XBOX_CLIENT_ID=...
CEREAL_XBOX_REDIRECT_URI=https://login.microsoftonline.com/common/oauth2/nativeclient
CEREAL_XBOX_AUTH_URL=https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize
CEREAL_XBOX_TOKEN_URL=https://login.microsoftonline.com/consumers/oauth2/v2.0/token
CEREAL_XBOX_SCOPE=XboxLive.signin offline_access
```

Env vars win over the JSON file.

## Notes

- Cereal **never sees your secrets** — your client ID is public by design,
  and the user's MSA password is entered into Microsoft's own sign-in page
  inside an isolated Electron `BrowserWindow`.
- Tokens are stored in your OS keychain via Electron's `safeStorage`, scoped
  to your machine. Removing the Xbox account from Cereal wipes them.
