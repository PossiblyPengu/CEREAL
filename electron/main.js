const { app, BrowserWindow, ipcMain, dialog, shell, session, Tray, Menu, nativeImage, net, protocol } = require('electron');
const path = require('path');
const fs = require('fs');

// ─── Hardware acceleration ────────────────────────────────────────────────────
// Must be called before app is ready.
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('enable-hardware-overlays', 'single-fullscreen,single-on-top,underlay');
app.commandLine.appendSwitch('enable-features', 'VaapiVideoDecodeLinuxGL,VaapiVideoEncoder,CanvasOopRasterization,UseSkiaRenderer');

// ─── Custom protocol for serving local images to the renderer ─────────────────
// Registered before app.ready so Chromium treats it as a standard scheme.
protocol.registerSchemesAsPrivileged([
  { scheme: 'local-image', privileges: { standard: false, supportFetchAPI: true, stream: true, bypassCSP: false } }
]);
// ─── Secure Credential Store (extracted to modules/credentials.js) ────────────
const { safeStore } = require('./modules/credentials');
const { spawn } = require('child_process');
const os = require('os');
const { autoUpdater } = require('electron-updater');


// ─── Constants (extracted to modules/constants.js) ────────────────────────────
const { ACCOUNT_SECRET_FIELDS } = require('./modules/constants');
const log = require('./modules/logger');

// ─── Account Management (extracted to modules/accounts.js) ────────────────────
const { detachAccountSecrets, registerAccountIpcHandlers } = require('./modules/accounts');

// ─── Discord Rich Presence (extracted to modules/discord.js) ──────────────────
const { connectDiscord, disconnectDiscord, setDiscordPresence, isDiscordEnabled, getDiscordStatus } = require('./modules/discord');
ipcMain.handle('discord:status', () => getDiscordStatus());


// ─── Cover Image Caching (extracted to modules/covers.js) ─────────────────────
const { getCoversDir, cleanupFile, enqueueCoverFetch } = require('./modules/covers');

// ─── Chiaki + Win32 Embed (extracted to modules/chiaki.js) ────────────────────
const { chiakiSessions, resolveChiakiExe, buildChiakiArgs, startChiakiSession, sendEmbedBoundsToAll, autoSetupChiakiIfMissing, registerChiakiIpcHandlers } = require('./modules/chiaki');

// ─── xCloud (extracted to modules/xcloud.js) ─────────────────────────────────
const { xcloudSessions, updateAllXcloudBounds, startXcloudSession } = require('./modules/xcloud');

// ─── Database (extracted to modules/database.js) ─────────────────────────────
const { DB_PATH, loadDB, saveDB, flushDB } = require('./modules/database');
let db = null;

// ─── Window ───────────────────────────────────────────────────────────────────
let mainWindow;
let trayIcon = null;
let isQuitting = false;

function sendToRenderer(channel, ...args) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, ...args);
  }
}

function toggleDevTools() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const contents = mainWindow.webContents;
  if (!contents) return;
  if (contents.isDevToolsOpened()) contents.closeDevTools();
  else contents.openDevTools({ mode: 'detach' });
}

