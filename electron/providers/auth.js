// ─── Platform Sign-In ─────────────────────────────────────────────────────────
// Each provider here uses the *official* sign-in route documented (or de facto
// adopted) by the platform vendor. We never scrape passwords or simulate web
// forms — every flow is a redirect dance the user sees and consents to.
//
// Reference matrix:
//   Steam    OpenID 2.0 — https://steamcommunity.com/openid/login
//            Official mechanism Valve documents at
//            https://partner.steamgames.com/doc/features/auth#openid
//
//   GOG      OAuth2 (Galaxy client)
//            login.gog.com/auth + auth.gog.com/token. The clientId/secret are
//            the public GOG Galaxy client values used by every third-party
//            launcher (Heroic, Comet, Lutris…). GOG has no separately
//            registrable public OAuth client; this is the route GOG itself
//            sanctions for community projects.
//
//   Epic     OAuth2 (Epic Games Launcher client)
//            epicgames.com/id/login → account-public-service-prod03 token
//            endpoint. Same story as GOG — these are the public EGL launcher
//            credentials used by Heroic / Legendary / Rare.
//
//   Xbox     Microsoft Account OAuth (login.live.com → XBL.signin)
//            Documented Xbox Live sign-in: login.live.com/oauth20_authorize.srf
//            with the public Xbox Live consumer client. RPS ticket → XBL → XSTS
//            chain matches Microsoft's own xbox-live-auth reference flow.
//
//   itch.io  Personal API key from itch.io/user/settings/api-keys
//            itch.io's OAuth requires per-app registration with a vetted
//            redirect URI; the API-key route is the documented option for
//            community apps.
//
//   EA / Battle.net / Ubisoft
//            No public OAuth route is offered. We sign in by detecting the
//            user's locally installed launcher data only, and fall back to
//            opening the official client for interactive sign-in.

const { httpGet, httpGetJson, httpPost, httpPostNode } = require('./http');

// Published Xbox app UA — Microsoft's edge has been observed to 403 calls to
// xboxlive.com that ship Node's default UA or no UA at all.
const XBL_USER_AGENT = 'XAL/1.0 (XAL; X-S/Win32 Build 19044) WIN/10.0.19044';

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
    // Public GOG Galaxy client. Used by every third-party GOG client.
    clientId: '46899977096215655',
    clientSecret: '9d85c43b1482497dbbce61f6e4aa173a433796eeae2ca8c5f6129f2dc4de46d9',
    redirectUri: 'https://embed.gog.com/on_login_success?origin=client',
    authUrl: 'https://login.gog.com/auth',
    tokenUrl: 'https://auth.gog.com/token',
    windowSize: { width: 500, height: 700 },
    allowedDomains: ['login.gog.com', 'auth.gog.com', 'embed.gog.com', 'gog.com'],
  },
  epic: {
    // Public Epic Games Launcher client (well-known across the EGL/EOS
    // open-source ecosystem). Epic redirects through their JSON `redirect`
    // endpoint to hand back an exchange code we trade for tokens.
    clientId: '34a02cf8f4414e29b15921876da36f9a',
    clientSecret: 'daafbccc737745039dffe53d94fc76cf',
    redirectApiUrl: 'https://www.epicgames.com/id/api/redirect',
    authUrl: 'https://www.epicgames.com/id/login',
    tokenUrl: 'https://account-public-service-prod03.ol.epicgames.com/account/api/oauth/token',
    windowSize: { width: 800, height: 700 },
    allowedDomains: ['epicgames.com', 'www.epicgames.com'],
  },
  xbox: {
    // Microsoft Account / Xbox Live consumer flow. `0000000048093EE3` is the
    // public Xbox One App client used by xboxreplay/xboxlive-auth, OpenXBL,
    // MSALauth, and the rest of the open-source XBL tooling. It is paired
    // *only* with the legacy MSA scope `service::user.auth.xboxlive.com::
    // MBI_SSL` — the modern `XboxLive.signin` scope only works with newer
    // AAD-style clients (and AAD itself rejects the public Xbox client). If
    // you mix client and scope, XBL.signin returns 401 because the resulting
    // RPS ticket targets the wrong relying party.
    clientId: '0000000048093EE3',
    redirectUri: 'https://login.live.com/oauth20_desktop.srf',
    scope: 'service::user.auth.xboxlive.com::MBI_SSL',
    authUrl: 'https://login.live.com/oauth20_authorize.srf',
    tokenUrl: 'https://login.live.com/oauth20_token.srf',
    xblAuthUrl: 'https://user.auth.xboxlive.com/user/authenticate',
    xstsAuthUrl: 'https://xsts.auth.xboxlive.com/xsts/authorize',
    profileUrl: (xuid) => `https://profile.xboxlive.com/users/xuid(${xuid})/profile/settings?settings=GameDisplayPicRaw`,
    windowSize: { width: 600, height: 700 },
    allowedDomains: ['login.live.com', 'account.live.com', 'login.microsoftonline.com'],
  },
};

