// ─── Account Management, OAuth, Token Refresh, Import Progress ────────────────
const { BrowserWindow, session, ipcMain } = require('electron');
const crypto = require('crypto');
const path = require('path');
const ctx = require('../core/context');
const { ACCOUNT_SECRET_FIELDS } = require('../core/constants');
const { scanEpicInstalled, scanGogInstalled } = require('../metadata/detection');
const log = require('../core/logger');
const { getProvidersDir } = require('../core/paths');
const { centerOnParent } = require('../core/display');

// Lazy-loaded — these are resolved at call time (after app.whenReady)
let providers = null;
let auth = null;

function getProviders() {
  if (!providers) providers = require(getProvidersDir());
  return providers;
}
function getAuth() {
  if (!auth) {
    auth = require(path.join(getProvidersDir(), 'auth'));
    // Apply appsettings.json + CEREAL_* env-var overrides on first access.
    // Done lazily so the module loads cleanly during boot before app.whenReady.
    try { require('../core/appConfig').applyOverrides(auth.CONFIG); }
    catch (e) { log.warn('accounts', 'config overlay failed:', e && e.message); }
  }
  return auth;
}

// ─── Account Secret Management ────────────────────────────────────────────────

// All platforms we recognise as a connectable account. Anything else is
// rejected at the IPC boundary so a malformed renderer call can't conjure a
// new keychain entry or wipe an unrelated one.
const KNOWN_PLATFORMS = new Set([
  'steam', 'gog', 'epic', 'xbox', 'psn',
  'ea', 'battlenet', 'itchio', 'ubisoft',
]);

const PLATFORM_DISPLAY_NAMES = {
  steam: 'Steam', gog: 'GOG', epic: 'Epic Games', xbox: 'Xbox',
  ea: 'EA App', battlenet: 'Battle.net', itchio: 'itch.io', ubisoft: 'Ubisoft Connect',
  psn: 'PlayStation',
};

function isValidPlatform(platform) {
  return typeof platform === 'string' && KNOWN_PLATFORMS.has(platform);
}

function accountSecretService(platform) {
  return `cereal-account-${platform}`;
}

function loadAccountSecrets(platform) {
  try {
    const raw = ctx.safeStore.getPassword(accountSecretService(platform), 'tokens');
    if (!raw) return {};
    return JSON.parse(raw);
  } catch (_e) {
    return {};
  }
}

function storeAccountSecrets(platform, secrets) {
  try {
    const service = accountSecretService(platform);
    if (secrets && Object.keys(secrets).length) {
      ctx.safeStore.setPassword(service, 'tokens', JSON.stringify(secrets));
    } else {
      ctx.safeStore.deletePassword(service, 'tokens');
    }
  } catch (e) {
    log.error('accounts', 'account secret store error', platform, e && e.message);
  }
}

function detachAccountSecrets(platform, { save = true } = {}) {
  const acct = ctx.db?.accounts?.[platform];
  if (!acct) {
    storeAccountSecrets(platform, null);
    return false;
  }
  const secrets = {};
  let hasSecrets = false;
  for (const key of ACCOUNT_SECRET_FIELDS) {
    if (acct[key] !== undefined && acct[key] !== null) {
      secrets[key] = acct[key];
      delete acct[key];
      hasSecrets = true;
    }
  }
  storeAccountSecrets(platform, hasSecrets ? secrets : null);
  if (acct.hasCredentials !== hasSecrets) {
    acct.hasCredentials = hasSecrets;
    if (save) ctx.saveDB(ctx.db);
  } else if (hasSecrets && save) {
    ctx.saveDB(ctx.db);
  }
  return hasSecrets;
}

function hydrateAccountSecrets(platform) {
  const acct = ctx.db?.accounts?.[platform];
  if (!acct) return () => {};
  const secrets = loadAccountSecrets(platform);
  if (Object.keys(secrets).length) {
    Object.assign(acct, secrets);
    acct.hasCredentials = true;
  }
  return () => detachAccountSecrets(platform);
}

