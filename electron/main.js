const { app, BrowserWindow, ipcMain, dialog, shell, session, Tray, Menu, nativeImage, net, protocol, safeStorage, clipboard } = require('electron');
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
// ─────────────────────────────────────────────────────────────────────────────
// Secure credential store using Electron's safeStorage (replaces keytar)
const credStorePath = () => path.join(app.getPath('userData'), 'credentials.json');
function loadCredStore() {
  try { return JSON.parse(fs.readFileSync(credStorePath(), 'utf-8')); } catch { return {}; }
}
function saveCredStore(store) {
  const target = credStorePath();
  const tmp = target + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2), 'utf-8');
  fs.renameSync(tmp, target);
}
const safeStore = {
  setPassword(service, account, secret) {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Encryption not available');
    const store = loadCredStore();
    const key = `${service}/${account}`;
    store[key] = safeStorage.encryptString(secret).toString('base64');
    saveCredStore(store);
  },
  getPassword(service, account) {
    const store = loadCredStore();
    const key = `${service}/${account}`;
    if (!store[key]) return null;
    return safeStorage.decryptString(Buffer.from(store[key], 'base64'));
  },
  deletePassword(service, account) {
    const store = loadCredStore();
    const key = `${service}/${account}`;
    if (!store[key]) return false;
    delete store[key];
    saveCredStore(store);
    return true;
  }
};
const { spawn } = require('child_process');
const crypto = require('crypto');
const os = require('os');
const dgram = require('dgram');
const { autoUpdater } = require('electron-updater');
const providers = require(path.join(__dirname, 'providers'));

// ─── Constants (extracted to modules/constants.js) ────────────────────────────
const { CONTROL_BAR_HEIGHT, ALLOWED_KEY_SERVICES, CHIAKI_SYSTEM_PATHS, ACCOUNT_SECRET_FIELDS } = require('./modules/constants');

// ─── Account Management (extracted to modules/accounts.js) ────────────────────
const { detachAccountSecrets, registerAccountIpcHandlers } = require('./modules/accounts');

// ─── Discord Rich Presence (extracted to modules/discord.js) ──────────────────
const { connectDiscord, disconnectDiscord, setDiscordPresence, clearDiscordPresence, isDiscordEnabled, getDiscordStatus } = require('./modules/discord');
ipcMain.handle('discord:status', () => getDiscordStatus());

// ─── HTTP helpers ─────────────────────────────────────────────────────────────
const { httpGetJson } = require('./providers/http');

// ─── Cover Image Caching (extracted to modules/covers.js) ─────────────────────
const { getCoversDir, cleanupFile, enqueueCoverFetch } = require('./modules/covers');

// ─── Chiaki + Win32 Embed (extracted to modules/chiaki.js) ────────────────────
const { getChiakiDir, getBundledChiakiExe, getBundledChiakiVersion, chiakiSessions, resolveChiakiExe, buildChiakiArgs, startChiakiSession, stopChiakiSession, sendEmbedBoundsToAll, getActiveSessions } = require('./modules/chiaki');

// ─── xCloud (extracted to modules/xcloud.js) ─────────────────────────────────
const { xcloudSessions, updateAllXcloudBounds, startXcloudSession, stopXcloudSession, getActiveXcloudSessions } = require('./modules/xcloud');

// ─── Database Setup ───────────────────────────────────────────────────────────
const DB_PATH = path.join(app ? app.getPath('userData') : '.', 'games.json');

function loadDB() {
  try {
    if (fs.existsSync(DB_PATH)) {
      const data = JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
      // Purge PSN/psremote streaming bookmark entries — these are ephemeral session stubs,
      // not library games. Xbox games are imported via accounts:xbox:import and must persist.
      if (data.games) {
        const before = data.games.length;
        data.games = data.games.filter(g => g.platform !== 'psn' && g.platform !== 'psremote');
        if (data.games.length !== before) saveDB(data);
      }
      return data;
    }
  } catch (e) {
    console.error('Failed to load DB:', e);
  }
  // Start with empty library on first run
  const seed = {
    categories: ['Action', 'Adventure', 'RPG', 'Strategy', 'Puzzle', 'Simulation', 'Sports', 'FPS', 'Indie', 'Multiplayer'],
    playtime: {},
    games: []
  };
  saveDB(seed);
  return seed;
}