// ─── Steam (OpenID 2.0) ──────────────────────────────────────────────────────
// Steam OpenID doesn't support a standard `state` param, so we tunnel one
// through openid.return_to as a query string. Steam echoes return_to verbatim
// on success which lets us validate CSRF on the callback.
function buildSteamAuthUrl(state) {
  const c = CONFIG.steam;
  const returnUrl = state ? c.returnUrl + '?state=' + encodeURIComponent(state) : c.returnUrl;
  const params = new URLSearchParams({
    'openid.ns': 'http://specs.openid.net/auth/2.0',
    'openid.mode': 'checkid_setup',
    'openid.return_to': returnUrl,
    'openid.realm': c.realm,
    'openid.identity': 'http://specs.openid.net/auth/2.0/identifier_select',
    'openid.claimed_id': 'http://specs.openid.net/auth/2.0/identifier_select',
  });
  return c.openIdUrl + '?' + params.toString();
}

function extractSteamId(callbackUrl) {
  try {
    const u = new URL(callbackUrl);
    const claimedId = u.searchParams.get('openid.claimed_id') || '';
    const m = claimedId.match(/(\d{17})$/);
    return m ? m[1] : null;
  } catch (_e) { return null; }
}

function extractSteamState(callbackUrl) {
  try { return new URL(callbackUrl).searchParams.get('state'); } catch { return null; }
}

async function fetchSteamProfile(steamId) {
  try {
    const r = await httpGet(CONFIG.steam.profileUrl(steamId));
    const raw = r.raw || '';
    const getCdata = (t) => { const m = raw.match(new RegExp('<' + t + '><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></' + t + '>')); return m ? m[1] : null; };
    const getTag = (t) => { const m = raw.match(new RegExp('<' + t + '>([^<]*)</' + t + '>')); return m ? m[1] : null; };
    return {
      displayName: getCdata('steamID') || getTag('steamID') || 'Steam User',
      avatarUrl: getTag('avatarMedium') || getTag('avatarFull') || '',
    };
  } catch (_e) {
    return { displayName: 'Steam User', avatarUrl: '' };
  }
}

// ─── GOG (OAuth2 / Galaxy client) ────────────────────────────────────────────
function buildGogAuthUrl(state) {
  const c = CONFIG.gog;
  const params = new URLSearchParams({
    client_id: c.clientId,
    redirect_uri: c.redirectUri,
    response_type: 'code',
    layout: 'client2',
  });
  if (state) params.set('state', state);
  return `${c.authUrl}?${params.toString()}`;
}

async function exchangeGogCode(code) {
  const c = CONFIG.gog;
  const params = new URLSearchParams({
    client_id: c.clientId,
    client_secret: c.clientSecret,
    grant_type: 'authorization_code',
    code,
    redirect_uri: c.redirectUri,
  });
  const r = await httpGetJson(`${c.tokenUrl}?${params.toString()}`);
  if (!r.data?.access_token) {
    return { error: 'GOG token exchange failed (status ' + r.status + ')' };
  }
  return {
    accessToken: r.data.access_token,
    refreshToken: r.data.refresh_token,
    expiresAt: Date.now() + (r.data.expires_in || 3600) * 1000,
    userId: r.data.user_id,
  };
}

async function refreshGogToken(refreshToken) {
  const c = CONFIG.gog;
  const params = new URLSearchParams({
    client_id: c.clientId,
    client_secret: c.clientSecret,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });
  const r = await httpGetJson(`${c.tokenUrl}?${params.toString()}`);
  if (!r.data?.access_token) return null;
  return {
    accessToken: r.data.access_token,
    refreshToken: r.data.refresh_token || refreshToken,
    expiresAt: Date.now() + (r.data.expires_in || 3600) * 1000,
  };
}

// ─── Epic (OAuth2 / EGL client) ──────────────────────────────────────────────
function buildEpicAuthUrl(state) {
  const c = CONFIG.epic;
  const stateQs = state ? `&state=${encodeURIComponent(state)}` : '';
  const redirectUrl = `${c.redirectApiUrl}?clientId=${c.clientId}&responseType=code${stateQs}`;
  return `${c.authUrl}?redirectUrl=${encodeURIComponent(redirectUrl)}`;
}

function epicBasicAuth() {
  return Buffer.from(CONFIG.epic.clientId + ':' + CONFIG.epic.clientSecret).toString('base64');
}

