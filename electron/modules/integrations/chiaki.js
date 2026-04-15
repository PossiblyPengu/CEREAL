// ─── Chiaki Session Manager & Win32 Stream Embedding ──────────────────────────
// Manages chiaki-ng as a child process with JSON status event streaming.
// Events are parsed from chiaki-ng's --json-status output; falls back to log scraping.

const path = require('path');
const fs = require('fs');
const readline = require('readline');
const { spawn } = require('child_process');
const dgram = require('dgram');
const os = require('os');
const { screen: electronScreen, app, ipcMain, net } = require('electron');
const ctx = require('../core/context');
const { CONTROL_BAR_HEIGHT, CHIAKI_SYSTEM_PATHS } = require('../core/constants');
const { connectDiscord, setDiscordPresence, clearDiscordPresence, isDiscordEnabled } = require('./discord');
const log = require('../core/logger');
const { getScriptPath, getResourcePath } = require('../core/paths');

// ─── chiaki-ng path resolution ───────────────────────────────────────────────
// Priority: userData/chiaki-ng (downloaded by app) → dev resources fallback
function getChiakiDir() {
  const userData = path.join(app.getPath('userData'), 'chiaki-ng');
  if (fs.existsSync(userData)) return userData;

  // Dev fallback — resources/chiaki-ng (if manually placed for testing)
  const dev = getResourcePath('chiaki-ng');
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
  } catch (_e) { /* ignore */ }

  return null;
}

function getBundledChiakiVersion() {
  const dir = getChiakiDir();
  if (!dir) return null;
  const vf = path.join(dir, '.version');
  try { return fs.readFileSync(vf, 'utf-8').trim(); }
  catch (_e) { return null; }
}

// ─── Chiaki Session Manager ──────────────────────────────────────────────────

const chiakiSessions = new Map(); // gameId -> session object

