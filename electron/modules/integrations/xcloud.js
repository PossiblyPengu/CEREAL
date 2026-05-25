// ─── xCloud (Xbox Cloud Gaming) WebContentsView Embedding ────────────────────
const path = require('node:path');
const { WebContentsView, session, ipcMain } = require('electron');
const ctx = require('../core/context');
const { CONTROL_BAR_HEIGHT } = require('../core/constants');
const log = require('../core/logger');
const { clearDiscordPresence, isDiscordEnabled, setDiscordPresence } = require('./discord');

const xcloudSessions = new Map(); // gameId -> { view, state, startTime, lastStats, lastTitle }

// Resolve the xCloud preload script. In dev we read from the source tree; in
// production the electron-builder ASAR layout colocates it next to main.js.
function resolveXcloudPreload() {
  const candidates = [
    path.join(__dirname, '..', '..', 'preload-xcloud.js'),
    path.join(__dirname, '..', '..', '..', 'electron', 'preload-xcloud.js'),
  ];
  for (const p of candidates) {
    try { if (require('node:fs').existsSync(p)) return p; }
    catch (_e) { /* keep checking */ }
  }
  return candidates[0];
}

// Unified stream event channel (shared with chiaki.js — renderer distinguishes by 'platform' field)
function sendStreamEvent(gameId, type, data) {
  ctx.sendToRenderer('chiaki:event', { gameId, type, ...data });
}

function getXcloudBounds() {
  // WebContentsView.setBounds takes logical (CSS) pixels.
  // In native fullscreen the renderer hides its control bar, so the embedded
  // view should expand to fill the entire content area.
  const win = ctx.mainWindow;
  const [cw, ch] = win ? win.getContentSize() : [1280, 720];
  const isFs = !!win && typeof win.isFullScreen === 'function' && win.isFullScreen();
  const bar = isFs ? 0 : CONTROL_BAR_HEIGHT;
  const width  = Math.max(1, cw);
  const height = Math.max(1, ch - bar);
  return { x: 0, y: bar, width, height };
}

function updateXcloudBounds(sess) {
  if (!sess || !sess.view) return;
  const b = getXcloudBounds();
  try { sess.view.setBounds(b); } catch (_e) { /* view may be destroyed */ }
}

function updateAllXcloudBounds() {
  for (const sess of xcloudSessions.values()) {
    updateXcloudBounds(sess);
  }
}

