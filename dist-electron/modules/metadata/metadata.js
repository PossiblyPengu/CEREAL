// ─── Game Metadata Orchestrator ──────────────────────────────────────────────
// Per-platform list of metadata sources, run in order until one returns a hit.
// SteamGridDB (when an API key is configured) is layered on top for art only.
//
// Sources live in ./sources/*.js — each exposes fetchByName / fetchByAppId
// returning a normalized meta shape:
//   { description, developer, publisher, releaseDate, genres[], coverUrl,
//     headerUrl, screenshots[], videoUrl, metacritic, website,
//     isSoftware?, _source }

const ctx = require('../core/context');
const steamSource = require('./sources/steam');
const wikipediaSource = require('./sources/wikipedia');
const { fetchSteamGridDBPrimaryArt } = require('./gameArt');

const METADATA_CACHE = new Map();
const METADATA_CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days

function getMetadataSettings() {
  const s = (ctx.db && ctx.db.settings) || {};
  let sgdbKey = s.steamGridDbKey || '';
  if (!sgdbKey) {
    try { sgdbKey = ctx.safeStore.getPassword('cereal-steamgriddb', 'default') || ''; }
    catch (_e) { /* safeStorage unavailable */ }
  }
  return {
    source: s.metadataSource || 'steam',
    steamGridDbKey: sgdbKey,
  };
}

/**
 * Ordered list of source-runner thunks for `game`, based on platform and
 * the user's `metadataSource` preference. Each thunk returns `Promise<meta|null>`.
 */
function sourcesForGame(game, settings) {
  const runners = [];
  if (game.platform === 'steam' && game.platformId) {
    runners.push(() => steamSource.fetchByAppId(game.platformId));
  }
  if (settings.source === 'wikipedia') {
    runners.push(() => wikipediaSource.fetchByName(game.name));
    runners.push(() => steamSource.fetchByName(game.name));
  } else {
    runners.push(() => steamSource.fetchByName(game.name));
    runners.push(() => wikipediaSource.fetchByName(game.name));
  }
  return runners;
}

function cacheKeyFor(game) {
  return (game.platform || '') + ':' + (game.platformId || game.name);
}

async function fetchGameMetadata(game) {
  if (!game || !game.name) return null;

  const key = cacheKeyFor(game);
  const cached = METADATA_CACHE.get(key);
  if (cached && Date.now() - cached.timestamp < METADATA_CACHE_TTL) {
    return cached.data;
  }

  const settings = getMetadataSettings();

  let meta = null;
  for (const run of sourcesForGame(game, settings)) {
    meta = await run();
    if (meta) break;
  }

  // SteamGridDB art enhancement. The portrait grid acts as a fallback when
  // the primary source had no portrait, and is always stored separately as
  // `sgdbCoverUrl` so the cover queue can fall back to it if the primary
  // URL 404s on download.
  if (meta && settings.steamGridDbKey) {
    try {
      const art = await fetchSteamGridDBPrimaryArt(game.name, settings.steamGridDbKey);
      if (art) {
        if (art.coverUrl) {
          if (!meta.coverUrl) meta.coverUrl = art.coverUrl;
          meta.sgdbCoverUrl = art.coverUrl;
        }
        if (art.headerUrl) meta.headerUrl = art.headerUrl;
      }
    } catch (_e) { /* SGDB enhancement is best-effort */ }
  }

  if (meta) METADATA_CACHE.set(key, { data: meta, timestamp: Date.now() });
  return meta;
}

// ─── Apply metadata onto a Game record ───────────────────────────────────────
//
// Fields written and the rule for each:
//   coverUrl       — portrait only, never substitute landscape
//   sgdbCoverUrl   — SGDB fallback portrait (separate from coverUrl)
//   headerUrl      — landscape (header / hero / screenshot fallback OK)
//   description, developer, publisher, releaseDate,
//   metacritic, website, videoUrl, screenshots — direct copy
//   categories     — merged with existing (deduped, preserves user tags)
//   software       — set if Steam flagged the entry as non-game

