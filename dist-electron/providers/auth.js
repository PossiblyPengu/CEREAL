const { httpGet, httpGetJson, httpPost } = require('./http');

// ─── Platform Auth Configuration ─────────────────────────────────────────────
const CONFIG = {
  steam: {
    openIdUrl: 'https://steamcommunity.com/openid/login',
    returnUrl: 'https://cereal-launcher.local/steam-callback',
    realm: 'https://cereal-launcher.local/',
    profileUrl: (id) => `https://steamcommunity.com/profiles/${id}/?xml=1`,
    windowSize: { width: 900, height: 700 },
    allowedDomains: ['steamcommunity.com', 'store.steampowered.com', 'login.steampowered.com'],
  },
  gog: {
    clientId: '46899977096215655',
    clientSecret: '9d85c43b1482497dbbce61f6e4aa173a433796eeae2ca8c5f6129f2dc4de46d9',
    redirectUri: 'https://embed.gog.com/on_login_success?origin=client',
    authUrl: 'https://login.gog.com/auth',
    tokenUrl: 'https://auth.gog.com/token',
    windowSize: { width: 500, height: 700 },
    allowedDomains: ['login.gog.com', 'auth.gog.com', 'embed.gog.com', 'gog.com'],
  },
  epic: {
    clientId: '34a02cf8f4414e29b15921876da36f9a',
    clientSecret: 'daafbccc737745039dffe53d94fc76cf',
    redirectApiUrl: 'https://www.epicgames.com/id/api/redirect',
    authUrl: 'https://www.epicgames.com/id/login',
    tokenUrl: 'https://account-public-service-prod03.ol.epicgames.com/account/api/oauth/token',
    windowSize: { width: 800, height: 700 },
    allowedDomains: ['epicgames.com', 'www.epicgames.com'],
  },
  xbox: {
    clientId: '1fec8e78-bce4-4aaf-ab1b-5451cc387264',
    redirectUri: 'https://login.microsoftonline.com/common/oauth2/nativeclient',
    scope: 'XboxLive.signin XboxLive.offline_access openid profile',
    authUrl: 'https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize',
    tokenUrl: 'https://login.microsoftonline.com/consumers/oauth2/v2.0/token',
    xblAuthUrl: 'https://user.auth.xboxlive.com/user/authenticate',
    xstsAuthUrl: 'https://xsts.auth.xboxlive.com/xsts/authorize',
    profileUrl: (xuid) => `https://profile.xboxlive.com/users/xuid(${xuid})/profile/settings?settings=GameDisplayPicRaw`,
    windowSize: { width: 600, height: 700 },
    allowedDomains: ['login.microsoftonline.com', 'login.live.com', 'account.live.com'],
  },
};

// ─── Steam ───────────────────────────────────────────────────────────────────
function buildSteamAuthUrl(state) {
  const c = CONFIG.steam;
  const params = new URLSearchParams({
    'openid.ns': 'http://specs.openid.net/auth/2.0',
    'openid.mode': 'checkid_setup',
    'openid.return_to': c.returnUrl,
    'openid.realm': c.realm,
    'openid.identity': 'http://specs.openid.net/auth/2.0/identifier_select',
    'openid.claimed_id': 'http://specs.openid.net/auth/2.0/identifier_select',
  });
  return c.openIdUrl + '?' + params.toString();
}

function extractSteamId(callbackUrl) {
  const u = new URL(callbackUrl);
  const claimedId = u.searchParams.get('openid.claimed_id') || '';
  const m = claimedId.match(/(\d{17})$/);
  return m ? m[1] : null;
}

async function fetchSteamProfile(steamId) {
  const r = await httpGet(CONFIG.steam.profileUrl(steamId));
  const raw = r.raw || '';
  const getCdata = (t) => { const m = raw.match(new RegExp('<' + t + '><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></' + t + '>')); return m ? m[1] : null; };
  const getTag = (t) => { const m = raw.match(new RegExp('<' + t + '>([^<]*)</' + t + '>')); return m ? m[1] : null; };
  return {
    displayName: getCdata('steamID') || getTag('steamID') || 'Steam User',
    avatarUrl: getTag('avatarMedium') || getTag('avatarFull') || '',
  };
}

