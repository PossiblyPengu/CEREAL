// ─── Cover Image Download Queue & Caching ─────────────────────────────────────
const { app, net } = require('electron');
const path = require('path');
const fs = require('fs');
const ctx = require('../core/context');
const { fetchGameMetadata, applyMetadataToGame } = require('../metadata/metadata');
const log = require('../core/logger');

// --- Cover cache directory (memoized — path is stable for the lifetime of the app) ---
let _coversDir = null;
function getCoversDir() {
  if (_coversDir) return _coversDir;
  const dir = path.join(app.getPath('userData'), 'covers');
  try { fs.mkdirSync(dir, { recursive: true }); } catch (e) { log.warn('covers', 'Failed to create covers directory:', e.message); }
  _coversDir = dir;
  return _coversDir;
}

async function downloadToFile(url, destPath) {
  try {
    const resp = await net.fetch(url);
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const buf = Buffer.from(await resp.arrayBuffer());
    if (buf.length < 1024) throw new Error('File too small (' + buf.length + ' bytes)');
    fs.writeFileSync(destPath, buf);
    return true;
  } catch (e) {
    cleanupFile(destPath);
    throw e;
  }
}

function cleanupFile(p) { try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch (_e) { /* best-effort cleanup */ } }

function isValidLocalFile(p) {
  try { return !!p && fs.existsSync(p) && fs.statSync(p).size >= 1024; } catch (_e) { return false; }
}

// Background fetch queue (simple FIFO)
const coverQueue = new Set();
const coverRetries = new Map(); // gameId → retryCount
const MAX_COVER_RETRIES = 2;
let coverWorkerRunning = false;
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
    for (const id of coverQueue) { batch.push(id); if (batch.length >= 5) break; }
    for (const id of batch) coverQueue.delete(id);
    let anyChanged = false;
    await Promise.allSettled(batch.map(async gid => {
      try {
        const game = db.games.find(g => g.id === gid);
        if (!game) return;
        // Download cover — only portrait coverUrl is used. Wide headerUrl/screenshots are
        // kept in their own slots and never downloaded as the cover image.
        const hasValidCover = isValidLocalFile(game.localCoverPath);
        if (!hasValidCover) {
          if (game.localCoverPath) { cleanupFile(game.localCoverPath); game.localCoverPath = null; }
          let candidates = [game.coverUrl, game.sgdbCoverUrl].filter(Boolean);
          let downloaded = false;
          for (const coverUrl of candidates) {
            try {
              const ext = path.extname(new URL(coverUrl).pathname).split('?')[0] || '.jpg';
              const dest = path.join(coversDir, 'cover_' + gid + ext);
              await downloadToFile(coverUrl, dest);
              game.localCoverPath = dest;
              game._imgStamp = Date.now();
              anyChanged = true;
              coverRetries.delete(gid);
              downloaded = true;
              break;
            } catch (_e) { /* try next candidate */ }
          }
          // No portrait cover yet — fetch metadata which may find a portrait capsule URL
          if (!downloaded && !game.headerUrl) {
            try {
              const meta = await fetchGameMetadata(game);
              if (meta) {
                applyMetadataToGame(game, meta);
                anyChanged = true;
                // Only retry with the (potentially new) portrait coverUrl
                if (game.coverUrl && !candidates.includes(game.coverUrl)) {
                  try {
                    const ext = path.extname(new URL(game.coverUrl).pathname).split('?')[0] || '.jpg';
                    const dest = path.join(coversDir, 'cover_' + gid + ext);
                    await downloadToFile(game.coverUrl, dest);
                    game.localCoverPath = dest;
                    game._imgStamp = Date.now();
                    coverRetries.delete(gid);
                    downloaded = true;
                  } catch (_e) { /* metadata cover also failed */ }
                }
              }
            } catch (_e) { /* metadata fetch failed */ }
          }
          if (!downloaded) {
            const total = [game.coverUrl, game.sgdbCoverUrl].filter(Boolean).length;
            if (total > 0) throw new Error('All cover URLs failed (' + total + ' candidates)');
          }
        }
        // Download header
        const hasValidHeader = isValidLocalFile(game.localHeaderPath);
        if (!hasValidHeader) {
          if (game.localHeaderPath) { cleanupFile(game.localHeaderPath); game.localHeaderPath = null; }
          const headerUrl = game.headerUrl;
          if (headerUrl) {
            const ext = path.extname(new URL(headerUrl).pathname).split('?')[0] || '.jpg';
            const dest = path.join(coversDir, 'header_' + gid + ext);
            await downloadToFile(headerUrl, dest);
            game.localHeaderPath = dest;
            game._imgStamp = Date.now();
            anyChanged = true;
          }
        }
      } catch (e) {
        log.warn('covers', 'download failed for', gid, e && e.message);
        const retries = (coverRetries.get(gid) || 0) + 1;
        if (retries <= MAX_COVER_RETRIES) {
          coverRetries.set(gid, retries);
          coverQueue.add(gid); // Re-enqueue for retry
        } else {
          coverRetries.delete(gid);
        }
      }
    }));
    if (anyChanged) {
      ctx.saveDB(db);
      ctx.sendToRenderer('games:refresh', db.games);
    }
    ctx.sendToRenderer('cover:progress', { remaining: coverQueue.size, downloaded: anyChanged ? batch.length : 0 });
    if (coverQueue.size > 0) await new Promise(r => setTimeout(r, 150));
  }
  ctx.sendToRenderer('cover:progress', { remaining: 0, done: true });
  coverWorkerRunning = false;
}

module.exports = {
  getCoversDir,
  cleanupFile,
  enqueueCoverFetch,
};
