const fs = require('fs');
const path = require('path');
const os = require('os');
const { httpGet, httpGetJson } = require('./http');
const { findExisting, makeGameEntry, updateAccountSync } = require('./utils');

function steamCoverUrl(appId) {
  return `https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/${appId}/library_600x900.jpg`;
}

function steamHeaderUrl(appId) {
  return `https://shared.steamstatic.com/store_item_assets/steam/apps/${appId}/header.jpg`;
}

// Scan local Steam installation for installed games via .acf manifest files.
// Works offline and without any API key. Gets installed games only.
function detectLocalLibrary() {
  const steamPaths = [
    'C:\\Program Files (x86)\\Steam',
    'C:\\Program Files\\Steam',
    path.join(os.homedir(), 'Steam'),
    path.join(os.homedir(), '.local', 'share', 'Steam'), // Linux
    path.join(os.homedir(), 'Library', 'Application Support', 'Steam'), // macOS
  ];

  let steamRoot = null;
  for (const p of steamPaths) {
    try { if (fs.existsSync(p)) { steamRoot = p; break; } } catch (e) {}
  }
  if (!steamRoot) return null;

  const libraryFolders = [path.join(steamRoot, 'steamapps')];
  const vdfPath = path.join(steamRoot, 'steamapps', 'libraryfolders.vdf');
  try {
    if (fs.existsSync(vdfPath)) {
      const content = fs.readFileSync(vdfPath, 'utf-8');
      const matches = content.match(/"path"\s+"([^"]+)"/g) || [];
      for (const m of matches) {
        const p = m.match(/"path"\s+"([^"]+)"/)[1].replace(/\\\\/g, '\\');
        const appsDir = path.join(p, 'steamapps');
        if (fs.existsSync(appsDir) && !libraryFolders.includes(appsDir)) libraryFolders.push(appsDir);
      }
    }
  } catch (e) {}

  const games = [];
  for (const libFolder of libraryFolders) {
    let files;
    try { files = fs.readdirSync(libFolder).filter(f => f.endsWith('.acf')); } catch (e) { continue; }
    for (const file of files) {
      try {
        const content = fs.readFileSync(path.join(libFolder, file), 'utf-8');
        const appid = content.match(/"appid"\s+"(\d+)"/);
        const name = content.match(/"name"\s+"([^"]+)"/);
        const playtime = content.match(/"playtime_forever"\s+"(\d+)"/);
        if (appid && name) {
          games.push({
            appId: appid[1],
            name: name[1],
            minutes: playtime ? parseInt(playtime[1], 10) : 0,
            coverUrl: steamCoverUrl(appid[1]),
            headerUrl: steamHeaderUrl(appid[1]),
          });
        }
      } catch (e) {}
    }
  }
  return games.length > 0 ? games : null;
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
    return { appId, name, minutes: Math.round(hours * 60), coverUrl: steamCoverUrl(appId), headerUrl: steamHeaderUrl(appId) };
  }).filter(Boolean);
}

// Robust bracket-balanced JSON extractor — handles game names containing ]; etc.
function extractJsArray(html, varName) {
  // Match with flexible whitespace: "varName = [" or "varName=[" etc.
  const escaped = varName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(escaped + '\\s*=\\s*\\[');
  const match = re.exec(html);
  if (!match) return null;
  // Position at the '[' character
  const begin = html.indexOf('[', match.index + match[0].length - 1);
  if (begin === -1) return null;
  let depth = 0;
  let i = begin;
  for (; i < html.length; i++) {
    const ch = html[i];
    if (ch === '[' || ch === '{') depth++;
    else if (ch === ']' || ch === '}') { depth--; if (depth === 0) break; }
    else if (ch === '"') {
      i++;
      while (i < html.length && (html[i] !== '"' || html[i - 1] === '\\')) i++;
    }
  }
  if (depth !== 0) return null;
  try { return JSON.parse(html.slice(begin, i + 1)); } catch (e) { return null; }
}

// Fetch the authenticated /games/ HTML page and parse embedded game data.
// Works for private profiles when the user is signed in (cookies set by Steam OpenID).
async function importViaStorefront(steamId, sessionFetch) {
  try {
    const resp = await sessionFetch(
      `https://steamcommunity.com/profiles/${steamId}/games/?tab=all`,
      { headers: { 'Accept': 'text/html,application/xhtml+xml', 'Referer': 'https://steamcommunity.com/' } }
    );
    if (!resp.ok) return { error: `HTTP ${resp.status}` };
    const html = await resp.text();

    // Try all known variable name variants Steam has used
    const games =
      extractJsArray(html, 'var rgGames') ||
      extractJsArray(html, 'var g_rgGames') ||
      extractJsArray(html, 'rgGames') ||
      extractJsArray(html, 'g_rgGames');

    if (!games || games.length === 0) {
      if (html.includes('This profile is private') || html.includes('profile_private')) return { error: 'profile-private' };
      if (html.includes('The specified profile could not be found')) return { error: 'profile-not-found' };
      if (html.includes('Sign In') && html.includes('store.steampowered.com/login')) return { error: 'not-logged-in' };
      // Return a diagnostic snippet of the page for debugging
      const snippet = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
      return { error: `no-games-data: ${snippet}` };
    }
    return games.map(g => ({
      appId: String(g.appid),
      name: g.name || 'Unknown Game',
      minutes: g.hours_forever
        ? Math.round(parseFloat(String(g.hours_forever).replace(/,/g, '')) * 60)
        : (g.hours ? Math.round(parseFloat(String(g.hours).replace(/,/g, '')) * 60) : 0),
      coverUrl: steamCoverUrl(g.appid),
      headerUrl: steamHeaderUrl(g.appid),
    }));
  } catch (e) {
    return { error: e.message };
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
      return { appId, name, minutes: Math.round(hours * 60), coverUrl: steamCoverUrl(appId), headerUrl: steamHeaderUrl(appId) };
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
    headerUrl: steamHeaderUrl(g.appid),
  }));
}