function createWindow() {
  // Restore previous window bounds if present and allowed by settings
  const savedBounds = (db && db.settings && db.settings.rememberWindowBounds && db.settings.windowBounds) ? db.settings.windowBounds : null;
  const winOpts = {
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    frame: false,
    show: true,
    backgroundColor: '#0a0a0f',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  };
  if (savedBounds) {
    if (typeof savedBounds.x === 'number' && typeof savedBounds.y === 'number') {
      winOpts.x = savedBounds.x;
      winOpts.y = savedBounds.y;
    }
    if (typeof savedBounds.width === 'number' && typeof savedBounds.height === 'number') {
      winOpts.width = savedBounds.width;
      winOpts.height = savedBounds.height;
    }
  }

  mainWindow = new BrowserWindow(winOpts);
  if (savedBounds && savedBounds.isMaximized) {
    try { mainWindow.maximize(); } catch { /* ignore */ }
  }

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  if (process.env.CEREAL_DEVTOOLS === '1') {
    mainWindow.webContents.once('did-finish-load', () => {
      try { toggleDevTools(); } catch (e) { console.error('Auto DevTools failed:', e.message); }
    });
  }

  // signalReady is kept for future use but window is already visible
  ipcMain.on('window:ready', () => {});

  // Security: prevent main window from navigating to external URLs
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const devServer = process.env.VITE_DEV_SERVER_URL;
    if (devServer && url.startsWith(devServer)) return;
    if (url.startsWith('file://')) return;
    event.preventDefault();
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    const toggleDevtools = (input.control && input.shift && input.code === 'KeyI') || input.code === 'F12';
    if (!toggleDevtools) return;
    event.preventDefault();
    toggleDevTools();
  });

  // Track window bounds changes to reposition embedded chiaki windows
  mainWindow.on('resize',  onWindowBoundsChanged);
  mainWindow.on('move',    onWindowBoundsChanged);
  mainWindow.on('restore', onWindowBoundsChanged);
  mainWindow.on('maximize', onWindowBoundsChanged);
  mainWindow.on('unmaximize', onWindowBoundsChanged);
  mainWindow.on('close', (e) => {
    saveWindowBounds();
    if (!isQuitting && db && db.settings && db.settings.closeToTray) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('minimize', () => {
    for (const session of chiakiSessions.values()) {
      if (session.embedProcess && !session.embedProcess.killed) {
        try { session.embedProcess.stdin.write('hide\n'); } catch { /* ok */ }
      }
    }
    for (const sess of xcloudSessions.values()) {
      try { sess.view.setVisible(false); } catch { /* ok */ }
    }
  });

  mainWindow.on('focus', () => {
    for (const session of chiakiSessions.values()) {
      if (session.embedded && session.embedProcess && !session.embedProcess.killed) {
        try { session.embedProcess.stdin.write('show\n'); } catch { /* ok */ }
      }
    }
    for (const sess of xcloudSessions.values()) {
      try { sess.view.setVisible(true); } catch { /* ok */ }
    }
  });
}

// ─── Single Instance Lock ─────────────────────────────────────────────────────
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) { app.quit(); } else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (!mainWindow.isVisible()) mainWindow.show();
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

function destroyTray() {
  if (!trayIcon) return;
  try { trayIcon.destroy(); } catch { /* ok */ }
  trayIcon = null;
}

function createTray() {
  if (trayIcon) return;
  // 16x16 simple cereal-gold icon
  const img = nativeImage.createFromDataURL('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAY0lEQVR42mP4z8BQz0BAwAADTAxEAqpawMRAAYAa8J+BgQEkTbQBjFiEGYgxgJGBgYERqoERp9OhhjBS0wsoF7AwkOYFcn0BdQHRvsBnAMVeGIAGdCAL4AFixu8FBgYGBgC3+y+Mfb/haQAAAABJRU5ErkJggg==');
  trayIcon = new Tray(img);
  trayIcon.setToolTip('Cereal Launcher');
  const contextMenu = Menu.buildFromTemplate([
    { label: 'Show Cereal', click: () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } } },
    { type: 'separator' },
    { label: 'Quit', click: () => { isQuitting = true; app.quit(); } },
  ]);
  trayIcon.setContextMenu(contextMenu);
  trayIcon.on('click', () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } });
}