// ─── GOG ─────────────────────────────────────────────────────────────────────
function buildGogAuthUrl(state) {
  const c = CONFIG.gog;
  return `${c.authUrl}?client_id=${c.clientId}&redirect_uri=${encodeURIComponent(c.redirectUri)}&response_type=code&layout=client2&state=${state}`;
}

async function exchangeGogCode(code) {
  const c = CONFIG.gog;
  const r = await httpGetJson(`${c.tokenUrl}?client_id=${c.clientId}&client_secret=${c.clientSecret}&grant_type=authorization_code&code=${encodeURIComponent(code)}&redirect_uri=${encodeURIComponent(c.redirectUri)}`);
  if (!r.data?.access_token) return { error: 'Token exchange failed' };
  return {
    accessToken: r.data.access_token,
    refreshToken: r.data.refresh_token,
    expiresAt: Date.now() + (r.data.expires_in || 3600) * 1000,
    userId: r.data.user_id,
  };
}

async function refreshGogToken(refreshToken) {
  const c = CONFIG.gog;
  const r = await httpGetJson(`${c.tokenUrl}?client_id=${c.clientId}&client_secret=${c.clientSecret}&grant_type=refresh_token&refresh_token=${encodeURIComponent(refreshToken)}`);
  if (!r.data?.access_token) return null;
  return {
    accessToken: r.data.access_token,
    refreshToken: r.data.refresh_token || refreshToken,
    expiresAt: Date.now() + (r.data.expires_in || 3600) * 1000,
  };
}

// ─── Epic ────────────────────────────────────────────────────────────────────
function buildEpicAuthUrl(state) {
  const c = CONFIG.epic;
  const redirectUrl = `${c.redirectApiUrl}?clientId=${c.clientId}&responseType=code`;
  return `${c.authUrl}?redirectUrl=${encodeURIComponent(redirectUrl)}`;
}

function epicBasicAuth() {
  return Buffer.from(CONFIG.epic.clientId + ':' + CONFIG.epic.clientSecret).toString('base64');
}

async function exchangeEpicCode(exchangeCode) {
  const r = await httpPost(CONFIG.epic.tokenUrl, {
    grant_type: 'exchange_code', exchange_code: exchangeCode, token_type: 'eg1',
  }, { 'Authorization': 'Basic ' + epicBasicAuth() });
  if (!r.data?.access_token) return { error: 'Token exchange failed (status ' + r.status + ')' };
  return {
    accessToken: r.data.access_token,
    refreshToken: r.data.refresh_token,
    expiresAt: Date.now() + (r.data.expires_in || 3600) * 1000,
    accountId: r.data.account_id,
    displayName: r.data.displayName || r.data.display_name || 'Epic User',
  };
}

async function refreshEpicToken(refreshToken) {
  const r = await httpPost(CONFIG.epic.tokenUrl, {
    grant_type: 'refresh_token', refresh_token: refreshToken,
  }, { 'Authorization': 'Basic ' + epicBasicAuth() });
  if (!r.data?.access_token) return null;
  return {
    accessToken: r.data.access_token,
    refreshToken: r.data.refresh_token || refreshToken,
    expiresAt: Date.now() + (r.data.expires_in || 3600) * 1000,
  };
}

// ─── Xbox / Microsoft ────────────────────────────────────────────────────────
function buildXboxAuthUrl(state) {
  const c = CONFIG.xbox;
  return `${c.authUrl}?client_id=${c.clientId}&response_type=code&redirect_uri=${encodeURIComponent(c.redirectUri)}&scope=${encodeURIComponent(c.scope)}&response_mode=query&state=${state}`;
}

async function exchangeMsCode(code) {
  const c = CONFIG.xbox;
  const r = await httpPost(c.tokenUrl, {
    client_id: c.clientId, grant_type: 'authorization_code',
    code, redirect_uri: c.redirectUri, scope: c.scope,
  });
  if (!r.data?.access_token) return { error: 'MS token exchange failed' };
  return {
    accessToken: r.data.access_token,
    refreshToken: r.data.refresh_token,
    expiresAt: Date.now() + (r.data.expires_in || 3600) * 1000,
  };
}