let _saveDBTimer = null;
function saveDB(data) {
  clearTimeout(_saveDBTimer);
  _saveDBTimer = setTimeout(() => {
    _saveDBTimer = null;
    try {
      const tmp = DB_PATH + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
      fs.renameSync(tmp, DB_PATH);
    }
    catch (e) { console.error('Failed to save DB:', e.message); }
  }, 150);
}
function flushDB() {
  if (_saveDBTimer) {
    clearTimeout(_saveDBTimer);
    _saveDBTimer = null;
    try {
      const tmp = DB_PATH + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
      fs.renameSync(tmp, DB_PATH);
    }
    catch (e) { console.error('Failed to flush DB:', e.message); }
  }
}

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
    try { mainWindow.maximize(); } catch (e) { /* ignore */ }
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
        try { session.embedProcess.stdin.write('hide\n'); } catch (e) { /* ok */ }
      }
    }
    for (const sess of xcloudSessions.values()) {
      try { sess.view.setVisible(false); } catch (e) { /* ok */ }
    }
  });

  mainWindow.on('focus', () => {
    for (const session of chiakiSessions.values()) {
      if (session.embedded && session.embedProcess && !session.embedProcess.killed) {
        try { session.embedProcess.stdin.write('show\n'); } catch (e) { /* ok */ }
      }
    }
    for (const sess of xcloudSessions.values()) {
      try { sess.view.setVisible(true); } catch (e) { /* ok */ }
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
  try { trayIcon.destroy(); } catch (e) { /* ok */ }
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
  ctx.flushDB = flushDB;
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

  // One-time cleanup: clear references to corrupt cover files (< 1KB) from old redirect bug
  let coversCleaned = 0;
  for (const game of (db.games || [])) {
    if (game.localCoverPath) {
      try {
        if (!fs.existsSync(game.localCoverPath) || fs.statSync(game.localCoverPath).size < 1024) {
          cleanupFile(game.localCoverPath);
          game.localCoverPath = null;
          coversCleaned++;
        }
      } catch (e) { game.localCoverPath = null; coversCleaned++; }
    }
    if (game.localHeaderPath) {
      try {
        if (!fs.existsSync(game.localHeaderPath) || fs.statSync(game.localHeaderPath).size < 1024) {
          cleanupFile(game.localHeaderPath);
          game.localHeaderPath = null;
          coversCleaned++;
        }
      } catch (e) { game.localHeaderPath = null; coversCleaned++; }
    }
  }
  if (coversCleaned > 0) {
    console.log('[CoverFetcher] Cleaned', coversCleaned, 'corrupt cover references');
    saveDB(db);
  }
  // Purge small corrupt files from covers directory (leftover from old redirect bug)
  try {
    const coversDir = getCoversDir();
    let purged = 0;
    for (const f of fs.readdirSync(coversDir)) {
      const fp = path.join(coversDir, f);
      try { if (fs.statSync(fp).size < 1024) { fs.unlinkSync(fp); purged++; } } catch (e) {}
    }
    if (purged > 0) console.log('[CoverFetcher] Purged', purged, 'corrupt files from covers directory');
  } catch (e) {}

  // Re-enqueue cover downloads for any game that has a coverUrl/headerUrl but no local file
  setTimeout(() => {
    // Backfill headerUrl for Steam games that only have a capsule coverUrl (may 404 for software/tools)
    let backfilled = 0;
    for (const game of (db.games || [])) {
      if (game.platform === 'steam' && game.platformId && !game.headerUrl) {
        game.headerUrl = `https://shared.steamstatic.com/store_item_assets/steam/apps/${game.platformId}/header.jpg`;
        backfilled++;
      }
    }
    if (backfilled > 0) saveDB(db);

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
  try { saveWindowBounds(); } catch (e) { /* ok */ }
  flushDB();
});

app.on('will-quit', () => {
  // No global shortcuts registered — DevTools handled via before-input-event
  // Cleanup any active xcloud sessions
  try {
    for (const [gameId, sess] of xcloudSessions) {
      try { mainWindow?.contentView?.removeChildView(sess.view); } catch (_) {}
      try { sess.view?.webContents?.close(); } catch (_) {}
    }
    xcloudSessions.clear();
  } catch (_) {}
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
  } catch (e) { return { error: 'Invalid URL' }; }
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
  } catch (e) {}
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

// Allow renderer to push the stream container bounds (CSS pixels)
ipcMain.handle('chiaki:setStreamBounds', (event, { gameId, x, y, width, height }) => {
  const session = chiakiSessions.get(gameId);
  if (session?.embedProcess && !session.embedProcess.killed) {
    try {
      session.embedProcess.stdin.write(`bounds ${x} ${y} ${width} ${height}\n`);
    } catch (e) { /* ok */ }
  }
  return { success: true };
});

// ─── Game Metadata (extracted to modules/metadata.js) ────────────────────────
const { httpGet, fetchGameMetadata, applyMetadataToGame, getMetadataSettings, invalidateMetadataCache } = require('./modules/metadata');

// ─── Game CRUD ────────────────────────────────────────────────────────────────
ipcMain.handle('games:getAll', () => db.games);
ipcMain.handle('games:getCategories', () => db.categories);

ipcMain.handle('games:add', (event, game) => {
  if (!game || typeof game !== 'object') return { error: 'Invalid game data' };
  if (!game.name || typeof game.name !== 'string' || !game.name.trim()) return { error: 'Game name is required' };
  game.name = game.name.trim();
  // Try to find an existing game to merge with (dedupe by platformId or canonical name)
  function canonicalizeName(n) {
    if (!n) return '';
    return String(n).toLowerCase().replace(/\s*[-–:]\s*(deluxe|ultimate|gold|collector's|special|limited|complete|season pass|dlc|edition).*/i, '').replace(/[^a-z0-9]+/g, ' ').trim();
  }

  let existing = null;
  try {
    if (game.platform && game.platformId) {
      existing = db.games.find(g => g.platform === game.platform && g.platformId && g.platformId === game.platformId);
    }
    if (!existing) {
      const canon = canonicalizeName(game.name || '');
      if (canon) existing = db.games.find(g => canonicalizeName(g.name) === canon && (!game.platform || g.platform === game.platform));
    }
  } catch (e) { existing = null; }

  if (existing) {
    // Merge into existing record instead of creating a duplicate
    const prev = existing;
    const merged = { ...prev, ...game };
    try {
      const coverChanged = (typeof game.coverUrl === 'string' && game.coverUrl !== prev.coverUrl);
      const headerChanged = (typeof game.headerUrl === 'string' && game.headerUrl !== prev.headerUrl);
      if (coverChanged || headerChanged) merged._imgStamp = Date.now(); else merged._imgStamp = prev._imgStamp;
    } catch (e) { merged._imgStamp = prev._imgStamp; }
    // Ensure platform/platformId are preserved
    if (!merged.platform) merged.platform = prev.platform;
    if (!merged.platformId) merged.platformId = prev.platformId;
    // Never downgrade installed status (detect sets true, import sets false — detect wins)
    if (prev.installed === true && merged.installed === false) merged.installed = true;
    db.games[db.games.findIndex(g => g.id === prev.id)] = merged;
    saveDB(db);
    sendToRenderer('games:refresh', db.games);
    // If cover URL changed, enqueue fetch
    try { enqueueCoverFetch(merged.id); } catch(e) {}
    return merged;
  }

  // No existing match — create new
  game.id = Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
  game.addedAt = new Date().toISOString();
  game.lastPlayed = null;
  game.playtimeMinutes = 0;
  game.favorite = false;
  // Stamp new games that already have a cover to force immediate reloads in renderer
  if (game.coverUrl) game._imgStamp = Date.now();
  db.games.push(game);
  saveDB(db);

  // Enqueue cover fetch immediately in case the game already has a coverUrl
  try { enqueueCoverFetch(game.id); } catch(e) {}

  // Auto-fetch metadata in the background; re-enqueue cover after in case metadata sets coverUrl
  fetchGameMetadata(game).then(meta => {
    if (meta && applyMetadataToGame(game, meta)) {
      saveDB(db);
      sendToRenderer('games:refresh', db.games);
      // Cover URL may have just been set by metadata — download it
      try { enqueueCoverFetch(game.id); } catch(e) {}
    }
  }).catch(() => {});

  return game;
});

ipcMain.handle('games:update', (event, updatedGame) => {
  if (!updatedGame || typeof updatedGame !== 'object' || !updatedGame.id) return null;
  if (updatedGame.name !== undefined && (typeof updatedGame.name !== 'string' || !updatedGame.name.trim())) return null;
  const idx = db.games.findIndex(g => g.id === updatedGame.id);
  if (idx !== -1) {
    const prev = db.games[idx];
    const merged = { ...prev, ...updatedGame };
    // If cover/header changed on update, clear the cached local file so the
    // cover queue re-downloads from the new URL instead of keeping the stale file
    try {
      const coverChanged = (typeof updatedGame.coverUrl === 'string' && updatedGame.coverUrl !== prev.coverUrl);
      const headerChanged = (typeof updatedGame.headerUrl === 'string' && updatedGame.headerUrl !== prev.headerUrl);
      if (coverChanged) {
        if (prev.localCoverPath) { try { fs.unlinkSync(prev.localCoverPath); } catch (_) {} }
        merged.localCoverPath = null;
        merged._imgStamp = Date.now();
      }
      if (headerChanged) {
        if (prev.localHeaderPath) { try { fs.unlinkSync(prev.localHeaderPath); } catch (_) {} }
        merged.localHeaderPath = null;
        merged._imgStamp = Date.now();
      }
      if (!coverChanged && !headerChanged) merged._imgStamp = prev._imgStamp;
    } catch (e) { merged._imgStamp = prev._imgStamp; }
    db.games[idx] = merged;
    saveDB(db);
    sendToRenderer('games:refresh', db.games);
    // If cover URL changed, enqueue fetch
    try { enqueueCoverFetch(updatedGame.id); } catch(e) {}
    return db.games[idx];
  }
  return null;
});

ipcMain.handle('games:delete', (event, id) => {
  db.games = db.games.filter(g => g.id !== id);
  saveDB(db);
  sendToRenderer('games:refresh', db.games);
  return true;
});

ipcMain.handle('games:toggleFavorite', (event, id) => {
  const game = db.games.find(g => g.id === id);
  if (game) {
    game.favorite = !game.favorite;
    saveDB(db);
    sendToRenderer('games:refresh', db.games);
    return game;
  }
  return null;
});

ipcMain.handle('covers:fetchNow', async (event, gameId) => {
  try {
    enqueueCoverFetch(gameId);
    return { queued: true };
  } catch (e) { return { error: e.message }; }
});

// --- Secure key storage and validation (uses Electron safeStorage)
function summarizeSecret(secret) {
  if (!secret) return { hasSecret: false, fingerprint: null };
  try {
    const fingerprint = crypto.createHash('sha256').update(secret).digest('hex').slice(0, 8);
    return { hasSecret: true, fingerprint };
  } catch (e) {
    return { hasSecret: true, fingerprint: 'unknown' };
  }
}

async function validateProviderKey(provider, apiKey) {
  if (!apiKey) return { ok: false, provider, error: 'missing-key' };
  if (providers && providers[provider] && typeof providers[provider].validateKey === 'function') {
    try {
      const res = await providers[provider].validateKey(apiKey);
      return { ok: !!res.ok, provider, info: res.info, error: res.error };
    } catch (err) {
      return { ok: false, provider, error: err && err.message };
    }
  }

  if (provider === 'steam') {
    const url = `https://api.steampowered.com/ISteamWebAPIUtil/GetServerInfo/v1/?key=${encodeURIComponent(apiKey)}`;
    const res = await httpGetJson(url);
    if (res && res.status === 200 && res.data) {
      return { ok: true, provider: 'steam', info: res.data };
    }
    return { ok: false, provider: 'steam', error: res && (res.data || res.raw || 'Steam API error') };
  }

  return { ok: false, provider, error: 'unknown-provider' };
}

ipcMain.handle('keys:set', async (event, {service, account, secret}) => {
  if (!ALLOWED_KEY_SERVICES.includes(service)) return {ok: false, error: 'Unauthorized service: ' + service};
  try {
    safeStore.setPassword(service, account, secret);
    return {ok: true, ...summarizeSecret(secret)};
  } catch (err) {
    console.error('keys:set error', err);
    return {ok: false, error: err && err.message};
  }
});

ipcMain.handle('keys:get', async (event, {service, account}) => {
  if (!ALLOWED_KEY_SERVICES.includes(service)) return {ok: false, error: 'Unauthorized service: ' + service};
  try {
    const secret = safeStore.getPassword(service, account);
    return {ok: true, ...summarizeSecret(secret)};
  } catch (err) {
    console.error('keys:get error', err);
    return {ok: false, error: err && err.message};
  }
});

ipcMain.handle('keys:delete', async (event, {service, account}) => {
  if (!ALLOWED_KEY_SERVICES.includes(service)) return {ok: false, error: 'Unauthorized service: ' + service};
  try {
    const res = safeStore.deletePassword(service, account);
    return {ok: res};
  } catch (err) {
    console.error('keys:delete error', err);
    return {ok: false, error: err && err.message};
  }
});

ipcMain.handle('keys:validate', async (event, {provider, apiKey}) => {
  try {
    return await validateProviderKey(provider, apiKey);
  } catch (err) {
    console.error('keys:validate error', err);
    return {ok: false, error: err && err.message};
  }
});

ipcMain.handle('keys:validateStored', async (event, {provider, service, account}) => {
  if (!ALLOWED_KEY_SERVICES.includes(service)) return {ok: false, error: 'Unauthorized service: ' + service};
  try {
    const secret = safeStore.getPassword(service, account);
    if (!secret) return { ok: false, error: 'no-secret', provider };
    return await validateProviderKey(provider, secret);
  } catch (err) {
    console.error('keys:validateStored error', err);
    return { ok: false, error: err && err.message };
  }
});

// ─── Metadata Fetch ───────────────────────────────────────────────────────────

// Search for game art across ALL available sources in parallel
ipcMain.handle('metadata:searchArt', async (event, gameName, platform) => {
  if (!gameName) return { images: [] };
  const ms = getMetadataSettings();

  // Each source returns an array of {url, type, source, label}
  async function searchSteam() {
    const results = [];
    const q = encodeURIComponent(gameName);
    const search = await httpGet(`https://store.steampowered.com/api/storesearch/?term=${q}&l=english&cc=US`);
    if (search?.items?.length) {
      for (const item of search.items.slice(0, 3)) {
        const id = item.id;
        const name = item.name || '';
        try {
          const det = await httpGet(`https://store.steampowered.com/api/appdetails?appids=${id}&l=english`);
          const info = det?.[String(id)]?.data;
          if (info) {
            results.push({ url: `https://shared.steamstatic.com/store_item_assets/steam/apps/${id}/library_600x900_2x.jpg`, type: 'cover', source: 'Steam', label: name + ' - Portrait (HD)' });
            if (info.header_image) results.push({ url: info.header_image, type: 'header', source: 'Steam', label: name + ' - Header' });
            results.push({ url: `https://shared.steamstatic.com/store_item_assets/steam/apps/${id}/library_hero.jpg`, type: 'header', source: 'Steam', label: name + ' - Hero' });
            if (info.screenshots) {
              for (const ss of info.screenshots.slice(0, 2)) {
                results.push({ url: ss.path_full, type: 'screenshot', source: 'Steam', label: name + ' - Screenshot' });
              }
            }
          }
        } catch(e) {}
      }
    }
    return results;
  }

  async function searchDuckDuckGo() {
    const results = [];
    const q = encodeURIComponent(gameName + ' video game');
    const ddg = await httpGet(`https://api.duckduckgo.com/?q=${q}&format=json&no_redirect=1`);
    if (ddg?.Image) {
      const ddgUrl = ddg.Image.startsWith('http') ? ddg.Image : 'https://duckduckgo.com' + ddg.Image;
      results.push({ url: ddgUrl, type: 'cover', source: 'DuckDuckGo', label: ddg.Heading || gameName });
    }
    if (ddg?.RelatedTopics) {
      for (const topic of ddg.RelatedTopics.slice(0, 4)) {
        if (topic?.Icon?.URL) {
          const iconUrl = topic.Icon.URL.startsWith('http') ? topic.Icon.URL : 'https://duckduckgo.com' + topic.Icon.URL;
          results.push({ url: iconUrl, type: 'screenshot', source: 'DuckDuckGo', label: (topic.Text || '').slice(0, 60) });
        }
      }
    }
    return results;
  }

  async function searchWikidata() {
    const results = [];
    const q = encodeURIComponent(gameName);
    const searchUrl = `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${q}&language=en&format=json&limit=3`;
    const searchData = await httpGet(searchUrl);
    if (searchData?.search?.length) {
      for (const entity of searchData.search.slice(0, 2)) {
        const desc = (entity.description || '').toLowerCase();
        if (desc && !desc.includes('game') && !desc.includes('video') && !desc.includes('software')) continue;
        try {
          const claimsUrl = `https://www.wikidata.org/w/api.php?action=wbgetclaims&entity=${entity.id}&property=P18&format=json`;
          const claims = await httpGet(claimsUrl);
          const imageClaims = claims?.claims?.P18;
          if (imageClaims?.length) {
            for (const claim of imageClaims.slice(0, 2)) {
              const filename = claim?.mainsnak?.datavalue?.value;
              if (filename) {
                const fn = filename.replace(/ /g, '_');
                const md5 = crypto.createHash('md5').update(fn).digest('hex');
                const fullUrl = `https://upload.wikimedia.org/wikipedia/commons/${md5[0]}/${md5[0]}${md5[1]}/${encodeURIComponent(fn)}`;
                const thumbUrl = `https://upload.wikimedia.org/wikipedia/commons/thumb/${md5[0]}/${md5[0]}${md5[1]}/${encodeURIComponent(fn)}/600px-${encodeURIComponent(fn)}`;
                results.push({ url: thumbUrl, type: 'header', source: 'Wikidata', label: entity.label + ' (Commons)' });
                results.push({ url: fullUrl, type: 'screenshot', source: 'Wikidata', label: entity.label + ' (Full)' });
              }
            }
          }
        } catch (e2) {}
      }
    }
    return results;
  }

  async function searchWikipedia() {
    const results = [];
    const q = encodeURIComponent(gameName + ' video game');
    const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${q}&srnamespace=0&srlimit=3&format=json`;
    const searchData = await httpGet(searchUrl);
    if (searchData?.query?.search?.length) {
      for (const r of searchData.query.search.slice(0, 2)) {
        const t = encodeURIComponent(r.title);
        try {
          const pgUrl = `https://en.wikipedia.org/w/api.php?action=query&titles=${t}&prop=pageimages&piprop=thumbnail|original&pithumbsize=600&format=json`;
          const pgData = await httpGet(pgUrl);
          const pages = pgData?.query?.pages;
          if (pages) {
            const pg = Object.values(pages)[0];
            if (pg?.thumbnail?.source) results.push({ url: pg.thumbnail.source, type: 'cover', source: 'Wikipedia', label: r.title });
            if (pg?.original?.source) results.push({ url: pg.original.source, type: 'header', source: 'Wikipedia', label: r.title + ' (Full)' });
          }
        } catch (e2) {}
        try {
          const imgUrl = `https://en.wikipedia.org/w/api.php?action=query&titles=${t}&prop=images&format=json`;
          const imgData = await httpGet(imgUrl);
          const pages = imgData?.query?.pages;
          if (pages) {
            const pg = Object.values(pages)[0];
            const articleImages = (pg.images || []).filter(i => {
              const n = i.title.toLowerCase();
              return (n.endsWith('.jpg') || n.endsWith('.png')) && !n.includes('logo') && !n.includes('icon') && !n.includes('symbol') && !n.includes('commons') && !n.includes('edit');
            });
            for (const img of articleImages.slice(0, 3)) {
              try {
                const infoUrl = `https://en.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(img.title)}&prop=imageinfo&iiprop=url&iiurlwidth=600&format=json`;
                const infoData = await httpGet(infoUrl);
                const infoPages = infoData?.query?.pages;
                if (infoPages) {
                  const infoPg = Object.values(infoPages)[0];
                  const ii = infoPg?.imageinfo?.[0];
                  if (ii?.thumburl) results.push({ url: ii.thumburl, type: 'screenshot', source: 'Wikipedia', label: img.title.replace('File:', '') });
                }
              } catch (e3) {}
            }
          }
        } catch (e2) {}
      }
    }
    return results;
  }

  async function searchSteamGridDB() {
    if (!ms.steamGridDbKey) return [];
    const results = [];
    const q = encodeURIComponent(gameName);
    const sgdbFetch = async (endpoint) => {
      const resp = await net.fetch(endpoint, {
        headers: { 'Authorization': 'Bearer ' + ms.steamGridDbKey },
      });
      if (!resp.ok) throw new Error('SGDB HTTP ' + resp.status);
      return resp.json();
    };
    // Search for the game first
    const searchData = await sgdbFetch(`https://www.steamgriddb.com/api/v2/search/autocomplete/${q}`);
    if (!searchData?.success || !searchData?.data?.length) return results;
    const gameId = searchData.data[0].id;
    const gamLabel = searchData.data[0].name || gameName;
    // Fetch portrait grids (covers), landscape grids (headers), heroes (banners), and logos in parallel
    const [portraitGrids, landscapeGrids, heroes, logos] = await Promise.allSettled([
      sgdbFetch(`https://www.steamgriddb.com/api/v2/grids/game/${gameId}?dimensions=600x900&limit=8`),
      sgdbFetch(`https://www.steamgriddb.com/api/v2/grids/game/${gameId}?dimensions=460x215,920x430&limit=4`),
      sgdbFetch(`https://www.steamgriddb.com/api/v2/heroes/game/${gameId}?limit=4`),
      sgdbFetch(`https://www.steamgriddb.com/api/v2/logos/game/${gameId}?limit=2`),
    ]);
    if (portraitGrids.status === 'fulfilled' && portraitGrids.value?.data) {
      for (const g of portraitGrids.value.data.slice(0, 8)) {
        if (g.url) results.push({ url: g.url, type: 'cover', source: 'SteamGridDB', label: gamLabel + ' - Cover' });
      }
    }
    if (landscapeGrids.status === 'fulfilled' && landscapeGrids.value?.data) {
      for (const g of landscapeGrids.value.data.slice(0, 4)) {
        if (g.url) results.push({ url: g.url, type: 'header', source: 'SteamGridDB', label: gamLabel + ' - Header' });
      }
    }
    if (heroes.status === 'fulfilled' && heroes.value?.data) {
      for (const h of heroes.value.data.slice(0, 4)) {
        if (h.url) results.push({ url: h.url, type: 'header', source: 'SteamGridDB', label: gamLabel + ' - Hero' });
      }
    }
    if (logos.status === 'fulfilled' && logos.value?.data) {
      for (const l of logos.value.data.slice(0, 2)) {
        if (l.url) results.push({ url: l.url, type: 'logo', source: 'SteamGridDB', label: gamLabel + ' - Logo' });
      }
    }
    return results;
  }

  // Prefer SteamGridDB, but fall back to Steam store images when SGDB yields nothing
  const sgdb = await searchSteamGridDB().catch(e => { console.log('[ArtSearch] SteamGridDB failed:', e.message); return []; });
  const images = [];
  const seen = new Set();
  for (const img of sgdb) {
    if (img.url && !seen.has(img.url)) {
      seen.add(img.url);
      images.push(img);
    }
  }
  if (images.length === 0) {
    // Try Steam store as a fallback so users still get results for many titles
    try {
      const steamImgs = await searchSteam().catch(e => { console.log('[ArtSearch] Steam fallback failed:', e && e.message); return []; });
      for (const img of steamImgs) {
        if (img.url && !seen.has(img.url)) {
          seen.add(img.url);
          images.push(img);
        }
      }
    } catch (e) {
      console.log('[ArtSearch] Steam fallback threw:', e && e.message);
    }
  }
  return { images };
});

ipcMain.handle('metadata:fetch', async (event, gameId) => {
  const game = db.games.find(g => g.id === gameId);
  if (!game) return { error: 'Game not found' };
  try {
    const meta = await fetchGameMetadata(game);
    if (!meta) return { error: 'No metadata found' };
    return { success: true, metadata: meta };
  } catch (e) {
    return { error: e.message };
  }
});

ipcMain.handle('metadata:apply', async (event, gameId, force) => {
  const game = db.games.find(g => g.id === gameId);
  if (!game) return { error: 'Game not found' };
  try {
    // Invalidate any cached metadata so force-apply fetches fresh data
    const cacheKey = (game.platform || '') + ':' + (game.platformId || game.name);
    invalidateMetadataCache(cacheKey);
    const meta = await fetchGameMetadata(game);
    if (!meta) return { error: 'No metadata found' };
    if (force) {
      // Force-apply: overwrite all fields (with sensible fallbacks)
      const prevCoverUrl = game.coverUrl;
      const prevHeaderUrl = game.headerUrl;
      game.coverUrl = meta.coverUrl || meta.headerUrl || (meta.screenshots && meta.screenshots[0]) || game.coverUrl;
      if (meta.description) game.description = meta.description;
      if (meta.developer) game.developer = meta.developer;
      if (meta.publisher) game.publisher = meta.publisher;
      if (meta.releaseDate) game.releaseDate = meta.releaseDate;
      if (meta.genres?.length) game.categories = meta.genres;
      game.headerUrl = meta.headerUrl || meta.coverUrl || (meta.screenshots && meta.screenshots[0]) || game.headerUrl;
      if (meta.screenshots?.length) game.screenshots = meta.screenshots;
      if (meta.metacritic != null) game.metacritic = meta.metacritic;
      if (meta.website) game.website = meta.website;
      // If cover/header URL changed, clear cached local file so re-download is triggered
      if (game.coverUrl !== prevCoverUrl) { game.localCoverPath = null; game._imgStamp = Date.now(); }
      if (game.headerUrl !== prevHeaderUrl) { game.localHeaderPath = null; game._imgStamp = Date.now(); }
      saveDB(db);
      sendToRenderer('games:refresh', db.games);
      try { enqueueCoverFetch(game.id); } catch(e) {}
      return { success: true, game };
    } else {
      const changed = applyMetadataToGame(game, meta);
      if (changed) {
        saveDB(db);
        sendToRenderer('games:refresh', db.games);
        try { enqueueCoverFetch(game.id); } catch(e) {}
      }
      return { success: true, game };
    }
  } catch (e) {
    return { error: e.message };
  }
});

ipcMain.handle('metadata:fetchForName', async (event, name, platform, platformId) => {
  if (!name) return { error: 'No name provided' };
  try {
    const meta = await fetchGameMetadata({ name, platform: platform || 'custom', platformId: platformId || undefined });
    if (!meta) return { error: 'No metadata found' };
    return { success: true, meta };
  } catch (e) {
    return { error: e.message };
  }
});

ipcMain.handle('metadata:fetchAll', async () => {
  let updated = 0, failed = 0;
  const queue = [...db.games].sort((a, b) => {
    const ai = a.installed === false ? 1 : 0;
    const bi = b.installed === false ? 1 : 0;
    return ai - bi;
  });
  const total = queue.length;
  const BATCH = 3;
  for (let i = 0; i < total; i += BATCH) {
    const batch = queue.slice(i, i + BATCH);
    const results = await Promise.allSettled(batch.map(async game => {
      const meta = await fetchGameMetadata(game);
      return { game, meta };
    }));
    let batchUpdated = 0;
    for (const r of results) {
      if (r.status === 'fulfilled' && r.value.meta) {
        if (applyMetadataToGame(r.value.game, r.value.meta)) {
          updated++; batchUpdated++;
          // Enqueue cover download now that coverUrl may have been set
          try { enqueueCoverFetch(r.value.game.id); } catch(e) {}
        }
      } else { failed++; }
    }
    // Save and push live updates to renderer after each batch
    if (batchUpdated > 0) {
      saveDB(db);
      sendToRenderer('games:refresh', db.games);
    }
    const done = Math.min(i + BATCH, total);
    sendToRenderer('metadata:progress', { current: done, total, updated, failed, name: batch[batch.length - 1].name, phase: 'metadata' });
    if (i + BATCH < total) await new Promise(r => setTimeout(r, 200));
  }
  // Final save + refresh in case the last batch had changes
  if (updated > 0) {
    saveDB(db);
    sendToRenderer('games:refresh', db.games);
  }
  return { updated, failed, total };
});

// ─── SteamGridDB Browser Login (opens external auth flow and prompts for API key)
ipcMain.handle('steamgriddb:login', async () => {
  try {
    // Open SteamGridDB profile prefs where user can generate an API key
    await shell.openExternal('https://www.steamgriddb.com/profile/preferences/api');
    // Prompt user to copy & paste the key
    const { response } = await dialog.showMessageBox(mainWindow, {
      type: 'info',
      buttons: ['Paste API Key', 'Cancel'],
      defaultId: 0,
      message: 'SteamGridDB Login',
      detail: 'Copy your API key from the SteamGridDB page that opened, then click "Paste API Key".'
    });
    if (response !== 0) return { cancelled: true };
    const apiKey = clipboard.readText().trim();
    if (!apiKey) return { error: 'Clipboard is empty. Copy your SteamGridDB API key first, then try again.' };
    const vr = await validateProviderKey('steamgriddb', apiKey);
    if (!vr?.ok) return { error: 'API key appears invalid: ' + (vr?.error || 'unknown error') };
    safeStore.setPassword('cereal-steamgriddb', 'default', apiKey);
    return { ok: true, ...summarizeSecret(apiKey) };
  } catch (e) {
    return { error: e.message };
  }
});

// Clipboard read helper for renderer (used to paste API keys)
ipcMain.handle('clipboard:readText', () => {
  try {
    return clipboard.readText();
  } catch (e) {
    return '';
  }
});


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

// ─── Platform Detection (extracted to modules/detection.js) ───────────────────
const { findSteamRoot, scanSteamInstalled, scanEpicInstalled, scanGogInstalled, scanXboxInstalled } = require('./modules/detection');

ipcMain.handle('detect:steam', async () => {
  try { return scanSteamInstalled(); }
  catch (err) { return { games: [], error: err.message }; }
});

ipcMain.handle('detect:epic', async () => {
  const games = scanEpicInstalled();
  return games.length ? { games } : { games: [], error: 'Epic Games not found' };
});

ipcMain.handle('detect:gog', async () => {
  const games = scanGogInstalled();
  return games.length ? { games } : { games: [], error: 'GOG not found' };
});

// ─── chiaki-ng Detection (PlayStation Remote Play) ────────────────────────────
ipcMain.handle('detect:psremote', async () => {
  const result = {
    found: false,
    bundled: false,
    executablePath: null,
    version: null,
    consoles: [],
  };

  try {
    // 1. Check for bundled binary first
    const bundledExe = getBundledChiakiExe();
    if (bundledExe) {
      result.found = true;
      result.bundled = true;
      result.executablePath = bundledExe;
      result.version = getBundledChiakiVersion();
    }

    // 2. Fallback to system-installed
    if (!result.found) {
      const systemPaths = CHIAKI_SYSTEM_PATHS;
      for (const p of systemPaths) {
        if (fs.existsSync(p)) {
          result.found = true;
          result.bundled = false;
          result.executablePath = p;
          break;
        }
      }
    }

    // 3. Try to list registered consoles
    if (result.executablePath) {
      try {
        const listOutput = require('child_process').execFileSync(result.executablePath, ['list'], {
          timeout: 5000,
          env: { ...process.env, PATH: `${path.dirname(result.executablePath)};${process.env.PATH}` },
        }).toString();
        result.consoles = listOutput.trim().split('\n').filter(l => l.trim());
      } catch (e) {
        result.consoles = [];
      }
    }
  } catch (err) {
    result.error = err.message;
  }

  return result;
});

ipcMain.handle('detect:xbox', async () => {
  try { return scanXboxInstalled(); }
  catch (err) { return { games: [], xboxAppFound: false, error: err.message }; }
});

ipcMain.handle('detect:ea', async () => {
  try {
    if (!providers?.ea?.detectInstalled) return { games: [], appFound: false, error: 'EA provider not available' };
    const res = providers.ea.detectInstalled();
    return {
      games: res?.games || [],
      appFound: providers.ea.isAppInstalled ? !!providers.ea.isAppInstalled() : false,
      error: res?.error,
    };
  } catch (err) {
    return { games: [], appFound: false, error: err.message };
  }
});

ipcMain.handle('detect:battlenet', async () => {
  try {
    if (!providers?.battlenet?.detectInstalled) return { games: [], appFound: false, error: 'Battle.net provider not available' };
    const res = providers.battlenet.detectInstalled();
    return {
      games: res?.games || [],
      appFound: providers.battlenet.isAppInstalled ? !!providers.battlenet.isAppInstalled() : false,
      error: res?.error,
    };
  } catch (err) {
    return { games: [], appFound: false, error: err.message };
  }
});

ipcMain.handle('detect:itchio', async () => {
  try {
    if (!providers?.itchio?.detectInstalled) return { games: [], appFound: false, error: 'itch.io provider not available' };
    const res = providers.itchio.detectInstalled();
    return {
      games: res?.games || [],
      appFound: providers.itchio.isAppInstalled ? !!providers.itchio.isAppInstalled() : false,
      error: res?.error,
    };
  } catch (err) {
    return { games: [], appFound: false, error: err.message };
  }
});

ipcMain.handle('detect:ubisoft', async () => {
  try {
    if (!providers?.ubisoft?.detectInstalled) return { games: [], appFound: false, error: 'Ubisoft provider not available' };
    const res = providers.ubisoft.detectInstalled();
    return {
      games: res?.games || [],
      appFound: providers.ubisoft.isAppInstalled ? !!providers.ubisoft.isAppInstalled() : false,
      error: res?.error,
    };
  } catch (err) {
    return { games: [], appFound: false, error: err.message };
  }
});

// ─── Playtime Sync from Platforms ─────────────────────────────────────────────
ipcMain.handle('playtime:sync', async () => {
  const updated = [];
  try {
    // ── Steam playtime via Steam Web API or local stats ──
    const steamRoot = findSteamRoot();
    if (steamRoot) {
      // Try reading localconfig.vdf for playtime data
      const userdataDir = path.join(steamRoot, 'userdata');
      if (fs.existsSync(userdataDir)) {
        const userDirs = fs.readdirSync(userdataDir).filter(d => {
          return fs.statSync(path.join(userdataDir, d)).isDirectory() && /^\d+$/.test(d);
        });
        for (const userId of userDirs) {
          const localConfigPath = path.join(userdataDir, userId, 'config', 'localconfig.vdf');
          if (!fs.existsSync(localConfigPath)) continue;
          const vdfContent = fs.readFileSync(localConfigPath, 'utf-8');
          // Parse VDF playtime_forever values per appid
          // VDF format: nested braces with "appid" { ... "playtime_forever" "minutes" ... }
          const appBlocks = vdfContent.matchAll(/"(\d+)"\s*\{[^}]*?"playtime_forever"\s+"(\d+)"[^}]*?\}/gs);
          for (const m of appBlocks) {
            const appId = m[1];
            const minutes = parseInt(m[2], 10);
            if (minutes > 0) {
              const game = db.games.find(g => g.platform === 'steam' && g.platformId === appId);
              if (game && minutes > (game.playtimeMinutes || 0)) {
                game.playtimeMinutes = minutes;
                updated.push({ id: game.id, name: game.name, minutes, source: 'steam' });
              }
            }
          }
          // Also try the apps section format
          const appsSection = vdfContent.match(/"apps"\s*\{([\s\S]*?)\n\t\t\t\}/m);
          if (appsSection) {
            const appEntries = appsSection[1].matchAll(/"(\d+)"\s*\{([\s\S]*?)\}/g);
            for (const entry of appEntries) {
              const appId = entry[1];
              const block = entry[2];
              const ptMatch = block.match(/"playtime_forever"\s+"(\d+)"/);
              if (ptMatch) {
                const minutes = parseInt(ptMatch[1], 10);
                if (minutes > 0) {
                  const game = db.games.find(g => g.platform === 'steam' && g.platformId === appId);
                  if (game && minutes > (game.playtimeMinutes || 0)) {
                    game.playtimeMinutes = minutes;
                    if (!updated.find(u => u.id === game.id)) {
                      updated.push({ id: game.id, name: game.name, minutes, source: 'steam' });
                    }
                  }
                }
              }
            }
          }
        }
      }

      // Also try reading playtime from Steam acf manifests (StateFlags / BytesDownloaded can hint at use)
      // and appinfo.vdf — but localconfig is the primary source
    }

    // ── GOG playtime via galaxy-2.0.db ──
    try {
      const gogDbPath = path.join(
        process.env.PROGRAMDATA || 'C:\\ProgramData',
        'GOG.com', 'Galaxy', 'storage', 'galaxy-2.0.db'
      );
      if (fs.existsSync(gogDbPath)) {
        // GOG stores playtime in SQLite — we'd need better-sqlite3 or similar
        // For now, skip GOG DB playtime (would need native module)
      }
    } catch (e) { /* skip GOG playtime */ }

    // ── Epic Games — no local playtime file available ──
    // Epic doesn't store local playtime data in an accessible format

    if (updated.length > 0) {
      saveDB(db);
      sendToRenderer('games:refresh', db.games);
    }
  } catch (err) {
    return { updated: [], error: err.message };
  }

  return { updated, games: db.games };
});

