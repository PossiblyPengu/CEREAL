// ─── Cover / header download queue & on-disk cache ─────────────────────────────
// Downloads remote portrait `coverUrl` / wide `headerUrl` into userData/covers.
// Portrait tries coverUrl then sgdbCoverUrl; if still missing, pulls metadata.
//
// See also: modules/metadata/gameArt.js (Steam CDN + SteamGridDB URLs).

const { app, net } = require('electron');
const path = require('path');
const fs = require('fs');
const ctx = require('../core/context');
const { fetchGameMetadata, applyMetadataToGame, getMetadataSettings } = require('../metadata/metadata');
const log = require('../core/logger');

let _coversDir = null;
function getCoversDir() {
  if (_coversDir) return _coversDir;
  const dir = path.join(app.getPath('userData'), 'covers');
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (e) {
    log.warn('covers', 'Failed to create covers directory:', e.message);
  }
  _coversDir = dir;
  return _coversDir;
}

const COVER_CACHE_LIMIT_BYTES = 250 * 1024 * 1024;
let _evictionInFlight = false;
let _lastEvictionAt = 0;
const EVICTION_MIN_INTERVAL_MS = 5 * 60 * 1000;

function getReferencedCoverPaths() {
  const ref = new Set();
  if (!ctx.db || !Array.isArray(ctx.db.games)) return ref;
  for (const g of ctx.db.games) {
    if (g.localCoverPath) ref.add(path.resolve(g.localCoverPath));
    if (g.localHeaderPath) ref.add(path.resolve(g.localHeaderPath));
  }
  return ref;
}

async function evictOldCovers({ force = false } = {}) {
  if (_evictionInFlight) return { skipped: 'in-flight' };
  if (!force && Date.now() - _lastEvictionAt < EVICTION_MIN_INTERVAL_MS) return { skipped: 'recent' };
  _evictionInFlight = true;
  _lastEvictionAt = Date.now();
  try {
    const dir = getCoversDir();
    let entries;
    try {
      entries = fs.readdirSync(dir);
    } catch (e) {
      return { error: e.message };
    }
    const referenced = getReferencedCoverPaths();
    const items = [];
    let totalBytes = 0;
    for (const name of entries) {
      const full = path.join(dir, name);
      let st;
      try {
        st = fs.statSync(full);
      } catch {
        continue;
      }
      if (!st.isFile()) continue;
      totalBytes += st.size;
      items.push({
        full,
        size: st.size,
        age: st.mtimeMs,
        pinned: referenced.has(path.resolve(full)),
      });
    }
    if (totalBytes <= COVER_CACHE_LIMIT_BYTES) {
      return { totalBytes, evicted: 0, kept: items.length, limit: COVER_CACHE_LIMIT_BYTES };
    }
    items.sort((a, b) => a.age - b.age);
    let freed = 0;
    let evicted = 0;
    const target = COVER_CACHE_LIMIT_BYTES - Math.floor(COVER_CACHE_LIMIT_BYTES * 0.1);
    for (const it of items) {
      if (totalBytes <= target) break;
      if (it.pinned) continue;
      try {
        fs.unlinkSync(it.full);
        totalBytes -= it.size;
        freed += it.size;
        evicted++;
      } catch (_e) {
        /* skip */
      }
    }
    log.info(
      'covers',
      `LRU eviction: removed ${evicted} files (${(freed / 1024 / 1024).toFixed(1)} MB), now ${(totalBytes / 1024 / 1024).toFixed(1)} MB`
    );
    return {
      totalBytes,
      evicted,
      freedBytes: freed,
      kept: items.length - evicted,
      limit: COVER_CACHE_LIMIT_BYTES,
    };
  } finally {
    _evictionInFlight = false;
  }
}

function cleanupFile(p) {
  try {
    if (fs.existsSync(p)) fs.unlinkSync(p);
  } catch (_e) {
    /* best-effort */
  }
}

function isValidLocalFile(p) {
  try {
    return !!p && fs.existsSync(p) && fs.statSync(p).size >= 1024;
  } catch (_e) {
    return false;
  }
}

async function downloadUrlToFile(url, destPath) {
  const resp = await net.fetch(url);
  if (!resp.ok) {
    const err = new Error('HTTP ' + resp.status);
    err.status = resp.status;
    err.url = url;
    throw err;
  }
  const buf = Buffer.from(await resp.arrayBuffer());
  if (buf.length < 1024) {
    const err = new Error('File too small (' + buf.length + ' bytes)');
    err.url = url;
    throw err;
  }
  fs.writeFileSync(destPath, buf);
  return true;
}