async function exchangeEpicCode(exchangeCode) {
  const r = await httpPost(CONFIG.epic.tokenUrl, {
    grant_type: 'exchange_code', exchange_code: exchangeCode, token_type: 'eg1',
  }, { 'Authorization': 'Basic ' + epicBasicAuth() });
  if (!r.data?.access_token) {
    const msg = r.data?.errorMessage || r.data?.error_description || ('status ' + r.status);
    return { error: 'Epic token exchange failed: ' + msg };
  }
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

// ─── Xbox / Microsoft Account (login.live.com OR login.microsoftonline.com) ──
// We support two flows, picked automatically from the configured `authUrl`:
//
//   • LEGACY MSA   (default; login.live.com)
//       - OAuth 2.0 implicit flow (response_type=token)
//       - Public Xbox One client `0000000048093EE3`
//       - Scope `service::user.auth.xboxlive.com::MBI_SSL`
//       - RPS prefix `t=` for XBL.signin
//
//   • AAD          (override; login.microsoftonline.com)
//       - OAuth 2.0 authorization-code flow with PKCE
//       - User-registered Azure AD app (see docs/xbox-aad.md)
//       - Scope `XboxLive.signin XboxLive.offline_access`
//       - RPS prefix `d=` for XBL.signin
//
// Mixing flow + prefix produces an HTTP 403 with no body from
// user.auth.xboxlive.com — the most common Xbox auth bug we've hit.
function isXboxAadMode() {
  try { return new URL(CONFIG.xbox.authUrl).hostname.endsWith('microsoftonline.com'); }
  catch { return false; }
}

function buildXboxAuthUrl(state, pkceChallenge) {
  const c = CONFIG.xbox;
  const aad = isXboxAadMode();
  const params = new URLSearchParams({
    client_id: c.clientId,
    response_type: aad ? 'code' : 'token',
    redirect_uri: c.redirectUri,
    scope: c.scope,
    // `select_account` so users on a shared device can pick which MS account to
    // use, instead of getting silently signed in as whoever's already cached.
    prompt: 'select_account',
  });
  if (!aad) {
    params.set('display', 'touch');
    params.set('locale', 'en');
  }
  if (aad && pkceChallenge) {
    params.set('code_challenge', pkceChallenge);
    params.set('code_challenge_method', 'S256');
  }
  if (state) params.set('state', state);
  return `${c.authUrl}?${params.toString()}`;
}

// Implicit flow returns the RPS ticket on the URL fragment (#access_token=…).
// No token endpoint exchange step: the fragment value IS the RPS ticket.
function extractMsImplicitToken(callbackUrl) {
  let u;
  try { u = new URL(callbackUrl); } catch { return { error: 'Malformed callback URL' }; }
  // Microsoft sometimes returns params on the query string, sometimes the
  // fragment. Try both.
  const fromHash = new URLSearchParams((u.hash || '').replace(/^#/, ''));
  const fromQuery = u.searchParams;
  const get = (k) => fromHash.get(k) || fromQuery.get(k);
  const error = get('error');
  if (error) return { error: get('error_description') || error };
  const accessToken = get('access_token');
  if (!accessToken) return { error: 'No access token in Microsoft callback' };
  const expiresIn = Number(get('expires_in')) || 3600;
  const refreshToken = get('refresh_token') || null;
  return {
    accessToken,
    refreshToken,
    expiresAt: Date.now() + expiresIn * 1000,
    state: get('state'),
  };
}

// AAD auth-code flow: exchange the code for an access_token. PKCE-verified.
async function exchangeAadCode(code, pkceVerifier) {
  const c = CONFIG.xbox;
  const r = await httpPost(c.tokenUrl, {
    client_id: c.clientId,
    grant_type: 'authorization_code',
    code,
    redirect_uri: c.redirectUri,
    scope: c.scope,
    code_verifier: pkceVerifier,
  });
  if (!r.data?.access_token) {
    const msg = r.data?.error_description || r.data?.error || ('status ' + r.status);
    return { error: 'Microsoft AAD token exchange failed: ' + msg };
  }
  return {
    accessToken: r.data.access_token,
    refreshToken: r.data.refresh_token || null,
    expiresAt: Date.now() + (r.data.expires_in || 3600) * 1000,
  };
}

async function authenticateXbl(msAccessToken, opts = {}) {
  const c = CONFIG.xbox;
  // XBL.signin's edge layer 403s requests with Chromium's TLS fingerprint, so
  // route this through Node's https module (httpPostNode) which negotiates a
  // different handshake. Same approach used by xboxreplay/xboxlive-auth and
  // Heroic's nile/legendary integrations. Microsoft has also started 403'ing
  // requests without an Xbox-app-shaped User-Agent — sending the published XAL
  // string keeps our request indistinguishable from the official client.
  //
  // `tokenPrefix` defaults to 't=' (login.live.com / legacy MSA). When using
  // an AAD app registration via login.microsoftonline.com, callers should pass
  // 'd=' instead — that's the prefix Microsoft documents for AAD tokens.
  const tokenPrefix = opts.tokenPrefix || 't=';
  const xblR = await httpPostNode(c.xblAuthUrl, JSON.stringify({
    Properties: { AuthMethod: 'RPS', SiteName: 'user.auth.xboxlive.com', RpsTicket: tokenPrefix + msAccessToken },
    RelyingParty: 'http://auth.xboxlive.com', TokenType: 'JWT',
  }), {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'x-xbl-contract-version': '1',
    'User-Agent': XBL_USER_AGENT,
  });
  if (!xblR.data?.Token) {
    // 403 with empty body is the documented edge-layer block — we can't
    // distinguish it from a real auth failure here, so surface a hint that
    // this is almost certainly an upstream Microsoft policy issue rather
    // than something the user can fix locally.
    const empty = !xblR.raw || !xblR.raw.trim();
    let detail;
    if (xblR.status === 403 && empty) {
      detail = 'Xbox Live blocked the sign-in request (HTTP 403, no body). This usually means Microsoft\'s edge has rate-limited the public Xbox client used by Cereal. Try again later, or configure your own Azure AD app in appsettings.json (see docs/xbox-aad.md).';
    } else {
      detail = xblR.data?.Message
        || xblR.data?.XErr
        || (xblR.raw ? xblR.raw.slice(0, 200) : '')
        || ('status ' + xblR.status);
      detail = 'Xbox Live auth failed: ' + detail;
    }
    return { error: detail, _status: xblR.status, _raw: xblR.raw };
  }
  return {
    xblToken: xblR.data.Token,
    userHash: xblR.data.DisplayClaims?.xui?.[0]?.uhs || '',
  };
}

// XSTS XErr → human-readable. These are the documented Xbox Live failure modes
// for personal Microsoft accounts, taken from Microsoft's xbox-services docs.
function describeXstsError(data) {
  const xerr = data?.XErr ?? data?.xerr;
  switch (Number(xerr)) {
    case 2148916227: return 'This account is banned from Xbox Live.';
    case 2148916233: return 'This Microsoft account does not have an Xbox profile. Sign in to xbox.com once to create one, then try again.';
    case 2148916235: return 'Xbox Live is not available in this country/region.';
    case 2148916236:
    case 2148916237: return 'This account requires adult verification before it can use Xbox Live.';
    case 2148916238: return 'This account is registered to a child. An adult on the family must add it to a Microsoft family group.';
    case 2148916262: return 'The account is required to switch to a personal Microsoft account before signing in.';
    default: return data?.Message || ('XSTS error code ' + (xerr ?? 'unknown'));
  }
}

async function authenticateXsts(xblToken) {
  const c = CONFIG.xbox;
  // Same edge-block reason as authenticateXbl — go through Node's https.
  const xstsR = await httpPostNode(c.xstsAuthUrl, JSON.stringify({
    Properties: { SandboxId: 'RETAIL', UserTokens: [xblToken] },
    RelyingParty: 'http://xboxlive.com', TokenType: 'JWT',
  }), {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'x-xbl-contract-version': '1',
    'User-Agent': XBL_USER_AGENT,
  });
  if (!xstsR.data?.Token) {
    return { error: describeXstsError(xstsR.data), _status: xstsR.status, _raw: xstsR.raw };
  }
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
  } catch (_e) { return ''; }
}

async function exchangeXboxCode(_code) {
  // Kept for backward-compat but unused — the IPC handler now drives each
  // phase individually so it can log / branch on per-step errors.
  return { error: 'exchangeXboxCode is deprecated; use the per-phase helpers' };
}

// Refresh:
//   • Legacy MSA (implicit flow) sometimes returns a refresh_token at sign-in;
//     when present we can mint a new access_token via /oauth20_token.srf.
//   • AAD apps always get an offline_access refresh_token.
// Either way, the RPS prefix passed to XBL must match the authority that
// minted the token (`t=` for login.live.com, `d=` for AAD).
async function refreshXboxTokens(msRefreshToken) {
  const c = CONFIG.xbox;
  if (!msRefreshToken) return null;
  const aad = isXboxAadMode();
  const msR = await httpPost(c.tokenUrl, {
    client_id: c.clientId,
    grant_type: 'refresh_token',
    refresh_token: msRefreshToken,
    scope: c.scope,
    redirect_uri: c.redirectUri,
  });
  if (!msR.data?.access_token) return null;

  const xbl = await authenticateXbl(msR.data.access_token, { tokenPrefix: aad ? 'd=' : 't=' });
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

module.exports = {
  CONFIG,
  // Steam
  buildSteamAuthUrl,
  extractSteamId,
  extractSteamState,
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
  isXboxAadMode,
  extractMsImplicitToken,
  exchangeAadCode,
  authenticateXbl,
  authenticateXsts,
  fetchXboxProfile,
  refreshXboxTokens,
  describeXstsError,
};
