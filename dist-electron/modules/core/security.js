// Renderer security hardening: permission gating + CSP.
//
// Both apply to `session.defaultSession`, which is the session used by the
// main BrowserWindow. xCloud and OAuth windows use partition: sessions, so
// they're unaffected by this and configure their own permission/CSP policies.

const { app, session } = require('electron');

function registerPermissionHandler() {
  // Whitelist the permissions our UI actually needs. Everything else (camera,
  // geolocation, notifications, MIDI, etc.) is denied silently.
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    const allowed = ['clipboard-read', 'clipboard-sanitized-write', 'fullscreen'];
    callback(allowed.includes(permission));
  });
}

function registerCsp() {
  // Applied as a response header so the policy reaches the renderer before any
  // script executes. The meta tag in index.html is a defense-in-depth fallback
  // in case this handler ever races against initial navigation.
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self'",
          "script-src 'self' 'unsafe-inline'",
          "style-src 'self' 'unsafe-inline'",
          "img-src 'self' data: blob: local-image: https: http:",
          "font-src 'self' data:",
          "media-src 'self' local-image: https:",
          "object-src 'none'",
          "base-uri 'self'",
          "frame-ancestors 'none'",
          "form-action 'self'",
          [
            "connect-src 'self'",
            'https://*.steampowered.com https://*.steamstatic.com https://store.steampowered.com https://api.steampowered.com https://steamcdn-a.akamaihd.net',
            'https://*.steamgriddb.com https://*.gog.com https://*.epicgames.com',
            'https://*.xbox.com https://*.xboxlive.com',
            'https://*.wikipedia.org https://*.wikidata.org https://*.wikimedia.org https://*.duckduckgo.com',
            // Dev-only: Vite dev server + HMR WebSocket on localhost (any port)
            ...(!app.isPackaged ? ['http://localhost:* https://localhost:* ws://localhost:* wss://localhost:*'] : []),
          ].join(' '),
        ].join('; '),
        'X-Content-Type-Options': ['nosniff'],
        'Referrer-Policy': ['no-referrer'],
      },
    });
  });
}

function registerSecurityHandlers() {
  registerPermissionHandler();
  registerCsp();
}

module.exports = { registerSecurityHandlers, registerPermissionHandler, registerCsp };
