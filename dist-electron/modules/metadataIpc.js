// ─── Metadata Fetch IPC handlers ──────────────────────────────────────────────
const { ipcMain } = require('electron');
const ctx = require('./context');
const { fetchGameMetadata, applyMetadataToGame, invalidateMetadataCache } = require('./metadata');
const { enqueueCoverFetch } = require('./covers');
const { registerMetadataSearchHandlers } = require('./metadataSearch');
const log = require('./logger');

function registerMetadataIpcHandlers() {
  registerMetadataSearchHandlers();

  ipcMain.handle('metadata:fetch', async (_event, gameId) => {
    const game = ctx.db.games.find(g => g.id === gameId);
    if (!game) return { error: 'Game not found' };
    try {
      const meta = await fetchGameMetadata(game);
      if (!meta) return { error: 'No metadata found' };
      return { success: true, metadata: meta };
    } catch (e) {
      return { error: e.message };
    }
  });

  ipcMain.handle('metadata:apply', async (_event, gameId, force) => {
    const db = ctx.db;
    const game = db.games.find(g => g.id === gameId);
    if (!game) return { error: 'Game not found' };
    try {
      // Invalidate any cached metadata so force-apply fetches fresh data
      const cacheKey = (game.platform || '') + ':' + (game.platformId || game.name);
      invalidateMetadataCache(cacheKey);
      const meta = await fetchGameMetadata(game);
      if (!meta) return { error: 'No metadata found' };
      if (force) {
        // Force-apply: overwrite all fields (with sensible fallbacks)
        const prevCoverUrl = game.coverUrl;
        const prevHeaderUrl = game.headerUrl;
        game.coverUrl = meta.coverUrl || meta.headerUrl || (meta.screenshots && meta.screenshots[0]) || game.coverUrl;
        if (meta.description) game.description = meta.description;
        if (meta.developer) game.developer = meta.developer;
        if (meta.publisher) game.publisher = meta.publisher;
        if (meta.releaseDate) game.releaseDate = meta.releaseDate;
        if (meta.genres?.length) game.categories = meta.genres;
        game.headerUrl = meta.headerUrl || meta.coverUrl || (meta.screenshots && meta.screenshots[0]) || game.headerUrl;
        if (meta.screenshots?.length) game.screenshots = meta.screenshots;
        if (meta.metacritic != null) game.metacritic = meta.metacritic;
        if (meta.website) game.website = meta.website;
        // If cover/header URL changed, clear cached local file so re-download is triggered
        if (game.coverUrl !== prevCoverUrl) { game.localCoverPath = null; game._imgStamp = Date.now(); }
        if (game.headerUrl !== prevHeaderUrl) { game.localHeaderPath = null; game._imgStamp = Date.now(); }
        ctx.saveDB(db);
        ctx.sendToRenderer('games:refresh', db.games);
        try { enqueueCoverFetch(game.id); } catch(e) { log.debug('covers', 'enqueue failed', e); }
        return { success: true, game };
      } else {
        const changed = applyMetadataToGame(game, meta);
        if (changed) {
          ctx.saveDB(db);
          ctx.sendToRenderer('games:refresh', db.games);
          try { enqueueCoverFetch(game.id); } catch(e) { log.debug('covers', 'enqueue failed', e); }
        }
        return { success: true, game };
      }
    } catch (e) {
      return { error: e.message };
    }
  });

  ipcMain.handle('metadata:fetchForName', async (_event, name, platform, platformId) => {
    if (!name) return { error: 'No name provided' };
    try {
      const meta = await fetchGameMetadata({ name, platform: platform || 'custom', platformId: platformId || undefined });
      if (!meta) return { error: 'No metadata found' };
      return { success: true, meta };
    } catch (e) {
      return { error: e.message };
    }
  });

  ipcMain.handle('metadata:fetchAll', async () => {
    const db = ctx.db;
    let updated = 0, failed = 0;
    const queue = [...db.games].sort((a, b) => {
      const ai = a.installed === false ? 1 : 0;
      const bi = b.installed === false ? 1 : 0;
      return ai - bi;
    });
    const total = queue.length;
    const BATCH = 3;
    const REFRESH_INTERVAL = 500; // ms — minimum time between games:refresh pushes
    let lastRefreshAt = 0;
    let pendingRefresh = false;
    for (let i = 0; i < total; i += BATCH) {
      const batch = queue.slice(i, i + BATCH);
      const results = await Promise.allSettled(batch.map(async game => {
        const meta = await fetchGameMetadata(game);
        return { game, meta };
      }));
      let batchUpdated = 0;
      for (const r of results) {
        if (r.status === 'fulfilled' && r.value.meta) {
          if (applyMetadataToGame(r.value.game, r.value.meta)) {
            updated++; batchUpdated++;
            // Enqueue cover download now that coverUrl may have been set
            try { enqueueCoverFetch(r.value.game.id); } catch(e) { log.debug('covers', 'enqueue failed', e); }
          }
        } else { failed++; }
      }
      // Save after each batch that had changes, but throttle renderer refreshes
      if (batchUpdated > 0) {
        ctx.saveDB(db);
        pendingRefresh = true;
      }
      const now = Date.now();
      if (pendingRefresh && now - lastRefreshAt >= REFRESH_INTERVAL) {
        ctx.sendToRenderer('games:refresh', db.games);
        lastRefreshAt = now;
        pendingRefresh = false;
      }
      const done = Math.min(i + BATCH, total);
      ctx.sendToRenderer('metadata:progress', { current: done, total, updated, failed, name: batch[batch.length - 1].name, phase: 'metadata' });
      if (i + BATCH < total) await new Promise(r => setTimeout(r, 200));
    }
    // Final save + refresh to flush any pending changes
    if (updated > 0) {
      ctx.saveDB(db);
      ctx.sendToRenderer('games:refresh', db.games);
    }
    return { updated, failed, total };
  });
}

module.exports = { registerMetadataIpcHandlers };
