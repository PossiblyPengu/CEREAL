// ─── Xbox Cloud Gaming Catalog ───────────────────────────────────────────────
// Public, unauthenticated source-of-truth for which Microsoft Store products
// are streamable via Xbox Cloud Gaming. Used by Cereal to cross-reference the
// user's Xbox Live library and flag entries with `xcloudPlayable` so we can
// surface a "Stream via xCloud" launch action.
//
// Two endpoints:
//
//   1. catalog.gamepass.com/sigls/v2?id=...            (the cloud-streaming list)
//      Returns an array of big-catalog product IDs (12-char alphanumeric). The
//      `29a81209-df6f-41fd-a528-2ae6b91f719c` GUID is the well-known
//      "Cloud Gaming Library" list ID — same one xCloud Status, gpstats.app
//      and the openxbl reference clients use.
//
//   2. displaycatalog.mp.microsoft.com/v7.0/products    (catalog enrichment)
//      Given a batch of bigIds (≤25), returns LocalizedProperties (title,
//      developer, publisher), Images (BoxArt) and Product metadata. Used to
//      build a name → productId index so we can match by canonical title for
//      games whose Xbox Live history didn't ship a `productId` directly.
//
// Both are documented in Microsoft's "buy box" reference and consumed by the
// Microsoft Store, Xbox app, and a long tail of open-source dashboards.
//
// Caching: catalog state changes daily-ish (titles join/leave Game Pass), so
// we keep a 12-hour in-memory + on-disk cache to avoid hammering the endpoints
// on every Xbox import.

const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');
const { httpGetJson } = require('./http');
const { canonicalize } = require('./utils');

const CLOUD_LIST_ID = '29a81209-df6f-41fd-a528-2ae6b91f719c';
const SIGLS_URL = (id) => `https://catalog.gamepass.com/sigls/v2?id=${id}&language=en-us&market=US`;
const DISPLAYCATALOG_URL = (bigIds) =>
  `https://displaycatalog.mp.microsoft.com/v7.0/products?bigIds=${bigIds.join(',')}` +
  `&market=US&languages=en-us&MS-CV=DGU1mcuYo0WMM-4u.0`;

const CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours
const BATCH_SIZE = 20;                     // displaycatalog rejects > 25

let _memCache = null; // { fetchedAt, productIds:Set, byProductId:Map, byCanonicalName:Map }

function cachePath() {
  try { return path.join(app.getPath('userData'), 'xcloud-catalog.json'); }
  catch (_e) { return null; }
}

function loadDiskCache() {
  const p = cachePath();
  if (!p || !fs.existsSync(p)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (!raw || !Number.isFinite(raw.fetchedAt) || Date.now() - raw.fetchedAt > CACHE_TTL_MS) return null;
    return raw;
  } catch (_e) { return null; }
}

function saveDiskCache(payload) {
  const p = cachePath();
  if (!p) return;
  try { fs.writeFileSync(p, JSON.stringify(payload), 'utf8'); }
  catch (_e) { /* best-effort */ }
}

function hydrate(payload) {
  if (!payload) return null;
  const byProductId = new Map();
  const byCanonicalName = new Map();
  const productIds = new Set(payload.productIds || []);
  for (const entry of payload.products || []) {
    if (!entry.productId) continue;
    byProductId.set(entry.productId, entry);
    if (entry.canonical) byCanonicalName.set(entry.canonical, entry);
  }
  return { fetchedAt: payload.fetchedAt, productIds, byProductId, byCanonicalName };
}

async function fetchProductIds() {
  const r = await httpGetJson(SIGLS_URL(CLOUD_LIST_ID), { Accept: 'application/json' });
  if (!r || r.status !== 200 || !Array.isArray(r.data)) return [];
  // Response shape: [{ id: '<list-guid>', ... }, { id: 'PRODUCT_ID' }, ...]
  const out = [];
  for (const item of r.data) {
    if (!item || typeof item.id !== 'string') continue;
    // Skip the list-meta envelope (lowercase guid with hyphens). Big catalog
    // product IDs are 12 uppercase alphanumeric, with no dashes.
    if (item.id.includes('-')) continue;
    if (/^[0-9A-Z]{10,14}$/.test(item.id)) out.push(item.id);
  }
  return out;
}

