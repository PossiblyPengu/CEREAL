PSN OAuth integration (notes and steps)

Overview
--------
Integrating official PlayStation Network OAuth requires registering an application with Sony and implementing an OAuth 2.0 flow. This file outlines the high-level steps and considerations.

Steps
-----
1. Register an application with Sony: sign in to Sony developer portal and create an OAuth client. You will obtain a `client_id` and `client_secret` and set Redirect URI(s).

2. Choose OAuth flow: Authorization Code flow (with PKCE) is recommended for desktop apps.

3. Implement the browser flow:
   - Open an embedded BrowserWindow (no nodeIntegration) to the authorization URL with PKCE challenge.
   - After user authorizes, handle the redirect to your redirect URI. Desktop apps can use a local loopback redirect (http://127.0.0.1:PORT/callback) or a custom scheme.
   - Exchange the authorization code for access/refresh tokens securely on the backend or locally with client secret if allowed.

4. Store tokens securely: use OS credential store (Windows Credential Manager, macOS Keychain) or prompt user each session.

5. Use the access token to call PSN endpoints to retrieve the onlineId (PSN Account ID) and other profile info.

Security & Legal
----------------
- Ensure you follow Sony's Terms of Service and API usage policies when integrating with PSN.
- Do not store raw passwords. Use tokens and refresh flows.
- If distributing, register your app appropriately and provide accurate redirect URIs.

Notes
-----
- This project currently implements a prototype DOM-extraction `psnAuth` flow for convenience; full OAuth is recommended for production.
- If you want, I can scaffold the Authorization Code + PKCE flow and a small local redirect handler.
