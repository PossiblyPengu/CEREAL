// ─── Account Management, OAuth, Token Refresh, Import Progress ────────────────
const { BrowserWindow, session, ipcMain } = require('electron');
const crypto = require('crypto');
const path = require('path');
const ctx = require('../core/context');
const { ACCOUNT_SECRET_FIELDS } = require('../core/constants');
const { scanEpicInstalled, scanGogInstalled } = require('../metadata/detection');
const log = require('../core/logger');
const { getProvidersDir } = require('../core/paths');

// Lazy-loaded — these are resolved at call time (after app.whenReady)
let providers = null;
let auth = null;

function getProviders() {
  if (!providers) providers = require(getProvidersDir());
  return providers;
}
function getAuth() {
  if (!auth) auth = require(path.join(getProvidersDir(), 'auth'));
  return auth;
}

// ─── Account Secret Management ────────────────────────────────────────────────

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

// Allowed auth window navigation domains
const ALLOWED_AUTH_DOMAINS = [
  'steamcommunity.com', 'store.steampowered.com', 'login.steampowered.com',
  'login.gog.com', 'auth.gog.com', 'embed.gog.com', 'gog.com',
  'epicgames.com', 'www.epicgames.com',
  'microsoftonline.com', 'live.com', 'microsoft.com', 'msauth.net', 'msftauth.net',
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
    parent: ctx.mainWindow,
    modal: true,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, session: authSession },
  });
  win.setMenuBarVisibility(false);
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  return win;
}

// ─── OAuth Auth Window Helper ─────────────────────────────────────────────────
function runOAuthFlow({ partition, width, height, authUrl, redirectMatch, onRedirect, allowNavigate, keepSession }) {
  return new Promise((resolve) => {
    const partitionStr = keepSession ? partition : (partition + ':' + Date.now());
    const authSession = session.fromPartition(partitionStr);
    const authWin = createAuthWindow(width || 700, height || 700, authSession);
    let resolved = false;
    let authTimeout = null;
    const cleanup = () => {
      if (authTimeout) { clearTimeout(authTimeout); authTimeout = null; }
      if (!keepSession) {
        try { authSession.clearStorageData(); } catch (_e) { /* best-effort */ }
      }
    };
    const finish = (result) => {
      if (resolved) return;
      resolved = true;
      cleanup();
      try { authWin.close(); } catch (_e) { /* best-effort */ }
      resolve(result);
    };
    authTimeout = setTimeout(() => finish({ error: 'Authentication timed out' }), AUTH_TIMEOUT_MS);
    const handleUrl = (url) => {
      if (resolved) return;
      if (redirectMatch(url)) onRedirect(url, finish, { win: authWin, session: authSession });
    };
    authWin.webContents.on('will-navigate', (event, url) => {
      if (redirectMatch(url)) {
        if (!allowNavigate) event.preventDefault();
        handleUrl(url);
        return;
      }
      if (!isAllowedAuthDomain(url)) { event.preventDefault(); }
    });
    authWin.webContents.on('will-redirect', (event, url) => {
      if (redirectMatch(url)) {
        if (!allowNavigate) event.preventDefault();
        handleUrl(url);
      }
    });
    authWin.webContents.on('did-navigate', (event, url) => handleUrl(url));
    authWin.on('closed', () => { cleanup(); if (!resolved) { resolved = true; resolve({ error: 'cancelled' }); } });
    authWin.loadURL(authUrl);
  });
}