// ─── Settings (extracted to modules/settings.js) ─────────────────────────────
const { DEFAULT_SETTINGS, registerSettingsIpcHandlers } = require('./modules/settings');
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

// ─── chiaki-ng Auto-Setup (first run) ─────────────────────────────────────────
// If chiaki-ng is not bundled and no system install is found, automatically
// download it in the background so the user doesn't have to do it manually.
function autoSetupChiakiIfMissing() {
  // Already bundled — nothing to do
  if (getBundledChiakiExe()) return;

  // System install exists — no need to download
  if (CHIAKI_SYSTEM_PATHS.some(p => fs.existsSync(p))) return;

  console.log('[chiaki] Not found — starting automatic setup...');
  sendToRenderer('chiaki:event', { type: 'setup_started' });

  const scriptPath = path.join(__dirname, 'scripts', 'setup-chiaki.ps1');
  if (!fs.existsSync(scriptPath)) {
    console.warn('[chiaki] setup-chiaki.ps1 not found, skipping auto-setup');
    return;
  }

  const chiakiInstallDir = path.join(app.getPath('userData'), 'chiaki-ng');
  const child = spawn('powershell', ['-ExecutionPolicy', 'Bypass', '-File', scriptPath, '-InstallDir', chiakiInstallDir], { cwd: __dirname, stdio: 'pipe' });
  let output = '';
  child.stdout.on('data', d => output += d.toString());
  child.stderr.on('data', d => output += d.toString());
  child.on('close', (code) => {
    if (code === 0) {
      const version = getBundledChiakiVersion();
      console.log(`[chiaki] Auto-setup complete — v${version}`);
      sendToRenderer('chiaki:event', { type: 'setup_complete', version });
    } else {
      console.error(`[chiaki] Auto-setup failed (exit ${code}):`, output);
      sendToRenderer('chiaki:event', { type: 'setup_failed', error: `Setup exited with code ${code}` });
    }
  });
  child.on('error', (err) => {
    console.error('[chiaki] Auto-setup spawn error:', err.message);
  });
}