async function fetchProductDetails(productIds) {
  const out = [];
  for (let i = 0; i < productIds.length; i += BATCH_SIZE) {
    const batch = productIds.slice(i, i + BATCH_SIZE);
    let r;
    try { r = await httpGetJson(DISPLAYCATALOG_URL(batch), { Accept: 'application/json' }); }
    catch (_e) { continue; }
    if (!r || r.status !== 200) continue;
    const products = r.data?.Products || [];
    for (const p of products) {
      const productId = p.ProductId;
      if (!productId) continue;
      const lp = (p.LocalizedProperties && p.LocalizedProperties[0]) || {};
      const name = lp.ProductTitle || lp.ShortTitle || '';
      const developer = lp.DeveloperName || '';
      const publisher = lp.PublisherName || '';
      // Pick the largest portrait/box-art image.
      const imgs = lp.Images || [];
      const portrait = imgs.find(im => im.ImagePurpose === 'Poster')
        || imgs.find(im => im.ImagePurpose === 'BoxArt')
        || imgs.find(im => im.ImagePurpose === 'SuperHeroArt')
        || imgs[0];
      const coverUrl = portrait?.Uri ? (portrait.Uri.startsWith('//') ? 'https:' + portrait.Uri : portrait.Uri) : '';
      out.push({
        productId,
        name,
        canonical: canonicalize(name),
        developer,
        publisher,
        coverUrl,
        slug: (p.Properties?.Slug || lp.ShortTitle || name).toString().toLowerCase()
          .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''),
      });
    }
  }
  return out;
}

async function ensureCatalog({ force = false } = {}) {
  if (!force && _memCache && Date.now() - _memCache.fetchedAt < CACHE_TTL_MS) return _memCache;
  if (!force) {
    const disk = loadDiskCache();
    if (disk) {
      _memCache = hydrate(disk);
      if (_memCache) return _memCache;
    }
  }
  // Network refresh
  const productIds = await fetchProductIds();
  if (productIds.length === 0) {
    // Don't blow away a previous good cache on a transient network failure.
    if (_memCache) return _memCache;
    return { fetchedAt: Date.now(), productIds: new Set(), byProductId: new Map(), byCanonicalName: new Map() };
  }
  const products = await fetchProductDetails(productIds);
  const payload = { fetchedAt: Date.now(), productIds, products };
  saveDiskCache(payload);
  _memCache = hydrate(payload);
  return _memCache;
}

// Match a Cereal game (or any { name, platformId, productId }) to the cloud
// catalog. Returns { productId, slug, name } on hit, null on miss.
function matchGame(game, catalog) {
  if (!catalog) return null;
  const candidateIds = [];
  if (game.xcloudProductId) candidateIds.push(game.xcloudProductId);
  if (game.productId) candidateIds.push(game.productId);
  if (game.platformId && /^[0-9A-Z]{10,14}$/.test(game.platformId)) candidateIds.push(game.platformId);
  for (const id of candidateIds) {
    if (catalog.byProductId.has(id)) return catalog.byProductId.get(id);
  }
  const canon = canonicalize(game.name || '');
  if (canon && catalog.byCanonicalName.has(canon)) return catalog.byCanonicalName.get(canon);
  // Try stripping common suffixes (": Standard Edition", " (PC)", etc.)
  const stripped = canon
    .replace(/\b(standard|deluxe|premium|gold|ultimate|complete|definitive|game of the year|goty|anniversary)\b/g, '')
    .replace(/\b(edition|bundle|pack)\b/g, '')
    .replace(/\s+/g, ' ').trim();
  if (stripped && stripped !== canon && catalog.byCanonicalName.has(stripped)) return catalog.byCanonicalName.get(stripped);
  return null;
}

// Build the deep-link URL the embedded xCloud session can navigate to. The
// xbox.com/play/launch route accepts {slug}/{productId} *or* just {productId};
// the slug is purely for SEO. We send both for clarity.
function buildLaunchUrl(match) {
  if (!match || !match.productId) return null;
  const slug = match.slug || 'game';
  return `https://www.xbox.com/play/launch/${slug}/${match.productId}`;
}

module.exports = {
  CLOUD_LIST_ID,
  ensureCatalog,
  matchGame,
  buildLaunchUrl,
};
