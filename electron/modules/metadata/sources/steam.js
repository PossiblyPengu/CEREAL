// ─── Steam Store metadata source ─────────────────────────────────────────────
// Two entry points:
//   - fetchByAppId(appId)   — exact appdetails lookup (used when game.platformId set)
//   - fetchByName(gameName) — storesearch → appdetails (works for any Steam title)

const log = require('../../core/logger');
const { getJson } = require('../http');
const { probeSteamPortrait, steamHeroUrl } = require('../gameArt');

const DESCRIPTION_MAX = 500;

function detectIsSoftware(info) {
  if (info?.type && typeof info.type === 'string' && info.type.toLowerCase() !== 'game') return true;
  const cats = Array.isArray(info?.categories) ? info.categories : [];
  for (const c of cats) {
    const d = (c?.description || '').toLowerCase();
    if (d.includes('software') || d.includes('utility') || d.includes('application')) return true;
  }
  const genres = Array.isArray(info?.genres) ? info.genres : [];
  for (const g of genres) {
    if ((g?.description || '').toLowerCase().includes('software')) return true;
  }
  return false;
}

function pickVideoUrl(movies) {
  if (!Array.isArray(movies) || movies.length === 0) return '';
  const m = movies[0];
  return m?.mp4?.max || m?.mp4?.['480'] || m?.webm?.max || m?.webm?.['480'] || '';
}

async function fetchByAppId(appId) {
  if (!appId) return null;
  try {
    const data = await getJson(`https://store.steampowered.com/api/appdetails?appids=${appId}&l=english`);
    const info = data?.[appId]?.data;
    if (!info) return null;

    const isSoftware = detectIsSoftware(info);

    // Verify a portrait capsule actually exists on the CDN. coverUrl stays
    // empty when there's none — we never substitute a landscape header.
    const coverUrl = await probeSteamPortrait(appId);

    return {
      description: (info.short_description || '').slice(0, DESCRIPTION_MAX),
      developer: (info.developers || [])[0] || '',
      publisher: (info.publishers || [])[0] || '',
      releaseDate: info.release_date?.date || '',
      genres: (info.genres || []).map(g => g.description),
      coverUrl,
      headerUrl: info.header_image || steamHeroUrl(appId),
      screenshots: (info.screenshots || []).slice(0, 4).map(s => s.path_full),
      videoUrl: pickVideoUrl(info.movies),
      metacritic: info.metacritic?.score ?? null,
      website: info.website || '',
      isSoftware,
      _source: 'steam',
    };
  } catch (e) {
    log.debug('metadata.steam', 'appdetails failed for', appId, e.message);
    return null;
  }
}

async function fetchByName(gameName) {
  if (!gameName) return null;
  try {
    const q = encodeURIComponent(gameName);
    const search = await getJson(`https://store.steampowered.com/api/storesearch/?term=${q}&l=english&cc=US`);
    if (!search?.items?.length) return null;

    const norm = gameName.toLowerCase().replace(/[^a-z0-9]/g, '');
    let best = search.items[0];
    for (const item of search.items) {
      if ((item.name || '').toLowerCase().replace(/[^a-z0-9]/g, '') === norm) { best = item; break; }
    }
    return await fetchByAppId(String(best.id));
  } catch (e) {
    log.debug('metadata.steam', 'storesearch failed for', gameName, e.message);
    return null;
  }
}

module.exports = {
  fetchByAppId,
  fetchByName,
};
