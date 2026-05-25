// ─── Game art resolution (Steam CDN + SteamGridDB) ───────────────────────────
// Single source of truth for remote image URLs used by metadata enrichment,
// the Art Picker search, and the on-disk cover/header download queue.

const log = require('../core/logger');
const { getJson, head } = require('./http');

const SGDB_API = 'https://www.steamgriddb.com/api/v2';
const STEAM_STORE_ASSETS = 'https://shared.steamstatic.com/store_item_assets/steam/apps';

// ─── Steam CDN URL construction ──────────────────────────────────────────────

/** Portrait library capsules (Steam CDN) — try 2x first, then 1x. */
function steamPortraitProbeUrls(appId) {
  const id = String(appId);
  return [
    `${STEAM_STORE_ASSETS}/${id}/library_600x900_2x.jpg`,
    `${STEAM_STORE_ASSETS}/${id}/library_600x900.jpg`,
  ];
}

/** Default portrait URL for UI lists when we skip HEAD probing (search results). */
function steamDefaultPortraitUrl(appId) {
  return `${STEAM_STORE_ASSETS}/${String(appId)}/library_600x900_2x.jpg`;
}

function steamHeroUrl(appId) {
  return `${STEAM_STORE_ASSETS}/${String(appId)}/library_hero.jpg`;
}

