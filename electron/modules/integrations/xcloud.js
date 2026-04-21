// ─── xCloud (Xbox Cloud Gaming) WebContentsView Embedding ────────────────────
const { WebContentsView, session } = require('electron');
const ctx = require('../core/context');
const { CONTROL_BAR_HEIGHT } = require('../core/constants');
const log = require('../core/logger');

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

  const view = new WebContentsView({
    webPreferences: {
      session: session.fromPartition('persist:xcloud'),
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
