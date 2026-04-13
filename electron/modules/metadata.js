// ─── Game Metadata Fetching ──────────────────────────────────────────────────
// Default sources require ZERO accounts or API keys:
//   - Steam Store: searches Steam's entire catalog for any game
//   - Wikipedia: free encyclopedia API for descriptions + info
// Optional: SteamGridDB (requires free API key) for high-quality game art

const { net } = require('electron');
const ctx = require('./context');
const log = require('./logger');

const METADATA_CACHE = new Map();
const METADATA_CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days

function getMetadataSettings() {
  const s = (ctx.db && ctx.db.settings) || {};
  // SteamGridDB key: prefer safeStorage, fall back to legacy settings field
  let sgdbKey = s.steamGridDbKey || '';
  if (!sgdbKey) {
    try { sgdbKey = ctx.safeStore.getPassword('cereal-steamgriddb', 'default') || ''; } catch (e) {}
  }
  return {
    source: s.metadataSource || 'steam',
    steamGridDbKey: sgdbKey,
  };
}

async function httpGet(url) {
  const resp = await net.fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      'Accept': 'application/json, text/json, */*',
    },
  });
  if (!resp.ok) throw new Error('HTTP ' + resp.status + ' from ' + url);
  const text = await resp.text();
  return JSON.parse(text);
}

async function fetchSteamMetadata(appId) {
  try {
    const data = await httpGet(`https://store.steampowered.com/api/appdetails?appids=${appId}&l=english`);
    const info = data?.[appId]?.data;
    if (!info) return null;
    // Heuristic: detect if the Steam entry is non-game software
    let isSoftware = false;
    if (info.type && typeof info.type === 'string' && info.type.toLowerCase() !== 'game') isSoftware = true;
    if (!isSoftware && info.categories && Array.isArray(info.categories)) {
      try {
        if (info.categories.some(c => (c.description || '').toLowerCase().includes('software') || (c.description || '').toLowerCase().includes('utility') || (c.description || '').toLowerCase().includes('application'))) isSoftware = true;
      } catch (e) { /* ignore */ }
    }
    if (!isSoftware && info.genres && Array.isArray(info.genres)) {
      try { if (info.genres.some(g => (g.description || '').toLowerCase().includes('software'))) isSoftware = true; } catch(e){}
    }

    // Validate library capsule exists (many software/tools/DLC don't have one)
    // Try 2x first, then 1x — never fall back to wide header/screenshots for coverUrl
    let coverUrl = '';
    const capsuleUrls = [
      `https://shared.steamstatic.com/store_item_assets/steam/apps/${appId}/library_600x900_2x.jpg`,
      `https://shared.steamstatic.com/store_item_assets/steam/apps/${appId}/library_600x900.jpg`,
    ];
    for (const url of capsuleUrls) {
      try {
        const probe = await net.fetch(url, { method: 'HEAD' });
        if (probe.ok) { coverUrl = url; break; }
      } catch (e) {}
    }
    // coverUrl intentionally left empty if no portrait capsule exists —
    // wide banners/screenshots are kept in headerUrl/screenshots only

    return {
      description: (info.short_description || '').slice(0, 500),
      developer: (info.developers || [])[0] || '',
      publisher: (info.publishers || [])[0] || '',
      releaseDate: info.release_date?.date || '',
      genres: (info.genres || []).map(g => g.description),
      coverUrl,
      headerUrl: info.header_image || `https://shared.steamstatic.com/store_item_assets/steam/apps/${appId}/library_hero.jpg`,
      screenshots: (info.screenshots || []).slice(0, 4).map(s => s.path_full),
      metacritic: info.metacritic?.score || null,
      website: info.website || '',
      _source: 'steam',
      isSoftware,
    };
  } catch (e) {
    console.log('[Metadata] Steam fetch failed for', appId, e.message);
    return null;
  }
}

// ─── Steam Store Search (NO KEY) ─────────────────────────────────────────────
// Searches Steam's entire store catalog by name, then fetches full metadata.
// Works for ANY game listed on Steam, not just ones the user owns.
async function fetchSteamSearchMetadata(gameName) {
  try {
    const q = encodeURIComponent(gameName);
    const search = await httpGet(`https://store.steampowered.com/api/storesearch/?term=${q}&l=english&cc=US`);
    if (!search?.items?.length) return null;

    // Best match by name
    const lower = gameName.toLowerCase().replace(/[^a-z0-9]/g, '');
    let best = search.items[0];
    for (const item of search.items) {
      if ((item.name || '').toLowerCase().replace(/[^a-z0-9]/g, '') === lower) { best = item; break; }
    }

    // Use the matched appId to get full details
    return await fetchSteamMetadata(String(best.id));
  } catch (e) {
    console.log('[Metadata] Steam search failed for', gameName, e.message);
    return null;
  }
}