app.whenReady().then(() => {
  // Register protocol handler for serving local images to the renderer
  // (file:// URLs are blocked when renderer loads from http:// in dev mode)
  protocol.handle('local-image', (request) => {
    // URL format: local-image:///C:/path/to/file.jpg
    let filePath = decodeURIComponent(new URL(request.url).pathname);
    // On Windows, strip leading slash from /C:/...
    if (process.platform === 'win32' && filePath.startsWith('/')) filePath = filePath.slice(1);
    // Security: only allow files from the covers directory
    const coversDir = getCoversDir();
    const resolved = path.resolve(filePath);
    if (!resolved.startsWith(coversDir)) {
      return new Response('Forbidden', { status: 403 });
    }
    return net.fetch('file:///' + resolved.replace(/\\/g, '/'));
  });

  db = loadDB();
  // Populate shared context for extracted modules
  const ctx = require('./modules/context');
  ctx.db = db;
  ctx.safeStore = safeStore;
  ctx.saveDB = saveDB;
  ctx.flushDB = () => flushDB(db);
  ctx.sendToRenderer = sendToRenderer;

  if (db.accounts && typeof db.accounts === 'object') {
    let changed = false;
    for (const platform of Object.keys(db.accounts)) {
      const acct = db.accounts[platform];
      if (acct && ACCOUNT_SECRET_FIELDS.some(k => acct[k] != null)) {
        detachAccountSecrets(platform, { save: false });
        changed = true;
      }
    }
    if (changed) saveDB(db);
  }

  // ─── One-time migrations (gated by version so they only run once) ────────────
  const CURRENT_MIGRATION = 2;
  const lastMigration = (db.settings && db.settings._migrationVersion) || 0;
  if (lastMigration < 1) {
    // Migration 1: clear references to corrupt cover files (< 1KB) from old redirect bug
    let coversCleaned = 0;
    for (const game of (db.games || [])) {
      if (game.localCoverPath) {
        try {
          if (!fs.existsSync(game.localCoverPath) || fs.statSync(game.localCoverPath).size < 1024) {
            cleanupFile(game.localCoverPath);
            game.localCoverPath = null;
            coversCleaned++;
          }
        } catch { game.localCoverPath = null; coversCleaned++; }
      }
      if (game.localHeaderPath) {
        try {
          if (!fs.existsSync(game.localHeaderPath) || fs.statSync(game.localHeaderPath).size < 1024) {
            cleanupFile(game.localHeaderPath);
            game.localHeaderPath = null;
            coversCleaned++;
          }
        } catch { game.localHeaderPath = null; coversCleaned++; }
      }
    }
    if (coversCleaned > 0) console.log('[CoverFetcher] Cleaned', coversCleaned, 'corrupt cover references');
    // Purge small corrupt files from covers directory
    try {
      const coversDir = getCoversDir();
      let purged = 0;
      for (const f of fs.readdirSync(coversDir)) {
        const fp = path.join(coversDir, f);
        try { if (fs.statSync(fp).size < 1024) { fs.unlinkSync(fp); purged++; } } catch (e) { console.error('Error purging file:', e.message); }
      }
      if (purged > 0) console.log('[CoverFetcher] Purged', purged, 'corrupt files from covers directory');
    } catch (e) { console.error('Error reading covers directory:', e.message); }
  }
  if (lastMigration < 2) {
    // Migration 2: backfill headerUrl for Steam games
    let backfilled = 0;
    for (const game of (db.games || [])) {
      if (game.platform === 'steam' && game.platformId && !game.headerUrl) {
        game.headerUrl = `https://shared.steamstatic.com/store_item_assets/steam/apps/${game.platformId}/header.jpg`;
        backfilled++;
      }
    }
    if (backfilled > 0) console.log('[Migration] Backfilled', backfilled, 'Steam header URLs');
  }
  if (lastMigration < CURRENT_MIGRATION) {
    db.settings = db.settings || {};
    db.settings._migrationVersion = CURRENT_MIGRATION;
    saveDB(db);
  }

  // Re-enqueue cover downloads for any game that has a coverUrl/headerUrl but no local file
  setTimeout(() => {
    let requeued = 0;
    for (const game of (db.games || [])) {
      const needsCover = !game.localCoverPath && (game.coverUrl || game.headerUrl || (game.screenshots && game.screenshots.length));
      const needsHeader = !game.localHeaderPath && game.headerUrl;
      if (needsCover || needsHeader) {
        enqueueCoverFetch(game.id);
        requeued++;
      }
    }
    if (requeued > 0) console.log('[CoverFetcher] Re-enqueued', requeued, 'games for cover download');
  }, 3000);
  // Security: restrict permissions requested by renderer
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    const allowed = ['clipboard-read', 'clipboard-sanitized-write', 'fullscreen'];
    callback(allowed.includes(permission));
  });

  // Security: Content Security Policy
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self'",
          "script-src 'self' 'unsafe-inline'",
          "style-src 'self' 'unsafe-inline'",
          "img-src 'self' data: local-image: https: http:",
          "font-src 'self' data:",
          "connect-src 'self' https://*.steampowered.com https://*.steamstatic.com https://store.steampowered.com https://api.steampowered.com https://steamcdn-a.akamaihd.net https://*.steamgriddb.com https://*.gog.com https://*.epicgames.com https://*.xbox.com https://*.xboxlive.com https://*.wikipedia.org https://*.wikidata.org https://*.wikimedia.org https://*.duckduckgo.com https://localhost ws://localhost wss://localhost",
        ].join('; '),
      },
    });
  });

  createWindow();
  ctx.mainWindow = mainWindow;
  if (db.settings && db.settings.closeToTray) createTray();

  // DevTools shortcuts handled by before-input-event in createWindow (app-scoped, not global)

  // Start minimized if enabled
  if (db.settings && db.settings.startMinimized) {
    mainWindow.hide();
  }

  // Auto-connect Discord if enabled — delayed so it doesn't slow window creation
  if (isDiscordEnabled()) setTimeout(connectDiscord, 8000);

  // Auto-download chiaki-ng if missing (first run)
  setTimeout(autoSetupChiakiIfMissing, 6000);

  // Auto-update: check after a short delay
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch(() => {});
  }, 5000);

  // Forward update events to renderer
  const updateEvents = ['checking-for-update', 'update-available', 'update-not-available', 'download-progress', 'update-downloaded', 'error'];
  for (const evt of updateEvents) {
    autoUpdater.on(evt, (data) => {
      sendToRenderer('update:event', { type: evt, data: evt === 'error' ? (data && data.message || String(data)) : data });
    });
  }
});

