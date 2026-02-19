const { app, BrowserWindow, ipcMain, dialog, shell, session, WebContentsView, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
// Secure credential store using Electron's safeStorage (replaces keytar)
const credStorePath = () => path.join(app.getPath('userData'), 'credentials.json');
function loadCredStore() {
  try { return JSON.parse(fs.readFileSync(credStorePath(), 'utf-8')); } catch { return {}; }
}
function saveCredStore(store) {
  fs.writeFileSync(credStorePath(), JSON.stringify(store, null, 2), 'utf-8');
}
const safeStore = {
  setPassword(service, account, secret) {
    const { safeStorage } = require('electron');
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Encryption not available');
    const store = loadCredStore();
    const key = `${service}/${account}`;
    store[key] = safeStorage.encryptString(secret).toString('base64');
    saveCredStore(store);
  },
  getPassword(service, account) {
    const { safeStorage } = require('electron');
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
const { execSync, spawn } = require('child_process');
const readline = require('readline');
const https = require('https');
const crypto = require('crypto');
const { pipeline } = require('stream');
const { promisify } = require('util');
const { autoUpdater } = require('electron-updater');
const streamPipeline = promisify(pipeline);
const providers = require(path.join(__dirname, 'providers'));

// ─── Discord Rich Presence ─────────────────────────────────────────────────────
const DiscordRPC = require('discord-rpc');
const DISCORD_CLIENT_ID = '1338877643523145789'; // Cereal Launcher app ID
let discordRpc = null;
let discordReady = false;
let discordCurrentGame = null;

function connectDiscord() {
  if (discordRpc) return;
  try {
    discordRpc = new DiscordRPC.Client({ transport: 'ipc' });
    discordRpc.on('ready', () => {
      discordReady = true;
      console.log('[Discord] RPC ready');
    });
    discordRpc.login({ clientId: DISCORD_CLIENT_ID }).catch(err => {
      console.log('[Discord] Could not connect:', err.message);
      discordRpc = null;
    });
  } catch (e) {
    console.log('[Discord] Init error:', e.message);
    discordRpc = null;
  }
}

function disconnectDiscord() {
  if (discordRpc) {
    try { discordRpc.clearActivity(); } catch(e) {}
    try { discordRpc.destroy(); } catch(e) {}
    discordRpc = null;
    discordReady = false;
    discordCurrentGame = null;
  }
}

const PLATFORM_LABELS = {
  steam: 'Steam', epic: 'Epic Games', gog: 'GOG', psn: 'PlayStation',
  xbox: 'Xbox', custom: 'PC', psremote: 'PlayStation'
};

function setDiscordPresence(gameName, platform, startTimestamp) {
  discordCurrentGame = { name: gameName, platform, startTimestamp: startTimestamp || Date.now() };
  if (!discordRpc || !discordReady) return;
  try {
    discordRpc.setActivity({
      details: gameName,
      state: 'via ' + (PLATFORM_LABELS[platform] || 'Cereal Launcher'),
      startTimestamp: discordCurrentGame.startTimestamp,
      largeImageKey: 'cereal_logo',
      largeImageText: 'Cereal Launcher',
      smallImageKey: platform || 'custom',
      smallImageText: PLATFORM_LABELS[platform] || 'Game',
      instance: false,
    });
  } catch (e) { console.log('[Discord] Presence error:', e.message); }
}

function clearDiscordPresence() {
  discordCurrentGame = null;
  if (!discordRpc || !discordReady) return;
  try { discordRpc.clearActivity(); } catch(e) {}
}

function isDiscordEnabled() {
  return !!(db && db.settings && db.settings.discordPresence);
}

// ─── OAuth Security ───────────────────────────────────────────────────────────
// Pending state tokens for CSRF protection (state -> { timestamp })
const pendingOAuthStates = new Map();
const AUTH_TIMEOUT_MS = 5 * 60 * 1000; // 5 minute auth window timeout

function generateOAuthState() {
  const state = crypto.randomBytes(32).toString('hex');
  pendingOAuthStates.set(state, { timestamp: Date.now() });
  return state;
}

function validateOAuthState(state) {
  if (!state || !pendingOAuthStates.has(state)) return false;
  const entry = pendingOAuthStates.get(state);
  pendingOAuthStates.delete(state);
  // Reject if state is older than timeout
  return (Date.now() - entry.timestamp) < AUTH_TIMEOUT_MS;
}

// Strip sensitive tokens before sending account data to renderer
function sanitizeAccountsForRenderer(accounts) {
  if (!accounts) return {};
  const safe = {};
  const sensitiveKeys = [
    'accessToken', 'refreshToken', 'xblToken', 'xstsToken',
    'msAccessToken', 'msRefreshToken', 'userHash'
  ];
  for (const [platform, data] of Object.entries(accounts)) {
    if (!data || typeof data !== 'object') continue;
    safe[platform] = {};
    for (const [key, val] of Object.entries(data)) {
      if (!sensitiveKeys.includes(key)) {
        safe[platform][key] = val;
      }
    }
  }
  return safe;
}

// Allowed auth window navigation domains
const ALLOWED_AUTH_DOMAINS = [
  'steamcommunity.com', 'store.steampowered.com', 'login.steampowered.com',
  'login.gog.com', 'auth.gog.com', 'embed.gog.com', 'gog.com',
  'epicgames.com', 'www.epicgames.com',
  'login.microsoftonline.com', 'login.live.com', 'account.live.com',
  'localhost', 'cereal-launcher.local'
];

function isAllowedAuthDomain(url) {
  try {
    const hostname = new URL(url).hostname;
    return ALLOWED_AUTH_DOMAINS.some(d => hostname === d || hostname.endsWith('.' + d));
  } catch { return false; }
}

function createAuthWindow(width, height, authSession) {
  const win = new BrowserWindow({
    width, height,
    parent: mainWindow,
    modal: true,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, session: authSession },
  });
  win.setMenuBarVisibility(false);
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  return win;
}

// ─── HTTP helpers ─────────────────────────────────────────────────────────────
function httpGetJson(url, headers) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'CerealLauncher/1.0', ...(headers || {}) } }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
        catch (e) { resolve({ status: res.statusCode, data: null, raw: data }); }
      });
    }).on('error', e => reject(e));
  });
}

function httpPost(url, body, headers) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const postData = typeof body === 'string' ? body : new URLSearchParams(body).toString();
    const req = https.request({
      hostname: u.hostname, port: u.port || 443, path: u.pathname + u.search,
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(postData), 'User-Agent': 'CerealLauncher/1.0', ...(headers || {}) }
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
        catch (e) { resolve({ status: res.statusCode, data: null, raw: data }); }
      });
    });
    req.on('error', e => reject(e));
    req.write(postData);
    req.end();
  });
}

// ─── Bundled chiaki-ng path resolution ───────────────────────────────────────
// In dev: resources/chiaki-ng/  relative to project root
// In packaged app: process.resourcesPath/chiaki-ng/
function getChiakiDir() {
  // Packaged (asar) — resourcesPath points to <app>/resources/
  const packaged = path.join(process.resourcesPath || '', 'chiaki-ng');
  if (fs.existsSync(packaged)) return packaged;

  // Dev — relative to main.js location
  const dev = path.join(__dirname, 'resources', 'chiaki-ng');
  if (fs.existsSync(dev)) return dev;

  return null;
}

function getBundledChiakiExe() {
  const dir = getChiakiDir();
  if (!dir) return null;

  const candidates = ['chiaki.exe', 'chiaki-ng.exe'];

  // Top level
  for (const name of candidates) {
    const p = path.join(dir, name);
    if (fs.existsSync(p)) return p;
  }

  // One subdirectory deep (zip may extract into a folder)
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        for (const name of candidates) {
          const p = path.join(dir, entry.name, name);
          if (fs.existsSync(p)) return p;
        }
      }
    }
  } catch (e) { /* ignore */ }

  return null;
}

function getBundledChiakiVersion() {
  const dir = getChiakiDir();
  if (!dir) return null;
  const vf = path.join(dir, '.version');
  try { return fs.readFileSync(vf, 'utf-8').trim(); }
  catch (e) { return null; }
}

// --- Cover cache directory ---
function getCoversDir() {
  const dir = path.join(app.getPath('userData'), 'covers');
  try { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); } catch (e) {}
  return dir;
}

async function downloadToFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, (res) => {
      if (res.statusCode && res.statusCode >= 400) return reject(new Error('HTTP ' + res.statusCode));
      const file = fs.createWriteStream(destPath);
      res.pipe(file);
      file.on('finish', () => file.close(() => resolve(true)));
      file.on('error', (err) => reject(err));
    });
    req.on('error', reject);
  });
}

// Background fetch queue (simple FIFO)
const coverQueue = [];
let coverWorkerRunning = false;

function enqueueCoverFetch(gameId) {
  if (!gameId) return;
  if (!coverQueue.includes(gameId)) coverQueue.push(gameId);
  if (!coverWorkerRunning) processCoverQueue();
}

async function processCoverQueue() {
  coverWorkerRunning = true;
  while (coverQueue.length > 0) {
    const gid = coverQueue.shift();
    try {
      const game = db.games.find(g => g.id === gid);
      if (!game) continue;
      // Skip if already has local cover
      if (game.localCoverPath && fs.existsSync(game.localCoverPath)) continue;
      // Prefer coverUrl, then headerUrl, then screenshots
      const url = game.coverUrl || game.headerUrl || (game.screenshots && game.screenshots[0]);
      if (!url) continue;
      const ext = path.extname(new URL(url).pathname).split('?')[0] || '.jpg';
      const name = 'cover_' + gid + ext;
      const dest = path.join(getCoversDir(), name);
      try {
        await downloadToFile(url, dest);
        game.localCoverPath = dest;
        game._imgStamp = Date.now();
        saveDB(db);
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('games:refresh', db.games);
        console.log('[CoverFetcher] saved', dest);
      } catch (e) {
        console.log('[CoverFetcher] download failed for', url, e && e.message);
      }
      // small delay between downloads
      await new Promise(r => setTimeout(r, 250));
    } catch (e) {
      console.error('Cover queue worker error', e && e.message);
    }
  }
  coverWorkerRunning = false;
}

// ─── Chiaki Session Manager ──────────────────────────────────────────────────
// Manages chiaki-ng as a child process with JSON status event streaming.
// When chiaki supports --json-status or --cereal-mode, we parse structured
// events. Otherwise we fall back to log scraping.

const chiakiSessions = new Map(); // gameId -> session object

