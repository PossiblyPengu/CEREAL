// ─── Game CRUD + Category IPC handlers ────────────────────────────────────────
const { ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');
const ctx = require('./context');
const { getProvidersDir } = require('./paths');

const { canonicalize: canonicalizeName } = require(path.join(getProvidersDir(), 'utils'));
const { enqueueCoverFetch } = require('./covers');
const { fetchGameMetadata, applyMetadataToGame } = require('./metadata');
const log = require('./logger');

function registerGameCrudIpcHandlers() {
  ipcMain.handle('games:getAll', () => ctx.db.games);
  ipcMain.handle('games:getCategories', () => ctx.db.categories);

  ipcMain.handle('games:add', (_event, game) => {
    const db = ctx.db;
    if (!game || typeof game !== 'object') return { error: 'Invalid game data' };
    if (!game.name || typeof game.name !== 'string' || !game.name.trim()) return { error: 'Game name is required' };
    game.name = game.name.trim();
    // Try to find an existing game to merge with (dedupe by platformId or canonical name)
    let existing = null;
    try {
      if (game.platform && game.platformId) {
        existing = db.games.find(g => g.platform === game.platform && g.platformId && g.platformId === game.platformId);
      }
      if (!existing) {
        const canon = canonicalizeName(game.name || '');
        if (canon) existing = db.games.find(g => canonicalizeName(g.name) === canon && (!game.platform || g.platform === game.platform));
      }
    } catch (_e) { existing = null; }

    if (existing) {
      // Merge into existing record instead of creating a duplicate
      const prev = existing;
      const merged = { ...prev, ...game };
      try {
        const coverChanged = (typeof game.coverUrl === 'string' && game.coverUrl !== prev.coverUrl);
        const headerChanged = (typeof game.headerUrl === 'string' && game.headerUrl !== prev.headerUrl);
        if (coverChanged || headerChanged) merged._imgStamp = Date.now(); else merged._imgStamp = prev._imgStamp;
      } catch (_e) { merged._imgStamp = prev._imgStamp; }
      // Ensure platform/platformId are preserved
      if (!merged.platform) merged.platform = prev.platform;
      if (!merged.platformId) merged.platformId = prev.platformId;
      // Never downgrade installed status (detect sets true, import sets false — detect wins)
      if (prev.installed === true && merged.installed === false) merged.installed = true;
      db.games[db.games.findIndex(g => g.id === prev.id)] = merged;
      ctx.saveDB(db);
      ctx.sendToRenderer('games:refresh', db.games);
      // If cover URL changed, enqueue fetch
      try { enqueueCoverFetch(merged.id); } catch(e) { log.debug('covers', 'enqueue failed', e); }
      return merged;
    }

    // No existing match — create new
    game.id = Date.now().toString(36) + Math.random().toString(36).substring(2, 7);
    game.addedAt = new Date().toISOString();
    game.lastPlayed = null;
    game.playtimeMinutes = 0;
    game.favorite = false;
    // Stamp new games that already have a cover to force immediate reloads in renderer
    if (game.coverUrl) game._imgStamp = Date.now();
    db.games.push(game);
    ctx.saveDB(db);

    // Enqueue cover fetch immediately in case the game already has a coverUrl
    try { enqueueCoverFetch(game.id); } catch(e) { log.debug('covers', 'enqueue failed', e); }

    // Auto-fetch metadata in the background; re-enqueue cover after in case metadata sets coverUrl
    fetchGameMetadata(game).then(meta => {
      if (meta && applyMetadataToGame(game, meta)) {
        ctx.saveDB(db);
        ctx.sendToRenderer('games:refresh', db.games);
        // Cover URL may have just been set by metadata — download it
        try { enqueueCoverFetch(game.id); } catch(e) { log.debug('covers', 'enqueue failed', e); }
      }
    }).catch(() => {});

    return game;
  });

  ipcMain.handle('games:update', (_event, updatedGame) => {
    const db = ctx.db;
    if (!updatedGame || typeof updatedGame !== 'object' || !updatedGame.id) return null;
    if (updatedGame.name !== undefined && (typeof updatedGame.name !== 'string' || !updatedGame.name.trim())) return null;
    const idx = db.games.findIndex(g => g.id === updatedGame.id);
    if (idx !== -1) {
      const prev = db.games[idx];
      const merged = { ...prev, ...updatedGame };
      // If cover/header changed on update, clear the cached local file so the
      // cover queue re-downloads from the new URL instead of keeping the stale file
      try {
        const coverChanged = (typeof updatedGame.coverUrl === 'string' && updatedGame.coverUrl !== prev.coverUrl);
        const headerChanged = (typeof updatedGame.headerUrl === 'string' && updatedGame.headerUrl !== prev.headerUrl);
        if (coverChanged) {
          if (prev.localCoverPath) { try { fs.unlinkSync(prev.localCoverPath); } catch (_e) { log.debug('covers', 'unlink cover failed'); } }
          merged.localCoverPath = null;
          merged._imgStamp = Date.now();
        }
        if (headerChanged) {
          if (prev.localHeaderPath) { try { fs.unlinkSync(prev.localHeaderPath); } catch (_e) { log.debug('covers', 'unlink header failed'); } }
          merged.localHeaderPath = null;
          merged._imgStamp = Date.now();
        }
        if (!coverChanged && !headerChanged) merged._imgStamp = prev._imgStamp;
      } catch (_e) { merged._imgStamp = prev._imgStamp; }
      db.games[idx] = merged;
      ctx.saveDB(db);
      ctx.sendToRenderer('games:refresh', db.games);
      // If cover URL changed, enqueue fetch
      try { enqueueCoverFetch(updatedGame.id); } catch(e) { log.debug('covers', 'enqueue failed', e); }
      return db.games[idx];
    }
    return null;
  });

  ipcMain.handle('games:delete', (_event, id) => {
    const db = ctx.db;
    db.games = db.games.filter(g => g.id !== id);
    ctx.saveDB(db);
    ctx.sendToRenderer('games:refresh', db.games);
    return true;
  });

  ipcMain.handle('games:toggleFavorite', (_event, id) => {
    const db = ctx.db;
    const game = db.games.find(g => g.id === id);
    if (game) {
      game.favorite = !game.favorite;
      ctx.saveDB(db);
      ctx.sendToRenderer('games:refresh', db.games);
      return game;
    }
    return null;
  });

  ipcMain.handle('covers:fetchNow', async (_event, gameId) => {
    try {
      enqueueCoverFetch(gameId);
      return { queued: true };
    } catch (e) { return { error: e.message }; }
  });

  // ─── Categories ─────────────────────────────────────────────────────────────
  ipcMain.handle('categories:add', (_event, category) => {
    const db = ctx.db;
    if (!db.categories.includes(category)) {
      db.categories.push(category);
      ctx.saveDB(db);
    }
    return db.categories;
  });

  ipcMain.handle('categories:remove', (_event, category) => {
    const db = ctx.db;
    db.categories = db.categories.filter(c => c !== category);
    // Also remove from all games
    db.games.forEach(g => {
      g.categories = (g.categories || []).filter(c => c !== category);
    });
    ctx.saveDB(db);
    return db.categories;
  });

  // ─── Tab System (stubs — main process acknowledges renderer tab actions) ────
  ipcMain.handle('tabs:switch', () => {});
  ipcMain.handle('tabs:close', () => {});
}

module.exports = { registerGameCrudIpcHandlers };