app.on('window-all-closed', () => {
  disconnectDiscord();
  // Don't quit if close-to-tray is active — the window is just hidden
  if (db && db.settings && db.settings.closeToTray) return;
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  isQuitting = true;
  try { saveWindowBounds(); } catch { /* ok */ }
  flushDB(db);
});

app.on('will-quit', () => {
  // No global shortcuts registered — DevTools handled via before-input-event
  // Cleanup any active xcloud sessions
  try {
    for (const [_gameId, sess] of xcloudSessions) {
      try { mainWindow?.contentView?.removeChildView(sess.view); } catch { log.debug('xcloud', 'cleanup removeChildView failed'); }
      try { sess.view?.webContents?.close(); } catch { log.debug('xcloud', 'cleanup webContents close failed'); }
    }
    xcloudSessions.clear();
  } catch { log.debug('xcloud', 'session cleanup error'); }
});

// ─── Window Controls ──────────────────────────────────────────────────────────
ipcMain.handle('window:minimize', () => mainWindow.minimize());
ipcMain.handle('window:maximize', () => {
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
  return mainWindow.isMaximized();
});
ipcMain.handle('window:close', () => mainWindow.close());
ipcMain.handle('window:fullscreen', () => { mainWindow.setFullScreen(!mainWindow.isFullScreen()); return mainWindow.isFullScreen(); });
ipcMain.handle('window:isFullscreen', () => mainWindow.isFullScreen());
ipcMain.handle('shell:openExternal', (event, url) => {
  try {
    const parsed = new URL(url);
    const safeProtocols = ['http:', 'https:', 'mailto:', 'steam:', 'epicgames:', 'com.epicgames.launcher:', 'goggalaxy:', 'origin:', 'origin2:', 'uplay:', 'battlenet:', 'xbox:', 'msxbox:', 'ms-xbl-multiplayer:'];
    if (!safeProtocols.includes(parsed.protocol)) return { error: 'Blocked protocol: ' + parsed.protocol };
  } catch { return { error: 'Invalid URL' }; }
  return shell.openExternal(url);
});
ipcMain.handle('system:getSpecs', async () => {
  const ramGb = Math.round(os.totalmem() / (1024 * 1024 * 1024));
  const cpus = os.cpus();
  const cpuCount = cpus.length;
  const cpuModel = cpus[0]?.model?.trim() || '';
  let gpuName = '';
  try {
    const gpuInfo = await app.getGPUInfo('basic');
    const gpu = gpuInfo?.gpuDevice?.[0];
    if (gpu?.description) gpuName = gpu.description;
  } catch (e) { log.debug('system', 'GPU info unavailable', e); }
  return { ramGb, cpuCount, cpuModel, gpuName };
});