// Steam CDN library asset URL — captures base + asset name so we can
// generate alternates without the caller knowing the exact variant.
const STEAM_LIB_URL_RE =
  /^(https?:\/\/[^/]+\/store_item_assets\/steam\/apps\/(\d+))\/(library_600x900(?:_2x)?|library_hero|header)\.jpg(?:\?[^#]*)?$/i;

/**
 * Expand a single image URL into the ordered list of variants we should try.
 *  - Steam portrait URLs → both library_600x900_2x.jpg AND library_600x900.jpg.
 *  - Steam header URLs   → library_hero.jpg first, then header.jpg as fallback.
 *  - Anything else       → just the URL itself.
 */
function expandSteamUrl(url, kind) {
  const m = STEAM_LIB_URL_RE.exec(url);
  if (!m) return [url];
  const base = m[1]; // .../apps/<appid>
  if (kind === 'portrait') {
    return [
      `${base}/library_600x900_2x.jpg`,
      `${base}/library_600x900.jpg`,
    ];
  }
  // header / hero
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

/** Ordered portrait URLs for the grid tile — never use headerUrl here. */
function portraitUrlCandidates(game) {
  return expandUrls([game.coverUrl, game.sgdbCoverUrl], 'portrait');
}

/** Ordered header (wide) URLs — used by ensureLocalHeader. */
function headerUrlCandidates(game) {
  return expandUrls([game.headerUrl], 'header');
}

function extensionFromUrl(url) {
  try {
    return path.extname(new URL(url).pathname).split('?')[0] || '.jpg';
  } catch (_e) {
    return '.jpg';
  }
}

// ─── Persistent-failure backoff ─────────────────────────────────────────────
// Many Steam appids (delisted apps, software, dedicated servers, very old
// titles) simply have no library art on the CDN — every download will 404
// forever. Marking the game's last-failure timestamp lets us stop hammering
// the CDN on every startup. The flag is auto-cleared whenever a new URL gets
// assigned (manual edit, art picker, fresh metadata fetch, or clearCovers).
const COVER_FAIL_RETRY_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

function shouldSkipDueToPriorFailure(game) {
  if (!game || !game._coverFailedAt) return false;
  return (Date.now() - game._coverFailedAt) < COVER_FAIL_RETRY_INTERVAL_MS;
}

function clearCoverFailure(game) {
  if (!game) return false;
  let changed = false;
  if (game._coverFailedAt != null) { delete game._coverFailedAt; changed = true; }
  if (game._coverFailReason != null) { delete game._coverFailReason; changed = true; }
  return changed;
}

/**
 * Try each portrait URL until one downloads successfully.
 * @returns {{ changed: boolean, triedMeta: boolean }}
 */
async function ensureLocalPortrait(game, coversDir, gameId) {
  if (isValidLocalFile(game.localCoverPath)) return { changed: false, triedMeta: false };

  if (game.localCoverPath) {
    cleanupFile(game.localCoverPath);
    game.localCoverPath = null;
  }

  const tried = portraitUrlCandidates(game);
  let lastErr = null;
  for (const coverUrl of tried) {
    try {
      const dest = path.join(coversDir, 'cover_' + gameId + extensionFromUrl(coverUrl));
      await downloadUrlToFile(coverUrl, dest);
      game.localCoverPath = dest;
      game._imgStamp = Date.now();
      clearCoverFailure(game);
      return { changed: true, triedMeta: false };
    } catch (e) {
      lastErr = e;
    }
  }

  // Direct portrait URLs all failed. Try one more pass via the metadata
  // pipeline — for old Steam titles with no library_600x900 capsule, this is
  // where SteamGridDB kicks in and supplies an alternate cover URL.
  // Conditions: SGDB key configured AND we don't already have a SGDB url
  // we just tried. Without a key, fetchGameMetadata can't add new URLs we
  // haven't already attempted, so skip the network round-trip.
  const ms = (() => { try { return getMetadataSettings(); } catch { return null; } })();
  const sgdbConfigured = !!(ms && ms.steamGridDbKey);
  const alreadyHasSgdb = !!game.sgdbCoverUrl;
  if (sgdbConfigured && !alreadyHasSgdb) {
    try {
      const meta = await fetchGameMetadata(game);
      if (meta) {
        const merged = applyMetadataToGame(game, meta);
        const after = portraitUrlCandidates(game).filter(u => !tried.includes(u));
        for (const coverUrl of after) {
          try {
            const dest = path.join(coversDir, 'cover_' + gameId + extensionFromUrl(coverUrl));
            await downloadUrlToFile(coverUrl, dest);
            game.localCoverPath = dest;
            game._imgStamp = Date.now();
            clearCoverFailure(game);
            return { changed: true, triedMeta: true };
          } catch (e) {
            lastErr = e;
          }
        }
        if (merged) return { changed: true, triedMeta: true };
      }
    } catch (e) {
      lastErr = e;
    }
  }

  const total = portraitUrlCandidates(game).length;
  if (total > 0) {
    const reason = (lastErr && lastErr.message) || 'unknown';
    const suffix = sgdbConfigured ? '' : ' (no SteamGridDB key — set one in Settings)';
    const err = new Error(`No portrait (tried ${total}, last: ${reason})${suffix}`);
    err.permanent = !!lastErr && (lastErr.status >= 400 && lastErr.status < 500);
    err.lastUrl = lastErr && lastErr.url;
    throw err;
  }
  return { changed: false, triedMeta: false };
}

/** @returns {boolean} true if a new header file was written */
async function ensureLocalHeader(game, coversDir, gameId) {
  if (isValidLocalFile(game.localHeaderPath)) return false;

  if (game.localHeaderPath) {
    cleanupFile(game.localHeaderPath);
    game.localHeaderPath = null;
  }

  const candidates = headerUrlCandidates(game);
  if (candidates.length === 0) return false;

  let lastErr = null;
  for (const url of candidates) {
    try {
      const dest = path.join(coversDir, 'header_' + gameId + extensionFromUrl(url));
      await downloadUrlToFile(url, dest);
      game.localHeaderPath = dest;
      game._imgStamp = Date.now();
      return true;
    } catch (e) {
      lastErr = e;
    }
  }
  if (lastErr) throw lastErr;
  return false;
}

const coverQueue = new Set();
const coverRetries = new Map();
const MAX_COVER_RETRIES = 2;
let coverWorkerRunning = false;

// Per-session log dedup. Avoids the wall-of-warnings on startup when 1500+
// games re-enqueue and 200+ permanently 404. Each unique (gid, message) pair
// is logged once; a summary line is printed when the queue drains.
const _loggedFailures = new Set();
let _sessionFailCount = 0;
let _sessionPermanentCount = 0;

function logCoverFailure(gid, err) {
  _sessionFailCount++;
  if (err && err.permanent) _sessionPermanentCount++;
  const key = gid + '|' + ((err && err.message) || 'unknown');
  if (_loggedFailures.has(key)) return;
  _loggedFailures.add(key);
  // First ~20 unique failures get full detail, then we go quiet until summary.
  if (_loggedFailures.size <= 20) {
    log.warn('covers', 'download failed for', gid, '-', (err && err.message) || 'unknown');
  } else if (_loggedFailures.size === 21) {
    log.warn('covers', '(further per-game failures suppressed; summary at end)');
  }
}

function enqueueCoverFetch(gameId) {
  if (!gameId) return;
  coverQueue.add(gameId);
  if (!coverWorkerRunning) processCoverQueue();
}

async function processCoverQueue() {
  coverWorkerRunning = true;
  const coversDir = getCoversDir();
  const db = ctx.db;

  while (coverQueue.size > 0) {
    const batch = [];
    for (const id of coverQueue) {
      batch.push(id);
      if (batch.length >= 5) break;
    }
    for (const id of batch) coverQueue.delete(id);

    let anyChanged = false;

    await Promise.allSettled(
      batch.map(async gid => {
        const game = db.games.find(g => g.id === gid);
        if (!game) return;
        try {
          const portrait = await ensureLocalPortrait(game, coversDir, gid);
          const headerDone = await ensureLocalHeader(game, coversDir, gid);
          if (portrait.changed || portrait.triedMeta || headerDone) anyChanged = true;
          coverRetries.delete(gid);
        } catch (e) {
          logCoverFailure(gid, e);
          // Permanent failures (HTTP 4xx) skip retries entirely — re-trying a
          // 404 from the same URL has zero chance of success.
          const isPermanent =
            !!(e && (e.permanent || (e.status >= 400 && e.status < 500)));
          const retries = (coverRetries.get(gid) || 0) + 1;
          if (!isPermanent && retries <= MAX_COVER_RETRIES) {
            coverRetries.set(gid, retries);
            coverQueue.add(gid);
          } else {
            coverRetries.delete(gid);
            // Persist the failure marker so we don't re-enqueue this game on
            // every startup. Auto-clears whenever coverUrl/sgdbCoverUrl change
            // or the user runs "Reset Covers" / "Fetch Metadata".
            game._coverFailedAt = Date.now();
            game._coverFailReason = (e && e.message) || 'unknown';
            anyChanged = true;
          }
        }
      })
    );

    if (anyChanged) {
      ctx.saveDB(db);
      ctx.sendToRenderer('games:refresh', db.games);
    }
    ctx.sendToRenderer('cover:progress', {
      remaining: coverQueue.size,
      downloaded: anyChanged ? batch.length : 0,
    });
    if (coverQueue.size > 0) await new Promise(r => setTimeout(r, 150));
  }

  if (_sessionFailCount > 0) {
    log.info(
      'covers',
      `queue drained — ${_sessionFailCount} download failures (${_sessionPermanentCount} permanent / 4xx); marked games will skip the next 7 days`,
    );
    _loggedFailures.clear();
    _sessionFailCount = 0;
    _sessionPermanentCount = 0;
  }

  ctx.sendToRenderer('cover:progress', { remaining: 0, done: true });
  coverWorkerRunning = false;
  evictOldCovers().catch(() => {});
}

module.exports = {
  getCoversDir,
  cleanupFile,
  enqueueCoverFetch,
  evictOldCovers,
  shouldSkipDueToPriorFailure,
  clearCoverFailure,
  COVER_CACHE_LIMIT_BYTES,
  COVER_FAIL_RETRY_INTERVAL_MS,
};
