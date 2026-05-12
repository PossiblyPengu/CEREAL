// ─── xCloud (Xbox Cloud Gaming) WebContentsView Embedding ────────────────────
const { WebContentsView, session } = require('electron');
const ctx = require('../core/context');
const { CONTROL_BAR_HEIGHT } = require('../core/constants');
const log = require('../core/logger');
const { clearDiscordPresence, isDiscordEnabled } = require('./discord');

const xcloudSessions = new Map(); // gameId -> { view, state, startTime }

// Unified stream event channel (shared with chiaki.js — renderer distinguishes by 'platform' field)
function sendStreamEvent(gameId, type, data) {
  ctx.sendToRenderer('chiaki:event', { gameId, type, ...data });
}

function getXcloudBounds() {
  // Same area as chiaki (full content minus 40px bar) but in CSS/logical pixels
  // since WebContentsView.setBounds uses logical pixels
  const [cw, ch] = ctx.mainWindow ? ctx.mainWindow.getContentSize() : [1280, 720];
  return { x: 0, y: CONTROL_BAR_HEIGHT, width: cw, height: Math.max(1, ch - CONTROL_BAR_HEIGHT) };
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
      sandbox: true,
    }
  });

  // Xbox Cloud Gaming requires Edge/Chrome user agent
  const ua = view.webContents.getUserAgent().replace(/Electron\/\S+\s*/, '') + ' Edg/120.0.0.0';
  view.webContents.setUserAgent(ua);

  ctx.mainWindow.contentView.addChildView(view);
  try { view.setVisible(false); } catch (_e) { /* ignore */ }

  const sess = { gameId, view, state: 'loading', startTime: Date.now() };
  xcloudSessions.set(gameId, sess);

  updateXcloudBounds(sess);

  view.webContents.loadURL(url || 'https://www.xbox.com/play');

  view.webContents.on('dom-ready', () => {
    sess.state = 'streaming';
    sendStreamEvent(gameId, 'state', { state: 'streaming', platform: 'xbox' });
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
      // 5. Clear session storage and cookies for clean state next time
      if (sess.view?.webContents?.session && !sess.view.webContents.isDestroyed()) {
        try {
          sess.view.webContents.session.clearStorageData({
            origin: 'https://www.xbox.com',
            storages: ['cookies', 'localstorage', 'sessionstorage', 'cachestorage']
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

module.exports = {
  xcloudSessions,
  updateAllXcloudBounds,
  startXcloudSession,
  stopXcloudSession,
  getActiveXcloudSessions,
};