// ─── Stream embed bounds tracking ─────────────────────────────────────────────
let _embedResizeTimer = null;
let _saveBoundsTimer = null;
function scheduleSaveWindowBounds() {
  clearTimeout(_saveBoundsTimer);
  _saveBoundsTimer = setTimeout(saveWindowBounds, 500);
}

function saveWindowBounds() {
  try {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    // Respect user preference for remembering window bounds
    if (db && db.settings && db.settings.rememberWindowBounds === false) return;
    const isMax = mainWindow.isMaximized ? mainWindow.isMaximized() : false;
    const bounds = isMax ? (db.settings && db.settings.windowBounds ? db.settings.windowBounds : {}) : mainWindow.getBounds();
    db.settings = db.settings || {};
    db.settings.windowBounds = {
      x: bounds.x || 0,
      y: bounds.y || 0,
      width: bounds.width || 1280,
      height: bounds.height || 800,
      isMaximized: !!isMax
    };
    saveDB(db);
  } catch (e) { console.error('Failed saving window bounds', e && e.message); }
}

function onWindowBoundsChanged() {
  clearTimeout(_embedResizeTimer);
  _embedResizeTimer = setTimeout(() => {
    sendEmbedBoundsToAll();
    updateAllXcloudBounds();
  }, 50);
  scheduleSaveWindowBounds();
}

// ─── Game CRUD + Categories (extracted to modules/gameCrud.js) ────────────────
const { registerGameCrudIpcHandlers } = require('./modules/gameCrud');
registerGameCrudIpcHandlers();

// ─── Key Storage & Validation (extracted to modules/keys.js) ──────────────────
const { registerKeysIpcHandlers } = require('./modules/keys');
registerKeysIpcHandlers();

// ─── Metadata IPC (extracted to modules/metadataIpc.js) ───────────────────────
const { registerMetadataIpcHandlers } = require('./modules/metadataIpc');
registerMetadataIpcHandlers();

// ─── Launch Helpers (extracted to modules/launcher.js) ────────────────────────
const { normalizePlatform, openInPlatformClient } = require('./modules/launcher');