// ─── Wikipedia API (NO KEY) ──────────────────────────────────────────────────
// Uses MediaWiki API to fetch game descriptions, images, and infobox data.
async function fetchWikipediaMetadata(gameName) {
  try {
    // Search Wikipedia for the game
    const q = encodeURIComponent(gameName + ' video game');
    const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${q}&srnamespace=0&srlimit=5&format=json`;
    const searchData = await httpGet(searchUrl);
    if (!searchData?.query?.search?.length) return null;

    // Best match
    const lower = gameName.toLowerCase().replace(/[^a-z0-9]/g, '');
    let bestTitle = searchData.query.search[0].title;
    for (const r of searchData.query.search) {
      const rLower = r.title.toLowerCase().replace(/[^a-z0-9]/g, '').replace(/videogame$/, '');
      if (rLower === lower) { bestTitle = r.title; break; }
    }

    // Fetch article extract + page image
    const title = encodeURIComponent(bestTitle);
    const detailUrl = `https://en.wikipedia.org/w/api.php?action=query&titles=${title}&prop=extracts|pageimages|revisions&exintro=true&explaintext=true&pithumbsize=600&rvprop=content&rvslots=main&rvsection=0&format=json`;
    const detailData = await httpGet(detailUrl);
    const pages = detailData?.query?.pages;
    if (!pages) return null;
    const page = Object.values(pages)[0];
    if (!page || page.missing !== undefined) return null;

    const extract = (page.extract || '').slice(0, 500);
    const thumbUrl = page.thumbnail?.source || '';

    // Try to parse infobox from wikitext for dev/publisher/date/genre
    const wikitext = page.revisions?.[0]?.slots?.main?.['*'] || '';
    const infoField = (field) => {
      const re = new RegExp('\\|\\s*' + field + '\\s*=\\s*(.+)', 'i');
      const m = wikitext.match(re);
      if (!m) return '';
      return m[1].replace(/\[\[([^|\]]*\|)?([^\]]*)\]\]/g, '$2').replace(/\{\{[^}]*\}\}/g, '').replace(/<[^>]+>/g, '').trim();
    };

    const developer = infoField('developer');
    const publisher = infoField('publisher');
    const released = infoField('released') || infoField('release_date');
    const genreRaw = infoField('genre');
    const genres = genreRaw ? genreRaw.split(/[,;]/).map(g => g.trim()).filter(Boolean).slice(0, 5) : [];

    // Only return valid results (must have at least a description)
    if (!extract && !developer) return null;

    return {
      description: extract,
      developer,
      publisher,
      releaseDate: released.replace(/\{\{.*?\}\}/g, '').trim().slice(0, 30),
      genres,
      coverUrl: thumbUrl,
      headerUrl: '',
      screenshots: [],
      metacritic: null,
      website: `https://en.wikipedia.org/wiki/${title}`,
      _source: 'wikipedia',
    };
  } catch (e) {
    console.log('[Metadata] Wikipedia fetch failed for', gameName, e.message);
    return null;
  }
}

// Fetch best cover + header art from SteamGridDB (requires API key)
async function fetchSteamGridDBArt(gameName, apiKey) {
  if (!apiKey) return null;
  try {
    const q = encodeURIComponent(gameName);
    const sgdbFetch = async (endpoint) => {
      const resp = await net.fetch(endpoint, {
        headers: { 'Authorization': 'Bearer ' + apiKey },
      });
      if (!resp.ok) throw new Error('SGDB HTTP ' + resp.status);
      return resp.json();
    };

    const searchData = await sgdbFetch(`https://www.steamgriddb.com/api/v2/search/autocomplete/${q}`);
    if (!searchData?.success || !searchData?.data?.length) return null;
    const gameId = searchData.data[0].id;

    const [covers, heroes] = await Promise.allSettled([
      sgdbFetch(`https://www.steamgriddb.com/api/v2/grids/game/${gameId}?dimensions=600x900&limit=1`),
      sgdbFetch(`https://www.steamgriddb.com/api/v2/heroes/game/${gameId}?limit=1`),
    ]);

    const coverUrl = (covers.status === 'fulfilled' && covers.value?.data?.[0]?.url) || '';
    const headerUrl = (heroes.status === 'fulfilled' && heroes.value?.data?.[0]?.url) || '';

    if (coverUrl || headerUrl) return { coverUrl, headerUrl };
    return null;
  } catch (e) {
    console.log('[Metadata] SteamGridDB art fetch failed for', gameName, e.message);
    return null;
  }
}