// ─── Token Refresh ────────────────────────────────────────────────────────────
async function refreshAccountToken(platform) {
  const a = getAuth();
  const acct = (ctx.db.accounts || {})[platform];
  if (!acct) return false;
  const releaseSecrets = hydrateAccountSecrets(platform);
  try {
    let tokens;
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
  } catch (_e) { return false; }
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
async function handleLocalProviderAuth(providerId, displayName) {
  const p = getProviders();
  const provider = p?.[providerId];
  if (!provider || typeof provider.detectInstalled !== 'function') {
    return { error: `${displayName} provider not available` };
  }
  const detected = provider.detectInstalled();
  if (detected?.error) return { error: detected.error };
  const accountData = {
    connected: true,
    displayName,
    gameCount: Array.isArray(detected?.games) ? detected.games.length : 0,
    lastSync: new Date().toISOString(),
  };
  persistAccountData(providerId, accountData);
  return { success: true, displayName, gameCount: accountData.gameCount, localOnly: true };
}

async function handleProviderImport(providerId) {
  let apiKey = null;
  if (providerId === 'itchio') {
    try { apiKey = ctx.safeStore.getPassword('cereal-itchio', 'default') || null; } catch (_e) { /* ignore */ }
  }
  return runProviderImportWithProgress(providerId, apiKey ? { apiKey } : {});
}

// ─── Helper: extract code + validate state from OAuth callback URL ───────────
function extractOAuthCode(url) {
  const u = new URL(url);
  const code = u.searchParams.get('code');
  const error = u.searchParams.get('error');
  const returnedState = u.searchParams.get('state');
  if (error) return { error: u.searchParams.get('error_description') || error };
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
    if (!platform || typeof platform !== 'string') return sanitizeAccountsForRenderer(ctx.db.accounts || {});
    const allowedKeys = ['connected', 'displayName', 'gamertag', 'avatarUrl', 'lastSync', 'gameCount'];
    const filtered = {};
    for (const [key, val] of Object.entries(data || {})) {
      if (allowedKeys.includes(key)) filtered[key] = val;
    }
    persistAccountData(platform, filtered);
    return sanitizeAccountsForRenderer(ctx.db.accounts);
  });

  ipcMain.handle('accounts:remove', (event, platform) => {
    if (!ctx.db.accounts) ctx.db.accounts = {};
    if (ctx.db.accounts[platform]) {
      detachAccountSecrets(platform);
      delete ctx.db.accounts[platform];
    }
    if (platform === 'steam') {
      try { session.fromPartition('persist:steam-auth').clearStorageData(); } catch (_e) { /* best-effort */ }
    }
    ctx.saveDB(ctx.db);
    return sanitizeAccountsForRenderer(ctx.db.accounts);
  });

  // ── Steam OpenID Sign-in ──
  ipcMain.handle('accounts:steam:auth', async () => {
    const c = a.CONFIG.steam;
    return runOAuthFlow({
      partition: 'persist:steam-auth', ...c.windowSize,
      authUrl: a.buildSteamAuthUrl(),
      redirectMatch: (url) => url.startsWith(c.returnUrl),
      keepSession: true,
      onRedirect: async (url, finish) => {
        try {
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
    return runOAuthFlow({
      partition: 'auth:epic', ...c.windowSize,
      authUrl: a.buildEpicAuthUrl(),
      redirectMatch: (url) => url.includes('epicgames.com/id/api/redirect'),
      allowNavigate: true,
      onRedirect: async (url, finish, { session: authSess }) => {
        try {
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

  // ── Xbox / Microsoft OAuth ──
  ipcMain.handle('accounts:xbox:auth', async () => {
    const c = a.CONFIG.xbox;
    const oauthState = generateOAuthState();
    return runOAuthFlow({
      partition: 'auth:xbox', ...c.windowSize,
      authUrl: a.buildXboxAuthUrl(oauthState),
      redirectMatch: (url) => url.startsWith(c.redirectUri),
      onRedirect: async (url, finish) => {
        try {
          const { code, error } = extractOAuthCode(url);
          if (error) { finish({ error }); return; }
          const tokens = await a.exchangeXboxCode(code);
          if (tokens.error) { finish(tokens); return; }
          saveAccountAndReturn('xbox', tokens);
          finish({ success: true, gamertag: tokens.gamertag, avatarUrl: tokens.avatarUrl });
        } catch (e) { finish({ error: 'Xbox auth chain failed: ' + e.message }); }
      },
    });
  });

  ipcMain.handle('accounts:xbox:import', async () => {
    if (!p?.xbox?.importLibrary) return { error: 'Xbox provider not available' };
    return importWithTokenRefresh('xbox');
  });

  // ── Local-Only Providers ──
  ipcMain.handle('accounts:ea:auth', async () => handleLocalProviderAuth('ea', 'EA App'));
  ipcMain.handle('accounts:battlenet:auth', async () => handleLocalProviderAuth('battlenet', 'Battle.net'));
  ipcMain.handle('accounts:itchio:auth', async () => handleLocalProviderAuth('itchio', 'itch.io'));
  ipcMain.handle('accounts:ubisoft:auth', async () => handleLocalProviderAuth('ubisoft', 'Ubisoft Connect'));

  ipcMain.handle('accounts:ea:import', async () => handleProviderImport('ea'));
  ipcMain.handle('accounts:battlenet:import', async () => handleProviderImport('battlenet'));
  ipcMain.handle('accounts:itchio:import', async () => handleProviderImport('itchio'));
  ipcMain.handle('accounts:ubisoft:import', async () => handleProviderImport('ubisoft'));
}

module.exports = {
  detachAccountSecrets,
  registerAccountIpcHandlers,
};
