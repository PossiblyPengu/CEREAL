// Window controls + shell helpers exposed to the renderer.
//
// All handlers operate on the main window via the shared context. Shell helpers
// validate inputs to prevent renderer-controlled URLs/paths from reaching
// `shell.openExternal` / `shell.openPath` unchecked.

const { ipcMain, shell } = require('electron');
const ctx = require('./context');

// Protocols that we'll hand off to the OS via shell.openExternal. Anything
// outside this set (especially `file:`, `javascript:`, `data:`) is blocked.
const SAFE_OPEN_EXTERNAL_PROTOCOLS = [
  'http:', 'https:', 'mailto:',
  'steam:', 'epicgames:', 'com.epicgames.launcher:', 'goggalaxy:',
  'origin:', 'origin2:', 'uplay:', 'battlenet:',
  'xbox:', 'msxbox:', 'ms-xbl-multiplayer:',
];

function registerWindowControlIpc() {
  ipcMain.handle('window:minimize', () => ctx.mainWindow?.minimize());
  ipcMain.handle('window:maximize', () => {
    const w = ctx.mainWindow;
    if (!w) return false;
    if (w.isMaximized()) w.unmaximize();
    else w.maximize();
    return w.isMaximized();
  });
  ipcMain.handle('window:close', () => ctx.mainWindow?.close());
  ipcMain.handle('window:fullscreen', () => {
    const w = ctx.mainWindow;
    if (!w) return false;
    w.setFullScreen(!w.isFullScreen());
    return w.isFullScreen();
  });
  ipcMain.handle('window:isFullscreen', () => ctx.mainWindow?.isFullScreen() ?? false);
}

function registerShellIpc() {
  ipcMain.handle('shell:openExternal', (_event, url) => {
    try {
      const parsed = new URL(url);
      if (!SAFE_OPEN_EXTERNAL_PROTOCOLS.includes(parsed.protocol)) {
        return { error: 'Blocked protocol: ' + parsed.protocol };
      }
    } catch (_e) {
      return { error: 'Invalid URL' };
    }
    return shell.openExternal(url);
  });

  ipcMain.handle('shell:openPath', async (_event, p) => {
    if (!p || typeof p !== 'string') return { error: 'Invalid path' };
    // Accept either a plain path or a file:/// URL.
    let normalized = p;
    if (normalized.startsWith('file:///')) {
      try {
        normalized = decodeURI(normalized.replace(/^file:\/\//, ''));
        if (process.platform === 'win32' && normalized.startsWith('/')) normalized = normalized.slice(1);
      } catch (_e) { /* ignore */ }
    }
    try {
      const res = await shell.openPath(normalized);
      if (res) return { error: res };
      return { success: true };
    } catch (e) {
      return { error: e && e.message ? e.message : 'open failed' };
    }
  });

  /**
   * Reveals a file in the OS file manager (Windows Explorer / Finder / Files)
   * with the item selected. Used by the right-click context menu on game cards.
   */
  ipcMain.handle('shell:showInFolder', (_event, p) => {
    if (!p || typeof p !== 'string') return { error: 'Invalid path' };
    let normalized = p;
    if (normalized.startsWith('file:///')) {
      try {
        normalized = decodeURI(normalized.replace(/^file:\/\//, ''));
        if (process.platform === 'win32' && normalized.startsWith('/')) normalized = normalized.slice(1);
      } catch (_e) { /* ignore */ }
    }
    try {
      shell.showItemInFolder(normalized);
      return { success: true };
    } catch (e) {
      return { error: e && e.message ? e.message : 'show failed' };
    }
  });
}

function registerWindowIpc() {
  registerWindowControlIpc();
  registerShellIpc();
}

module.exports = { registerWindowIpc, registerWindowControlIpc, registerShellIpc };