async function fetchGameMetadata(game) {
  if (!game || !game.name) return null;

  // Check cache
  const cacheKey = (game.platform || '') + ':' + (game.platformId || game.name);
  const cached = METADATA_CACHE.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < METADATA_CACHE_TTL) {
    return cached.data;
  }

  const ms = getMetadataSettings();
  let meta = null;

  // Steam games: try Steam API with appId first, then search
  if (game.platform === 'steam') {
    if (game.platformId) meta = await fetchSteamMetadata(game.platformId);
    if (!meta) meta = await fetchSteamSearchMetadata(game.name);
  }

  // Fallback for all platforms: Steam search → Wikipedia (both free, no API keys needed)
  if (!meta) {
    if (ms.source === 'wikipedia') {
      meta = await fetchWikipediaMetadata(game.name);
      if (!meta) meta = await fetchSteamSearchMetadata(game.name);
    } else {
      meta = await fetchSteamSearchMetadata(game.name);
      if (!meta) meta = await fetchWikipediaMetadata(game.name);
    }
  }

  // Enhance with SteamGridDB art if API key is available
  // Official Steam portrait capsule has priority — SGDB fills the gap or serves as download fallback
  if (meta && ms.steamGridDbKey) {
    try {
      const art = await fetchSteamGridDBArt(game.name, ms.steamGridDbKey);
      if (art) {
        if (art.coverUrl && !meta.coverUrl) meta.coverUrl = art.coverUrl;
        else if (art.coverUrl) meta.sgdbCoverUrl = art.coverUrl;
        if (art.headerUrl) meta.headerUrl = art.headerUrl;
      }
    } catch (e) {}
  }

  if (meta) {
    METADATA_CACHE.set(cacheKey, { data: meta, timestamp: Date.now() });
  }
  return meta;
}

function applyMetadataToGame(game, meta) {
  if (!meta) return false;
  let changed = false;

  // Only fill in missing data — don't overwrite user customizations
  // coverUrl must be a portrait image — never fall back to landscape header/screenshots
  if (!game.coverUrl && meta.coverUrl) { game.coverUrl = meta.coverUrl; changed = true; }
  if (!game.sgdbCoverUrl && meta.sgdbCoverUrl) { game.sgdbCoverUrl = meta.sgdbCoverUrl; changed = true; }
  if (!game.description && meta.description) { game.description = meta.description; changed = true; }
  if (!game.developer && meta.developer) { game.developer = meta.developer; changed = true; }
  if (!game.publisher && meta.publisher) { game.publisher = meta.publisher; changed = true; }
  if (!game.releaseDate && meta.releaseDate) { game.releaseDate = meta.releaseDate; changed = true; }
  if ((!game.categories || game.categories.length === 0) && meta.genres?.length) { game.categories = meta.genres; changed = true; }
  if (!game.headerUrl) {
    const headerFallback = meta.headerUrl || meta.coverUrl || (meta.screenshots && meta.screenshots[0]) || '';
    if (headerFallback) { game.headerUrl = headerFallback; changed = true; }
  }
  if ((!game.screenshots || game.screenshots.length === 0) && meta.screenshots?.length) { game.screenshots = meta.screenshots; changed = true; }
  if (game.metacritic == null && meta.metacritic != null) { game.metacritic = meta.metacritic; changed = true; }
  if (!game.website && meta.website) { game.website = meta.website; changed = true; }

  // Merge metadata categories/genres/type into game's categories (preserve existing user tags)
  try {
    const existing = (game.categories || []).filter(Boolean).map(c => String(c).trim());
    const add = [];
    if (meta.genres && Array.isArray(meta.genres)) {
      for (const g of meta.genres) if (g) add.push(String(g).trim());
    }
    if (meta.categories && Array.isArray(meta.categories)) {
      for (const c of meta.categories) if (c) add.push(String(c).trim());
    }
    if (meta.type && typeof meta.type === 'string') {
      const t = meta.type.trim();
      if (t && t.toLowerCase() !== 'game') add.push(t.charAt(0).toUpperCase() + t.slice(1));
    }
    if (add.length > 0) {
      const merged = Array.from(new Map([...existing, ...add].map(x => [x.toLowerCase(), x])).values());
      // If merged differs from existing, update
      const existingNorm = existing.map(x => x.toLowerCase()).join('|');
      const mergedNorm = merged.map(x => x.toLowerCase()).join('|');
      if (mergedNorm !== existingNorm) {
        game.categories = merged;
        changed = true;
      }
    }
  } catch (e) {}

  // If metadata indicates this Steam entry is non-game software, mark it
  if (meta._source === 'steam' && meta.isSoftware) {
    if (!game.software) { game.software = true; changed = true; }
    // Also add a visible category tag so UI filters catch it
    try {
      const cats = game.categories || [];
      if (!cats.some(c=>typeof c==='string' && c.toLowerCase()==='software')) {
        game.categories = [...cats, 'Software'];
        changed = true;
      }
    } catch(e){}
  }

  return changed;
}

function invalidateMetadataCache(cacheKey) {
  METADATA_CACHE.delete(cacheKey);
}

module.exports = {
  httpGet,
  fetchSteamMetadata,
  fetchSteamSearchMetadata,
  fetchWikipediaMetadata,
  fetchSteamGridDBArt,
  fetchGameMetadata,
  applyMetadataToGame,
  getMetadataSettings,
  invalidateMetadataCache,
};