// Main-world script: monkey-patches RTCPeerConnection, polls stats, and posts
// them back to the preload via window.postMessage. Has to be a stringified
// IIFE because it runs in the page's own JS context (not Node), so it can't
// `require` anything. Guards against double-installation so re-injecting on
// every dom-ready is safe.
const MAIN_WORLD_STATS_SCRIPT = `(() => {
  if (window.__cerealXcloudInstalled) return;
  window.__cerealXcloudInstalled = true;

  const peers = new Set();
  let lastBytes = 0;
  let lastTs = 0;
  let lastState = '';

  const gameId = (() => {
    try {
      const m = (location.hash || '').match(/cereal-game-id=([^&]+)/);
      return m ? decodeURIComponent(m[1]) : '';
    } catch (_e) { return ''; }
  })();

  const Original = window.RTCPeerConnection;
  if (typeof Original === 'function') {
    const Wrapped = function(...args) {
      const pc = new Original(...args);
      peers.add(pc);
      pc.addEventListener('connectionstatechange', () => {
        if (pc.connectionState === 'closed' || pc.connectionState === 'failed') peers.delete(pc);
      });
      return pc;
    };
    Wrapped.prototype = Original.prototype;
    Object.setPrototypeOf(Wrapped, Original);
    try { window.RTCPeerConnection = Wrapped; } catch (_e) { /* read-only in some configs */ }
  }

  function post(payload) {
    try { window.postMessage(Object.assign({ __cerealXcloud: true, gameId }, payload), location.origin); }
    catch (_e) { /* ignore */ }
  }

  async function sampleStats() {
    if (peers.size === 0) return;
    let bytes = 0, fps = 0, rttMs = 0, packetsLost = 0, jitterMs = 0;
    for (const pc of peers) {
      try {
        const report = await pc.getStats(null);
        let inbound = null, candidatePair = null, remoteInbound = null;
        report.forEach((e) => {
          if (e.type === 'inbound-rtp' && e.kind === 'video') {
            if (!inbound || (e.bytesReceived || 0) > (inbound.bytesReceived || 0)) inbound = e;
          } else if (e.type === 'candidate-pair' && e.nominated && e.state === 'succeeded') {
            candidatePair = e;
          } else if (e.type === 'remote-inbound-rtp' && e.kind === 'video') {
            remoteInbound = e;
          }
        });
        if (inbound) {
          bytes += inbound.bytesReceived || 0;
          if (inbound.framesPerSecond) fps = Math.max(fps, inbound.framesPerSecond);
          packetsLost += inbound.packetsLost || 0;
          if (inbound.jitter) jitterMs = Math.max(jitterMs, Math.round(inbound.jitter * 1000));
        }
        if (candidatePair && candidatePair.currentRoundTripTime) {
          rttMs = Math.max(rttMs, Math.round(candidatePair.currentRoundTripTime * 1000));
        } else if (remoteInbound && remoteInbound.roundTripTime) {
          rttMs = Math.max(rttMs, Math.round(remoteInbound.roundTripTime * 1000));
        }
      } catch (_e) { /* peer may have closed */ }
    }
    const now = Date.now();
    let bitrateMbps = 0;
    if (lastTs > 0 && bytes > lastBytes) {
      const dtSec = (now - lastTs) / 1000;
      if (dtSec > 0.1) bitrateMbps = ((bytes - lastBytes) * 8) / dtSec / 1000000;
    }
    lastBytes = bytes;
    lastTs = now;
    post({ type: 'stats', bitrateMbps: Number(bitrateMbps.toFixed(2)), fps: Math.round(fps), rttMs, packetsLost, jitterMs });
  }

  function detectState() {
    let state = 'idle';
    const onPlayPath = /\\/play\\/(?:launch|games)\\//.test(location.pathname);
    if (onPlayPath) {
      state = 'connecting';
      const vids = document.querySelectorAll('video');
      for (const v of vids) {
        if (v.readyState >= 2 && !v.paused && v.videoWidth > 0 && v.videoHeight > 0) {
          state = 'streaming';
          break;
        }
      }
    }
    if (state !== lastState) {
      lastState = state;
      post({ type: 'state', state });
    }
  }

  function tick() {
    try { sampleStats(); } catch (_e) { /* ignore */ }
    try { detectState(); } catch (_e) { /* ignore */ }
  }

  setTimeout(tick, 600);
  setInterval(tick, 2000);
})();`;

function injectMainWorldStats(webContents, gameId) {
  if (!webContents || webContents.isDestroyed()) return;
  // Suppress the promise: executeJavaScript returns the script's return value
  // which is undefined here, and any rejection just means the page navigated
  // away mid-injection — harmless. Without the .catch a stray rejection
  // surfaces in the main process's "Unhandled Rejection" log.
  webContents.executeJavaScript(MAIN_WORLD_STATS_SCRIPT, true).catch(() => {});
  void gameId; // gameId is encoded in the URL fragment, used inside the script
}

function decorateUrlWithGameId(url, gameId) {
  if (!gameId) return url;
  // The preload reads `cereal-game-id` from the URL fragment. Using the fragment
  // (rather than a query param) leaves the request URL Microsoft sees
  // unchanged — they're sensitive to unexpected query strings on the play page.
  try {
    const sep = url.includes('#') ? '&' : '#';
    return url + sep + 'cereal-game-id=' + encodeURIComponent(gameId);
  } catch (_e) { return url; }
}