function persistAccountData(platform, data = {}) {
  if (!platform) return;
  if (!ctx.db.accounts) ctx.db.accounts = {};
  const acct = ctx.db.accounts[platform] || {};
  const secrets = loadAccountSecrets(platform);
  let secretsChanged = false;
  let removedSecrets = false;
  for (const [key, val] of Object.entries(data)) {
    if (ACCOUNT_SECRET_FIELDS.includes(key)) {
      if (val === undefined) continue;
      if (val === null) {
        if (secrets[key] !== undefined) {
          delete secrets[key];
          secretsChanged = true;
          removedSecrets = true;
        }
      } else if (secrets[key] !== val) {
        secrets[key] = val;
        secretsChanged = true;
      }
    } else if (val !== undefined) {
      acct[key] = val;
    }
  }
  if (data.connected !== undefined) acct.connected = data.connected;
  else if (acct.connected === undefined) acct.connected = true;
  const hasSecrets = Object.keys(secrets).length > 0;
  acct.hasCredentials = hasSecrets;
  ctx.db.accounts[platform] = acct;
  if (secretsChanged || removedSecrets) {
    storeAccountSecrets(platform, hasSecrets ? secrets : null);
  }
  if (Object.keys(data).length) ctx.saveDB(ctx.db);
  return acct;
}

// ─── OAuth Security ───────────────────────────────────────────────────────────
const pendingOAuthStates = new Map();
const AUTH_TIMEOUT_MS = 5 * 60 * 1000; // 5 minute auth window timeout

function generateOAuthState() {
  const now = Date.now();
  for (const [s, entry] of pendingOAuthStates) {
    if (now - entry.timestamp >= AUTH_TIMEOUT_MS) pendingOAuthStates.delete(s);
  }
  const state = crypto.randomBytes(32).toString('hex');
  pendingOAuthStates.set(state, { timestamp: now });
  return state;
}

function validateOAuthState(state) {
  if (!state || !pendingOAuthStates.has(state)) return false;
  const entry = pendingOAuthStates.get(state);
  pendingOAuthStates.delete(state);
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
    safe[platform].hasCredentials = !!data.hasCredentials;
  }
  return safe;
}

// Allowed auth window navigation domains. Anything else triggers will-navigate
// preventDefault so a compromised auth page can't bounce the embedded window
// to an arbitrary site.
const ALLOWED_AUTH_DOMAINS = [
  // Steam OpenID
  'steamcommunity.com', 'store.steampowered.com', 'login.steampowered.com',
  'help.steampowered.com', 'steampowered.com',
  // GOG OAuth
  'login.gog.com', 'auth.gog.com', 'embed.gog.com', 'gog.com',
  // Epic OAuth (login can redirect through epic-fortnite cookies/captcha)
  'epicgames.com', 'www.epicgames.com', 'unrealengine.com',
  // Microsoft account / Xbox Live (login.live.com is the canonical XBL host)
  'live.com', 'login.live.com', 'account.live.com',
  'microsoftonline.com', 'microsoft.com', 'msauth.net', 'msftauth.net',
  // Captcha/identity challenges that MS / Epic / GOG may redirect into
  'arkoselabs.com', 'funcaptcha.com', 'hcaptcha.com',
  'localhost', 'cereal-launcher.local',
];

function isAllowedAuthDomain(url) {
  try {
    const hostname = new URL(url).hostname;
    return ALLOWED_AUTH_DOMAINS.some(d => hostname === d || hostname.endsWith('.' + d));
  } catch { return false; }
}

function createAuthWindow(width, height, authSession) {
  // Compute bounds that:
  //   • are centered on the parent window's display (multi-monitor friendly),
  //   • shrink down so the popup never overflows the work area on small/laptop
  //     screens (login.live.com's 700-tall page can otherwise be cut off on a
  //     1366×768 panel with the Windows taskbar visible).
  const bounds = centerOnParent(ctx.mainWindow, width, height, { min: { width: 420, height: 520 } });

  const win = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    minWidth: 420,
    minHeight: 520,
    parent: ctx.mainWindow,
    modal: true,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#0a0a0f',
    // useContentSize ensures the requested width/height describe the rendered
    // page area, not the OS chrome. Without this, a tight 500×700 GOG popup
    // ends up with ~660px of usable height after the title bar on Windows.
    useContentSize: true,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, session: authSession },
  });
  win.setMenuBarVisibility(false);
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.once('ready-to-show', () => {
    if (!win.isDestroyed()) win.show();
  });
  return win;
}