const SIMPLE_FIELDS = [
  'description',
  'developer',
  'publisher',
  'releaseDate',
  'website',
  'videoUrl',
];

function mergeCategories(game, meta) {
  const existing = (game.categories || []).filter(Boolean).map(c => String(c).trim());
  const add = [];
  if (Array.isArray(meta.genres)) for (const g of meta.genres) if (g) add.push(String(g).trim());
  if (Array.isArray(meta.categories)) for (const c of meta.categories) if (c) add.push(String(c).trim());
  if (typeof meta.type === 'string') {
    const t = meta.type.trim();
    if (t && t.toLowerCase() !== 'game') add.push(t.charAt(0).toUpperCase() + t.slice(1));
  }
  if (add.length === 0) return null;
  const merged = Array.from(new Map([...existing, ...add].map(x => [x.toLowerCase(), x])).values());
  const existingNorm = existing.map(x => x.toLowerCase()).join('|');
  const mergedNorm = merged.map(x => x.toLowerCase()).join('|');
  return mergedNorm === existingNorm ? null : merged;
}

/**
 * Apply `meta` onto `game` in-place. Returns true if anything changed.
 *
 * @param {object} game
 * @param {object} meta  — return shape of fetchGameMetadata
 * @param {{ force?: boolean }} opts
 *   force: overwrite even when the field already has a user value. coverUrl
 *          still refuses landscape substitution; categories still merge (not replace).
 */
function applyMetadataToGame(game, meta, opts = {}) {
  if (!meta) return false;
  const { force = false } = opts;
  let changed = false;

  const setIfWritable = (field, value) => {
    if (!value) return;
    if (force || !game[field]) {
      if (game[field] !== value) { game[field] = value; changed = true; }
    }
  };

  // coverUrl is portrait-only — never accept landscape headers / screenshots.
  setIfWritable('coverUrl', meta.coverUrl);
  setIfWritable('sgdbCoverUrl', meta.sgdbCoverUrl);

  for (const f of SIMPLE_FIELDS) setIfWritable(f, meta[f]);

  // headerUrl allows landscape fallbacks (hero / first screenshot).
  if (force || !game.headerUrl) {
    const headerFallback =
      meta.headerUrl || meta.coverUrl || (meta.screenshots && meta.screenshots[0]) || '';
    if (headerFallback && game.headerUrl !== headerFallback) {
      game.headerUrl = headerFallback;
      changed = true;
    }
  }

  if (force || !game.screenshots || game.screenshots.length === 0) {
    if (Array.isArray(meta.screenshots) && meta.screenshots.length) {
      game.screenshots = meta.screenshots;
      changed = true;
    }
  }

  if (force || game.metacritic == null) {
    if (meta.metacritic != null && game.metacritic !== meta.metacritic) {
      game.metacritic = meta.metacritic;
      changed = true;
    }
  }

  const mergedCats = mergeCategories(game, meta);
  if (mergedCats) { game.categories = mergedCats; changed = true; }

  if (meta._source === 'steam' && meta.isSoftware) {
    if (!game.software) { game.software = true; changed = true; }
    const cats = game.categories || [];
    if (!cats.some(c => typeof c === 'string' && c.toLowerCase() === 'software')) {
      game.categories = [...cats, 'Software'];
      changed = true;
    }
  }

  return changed;
}

function invalidateMetadataCache(cacheKey) {
  METADATA_CACHE.delete(cacheKey);
}

module.exports = {
  fetchGameMetadata,
  applyMetadataToGame,
  getMetadataSettings,
  invalidateMetadataCache,
  cacheKeyFor,
  // Back-compat re-exports for any callers that still reach into metadata.js
  // for low-level helpers. New code should import from sources/ or gameArt.js.
  fetchSteamMetadata: steamSource.fetchByAppId,
  fetchSteamSearchMetadata: steamSource.fetchByName,
  fetchWikipediaMetadata: wikipediaSource.fetchByName,
  fetchSteamGridDBArt: fetchSteamGridDBPrimaryArt,
  // Legacy aliases that pre-extraction code expected on this module
  httpGet: require('./http').getJson,
};