function startXcloudSession(gameId, url, title) {
  stopXcloudSession(gameId);

  // Storage strategy:
  //   - Auth cookies live on `persist:xcloud` so the user only signs in once.
  //   - Per-session ephemeral storage (localStorage / sessionStorage / cache)
  //     is cleared at start so a stale session from a previous run can't
  //     poison the next one. Mirrors the C# port's per-session WebView2
  //     user-data isolation without forcing re-auth.
  const xcloudSession = session.fromPartition('persist:xcloud');
  try {
    xcloudSession.clearStorageData({
      origin: 'https://www.xbox.com',
      storages: ['localstorage', 'sessionstorage', 'cachestorage', 'shadercache'],
    }).catch(() => { /* best-effort */ });
  } catch (_e) { /* ignore */ }

  const view = new WebContentsView({
    webPreferences: {
      session: xcloudSession,
      contextIsolation: true,
      // Sandbox is left enabled (Cereal's default posture). The preload talks
      // to the main world via window.postMessage, with the main-world script
      // injected separately via executeJavaScript (see injectMainWorldStats).
      sandbox: true,
      preload: resolveXcloudPreload(),
    }
  });

  // Xbox Cloud Gaming requires Edge/Chrome user agent
  const ua = view.webContents.getUserAgent().replace(/Electron\/\S+\s*/, '') + ' Edg/120.0.0.0';
  view.webContents.setUserAgent(ua);

  ctx.mainWindow.contentView.addChildView(view);
  try { view.setVisible(false); } catch (_e) { /* ignore */ }

  const sess = {
    gameId,
    view,
    state: 'loading',
    startTime: Date.now(),
    title: title || 'Xbox Cloud Gaming',
    lastStats: null,
    lastTitle: null,
  };
  xcloudSessions.set(gameId, sess);

  updateXcloudBounds(sess);

  const finalUrl = decorateUrlWithGameId(url || 'https://www.xbox.com/play', gameId);
  view.webContents.loadURL(finalUrl);

  view.webContents.on('dom-ready', () => {
    if (sess.state === 'loading') {
      sess.state = 'connecting';
      sendStreamEvent(gameId, 'state', { state: 'connecting', platform: 'xbox' });
    }
    // Inject the WebRTC stats harness into the main world. Has to run each
    // dom-ready because xCloud is a SPA and *can* tear down its peer between
    // navigations; re-injecting is a no-op (the script guards against double
    // installation) and ensures fresh navigations get instrumented.
    try { injectMainWorldStats(view.webContents, gameId); }
    catch (e) { log.warn?.('xcloud', 'stats inject failed:', e?.message || e); }
  });

  view.webContents.on('did-fail-load', (_e, code, desc) => {
    sess.state = 'disconnected';
    sendStreamEvent(gameId, 'disconnected', { reason: desc, platform: 'xbox' });
  });

  sendStreamEvent(gameId, 'state', { state: 'connecting', platform: 'xbox' });
  ctx.sendToRenderer('tabs:opened', { id: gameId, title: title || 'Xbox Cloud Gaming', platform: 'xbox' });
  return sess;
}

function stopXcloudSession(gameId) {
  const sess = xcloudSessions.get(gameId);
  if (!sess) return false;

  // Mark as stopping to prevent re-entry
  if (sess._stopping) return false;
  sess._stopping = true;

  try {
    // 1. Remove from parent view immediately so the UI updates for the caller
    try {
      if (ctx.mainWindow && !ctx.mainWindow.isDestroyed()) {
        ctx.mainWindow.contentView.removeChildView(sess.view);
      }
    } catch (_e) { /* ok - may already be removed */ }

    // 2. Remove from sessions map synchronously
    xcloudSessions.delete(gameId);

    // 3. Notify renderer
    sendStreamEvent(gameId, 'disconnected', { reason: 'stopped', platform: 'xbox' });
    ctx.sendToRenderer('tabs:closed', { id: gameId });

    // Clear Discord Rich Presence — xCloud sessions don't have an exe to wait on,
    // so the launch path doesn't auto-clear. Match Chiaki behaviour and clear here.
    if (isDiscordEnabled()) clearDiscordPresence();

    // 4. Async cleanup: navigate to Xbox home to signal session end, then close
    if (sess.view?.webContents && !sess.view.webContents.isDestroyed()) {
      try { sess.view.webContents.loadURL('https://www.xbox.com/play'); } catch (_e) { /* ignore */ }
    }

    setTimeout(() => {
      // 5. Clear per-session ephemeral storage but PRESERVE cookies. The
      // previous implementation wiped cookies, which forced the user to
      // re-sign in on every launch — by far the worst UX hole in the xCloud
      // path. We keep auth durable while still scrubbing localStorage /
      // sessionStorage / cache to avoid stale stream-state leaking between
      // sessions (the very thing the C# WebView2 port isolates with separate
      // user-data dirs).
      if (sess.view?.webContents?.session && !sess.view.webContents.isDestroyed()) {
        try {
          sess.view.webContents.session.clearStorageData({
            origin: 'https://www.xbox.com',
            storages: ['localstorage', 'sessionstorage', 'cachestorage'],
          }).catch(() => {});
        } catch (_e) { /* ignore */ }
      }

      // 6. Close the webContents
      try {
        if (sess.view?.webContents && !sess.view.webContents.isDestroyed()) {
          sess.view.webContents.close();
        }
      } catch (_e) { /* ok — webContents may already be closed */ }

      sess.view = null;
      log.info('xcloud', `Session ${gameId} stopped gracefully`);
    }, 500);

    return true;
  } catch (e) {
    log.error('xcloud', 'Error stopping session:', e.message);
    // Force cleanup on error
    try { ctx.mainWindow?.contentView?.removeChildView(sess.view); } catch (_e) { /* best-effort */ }
    try { sess.view?.webContents?.close(); } catch (_e) { /* best-effort */ }
    xcloudSessions.delete(gameId);
    sendStreamEvent(gameId, 'disconnected', { reason: 'error', platform: 'xbox', error: e.message });
    return false;
  }
}

