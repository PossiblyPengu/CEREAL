// ─── Metadata Art Search (IPC + Steam Store + SteamGridDB gallery) ────────────
const { ipcMain } = require('electron');
const log = require('../core/logger');
const { getMetadataSettings } = require('./metadata');
const { getJson } = require('./http');
const {
  steamDefaultPortraitUrl,
  steamHeroUrl,
  searchSteamGridDBGallery,
} = require('./gameArt');

async function searchSteamStoreArt(gameName) {
  const results = [];
  const q = encodeURIComponent(gameName);
  const search = await getJson(
    `https://store.steampowered.com/api/storesearch/?term=${q}&l=english&cc=US`
  );
  if (!search?.items?.length) return results;

  const top = search.items.slice(0, 3);
  const detailResults = await Promise.allSettled(
    top.map(async item => {
      const det = await getJson(
        `https://store.steampowered.com/api/appdetails?appids=${item.id}&l=english`
      );
      return { item, info: det?.[String(item.id)]?.data };
    }),
  );

  for (const r of detailResults) {
    if (r.status !== 'fulfilled' || !r.value.info) continue;
    const { item, info } = r.value;
    const id = item.id;
    const name = item.name || '';

    results.push({
      url: steamDefaultPortraitUrl(id),
      type: 'cover',
      source: 'Steam',
      label: `${name} - Portrait (HD)`,
    });
    if (info.header_image) {
      results.push({ url: info.header_image, type: 'header', source: 'Steam', label: `${name} - Header` });
    }
    results.push({
      url: steamHeroUrl(id),
      type: 'header',
      source: 'Steam',
      label: `${name} - Hero`,
    });
    if (Array.isArray(info.screenshots)) {
      for (const ss of info.screenshots.slice(0, 2)) {
        results.push({
          url: ss.path_full,
          type: 'screenshot',
          source: 'Steam',
          label: `${name} - Screenshot`,
        });
      }
    }
  }
  return results;
}

async function handleSearchArt(_event, gameName, _platform) {
  if (!gameName) return { images: [] };
  const ms = getMetadataSettings();

  const [sgdbResult, steamResult] = await Promise.allSettled([
    searchSteamGridDBGallery(gameName, ms.steamGridDbKey),
    searchSteamStoreArt(gameName),
  ]);

  const sgdb = sgdbResult.status === 'fulfilled' ? sgdbResult.value : [];
  if (sgdbResult.status !== 'fulfilled') {
    log.debug('metadataSearch', 'SteamGridDB failed:', sgdbResult.reason?.message);
  }
  const steam = steamResult.status === 'fulfilled' ? steamResult.value : [];
  if (steamResult.status !== 'fulfilled') {
    log.debug('metadataSearch', 'Steam failed:', steamResult.reason?.message);
  }

  const images = [];
  const seen = new Set();

  for (const img of sgdb) {
    if (img.url && !seen.has(img.url)) {
      seen.add(img.url);
      images.push(img);
    }
  }
  if (images.length === 0) {
    for (const img of steam) {
      if (img.url && !seen.has(img.url)) {
        seen.add(img.url);
        images.push(img);
      }
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