// ─── OAuth Auth Window Helper ─────────────────────────────────────────────────
// will-navigate, will-redirect, and did-navigate can all fire for the same
// redirect URL. We dedupe on the first match so onRedirect runs exactly once,
// which matters because token-exchange handlers are not idempotent (the
// authorization code is single-use).
function runOAuthFlow({ partition, width, height, authUrl, redirectMatch, onRedirect, allowNavigate, keepSession, debugLabel }) {
  return new Promise((resolve) => {
    const partitionStr = keepSession ? partition : (partition + ':' + Date.now());
    const authSession = session.fromPartition(partitionStr);
    const authWin = createAuthWindow(width || 700, height || 700, authSession);
    const tag = debugLabel || partition || 'oauth';
    const trace = (...args) => log.info('accounts', `[${tag}]`, ...args);
    let resolved = false;
    let redirectHandled = false;
    let authTimeout = null;
    const clearAuthTimeout = () => {
      if (authTimeout) { clearTimeout(authTimeout); authTimeout = null; }
    };
    const clearSessionStorage = () => {
      if (!keepSession) {
        try { authSession.clearStorageData(); } catch (_e) { /* best-effort */ }
      }
    };
    const finish = (result) => {
      if (resolved) return;
      resolved = true;
      clearAuthTimeout();
      clearSessionStorage();
      try { if (!authWin.isDestroyed()) authWin.close(); } catch (_e) { /* best-effort */ }
      const summary = result?.error
        ? `error=${result.error}`
        : `success (keys=${Object.keys(result || {}).filter(k => k !== 'success').join(',') || 'none'})`;
      trace('finish:', summary);
      resolve(result);
    };
    authTimeout = setTimeout(() => finish({ error: 'Authentication timed out' }), AUTH_TIMEOUT_MS);
    const handleUrl = (url) => {
      if (resolved || redirectHandled) return;
      if (!redirectMatch(url)) return;
      redirectHandled = true;
      trace('redirect captured:', stripUrlSecrets(url));
      Promise.resolve()
        .then(() => onRedirect(url, finish, { win: authWin, session: authSession }))
        .catch((e) => finish({ error: 'Auth handler failed: ' + (e && e.message || e) }));
    };
    authWin.webContents.on('will-navigate', (event, url) => {
      if (redirectMatch(url)) {
        if (!allowNavigate) event.preventDefault();
        handleUrl(url);
        return;
      }
      if (!isAllowedAuthDomain(url)) {
        event.preventDefault();
        log.warn('accounts', `[${tag}] blocked navigation to disallowed domain:`, url);
      }
    });
    authWin.webContents.on('will-redirect', (event, url) => {
      if (redirectMatch(url)) {
        if (!allowNavigate) event.preventDefault();
        handleUrl(url);
      }
    });
    authWin.webContents.on('did-navigate', (_event, url) => handleUrl(url));
    authWin.webContents.on('did-fail-load', (_e, errorCode, errorDescription, validatedURL) => {
      // Aborted loads (-3) are the expected outcome of preventing the redirect
      // ourselves — ignore them so we don't surface them as auth errors.
      if (errorCode === -3) return;
      trace('did-fail-load:', errorCode, errorDescription, '→', validatedURL);
    });
    // Window-close handling has two cases:
    //  • User cancelled — no redirect was ever detected, so resolve cancelled.
    //  • Provider's success page called window.close() — login.live.com and
    //    Epic's auth flow both do this. The redirect was already captured and
    //    onRedirect's async work (token exchange) is still in flight. Leave
    //    the promise pending; finish() will resolve once onRedirect completes
    //    or the auth-timeout fires (don't clear the timeout here so a hung
    //    token exchange still surfaces as an error rather than hanging the IPC).
    authWin.on('closed', () => {
      trace('window closed (resolved=' + resolved + ', redirectHandled=' + redirectHandled + ')');
      if (resolved) return;
      if (redirectHandled) {
        // Don't clearAuthTimeout — onRedirect is still resolving.
        clearSessionStorage();
        return;
      }
      resolved = true;
      clearAuthTimeout();
      clearSessionStorage();
      resolve({ error: 'cancelled' });
    });
    trace('loading auth URL:', stripUrlSecrets(authUrl));
    authWin.loadURL(authUrl).catch((e) => {
      finish({ error: 'Could not load sign-in page: ' + (e && e.message || e) });
    });
  });
}

