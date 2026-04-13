// ─── Native SMTC media info + xCloud IPC handlers ────────────────────────────
const { ipcMain } = require('electron');
const { startXcloudSession, stopXcloudSession, getActiveXcloudSessions } = require('./xcloud');

// Native SMTC addon - lazy loaded
let smtcNative = null;
function getSmtcNative() {
  if (!smtcNative) {
    try {
      smtcNative = require('../native/smtc');
      console.log('[media] native addon loaded');
    } catch (e) {
      console.log('[media] failed to load native addon:', e.message);
    }
  }
  return smtcNative;
}

function registerMediaIpcHandlers() {
  // ─── xCloud IPC handlers ────────────────────────────────────────────────────
  ipcMain.handle('xcloud:startDirect', (_event, { url }) => {
    try {
      startXcloudSession('xbox:cloud', url || 'https://www.xbox.com/play');
      return { success: true, sessionKey: 'xbox:cloud' };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('xcloud:start', (_event, { gameId, url }) => {
    try {
      startXcloudSession(gameId, url);
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('xcloud:stop', (_event, gameId) => {
    return { success: stopXcloudSession(gameId) };
  });

  ipcMain.handle('xcloud:getSessions', () => {
    return getActiveXcloudSessions();
  });

  // ─── Media IPC handlers ─────────────────────────────────────────────────────
  ipcMain.handle('media:getInfo', async () => {
    const smtc = getSmtcNative();
    if (!smtc) return {};

    try {
      const info = await smtc.getMediaInfo();
      console.log('[media] native result:', info);

      if (info.error) {
        console.log('[media] error:', info.error);
        return {};
      }

      return {
        title: info.title || '',
        artist: info.artist || '',
        album: info.album || '',
        thumbnail: info.thumbnail || '',
        playing: info.playing,
        position: Math.floor(info.position || 0),
        duration: Math.floor(info.duration || 0)
      };
    } catch (e) {
      console.log('[media] exception:', e.message);
      return {};
    }
  });

  ipcMain.handle('media:control', async (_event, action) => {
    const smtc = getSmtcNative();
    if (!smtc) return false;

    try {
      await smtc.sendMediaKey(action);
      return true;
    } catch (e) {
      console.log('[media] control error:', e.message);
      return false;
    }
  });
}

module.exports = { registerMediaIpcHandlers };