function resolveChiakiExe(fallbackPath) {
  // Priority: bundled > system > user-configured
  const bundled = getBundledChiakiExe();
  if (bundled) return bundled;

  const systemPaths = [
    path.join(process.env.ProgramFiles || '', 'chiaki-ng', 'chiaki.exe'),
    path.join(process.env['ProgramFiles(x86)'] || '', 'chiaki-ng', 'chiaki.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'chiaki-ng', 'chiaki.exe'),
    path.join(process.env.ProgramFiles || '', 'chiaki-ng', 'chiaki-ng.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'chiaki-ng', 'chiaki-ng.exe'),
    fallbackPath,
  ].filter(Boolean);

  return systemPaths.find(p => p && fs.existsSync(p)) || null;
}

function buildChiakiArgs(game, config) {
  const args = [];

  // Pre-built chiaki-ng uses standard named options, no subcommands
  if (game.chiakiHost)      args.push(`--host=${game.chiakiHost}`);
  if (game.chiakiRegistKey) args.push(`--regist-key=${game.chiakiRegistKey}`);
  if (game.chiakiMorning)   args.push(`--morning=${game.chiakiMorning}`);
  if (game.chiakiProfile)   args.push(`--profile=${game.chiakiProfile}`);
  if (game.chiakiFullscreen !== false && args.length > 0) args.push('--fullscreen');

  return args;
}

function startChiakiSession(gameId, chiakiExe, args) {
  // Kill existing session for this game if any
  stopChiakiSession(gameId);

  const chiakiDir = path.dirname(chiakiExe);
  const env = { ...process.env, PATH: `${chiakiDir};${process.env.PATH}` };

  const session = {
    gameId,
    process: null,
    state: 'launching',  // launching -> connecting -> streaming -> disconnected
    startTime: Date.now(),
    streamInfo: {},
    quality: {},
    lastEvent: null,
    exitCode: null,
  };

  const useGui = args.length === 0;

  if (useGui) {
    // No stream args — open chiaki GUI for manual console selection
    session.process = spawn(chiakiExe, [], {
      cwd: chiakiDir, env, detached: true, stdio: 'ignore'
    });
    session.process.unref();
    session.state = 'gui';
    chiakiSessions.set(gameId, session);
    sendChiakiEvent(gameId, 'state', { state: 'gui' });
    return session;
  }

  // Managed session with piped stdout for JSON events
  session.process = spawn(chiakiExe, args, {
    cwd: chiakiDir,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  // Parse stdout line by line for JSON status events
  const rl = readline.createInterface({ input: session.process.stdout });
  rl.on('line', (line) => {
    const trimmed = line.trim();
    // Try parsing as JSON event (from --json-status or --cereal-mode)
    if (trimmed.startsWith('{')) {
      try {
        const evt = JSON.parse(trimmed);
        handleChiakiJsonEvent(gameId, evt);
        return;
      } catch (e) { /* not valid JSON, fall through to log scraping */ }
    }
    // Log scraping fallback for unpatched chiaki builds
    handleChiakiLogLine(gameId, trimmed);
  });

  // Capture stderr for error reporting
  let stderrBuf = '';
  session.process.stderr.on('data', (chunk) => {
    stderrBuf += chunk.toString();
    // Keep only last 4KB
    if (stderrBuf.length > 4096) stderrBuf = stderrBuf.slice(-4096);
  });

  session.process.on('exit', (code, signal) => {
    session.exitCode = code;
    session.state = 'disconnected';

    // Stop Win32 embed helper
    stopEmbedHelper(session);

    // Interpret exit codes (from patch 005)
    let reason = 'unknown';
    let wasError = true;
    if (code === 0) { reason = 'clean_exit'; wasError = false; }
    else if (code === 1) { reason = 'transient_error'; }
    else if (code === 2) { reason = 'auth_error'; }
    else if (code === 3) { reason = 'console_not_found'; }
    else if (signal) { reason = 'killed'; wasError = false; }

    const elapsed = Math.floor((Date.now() - session.startTime) / 60000);

    sendChiakiEvent(gameId, 'disconnected', {
      reason, wasError, exitCode: code, signal,
      sessionMinutes: elapsed,
      stderr: wasError ? stderrBuf.slice(-1024) : '',
    });

    // Clear Discord presence when stream ends
    if (isDiscordEnabled()) clearDiscordPresence();

    // Auto-track playtime for the CURRENT title (may differ from original gameId after title switches)
    const trackId = session._currentGameId || gameId;
    const titleElapsed = session._titleStartTime ? Math.floor((Date.now() - session._titleStartTime) / 60000) : 0;
    if (titleElapsed > 0 && db) {
      const game = db.games.find(g => g.id === trackId);
      if (game) {
        game.playtimeMinutes = (game.playtimeMinutes || 0) + titleElapsed;
        game.lastPlayed = new Date().toISOString();
        saveDB(db);
      }
    }

    // Auto-reconnect for transient errors (patch 001 behavior in launcher)
    if (code === 1 && session._reconnectAttempts < 5) {
      session._reconnectAttempts = (session._reconnectAttempts || 0) + 1;
      const delay = Math.min(1000 * Math.pow(2, session._reconnectAttempts - 1), 16000);
      sendChiakiEvent(gameId, 'reconnecting', {
        attempt: session._reconnectAttempts, maxAttempts: 5, delayMs: delay,
      });
      session._reconnectTimer = setTimeout(() => {
        if (chiakiSessions.has(gameId)) {
          startChiakiSession(gameId, chiakiExe, args);
        }
      }, delay);
    } else {
      chiakiSessions.delete(gameId);
    }
  });

  session._reconnectAttempts = 0;
  session._currentTitleId = null;     // PS5-reported title ID
  session._currentGameId = gameId;    // Currently tracked game (may change via title_change)
  session._titleStartTime = Date.now();
  session.embedded = false;
  chiakiSessions.set(gameId, session);
  sendChiakiEvent(gameId, 'state', { state: 'launching' });

  // Start Win32 embed helper to reparent chiaki window into Electron
  startEmbedHelper(gameId, session);

  // Discord Rich Presence for chiaki streaming
  if (isDiscordEnabled()) {
    const game = db.games.find(g => g.id === gameId);
    if (game) {
      if (!discordRpc) connectDiscord();
      setDiscordPresence(game.name, game.platform);
    }
  }

  return session;
}

function stopChiakiSession(gameId) {
  const session = chiakiSessions.get(gameId);
  if (!session) return false;

  if (session._reconnectTimer) clearTimeout(session._reconnectTimer);

  // Stop the Win32 embed helper first
  stopEmbedHelper(session);

  if (session.process && !session.process.killed) {
    try {
      session.process.kill('SIGTERM');
      // Force-kill after 3 seconds if still alive
      setTimeout(() => {
        try { if (!session.process.killed) session.process.kill('SIGKILL'); }
        catch (e) { /* already dead */ }
      }, 3000);
    } catch (e) { /* already dead */ }
  }

  chiakiSessions.delete(gameId);
  return true;
}

// ─── xCloud (Xbox Cloud Gaming) WebContentsView Embedding ────────────────────

const xcloudSessions = new Map(); // gameId -> { view, state, startTime }

function getXcloudBounds() {
  // Same area as chiaki (full content minus 40px bar) but in CSS/logical pixels
  // since WebContentsView.setBounds uses logical pixels
  const [cw, ch] = mainWindow ? mainWindow.getContentSize() : [1280, 720];
  const barH = 40;
  return { x: 0, y: barH, width: cw, height: Math.max(1, ch - barH) };
}

function updateXcloudBounds(sess) {
  if (!sess || !sess.view) return;
  const b = getXcloudBounds();
  try { sess.view.setBounds(b); } catch (e) { /* view may be destroyed */ }
}

function updateAllXcloudBounds() {
  for (const sess of xcloudSessions.values()) {
    updateXcloudBounds(sess);
  }
}

function startXcloudSession(gameId, url) {
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

  mainWindow.contentView.addChildView(view);

  const sess = { gameId, view, state: 'loading', startTime: Date.now() };
  xcloudSessions.set(gameId, sess);

  updateXcloudBounds(sess);

  view.webContents.loadURL(url || 'https://www.xbox.com/play');

  view.webContents.on('dom-ready', () => {
    sess.state = 'streaming';
    sendStreamEvent(gameId, 'state', { state: 'streaming', platform: 'xbox' });
  });

  view.webContents.on('did-fail-load', (e, code, desc) => {
    sess.state = 'disconnected';
    sendStreamEvent(gameId, 'disconnected', { reason: desc, platform: 'xbox' });
  });

  sendStreamEvent(gameId, 'state', { state: 'connecting', platform: 'xbox' });
  return sess;
}

function stopXcloudSession(gameId) {
  const sess = xcloudSessions.get(gameId);
  if (!sess) return false;

  try { mainWindow.contentView.removeChildView(sess.view); } catch (e) { /* ok */ }
  try { sess.view.webContents.close(); } catch (e) { /* ok */ }

  xcloudSessions.delete(gameId);
  sendStreamEvent(gameId, 'disconnected', { reason: 'stopped', platform: 'xbox' });
  return true;
}

function getActiveXcloudSessions() {
  const result = {};
  for (const [gameId, sess] of xcloudSessions) {
    result[gameId] = { state: sess.state, platform: 'xbox', startTime: sess.startTime };
  }
  return result;
}

// ─── Win32 Stream Embedding ───────────────────────────────────────────────────

function getStreamBounds() {
  // Stream area is the Electron content area minus the 40px control bar at top.
  // getContentSize() returns logical (CSS) pixels; Win32 SetWindowPos uses physical pixels
  // when the process is PMv2 DPI-aware (which Electron is). Scale accordingly.
  const [cw, ch] = mainWindow ? mainWindow.getContentSize() : [1280, 720];
  let sf = 1;
  try {
    const { screen } = require('electron');
    const winBounds = mainWindow.getBounds();
    const disp = screen.getDisplayNearestPoint({ x: winBounds.x + winBounds.width / 2, y: winBounds.y + winBounds.height / 2 });
    sf = disp.scaleFactor || 1;
  } catch (e) { /* fallback sf=1 */ }
  const barH = Math.round(40 * sf);  // physical pixels for the 40px logical control bar
  return {
    x: 0, y: barH,
    w: Math.round(cw * sf),
    h: Math.max(1, Math.round(ch * sf) - barH),
  };
}

function startEmbedHelper(gameId, session) {
  if (process.platform !== 'win32') return;
  if (!mainWindow || !session.process) return;

  const hwndBuffer = mainWindow.getNativeWindowHandle();
  const hwnd = hwndBuffer.readBigUInt64LE(0).toString();
  const b = getStreamBounds();

  const psScript = path.join(__dirname, 'scripts', 'win32-stream.ps1');
  const ps = spawn('powershell.exe', [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', psScript,
    '-ChiakiPid', String(session.process.pid),
    '-ParentHwnd', hwnd,
    '-X', String(b.x), '-Y', String(b.y),
    '-W', String(b.w), '-H', String(b.h),
  ], { stdio: ['pipe', 'pipe', 'pipe'] });

  session.embedProcess = ps;

  const rl = readline.createInterface({ input: ps.stdout });
  rl.on('line', (line) => {
    const trimmed = line.trim();
    console.log('[win32-stream]', trimmed);
    if (trimmed === 'ready') {
      session.embedded = true;
      sendChiakiEvent(gameId, 'embedded', { embedded: true });
    } else if (trimmed.startsWith('error:')) {
      console.error('[win32-stream]', trimmed);
      sendChiakiEvent(gameId, 'embedded', { embedded: false, error: trimmed });
    }
  });

  ps.stderr.on('data', (d) => console.error('[win32-stream stderr]', d.toString().trimEnd()));
  ps.on('exit', () => { session.embedProcess = null; });
}

function stopEmbedHelper(session) {
  if (!session.embedProcess) return;
  const ps = session.embedProcess;
  session.embedProcess = null;
  try { ps.stdin.write('exit\n'); } catch (e) { /* ok */ }
  setTimeout(() => {
    try { if (!ps.killed) ps.kill(); } catch (e) { /* ok */ }
  }, 500);
}

function sendEmbedBoundsToAll() {
  if (!mainWindow) return;
  const b = getStreamBounds();
  for (const session of chiakiSessions.values()) {
    if (session.embedProcess && !session.embedProcess.killed) {
      try {
        session.embedProcess.stdin.write(`bounds ${b.x} ${b.y} ${b.w} ${b.h}\n`);
      } catch (e) { /* ok */ }
    }
  }
}

function handleChiakiJsonEvent(gameId, evt) {
  const session = chiakiSessions.get(gameId);
  if (!session) return;

  session.lastEvent = evt;

  switch (evt.event) {
    case 'connecting':
      session.state = 'connecting';
      sendChiakiEvent(gameId, 'state', { state: 'connecting', host: evt.host, console: evt.console });
      break;
    case 'streaming':
      session.state = 'streaming';
      session.streamInfo = { resolution: evt.resolution, codec: evt.codec, fps: evt.fps };
      sendChiakiEvent(gameId, 'state', { state: 'streaming', ...session.streamInfo });
      break;
    case 'quality':
      session.quality = { bitrate: evt.bitrate_mbps, packetLoss: evt.packet_loss, fpsActual: evt.fps_actual, latencyMs: evt.latency_ms };
      sendChiakiEvent(gameId, 'quality', session.quality);
      break;
    case 'title_change':
      handleChiakiTitleChange(gameId, evt);
      break;
    case 'disconnected':
      session.state = 'disconnected';
      sendChiakiEvent(gameId, 'chiaki_disconnect', { reason: evt.reason, wasError: evt.was_error });
      break;
    default:
      sendChiakiEvent(gameId, 'event', evt);
  }
}

// ─── PS Title Change Detection ──────────────────────────────────────────────
// When the PS5 reports a different running title, we:
//  1. Attribute elapsed time to the previous game
//  2. Switch the session's tracked game to the new one (auto-create if needed)
//  3. Update Discord Rich Presence
//  4. Notify the renderer

function handleChiakiTitleChange(originalGameId, evt) {
  const session = chiakiSessions.get(originalGameId);
  if (!session) return;

  const titleId = (evt.title_id || '').trim();
  const titleName = (evt.title_name || '').trim();
  const now = Date.now();

  // Skip if same title
  if (session._currentTitleId === titleId) return;

  // — Attribute elapsed minutes to the PREVIOUS game —
  if (session._currentGameId && session._titleStartTime) {
    const elapsed = Math.floor((now - session._titleStartTime) / 60000);
    if (elapsed > 0) {
      const prev = db.games.find(g => g.id === session._currentGameId);
      if (prev) {
        prev.playtimeMinutes = (prev.playtimeMinutes || 0) + elapsed;
        prev.lastPlayed = new Date().toISOString();
        saveDB(db);
      }
    }
  }

  // — Resolve or create the new game —
  session._currentTitleId = titleId;
  session._titleStartTime = now;

  if (!titleId) {
    // Returned to home screen — no game running
    session._currentGameId = null;
    if (isDiscordEnabled()) clearDiscordPresence();
    sendChiakiEvent(originalGameId, 'title_change', { titleId: '', titleName: '', gameId: null });
    return;
  }

  // Try matching by PS title ID against known games
  let matchedGame = db.games.find(g =>
    g.platform === 'psn' && g.platformId && g.platformId.toUpperCase() === titleId.toUpperCase()
  );

  // Fallback: fuzzy match by name
  if (!matchedGame && titleName) {
    const lower = titleName.toLowerCase();
    matchedGame = db.games.find(g =>
      g.platform === 'psn' && g.name && g.name.toLowerCase() === lower
    );
  }

  // Auto-create the game if not found
  if (!matchedGame && titleName) {
    matchedGame = {
      id: Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
      name: titleName,
      platform: 'psn',
      platformId: titleId,
      categories: [],
      coverUrl: '',
      playtimeMinutes: 0,
      lastPlayed: new Date().toISOString(),
      addedAt: new Date().toISOString(),
      favorite: false,
      // Inherit chiaki config from the original game
      chiakiNickname: (db.games.find(g => g.id === originalGameId) || {}).chiakiNickname || '',
      chiakiHost: (db.games.find(g => g.id === originalGameId) || {}).chiakiHost || '',
    };
    db.games.push(matchedGame);
    saveDB(db);
    // Notify renderer to refresh game list
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('games:refresh', db.games);
    }
  }

  // Update platformId if it was missing
  if (matchedGame && !matchedGame.platformId && titleId) {
    matchedGame.platformId = titleId;
    saveDB(db);
  }

  session._currentGameId = matchedGame ? matchedGame.id : null;

  // Update Discord
  if (isDiscordEnabled() && matchedGame) {
    setDiscordPresence(matchedGame.name, 'psn', session.startTime);
  }

  // Notify renderer
  sendChiakiEvent(originalGameId, 'title_change', {
    titleId,
    titleName,
    gameId: matchedGame ? matchedGame.id : null,
    gameName: matchedGame ? matchedGame.name : titleName,
  });
}

function handleChiakiLogLine(gameId, line) {
  const session = chiakiSessions.get(gameId);
  if (!session) return;

  // Heuristic log scraping for unpatched chiaki builds
  const lower = line.toLowerCase();
  if (lower.includes('session started') || lower.includes('stream connected')) {
    session.state = 'streaming';
    sendChiakiEvent(gameId, 'state', { state: 'streaming' });
  } else if (lower.includes('connecting to') || lower.includes('session init')) {
    session.state = 'connecting';
    sendChiakiEvent(gameId, 'state', { state: 'connecting' });
  } else if (lower.includes('disconnected') || lower.includes('session quit')) {
    // Don't override — the exit handler will manage this
  } else if (lower.includes('error') || lower.includes('failed')) {
    sendChiakiEvent(gameId, 'log', { level: 'error', message: line });
  }
}

function sendStreamEvent(gameId, type, data) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('chiaki:event', { gameId, type, ...data });
  }
}

function sendChiakiEvent(gameId, type, data) {
  sendStreamEvent(gameId, type, { platform: 'psn', ...data });
}

function getActiveSessions() {
  const result = {};
  for (const [gameId, session] of chiakiSessions) {
    result[gameId] = {
      state: session.state,
      startTime: session.startTime,
      streamInfo: session.streamInfo || {},
      quality: session.quality || {},
      exitCode: session.exitCode,
      reconnectAttempts: session._reconnectAttempts || 0,
    };
  }
  return result;
}

// ─── Database Setup ───────────────────────────────────────────────────────────
const DB_PATH = path.join(app ? app.getPath('userData') : '.', 'games.json');

function loadDB() {
  try {
    if (fs.existsSync(DB_PATH)) {
      return JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
    }
  } catch (e) {
    console.error('Failed to load DB:', e);
  }
  // Seed with placeholder games on first run
  const seed = {
    categories: ['Action', 'Adventure', 'RPG', 'Strategy', 'Puzzle', 'Simulation', 'Sports', 'FPS', 'Indie', 'Multiplayer'],
    playtime: {},
    games: [
      // ---- Steam ----
      { id:'1', name:'Cyberpunk 2077', platform:'steam', platformId:'1091500', coverUrl:'https://shared.steamstatic.com/store_item_assets/steam/apps/1091500/library_600x900_2x.jpg', categories:['Action','RPG'], playtimeMinutes:1240, lastPlayed:'2025-01-28T10:30:00Z', addedAt:'2024-06-15', favorite:true },
      { id:'2', name:'Elden Ring', platform:'steam', platformId:'1245620', coverUrl:'https://shared.steamstatic.com/store_item_assets/steam/apps/1245620/library_600x900_2x.jpg', categories:['Action','RPG','Adventure'], playtimeMinutes:840, lastPlayed:'2025-02-01T14:00:00Z', addedAt:'2024-03-10', favorite:true },
      { id:'3', name:'Hades', platform:'steam', platformId:'1145360', coverUrl:'https://shared.steamstatic.com/store_item_assets/steam/apps/1145360/library_600x900_2x.jpg', categories:['Action','Indie'], playtimeMinutes:320, lastPlayed:'2025-01-15T18:00:00Z', addedAt:'2024-08-20', favorite:false },
      { id:'4', name:"Baldur's Gate 3", platform:'steam', platformId:'1086940', coverUrl:'https://shared.steamstatic.com/store_item_assets/steam/apps/1086940/library_600x900_2x.jpg', categories:['RPG','Strategy'], playtimeMinutes:2100, lastPlayed:'2025-02-08T20:00:00Z', addedAt:'2024-01-05', favorite:false },
      { id:'5', name:'Hollow Knight', platform:'steam', platformId:'367520', coverUrl:'https://shared.steamstatic.com/store_item_assets/steam/apps/367520/library_600x900_2x.jpg', categories:['Action','Indie','Adventure'], playtimeMinutes:180, lastPlayed:'2025-01-10T16:00:00Z', addedAt:'2024-09-01', favorite:false },
      { id:'6', name:'DOOM Eternal', platform:'steam', platformId:'782330', coverUrl:'https://shared.steamstatic.com/store_item_assets/steam/apps/782330/library_600x900_2x.jpg', categories:['Action','FPS'], playtimeMinutes:440, lastPlayed:'2024-11-22T19:00:00Z', addedAt:'2024-04-10', favorite:false },
      { id:'7', name:'Stardew Valley', platform:'steam', platformId:'413150', coverUrl:'https://shared.steamstatic.com/store_item_assets/steam/apps/413150/library_600x900_2x.jpg', categories:['Simulation','Indie'], playtimeMinutes:680, lastPlayed:'2025-02-09T21:00:00Z', addedAt:'2024-07-01', favorite:true },
      { id:'8', name:'Celeste', platform:'steam', platformId:'504230', coverUrl:'https://shared.steamstatic.com/store_item_assets/steam/apps/504230/library_600x900_2x.jpg', categories:['Action','Indie'], playtimeMinutes:95, lastPlayed:'2025-01-05T14:30:00Z', addedAt:'2024-10-18', favorite:false },
      { id:'9', name:'Portal 2', platform:'steam', platformId:'620', coverUrl:'https://shared.steamstatic.com/store_item_assets/steam/apps/620/library_600x900_2x.jpg', categories:['Puzzle','Adventure'], playtimeMinutes:210, lastPlayed:'2024-09-14T11:00:00Z', addedAt:'2024-02-20', favorite:false },
      // ---- Epic ----
      { id:'10', name:'Fortnite', platform:'epic', platformId:'fortnite', coverUrl:'', categories:['Action','Multiplayer','FPS'], playtimeMinutes:3200, lastPlayed:'2025-02-10T22:00:00Z', addedAt:'2024-01-01', favorite:false },
      { id:'11', name:'Alan Wake 2', platform:'epic', platformId:'alanwake2', coverUrl:'', categories:['Action','Adventure'], playtimeMinutes:260, lastPlayed:'2025-01-18T20:30:00Z', addedAt:'2024-05-12', favorite:true },
      { id:'12', name:'Rocket League', platform:'epic', platformId:'rocketleague', coverUrl:'', categories:['Sports','Multiplayer'], playtimeMinutes:1560, lastPlayed:'2025-02-07T18:00:00Z', addedAt:'2024-03-22', favorite:false },
      // ---- GOG ----
      { id:'13', name:'The Witcher 3', platform:'gog', coverUrl:'', categories:['RPG','Adventure'], playtimeMinutes:560, lastPlayed:'2024-12-20', addedAt:'2024-02-14', favorite:false },
      { id:'14', name:'Disco Elysium', platform:'gog', coverUrl:'', categories:['RPG','Adventure'], playtimeMinutes:380, lastPlayed:'2024-10-05T16:00:00Z', addedAt:'2024-06-30', favorite:false },
      { id:'15', name:'Divinity: Original Sin 2', platform:'gog', coverUrl:'', categories:['RPG','Strategy'], playtimeMinutes:920, lastPlayed:'2025-01-02T12:00:00Z', addedAt:'2024-04-18', favorite:true },
      // ---- PlayStation ----
      { id:'16', name:'God of War Ragnarok', platform:'psn', coverUrl:'', categories:['Action','Adventure'], playtimeMinutes:420, lastPlayed:'2025-02-05', addedAt:'2024-07-20', favorite:true, chiakiNickname:'PS5-Living-Room', chiakiHost:'192.168.1.50', chiakiProfile:'default', chiakiFullscreen:true },
      { id:'17', name:"Marvel's Spider-Man 2", platform:'psn', coverUrl:'', categories:['Action','Adventure'], playtimeMinutes:340, lastPlayed:'2025-01-30T17:00:00Z', addedAt:'2024-08-05', favorite:false, chiakiNickname:'PS5-Living-Room', chiakiHost:'192.168.1.50', chiakiProfile:'', chiakiFullscreen:true },
      { id:'18', name:'Final Fantasy XVI', platform:'psn', coverUrl:'', categories:['RPG','Action'], playtimeMinutes:520, lastPlayed:'2025-01-12T20:00:00Z', addedAt:'2024-09-15', favorite:false },
      { id:'19', name:'Astro Bot', platform:'psn', coverUrl:'', categories:['Action','Adventure'], playtimeMinutes:140, lastPlayed:'2025-02-11T15:00:00Z', addedAt:'2024-12-25', favorite:true },
      { id:'20', name:"Demon's Souls", platform:'psn', coverUrl:'', categories:['Action','RPG'], playtimeMinutes:310, lastPlayed:'2024-11-08T21:30:00Z', addedAt:'2024-05-01', favorite:false },
      // ---- Xbox ----
      { id:'21', name:'Forza Horizon 5', platform:'xbox', coverUrl:'', categories:['Sports','Simulation'], playtimeMinutes:90, lastPlayed:'2025-01-22', addedAt:'2024-11-10', favorite:false, streamUrl:'https://www.xbox.com/play/games/forza-horizon-5/9NKX70BBCDRN' },
      { id:'22', name:'Halo Infinite', platform:'xbox', coverUrl:'', categories:['FPS','Action','Multiplayer'], playtimeMinutes:650, lastPlayed:'2025-02-03T19:00:00Z', addedAt:'2024-02-28', favorite:true, streamUrl:'https://www.xbox.com/play/games/halo-infinite/9PP5G1F0C2B6' },
      { id:'23', name:'Starfield', platform:'xbox', coverUrl:'', categories:['RPG','Adventure'], playtimeMinutes:480, lastPlayed:'2025-01-25T22:00:00Z', addedAt:'2024-06-10', favorite:false, streamUrl:'https://www.xbox.com/play/games/starfield/9NKX70BBCDRN' },
      { id:'24', name:'Sea of Thieves', platform:'xbox', coverUrl:'', categories:['Adventure','Multiplayer'], playtimeMinutes:220, lastPlayed:'2025-02-06T20:30:00Z', addedAt:'2024-08-14', favorite:false },
      { id:'25', name:'Grounded', platform:'xbox', coverUrl:'', categories:['Adventure','Simulation'], playtimeMinutes:170, lastPlayed:'2024-12-15T14:00:00Z', addedAt:'2024-10-22', favorite:false },
      // ---- Custom ----
      { id:'26', name:'Minecraft', platform:'custom', coverUrl:'', categories:['Simulation','Adventure'], playtimeMinutes:4500, lastPlayed:'2025-02-11T23:00:00Z', addedAt:'2024-01-15', favorite:true, executablePath:'C:/Games/Minecraft/minecraft.exe' },
      { id:'27', name:'RetroArch', platform:'custom', coverUrl:'', categories:['Action','Simulation'], playtimeMinutes:280, lastPlayed:'2025-01-20T16:00:00Z', addedAt:'2024-09-08', favorite:false, executablePath:'C:/RetroArch/retroarch.exe' },
    ]
  };
  saveDB(seed);
  return seed;
}

function saveDB(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

let db = null;

// ─── Window ───────────────────────────────────────────────────────────────────
let mainWindow;
let trayIcon = null;
let isQuitting = false;

function createWindow() {
  // Restore previous window bounds if present and allowed by settings
  const savedBounds = (db && db.settings && db.settings.rememberWindowBounds && db.settings.windowBounds) ? db.settings.windowBounds : null;
  const winOpts = {
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    frame: false,
    backgroundColor: '#0a0a0f',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
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

  mainWindow.loadFile('src/index.html');

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
  db = loadDB();
  createWindow();
  createTray();

  // Start minimized if enabled
  if (db.settings && db.settings.startMinimized) {
    mainWindow.hide();
  }

  // Auto-connect Discord if enabled
  if (isDiscordEnabled()) connectDiscord();

  // Auto-setup chiaki-ng if not present (first run)
  setTimeout(() => autoSetupChiakiIfMissing(), 3000);

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
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('update:event', { type: evt, data: evt === 'error' ? (data && data.message || String(data)) : data });
      }
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
ipcMain.handle('shell:openExternal', (event, url) => { const { shell } = require('electron'); return shell.openExternal(url); });

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

// ─── Game Metadata Fetching ──────────────────────────────────────────────────
// Default sources require ZERO accounts or API keys:
//   - Steam Store: searches Steam's entire catalog for any game
//   - Wikipedia: free encyclopedia API for descriptions + info
// Optional key-based sources: RAWG.io, IGDB, GiantBomb

const METADATA_CACHE = new Map();
const METADATA_CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days
let IGDB_TOKEN = null;
let IGDB_TOKEN_EXPIRES = 0;

function getMetadataSettings() {
  const s = db.settings || {};
  return {
    source: s.metadataSource || 'steam',
    rawgApiKey: s.rawgApiKey || '',
    igdbClientId: s.igdbClientId || '',
    igdbClientSecret: s.igdbClientSecret || '',
    giantbombApiKey: s.giantbombApiKey || '',
    steamGridDbKey: s.steamGridDbKey || '',
  };
}

function httpGet(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : require('http');
    mod.get(url, { headers: { 'User-Agent': 'CerealLauncher/1.0' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return httpGet(res.headers.location).then(resolve, reject);
      }
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try { resolve(JSON.parse(data)); }
          catch (e) { reject(new Error('Invalid JSON from ' + url)); }
        } else {
          reject(new Error('HTTP ' + res.statusCode + ' from ' + url));
        }
      });
      res.on('error', reject);
    }).on('error', reject);
  });
}