// Trim secret-bearing URL params before they hit a log file.
function stripUrlSecrets(url) {
  try {
    const u = new URL(url);
    const redacted = ['code', 'access_token', 'refresh_token', 'id_token', 'RpsTicket', 'state'];
    for (const k of redacted) {
      if (u.searchParams.has(k)) u.searchParams.set(k, '<redacted>');
    }
    return u.origin + u.pathname + (u.searchParams.toString() ? '?' + u.searchParams.toString() : '');
  } catch { return '<unparseable>'; }
}

// ─── Token Refresh ────────────────────────────────────────────────────────────
async function refreshAccountToken(platform) {
  if (!isValidPlatform(platform)) return false;
  const a = getAuth();
  const acct = (ctx.db.accounts || {})[platform];
  if (!acct) return false;
  const releaseSecrets = hydrateAccountSecrets(platform);
  try {
    let tokens = null;
    if (platform === 'gog') {
      if (!acct.refreshToken) return false;
      tokens = await a.refreshGogToken(acct.refreshToken);
    } else if (platform === 'epic') {
      if (!acct.refreshToken) return false;
      tokens = await a.refreshEpicToken(acct.refreshToken);
    } else if (platform === 'xbox') {
      if (!acct.msRefreshToken) return false;
      tokens = await a.refreshXboxTokens(acct.msRefreshToken);
    }
    if (!tokens) return false;
    persistAccountData(platform, tokens);
    return true;
  } catch (e) {
    log.warn('accounts', `${platform} token refresh failed:`, e && e.message);
    return false;
  }
  finally { releaseSecrets(); }
}

// ─── Import Progress Infrastructure ──────────────────────────────────────────
function emitImportProgress(providerId, evt) {
  try {
    ctx.sendToRenderer('import:progress', { provider: providerId, ...evt });
  } catch (_e) { /* ignore */ }
}

function importCount(value) {
  if (Array.isArray(value)) return value.length;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return 0;
}

async function runProviderImportWithProgress(providerId, options = {}) {
  const p = getProviders();
  const provider = p?.[providerId];
  if (!provider || typeof provider.importLibrary !== 'function') {
    return { error: `${providerId} provider not available` };
  }
  const releaseSecrets = hydrateAccountSecrets(providerId);

  const counts = { processed: 0, imported: 0, updated: 0 };
  let sawTerminalStatus = false;

  const notify = (evt = {}) => {
    const next = { ...evt };
    if (typeof next.processed === 'number' && Number.isFinite(next.processed)) counts.processed = next.processed;
    if (typeof next.imported === 'number' && Number.isFinite(next.imported)) counts.imported = next.imported;
    if (typeof next.updated === 'number' && Number.isFinite(next.updated)) counts.updated = next.updated;
    if (next.status === 'done' || next.status === 'error') sawTerminalStatus = true;

    emitImportProgress(providerId, {
      status: next.status || 'progress',
      processed: counts.processed,
      imported: counts.imported,
      updated: counts.updated,
      message: next.message,
    });
  };

  notify({ status: 'start', processed: 0, imported: 0, updated: 0 });

  try {
    const res = await provider.importLibrary({ db: ctx.db, saveDB: ctx.saveDB, notify, ...options });
    const importedCount = importCount(res?.imported);
    const updatedCount = importCount(res?.updated);
    const processedCount = typeof res?.processed === 'number' && Number.isFinite(res.processed)
      ? res.processed
      : (typeof res?.total === 'number' && Number.isFinite(res.total) ? res.total : importedCount + updatedCount);
    const hasError = !!res?.error;

    if (!sawTerminalStatus) {
      emitImportProgress(providerId, {
        status: hasError ? 'error' : 'done',
        processed: Math.max(counts.processed, processedCount),
        imported: Math.max(counts.imported, importedCount),
        updated: Math.max(counts.updated, updatedCount),
        message: hasError ? String(res.error || '') : undefined,
      });
    }

    return res;
  } catch (e) {
    emitImportProgress(providerId, {
      status: 'error',
      processed: counts.processed,
      imported: counts.imported,
      updated: counts.updated,
      message: e.message,
    });
    return { error: `${providerId} import failed: ` + e.message };
  } finally {
    releaseSecrets();
  }
}

