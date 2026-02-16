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

async function importLibrary({ db, saveDB }) {
  const acct = (db.accounts || {}).steam;
  if (!acct?.steamId) return { error: 'Steam account not connected' };
  try {
    const r = await httpGet(`https://steamcommunity.com/profiles/${acct.steamId}/games/?tab=all&xml=1`);
    const raw = r.raw || '';
    if (!raw || raw.includes('<error>') || !raw.includes('<game>')) {
      return { error: 'Could not fetch game list. Make sure your Steam profile and game details are set to Public in Steam Privacy Settings.' };
    }
    const gameBlocks = raw.match(/<game>[\s\S]*?<\/game>/g) || [];
    const imported = [];
    const updated = [];
    for (const block of gameBlocks) {
      const appIdM = block.match(/<appID>(\d+)<\/appID>/);
      if (!appIdM) continue;
      const appId = appIdM[1];
      const nameM = block.match(/<name><!\[CDATA\[([\s\S]*?)\]\]><\/name>/) || block.match(/<name>([^<]+)<\/name>/);
      const name = nameM ? nameM[1].trim() : 'Unknown Game';
      const hoursM = block.match(/<hoursOnRecord>([\d.,]+)<\/hoursOnRecord>/);
      const hours = hoursM ? parseFloat(hoursM[1].replace(',', '')) : 0;
      const minutes = Math.round(hours * 60);
      const existing = db.games.find(g => g.platform === 'steam' && g.platformId === appId);
      if (existing) {
        let changed = false;
        if (minutes > (existing.playtimeMinutes || 0)) { existing.playtimeMinutes = minutes; changed = true; }
        if (!existing.coverUrl) { existing.coverUrl = `https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/${appId}/library_600x900.jpg`; changed = true; }
        if (changed) updated.push(existing.name);
      } else {
        db.games.push({
          id: 'steam_' + appId + '_' + Date.now(),
          name,
          platform: 'steam',
          platformId: appId,
          coverUrl: `https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/${appId}/library_600x900.jpg`,
          categories: [],
          playtimeMinutes: minutes,
          lastPlayed: null,
          addedAt: new Date().toISOString(),
          favorite: false,
        });
        imported.push(name);
      }
    }
    if (!db.accounts) db.accounts = {};
    if (db.accounts.steam) { db.accounts.steam.lastSync = new Date().toISOString(); db.accounts.steam.gameCount = gameBlocks.length; }
    saveDB(db);
    return { imported, updated, total: gameBlocks.length, games: db.games };
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