// Matches any Steam library asset URL — we use the capture groups to swap the
// asset name for alternates (1x ↔ 2x portrait, hero ↔ small header).
const STEAM_LIB_URL_RE =
  /^(https?:\/\/[^/]+\/store_item_assets\/steam\/apps\/(\d+))\/(library_600x900(?:_2x)?|library_hero|header)\.jpg(?:\?[^#]*)?$/i;

/**
 * Expand a single Steam library URL into the ordered list of variants to try.
 *  - Portrait → both library_600x900_2x.jpg AND library_600x900.jpg.
 *  - Header   → library_hero.jpg first, then the smaller header.jpg.
 *  - Anything else → just the URL itself.
 */
function expandSteamUrl(url, kind) {
  if (!url) return [];
  const m = STEAM_LIB_URL_RE.exec(url);
  if (!m) return [url];
  const base = m[1]; // .../apps/<appid>
  if (kind === 'portrait') {
    return [
      `${base}/library_600x900_2x.jpg`,
      `${base}/library_600x900.jpg`,
    ];
  }
  return [
    `${base}/library_hero.jpg`,
    `${base}/header.jpg`,
  ];
}

function expandUrls(urls, kind) {
  const seen = new Set();
  const out = [];
  for (const raw of urls) {
    if (!raw) continue;
    for (const u of expandSteamUrl(raw, kind)) {
      if (!seen.has(u)) { seen.add(u); out.push(u); }
    }
  }
  return out;
}

/** Ordered portrait URLs to try for `game` (never includes landscape header art). */
function portraitUrlCandidates(game) {
  return expandUrls([game.coverUrl, game.sgdbCoverUrl], 'portrait');
}

/** Ordered header (wide) URLs to try for `game`. */
function headerUrlCandidates(game) {
  return expandUrls([game.headerUrl], 'header');
}

// ─── SteamGridDB ─────────────────────────────────────────────────────────────

async function sgdbGetJson(apiKey, relativePath) {
  const url = relativePath.startsWith('http') ? relativePath : SGDB_API + relativePath;
  return getJson(url, { headers: { Authorization: 'Bearer ' + apiKey } });
}

/** Resolve the first SGDB game row from an autocomplete query. */
async function sgdbResolveGame(apiKey, query) {
  const q = encodeURIComponent(String(query || '').trim());
  if (!q) return null;
  const data = await sgdbGetJson(apiKey, `/search/autocomplete/${q}`);
  if (!data?.success || !Array.isArray(data.data) || data.data.length === 0) return null;
  const row = data.data[0];
  return { id: row.id, name: row.name || query };
}

/**
 * Primary enrichment: one portrait grid + one hero image for metadata merge.
 * @returns {{ coverUrl: string, headerUrl: string } | null}
 */
async function fetchSteamGridDBPrimaryArt(gameName, apiKey) {
  if (!apiKey || !String(gameName || '').trim()) return null;
  try {
    const resolved = await sgdbResolveGame(apiKey, gameName);
    if (!resolved) return null;

    const [covers, heroes] = await Promise.allSettled([
      sgdbGetJson(apiKey, `/grids/game/${resolved.id}?dimensions=600x900&limit=1`),
      sgdbGetJson(apiKey, `/heroes/game/${resolved.id}?limit=1`),
    ]);

    const coverUrl =
      covers.status === 'fulfilled' && covers.value?.data?.[0]?.url
        ? covers.value.data[0].url
        : '';
    const headerUrl =
      heroes.status === 'fulfilled' && heroes.value?.data?.[0]?.url
        ? heroes.value.data[0].url
        : '';

    if (!coverUrl && !headerUrl) return null;
    return { coverUrl, headerUrl };
  } catch (e) {
    log.debug('gameArt', 'SteamGridDB primary art failed for', gameName, e.message);
    return null;
  }
}

/**
 * Art Picker / search UI: many grids, heroes, logos for user selection.
 * @returns {Array<{ url: string, type: string, source: string, label: string }>}
 */
async function searchSteamGridDBGallery(gameName, apiKey, limits = {}) {
  if (!apiKey || !String(gameName || '').trim()) return [];

  const maxPortrait = limits.portrait ?? 8;
  const maxLandscape = limits.landscape ?? 4;
  const maxHeroes = limits.heroes ?? 4;
  const maxLogos = limits.logos ?? 2;

  const results = [];
  try {
    const resolved = await sgdbResolveGame(apiKey, gameName);
    if (!resolved) return results;

    const gameLabel = resolved.name || gameName;
    const gid = resolved.id;

    const [portraitGrids, landscapeGrids, heroes, logos] = await Promise.allSettled([
      sgdbGetJson(apiKey, `/grids/game/${gid}?dimensions=600x900&limit=${maxPortrait}`),
      sgdbGetJson(apiKey, `/grids/game/${gid}?dimensions=460x215,920x430&limit=${maxLandscape}`),
      sgdbGetJson(apiKey, `/heroes/game/${gid}?limit=${maxHeroes}`),
      sgdbGetJson(apiKey, `/logos/game/${gid}?limit=${maxLogos}`),
    ]);

    if (portraitGrids.status === 'fulfilled' && portraitGrids.value?.data) {
      for (const g of portraitGrids.value.data) {
        if (g.url) results.push({ url: g.url, type: 'cover', source: 'SteamGridDB', label: `${gameLabel} - Cover` });
      }
    }
    if (landscapeGrids.status === 'fulfilled' && landscapeGrids.value?.data) {
      for (const g of landscapeGrids.value.data) {
        if (g.url) results.push({ url: g.url, type: 'header', source: 'SteamGridDB', label: `${gameLabel} - Header` });
      }
    }
    if (heroes.status === 'fulfilled' && heroes.value?.data) {
      for (const h of heroes.value.data) {
        if (h.url) results.push({ url: h.url, type: 'header', source: 'SteamGridDB', label: `${gameLabel} - Hero` });
      }
    }
    if (logos.status === 'fulfilled' && logos.value?.data) {
      for (const l of logos.value.data) {
        if (l.url) results.push({ url: l.url, type: 'logo', source: 'SteamGridDB', label: `${gameLabel} - Logo` });
      }
    }
  } catch (e) {
    log.debug('gameArt', 'SteamGridDB gallery failed for', gameName, e.message);
  }
  return results;
}

/**
 * Probe Steam's CDN for which portrait capsule (if any) actually exists for
 * `appId`. Returns the first 2xx URL or '' if none. The wide hero/header are
 * never returned here — coverUrl must remain portrait.
 */
async function probeSteamPortrait(appId) {
  const candidates = steamPortraitProbeUrls(appId);
  const probes = await Promise.allSettled(candidates.map(u => head(u).then(ok => ok ? u : Promise.reject())));
  const first = probes.find(r => r.status === 'fulfilled');
  return first ? first.value : '';
}

module.exports = {
  SGDB_API,
  STEAM_STORE_ASSETS,
  steamPortraitProbeUrls,
  steamDefaultPortraitUrl,
  steamHeroUrl,
  expandSteamUrl,
  portraitUrlCandidates,
  headerUrlCandidates,
  probeSteamPortrait,
  sgdbGetJson,
  sgdbResolveGame,
  fetchSteamGridDBPrimaryArt,
  /** Back-compat alias for metadata.js consumers */
  fetchSteamGridDBArt: fetchSteamGridDBPrimaryArt,
  searchSteamGridDBGallery,
};