// ─── chiaki-ng Configuration ──────────────────────────────────────────────────
ipcMain.handle('chiaki:status', () => {
  const bundledExe = getBundledChiakiExe();
  const bundledVersion = getBundledChiakiVersion();

  if (bundledExe) {
    return {
      status: 'bundled',
      executablePath: bundledExe,
      version: bundledVersion,
      directory: getChiakiDir(),
    };
  }

  // Check system install
  for (const p of CHIAKI_SYSTEM_PATHS) {
    if (fs.existsSync(p)) {
      return { status: 'system', executablePath: p, version: null };
    }
  }

  return { status: 'missing', executablePath: null, version: null };
});

ipcMain.handle('chiaki:checkUpdate', async () => {
  try {
    const repo = process.env.CHIAKI_RELEASE_REPO || 'streetpea/chiaki-ng';
    const res = await net.fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
      headers: { 'User-Agent': 'cereal-launcher' }
    });
    if (!res.ok) throw new Error(`GitHub API returned ${res.status}`);
    const data = await res.json();
    const latestTag = data.tag_name || null;
    const currentVersion = getBundledChiakiVersion();
    const hasUpdate = latestTag && (!currentVersion || latestTag !== currentVersion);
    return { current: currentVersion, latest: latestTag, hasUpdate: !!hasUpdate, releaseName: data.name || latestTag };
  } catch (e) {
    return { error: e.message };
  }
});