// ─── Import with Token Refresh ───────────────────────────────────────────────
async function importWithTokenRefresh(providerId) {
  const acct = (ctx.db.accounts || {})[providerId];
  const expiry = acct?.msExpiresAt ?? acct?.expiresAt;
  if (expiry && Date.now() > (expiry - 60000)) {
    const ok = await refreshAccountToken(providerId);
    if (!ok) return { error: `${providerId} session expired. Please sign in again.` };
  }
  let res = await runProviderImportWithProgress(providerId);
  if (res?.error && /(401|403|unauthor|token|expired)/i.test(String(res.error || ''))) {
    const ok = await refreshAccountToken(providerId);
    if (!ok) return res;
    res = await runProviderImportWithProgress(providerId);
  }
  return res;
}

// ─── Local Provider Auth ──────────────────────────────────────────────────────
// EA, Battle.net, itch.io and Ubisoft don't expose a public OAuth route, so
// "sign in" here means: scan the official launcher's local cache and treat
// the presence of installed/owned games as proof the user is signed in to
// that launcher on this machine.
async function handleLocalProviderAuth(providerId, displayName) {
  const p = getProviders();
  const provider = p?.[providerId];
  if (!provider || typeof provider.detectInstalled !== 'function') {
    return { error: `${displayName} provider not available` };
  }
  const detected = provider.detectInstalled();
  if (detected?.error) return { error: detected.error };
  const gameCount = Array.isArray(detected?.games) ? detected.games.length : 0;
  if (gameCount === 0 && typeof provider.isAppInstalled === 'function' && !provider.isAppInstalled()) {
    return { error: `${displayName} is not installed on this PC. Install it and sign in there first.` };
  }
  const accountData = {
    connected: true,
    displayName,
    gameCount,
    lastSync: new Date().toISOString(),
  };
  persistAccountData(providerId, accountData);
  return { success: true, displayName, gameCount, localOnly: true };
}

async function handleProviderImport(providerId) {
  let apiKey = null;
  if (providerId === 'itchio') {
    try { apiKey = ctx.safeStore.getPassword('cereal-itchio', 'default') || null; } catch (_e) { /* ignore */ }
  }
  return runProviderImportWithProgress(providerId, apiKey ? { apiKey } : {});
}

