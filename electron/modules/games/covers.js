// ─── Cover / header download queue & on-disk cache ─────────────────────────────
// Downloads remote portrait `coverUrl` / wide `headerUrl` into userData/covers.
// Steam-specific URL knowledge lives in modules/metadata/gameArt.js — this file
// stays platform-agnostic and just walks whichever candidate list it's handed.

const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const ctx = require('../core/context');
const {
  fetchGameMetadata,
  applyMetadataToGame,
} = require('../metadata/metadata');
const {
  portraitUrlCandidates,
  headerUrlCandidates,
} = require('../metadata/gameArt');
const { downloadToFile } = require('../metadata/http');
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
    try { entries = fs.readdirSync(dir); }
    catch (e) { return { error: e.message }; }

    const referenced = getReferencedCoverPaths();
    const items = [];
    let totalBytes = 0;
    for (const name of entries) {
      const full = path.join(dir, name);
      let st;
      try { st = fs.statSync(full); } catch { continue; }
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
      } catch (_e) { /* skip */ }
    }
    log.info(
      'covers',
      `LRU eviction: removed ${evicted} files (${(freed / 1024 / 1024).toFixed(1)} MB), now ${(totalBytes / 1024 / 1024).toFixed(1)} MB`,
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
  try { if (fs.existsSync(p)) fs.unlinkSync(p); }
  catch (_e) { /* best-effort */ }
}

function isValidLocalFile(p) {
  try { return !!p && fs.existsSync(p) && fs.statSync(p).size >= 1024; }
  catch (_e) { return false; }
}

function extensionFromUrl(url) {
  try {
    return path.extname(new URL(url).pathname).split('?')[0] || '.jpg';
  } catch (_e) {
    return '.jpg';
  }
}

// ─── Persistent-failure backoff ─────────────────────────────────────────────
// Some games (delisted Steam apps, software entries, dedicated servers, very
// old titles) genuinely have no library art on any CDN. Marking the failure
// timestamp stops us re-fetching their metadata and re-trying 404 URLs every
// startup. The flag is auto-cleared whenever a new URL gets assigned (manual
// edit, art picker, fresh metadata fetch, or clearCovers).
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

async function tryDownloadCandidates(candidates, coversDir, gameId, prefix) {
  let lastErr = null;
  for (const url of candidates) {
    try {
      const dest = path.join(coversDir, `${prefix}_${gameId}${extensionFromUrl(url)}`);
      await downloadToFile(url, dest);
      return { dest, url };
    } catch (e) {
      lastErr = e;
    }
  }
  return { dest: null, lastErr };
}

/**
 * Try each portrait URL until one downloads. If direct candidates fail (or
 * there were none), run one metadata-rescue pass: fetchGameMetadata
 * HEAD-probes Steam's CDN and pulls a SteamGridDB grid (when configured),
 * which may yield URLs the game's record didn't have. Then try those.
 *
 * Throws when no portrait could be downloaded for any reason — caller marks
 * the failure timestamp so we don't re-try this game on every startup. The
 * `changed` return flag indicates whether the game record was mutated (e.g.
 * metadata was applied even when no portrait was available).
 *
 * @returns {{ changed: boolean, triedMeta: boolean }}
 */