async function fetchSteamMetadata(appId) {
  try {
    const data = await httpGet(`https://store.steampowered.com/api/appdetails?appids=${appId}&l=english`);
    const info = data?.[appId]?.data;
    if (!info) return null;
    // Heuristic: detect if the Steam entry is non-game software
    let isSoftware = false;
    if (info.type && typeof info.type === 'string' && info.type.toLowerCase() !== 'game') isSoftware = true;
    if (!isSoftware && info.categories && Array.isArray(info.categories)) {
      try {
        if (info.categories.some(c => (c.description || '').toLowerCase().includes('software') || (c.description || '').toLowerCase().includes('utility') || (c.description || '').toLowerCase().includes('application'))) isSoftware = true;
      } catch (e) { /* ignore */ }
    }
    if (!isSoftware && info.genres && Array.isArray(info.genres)) {
      try { if (info.genres.some(g => (g.description || '').toLowerCase().includes('software'))) isSoftware = true; } catch(e){}
    }

    return {
      description: (info.short_description || '').slice(0, 500),
      developer: (info.developers || [])[0] || '',
      publisher: (info.publishers || [])[0] || '',
      releaseDate: info.release_date?.date || '',
      genres: (info.genres || []).map(g => g.description),
      coverUrl: `https://shared.steamstatic.com/store_item_assets/steam/apps/${appId}/library_600x900_2x.jpg`,
      headerUrl: info.header_image || `https://shared.steamstatic.com/store_item_assets/steam/apps/${appId}/library_hero.jpg`,
      screenshots: (info.screenshots || []).slice(0, 4).map(s => s.path_full),
      metacritic: info.metacritic?.score || null,
      website: info.website || '',
      _source: 'steam',
      isSoftware,
    };
  } catch (e) {
    console.log('[Metadata] Steam fetch failed for', appId, e.message);
    return null;
  }
}

// ─── Steam Store Search (NO KEY) ─────────────────────────────────────────────
// Searches Steam's entire store catalog by name, then fetches full metadata.
// Works for ANY game listed on Steam, not just ones the user owns.
async function fetchSteamSearchMetadata(gameName) {
  try {
    const q = encodeURIComponent(gameName);
    const search = await httpGet(`https://store.steampowered.com/api/storesearch/?term=${q}&l=english&cc=US`);
    if (!search?.items?.length) return null;

    // Best match by name
    const lower = gameName.toLowerCase().replace(/[^a-z0-9]/g, '');
    let best = search.items[0];
    for (const item of search.items) {
      if ((item.name || '').toLowerCase().replace(/[^a-z0-9]/g, '') === lower) { best = item; break; }
    }

    // Use the matched appId to get full details
    return await fetchSteamMetadata(String(best.id));
  } catch (e) {
    console.log('[Metadata] Steam search failed for', gameName, e.message);
    return null;
  }
}

// ─── Wikipedia API (NO KEY) ──────────────────────────────────────────────────
// Uses MediaWiki API to fetch game descriptions, images, and infobox data.
async function fetchWikipediaMetadata(gameName) {
  try {
    // Search Wikipedia for the game
    const q = encodeURIComponent(gameName + ' video game');
    const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${q}&srnamespace=0&srlimit=5&format=json`;
    const searchData = await httpGet(searchUrl);
    if (!searchData?.query?.search?.length) return null;

    // Best match
    const lower = gameName.toLowerCase().replace(/[^a-z0-9]/g, '');
    let bestTitle = searchData.query.search[0].title;
    for (const r of searchData.query.search) {
      const rLower = r.title.toLowerCase().replace(/[^a-z0-9]/g, '').replace(/videogame$/, '');
      if (rLower === lower) { bestTitle = r.title; break; }
    }

    // Fetch article extract + page image
    const title = encodeURIComponent(bestTitle);
    const detailUrl = `https://en.wikipedia.org/w/api.php?action=query&titles=${title}&prop=extracts|pageimages|revisions&exintro=true&explaintext=true&pithumbsize=600&rvprop=content&rvslots=main&rvsection=0&format=json`;
    const detailData = await httpGet(detailUrl);
    const pages = detailData?.query?.pages;
    if (!pages) return null;
    const page = Object.values(pages)[0];
    if (!page || page.missing !== undefined) return null;

    const extract = (page.extract || '').slice(0, 500);
    const thumbUrl = page.thumbnail?.source || '';

    // Try to parse infobox from wikitext for dev/publisher/date/genre
    const wikitext = page.revisions?.[0]?.slots?.main?.['*'] || '';
    const infoField = (field) => {
      const re = new RegExp('\\|\\s*' + field + '\\s*=\\s*(.+)', 'i');
      const m = wikitext.match(re);
      if (!m) return '';
      return m[1].replace(/\[\[([^|\]]*\|)?([^\]]*)\]\]/g, '$2').replace(/\{\{[^}]*\}\}/g, '').replace(/<[^>]+>/g, '').trim();
    };

    const developer = infoField('developer');
    const publisher = infoField('publisher');
    const released = infoField('released') || infoField('release_date');
    const genreRaw = infoField('genre');
    const genres = genreRaw ? genreRaw.split(/[,;]/).map(g => g.trim()).filter(Boolean).slice(0, 5) : [];

    // Only return valid results (must have at least a description)
    if (!extract && !developer) return null;

    return {
      description: extract,
      developer,
      publisher,
      releaseDate: released.replace(/\{\{.*?\}\}/g, '').trim().slice(0, 30),
      genres,
      coverUrl: thumbUrl,
      headerUrl: '',
      screenshots: [],
      metacritic: null,
      website: `https://en.wikipedia.org/wiki/${title}`,
      _source: 'wikipedia',
    };
  } catch (e) {
    console.log('[Metadata] Wikipedia fetch failed for', gameName, e.message);
    return null;
  }
}