ipcMain.handle('chiaki:update', async () => {
  try {
    // In packaged builds scripts/ is an extraResource next to chiaki-ng, outside asar
    const scriptPath = app.isPackaged
      ? path.join(process.resourcesPath, 'scripts', 'setup-chiaki.ps1')
      : path.join(__dirname, 'scripts', 'setup-chiaki.ps1');
    if (!fs.existsSync(scriptPath)) return { error: 'setup-chiaki.ps1 not found at: ' + scriptPath };
    const chiakiInstallDir = path.join(app.getPath('userData'), 'chiaki-ng');
    return new Promise((resolve) => {
      const child = spawn('powershell', ['-ExecutionPolicy', 'Bypass', '-File', scriptPath, '-Force', '-InstallDir', chiakiInstallDir], { cwd: __dirname, stdio: 'pipe' });
      let output = '';
      child.stdout.on('data', d => output += d.toString());
      child.stderr.on('data', d => output += d.toString());
      child.on('close', (code) => {
        if (code === 0) {
          const newVersion = getBundledChiakiVersion();
          resolve({ ok: true, version: newVersion, output });
        } else {
          resolve({ error: `Setup exited with code ${code}`, output });
        }
      });
      child.on('error', (err) => resolve({ error: err.message }));
    });
  } catch (e) {
    return { error: e.message };
  }
});