ipcMain.handle('games:launch', async (event, id) => {
  const game = db.games.find(g => g.id === id);
  if (!game) return { success: false, error: 'Game not found' };

  try {
    let launchPath = game.executablePath;

    // Platform-specific launch
    if (game.platform === 'psremote' || game.platform === 'psn') {
      // Launch via integrated chiaki-ng session manager
      const chiakiExe = resolveChiakiExe(launchPath);
      if (!chiakiExe) {
        return { success: false, error: 'chiaki-ng not found. It should download automatically — try again in a moment, or check Settings > PlayStation.' };
      }

      const chiakiConfig = db.chiakiConfig || {};
      const consoles = chiakiConfig.consoles || [];

      // Supplement missing chiaki fields from stored console config
      let effectiveGame = game;
      if (!game.chiakiHost || !game.chiakiRegistKey) {
        const matched = game.chiakiHost
          ? consoles.find(c => c.host === game.chiakiHost)
          : consoles.find(c => c.registKey && c.morning);
        if (matched) {
          effectiveGame = {
            ...game,
            chiakiHost:      game.chiakiHost      || matched.host,
            chiakiNickname:  game.chiakiNickname  || matched.nickname || '',
            chiakiProfile:   game.chiakiProfile   || matched.profile  || '',
            chiakiRegistKey: game.chiakiRegistKey || matched.registKey || '',
            chiakiMorning:   game.chiakiMorning   || matched.morning  || '',
          };
        } else if (!game.chiakiHost) {
          return { success: false, error: 'No registered PlayStation console found. Open Remote Play to add and register a console first.' };
        }
      }

      const args = buildChiakiArgs(effectiveGame, chiakiConfig);
      startChiakiSession(id, chiakiExe, args);
    } else if (game.platform === 'xbox') {
      // Xbox — embed xCloud in-app or launch via Xbox app
      const url = game.streamUrl || 'https://www.xbox.com/play';
      startXcloudSession(id, url);
    } else if (['steam', 'epic', 'gog', 'ea', 'battlenet', 'ubisoft', 'itchio'].includes(normalizePlatform(game.platform))) {
      const openRes = await openInPlatformClient(game, 'play');
      if (!openRes.success) return openRes;
    } else if (launchPath && fs.existsSync(launchPath)) {
      const gameDir = path.dirname(launchPath);
      spawn(launchPath, [], { cwd: gameDir, detached: true, stdio: 'ignore' }).unref();
    } else {
      return { success: false, error: 'Executable not found' };
    }

    // Track playtime start (skip for streaming platforms — not tracked)
    if (!['psn', 'psremote', 'xbox'].includes(game.platform)) {
      game.lastPlayed = new Date().toISOString();
      saveDB(db);
    }

    // Minimize window on launch if enabled
    if (db.settings && db.settings.minimizeOnLaunch && mainWindow) {
      mainWindow.minimize();
    }

    // Discord Rich Presence
    if (isDiscordEnabled()) {
      connectDiscord();
      setDiscordPresence(game.name, game.platform);
    }

    return { success: true, lastPlayed: game.lastPlayed };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('games:install', async (event, id) => {
  const game = db.games.find(g => g.id === id);
  if (!game) return { success: false, error: 'Game not found' };

  try {
    if (normalizePlatform(game.platform) === 'psn') {
      return { success: false, error: 'Install is not supported for Remote Play titles' };
    }
    if (normalizePlatform(game.platform) === 'custom') {
      return { success: false, error: 'Custom games must be installed manually' };
    }
    return await openInPlatformClient(game, 'install');
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('games:openInClient', async (event, id) => {
  const game = db.games.find(g => g.id === id);
  if (!game) return { success: false, error: 'Game not found' };
  try {
    return await openInPlatformClient(game, 'client');
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ─── File Picker ──────────────────────────────────────────────────────────────
ipcMain.handle('dialog:pickExecutable', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [
      { name: 'Executables', extensions: ['exe', 'bat', 'cmd', 'lnk'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  });
  if (!result.canceled && result.filePaths.length > 0) {
    return result.filePaths[0];
  }
  return null;
});

ipcMain.handle('dialog:pickImage', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [
      { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] }
    ]
  });
  if (!result.canceled && result.filePaths.length > 0) {
    // Copy image to app data
    const src = result.filePaths[0];
    const ext = path.extname(src);
    const destName = `cover_${Date.now()}${ext}`;
    const destDir = path.join(app.getPath('userData'), 'covers');
    if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
    const dest = path.join(destDir, destName);
    fs.copyFileSync(src, dest);
    return dest;
  }
  return null;
});

// ─── Detection + Playtime (extracted to modules/detectionIpc.js) ──────────────
const { registerDetectionIpcHandlers } = require('./modules/detectionIpc');
registerDetectionIpcHandlers();

// ─── Settings (extracted to modules/settings.js) ─────────────────────────────
const { registerSettingsIpcHandlers } = require('./modules/settings');
registerSettingsIpcHandlers({ createTray, destroyTray, DB_PATH });

// ─── Auto-Update ──────────────────────────────────────────────────────────────
ipcMain.handle('update:check', () => {
  return autoUpdater.checkForUpdates().catch((err) => ({ error: err.message }));
});
ipcMain.handle('update:install', () => {
  autoUpdater.quitAndInstall();
});

// ─── Platform Account IPC Handlers (extracted to modules/accounts.js) ─────────
registerAccountIpcHandlers();

// ─── Chiaki IPC Handlers (extracted to modules/chiaki.js) ─────────────────────
registerChiakiIpcHandlers();

// ─── xCloud + Media (extracted to modules/media.js) ───────────────────────────
const { registerMediaIpcHandlers } = require('./modules/media');
registerMediaIpcHandlers();