async function ensureLocalPortrait(game, coversDir, gameId) {
  if (isValidLocalFile(game.localCoverPath)) return { changed: false, triedMeta: false };

  if (game.localCoverPath) {
    cleanupFile(game.localCoverPath);
    game.localCoverPath = null;
  }

  const triedDirect = portraitUrlCandidates(game);
  const direct = await tryDownloadCandidates(triedDirect, coversDir, gameId, 'cover');
  if (direct.dest) {
    game.localCoverPath = direct.dest;
    game._imgStamp = Date.now();
    clearCoverFailure(game);
    return { changed: true, triedMeta: false };
  }

  // Direct candidates exhausted (or never existed). Always run metadata rescue
  // — this is what discovers Steam portraits via HEAD probe and SGDB fallback
  // for games that have no coverUrl yet.
  let lastErr = direct.lastErr;
  let merged = false;
  let triedMeta = false;
  try {
    const meta = await fetchGameMetadata(game);
    if (meta) {
      triedMeta = true;
      merged = applyMetadataToGame(game, meta);
      const after = portraitUrlCandidates(game).filter(u => !triedDirect.includes(u));
      if (after.length > 0) {
        const rescued = await tryDownloadCandidates(after, coversDir, gameId, 'cover');
        if (rescued.dest) {
          game.localCoverPath = rescued.dest;
          game._imgStamp = Date.now();
          clearCoverFailure(game);
          return { changed: true, triedMeta: true };
        }
        lastErr = rescued.lastErr || lastErr;
      }
    }
  } catch (e) {
    lastErr = e;
    triedMeta = true;
  }

  // Nothing worked. Always throw so the caller marks _coverFailedAt — even
  // when there were never any candidates to try (no portrait found anywhere).
  const reason = (lastErr && lastErr.message) || 'no portrait available';
  const err = new Error(`No portrait (${reason})`);
  // 4xx is permanent (URL doesn't exist); a no-candidates outcome is also
  // permanent (rescue ran and found nothing). Network errors get retried.
  err.permanent =
    !lastErr ||
    !!(lastErr.status >= 400 && lastErr.status < 500);
  err.lastUrl = lastErr && lastErr.url;
  err._metaMerged = merged;
  err._triedMeta = triedMeta;
  throw err;
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

  const r = await tryDownloadCandidates(candidates, coversDir, gameId, 'header');
  if (r.dest) {
    game.localHeaderPath = r.dest;
    game._imgStamp = Date.now();
    return true;
  }
  if (r.lastErr) throw r.lastErr;
  return false;
}

const coverQueue = new Set();
const coverRetries = new Map();
const MAX_COVER_RETRIES = 2;
let coverWorkerRunning = false;

// Per-session failure counters — we never log per-game cover 404s anymore.
// They flooded the console on first run with a Steam library. A single
// summary line goes out when the queue drains.
let _sessionFailCount = 0;
let _sessionPermanentCount = 0;

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

        // Portrait — runs first so its metadata-rescue pass can populate
        // headerUrl in time for the header fetch below.
        let portraitErr = null;
        let portraitChanged = false;
        try {
          const portrait = await ensureLocalPortrait(game, coversDir, gid);
          if (portrait.changed || portrait.triedMeta) portraitChanged = true;
        } catch (e) {
          portraitErr = e;
          // Metadata that came in via the failed rescue still counts as a
          // mutation we should persist (description, developer, headerUrl…).
          if (e && e._metaMerged) portraitChanged = true;
        }

        // Header — independent of portrait outcome.
        let headerDone = false;
        try {
          headerDone = await ensureLocalHeader(game, coversDir, gid);
        } catch (_e) {
          /* header is best-effort; the portrait already drove the rescue */
        }

        if (portraitChanged || headerDone) anyChanged = true;

        if (!portraitErr) {
          coverRetries.delete(gid);
          return;
        }

        _sessionFailCount++;
        const isPermanent = !!(portraitErr.permanent ||
          (portraitErr.status >= 400 && portraitErr.status < 500));
        if (isPermanent) _sessionPermanentCount++;

        const retries = (coverRetries.get(gid) || 0) + 1;
        if (!isPermanent && retries <= MAX_COVER_RETRIES) {
          coverRetries.set(gid, retries);
          coverQueue.add(gid);
        } else {
          coverRetries.delete(gid);
          game._coverFailedAt = Date.now();
          game._coverFailReason = portraitErr.message || 'unknown';
          anyChanged = true;
        }
      }),
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
      `queue drained — ${_sessionFailCount} games had no available art (${_sessionPermanentCount} permanent / 4xx); those will skip the next 7 days`,
    );
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
