const https = require('https');

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
    const req = https.request({ hostname: u.hostname, port: u.port || 443, path: u.pathname + u.search, method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(postData), 'User-Agent': 'CerealLauncher/1.0', ...(headers || {}) } }, (res) => {
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

const MS_CLIENT_ID = '1fec8e78-bce4-4aaf-ab1b-5451cc387264';
const MS_SCOPE = 'XboxLive.signin XboxLive.offline_access openid profile';

async function refreshXboxTokens(acct) {
  if (!acct?.msRefreshToken) return false;
  try {
    const msR = await httpPost('https://login.microsoftonline.com/consumers/oauth2/v2.0/token', {
      client_id: MS_CLIENT_ID, grant_type: 'refresh_token', refresh_token: acct.msRefreshToken, scope: MS_SCOPE,
    });
    if (!msR.data?.access_token) return false;
    acct.msAccessToken = msR.data.access_token;
    acct.msRefreshToken = msR.data.refresh_token || acct.msRefreshToken;
    acct.msExpiresAt = Date.now() + (msR.data.expires_in || 3600) * 1000;
    // XBL authenticate
    const xblR = await httpPost('https://user.auth.xboxlive.com/user/authenticate', JSON.stringify({
      Properties: { AuthMethod: 'RPS', SiteName: 'user.auth.xboxlive.com', RpsTicket: 'd=' + msR.data.access_token },
      RelyingParty: 'http://auth.xboxlive.com', TokenType: 'JWT'
    }), { 'Content-Type': 'application/json', 'x-xbl-contract-version': '1' });
    if (!xblR.data?.Token) return false;
    acct.xblToken = xblR.data.Token;
    acct.userHash = xblR.data.DisplayClaims?.xui?.[0]?.uhs || acct.userHash;
    // XSTS
    const xstsR = await httpPost('https://xsts.auth.xboxlive.com/xsts/authorize', JSON.stringify({
      Properties: { SandboxId: 'RETAIL', UserTokens: [acct.xblToken] }, RelyingParty: 'http://xboxlive.com', TokenType: 'JWT'
    }), { 'Content-Type': 'application/json', 'x-xbl-contract-version': '1' });
    if (!xstsR.data?.Token) return false;
    acct.xstsToken = xstsR.data.Token;
    acct.gamertag = xstsR.data.DisplayClaims?.xui?.[0]?.gtg || acct.gamertag;
    acct.xuid = xstsR.data.DisplayClaims?.xui?.[0]?.xid || acct.xuid;
    return true;
  } catch (e) { return false; }
}

async function importLibrary({ db, saveDB }) {
  const acct = (db.accounts || {}).xbox;
  if (!acct?.xuid && !acct?.msAccessToken) return { error: 'Xbox account not connected' };
  try {
    if (acct.msExpiresAt && Date.now() > acct.msExpiresAt - 60000) {
      const ok = await refreshXboxTokens(acct);
      if (!ok) return { error: 'Token expired. Please sign in again.' };
      saveDB(db);
    }
    const xAuth = 'XBL3.0 x=' + acct.userHash + ';' + acct.xstsToken;
    const r = await httpGetJson(`https://titlehub.xboxlive.com/users/xuid(${acct.xuid})/titles/titlehistory/decoration/GamePass,Achievement,Image`, { 'Authorization': xAuth, 'x-xbl-contract-version': '2', 'Accept-Language': 'en-US' });
    const titles = r.data?.titles || [];
    const imported = [];
    const updated = [];
    for (const t of titles) {
      if (!t.titleId || t.type === 'App' || t.type === 'WebApp') continue;
      const titleId = String(t.titleId);
      const name = t.name || 'Unknown';
      const imgUrl = t.displayImage || (t.images && t.images[0] && t.images[0].url) || '';
      const lastPlayed = t.titleHistory?.lastTimePlayed || null;
      const minutesPlayed = t.titleHistory?.totalMinutesPlayed || 0;
      const existing = db.games.find(g => g.platform === 'xbox' && (g.platformId === titleId || g.name === name));
      if (existing) {
        let changed = false;
        if (!existing.platformId) { existing.platformId = titleId; changed = true; }
        if (minutesPlayed > (existing.playtimeMinutes || 0)) { existing.playtimeMinutes = minutesPlayed; changed = true; }
        if (!existing.coverUrl && imgUrl) { existing.coverUrl = imgUrl; changed = true; }
        if (lastPlayed && (!existing.lastPlayed || new Date(lastPlayed) > new Date(existing.lastPlayed))) { existing.lastPlayed = lastPlayed; changed = true; }
        if (changed) updated.push(existing.name);
      } else {
        db.games.push({
          id: 'xbox_' + titleId + '_' + Date.now(),
          name,
          platform: 'xbox',
          platformId: titleId,
          coverUrl: imgUrl,
          categories: [],
          playtimeMinutes: minutesPlayed,
          lastPlayed: lastPlayed,
          addedAt: new Date().toISOString(),
          favorite: false,
        });
        imported.push(name);
      }
    }
    if (!db.accounts) db.accounts = {};
    if (db.accounts.xbox) { db.accounts.xbox.lastSync = new Date().toISOString(); db.accounts.xbox.gameCount = titles.filter(t => t.type !== 'App' && t.type !== 'WebApp').length; }
    saveDB(db);
    return { imported, updated, total: titles.length, games: db.games };
  } catch (e) {
    return { error: 'Import failed: ' + e.message };
  }
}

async function validateKey(apiKey) {
  if (!apiKey) return { ok: false, error: 'no-key' };
  try {
    const url = 'https://profile.xboxlive.com/users/me/profile/settings?settings=GameDisplayPicRaw';
    const res = await httpGetJson(url, { 'Authorization': apiKey, 'x-xbl-contract-version': '3' });
    if (res && res.status === 200 && res.data) return { ok: true, info: res.data };
    const res2 = await httpGetJson(url, { 'Authorization': 'Bearer ' + apiKey, 'x-xbl-contract-version': '3' });
    if (res2 && res2.status === 200 && res2.data) return { ok: true, info: res2.data };
    return { ok: false, error: (res && (res.data||res.raw)) || (res2 && (res2.data||res2.raw)) };
  } catch (e) { return { ok: false, error: e && e.message }; }
}

module.exports = { importLibrary, validateKey };