function getActiveXcloudSessions() {
  return Object.fromEntries(
    [...xcloudSessions].map(([gameId, sess]) => [gameId, { state: sess.state, platform: 'xbox', startTime: sess.startTime }])
  );
}

// ─── Preload → main IPC bridge ───────────────────────────────────────────────
// Listen once at module init for the three event channels emitted by
// preload-xcloud.js, then fan them out via the unified `chiaki:event`
// channel that the renderer already handles. We deliberately route through
// `chiaki:event` (not a new channel) so StreamOverlay's existing handler
// picks up xbox stats and title updates with no further changes.

let _ipcBridgeRegistered = false;
function registerXcloudIpcBridge() {
  if (_ipcBridgeRegistered) return;
  _ipcBridgeRegistered = true;

  ipcMain.on('xcloud:stats', (_event, payload) => {
    if (!payload || !payload.gameId) return;
    const sess = xcloudSessions.get(payload.gameId);
    if (!sess) return;
    sess.lastStats = payload;
    // Mirror chiaki-ng's session payload shape so the renderer's existing
    // StreamOverlay rendering (which reads `sess.quality.bitrate`,
    // `quality.fpsActual`, `quality.latencyMs`, `quality.packetLoss`) picks
    // up xCloud stats with no overlay-side changes required.
    sendStreamEvent(payload.gameId, 'stats', {
      platform: 'xbox',
      quality: {
        bitrate: payload.bitrateMbps,
        fpsActual: payload.fps,
        latencyMs: payload.rttMs,
        packetLoss: payload.packetsLost,
        jitter: payload.jitterMs,
      },
    });
  });

  ipcMain.on('xcloud:title', (_event, payload) => {
    if (!payload || !payload.gameId) return;
    const sess = xcloudSessions.get(payload.gameId);
    if (!sess) return;
    const title = (payload.title || '').trim();
    const productId = (payload.productId || '').trim();
    if (!title && !productId) return;
    // Avoid spamming when the title hasn't actually changed.
    const sig = title + '|' + productId;
    if (sess.lastTitle === sig) return;
    sess.lastTitle = sig;

    sendStreamEvent(payload.gameId, 'title', { platform: 'xbox', title, productId });

    // Mirror chiaki's behaviour: as soon as we know what's actually being
    // streamed, refresh Discord Rich Presence with the real title (the
    // user's tab in Cereal may have been a generic "Xbox Cloud Gaming"
    // session if they navigated mid-stream).
    if (title && isDiscordEnabled()) {
      try { setDiscordPresence(title, 'xbox'); } catch (_e) { /* ignore */ }
    }
  });

  ipcMain.on('xcloud:state', (_event, payload) => {
    if (!payload || !payload.gameId) return;
    const sess = xcloudSessions.get(payload.gameId);
    if (!sess) return;
    const next = payload.state;
    if (!next || next === sess.state) return;
    sess.state = next;
    sendStreamEvent(payload.gameId, 'state', { platform: 'xbox', state: next });
  });
}

registerXcloudIpcBridge();

module.exports = {
  xcloudSessions,
  updateAllXcloudBounds,
  startXcloudSession,
  stopXcloudSession,
  getActiveXcloudSessions,
};