function resolveChiakiExe(fallbackPath) {
  // Priority: bundled > system > user-configured
  const bundled = getBundledChiakiExe();
  if (bundled) return bundled;

  const systemPaths = [
    ...CHIAKI_SYSTEM_PATHS,
    path.join(process.env.ProgramFiles || '', 'chiaki-ng', 'chiaki-ng.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'chiaki-ng', 'chiaki-ng.exe'),
    fallbackPath,
  ].filter(Boolean);

  return systemPaths.find(p => p && fs.existsSync(p)) || null;
}

function buildChiakiArgs(game, config) {
  // chiaki-ng CLI: chiaki stream <nickname> <host> [options]
  // 'nickname' identifies the registered console profile in chiaki's config.
  // If we have registkey+morning we pass them directly; otherwise nickname is required.
  const nickname = game.chiakiNickname || game.chiakiProfile || '';
  const host = game.chiakiHost || '';
  if (!host) return []; // No host = open GUI mode

  const args = ['stream'];

  // Positional: nickname then host
  args.push(nickname || 'default');
  args.push(host);

  // Named options
  if (game.chiakiRegistKey) args.push('--registkey', game.chiakiRegistKey);
  if (game.chiakiMorning)   args.push('--morning', game.chiakiMorning);
  if (game.chiakiProfile)   args.push('--profile', game.chiakiProfile);

  // Always exit when stream ends so our session manager gets the exit event
  args.push('--exit-app-on-stream-exit');

  // Display mode
  const displayMode = game.chiakiDisplayMode || config?.displayMode || 'fullscreen';
  if (displayMode === 'zoom')        args.push('--zoom');
  else if (displayMode === 'stretch') args.push('--stretch');
  else                                args.push('--fullscreen');

  // Optional features
  if (game.chiakiDualsense || config?.dualsense) args.push('--dualsense');
  if (game.chiakiPasscode) args.push('--passcode', game.chiakiPasscode);

  return args;
}

function sendStreamEvent(gameId, type, data) {
  ctx.sendToRenderer('chiaki:event', { gameId, type, ...data });
}

function sendChiakiEvent(gameId, type, data) {
  sendStreamEvent(gameId, type, { platform: 'psn', ...data });
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

  // Managed session with piped stdio
  session.process = spawn(chiakiExe, args, {
    cwd: chiakiDir,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  // Stock chiaki-ng logs to stderr (Qt logging), not stdout.
  // Parse BOTH streams for maximum compatibility.
  let stderrBuf = '';

  const processLine = (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    // Try JSON (future-proofing if chiaki ever adds structured output)
    if (trimmed.startsWith('{')) {
      try {
        const evt = JSON.parse(trimmed);
        handleChiakiJsonEvent(gameId, evt);
        return;
      } catch (_e) { /* not JSON */ }
    }
    handleChiakiLogLine(gameId, trimmed);
  };

  const rlOut = readline.createInterface({ input: session.process.stdout });
  rlOut.on('line', processLine);

  const rlErr = readline.createInterface({ input: session.process.stderr });
  rlErr.on('line', (line) => {
    stderrBuf += line + '\n';
    if (stderrBuf.length > 4096) stderrBuf = stderrBuf.slice(-4096);
    processLine(line);
  });

  session.process.on('exit', (code, signal) => {
    session.exitCode = code;
    session.state = 'disconnected';

    // Stop Win32 embed helper
    stopEmbedHelper(session);

    // Stock chiaki-ng: 0 = clean exit, non-zero = error/crash
    let reason = 'unknown';
    let wasError = true;
    if (code === 0) { reason = 'clean_exit'; wasError = false; }
    else if (signal) { reason = 'killed'; wasError = false; }
    else { reason = 'error'; }

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
    if (titleElapsed > 0 && ctx.db) {
      const game = ctx.db.games.find(g => g.id === trackId);
      if (game) {
        game.playtimeMinutes = (game.playtimeMinutes || 0) + titleElapsed;
        game.lastPlayed = new Date().toISOString();
        ctx.saveDB(ctx.db);
        ctx.sendToRenderer('games:refresh', ctx.db.games);
      }
    }

    // Auto-reconnect for transient errors (non-zero exit, skip if auth/regist failure)
    const isAuthError = stderrBuf.toLowerCase().includes('regist failed')
                     || stderrBuf.toLowerCase().includes('auth')
                     || stderrBuf.toLowerCase().includes('invalid psn');
    const reconnectAttempts = session._reconnectAttempts || 0;
    if (code !== 0 && !isAuthError && reconnectAttempts < 5) {
      const nextAttempt = reconnectAttempts + 1;
      const delay = Math.min(1000 * Math.pow(2, nextAttempt - 1), 16000);
      sendChiakiEvent(gameId, 'reconnecting', {
        attempt: nextAttempt, maxAttempts: 5, delayMs: delay,
      });
      const carryReconnect = nextAttempt;
      session._reconnectTimer = setTimeout(() => {
        if (chiakiSessions.has(gameId)) {
          const newSession = startChiakiSession(gameId, chiakiExe, args);
          if (newSession) newSession._reconnectAttempts = carryReconnect;
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
    const game = ctx.db.games.find(g => g.id === gameId);
    if (game) {
      connectDiscord();
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

  if (session.process && !session.process.killed && session.process.exitCode === null) {
    try {
      if (process.platform === 'win32') {
        // SIGTERM doesn't work for Qt GUI apps on Windows; use taskkill
        spawn('taskkill', ['/pid', String(session.process.pid), '/t', '/f'], { stdio: 'ignore' });
      } else {
        session.process.kill('SIGTERM');
      }
      // Force-kill after 3 seconds if still alive
      setTimeout(() => {
        try { if (!session.process.killed) session.process.kill('SIGKILL'); }
        catch (_e) { /* already dead */ }
      }, 3000);
    } catch (_e) { /* already dead */ }
  }

  chiakiSessions.delete(gameId);
  return true;
}

// ─── Win32 Stream Embedding ───────────────────────────────────────────────────

function getStreamBounds() {
  // Stream area is the Electron content area minus the 40px control bar at top.
  // getContentSize() returns logical (CSS) pixels; Win32 SetWindowPos uses physical pixels
  // when the process is PMv2 DPI-aware (which Electron is). Scale accordingly.
  const [cw, ch] = ctx.mainWindow ? ctx.mainWindow.getContentSize() : [1280, 720];
  let sf = 1;
  try {
    const winBounds = ctx.mainWindow.getBounds();
    const disp = electronScreen.getDisplayNearestPoint({ x: winBounds.x + winBounds.width / 2, y: winBounds.y + winBounds.height / 2 });
    sf = disp.scaleFactor || 1;
  } catch (_e) { /* fallback sf=1 */ }
  const barH = Math.round(CONTROL_BAR_HEIGHT * sf);  // physical pixels for the logical control bar
  return {
    x: 0, y: barH,
    w: Math.round(cw * sf),
    h: Math.max(1, Math.round(ch * sf) - barH),
  };
}

function startEmbedHelper(gameId, session) {
  if (process.platform !== 'win32') return;
  if (!ctx.mainWindow || !session.process) return;

  const hwndBuffer = ctx.mainWindow.getNativeWindowHandle();
  const hwnd = hwndBuffer.readBigUInt64LE(0).toString();
  const b = getStreamBounds();

  const psScript = getScriptPath('win32-stream.ps1');
  if (!fs.existsSync(psScript)) {
    log.warn('chiaki', 'win32-stream.ps1 not found, skipping embed');
    return;
  }
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
    if (trimmed === 'ready') {
      session.embedded = true;
      sendChiakiEvent(gameId, 'embedded', { embedded: true });
    } else if (trimmed.startsWith('error:')) {
      log.error('win32-stream', trimmed);
      sendChiakiEvent(gameId, 'embedded', { embedded: false, error: trimmed });
    }
  });

  ps.stderr.on('data', (d) => log.error('win32-stream', d.toString().trimEnd()));
  ps.on('exit', () => { session.embedProcess = null; });
}

function stopEmbedHelper(session) {
  if (!session.embedProcess) return;
  const ps = session.embedProcess;
  session.embedProcess = null;
  try { ps.stdin.write('exit\n'); } catch (_e) { /* ok */ }
  setTimeout(() => {
    try { if (!ps.killed) ps.kill(); } catch (_e) { /* ok */ }
  }, 500);
}

function sendEmbedBoundsToAll() {
  if (!ctx.mainWindow) return;
  const b = getStreamBounds();
  for (const session of chiakiSessions.values()) {
    if (session.embedProcess && !session.embedProcess.killed) {
      try {
        session.embedProcess.stdin.write(`bounds ${b.x} ${b.y} ${b.w} ${b.h}\n`);
      } catch (_e) { /* ok */ }
    }
  }
}

// ─── PS Title Change Detection ──────────────────────────────────────────────

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
      const prev = ctx.db.games.find(g => g.id === session._currentGameId);
      if (prev) {
        prev.playtimeMinutes = (prev.playtimeMinutes || 0) + elapsed;
        prev.lastPlayed = new Date().toISOString();
        ctx.saveDB(ctx.db);
        ctx.sendToRenderer('games:refresh', ctx.db.games);
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
  let matchedGame = ctx.db.games.find(g =>
    g.platform === 'psn' && g.platformId && g.platformId.toUpperCase() === titleId.toUpperCase()
  );

  // Fallback: fuzzy match by name
  if (!matchedGame && titleName) {
    const lower = titleName.toLowerCase();
    matchedGame = ctx.db.games.find(g =>
      g.platform === 'psn' && g.name && g.name.toLowerCase() === lower
    );
  }

  // Auto-create the game if not found
  if (!matchedGame && titleName) {
    matchedGame = {
      id: Date.now().toString(36) + Math.random().toString(36).substring(2, 7),
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
      chiakiNickname: (ctx.db.games.find(g => g.id === originalGameId) || {}).chiakiNickname || '',
      chiakiHost: (ctx.db.games.find(g => g.id === originalGameId) || {}).chiakiHost || '',
    };
    ctx.db.games.push(matchedGame);
    ctx.saveDB(ctx.db);
    ctx.sendToRenderer('games:refresh', ctx.db.games);
  }

  // Update platformId if it was missing
  if (matchedGame && !matchedGame.platformId && titleId) {
    matchedGame.platformId = titleId;
    ctx.saveDB(ctx.db);
    ctx.sendToRenderer('games:refresh', ctx.db.games);
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

  // Log scraping for stock chiaki-ng (logs to stderr in "[timestamp] [I/W/E] msg" format)
  // Patterns taken from chiaki-ng session.c / stream_connection.c source
  const lower = line.toLowerCase();

  // Connecting phase
  if (lower.includes('starting session request') || lower.includes('starting ctrl')) {
    if (session.state !== 'streaming') {
      session.state = 'connecting';
      sendChiakiEvent(gameId, 'state', { state: 'connecting' });
    }
  }
  // Streaming phase — Senkusha completes right before video starts
  else if (lower.includes('senkusha completed successfully')
        || lower.includes('streamconnection completed')
        || lower.includes('stream connection started')
        || lower.includes('video decoder')) {
    if (session.state !== 'streaming') {
      session.state = 'streaming';
      session._reconnectAttempts = 0; // reset on successful stream
      sendChiakiEvent(gameId, 'state', { state: 'streaming' });
    }
  }
  // Session ended — let the exit handler manage state
  else if (lower.includes('session has quit') || lower.includes('ctrl stopped')) {
    // Don't override — the exit handler will manage this
  }
  // Errors worth surfacing
  else if (lower.includes('ctrl has failed')
        || lower.includes('streamconnection run failed')
        || lower.includes('remote disconnected')) {
    sendChiakiEvent(gameId, 'log', { level: 'error', message: line });
  }
}

function getActiveSessions() {
  return Object.fromEntries(
    [...chiakiSessions].map(([gameId, s]) => [gameId, {
      state: s.state,
      startTime: s.startTime,
      streamInfo: s.streamInfo || {},
      quality: s.quality || {},
      exitCode: s.exitCode,
      reconnectAttempts: s._reconnectAttempts || 0,
    }])
  );
}

// ─── chiaki-ng Auto-Setup (first run) ─────────────────────────────────────────
// If chiaki-ng is not bundled and no system install is found, automatically
// download it in the background so the user doesn't have to do it manually.
function autoSetupChiakiIfMissing() {
  // Already bundled — nothing to do
  if (getBundledChiakiExe()) return;

  // System install exists — no need to download
  if (CHIAKI_SYSTEM_PATHS.some(p => fs.existsSync(p))) return;

  log.info('chiaki', 'Not found — starting automatic setup...');
  ctx.sendToRenderer('chiaki:event', { type: 'setup_started' });

  const scriptPath = getScriptPath('setup-chiaki.ps1');
  if (!fs.existsSync(scriptPath)) {
    log.warn('chiaki', 'setup-chiaki.ps1 not found, skipping auto-setup');
    return;
  }

  const SETUP_TIMEOUT = 5 * 60 * 1000;
  const chiakiInstallDir = path.join(app.getPath('userData'), 'chiaki-ng');
  const child = spawn('powershell', ['-ExecutionPolicy', 'Bypass', '-File', scriptPath, '-InstallDir', chiakiInstallDir], { cwd: path.dirname(scriptPath), stdio: 'pipe' });
  let output = '';
  let finished = false;
  const setupTimer = setTimeout(() => {
    if (finished) return;
    finished = true;
    try { child.kill(); } catch (_e) { /* best-effort */ }
    log.error('chiaki', 'Auto-setup timed out after 5 minutes');
    ctx.sendToRenderer('chiaki:event', { type: 'setup_failed', error: 'Setup timed out after 5 minutes' });
  }, SETUP_TIMEOUT);
  child.stdout.on('data', d => output += d.toString());
  child.stderr.on('data', d => output += d.toString());
  child.on('close', (code) => {
    if (finished) return;
    finished = true;
    clearTimeout(setupTimer);
    if (code === 0) {
      const version = getBundledChiakiVersion();
      log.info('chiaki', `Auto-setup complete — v${version}`);
      ctx.sendToRenderer('chiaki:event', { type: 'setup_complete', version });
    } else {
      log.error('chiaki', `Auto-setup failed (exit ${code}):`, output);
      ctx.sendToRenderer('chiaki:event', { type: 'setup_failed', error: `Setup exited with code ${code}` });
    }
  });
  child.on('error', (err) => {
    if (finished) return;
    finished = true;
    clearTimeout(setupTimer);
    log.error('chiaki', 'Auto-setup spawn error:', err.message);
  });
}

// ─── IPC Handler Registration ─────────────────────────────────────────────────
function registerChiakiIpcHandlers() {
  const saveDB = () => ctx.saveDB?.(ctx.db);

  ipcMain.handle('chiaki:setStreamBounds', (event, { gameId, x, y, width, height }) => {
    const session = chiakiSessions.get(gameId);
    if (session?.embedProcess && !session.embedProcess.killed) {
      try {
        session.embedProcess.stdin.write(`bounds ${x} ${y} ${width} ${height}\n`);
      } catch (_e) { /* ok */ }
    }
    return { success: true };
  });

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
      const scriptPath = getScriptPath('setup-chiaki.ps1');
      if (!fs.existsSync(scriptPath)) return { error: 'setup-chiaki.ps1 not found at: ' + scriptPath };
      const chiakiInstallDir = path.join(app.getPath('userData'), 'chiaki-ng');
      const SETUP_TIMEOUT = 5 * 60 * 1000;
      return new Promise((resolve) => {
        const child = spawn('powershell', ['-ExecutionPolicy', 'Bypass', '-File', scriptPath, '-Force', '-InstallDir', chiakiInstallDir], { cwd: path.dirname(scriptPath), stdio: 'pipe' });
        let output = '';
        let resolved = false;
        const finish = (result) => { if (resolved) return; resolved = true; clearTimeout(timer); resolve(result); };
        const timer = setTimeout(() => {
          try { child.kill(); } catch (_e) { /* best-effort */ }
          finish({ error: 'Setup timed out after 5 minutes' });
        }, SETUP_TIMEOUT);
        child.stdout.on('data', d => output += d.toString());
        child.stderr.on('data', d => output += d.toString());
        child.on('close', (code) => {
          if (code === 0) {
            const newVersion = getBundledChiakiVersion();
            finish({ ok: true, version: newVersion, output });
          } else {
            finish({ error: `Setup exited with code ${code}`, output });
          }
        });
        child.on('error', (err) => finish({ error: err.message }));
      });
    } catch (e) {
      return { error: e.message };
    }
  });

  ipcMain.handle('chiaki:getConfig', () => {
    return ctx.db.chiakiConfig || { executablePath: '', consoles: [] };
  });

  ipcMain.handle('chiaki:saveConfig', (event, config) => {
    // Drop any legacy cerealMode field before persisting
    const { cerealMode: _dropped, ...clean } = config || {};
    ctx.db.chiakiConfig = clean;
    saveDB();
    return clean;
  });

  ipcMain.handle('games:setChiakiStream', (event, gameId, streamConfig) => {
    const game = ctx.db.games.find(g => g.id === gameId);
    if (game) {
      game.chiakiNickname = streamConfig.nickname || '';
      game.chiakiHost = streamConfig.host || '';
      game.chiakiProfile = streamConfig.profile || '';
      game.chiakiFullscreen = streamConfig.fullscreen !== false;
      game.chiakiRegistKey = streamConfig.registKey || '';
      game.chiakiMorning = streamConfig.morning || '';
      saveDB();
      return game;
    }
    return null;
  });

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
    const chiakiConfig = ctx.db.chiakiConfig || {};
    const args = buildChiakiArgs(gameData, chiakiConfig);
    const session = startChiakiSession(sessionKey, chiakiExe, args);
    return { success: true, sessionKey, state: session.state };
  });

  ipcMain.handle('chiaki:startStream', (event, gameId) => {
    const game = ctx.db.games.find(g => g.id === gameId);
    if (!game) return { success: false, error: 'Game not found' };

    const chiakiExe = resolveChiakiExe(game.executablePath);
    if (!chiakiExe) return { success: false, error: 'chiaki-ng not found' };

    const chiakiConfig = ctx.db.chiakiConfig || {};
    const args = buildChiakiArgs(game, chiakiConfig);
    const session = startChiakiSession(gameId, chiakiExe, args);

    game.lastPlayed = new Date().toISOString();
    saveDB();

    return { success: true, state: session.state };
  });

  ipcMain.handle('chiaki:stopStream', (event, gameId) => {
    return { success: stopChiakiSession(gameId) };
  });

  ipcMain.handle('chiaki:getSessions', () => {
    return getActiveSessions();
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
      setTimeout(() => { try { proc.kill(); } catch (_e) { /* best-effort kill */ } finish({ success: false, error: 'Registration timed out (30s)' }); }, 30000);
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

        log.debug('discovery', 'response from', rinfo.address, 'status:', httpCode);

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
            try { s.close(); } catch (_e) { /* best-effort */ }
            tryBind(idx + 1);
          } else {
            log.error('discovery', 'bind failed:', err.message);
            try { s.close(); } catch (_e) { /* best-effort */ }
            resolve({ success: false, consoles: [], error: err.message });
          }
        });
        s.bind(ports[idx], () => {
          log.debug('discovery', 'bound to port', ports[idx] || '(random)');
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
          log.debug('discovery', 'done, found', found.size, 'console(s)');
          try { s.close(); } catch (_e) { /* best-effort */ }
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
        setTimeout(() => { try { proc.kill(); } catch (_e) { /* best-effort kill */ } finish({ success: false, error: 'Wake CLI timed out (10s)', method: 'chiaki-cli' }); }, 10000);
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
          log.error('wake', 'socket error:', err.message);
          try { sock.close(); } catch (_e) { /* best-effort */ }
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
                if (err) log.error('wake', 'send error:', target, port, err.message);
                sent++;
                if (sent === total) {
                  setTimeout(() => {
                    try { sock.close(); } catch (_e) { /* best-effort */ }
                    log.info('wake', 'sent to', host, '(both ports)');
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
}

module.exports = {
  getChiakiDir,
  getBundledChiakiExe,
  getBundledChiakiVersion,
  chiakiSessions,
  resolveChiakiExe,
  buildChiakiArgs,
  startChiakiSession,
  stopChiakiSession,
  getStreamBounds,
  startEmbedHelper,
  stopEmbedHelper,
  sendEmbedBoundsToAll,
  sendStreamEvent,
  sendChiakiEvent,
  getActiveSessions,
  autoSetupChiakiIfMissing,
  registerChiakiIpcHandlers,
};
