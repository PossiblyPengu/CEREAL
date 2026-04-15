// ─── Metadata Art Search (moved from main.js) ─────────────────────────────────
const { net, ipcMain } = require('electron');
const { getMetadataSettings, httpGet } = require('./metadata');
const log = require('../core/logger');

async function searchSteam(gameName) {
  const results = [];
  const q = encodeURIComponent(gameName);
  const search = await httpGet(`https://store.steampowered.com/api/storesearch/?term=${q}&l=english&cc=US`);
  if (search?.items?.length) {
    for (const item of search.items.slice(0, 3)) {
      const id = item.id;
      const name = item.name || '';
      try {
        const det = await httpGet(`https://store.steampowered.com/api/appdetails?appids=${id}&l=english`);
        const info = det?.[String(id)]?.data;
        if (info) {
          results.push({ url: `https://shared.steamstatic.com/store_item_assets/steam/apps/${id}/library_600x900_2x.jpg`, type: 'cover', source: 'Steam', label: name + ' - Portrait (HD)' });
          if (info.header_image) results.push({ url: info.header_image, type: 'header', source: 'Steam', label: name + ' - Header' });
          results.push({ url: `https://shared.steamstatic.com/store_item_assets/steam/apps/${id}/library_hero.jpg`, type: 'header', source: 'Steam', label: name + ' - Hero' });
          if (info.screenshots) {
            for (const ss of info.screenshots.slice(0, 2)) {
              results.push({ url: ss.path_full, type: 'screenshot', source: 'Steam', label: name + ' - Screenshot' });
            }
          }
        }
      } catch (_e) { /* skip unavailable Steam app */ }
    }
  }
  return results;
}

async function searchSteamGridDB(gameName, apiKey) {
  if (!apiKey) return [];
  const results = [];
  const q = encodeURIComponent(gameName);
  const sgdbFetch = async (endpoint) => {
    const resp = await net.fetch(endpoint, {
      headers: { 'Authorization': 'Bearer ' + apiKey },
    });
    if (!resp.ok) throw new Error('SGDB HTTP ' + resp.status);
    return resp.json();
  };
  const searchData = await sgdbFetch(`https://www.steamgriddb.com/api/v2/search/autocomplete/${q}`);
  if (!searchData?.success || !searchData?.data?.length) return results;
  const gameId = searchData.data[0].id;
  const gameLabel = searchData.data[0].name || gameName;
  const [portraitGrids, landscapeGrids, heroes, logos] = await Promise.allSettled([
    sgdbFetch(`https://www.steamgriddb.com/api/v2/grids/game/${gameId}?dimensions=600x900&limit=8`),
    sgdbFetch(`https://www.steamgriddb.com/api/v2/grids/game/${gameId}?dimensions=460x215,920x430&limit=4`),
    sgdbFetch(`https://www.steamgriddb.com/api/v2/heroes/game/${gameId}?limit=4`),
    sgdbFetch(`https://www.steamgriddb.com/api/v2/logos/game/${gameId}?limit=2`),
  ]);
  if (portraitGrids.status === 'fulfilled' && portraitGrids.value?.data) {
    for (const g of portraitGrids.value.data.slice(0, 8)) {
      if (g.url) results.push({ url: g.url, type: 'cover', source: 'SteamGridDB', label: gameLabel + ' - Cover' });
    }
  }
  if (landscapeGrids.status === 'fulfilled' && landscapeGrids.value?.data) {
    for (const g of landscapeGrids.value.data.slice(0, 4)) {
      if (g.url) results.push({ url: g.url, type: 'header', source: 'SteamGridDB', label: gameLabel + ' - Header' });
    }
  }
  if (heroes.status === 'fulfilled' && heroes.value?.data) {
    for (const h of heroes.value.data.slice(0, 4)) {
      if (h.url) results.push({ url: h.url, type: 'header', source: 'SteamGridDB', label: gameLabel + ' - Hero' });
    }
  }
  if (logos.status === 'fulfilled' && logos.value?.data) {
    for (const l of logos.value.data.slice(0, 2)) {
      if (l.url) results.push({ url: l.url, type: 'logo', source: 'SteamGridDB', label: gameLabel + ' - Logo' });
    }
  }
  return results;
}

async function handleSearchArt(event, gameName, _platform) {
  if (!gameName) return { images: [] };
  const ms = getMetadataSettings();

  // Run SteamGridDB + Steam in parallel to cut latency in the fallback case
  const [sgdbResult, steamResult] = await Promise.allSettled([
    searchSteamGridDB(gameName, ms.steamGridDbKey),
    searchSteam(gameName),
  ]);

  const sgdb = sgdbResult.status === 'fulfilled' ? sgdbResult.value : [];
  if (sgdbResult.status !== 'fulfilled') log.debug('metadataSearch', 'SteamGridDB failed:', sgdbResult.reason?.message);
  const steam = steamResult.status === 'fulfilled' ? steamResult.value : [];
  if (steamResult.status !== 'fulfilled') log.debug('metadataSearch', 'Steam failed:', steamResult.reason?.message);

  const images = [];
  const seen = new Set();
  // Prefer SGDB results
  for (const img of sgdb) {
    if (img.url && !seen.has(img.url)) { seen.add(img.url); images.push(img); }
  }
  // Append Steam results for any missing art types when SGDB is sparse
  if (images.length === 0) {
    for (const img of steam) {
      if (img.url && !seen.has(img.url)) { seen.add(img.url); images.push(img); }
    }
  }
  return { images };
}

function registerMetadataSearchHandlers() {
  ipcMain.handle('metadata:searchArt', handleSearchArt);
}

module.exports = {
  registerMetadataSearchHandlers,
};