async function authenticateXbl(msAccessToken) {
  const c = CONFIG.xbox;
  const xblR = await httpPost(c.xblAuthUrl, JSON.stringify({
    Properties: { AuthMethod: 'RPS', SiteName: 'user.auth.xboxlive.com', RpsTicket: 'd=' + msAccessToken },
    RelyingParty: 'http://auth.xboxlive.com', TokenType: 'JWT',
  }), { 'Content-Type': 'application/json', 'x-xbl-contract-version': '1' });
  if (!xblR.data?.Token) return { error: 'Xbox Live auth failed' };
  return {
    xblToken: xblR.data.Token,
    userHash: xblR.data.DisplayClaims?.xui?.[0]?.uhs || '',
  };
}

async function authenticateXsts(xblToken) {
  const c = CONFIG.xbox;
  const xstsR = await httpPost(c.xstsAuthUrl, JSON.stringify({
    Properties: { SandboxId: 'RETAIL', UserTokens: [xblToken] },
    RelyingParty: 'http://xboxlive.com', TokenType: 'JWT',
  }), { 'Content-Type': 'application/json', 'x-xbl-contract-version': '1' });
  if (!xstsR.data?.Token) return { error: 'XSTS auth failed' };
  return {
    xstsToken: xstsR.data.Token,
    gamertag: xstsR.data.DisplayClaims?.xui?.[0]?.gtg || '',
    xuid: xstsR.data.DisplayClaims?.xui?.[0]?.xid || '',
  };
}

async function fetchXboxProfile(xuid, userHash, xstsToken) {
  try {
    const r = await httpGetJson(CONFIG.xbox.profileUrl(xuid), {
      'Authorization': 'XBL3.0 x=' + userHash + ';' + xstsToken,
      'x-xbl-contract-version': '3',
    });
    return r.data?.profileUsers?.[0]?.settings?.[0]?.value || '';
  } catch (e) { return ''; }
}

async function exchangeXboxCode(code) {
  const msTokens = await exchangeMsCode(code);
  if (msTokens.error) return msTokens;

  const xbl = await authenticateXbl(msTokens.accessToken);
  if (xbl.error) return xbl;

  const xsts = await authenticateXsts(xbl.xblToken);
  if (xsts.error) return xsts;

  const avatarUrl = await fetchXboxProfile(xsts.xuid, xbl.userHash, xsts.xstsToken);

  return {
    msAccessToken: msTokens.accessToken,
    msRefreshToken: msTokens.refreshToken,
    msExpiresAt: msTokens.expiresAt,
    xblToken: xbl.xblToken,
    userHash: xbl.userHash,
    xstsToken: xsts.xstsToken,
    gamertag: xsts.gamertag,
    xuid: xsts.xuid,
    avatarUrl,
  };
}

async function refreshXboxTokens(msRefreshToken) {
  const c = CONFIG.xbox;
  const msR = await httpPost(c.tokenUrl, {
    client_id: c.clientId, grant_type: 'refresh_token',
    refresh_token: msRefreshToken, scope: c.scope,
  });
  if (!msR.data?.access_token) return null;

  const xbl = await authenticateXbl(msR.data.access_token);
  if (xbl.error) return null;

  const xsts = await authenticateXsts(xbl.xblToken);
  if (xsts.error) return null;

  return {
    msAccessToken: msR.data.access_token,
    msRefreshToken: msR.data.refresh_token || msRefreshToken,
    msExpiresAt: Date.now() + (msR.data.expires_in || 3600) * 1000,
    xblToken: xbl.xblToken,
    userHash: xbl.userHash,
    xstsToken: xsts.xstsToken,
  };
}

// ─── Exports ─────────────────────────────────────────────────────────────────
module.exports = {
  CONFIG,
  // Steam
  buildSteamAuthUrl,
  extractSteamId,
  fetchSteamProfile,
  // GOG
  buildGogAuthUrl,
  exchangeGogCode,
  refreshGogToken,
  // Epic
  buildEpicAuthUrl,
  exchangeEpicCode,
  refreshEpicToken,
  // Xbox
  buildXboxAuthUrl,
  exchangeXboxCode,
  refreshXboxTokens,
};
