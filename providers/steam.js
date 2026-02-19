const https = require('https');

function httpGet(url, headers) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'CerealLauncher/1.0', ...(headers || {}) } }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, raw: data }));
    }).on('error', e => reject(e));
  });
}

function httpGetJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'CerealLauncher/1.0' } }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
        catch (e) { resolve({ status: res.statusCode, data: null, raw: data }); }
      });
    }).on('error', e => reject(e));
  });
}

function mergeGames(db, games, imported, updated) {
  for (const g of games) {
    const existing = db.games.find(x => x.platform === 'steam' && x.platformId === g.appId);
    if (existing) {
      let changed = false;
      if (g.minutes > (existing.playtimeMinutes || 0)) { existing.playtimeMinutes = g.minutes; changed = true; }
      if (!existing.coverUrl) { existing.coverUrl = g.coverUrl; changed = true; }
      if (changed) updated.push(existing.name);
    } else {
      db.games.push({
        id: 'steam_' + g.appId + '_' + Date.now(),
        name: g.name,
        platform: 'steam',
        platformId: g.appId,
        coverUrl: g.coverUrl,
        categories: [],
        playtimeMinutes: g.minutes,
        lastPlayed: null,
        addedAt: new Date().toISOString(),
        favorite: false,
      });
      imported.push(g.name);
    }
  }
}

async function importViaXml(steamId) {
  const r = await httpGet(`https://steamcommunity.com/profiles/${steamId}/games/?tab=all&xml=1`);
  const raw = r.raw || '';
  if (!raw || raw.includes('<error>') || !raw.includes('<game>')) return null;
  const gameBlocks = raw.match(/<game>[\s\S]*?<\/game>/g) || [];
  return gameBlocks.map(block => {
    const appIdM = block.match(/<appID>(\d+)<\/appID>/);
    if (!appIdM) return null;
    const appId = appIdM[1];
    const nameM = block.match(/<name><!\[CDATA\[([\s\S]*?)\]\]><\/name>/) || block.match(/<name>([^<]+)<\/name>/);
    const name = nameM ? nameM[1].trim() : 'Unknown Game';
    const hoursM = block.match(/<hoursOnRecord>([\d.,]+)<\/hoursOnRecord>/);
    const hours = hoursM ? parseFloat(hoursM[1].replace(',', '')) : 0;
    return { appId, name, minutes: Math.round(hours * 60), coverUrl: `https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/${appId}/library_600x900.jpg` };
  }).filter(Boolean);
}

async function importViaApi(steamId, apiKey) {
  const url = `https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?key=${encodeURIComponent(apiKey)}&steamid=${steamId}&include_appinfo=1&include_played_free_games=1&format=json`;
  const r = await httpGetJson(url);
  if (r.status !== 200 || !r.data?.response?.games) return null;
  return r.data.response.games.map(g => ({
    appId: String(g.appid),
    name: g.name || 'Unknown Game',
    minutes: g.playtime_forever || 0,
    coverUrl: `https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/${g.appid}/library_600x900.jpg`,
  }));
}

async function importLibrary({ db, saveDB, apiKey }) {
  const acct = (db.accounts || {}).steam;
  if (!acct?.steamId) return { error: 'Steam account not connected' };
  try {
    // Try public profile XML first
    let games = await importViaXml(acct.steamId);
    let source = 'xml';
    // Fall back to Steam Web API if XML fails and an API key is available
    if (!games && apiKey) {
      games = await importViaApi(acct.steamId, apiKey);
      source = 'api';
    }
    if (!games) {
      return { error: apiKey
        ? 'Could not fetch game list via profile or API. Check your API key and try again.'
        : 'Could not fetch game list. Set your Steam profile and game details to Public, or add a Steam API Key for private profiles.' };
    }
    const imported = [];
    const updated = [];
    mergeGames(db, games, imported, updated);
    if (!db.accounts) db.accounts = {};
    if (db.accounts.steam) { db.accounts.steam.lastSync = new Date().toISOString(); db.accounts.steam.gameCount = games.length; }
    saveDB(db);
    return { imported, updated, total: games.length, games: db.games, source };
  } catch (e) {
    return { error: 'Import failed: ' + e.message };
  }
}

async function validateKey(apiKey) {
  if (!apiKey) return { ok: false, error: 'no-key' };
  try {
    const url = `https://api.steampowered.com/ISteamWebAPIUtil/GetServerInfo/v1/?key=${encodeURIComponent(apiKey)}`;
    const res = await new Promise((resolve, reject) => {
      https.get(url, { headers: { 'User-Agent': 'CerealLauncher/1.0' } }, (r) => {
        let data = '';
        r.on('data', c => data += c);
        r.on('end', () => {
          try { resolve({ status: r.statusCode, data: JSON.parse(data) }); }
          catch (e) { resolve({ status: r.statusCode, data: null, raw: data }); }
        });
      }).on('error', e => reject(e));
    });
    if (res && res.status === 200 && res.data) return { ok: true, info: res.data };
    return { ok: false, error: res && (res.data || res.raw) };
  } catch (e) {
    return { ok: false, error: e && e.message };
  }
}

module.exports = { importLibrary, validateKey };
