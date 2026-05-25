// ─── Metadata Fetch IPC handlers ──────────────────────────────────────────────
const { ipcMain } = require('electron');
const ctx = require('../core/context');
const {
  fetchGameMetadata,
  applyMetadataToGame,
  invalidateMetadataCache,
  cacheKeyFor,
} = require('./metadata');
const { enqueueCoverFetch, clearCoverFailure } = require('../games/covers');
const { registerMetadataSearchHandlers } = require('./metadataSearch');

function registerMetadataIpcHandlers() {
  registerMetadataSearchHandlers();

  ipcMain.handle('metadata:fetch', async (_event, gameId) => {
    const game = ctx.db.games.find(g => g.id === gameId);
    if (!game) return { error: 'Game not found' };
    try {
      const meta = await fetchGameMetadata(game);
      if (!meta) return { error: 'No metadata found' };
      return { success: true, meta };
    } catch (e) {
      return { error: e.message };
    }
  });

  ipcMain.handle('metadata:apply', async (_event, gameId, force) => {
    const db = ctx.db;
    const game = db.games.find(g => g.id === gameId);
    if (!game) return { error: 'Game not found' };
    try {
      invalidateMetadataCache(cacheKeyFor(game));
      const meta = await fetchGameMetadata(game);
      if (!meta) return { error: 'No metadata found' };

      const prevCoverUrl = game.coverUrl;
      const prevHeaderUrl = game.headerUrl;

      const changed = applyMetadataToGame(game, meta, { force: !!force });

      if (changed) {
        if (game.coverUrl !== prevCoverUrl) {
          game.localCoverPath = null;
          game._imgStamp = Date.now();
          clearCoverFailure(game);
        }
        if (game.headerUrl !== prevHeaderUrl) {
          game.localHeaderPath = null;
          game._imgStamp = Date.now();
          clearCoverFailure(game);
        }
        ctx.saveDB(db);
        ctx.sendToRenderer('games:refresh', db.games);
        enqueueCoverFetch(game.id);
      }
      return { success: true, game };
    } catch (e) {
      return { error: e.message };
    }
  });

  ipcMain.handle('metadata:fetchForName', async (_event, name, platform, platformId) => {
    if (!name) return { error: 'No name provided' };
    try {
      const meta = await fetchGameMetadata({
        name,
        platform: platform || 'custom',
        platformId: platformId || undefined,
      });
      if (!meta) return { error: 'No metadata found' };
      return { success: true, meta };
    } catch (e) {
      return { error: e.message };
    }
  });

  ipcMain.handle('metadata:fetchAll', async () => {
    const db = ctx.db;
    let updated = 0;
    let failed = 0;
    const queue = [...db.games].sort((a, b) => {
      const ai = a.installed === false ? 1 : 0;
      const bi = b.installed === false ? 1 : 0;
      return ai - bi;
    });
    const total = queue.length;
    const BATCH = 3;
    const REFRESH_INTERVAL = 500;
    let lastRefreshAt = 0;
    let pendingRefresh = false;

    for (let i = 0; i < total; i += BATCH) {
      const batch = queue.slice(i, i + BATCH);
      const results = await Promise.allSettled(
        batch.map(async game => ({ game, meta: await fetchGameMetadata(game) }))
      );
      let batchUpdated = 0;
      for (const r of results) {
        if (r.status === 'fulfilled' && r.value.meta) {
          if (applyMetadataToGame(r.value.game, r.value.meta)) {
            updated++;
            batchUpdated++;
            clearCoverFailure(r.value.game);
            enqueueCoverFetch(r.value.game.id);
          }
        } else {
          failed++;
        }
      }
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
      ctx.sendToRenderer('metadata:progress', {
        current: done,
        total,
        updated,
        failed,
        name: batch[batch.length - 1].name,
        phase: 'metadata',
      });
      if (i + BATCH < total) await new Promise(r => setTimeout(r, 200));
    }
    if (updated > 0) {
      ctx.saveDB(db);
      ctx.sendToRenderer('games:refresh', db.games);
    }
    return { updated, failed, total };
  });
}

module.exports = { registerMetadataIpcHandlers };
