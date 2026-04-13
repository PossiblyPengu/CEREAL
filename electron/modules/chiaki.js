// ─── Chiaki Session Manager & Win32 Stream Embedding ──────────────────────────
// Manages chiaki-ng as a child process with JSON status event streaming.
// Events are parsed from chiaki-ng's --json-status output; falls back to log scraping.

const path = require('path');
const fs = require('fs');
const readline = require('readline');
const { spawn } = require('child_process');
const { screen: electronScreen, app } = require('electron');
const ctx = require('./context');
const { CONTROL_BAR_HEIGHT, CHIAKI_SYSTEM_PATHS } = require('./constants');
const { connectDiscord, setDiscordPresence, clearDiscordPresence, isDiscordEnabled } = require('./discord');

// ─── chiaki-ng path resolution ───────────────────────────────────────────────
// Priority: userData/chiaki-ng (downloaded by app) → dev resources fallback
function getChiakiDir() {
  const userData = path.join(app.getPath('userData'), 'chiaki-ng');
  if (fs.existsSync(userData)) return userData;

  // Dev fallback — dist-electron/resources/chiaki-ng (if manually placed for testing)
  const dev = path.join(__dirname, '..', 'resources', 'chiaki-ng');
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
      } catch (e) { /* not JSON */ }
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
        catch (e) { /* already dead */ }
      }, 3000);
    } catch (e) { /* already dead */ }
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
  } catch (e) { /* fallback sf=1 */ }
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

  const psScript = path.join(__dirname, '..', 'scripts', 'win32-stream.ps1');
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
  if (!ctx.mainWindow) return;
  const b = getStreamBounds();
  for (const session of chiakiSessions.values()) {
    if (session.embedProcess && !session.embedProcess.killed) {
      try {
        session.embedProcess.stdin.write(`bounds ${b.x} ${b.y} ${b.w} ${b.h}\n`);
      } catch (e) { /* ok */ }
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
};