function mergeGames(db, games, imported, updated, notify, isInstalled) {
  for (let i = 0; i < games.length; i++) {
    const g = games[i];
    const existing = findExisting(db, 'steam', g.appId, g.name);
    if (existing) {
      let changed = false;
      if (g.minutes > (existing.playtimeMinutes || 0)) { existing.playtimeMinutes = g.minutes; changed = true; }
      if (!existing.coverUrl) { existing.coverUrl = g.coverUrl; changed = true; }
      if (!existing.headerUrl && g.headerUrl) { existing.headerUrl = g.headerUrl; changed = true; }
      // Only upgrade installed, never downgrade
      if (isInstalled && !existing.installed) { existing.installed = true; changed = true; }
      if (!isInstalled && existing.installed !== true && existing.installed !== false) { existing.installed = false; changed = true; }
      if (changed) updated.push(existing.name);
    } else {
      db.games.push(makeGameEntry('steam', 'steam', {
        platformId: g.appId,
        name: g.name,
        coverUrl: g.coverUrl,
        headerUrl: g.headerUrl,
        playtimeMinutes: g.minutes,
        extra: { installed: isInstalled },
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
    const failures = [];

    // Try API key first (most reliable, works for all privacy settings)
    if (apiKey) {
      if (notify) notify({ status: 'progress', message: 'Fetching library via API key…' });
      games = await importViaApi(acct.steamId, apiKey);
      if (games) source = 'api';
      else failures.push('api-key: no response');
    }
    // Try storefront HTML page (session-aware, works for private profiles when logged in)
    if (!games && sessionFetch) {
      if (notify) notify({ status: 'progress', message: 'Fetching library via session…' });
      const sfResult = await importViaStorefront(acct.steamId, sessionFetch);
      if (Array.isArray(sfResult)) { games = sfResult; source = 'storefront'; }
      else { failures.push('storefront: ' + (sfResult?.error || 'unknown')); }
    }
    // Try XML endpoint with session (public profiles only)
    if (!games && sessionFetch) {
      if (notify) notify({ status: 'progress', message: 'Trying session XML feed…' });
      games = await importViaSession(acct.steamId, sessionFetch);
      if (games) source = 'session';
      else failures.push('session-xml: no data');
    }
    // Last resort: unauthenticated XML (usually blocked by Steam now)
    if (!games) {
      if (notify) notify({ status: 'progress', message: 'Trying public XML feed…' });
      games = await importViaXml(acct.steamId);
      if (games) source = 'xml';
      else failures.push('public-xml: blocked or private');
    }
    // Final fallback: scan local Steam .acf manifests (installed games only, no network needed)
    if (!games) {
      if (notify) notify({ status: 'progress', message: 'Scanning local Steam library…' });
      games = detectLocalLibrary();
      if (games) source = 'local';
      else failures.push('local-scan: Steam not installed or no games found');
    }
    if (!games) {
      const detail = failures.join('; ');
      if (failures.some(f => f.includes('profile-private'))) {
        return { error: 'Your Steam profile game details are set to private. Sign in to Steam again, or set your game details to Public at steamcommunity.com/my/edit/settings.' };
      }
      if (failures.some(f => f.includes('not-logged-in'))) {
        return { error: 'Steam session expired. Click Re-auth to sign in again.' };
      }
      return { error: `Could not fetch Steam library. Make sure Steam is installed and you have games, or add an API key for full library access. (${detail})` };
    }
    if (notify) notify({ status: 'progress', message: `Processing ${games.length} games (via ${source})…`, processed: 0, total: games.length });
    const imported = [];
    const updated = [];
    mergeGames(db, games, imported, updated, notify, source === 'local');
    // Cross-reference with local ACF manifests to mark installed games
    // (runs even when API/session succeeded so the orbit view is accurate)
    if (source !== 'local') {
      const localGames = detectLocalLibrary();
      if (localGames && localGames.length > 0) {
        const installedIds = new Set(localGames.map(g => g.appId));
        let installChanged = false;
        for (const g of db.games) {
          if (g.platform === 'steam' && g.platformId && installedIds.has(g.platformId)) {
            if (!g.installed) { g.installed = true; installChanged = true; }
          } else if (g.platform === 'steam' && g.installed !== true) {
            if (g.installed === undefined) { g.installed = false; installChanged = true; }
          }
        }
        if (installChanged) saveDB(db);
      }
    }
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