// ─── Helper: extract code + validate state from OAuth callback URL ───────────
// login.live.com sometimes returns code/state on the URL fragment (#) instead
// of the query string when the desktop redirect is used; check both.
function extractOAuthCode(url) {
  let u;
  try { u = new URL(url); } catch (_e) { return { error: 'Malformed callback URL' }; }
  const fromQuery = u.searchParams;
  const fromHash = new URLSearchParams((u.hash || '').replace(/^#/, ''));
  const get = (k) => fromQuery.get(k) || fromHash.get(k);
  const code = get('code');
  const error = get('error');
  const returnedState = get('state');
  if (error) return { error: get('error_description') || error };
  if (returnedState && !validateOAuthState(returnedState)) return { error: 'Security validation failed (state mismatch)' };
  if (!code) return { error: 'No authorization code received' };
  return { code };
}

function saveAccountAndReturn(platform, data) {
  persistAccountData(platform, { ...data, connected: true });
}

// ─── Register IPC Handlers ───────────────────────────────────────────────────
function registerAccountIpcHandlers() {
  const a = getAuth();
  const p = getProviders();

  ipcMain.handle('accounts:get', () => {
    return sanitizeAccountsForRenderer(ctx.db.accounts);
  });

  ipcMain.handle('accounts:save', (event, platform, data) => {
    if (!isValidPlatform(platform)) return sanitizeAccountsForRenderer(ctx.db.accounts || {});
    const allowedKeys = ['connected', 'displayName', 'gamertag', 'avatarUrl', 'lastSync', 'gameCount'];
    const filtered = {};
    for (const [key, val] of Object.entries(data || {})) {
      if (allowedKeys.includes(key)) filtered[key] = val;
    }
    persistAccountData(platform, filtered);
    return sanitizeAccountsForRenderer(ctx.db.accounts);
  });

  ipcMain.handle('accounts:remove', (event, platform) => {
    if (!isValidPlatform(platform)) return sanitizeAccountsForRenderer(ctx.db.accounts || {});
    if (!ctx.db.accounts) ctx.db.accounts = {};
    if (ctx.db.accounts[platform]) {
      detachAccountSecrets(platform);
      delete ctx.db.accounts[platform];
    }
    // Clear any persistent auth-window cookies tied to this platform so the
    // next sign-in doesn't silently re-use the old session.
    const partitionForPlatform = {
      steam: 'persist:steam-auth',
      gog: 'auth:gog',
      epic: 'auth:epic',
      xbox: 'auth:xbox',
    }[platform];
    if (partitionForPlatform) {
      try { session.fromPartition(partitionForPlatform).clearStorageData(); } catch (_e) { /* best-effort */ }
    }
    ctx.saveDB(ctx.db);
    return sanitizeAccountsForRenderer(ctx.db.accounts);
  });

  // ── Steam OpenID Sign-in ──
  ipcMain.handle('accounts:steam:auth', async () => {
    const c = a.CONFIG.steam;
    const oauthState = generateOAuthState();
    return runOAuthFlow({
      partition: 'persist:steam-auth', ...c.windowSize,
      debugLabel: 'steam',
      authUrl: a.buildSteamAuthUrl(oauthState),
      redirectMatch: (url) => url.startsWith(c.returnUrl),
      keepSession: true,
      onRedirect: async (url, finish) => {
        try {
          const returnedState = a.extractSteamState(url);
          if (!validateOAuthState(returnedState)) { finish({ error: 'Security validation failed (state mismatch)' }); return; }
          const steamId = a.extractSteamId(url);
          if (!steamId) { finish({ error: 'Could not extract Steam ID' }); return; }
          const profile = await a.fetchSteamProfile(steamId);
          saveAccountAndReturn('steam', { steamId, ...profile });
          finish({ success: true, steamId, ...profile });
        } catch (e) { finish({ error: e.message }); }
      },
    });
  });

  ipcMain.handle('accounts:steam:import', async () => {
    if (!p?.steam?.importLibrary) return { error: 'Steam provider not available' };
    let apiKey = null;
    try { const r = ctx.safeStore.getPassword('cereal-steam', 'default'); if (r) apiKey = r; } catch (_e) { /* best-effort */ }
    const steamSession = session.fromPartition('persist:steam-auth');
    const sessionFetch = steamSession.fetch.bind(steamSession);
    return runProviderImportWithProgress('steam', { apiKey, sessionFetch });
  });

  // ── GOG OAuth2 ──
  ipcMain.handle('accounts:gog:auth', async () => {
    const c = a.CONFIG.gog;
    const oauthState = generateOAuthState();
    return runOAuthFlow({
      partition: 'auth:gog', ...c.windowSize,
      debugLabel: 'gog',
      authUrl: a.buildGogAuthUrl(oauthState),
      redirectMatch: (url) => url.includes('on_login_success') && url.includes('code='),
      onRedirect: async (url, finish) => {
        try {
          const { code, error } = extractOAuthCode(url);
          if (error) { finish({ error }); return; }
          const tokens = await a.exchangeGogCode(code);
          if (tokens.error) { finish(tokens); return; }
          saveAccountAndReturn('gog', tokens);
          finish({ success: true, userId: tokens.userId });
        } catch (e) { finish({ error: e.message }); }
      },
    });
  });

  ipcMain.handle('accounts:gog:import', async () => {
    if (!p?.gog?.importLibrary) return { error: 'GOG provider not available' };
    const res = await importWithTokenRefresh('gog');
    if (!res?.error) {
      const installed = scanGogInstalled();
      if (installed.length > 0) {
        const installedIds = new Set(installed.map(g => g.platformId).filter(Boolean));
        let changed = false;
        for (const g of ctx.db.games) {
          if (g.platform === 'gog') {
            const isInstalled = !!(g.platformId && installedIds.has(g.platformId));
            if (isInstalled && !g.installed) { g.installed = true; changed = true; }
            else if (!isInstalled && g.installed === undefined) { g.installed = false; changed = true; }
          }
        }
        if (changed) ctx.saveDB(ctx.db);
      }
    }
    return res;
  });

  // ── Epic Games OAuth ──
  ipcMain.handle('accounts:epic:auth', async () => {
    const c = a.CONFIG.epic;
    const oauthState = generateOAuthState();
    return runOAuthFlow({
      partition: 'auth:epic', ...c.windowSize,
      debugLabel: 'epic',
      authUrl: a.buildEpicAuthUrl(oauthState),
      redirectMatch: (url) => url.includes('epicgames.com/id/api/redirect'),
      allowNavigate: true,
      onRedirect: async (url, finish, { session: authSess }) => {
        try {
          const returnedState = (() => { try { return new URL(url).searchParams.get('state'); } catch { return null; } })();
          if (!validateOAuthState(returnedState)) { finish({ error: 'Security validation failed (state mismatch)' }); return; }
          const resp = await authSess.fetch(url);
          if (!resp.ok) { finish({ error: 'Epic redirect fetch failed: ' + resp.status }); return; }
          const data = await resp.json();
          const exchangeCode = data.exchangeCode || (data.redirectUrl && new URL(data.redirectUrl).searchParams.get('code'));
          if (!exchangeCode) { finish({ error: 'No exchange code in Epic response' }); return; }
          const tokens = await a.exchangeEpicCode(exchangeCode);
          if (tokens.error) { finish(tokens); return; }
          saveAccountAndReturn('epic', tokens);
          finish({ success: true, displayName: tokens.displayName });
        } catch (e) { finish({ error: e.message }); }
      },
    });
  });

  ipcMain.handle('accounts:epic:import', async () => {
    if (!p?.epic?.importLibrary) return { error: 'Epic provider not available' };
    const res = await importWithTokenRefresh('epic');
    if (!res?.error) {
      const installed = scanEpicInstalled();
      if (installed.length > 0) {
        const installedIds = new Set(installed.map(g => g.platformId).filter(Boolean));
        let changed = false;
        for (const g of ctx.db.games) {
          if (g.platform === 'epic') {
            const isInstalled = !!(g.platformId && installedIds.has(g.platformId));
            if (isInstalled && !g.installed) { g.installed = true; changed = true; }
            else if (!isInstalled && g.installed === undefined) { g.installed = false; changed = true; }
          }
        }
        if (changed) ctx.saveDB(ctx.db);
      }
    }
    return res;
  });

  // ── Xbox / Microsoft OAuth (login.live.com → XBL.signin) ──
  // login.live.com bounces the user to oauth20_desktop.srf with code/state on
  // the URL hash *or* query, depending on response_type. We use response_type=
  // code, so they land on a query-string URL we can intercept.
  ipcMain.handle('accounts:xbox:auth', async () => {
    const c = a.CONFIG.xbox;
    const aad = a.isXboxAadMode();
    const oauthState = generateOAuthState();

    // PKCE pair — only used in AAD mode but generated unconditionally so the
    // surrounding code stays simple.
    const pkceVerifier = crypto.randomBytes(32).toString('base64url');
    const pkceChallenge = crypto.createHash('sha256').update(pkceVerifier).digest('base64url');

    log.info('accounts', '[xbox] starting sign-in, mode=' + (aad ? 'aad' : 'legacy-msa'));

    return runOAuthFlow({
      partition: 'auth:xbox', ...c.windowSize,
      debugLabel: 'xbox',
      authUrl: a.buildXboxAuthUrl(oauthState, pkceChallenge),
      redirectMatch: (url) => url.startsWith(c.redirectUri),
      onRedirect: async (url, finish) => {
        try {
          // ── Phase 1: get an MSA access token (RPS ticket) ──
          let msAccessToken; let msRefreshToken = null; let msExpiresAt = 0;
          let tokenPrefix;

          if (aad) {
            log.info('accounts', '[xbox] phase=aad-extract-code');
            const { code, error } = extractOAuthCode(url);
            if (error) { log.warn('accounts', '[xbox] aad-extract-code failed:', error); finish({ error }); return; }

            log.info('accounts', '[xbox] phase=aad-token-exchange');
            const tk = await a.exchangeAadCode(code, pkceVerifier);
            if (tk.error) { log.warn('accounts', '[xbox] aad-token-exchange failed:', tk.error); finish(tk); return; }
            msAccessToken = tk.accessToken;
            msRefreshToken = tk.refreshToken;
            msExpiresAt = tk.expiresAt;
            tokenPrefix = 'd=';
          } else {
            log.info('accounts', '[xbox] phase=extract-implicit-token');
            const ms = a.extractMsImplicitToken(url);
            if (ms.error) { log.warn('accounts', '[xbox] extract-implicit-token failed:', ms.error); finish({ error: ms.error }); return; }
            if (ms.state && !validateOAuthState(ms.state)) { finish({ error: 'Security validation failed (state mismatch)' }); return; }
            msAccessToken = ms.accessToken;
            msRefreshToken = ms.refreshToken;
            msExpiresAt = ms.expiresAt;
            tokenPrefix = 't=';
          }

          // ── Phase 2: XBL ──
          log.info('accounts', '[xbox] phase=xbl-authenticate (prefix=' + tokenPrefix + ')');
          const xbl = await a.authenticateXbl(msAccessToken, { tokenPrefix });
          if (xbl.error) {
            log.warn('accounts', '[xbox] xbl-authenticate failed:', xbl.error,
              xbl._status ? '(status ' + xbl._status + ')' : '',
              xbl._raw ? 'body=' + String(xbl._raw).slice(0, 300) : '');
            finish({ error: xbl.error });
            return;
          }

          // ── Phase 3: XSTS ──
          log.info('accounts', '[xbox] phase=xsts-authorize');
          const xsts = await a.authenticateXsts(xbl.xblToken);
          if (xsts.error) {
            log.warn('accounts', '[xbox] xsts-authorize failed:', xsts.error,
              xsts._status ? '(status ' + xsts._status + ')' : '',
              xsts._raw ? 'body=' + String(xsts._raw).slice(0, 300) : '');
            finish({ error: xsts.error });
            return;
          }

          // ── Phase 4: profile ──
          log.info('accounts', '[xbox] phase=profile-fetch (xuid=' + xsts.xuid + ', gamertag=' + xsts.gamertag + ')');
          const avatarUrl = await a.fetchXboxProfile(xsts.xuid, xbl.userHash, xsts.xstsToken);

          const tokens = {
            msAccessToken,
            msRefreshToken,
            msExpiresAt,
            xblToken: xbl.xblToken,
            userHash: xbl.userHash,
            xstsToken: xsts.xstsToken,
            gamertag: xsts.gamertag,
            xuid: xsts.xuid,
            avatarUrl,
            authMode: aad ? 'aad' : 'msa',
          };
          saveAccountAndReturn('xbox', tokens);
          log.info('accounts', '[xbox] saved account, gamertag=' + xsts.gamertag);
          finish({ success: true, gamertag: tokens.gamertag, avatarUrl: tokens.avatarUrl });
        } catch (e) {
          log.error('accounts', '[xbox] auth chain threw:', e);
          finish({ error: 'Xbox auth chain failed: ' + (e && e.message || e) });
        }
      },
    });
  });

  ipcMain.handle('accounts:xbox:import', async () => {
    if (!p?.xbox?.importLibrary) return { error: 'Xbox provider not available' };
    return importWithTokenRefresh('xbox');
  });

  // Refresh which Xbox library entries are currently streamable via Xbox
  // Cloud Gaming. Hits the public Game Pass catalog only — no XBL auth needed,
  // so this works even if the user's MS Account token has expired.
  ipcMain.handle('accounts:xbox:refreshCloud', async () => {
    if (!p?.xbox?.refreshCloudAvailability) return { error: 'Xbox provider not available' };
    try {
      const res = await p.xbox.refreshCloudAvailability({ db: ctx.db, saveDB: ctx.saveDB });
      if (res?.touched > 0) ctx.sendToRenderer('games:refresh', ctx.db.games);
      return res;
    } catch (e) {
      return { error: 'Cloud refresh failed: ' + (e?.message || e) };
    }
  });

  // ── Local-Only Providers ──
  // None of these vendors offer a public OAuth route, so "sign in" means
  // detecting an already-signed-in launcher on disk.
  ipcMain.handle('accounts:ea:auth', async () => handleLocalProviderAuth('ea', PLATFORM_DISPLAY_NAMES.ea));
  ipcMain.handle('accounts:battlenet:auth', async () => handleLocalProviderAuth('battlenet', PLATFORM_DISPLAY_NAMES.battlenet));
  ipcMain.handle('accounts:itchio:auth', async () => handleLocalProviderAuth('itchio', PLATFORM_DISPLAY_NAMES.itchio));
  ipcMain.handle('accounts:ubisoft:auth', async () => handleLocalProviderAuth('ubisoft', PLATFORM_DISPLAY_NAMES.ubisoft));

  ipcMain.handle('accounts:ea:import', async () => handleProviderImport('ea'));
  ipcMain.handle('accounts:battlenet:import', async () => handleProviderImport('battlenet'));
  ipcMain.handle('accounts:itchio:import', async () => handleProviderImport('itchio'));
  ipcMain.handle('accounts:ubisoft:import', async () => handleProviderImport('ubisoft'));
}

module.exports = {
  detachAccountSecrets,
  registerAccountIpcHandlers,
};