async function fetchRAWGMetadata(gameName, platform) {
  const ms = getMetadataSettings();
  const apiKey = ms.rawgApiKey;
  try {
    const platMap = { steam: '4', epic: '4', gog: '4', psn: '187,18', xbox: '1,186', custom: '' };
    const platParam = platMap[platform] || '';
    const q = encodeURIComponent(gameName);
    let url = `https://api.rawg.io/api/games?search=${q}&page_size=5&search_precise=true`;
    if (apiKey) url += '&key=' + apiKey;
    if (platParam) url += '&platforms=' + platParam;

    const data = await httpGet(url);
    if (!data?.results?.length) return null;

    // Pick best match by name similarity
    const lower = gameName.toLowerCase().replace(/[^a-z0-9]/g, '');
    let best = data.results[0];
    for (const r of data.results) {
      const rLower = (r.name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      if (rLower === lower) { best = r; break; }
    }

    // Fetch detail for description
    let detail = null;
    try {
      let detailUrl = `https://api.rawg.io/api/games/${best.id}`;
      if (apiKey) detailUrl += '?key=' + apiKey;
      detail = await httpGet(detailUrl);
    } catch (e) { /* skip detail */ }

    // Clean HTML from description
    const rawDesc = detail?.description_raw || detail?.description || '';
    const cleanDesc = rawDesc.replace(/<[^>]+>/g, '').slice(0, 500);

    return {
      description: cleanDesc,
      developer: (detail?.developers || best.developers || []).map(d => d.name)[0] || '',
      publisher: (detail?.publishers || []).map(p => p.name)[0] || '',
      releaseDate: best.released || '',
      genres: (best.genres || []).map(g => g.name),
      coverUrl: best.background_image || '',
      headerUrl: best.background_image || '',
      screenshots: (detail?.screenshots || best.short_screenshots || []).slice(0, 4).map(s => s.image || s),
      metacritic: best.metacritic || null,
      rating: best.rating || null,
      website: detail?.website || '',
      rawgSlug: best.slug || '',
      _source: 'rawg',
    };
  } catch (e) {
    console.log('[Metadata] RAWG fetch failed for', gameName, e.message);
    return null;
  }
}

// ─── IGDB via Twitch API ──────────────────────────────────────────────────────
async function getIGDBToken() {
  const ms = getMetadataSettings();
  if (!ms.igdbClientId || !ms.igdbClientSecret) return null;
  if (IGDB_TOKEN && Date.now() < IGDB_TOKEN_EXPIRES) return IGDB_TOKEN;
  try {
    const url = `https://id.twitch.tv/oauth2/token?client_id=${ms.igdbClientId}&client_secret=${ms.igdbClientSecret}&grant_type=client_credentials`;
    const data = await new Promise((resolve, reject) => {
      const req = https.request(url, { method: 'POST' }, (res) => {
        let body = '';
        res.on('data', c => body += c);
        res.on('end', () => { try { resolve(JSON.parse(body)); } catch(e) { reject(e); } });
      });
      req.on('error', reject);
      req.end();
    });
    if (data.access_token) {
      IGDB_TOKEN = data.access_token;
      IGDB_TOKEN_EXPIRES = Date.now() + (data.expires_in - 60) * 1000;
      return IGDB_TOKEN;
    }
    return null;
  } catch (e) {
    console.log('[Metadata] IGDB token fetch failed:', e.message);
    return null;
  }
}

function igdbPost(endpoint, body) {
  const ms = getMetadataSettings();
  return new Promise((resolve, reject) => {
    const req = https.request(`https://api.igdb.com/v4/${endpoint}`, {
      method: 'POST',
      headers: {
        'Client-ID': ms.igdbClientId,
        'Authorization': 'Bearer ' + IGDB_TOKEN,
        'Content-Type': 'text/plain',
      },
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('Invalid IGDB JSON')); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function fetchIGDBMetadata(gameName, platform) {
  try {
    const token = await getIGDBToken();
    if (!token) return null;

    const platMap = { steam: '6', epic: '6', gog: '6', psn: '167,48', xbox: '169,49', custom: '' };
    const platFilter = platMap[platform] || '';
    let query = `search "${gameName.replace(/"/g, '')}"; fields name,summary,storyline,first_release_date,genres.name,cover.image_id,screenshots.image_id,involved_companies.company.name,involved_companies.developer,involved_companies.publisher,aggregated_rating,websites.url,websites.category; limit 5;`;
    if (platFilter) query += ` where platforms = (${platFilter});`;

    const results = await igdbPost('games', query);
    if (!results?.length) return null;

    // Best match
    const lower = gameName.toLowerCase().replace(/[^a-z0-9]/g, '');
    let best = results[0];
    for (const r of results) {
      if ((r.name || '').toLowerCase().replace(/[^a-z0-9]/g, '') === lower) { best = r; break; }
    }

    const coverId = best.cover?.image_id;
    const coverUrl = coverId ? `https://images.igdb.com/igdb/image/upload/t_cover_big/${coverId}.jpg` : '';
    const headerUrl = coverId ? `https://images.igdb.com/igdb/image/upload/t_screenshot_big/${coverId}.jpg` : '';
    const screenshots = (best.screenshots || []).slice(0, 4).map(s => `https://images.igdb.com/igdb/image/upload/t_screenshot_big/${s.image_id}.jpg`);
    const devCompany = (best.involved_companies || []).find(c => c.developer);
    const pubCompany = (best.involved_companies || []).find(c => c.publisher);
    const officialSite = (best.websites || []).find(w => w.category === 1);

    return {
      description: (best.summary || '').slice(0, 500),
      developer: devCompany?.company?.name || '',
      publisher: pubCompany?.company?.name || '',
      releaseDate: best.first_release_date ? new Date(best.first_release_date * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '',
      genres: (best.genres || []).map(g => g.name),
      coverUrl,
      headerUrl: screenshots[0] || headerUrl,
      screenshots,
      metacritic: best.aggregated_rating ? Math.round(best.aggregated_rating) : null,
      website: officialSite?.url || '',
      _source: 'igdb',
    };
  } catch (e) {
    console.log('[Metadata] IGDB fetch failed for', gameName, e.message);
    return null;
  }
}

// ─── GiantBomb API ────────────────────────────────────────────────────────────
async function fetchGiantBombMetadata(gameName, platform) {
  const ms = getMetadataSettings();
  if (!ms.giantbombApiKey) return null;
  try {
    const q = encodeURIComponent(gameName);
    const url = `https://www.giantbomb.com/api/search/?api_key=${ms.giantbombApiKey}&format=json&query=${q}&resources=game&limit=5`;
    const data = await httpGet(url);
    if (!data?.results?.length) return null;

    const lower = gameName.toLowerCase().replace(/[^a-z0-9]/g, '');
    let best = data.results[0];
    for (const r of data.results) {
      if ((r.name || '').toLowerCase().replace(/[^a-z0-9]/g, '') === lower) { best = r; break; }
    }

    // Fetch detail
    let detail = null;
    if (best.api_detail_url) {
      try {
        detail = await httpGet(best.api_detail_url + '?api_key=' + ms.giantbombApiKey + '&format=json');
        detail = detail?.results || null;
      } catch (e) { /* skip */ }
    }

    const desc = (detail?.deck || best.deck || '').slice(0, 500);
    const devs = (detail?.developers || []).map(d => d.name);
    const pubs = (detail?.publishers || []).map(p => p.name);
    const genres = (detail?.genres || []).map(g => g.name);

    return {
      description: desc,
      developer: devs[0] || '',
      publisher: pubs[0] || '',
      releaseDate: best.original_release_date ? new Date(best.original_release_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '',
      genres,
      coverUrl: best.image?.medium_url || best.image?.small_url || '',
      headerUrl: best.image?.screen_large_url || best.image?.super_url || '',
      screenshots: (detail?.images || []).slice(0, 4).map(i => i.medium_url || i.small_url),
      metacritic: null,
      website: detail?.site_detail_url || '',
      _source: 'giantbomb',
    };
  } catch (e) {
    console.log('[Metadata] GiantBomb fetch failed for', gameName, e.message);
    return null;
  }
}

// ─── Platform-specific Store Fetchers (best-effort, public endpoints) ─────────
async function fetchEpicMetadata(gameName) {
  try {
    const q = encodeURIComponent(gameName);
    const url = `https://store-site-backend-static.ak.epicgames.com/api/en-US/content/products?locale=en-US&country=US&search=${q}`;
    const data = await httpGet(url);
    const el = data?.elements?.[0] || (data?.catalog?.searchStore?.elements && data.catalog.searchStore.elements[0]);
    if (!el) return null;
    const title = el.title || el.offerMappings?.[0]?.pageSlug || gameName;
    return {
      description: (el.description || el.longDescription || '').slice(0, 500),
      developer: (el.developer || el.seller || '') || '',
      publisher: el.publisher || '',
      releaseDate: el.effectiveDate || '',
      genres: (el.categories || []).map(c => c.path || c.title || c).slice(0,5),
      coverUrl: el.keyImages?.find(k => k.type === 'Code')?.url || el.keyImages?.[0]?.url || '',
      headerUrl: el.keyImages?.find(k => k.type === 'OfferImageWide')?.url || '',
      screenshots: [],
      metacritic: null,
      website: el.productSlug ? `https://www.epicgames.com/store/en-US/p/${el.productSlug}` : '',
      _source: 'epic',
    };
  } catch (e) {
    console.log('[Metadata] Epic fetch failed for', gameName, e.message);
    return null;
  }
}

async function fetchGOGMetadata(gameName) {
  try {
    const q = encodeURIComponent(gameName);
    const url = `https://catalog.gog.com/v1/products?search=${q}&limit=6&country=US`;
    const data = await httpGet(url);
    const item = data?.products?.[0] || (Array.isArray(data) && data[0]);
    if (!item) return null;
    return {
      description: (item.description && (item.description.split('\n')[0])) || '',
      developer: item.developer || '',
      publisher: item.publisher || '',
      releaseDate: item.releaseDate || item.release_date || '',
      genres: (item.genres || []).map(g => g.name || g).slice(0,5),
      coverUrl: item.image?.med || item.image?.small || '',
      headerUrl: item.image?.full || '',
      screenshots: [],
      metacritic: null,
      website: item.url || '',
      _source: 'gog',
    };
  } catch (e) {
    console.log('[Metadata] GOG fetch failed for', gameName, e.message);
    return null;
  }
}

async function fetchPSNMetadata(gameName) {
  try {
    const q = encodeURIComponent(gameName);
    const url = `https://store.playstation.com/store/api/search/v3?platform=ps5,ps4&query=${q}&size=6&store=us`;
    const data = await httpGet(url);
    const item = data?.results?.[0] || (Array.isArray(data) && data[0]);
    if (!item) return null;
    return {
      description: (item.short_description || item.long_description || '').slice(0, 500),
      developer: item.developer || '',
      publisher: item.publisher || '',
      releaseDate: item.releaseDate || item.release_date || '',
      genres: (item.genres || []).map(g => g.name || g).slice(0,5),
      coverUrl: item.thumbnail || item.image || '',
      headerUrl: item.hero || '',
      screenshots: [],
      metacritic: null,
      website: item.url || '',
      _source: 'psn',
    };
  } catch (e) {
    console.log('[Metadata] PSN fetch failed for', gameName, e.message);
    return null;
  }
}

async function fetchXboxMetadata(gameName) {
  try {
    const q = encodeURIComponent(gameName);
    const url = `https://displaycatalog.mp.microsoft.com/v7.0/products?market=US&languages=en-US&query=${q}&take=6`;
    const data = await httpGet(url);
    const prod = data?.Products?.[0] || (Array.isArray(data) && data[0]);
    if (!prod) return null;
    const title = prod.LocalizedProperties?.[0] || {};
    return {
      description: (title.ProductDescription || '').slice(0,500),
      developer: prod.Publisher || '',
      publisher: prod.Publisher || '',
      releaseDate: prod.ReleaseDate || '',
      genres: (prod.Genres || []).map(g => g.Name || g).slice(0,5),
      coverUrl: title.Images?.find(i=>i.Type===0)?.Uri || '',
      headerUrl: title.Images?.find(i=>i.Type===1)?.Uri || '',
      screenshots: [],
      metacritic: null,
      website: prod.ProductUrl || '',
      _source: 'xbox',
    };
  } catch (e) {
    console.log('[Metadata] Xbox fetch failed for', gameName, e.message);
    return null;
  }
}

async function fetchGameMetadata(game) {
  if (!game || !game.name) return null;

  // Check cache
  const cacheKey = (game.platform || '') + ':' + (game.platformId || game.name);
  const cached = METADATA_CACHE.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < METADATA_CACHE_TTL) {
    return cached.data;
  }

  const ms = getMetadataSettings();
  let meta = null;
  // Try platform-specific sources first (prefer platform store data when possible)
  if (game.platform === 'steam') {
    if (game.platformId) {
      meta = await fetchSteamMetadata(game.platformId);
    }
    // If no appId or steam lookup failed, try a Steam name search
    if (!meta) meta = await fetchSteamSearchMetadata(game.name);
  } else if (game.platform) {
    // Try platform store fetchers first (Epic, GOG, PSN, Xbox)
    try {
      if (game.platform === 'epic') meta = await fetchEpicMetadata(game.name);
      else if (game.platform === 'gog') meta = await fetchGOGMetadata(game.name);
      else if (game.platform === 'psn' || game.platform === 'psremote') meta = await fetchPSNMetadata(game.name);
      else if (game.platform === 'xbox') meta = await fetchXboxMetadata(game.name);
    } catch (e) { meta = null; }
    // Fallback to third-party aggregators when platform store lookup fails
    if (!meta) {
      try { meta = await fetchRAWGMetadata(game.name, game.platform); } catch (e) { meta = null; }
      if (!meta) {
        try { meta = await fetchIGDBMetadata(game.name, game.platform); } catch (e) { meta = null; }
      }
    }
  }

  // Fallback: Use the preferred metadata source configured by the user
  if (!meta) {
    switch (ms.source) {
      case 'steam':
        // Search Steam catalog by name (works for any game on Steam)
        meta = await fetchSteamSearchMetadata(game.name);
        if (!meta) meta = await fetchWikipediaMetadata(game.name);
        break;
      case 'wikipedia':
        meta = await fetchWikipediaMetadata(game.name);
        if (!meta) meta = await fetchSteamSearchMetadata(game.name);
        break;
      case 'rawg':
        meta = await fetchRAWGMetadata(game.name, game.platform);
        if (!meta) meta = await fetchSteamSearchMetadata(game.name);
        break;
      case 'igdb':
        meta = await fetchIGDBMetadata(game.name, game.platform);
        if (!meta) meta = await fetchSteamSearchMetadata(game.name);
        break;
      case 'giantbomb':
        meta = await fetchGiantBombMetadata(game.name, game.platform);
        if (!meta) meta = await fetchSteamSearchMetadata(game.name);
        break;
      default:
        meta = await fetchSteamSearchMetadata(game.name);
        if (!meta) meta = await fetchWikipediaMetadata(game.name);
        break;
    }
  }

  if (meta) {
    METADATA_CACHE.set(cacheKey, { data: meta, timestamp: Date.now() });
  }
  return meta;
}

function applyMetadataToGame(game, meta) {
  if (!meta) return false;
  let changed = false;

  // Only fill in missing data — don't overwrite user customizations
  if (!game.coverUrl) {
    const coverFallback = meta.coverUrl || meta.headerUrl || (meta.screenshots && meta.screenshots[0]) || '';
    if (coverFallback) { game.coverUrl = coverFallback; changed = true; }
  }
  if (!game.description && meta.description) { game.description = meta.description; changed = true; }
  if (!game.developer && meta.developer) { game.developer = meta.developer; changed = true; }
  if (!game.publisher && meta.publisher) { game.publisher = meta.publisher; changed = true; }
  if (!game.releaseDate && meta.releaseDate) { game.releaseDate = meta.releaseDate; changed = true; }
  if ((!game.categories || game.categories.length === 0) && meta.genres?.length) { game.categories = meta.genres; changed = true; }
  if (!game.headerUrl) {
    const headerFallback = meta.headerUrl || meta.coverUrl || (meta.screenshots && meta.screenshots[0]) || '';
    if (headerFallback) { game.headerUrl = headerFallback; changed = true; }
  }
  if ((!game.screenshots || game.screenshots.length === 0) && meta.screenshots?.length) { game.screenshots = meta.screenshots; changed = true; }
  if (game.metacritic == null && meta.metacritic != null) { game.metacritic = meta.metacritic; changed = true; }
  if (!game.website && meta.website) { game.website = meta.website; changed = true; }

  // Merge metadata categories/genres/type into game's categories (preserve existing user tags)
  try {
    const existing = (game.categories || []).filter(Boolean).map(c => String(c).trim());
    const add = [];
    if (meta.genres && Array.isArray(meta.genres)) {
      for (const g of meta.genres) if (g) add.push(String(g).trim());
    }
    if (meta.categories && Array.isArray(meta.categories)) {
      for (const c of meta.categories) if (c) add.push(String(c).trim());
    }
    if (meta.type && typeof meta.type === 'string') {
      const t = meta.type.trim();
      if (t && t.toLowerCase() !== 'game') add.push(t.charAt(0).toUpperCase() + t.slice(1));
    }
    if (add.length > 0) {
      const merged = Array.from(new Map([...existing, ...add].map(x => [x.toLowerCase(), x])).values());
      // If merged differs from existing, update
      const existingNorm = existing.map(x => x.toLowerCase()).join('|');
      const mergedNorm = merged.map(x => x.toLowerCase()).join('|');
      if (mergedNorm !== existingNorm) {
        game.categories = merged;
        changed = true;
      }
    }
  } catch (e) {}

  // If metadata indicates this Steam entry is non-game software, mark it
  if (meta._source === 'steam' && meta.isSoftware) {
    if (!game.software) { game.software = true; changed = true; }
    // Also add a visible category tag so UI filters catch it
    try {
      const cats = game.categories || [];
      if (!cats.some(c=>typeof c==='string' && c.toLowerCase()==='software')) {
        game.categories = [...cats, 'Software'];
        changed = true;
      }
    } catch(e){}
  }

  return changed;
}

// ─── Game CRUD ────────────────────────────────────────────────────────────────
ipcMain.handle('games:getAll', () => db.games);
ipcMain.handle('games:getCategories', () => db.categories);

ipcMain.handle('games:add', (event, game) => {
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
    db.games[db.games.findIndex(g => g.id === prev.id)] = merged;
    saveDB(db);
    console.log('[Main] games:update (dedupe merged)', merged.id, 'coverUrl=', merged.coverUrl, '_imgStamp=', merged._imgStamp);
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('games:refresh', db.games);
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
  console.log('[Main] games:add', game.id, 'coverUrl=', game.coverUrl, '_imgStamp=', game._imgStamp);

  // Auto-fetch metadata in the background
  fetchGameMetadata(game).then(meta => {
    if (meta && applyMetadataToGame(game, meta)) {
      saveDB(db);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('games:refresh', db.games);
      }
    }
  }).catch(() => {});

  // Enqueue cover fetch for newly added game
  try { enqueueCoverFetch(game.id); } catch(e) {}

  return game;
});

ipcMain.handle('games:update', (event, updatedGame) => {
  const idx = db.games.findIndex(g => g.id === updatedGame.id);
  if (idx !== -1) {
    const prev = db.games[idx];
    const merged = { ...prev, ...updatedGame };
    // If cover/header changed on update, bump the stamp so renderer reloads
    try {
      const coverChanged = (typeof updatedGame.coverUrl === 'string' && updatedGame.coverUrl !== prev.coverUrl);
      const headerChanged = (typeof updatedGame.headerUrl === 'string' && updatedGame.headerUrl !== prev.headerUrl);
      if (coverChanged || headerChanged) merged._imgStamp = Date.now();
      else merged._imgStamp = prev._imgStamp;
    } catch (e) { merged._imgStamp = prev._imgStamp; }
    db.games[idx] = merged;
    console.log('[Main] games:update', merged.id, 'coverUrl=', merged.coverUrl, '_imgStamp=', merged._imgStamp, 'localCoverPath=', merged.localCoverPath);
    saveDB(db);
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('games:refresh', db.games);
    // If cover URL changed, enqueue fetch
    try { enqueueCoverFetch(updatedGame.id); } catch(e) {}
    return db.games[idx];
  }
  return null;
});

ipcMain.handle('games:delete', (event, id) => {
  db.games = db.games.filter(g => g.id !== id);
  saveDB(db);
  return true;
});

ipcMain.handle('games:toggleFavorite', (event, id) => {
  const game = db.games.find(g => g.id === id);
  if (game) {
    game.favorite = !game.favorite;
    saveDB(db);
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
ipcMain.handle('keys:set', async (event, {service, account, secret}) => {
  try {
    safeStore.setPassword(service, account, secret);
    return {ok: true};
  } catch (err) {
    console.error('keys:set error', err);
    return {ok: false, error: err && err.message};
  }
});

ipcMain.handle('keys:get', async (event, {service, account}) => {
  try {
    const secret = safeStore.getPassword(service, account);
    return {ok: true, secret};
  } catch (err) {
    console.error('keys:get error', err);
    return {ok: false, error: err && err.message};
  }
});

ipcMain.handle('keys:delete', async (event, {service, account}) => {
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
    // If provider module exposes validateKey, use it
    if (providers && providers[provider] && typeof providers[provider].validateKey === 'function') {
      try {
        const res = await providers[provider].validateKey(apiKey);
        return { ok: !!res.ok, provider, info: res.info, error: res.error };
      } catch (e) { return { ok: false, provider, error: e && e.message }; }
    }

    // Fallback: legacy steam check
    if (provider === 'steam') {
      const url = `https://api.steampowered.com/ISteamWebAPIUtil/GetServerInfo/v1/?key=${encodeURIComponent(apiKey)}`;
      const res = await httpGetJson(url);
      if (res && res.status === 200 && res.data) {
        return { ok: true, provider: 'steam', info: res.data };
      }
      return { ok: false, provider: 'steam', error: res && res.data };
    }

    return { ok: false, error: 'unknown-provider' };
  } catch (err) {
    console.error('keys:validate error', err);
    return {ok: false, error: err && err.message};
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
                const md5 = require('crypto').createHash('md5').update(fn).digest('hex');
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

  async function searchRAWG() {
    if (!ms.rawgApiKey) return [];
    const results = [];
    const q = encodeURIComponent(gameName);
    const data = await httpGet(`https://api.rawg.io/api/games?search=${q}&page_size=3&key=${ms.rawgApiKey}`);
    if (data?.results) {
      for (const r of data.results.slice(0, 3)) {
        if (r.background_image) results.push({ url: r.background_image, type: 'header', source: 'RAWG', label: r.name });
        if (r.short_screenshots) {
          for (const ss of r.short_screenshots.slice(0, 2)) {
            if (ss.image) results.push({ url: ss.image, type: 'screenshot', source: 'RAWG', label: r.name + ' - Screenshot' });
          }
        }
      }
    }
    return results;
  }

  async function searchIGDB() {
    if (!ms.igdbClientId || !ms.igdbClientSecret) return [];
    const token = await getIGDBToken();
    if (!token) return [];
    const results = [];
    const query = `search "${gameName.replace(/"/g, '')}"; fields name,cover.image_id,screenshots.image_id,artworks.image_id; limit 5;`;
    const games = await igdbPost('games', query);
    if (!games?.length) return results;
    const lower = gameName.toLowerCase().replace(/[^a-z0-9]/g, '');
    let best = games[0];
    for (const r of games) {
      if ((r.name || '').toLowerCase().replace(/[^a-z0-9]/g, '') === lower) { best = r; break; }
    }
    const name = best.name || gameName;
    if (best.cover?.image_id) {
      results.push({ url: `https://images.igdb.com/igdb/image/upload/t_cover_big/${best.cover.image_id}.jpg`, type: 'cover', source: 'IGDB', label: name + ' - Cover' });
      results.push({ url: `https://images.igdb.com/igdb/image/upload/t_720p/${best.cover.image_id}.jpg`, type: 'header', source: 'IGDB', label: name + ' - Cover HD' });
    }
    if (best.artworks?.length) {
      for (const a of best.artworks.slice(0, 3)) {
        results.push({ url: `https://images.igdb.com/igdb/image/upload/t_screenshot_big/${a.image_id}.jpg`, type: 'header', source: 'IGDB', label: name + ' - Artwork' });
      }
    }
    if (best.screenshots?.length) {
      for (const s of best.screenshots.slice(0, 3)) {
        results.push({ url: `https://images.igdb.com/igdb/image/upload/t_screenshot_big/${s.image_id}.jpg`, type: 'screenshot', source: 'IGDB', label: name + ' - Screenshot' });
      }
    }
    return results;
  }

  async function searchSteamGridDB() {
    if (!ms.steamGridDbKey) return [];
    const results = [];
    const q = encodeURIComponent(gameName);
    // Search for the game first
    const searchData = await new Promise((resolve, reject) => {
      https.get(`https://www.steamgriddb.com/api/v2/search/autocomplete/${q}`, {
        headers: { 'Authorization': 'Bearer ' + ms.steamGridDbKey },
      }, (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => { try { resolve(JSON.parse(data)); } catch(e) { reject(e); } });
        res.on('error', reject);
      }).on('error', reject);
    });
    if (!searchData?.success || !searchData?.data?.length) return results;
    const gameId = searchData.data[0].id;
    const gamLabel = searchData.data[0].name || gameName;
    // Fetch portrait grids (covers), landscape grids (headers), heroes (banners), and logos in parallel
    const fetchSGDB = (type, params) => new Promise((resolve, reject) => {
      https.get(`https://www.steamgriddb.com/api/v2/${type}/game/${gameId}?${params || 'limit=6'}`, {
        headers: { 'Authorization': 'Bearer ' + ms.steamGridDbKey },
      }, (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => { try { resolve(JSON.parse(data)); } catch(e) { reject(e); } });
        res.on('error', reject);
      }).on('error', reject);
    });
    const [portraitGrids, landscapeGrids, heroes, logos] = await Promise.allSettled([
      fetchSGDB('grids', 'dimensions=600x900&limit=8'),
      fetchSGDB('grids', 'dimensions=460x215,920x430&limit=4'),
      fetchSGDB('heroes', 'limit=4'),
      fetchSGDB('logos', 'limit=2'),
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
      if (images.length > 0) console.log('[ArtSearch] Using Steam fallback images');
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
    const meta = await fetchGameMetadata(game);
    if (!meta) return { error: 'No metadata found' };
      if (force) {
        // Force-apply: overwrite all fields (with sensible fallbacks)
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
        saveDB(db);
        return { success: true, game };
      } else {
      const changed = applyMetadataToGame(game, meta);
      if (changed) saveDB(db);
      return { success: true, game };
    }
  } catch (e) {
    return { error: e.message };
  }
});

ipcMain.handle('metadata:fetchAll', async () => {
  let updated = 0;
  let failed = 0;
  const total = db.games.length;
  for (let i = 0; i < db.games.length; i++) {
    const game = db.games[i];
    try {
      const meta = await fetchGameMetadata(game);
      if (meta && applyMetadataToGame(game, meta)) updated++;
    } catch (e) { failed++; }
    if (mainWindow) mainWindow.webContents.send('metadata:progress', { current: i + 1, total, updated, failed, name: game.name });
    // Small delay to avoid rate limiting
    await new Promise(r => setTimeout(r, 300));
  }
  if (updated > 0) saveDB(db);
  return { updated, failed, total };
});

// ─── SteamGridDB Browser Login (opens external auth flow and prompts for API key)
ipcMain.handle('steamgriddb:login', async () => {
  try {
    const { shell, dialog } = require('electron');
    // Open SteamGridDB profile prefs where user can generate an API key
    await shell.openExternal('https://www.steamgriddb.com/profile/preferences/api');
    // Prompt user to paste the key
    const { response, checkboxChecked } = await dialog.showMessageBox(mainWindow, {
      type: 'info',
      buttons: ['Paste API Key', 'Cancel'],
      defaultId: 0,
      message: 'SteamGridDB Login',
      detail: 'This will open SteamGridDB in your browser. After generating an API key, click "Paste API Key" and paste it into the next prompt.'
    });
    if (response !== 0) return { cancelled: true };
    const { canceled, result } = await dialog.showMessageBox(mainWindow, {
      type: 'none',
      buttons: ['OK'],
      title: 'Paste API Key',
      message: 'Paste your SteamGridDB API key into the settings page when prompted.'
    });
    // We can't read clipboard directly via dialog; instruct user to paste into settings input.
    return { success: true };
  } catch (e) {
    return { error: e.message };
  }
});

// Clipboard read helper for renderer (used to paste API keys)
ipcMain.handle('clipboard:readText', () => {
  try {
    const { clipboard } = require('electron');
    return clipboard.readText();
  } catch (e) {
    return '';
  }
});


// ─── Launch Game ──────────────────────────────────────────────────────────────
ipcMain.handle('games:launch', (event, id) => {
  const game = db.games.find(g => g.id === id);
  if (!game) return { success: false, error: 'Game not found' };

  try {
    let launchPath = game.executablePath;

    // Platform-specific launch
    if (game.platform === 'steam' && game.platformId) {
      // Launch via Steam protocol
      shell.openExternal(`steam://rungameid/${game.platformId}`);
    } else if (game.platform === 'epic' && game.platformId) {
      shell.openExternal(`com.epicgames.launcher://apps/${game.platformId}?action=launch&silent=true`);
    } else if (game.platform === 'gog' && game.platformId) {
      shell.openExternal(`goggalaxy://openGameView/${game.platformId}`);
    } else if (game.platform === 'psremote' || game.platform === 'psn') {
      // Launch via integrated chiaki-ng session manager
      const chiakiExe = resolveChiakiExe(launchPath);
      if (!chiakiExe) {
        return { success: false, error: 'chiaki-ng not found. It should download automatically — try again in a moment, or check Settings > PlayStation.' };
      }

      const chiakiConfig = db.chiakiConfig || {};
      const args = buildChiakiArgs(game, chiakiConfig);
      const session = startChiakiSession(id, chiakiExe, args);
    } else if (game.platform === 'xbox') {
      // Xbox — embed xCloud in-app or launch via Xbox app
      const url = game.streamUrl || 'https://www.xbox.com/play';
      startXcloudSession(id, url);
    } else if (launchPath && fs.existsSync(launchPath)) {
      const gameDir = path.dirname(launchPath);
      spawn(launchPath, [], { cwd: gameDir, detached: true, stdio: 'ignore' }).unref();
    } else {
      return { success: false, error: 'Executable not found' };
    }

    // Track playtime start
    game.lastPlayed = new Date().toISOString();
    saveDB(db);

    // Minimize window on launch if enabled
    if (db.settings && db.settings.minimizeOnLaunch && mainWindow) {
      mainWindow.minimize();
    }

    // Discord Rich Presence
    if (isDiscordEnabled()) {
      if (!discordRpc) connectDiscord();
      setDiscordPresence(game.name, game.platform);
    }

    return { success: true };
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

// ─── Steam Game Detection ─────────────────────────────────────────────────────
ipcMain.handle('detect:steam', async () => {
  const games = [];

  try {
    // Common Steam install paths on Windows
    const steamPaths = [
      'C:\\Program Files (x86)\\Steam',
      'C:\\Program Files\\Steam',
      path.join(process.env.HOME || process.env.USERPROFILE || '', 'Steam')
    ];

    let steamRoot = null;
    for (const p of steamPaths) {
      if (fs.existsSync(p)) { steamRoot = p; break; }
    }

    if (!steamRoot) return { games: [], error: 'Steam not found' };

    // Read libraryfolders.vdf to find all library paths
    const libraryFolders = [path.join(steamRoot, 'steamapps')];
    const vdfPath = path.join(steamRoot, 'steamapps', 'libraryfolders.vdf');

    if (fs.existsSync(vdfPath)) {
      const vdfContent = fs.readFileSync(vdfPath, 'utf-8');
      const pathMatches = vdfContent.match(/"path"\s+"([^"]+)"/g);
      if (pathMatches) {
        pathMatches.forEach(m => {
          const p = m.match(/"path"\s+"([^"]+)"/)[1].replace(/\\\\/g, '\\');
          const appsDir = path.join(p, 'steamapps');
          if (fs.existsSync(appsDir) && !libraryFolders.includes(appsDir)) {
            libraryFolders.push(appsDir);
          }
        });
      }
    }

    // Scan each library folder for .acf manifest files
    for (const libFolder of libraryFolders) {
      if (!fs.existsSync(libFolder)) continue;
      const files = fs.readdirSync(libFolder).filter(f => f.endsWith('.acf'));

      for (const file of files) {
        try {
          const content = fs.readFileSync(path.join(libFolder, file), 'utf-8');
          const appid = content.match(/"appid"\s+"(\d+)"/);
          const name = content.match(/"name"\s+"([^"]+)"/);
          const installdir = content.match(/"installdir"\s+"([^"]+)"/);

          if (appid && name && installdir) {
            const gamePath = path.join(libFolder, 'common', installdir[1]);
            games.push({
              name: name[1],
              platform: 'steam',
              platformId: appid[1],
              installPath: gamePath,
              executablePath: '', // User may need to set this
              coverUrl: `https://shared.steamstatic.com/store_item_assets/steam/apps/${appid[1]}/library_600x900_2x.jpg`,
              heroUrl: `https://shared.steamstatic.com/store_item_assets/steam/apps/${appid[1]}/library_hero.jpg`,
              categories: [],
              source: 'auto-detected'
            });
          }
        } catch (e) { /* skip bad manifest */ }
      }
    }
  } catch (err) {
    return { games: [], error: err.message };
  }

  return { games };
});

// ─── Epic Games Detection ─────────────────────────────────────────────────────
ipcMain.handle('detect:epic', async () => {
  const games = [];

  try {
    const manifestDir = path.join(
      process.env.PROGRAMDATA || 'C:\\ProgramData',
      'Epic', 'EpicGamesLauncher', 'Data', 'Manifests'
    );

    if (!fs.existsSync(manifestDir)) return { games: [], error: 'Epic Games not found' };

    const files = fs.readdirSync(manifestDir).filter(f => f.endsWith('.item'));

    for (const file of files) {
      try {
        const content = JSON.parse(fs.readFileSync(path.join(manifestDir, file), 'utf-8'));
        if (content.DisplayName && content.InstallLocation) {
          games.push({
            name: content.DisplayName,
            platform: 'epic',
            platformId: content.CatalogNamespace || content.AppName,
            installPath: content.InstallLocation,
            executablePath: content.LaunchExecutable
              ? path.join(content.InstallLocation, content.LaunchExecutable) : '',
            coverUrl: '',
            categories: [],
            source: 'auto-detected'
          });
        }
      } catch (e) { /* skip bad manifest */ }
    }
  } catch (err) {
    return { games: [], error: err.message };
  }

  return { games };
});

// ─── GOG Detection ────────────────────────────────────────────────────────────
ipcMain.handle('detect:gog', async () => {
  const games = [];

  try {
    // GOG Galaxy stores game info in its database
    const gogDbPath = path.join(
      process.env.PROGRAMDATA || 'C:\\ProgramData',
      'GOG.com', 'Galaxy', 'storage', 'galaxy-2.0.db'
    );

    // Fallback: scan registry-like paths or common install dirs
    const gogGamesDir = 'C:\\GOG Games';
    const gogProgramFiles = path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'GOG Galaxy', 'Games');

    const dirsToScan = [gogGamesDir, gogProgramFiles].filter(fs.existsSync);

    for (const dir of dirsToScan) {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const gameDir = path.join(dir, entry.name);
          // Look for goggame-*.info files
          const infoFiles = fs.readdirSync(gameDir).filter(f => f.startsWith('goggame-') && f.endsWith('.info'));
          for (const infoFile of infoFiles) {
            try {
              const info = JSON.parse(fs.readFileSync(path.join(gameDir, infoFile), 'utf-8'));
              if (info.name) {
                games.push({
                  name: info.name,
                  platform: 'gog',
                  platformId: info.gameId || '',
                  installPath: gameDir,
                  executablePath: info.playTasks?.[0]?.path
                    ? path.join(gameDir, info.playTasks[0].path) : '',
                  coverUrl: '',
                  categories: [],
                  source: 'auto-detected'
                });
              }
            } catch (e) { /* skip */ }
          }
        }
      }
    }
  } catch (err) {
    return { games: [], error: err.message };
  }

  return { games };
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
      const systemPaths = [
        path.join(process.env.ProgramFiles || '', 'chiaki-ng', 'chiaki.exe'),
        path.join(process.env['ProgramFiles(x86)'] || '', 'chiaki-ng', 'chiaki.exe'),
        path.join(process.env.LOCALAPPDATA || '', 'chiaki-ng', 'chiaki.exe'),
      ];
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
        const listOutput = execSync(`"${result.executablePath}" list`, {
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

// ─── Xbox Game Pass / Xbox App Detection ──────────────────────────────────────
ipcMain.handle('detect:xbox', async () => {
  const games = [];

  try {
    // Method 1: Scan Xbox App packages via registry-like approach
    // Xbox PC games install to WindowsApps or XboxGames folder
    const xboxGamesDirs = [
      'C:\\XboxGames',
      path.join(process.env.ProgramFiles || '', 'WindowsApps'),
      path.join(process.env.LOCALAPPDATA || '', 'Packages'),
    ];

    // Scan XboxGames directory (common custom install location)
    const xboxGamesDir = 'C:\\XboxGames';
    if (fs.existsSync(xboxGamesDir)) {
      const entries = fs.readdirSync(xboxGamesDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory() && entry.name !== 'Content') {
          games.push({
            name: entry.name.replace(/([A-Z])/g, ' $1').trim(), // CamelCase to spaces
            platform: 'xbox',
            platformId: '',
            installPath: path.join(xboxGamesDir, entry.name),
            executablePath: '',
            coverUrl: '',
            categories: [],
            source: 'auto-detected',
          });
        }
      }
    }

    // Method 2: Check if Xbox app is installed for cloud gaming
    const xboxAppPaths = [
      path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WindowsApps', 'XboxApp.exe'),
      path.join(process.env.ProgramFiles || '', 'WindowsApps', 'Microsoft.GamingApp_*'),
    ];

    let xboxAppFound = false;
    for (const p of xboxAppPaths) {
      if (p.includes('*')) {
        // Glob-style check
        const dir = path.dirname(p);
        const prefix = path.basename(p).replace('*', '');
        if (fs.existsSync(dir)) {
          const matches = fs.readdirSync(dir).filter(f => f.startsWith(prefix));
          if (matches.length > 0) xboxAppFound = true;
        }
      } else if (fs.existsSync(p)) {
        xboxAppFound = true;
      }
    }

    return { games, xboxAppFound, cloudGamingUrl: 'https://www.xbox.com/play' };
  } catch (err) {
    return { games: [], xboxAppFound: false, error: err.message };
  }
});

// ─── Playtime Sync from Platforms ─────────────────────────────────────────────
ipcMain.handle('playtime:sync', async () => {
  const updated = [];
  try {
    // ── Steam playtime via Steam Web API or local stats ──
    const steamPaths = [
      'C:\\Program Files (x86)\\Steam',
      'C:\\Program Files\\Steam',
      path.join(process.env.HOME || process.env.USERPROFILE || '', 'Steam')
    ];
    let steamRoot = null;
    for (const p of steamPaths) {
      if (fs.existsSync(p)) { steamRoot = p; break; }
    }
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

    if (updated.length > 0) saveDB(db);
  } catch (err) {
    return { updated: [], error: err.message };
  }

  return { updated, games: db.games };
});

// ─── Settings ─────────────────────────────────────────────────────────────────
const DEFAULT_SETTINGS = {
  defaultView: 'orbit',          // 'orbit' | 'cards'
  accentColor: '#d4a853',        // hex color
  starDensity: 'normal',         // 'low' | 'normal' | 'high'
  showAnimations: true,
  rememberWindowBounds: true,    // whether to restore & save window position/size
  autoSyncPlaytime: false,
  minimizeOnLaunch: false,
  closeToTray: false,
  defaultTab: 'all',             // 'all' | 'favorites' | 'recent' | platform key
  discordPresence: false,        // show currently playing on Discord
  metadataSource: 'steam',       // 'steam' | 'wikipedia' | 'rawg' | 'igdb' | 'giantbomb'
  rawgApiKey: '',                // RAWG.io API key (needed for RAWG)
  igdbClientId: '',              // Twitch/IGDB Client ID
  igdbClientSecret: '',          // Twitch/IGDB Client Secret
  giantbombApiKey: '',           // GiantBomb API key
  launchOnStartup: false,        // start app when Windows boots
  startMinimized: false,         // start hidden to tray
};

ipcMain.handle('settings:get', () => {
  return { ...DEFAULT_SETTINGS, ...(db.settings || {}) };
});

ipcMain.handle('settings:save', (event, newSettings) => {
  db.settings = { ...DEFAULT_SETTINGS, ...(db.settings || {}), ...newSettings };
  saveDB(db);

  // Connect/disconnect Discord RPC based on setting
  if (db.settings.discordPresence) {
    if (!discordRpc) connectDiscord();
  } else {
    disconnectDiscord();
  }

  // Update Windows startup registration
  if ('launchOnStartup' in newSettings) {
    try { app.setLoginItemSettings({ openAtLogin: !!newSettings.launchOnStartup }); } catch (e) { /* ok */ }
  }

  return db.settings;
});

ipcMain.handle('settings:reset', () => {
  db.settings = { ...DEFAULT_SETTINGS };
  saveDB(db);
  return db.settings;
});

ipcMain.handle('settings:exportLibrary', async () => {
  const { dialog } = require('electron');
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Export Library',
    defaultPath: 'cereal-library.json',
    filters: [{ name: 'JSON', extensions: ['json'] }]
  });
  if (result.canceled || !result.filePath) return { cancelled: true };
  try {
    const exportData = { games: db.games, categories: db.categories, accounts: db.accounts || {}, exportedAt: new Date().toISOString() };
    fs.writeFileSync(result.filePath, JSON.stringify(exportData, null, 2));
    return { success: true, path: result.filePath };
  } catch (e) {
    return { error: e.message };
  }
});

ipcMain.handle('settings:importLibrary', async () => {
  const { dialog } = require('electron');
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Import Library',
    filters: [{ name: 'JSON', extensions: ['json'] }],
    properties: ['openFile']
  });
  if (result.canceled || !result.filePaths.length) return { cancelled: true };
  try {
    const raw = fs.readFileSync(result.filePaths[0], 'utf-8');
    const imported = JSON.parse(raw);
    let addedCount = 0;
    if (imported.games && Array.isArray(imported.games)) {
      const existingIds = new Set(db.games.map(g => g.name + '|' + g.platform));
      for (const g of imported.games) {
        const key = g.name + '|' + g.platform;
        if (!existingIds.has(key)) {
          g.id = Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
          db.games.push(g);
          existingIds.add(key);
          addedCount++;
        }
      }
    }
    if (imported.categories && Array.isArray(imported.categories)) {
      const catSet = new Set(db.categories);
      imported.categories.forEach(c => catSet.add(c));
      db.categories = [...catSet];
    }
    saveDB(db);
    return { success: true, added: addedCount, games: db.games, categories: db.categories };
  } catch (e) {
    return { error: e.message };
  }
});

ipcMain.handle('settings:clearCovers', () => {
  for (const game of db.games) {
    if (game.platform === 'steam' && game.platformId) {
      game.coverUrl = `https://shared.steamstatic.com/store_item_assets/steam/apps/${game.platformId}/library_600x900_2x.jpg`;
      game.headerUrl = `https://shared.steamstatic.com/store_item_assets/steam/apps/${game.platformId}/library_hero.jpg`;
    } else {
      game.coverUrl = '';
      game.headerUrl = '';
    }
  }
  saveDB(db);
  return { success: true, games: db.games };
});

ipcMain.handle('settings:clearAllGames', () => {
  db.games = [];
  saveDB(db);
  return { success: true };
});

ipcMain.handle('settings:getDataPath', () => {
  return DB_PATH;
});

ipcMain.handle('settings:getAppVersion', () => {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf-8'));
    return pkg.version || '1.0.0';
  } catch (e) {
    return '1.0.0';
  }
});

// ─── Auto-Update ──────────────────────────────────────────────────────────────
ipcMain.handle('update:check', () => {
  return autoUpdater.checkForUpdates().catch((err) => ({ error: err.message }));
});
ipcMain.handle('update:install', () => {
  autoUpdater.quitAndInstall();
});

// ─── Platform Account Sign-in ─────────────────────────────────────────────────
ipcMain.handle('accounts:get', () => {
  return sanitizeAccountsForRenderer(db.accounts || {});
});

ipcMain.handle('accounts:save', (event, platform, data) => {
  // Only allow saving safe display fields from the renderer - tokens are managed by main process only
  if (!platform || typeof platform !== 'string') return sanitizeAccountsForRenderer(db.accounts || {});
  const allowedKeys = ['connected', 'displayName', 'gamertag', 'avatarUrl', 'lastSync', 'gameCount'];
  if (!db.accounts) db.accounts = {};
  if (!db.accounts[platform]) db.accounts[platform] = {};
  for (const [key, val] of Object.entries(data || {})) {
    if (allowedKeys.includes(key)) {
      db.accounts[platform][key] = val;
    }
  }
  saveDB(db);
  return sanitizeAccountsForRenderer(db.accounts);
});

ipcMain.handle('accounts:remove', (event, platform) => {
  if (!db.accounts) db.accounts = {};
  if (db.accounts[platform]) {
    // Securely wipe all token data before deleting
    const tokenKeys = ['accessToken', 'refreshToken', 'xblToken', 'xstsToken', 'msAccessToken', 'msRefreshToken', 'userHash'];
    for (const key of tokenKeys) {
      if (db.accounts[platform][key]) {
        db.accounts[platform][key] = null;
      }
    }
    delete db.accounts[platform];
  }
  saveDB(db);
  return sanitizeAccountsForRenderer(db.accounts);
});

// ── Steam OpenID Sign-in ──
const STEAM_OPENID_URL = 'https://steamcommunity.com/openid/login';
const STEAM_RETURN_URL = 'https://cereal-launcher.local/steam-callback';

ipcMain.handle('accounts:steam:auth', async () => {
  return new Promise((resolve) => {
    const params = new URLSearchParams({
      'openid.ns': 'http://specs.openid.net/auth/2.0',
      'openid.mode': 'checkid_setup',
      'openid.return_to': STEAM_RETURN_URL,
      'openid.realm': 'https://cereal-launcher.local/',
      'openid.identity': 'http://specs.openid.net/auth/2.0/identifier_select',
      'openid.claimed_id': 'http://specs.openid.net/auth/2.0/identifier_select',
    });
    const authSession = session.fromPartition('auth:steam:' + Date.now());
    const authWin = createAuthWindow(900, 700, authSession);
    let resolved = false;
    let authTimeout = null;
    const cleanup = () => {
      if (authTimeout) { clearTimeout(authTimeout); authTimeout = null; }
      try { authSession.clearStorageData(); } catch(e) {}
    };
    authTimeout = setTimeout(() => {
      if (!resolved) { resolved = true; cleanup(); try { authWin.close(); } catch(e) {} resolve({ error: 'Authentication timed out' }); }
    }, AUTH_TIMEOUT_MS);
    authWin.webContents.on('will-navigate', (event, url) => {
      if (url.startsWith(STEAM_RETURN_URL)) { event.preventDefault(); handleNav(url); return; }
      if (!isAllowedAuthDomain(url)) { event.preventDefault(); }
    });
    const handleNav = (url) => {
      if (resolved) return;
      if (url.startsWith(STEAM_RETURN_URL)) {
        resolved = true;
        cleanup();
        try {
          const u = new URL(url);
          const claimedId = u.searchParams.get('openid.claimed_id') || '';
          const idMatch = claimedId.match(/(\d{17})$/);
          if (!idMatch) { authWin.close(); resolve({ error: 'Could not extract Steam ID' }); return; }
          const steamId = idMatch[1];
          authWin.close();
          httpGetJson(`https://steamcommunity.com/profiles/${steamId}/?xml=1`).then(async r => {
            const raw = r.raw || '';
            const getName = t => { const m = raw.match(new RegExp('<' + t + '><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></' + t + '>')); return m ? m[1] : null; };
            const getTag = t => { const m = raw.match(new RegExp('<' + t + '>([^<]*)</' + t + '>')); return m ? m[1] : null; };
            const displayName = getName('steamID') || getTag('steamID') || 'Steam User';
            const avatarUrl = getTag('avatarMedium') || getTag('avatarFull') || '';
            if (!db.accounts) db.accounts = {};
            db.accounts.steam = {
              steamId,
              displayName,
              avatarUrl,
              connected: true,
            };
            saveDB(db);
            resolve({ success: true, steamId, displayName, avatarUrl });
          }).catch(e => resolve({ error: e.message }));
        } catch (e) { authWin.close(); resolve({ error: e.message }); }
      }
    };
    authWin.webContents.on('will-redirect', (event, url) => { if (url.startsWith(STEAM_RETURN_URL)) { event.preventDefault(); handleNav(url); } });
    authWin.webContents.on('did-navigate', (event, url) => handleNav(url));
    authWin.on('closed', () => { cleanup(); if (!resolved) { resolved = true; resolve({ error: 'cancelled' }); } });
    authWin.loadURL(STEAM_OPENID_URL + '?' + params.toString());
  });
});

ipcMain.handle('accounts:steam:import', async () => {
  if (!providers || !providers.steam || !providers.steam.importLibrary) return { error: 'Steam provider not available' };
  try {
    const notify = (evt) => { try { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('import:progress', { provider: 'steam', ...evt }); } catch(e) {} };
    let apiKey = null;
    try { const r = safeStore.getPassword('cereal-steam', 'default'); if (r) apiKey = r; } catch(e) {}
    const res = await providers.steam.importLibrary({ db, saveDB, notify, apiKey });
    return res;
  } catch (e) { return { error: 'Steam import failed: ' + e.message }; }
});

// ── GOG OAuth2 ──
const GOG_CLIENT_ID = '46899977096215655';
const GOG_CLIENT_SECRET = '9d85c43b1482497dbbce61f6e4aa173a433796eeae2571a61f67c3cbc6b19c65';
const GOG_REDIRECT = 'https://embed.gog.com/on_login_success?origin=client';

ipcMain.handle('accounts:gog:auth', async () => {
  return new Promise((resolve) => {
    const oauthState = generateOAuthState();
    const authSession = session.fromPartition('auth:gog:' + Date.now());
    const authWin = createAuthWindow(500, 700, authSession);
    let resolved = false;
    let authTimeout = null;
    const cleanup = () => {
      if (authTimeout) { clearTimeout(authTimeout); authTimeout = null; }
      try { authSession.clearStorageData(); } catch(e) {}
    };
    authTimeout = setTimeout(() => {
      if (!resolved) { resolved = true; cleanup(); try { authWin.close(); } catch(e) {} resolve({ error: 'Authentication timed out' }); }
    }, AUTH_TIMEOUT_MS);
    const authUrl = `https://login.gog.com/auth?client_id=${GOG_CLIENT_ID}&redirect_uri=${encodeURIComponent(GOG_REDIRECT)}&response_type=code&layout=client2&state=${oauthState}`;
    const handleUrl = (url) => {
      if (resolved) return;
      if (url.includes('on_login_success') && url.includes('code=')) {
        resolved = true;
        cleanup();
        try {
          const u = new URL(url);
          const code = u.searchParams.get('code');
          // Validate CSRF state if returned by server
          const returnedState = u.searchParams.get('state');
          if (returnedState && !validateOAuthState(returnedState)) {
            authWin.close();
            resolve({ error: 'Security validation failed (state mismatch)' });
            return;
          }
          authWin.close();
          httpGetJson(`https://auth.gog.com/token?client_id=${GOG_CLIENT_ID}&client_secret=${GOG_CLIENT_SECRET}&grant_type=authorization_code&code=${encodeURIComponent(code)}&redirect_uri=${encodeURIComponent(GOG_REDIRECT)}`).then(r => {
            if (r.data?.access_token) {
              if (!db.accounts) db.accounts = {};
              db.accounts.gog = {
                accessToken: r.data.access_token,
                refreshToken: r.data.refresh_token,
                expiresAt: Date.now() + (r.data.expires_in || 3600) * 1000,
                userId: r.data.user_id,
                connected: true,
              };
              saveDB(db);
              resolve({ success: true, userId: r.data.user_id });
            } else {
              resolve({ error: 'Token exchange failed' });
            }
          }).catch(e => resolve({ error: e.message }));
        } catch (e) { resolve({ error: e.message }); }
      }
    };
    // Restrict navigation to allowed domains
    authWin.webContents.on('will-navigate', (event, url) => {
      if (url.includes('on_login_success')) { handleUrl(url); return; }
      if (!isAllowedAuthDomain(url)) { event.preventDefault(); }
    });
    authWin.webContents.on('will-redirect', (event, url) => handleUrl(url));
    authWin.webContents.on('did-navigate', (event, url) => handleUrl(url));
    authWin.on('closed', () => { cleanup(); if (!resolved) { resolved = true; resolve({ error: 'cancelled' }); } });
    authWin.loadURL(authUrl);
  });
});

async function refreshGogToken() {
  const acct = (db.accounts || {}).gog;
  if (!acct?.refreshToken) return false;
  try {
    const r = await httpGetJson(`https://auth.gog.com/token?client_id=${GOG_CLIENT_ID}&client_secret=${GOG_CLIENT_SECRET}&grant_type=refresh_token&refresh_token=${encodeURIComponent(acct.refreshToken)}`);
    if (r.data?.access_token) {
      acct.accessToken = r.data.access_token;
      acct.refreshToken = r.data.refresh_token || acct.refreshToken;
      acct.expiresAt = Date.now() + (r.data.expires_in || 3600) * 1000;
      saveDB(db);
      return true;
    }
  } catch (e) { /* ignore */ }
  return false;
}

ipcMain.handle('accounts:gog:import', async () => {
  if (!providers || !providers.gog || !providers.gog.importLibrary) return { error: 'GOG provider not available' };
  try {
    const notify = (evt) => { try { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('import:progress', { provider: 'gog', ...evt }); } catch(e) {} };
    const res = await providers.gog.importLibrary({ db, saveDB, notify });
    return res;
  } catch (e) { return { error: 'GOG import failed: ' + e.message }; }
});

// ── Epic Games OAuth ──
const EPIC_CLIENT_ID = 'xyza7891muomRmynIITa';
const EPIC_REDIRECT = 'https://localhost/epic-callback';

ipcMain.handle('accounts:epic:auth', async () => {
  return new Promise((resolve) => {
    const oauthState = generateOAuthState();
    const authSession = session.fromPartition('auth:epic:' + Date.now());
    const authWin = createAuthWindow(800, 700, authSession);
    let resolved = false;
    let authTimeout = null;
    const cleanup = () => {
      if (authTimeout) { clearTimeout(authTimeout); authTimeout = null; }
      try { authSession.clearStorageData(); } catch(e) {}
    };
    authTimeout = setTimeout(() => {
      if (!resolved) { resolved = true; cleanup(); try { authWin.close(); } catch(e) {} resolve({ error: 'Authentication timed out' }); }
    }, AUTH_TIMEOUT_MS);
    const authUrl = `https://www.epicgames.com/id/authorize?client_id=${EPIC_CLIENT_ID}&response_type=code&redirect_uri=${encodeURIComponent(EPIC_REDIRECT)}&scope=basic_profile&state=${oauthState}`;
    const handleUrl = (url) => {
      if (resolved) return;
      if (url.startsWith(EPIC_REDIRECT) || url.startsWith('https://localhost/epic-callback')) {
        resolved = true;
        cleanup();
        try {
          const u = new URL(url);
          const code = u.searchParams.get('code');
          const returnedState = u.searchParams.get('state');
          authWin.close();
          if (!code) { resolve({ error: 'No authorization code received' }); return; }
          // Validate CSRF state
          if (returnedState && !validateOAuthState(returnedState)) {
            resolve({ error: 'Security validation failed (state mismatch)' });
            return;
          }
          const basicAuth = Buffer.from(EPIC_CLIENT_ID + ':').toString('base64');
          httpPost('https://account-public-service-prod.ol.epicgames.com/account/api/oauth/token', {
            grant_type: 'authorization_code',
            code,
            redirect_uri: EPIC_REDIRECT,
          }, { 'Authorization': 'Basic ' + basicAuth }).then(r => {
            if (r.data?.access_token) {
              if (!db.accounts) db.accounts = {};
              db.accounts.epic = {
                accessToken: r.data.access_token,
                refreshToken: r.data.refresh_token,
                expiresAt: Date.now() + (r.data.expires_in || 3600) * 1000,
                accountId: r.data.account_id,
                displayName: r.data.displayName || r.data.display_name || 'Epic User',
                connected: true,
              };
              saveDB(db);
              resolve({ success: true, displayName: db.accounts.epic.displayName });
            } else {
              resolve({ error: 'Token exchange failed (status ' + r.status + ')' });
            }
          }).catch(e => resolve({ error: e.message }));
        } catch (e) { authWin.close(); resolve({ error: e.message }); }
      }
    };
    authWin.webContents.on('will-navigate', (event, url) => {
      if (url.startsWith(EPIC_REDIRECT)) { event.preventDefault(); handleUrl(url); return; }
      if (!isAllowedAuthDomain(url)) { event.preventDefault(); }
    });
    authWin.webContents.on('will-redirect', (event, url) => { if (url.startsWith(EPIC_REDIRECT)) { event.preventDefault(); handleUrl(url); } });
    authWin.webContents.on('did-navigate', (event, url) => handleUrl(url));
    authWin.on('closed', () => { cleanup(); if (!resolved) { resolved = true; resolve({ error: 'cancelled' }); } });
    authWin.loadURL(authUrl);
  });
});

async function refreshEpicToken() {
  const acct = (db.accounts || {}).epic;
  if (!acct?.refreshToken) return false;
  try {
    const basicAuth = Buffer.from(EPIC_CLIENT_ID + ':').toString('base64');
    const r = await httpPost('https://account-public-service-prod.ol.epicgames.com/account/api/oauth/token', {
      grant_type: 'refresh_token',
      refresh_token: acct.refreshToken,
    }, { 'Authorization': 'Basic ' + basicAuth });
    if (r.data?.access_token) {
      acct.accessToken = r.data.access_token;
      acct.refreshToken = r.data.refresh_token || acct.refreshToken;
      acct.expiresAt = Date.now() + (r.data.expires_in || 3600) * 1000;
      saveDB(db);
      return true;
    }
  } catch (e) { /* ignore */ }
  return false;
}

ipcMain.handle('accounts:epic:import', async () => {
  if (!providers || !providers.epic || !providers.epic.importLibrary) return { error: 'Epic provider not available' };
  try {
    const notify = (evt) => { try { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('import:progress', { provider: 'epic', ...evt }); } catch(e) {} };
    const res = await providers.epic.importLibrary({ db, saveDB, notify });
    return res;
  } catch (e) { return { error: 'Epic import failed: ' + e.message }; }
});

// ── Xbox / Microsoft OAuth ──
// Microsoft Identity Platform with Xbox Live scope
const MS_CLIENT_ID = '1fec8e78-bce4-4aaf-ab1b-5451cc387264'; // Xbox public client
const MS_REDIRECT = 'https://login.microsoftonline.com/common/oauth2/nativeclient';
const MS_SCOPE = 'XboxLive.signin XboxLive.offline_access openid profile';

ipcMain.handle('accounts:xbox:auth', async () => {
  return new Promise((resolve) => {
    const oauthState = generateOAuthState();
    const authSession = session.fromPartition('auth:xbox:' + Date.now());
    const authWin = createAuthWindow(600, 700, authSession);
    let resolved = false;
    let authTimeout = null;
    const cleanup = () => {
      if (authTimeout) { clearTimeout(authTimeout); authTimeout = null; }
      try { authSession.clearStorageData(); } catch(e) {}
    };
    authTimeout = setTimeout(() => {
      if (!resolved) { resolved = true; cleanup(); try { authWin.close(); } catch(e) {} resolve({ error: 'Authentication timed out' }); }
    }, AUTH_TIMEOUT_MS);
    const authUrl = `https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize?client_id=${MS_CLIENT_ID}&response_type=code&redirect_uri=${encodeURIComponent(MS_REDIRECT)}&scope=${encodeURIComponent(MS_SCOPE)}&response_mode=query&state=${oauthState}`;
    const handleUrl = (url) => {
      if (resolved) return;
      if (url.startsWith(MS_REDIRECT)) {
        resolved = true;
        cleanup();
        try {
          const u = new URL(url);
          const code = u.searchParams.get('code');
          const error = u.searchParams.get('error');
          const returnedState = u.searchParams.get('state');
          authWin.close();
          if (error) { resolve({ error: u.searchParams.get('error_description') || error }); return; }
          if (!code) { resolve({ error: 'No authorization code' }); return; }
          // Validate CSRF state
          if (returnedState && !validateOAuthState(returnedState)) {
            resolve({ error: 'Security validation failed (state mismatch)' });
            return;
          }
          // Exchange code for MS token
          httpPost('https://login.microsoftonline.com/consumers/oauth2/v2.0/token', {
            client_id: MS_CLIENT_ID,
            grant_type: 'authorization_code',
            code,
            redirect_uri: MS_REDIRECT,
            scope: MS_SCOPE,
          }).then(async msR => {
            if (!msR.data?.access_token) { resolve({ error: 'MS token exchange failed' }); return; }
            try {
              // Authenticate with Xbox Live
              const xblR = await httpPost('https://user.auth.xboxlive.com/user/authenticate', JSON.stringify({
                Properties: { AuthMethod: 'RPS', SiteName: 'user.auth.xboxlive.com', RpsTicket: 'd=' + msR.data.access_token },
                RelyingParty: 'http://auth.xboxlive.com', TokenType: 'JWT'
              }), { 'Content-Type': 'application/json', 'x-xbl-contract-version': '1' });
              if (!xblR.data?.Token) { resolve({ error: 'Xbox Live auth failed' }); return; }
              const xblToken = xblR.data.Token;
              const userHash = xblR.data.DisplayClaims?.xui?.[0]?.uhs || '';
              // Get XSTS token
              const xstsR = await httpPost('https://xsts.auth.xboxlive.com/xsts/authorize', JSON.stringify({
                Properties: { SandboxId: 'RETAIL', UserTokens: [xblToken] },
                RelyingParty: 'http://xboxlive.com', TokenType: 'JWT'
              }), { 'Content-Type': 'application/json', 'x-xbl-contract-version': '1' });
              if (!xstsR.data?.Token) { resolve({ error: 'XSTS auth failed' }); return; }
              const xstsToken = xstsR.data.Token;
              const gamertag = xstsR.data.DisplayClaims?.xui?.[0]?.gtg || '';
              const xuid = xstsR.data.DisplayClaims?.xui?.[0]?.xid || '';
              // Get profile image
              let avatarUrl = '';
              try {
                const profR = await httpGetJson(`https://profile.xboxlive.com/users/xuid(${xuid})/profile/settings?settings=GameDisplayPicRaw`, {
                  'Authorization': 'XBL3.0 x=' + userHash + ';' + xstsToken,
                  'x-xbl-contract-version': '3',
                });
                avatarUrl = profR.data?.profileUsers?.[0]?.settings?.[0]?.value || '';
              } catch(e) { /* skip avatar */ }
              if (!db.accounts) db.accounts = {};
              db.accounts.xbox = {
                msAccessToken: msR.data.access_token,
                msRefreshToken: msR.data.refresh_token,
                msExpiresAt: Date.now() + (msR.data.expires_in || 3600) * 1000,
                xblToken, xstsToken, userHash, xuid, gamertag, avatarUrl,
                connected: true,
              };
              saveDB(db);
              resolve({ success: true, gamertag, avatarUrl });
            } catch (e) { resolve({ error: 'Xbox auth chain failed: ' + e.message }); }
          }).catch(e => resolve({ error: e.message }));
        } catch (e) { authWin.close(); resolve({ error: e.message }); }
      }
    };
    authWin.webContents.on('will-navigate', (event, url) => {
      if (url.startsWith(MS_REDIRECT)) { event.preventDefault(); handleUrl(url); return; }
      if (!isAllowedAuthDomain(url)) { event.preventDefault(); }
    });
    authWin.webContents.on('will-redirect', (event, url) => { if (url.startsWith(MS_REDIRECT)) { event.preventDefault(); handleUrl(url); } });
    authWin.webContents.on('did-navigate', (event, url) => handleUrl(url));
    authWin.on('closed', () => { cleanup(); if (!resolved) { resolved = true; resolve({ error: 'cancelled' }); } });
    authWin.loadURL(authUrl);
  });
});

async function refreshXboxTokens() {
  const acct = (db.accounts || {}).xbox;
  if (!acct?.msRefreshToken) return false;
  try {
    const msR = await httpPost('https://login.microsoftonline.com/consumers/oauth2/v2.0/token', {
      client_id: MS_CLIENT_ID, grant_type: 'refresh_token',
      refresh_token: acct.msRefreshToken, scope: MS_SCOPE,
    });
    if (!msR.data?.access_token) return false;
    acct.msAccessToken = msR.data.access_token;
    acct.msRefreshToken = msR.data.refresh_token || acct.msRefreshToken;
    acct.msExpiresAt = Date.now() + (msR.data.expires_in || 3600) * 1000;
    // Re-auth XBL + XSTS
    const xblR = await httpPost('https://user.auth.xboxlive.com/user/authenticate', JSON.stringify({
      Properties: { AuthMethod: 'RPS', SiteName: 'user.auth.xboxlive.com', RpsTicket: 'd=' + msR.data.access_token },
      RelyingParty: 'http://auth.xboxlive.com', TokenType: 'JWT'
    }), { 'Content-Type': 'application/json', 'x-xbl-contract-version': '1' });
    if (!xblR.data?.Token) return false;
    acct.xblToken = xblR.data.Token;
    acct.userHash = xblR.data.DisplayClaims?.xui?.[0]?.uhs || acct.userHash;
    const xstsR = await httpPost('https://xsts.auth.xboxlive.com/xsts/authorize', JSON.stringify({
      Properties: { SandboxId: 'RETAIL', UserTokens: [acct.xblToken] },
      RelyingParty: 'http://xboxlive.com', TokenType: 'JWT'
    }), { 'Content-Type': 'application/json', 'x-xbl-contract-version': '1' });
    if (!xstsR.data?.Token) return false;
    acct.xstsToken = xstsR.data.Token;
    saveDB(db);
    return true;
  } catch (e) { return false; }
}

ipcMain.handle('accounts:xbox:import', async () => {
  if (!providers || !providers.xbox || !providers.xbox.importLibrary) return { error: 'Xbox provider not available' };
  try {
    const notify = (evt) => { try { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('import:progress', { provider: 'xbox', ...evt }); } catch(e) {} };
    const res = await providers.xbox.importLibrary({ db, saveDB, notify });
    return res;
  } catch (e) { return { error: 'Xbox import failed: ' + e.message }; }
});

// ─── chiaki-ng Auto-Setup (first run) ─────────────────────────────────────────
// If chiaki-ng is not bundled and no system install is found, automatically
// download it in the background so the user doesn't have to do it manually.
function autoSetupChiakiIfMissing() {
  // Already bundled — nothing to do
  if (getBundledChiakiExe()) return;

  // System install exists — no need to download
  const systemPaths = [
    path.join(process.env.ProgramFiles || '', 'chiaki-ng', 'chiaki.exe'),
    path.join(process.env['ProgramFiles(x86)'] || '', 'chiaki-ng', 'chiaki.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'chiaki-ng', 'chiaki.exe'),
  ];
  if (systemPaths.some(p => fs.existsSync(p))) return;

  console.log('[chiaki] Not found — starting automatic setup...');
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('chiaki:event', { type: 'setup_started' });
  }

  const scriptPath = path.join(__dirname, 'scripts', 'setup-chiaki.ps1');
  if (!fs.existsSync(scriptPath)) {
    console.warn('[chiaki] setup-chiaki.ps1 not found, skipping auto-setup');
    return;
  }

  const child = spawn('powershell', ['-ExecutionPolicy', 'Bypass', '-File', scriptPath], { cwd: __dirname, stdio: 'pipe' });
  let output = '';
  child.stdout.on('data', d => output += d.toString());
  child.stderr.on('data', d => output += d.toString());
  child.on('close', (code) => {
    if (code === 0) {
      const version = getBundledChiakiVersion();
      console.log(`[chiaki] Auto-setup complete — v${version}`);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('chiaki:event', { type: 'setup_complete', version });
      }
    } else {
      console.error(`[chiaki] Auto-setup failed (exit ${code}):`, output);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('chiaki:event', { type: 'setup_failed', error: `Setup exited with code ${code}` });
      }
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
  const systemPaths = [
    path.join(process.env.ProgramFiles || '', 'chiaki-ng', 'chiaki.exe'),
    path.join(process.env['ProgramFiles(x86)'] || '', 'chiaki-ng', 'chiaki.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'chiaki-ng', 'chiaki.exe'),
  ];
  for (const p of systemPaths) {
    if (fs.existsSync(p)) {
      return { status: 'system', executablePath: p, version: null };
    }
  }

  return { status: 'missing', executablePath: null, version: null };
});

ipcMain.handle('chiaki:checkUpdate', async () => {
  try {
    const repo = process.env.CHIAKI_RELEASE_REPO || 'streetpea/chiaki-ng';
    const res = await new Promise((resolve, reject) => {
      const req = https.get(`https://api.github.com/repos/${repo}/releases/latest`, { headers: { 'User-Agent': 'cereal-launcher' } }, (resp) => {
        let body = '';
        resp.on('data', c => body += c);
        resp.on('end', () => { try { resolve(JSON.parse(body)); } catch (e) { reject(e); } });
      });
      req.on('error', reject);
      req.setTimeout(10000, () => { req.destroy(); reject(new Error('timeout')); });
    });
    const latestTag = res.tag_name || null;
    const currentVersion = getBundledChiakiVersion();
    const hasUpdate = latestTag && currentVersion && latestTag !== currentVersion;
    return { current: currentVersion, latest: latestTag, hasUpdate, releaseName: res.name || latestTag };
  } catch (e) {
    return { error: e.message };
  }
});

ipcMain.handle('chiaki:update', async () => {
  try {
    const scriptPath = path.join(__dirname, 'scripts', 'setup-chiaki.ps1');
    if (!fs.existsSync(scriptPath)) return { error: 'setup-chiaki.ps1 not found' };
    return new Promise((resolve) => {
      const child = spawn('powershell', ['-ExecutionPolicy', 'Bypass', '-File', scriptPath, '-Force'], { cwd: __dirname, stdio: 'pipe' });
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
  db.chiakiConfig = config;
  saveDB(db);
  return config;
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
    const proc = spawn(chiakiExe, args, { cwd: chiakiDir, env, stdio: ['ignore', 'pipe', 'pipe'] });
    proc.stdout.on('data', d => output += d.toString());
    proc.stderr.on('data', d => output += d.toString());
    proc.on('exit', (code) => {
      if (code === 0) {
        // Parse registration output for keys
        const registKey = output.match(/regist[_-]?key[=:]\s*([^\s\n]+)/i)?.[1] || '';
        const morning = output.match(/morning[=:]\s*([^\s\n]+)/i)?.[1] || '';
        resolve({ success: true, registKey, morning, output });
      } else {
        resolve({ success: false, error: output || 'Registration failed (exit ' + code + ')' });
      }
    });
    setTimeout(() => { try { proc.kill(); } catch(e) {} resolve({ success: false, error: 'Registration timed out (30s)' }); }, 30000);
  });
});

ipcMain.handle('chiaki:discoverConsoles', () => {
  // Native UDP discovery — PS4/PS5 respond to SRCH broadcasts on port 987.
  // The pre-built chiaki-ng binary is GUI-only and has no CLI discover command.
  const dgram = require('dgram');
  const os    = require('os');

  return new Promise((resolve) => {
    const DISCOVERY_PORT = 987;
    const SRCH = Buffer.from('SRCH * HTTP/1.1\r\ndevice-discovery-protocol-version:00020020\r\n\r\n');
    const found = new Map(); // host -> console object (dedup)

    const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });

    sock.on('error', (err) => {
      try { sock.close(); } catch(e) {}
      resolve({ success: false, consoles: [], error: err.message });
    });

    sock.on('message', (msg, rinfo) => {
      const text = msg.toString();
      if (!text.startsWith('HTTP/1.1 200')) return;

      const console_ = { host: rinfo.address };
      for (const line of text.split('\r\n')) {
        const colon = line.indexOf(':');
        if (colon === -1) continue;
        const k = line.substring(0, colon).trim().toLowerCase();
        const v = line.substring(colon + 1).trim();
        if (k === 'host-name')            console_.name            = v;
        if (k === 'host-type')            console_.type            = v;   // PS4 or PS5
        if (k === 'host-id')              console_.hostId          = v;
        if (k === 'system-version')       console_.firmwareVersion = v;
        if (k === 'running-app-titleid')  console_.runningTitleId  = v;
        if (k === 'running-app-name')     console_.runningTitle    = v;
      }

      if (!found.has(rinfo.address)) found.set(rinfo.address, console_);
    });

    sock.bind(0, () => {
      sock.setBroadcast(true);

      // Build list of broadcast addresses from all non-loopback IPv4 interfaces
      const broadcasts = new Set(['255.255.255.255']);
      for (const addrs of Object.values(os.networkInterfaces())) {
        for (const addr of addrs) {
          if (addr.family !== 'IPv4' || addr.internal) continue;
          const parts = addr.address.split('.');
          parts[3] = '255';
          broadcasts.add(parts.join('.'));
        }
      }

      for (const bcast of broadcasts) {
        sock.send(SRCH, DISCOVERY_PORT, bcast, (err) => {
          if (err) console.error('[chiaki discovery] send error:', bcast, err.message);
        });
      }

      // Collect responses for 3 seconds
      setTimeout(() => {
        try { sock.close(); } catch(e) {}
        resolve({ success: true, consoles: [...found.values()] });
      }, 3000);
    });
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

// ─── Playtime Tracking ───────────────────────────────────────────────────────
ipcMain.handle('playtime:add', (event, id, minutes) => {
  const game = db.games.find(g => g.id === id);
  if (game) {
    game.playtimeMinutes = (game.playtimeMinutes || 0) + minutes;
    saveDB(db);
    return game;
  }
  return null;
});
