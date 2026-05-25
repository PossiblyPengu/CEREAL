// ─── Preload injected into the xCloud WebContentsView (isolated world) ──────
// Runs sandboxed, contextIsolation:true. Because of that, *this script cannot
// monkey-patch the page's RTCPeerConnection directly* — it lives in a separate
// JS context. Instead, the main process injects the instrumentation script
// (see `injectMainWorldInstrumentation` in modules/integrations/xcloud.js)
// into the page's main world, which monkey-patches RTCPeerConnection there
// and uses `window.postMessage` to ship metric samples back to us.
//
// What this preload does:
//   1. Listens for the well-known `__cerealXcloud` postMessage envelope and
//      forwards it to the main process via ipcRenderer.
//   2. Performs DOM-only detection that doesn't need to monkey-patch anything
//      (URL parsing, document title, <video> readyState) and reports it too.
//
// IPC channels emitted upstream (handled in modules/integrations/xcloud.js):
//   xcloud:stats   { gameId, bitrateMbps, fps, rttMs, packetsLost, jitterMs }
//   xcloud:title   { gameId, title, productId }
//   xcloud:state   { gameId, state }   ← 'connecting'|'streaming'|'idle'
//
// The gameId is encoded in the URL fragment by xcloud.js so we don't need a
// startup handshake from main process.

const { ipcRenderer } = require('electron');

const GAME_ID = (() => {
  try {
    const hash = location.hash || '';
    const m = hash.match(/cereal-game-id=([^&]+)/);
    return m ? decodeURIComponent(m[1]) : '';
  } catch (_e) { return ''; }
})();

// ── 1. Main-world → isolated-world bridge ────────────────────────────────────
window.addEventListener('message', (event) => {
  // Cross-world messages share `window`, so anyone on xbox.com could fire one.
  // We tag our payloads with a magic key + only accept messages from this
  // same window, then validate the gameId matches what we were spawned with.
  if (event.source !== window) return;
  const data = event.data;
  if (!data || data.__cerealXcloud !== true) return;
  if (data.gameId && GAME_ID && data.gameId !== GAME_ID) return;
  const type = data.type;
  if (type === 'stats') {
    ipcRenderer.send('xcloud:stats', {
      gameId: GAME_ID,
      bitrateMbps: Number(data.bitrateMbps || 0),
      fps: Number(data.fps || 0),
      rttMs: Number(data.rttMs || 0),
      packetsLost: Number(data.packetsLost || 0),
      jitterMs: Number(data.jitterMs || 0),
    });
  } else if (type === 'state') {
    ipcRenderer.send('xcloud:state', { gameId: GAME_ID, state: data.state });
  }
});

// ── 2. URL / document-title detection (pure DOM, no patching required) ───────
let lastSig = '';

function parseLaunchUrl() {
  try {
    const m = location.pathname.match(/\/play\/(?:launch|games)\/([^/]+)\/([0-9A-Z]{10,14})/i);
    if (m) return { slug: m[1], productId: m[2].toUpperCase() };
  } catch (_e) { /* ignore */ }
  return null;
}

function reportDetection() {
  const parsed = parseLaunchUrl();
  const productId = parsed?.productId || '';
  let title = '';
  if (parsed?.slug) {
    title = parsed.slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  }
  const docTitle = (document.title || '').split('|')[0].trim();
  if (docTitle && docTitle !== 'Xbox' && docTitle !== 'Xbox Cloud Gaming' && docTitle.length > 1) {
    title = docTitle;
  }
  const sig = title + '|' + productId;
  if (sig === lastSig) return;
  lastSig = sig;
  if (title || productId) {
    ipcRenderer.send('xcloud:title', { gameId: GAME_ID, title, productId });
  }
}

// Tick reasonably often — title detection is cheap and the user navigates
// across games frequently in the catalog views.
function start() {
  setTimeout(reportDetection, 600);
  setInterval(reportDetection, 2000);
  window.addEventListener('popstate', () => setTimeout(reportDetection, 200));
  window.addEventListener('hashchange', () => setTimeout(reportDetection, 200));
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start, { once: true });
} else {
  start();
}