ipcMain.handle('chiaki:getConfig', () => {
  return db.chiakiConfig || { executablePath: '', consoles: [] };
});

ipcMain.handle('chiaki:saveConfig', (event, config) => {
  // Drop any legacy cerealMode field before persisting
  const { cerealMode: _dropped, ...clean } = config || {};
  db.chiakiConfig = clean;
  saveDB(db);
  return clean;
});

ipcMain.handle('games:setChiakiStream', (event, gameId, streamConfig) => {
  const game = db.games.find(g => g.id === gameId);
  if (game) {
    game.chiakiNickname = streamConfig.nickname || '';
    game.chiakiHost = streamConfig.host || '';
    game.chiakiProfile = streamConfig.profile || '';
    game.chiakiFullscreen = streamConfig.fullscreen !== false;
    game.chiakiRegistKey = streamConfig.registKey || '';
    game.chiakiMorning = streamConfig.morning || '';
    saveDB(db);
    return game;
  }
  return null;
});

// ─── Chiaki Stream Management (deep integration) ─────────────────────────────
ipcMain.handle('chiaki:startStreamDirect', (event, opts) => {
  const chiakiExe = resolveChiakiExe();
  if (!chiakiExe) return { success: false, error: 'chiaki-ng not found. Run scripts/setup-chiaki.ps1 to install it.' };

  const sessionKey = 'console:' + (opts.host || 'unknown');
  const gameData = {
    chiakiHost:       opts.host        || '',
    chiakiNickname:   opts.nickname    || '',
    chiakiProfile:    opts.profile     || '',
    chiakiRegistKey:  opts.registKey   || '',
    chiakiMorning:    opts.morning     || '',
    chiakiFullscreen: opts.fullscreen !== false,
    chiakiDisplayMode: opts.displayMode || '',
  };
  const chiakiConfig = db.chiakiConfig || {};
  const args = buildChiakiArgs(gameData, chiakiConfig);
  const session = startChiakiSession(sessionKey, chiakiExe, args);
  return { success: true, sessionKey, state: session.state };
});

