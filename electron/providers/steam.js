const { httpGet, httpGetJson } = require('./http');
const { findExisting, makeGameEntry, updateAccountSync } = require('./utils');

function steamCoverUrl(appId) {
  return `https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/${appId}/library_600x900.jpg`;
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
    return { appId, name, minutes: Math.round(hours * 60), coverUrl: steamCoverUrl(appId) };
  }).filter(Boolean);
}

// Parse the HTML games page — Steam embeds full library as `var rgGames=[...]` in the page
// even for private profiles when the user is authenticated as the account owner.
async function importViaStorefront(steamId, sessionFetch) {
  try {
    const resp = await sessionFetch(
      `https://steamcommunity.com/profiles/${steamId}/games/?tab=all`,
      { headers: { 'Accept': 'text/html', 'Referer': 'https://steamcommunity.com/' } }
    );
    if (!resp.ok) return null;
    const html = await resp.text();
    // Steam embeds game data as: var rgGames = [...];
    const match = html.match(/var\s+rgGames\s*=\s*(\[[\s\S]*?\]);/);
    if (!match) return null;
    const games = JSON.parse(match[1]);
    if (!Array.isArray(games) || games.length === 0) return null;
    return games.map(g => ({
      appId: String(g.appid),
      name: g.name || 'Unknown Game',
      minutes: g.hours_forever
        ? Math.round(parseFloat(String(g.hours_forever).replace(',', '')) * 60)
        : (g.hours ? Math.round(parseFloat(String(g.hours).replace(',', '')) * 60) : 0),
      coverUrl: steamCoverUrl(g.appid),
    }));
  } catch (e) {
    return null;
  }
}

// Fallback: unauthenticated XML — only works for public profiles
async function importViaSession(steamId, sessionFetch) {
  try {
    const resp = await sessionFetch(`https://steamcommunity.com/profiles/${steamId}/games/?tab=all&xml=1`);
    if (!resp.ok) return null;
    const raw = await resp.text();
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
      return { appId, name, minutes: Math.round(hours * 60), coverUrl: steamCoverUrl(appId) };
    }).filter(Boolean);
  } catch (e) {
    return null;
  }
}

async function importViaApi(steamId, apiKey) {
  const url = `https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?key=${encodeURIComponent(apiKey)}&steamid=${steamId}&include_appinfo=1&include_played_free_games=1&format=json`;
  const r = await httpGetJson(url);
  if (r.status !== 200 || !r.data?.response?.games) return null;
  return r.data.response.games.map(g => ({
    appId: String(g.appid),
    name: g.name || 'Unknown Game',
    minutes: g.playtime_forever || 0,
    coverUrl: steamCoverUrl(g.appid),
  }));
}

function mergeGames(db, games, imported, updated, notify) {
  for (let i = 0; i < games.length; i++) {
    const g = games[i];
    const existing = findExisting(db, 'steam', g.appId, g.name);
    if (existing) {
      let changed = false;
      if (g.minutes > (existing.playtimeMinutes || 0)) { existing.playtimeMinutes = g.minutes; changed = true; }
      if (!existing.coverUrl) { existing.coverUrl = g.coverUrl; changed = true; }
      if (changed) updated.push(existing.name);
    } else {
      db.games.push(makeGameEntry('steam', 'steam', {
        platformId: g.appId,
        name: g.name,
        coverUrl: g.coverUrl,
        playtimeMinutes: g.minutes,
      }));
      imported.push(g.name);
    }
    if (notify && (i % 25 === 0 || i === games.length - 1)) {
      notify({ status: 'progress', processed: i + 1, imported: imported.length, updated: updated.length, total: games.length });
    }
  }
}

async function importLibrary({ db, saveDB, apiKey, sessionFetch, notify }) {
  const acct = (db.accounts || {}).steam;
  if (!acct?.steamId) return { error: 'Steam account not connected' };
  try {
    let games = null;
    let source = 'unknown';

    // Try API key first (most reliable, works for all privacy settings)
    if (apiKey) {
      if (notify) notify({ status: 'progress', message: 'Fetching library via API key…' });
      games = await importViaApi(acct.steamId, apiKey);
      source = 'api';
    }
    // Try storefront HTML page (session-aware, works for private profiles when logged in)
    if (!games && sessionFetch) {
      if (notify) notify({ status: 'progress', message: 'Fetching library via session…' });
      games = await importViaStorefront(acct.steamId, sessionFetch);
      source = 'storefront';
    }
    // Try XML endpoint with session (public profiles only)
    if (!games && sessionFetch) {
      if (notify) notify({ status: 'progress', message: 'Trying session XML feed…' });
      games = await importViaSession(acct.steamId, sessionFetch);
      source = 'session';
    }
    // Last resort: unauthenticated XML (usually blocked by Steam now)
    if (!games) {
      if (notify) notify({ status: 'progress', message: 'Trying public XML feed…' });
      games = await importViaXml(acct.steamId);
      source = 'xml';
    }
    if (!games) {
      return { error: apiKey
        ? 'Could not fetch Steam library. Check that your API key is valid and try again.'
        : 'Could not fetch Steam library. Try signing in to Steam again, or add an API key for private profiles.' };
    }
    if (notify) notify({ status: 'progress', message: `Processing ${games.length} games…`, processed: 0, total: games.length });
    const imported = [];
    const updated = [];
    mergeGames(db, games, imported, updated, notify);
    updateAccountSync(db, saveDB, 'steam', games.length);
    return { imported, updated, total: games.length, processed: games.length, games: db.games, source };
  } catch (e) {
    return { error: 'Import failed: ' + e.message };
  }
}

async function validateKey(apiKey) {
  if (!apiKey) return { ok: false, error: 'no-key' };
  try {
    const url = `https://api.steampowered.com/ISteamWebAPIUtil/GetServerInfo/v1/?key=${encodeURIComponent(apiKey)}`;
    const res = await httpGetJson(url);
    if (res && res.status === 200 && res.data) return { ok: true, info: res.data };
    return { ok: false, error: res && (res.data || res.raw) };
  } catch (e) {
    return { ok: false, error: e && e.message };
  }
}

module.exports = { importLibrary, validateKey };