ipcMain.handle('chiaki:startStream', (event, gameId) => {
  const game = db.games.find(g => g.id === gameId);
  if (!game) return { success: false, error: 'Game not found' };

  const chiakiExe = resolveChiakiExe(game.executablePath);
  if (!chiakiExe) return { success: false, error: 'chiaki-ng not found' };

  const chiakiConfig = db.chiakiConfig || {};
  const args = buildChiakiArgs(game, chiakiConfig);
  const session = startChiakiSession(gameId, chiakiExe, args);

  game.lastPlayed = new Date().toISOString();
  saveDB(db);

  return { success: true, state: session.state };
});

ipcMain.handle('chiaki:stopStream', (event, gameId) => {
  return { success: stopChiakiSession(gameId) };
});

ipcMain.handle('chiaki:getSessions', () => {
  return getActiveSessions();
});

// ─── xCloud IPC handlers ──────────────────────────────────────────────────────
ipcMain.handle('xcloud:startDirect', (event, { url }) => {
  try {
    startXcloudSession('xbox:cloud', url || 'https://www.xbox.com/play');
    return { success: true, sessionKey: 'xbox:cloud' };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('xcloud:start', (event, { gameId, url }) => {
  try {
    startXcloudSession(gameId, url);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('xcloud:stop', (event, gameId) => {
  return { success: stopXcloudSession(gameId) };
});

ipcMain.handle('xcloud:getSessions', () => {
  return getActiveXcloudSessions();
});

// Native SMTC addon - lazy loaded
let smtcNative = null;
function getSmtcNative() {
  if (!smtcNative) {
    try {
      smtcNative = require('./native/smtc');
      console.log('[media] native addon loaded');
    } catch (e) {
      console.log('[media] failed to load native addon:', e.message);
    }
  }
  return smtcNative;
}

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

ipcMain.handle('media:control', async (event, action) => {
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

ipcMain.handle('chiaki:openGui', () => {
  const chiakiExe = resolveChiakiExe();
  if (!chiakiExe) return { success: false, error: 'chiaki-ng not found' };

  const chiakiDir = path.dirname(chiakiExe);
  const env = { ...process.env, PATH: `${chiakiDir};${process.env.PATH}` };
  spawn(chiakiExe, [], { cwd: chiakiDir, env, detached: true, stdio: 'ignore' }).unref();
  return { success: true };
});

ipcMain.handle('chiaki:registerConsole', (event, { host, psnAccountId, pin }) => {
  // Use chiaki-ng CLI to register a console
  const chiakiExe = resolveChiakiExe();
  if (!chiakiExe) return { success: false, error: 'chiaki-ng not found' };

  return new Promise((resolve) => {
    const chiakiDir = path.dirname(chiakiExe);
    const env = { ...process.env, PATH: `${chiakiDir};${process.env.PATH}` };
    const args = ['register', '--host', host];
    if (psnAccountId) args.push('--psn-account-id', psnAccountId);
    if (pin) args.push('--pin', pin);

    let output = '';
    let resolved = false;
    const finish = (result) => { if (resolved) return; resolved = true; resolve(result); };
    const proc = spawn(chiakiExe, args, { cwd: chiakiDir, env, stdio: ['ignore', 'pipe', 'pipe'] });
    proc.stdout.on('data', d => output += d.toString());
    proc.stderr.on('data', d => output += d.toString());
    proc.on('exit', (code) => {
      if (code === 0) {
        // Parse registration output for keys
        const registKey = output.match(/regist[_-]?key[=:]\s*([^\s\n]+)/i)?.[1] || '';
        const morning = output.match(/morning[=:]\s*([^\s\n]+)/i)?.[1] || '';
        finish({ success: true, registKey, morning, output });
      } else {
        finish({ success: false, error: output || 'Registration failed (exit ' + code + ')' });
      }
    });
    setTimeout(() => { try { proc.kill(); } catch(e) {} finish({ success: false, error: 'Registration timed out (30s)' }); }, 30000);
  });
});

ipcMain.handle('chiaki:discoverConsoles', () => {
  // Matches chiaki-ng discovery.c exactly:
  //   - SRCH uses LF (\n) not CRLF (\r\n)
  //   - PS4: port 987,  protocol 00020020
  //   - PS5: port 9302, protocol 00030010
  //   - Local port 9303-9319
  //   - HTTP 200 = ready, HTTP 620 = standby
  const TARGETS = [
    { port: 987,  srch: Buffer.from('SRCH * HTTP/1.1\ndevice-discovery-protocol-version:00020020\n') },
    { port: 9302, srch: Buffer.from('SRCH * HTTP/1.1\ndevice-discovery-protocol-version:00030010\n') },
  ];

  return new Promise((resolve) => {
    const found = new Map();

    // Message handler shared by all bind attempts
    function onMessage(msg, rinfo) {
      const text = msg.toString();
      // chiaki: 200 = ready, 620 = standby
      const statusMatch = text.match(/^HTTP\/1\.1\s+(\d+)/);
      if (!statusMatch) return;
      const httpCode = parseInt(statusMatch[1], 10);
      if (httpCode !== 200 && httpCode !== 620) return;

      console.log('[discovery] response from', rinfo.address, 'status:', httpCode);

      const state = httpCode === 200 ? 'ready' : 'standby';
      const entry = { host: rinfo.address, state };

      for (const line of text.split('\n')) {
        const colon = line.indexOf(':');
        if (colon === -1) continue;
        const k = line.substring(0, colon).trim().toLowerCase();
        const v = line.substring(colon + 1).trim();
        if (k === 'host-name')            entry.name            = v;
        if (k === 'host-type')            entry.type            = v;
        if (k === 'host-id')              entry.hostId          = v;
        if (k === 'system-version')       entry.firmwareVersion = v;
        if (k === 'running-app-titleid')  entry.runningTitleId  = v;
        if (k === 'running-app-name')     entry.runningTitle    = v;
        if (k === 'device-discovery-protocol-version') entry.protocolVersion = v;
      }

      const existing = found.get(rinfo.address);
      if (existing) {
        Object.assign(existing, Object.fromEntries(
          Object.entries(entry).filter(([, v]) => v != null && v !== '')
        ));
      } else {
        found.set(rinfo.address, entry);
      }
    }

    // Bind to port 9303-9319 like chiaki, then fallback to 0 (random)
    const ports = [];
    for (let p = 9303; p <= 9319; p++) ports.push(p);
    ports.push(0);

    function tryBind(idx) {
      const s = dgram.createSocket({ type: 'udp4', reuseAddr: true });
      s.on('message', onMessage);
      s.on('error', (err) => {
        if (err.code === 'EADDRINUSE' && idx + 1 < ports.length) {
          try { s.close(); } catch(e) {}
          tryBind(idx + 1);
        } else {
          console.error('[discovery] bind failed:', err.message);
          try { s.close(); } catch(e) {}
          resolve({ success: false, consoles: [], error: err.message });
        }
      });
      s.bind(ports[idx], () => {
        console.log('[discovery] bound to port', ports[idx] || '(random)');
        onBoundSock(s);
      });
    }
    tryBind(0);

    function onBoundSock(s) {
      s.setBroadcast(true);

      const broadcasts = new Set(['255.255.255.255']);
      for (const addrs of Object.values(os.networkInterfaces())) {
        for (const addr of addrs) {
          if (addr.family !== 'IPv4' || addr.internal) continue;
          if (addr.netmask) {
            const ipParts  = addr.address.split('.').map(Number);
            const maskParts = addr.netmask.split('.').map(Number);
            const bcast = ipParts.map((octet, i) => (octet | (~maskParts[i] & 0xFF))).join('.');
            broadcasts.add(bcast);
          } else {
            const parts = addr.address.split('.');
            parts[3] = '255';
            broadcasts.add(parts.join('.'));
          }
        }
      }

      console.log('[discovery] broadcasting to:', [...broadcasts]);

      const sendRound = () => {
        for (const bcast of broadcasts) {
          for (const { port, srch } of TARGETS) {
            s.send(srch, port, bcast, (err) => {
              if (err) console.error('[discovery] send error:', bcast, port, err.message);
            });
          }
        }
      };

      sendRound();
      setTimeout(sendRound, 500);
      setTimeout(sendRound, 1500);

      setTimeout(() => {
        console.log('[discovery] done, found', found.size, 'console(s)');
        try { s.close(); } catch(e) {}
        resolve({ success: true, consoles: [...found.values()] });
      }, 4000);
    }
  });
});

// ─── Wake-on-LAN for PlayStation consoles ─────────────────────────────────────
ipcMain.handle('chiaki:wakeConsole', (event, { host, credentials }) => {
  // PS4/PS5 use a custom wake packet on UDP port 987, not standard WoL.
  // Send a WAKEUP request with the registered credentials.
  return new Promise((resolve) => {
    const registKey = credentials?.registKey || '';
    if (!registKey) {
      return resolve({ success: false, error: 'No registration key — register the console first' });
    }

    // Attempt 1: Use chiaki CLI if available
    let resolved = false;
    const finish = (result) => { if (resolved) return; resolved = true; resolve(result); };

    const chiakiExe = resolveChiakiExe();
    if (chiakiExe) {
      const chiakiDir = path.dirname(chiakiExe);
      const env = { ...process.env, PATH: `${chiakiDir};${process.env.PATH}` };
      const args = ['wakeup', '--host', host, '--regist-key', registKey];

      const proc = spawn(chiakiExe, args, { cwd: chiakiDir, env, stdio: ['ignore', 'pipe', 'pipe'] });
      let output = '';
      proc.stdout.on('data', d => output += d.toString());
      proc.stderr.on('data', d => output += d.toString());
      proc.on('exit', (code) => {
        finish({ success: code === 0, output, method: 'chiaki-cli' });
      });
      proc.on('error', () => {
        // CLI failed, fall through to UDP
        sendUdpWake();
      });
      setTimeout(() => { try { proc.kill(); } catch(e) {} finish({ success: false, error: 'Wake CLI timed out (10s)', method: 'chiaki-cli' }); }, 10000);
      return;
    }

    // Attempt 2: Direct UDP wake packet
    sendUdpWake();

    function sendUdpWake() {
      // Matches chiaki-ng discovery.c WAKEUP format exactly (LF, not CRLF)
      // PS4 wakes on port 987, PS5 on port 9302
      const WAKE_TARGETS = [
        { port: 987,  msg: Buffer.from('WAKEUP * HTTP/1.1\nclient-type:vr\nauth-type:R\nmodel:w\napp-type:r\nuser-credential:' + registKey + '\ndevice-discovery-protocol-version:00020020\n') },
        { port: 9302, msg: Buffer.from('WAKEUP * HTTP/1.1\nclient-type:vr\nauth-type:R\nmodel:w\napp-type:r\nuser-credential:' + registKey + '\ndevice-discovery-protocol-version:00030010\n') },
      ];

      const sock = dgram.createSocket('udp4');
      sock.on('error', (err) => {
        console.error('[wake] socket error:', err.message);
        try { sock.close(); } catch(e) {}
        finish({ success: false, error: err.message, method: 'udp' });
      });

      sock.bind(0, () => {
        sock.setBroadcast(true);
        const hosts = [host];
        const parts = host.split('.');
        if (parts.length === 4) { parts[3] = '255'; hosts.push(parts.join('.')); }

        let total = hosts.length * WAKE_TARGETS.length;
        let sent = 0;
        for (const target of hosts) {
          for (const { port, msg } of WAKE_TARGETS) {
            sock.send(msg, port, target, (err) => {
              if (err) console.error('[wake] send error:', target, port, err.message);
              sent++;
              if (sent === total) {
                setTimeout(() => {
                  try { sock.close(); } catch(e) {}
                  console.log('[wake] sent to', host, '(both ports)');
                  finish({ success: true, method: 'udp' });
                }, 500);
              }
            });
          }
        }
      });
    }
  });
});

// ─── Categories ───────────────────────────────────────────────────────────────
ipcMain.handle('categories:add', (event, category) => {
  if (!db.categories.includes(category)) {
    db.categories.push(category);
    saveDB(db);
  }
  return db.categories;
});

ipcMain.handle('categories:remove', (event, category) => {
  db.categories = db.categories.filter(c => c !== category);
  // Also remove from all games
  db.games.forEach(g => {
    g.categories = (g.categories || []).filter(c => c !== category);
  });
  saveDB(db);
  return db.categories;
});

