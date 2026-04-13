// ─── Settings Management ──────────────────────────────────────────────────────
const { app, ipcMain, dialog } = require('electron');
const fs = require('fs');
const ctx = require('./context');
const { connectDiscord, disconnectDiscord } = require('./discord');
const { cleanupFile } = require('./covers');

const DEFAULT_SETTINGS = {
  defaultView: 'orbit',          // 'orbit' | 'cards'
  accentColor: '#d4a853',        // hex color
  starDensity: 'normal',         // 'low' | 'normal' | 'high'
  showAnimations: true,
  rememberWindowBounds: true,    // whether to restore & save window position/size
  autoSyncPlaytime: false,
  minimizeOnLaunch: false,
  closeToTray: false,
  defaultTab: 'all',             // 'all' | 'favorites' | 'recent' | platform key
  discordPresence: false,        // show currently playing on Discord
  metadataSource: 'steam',       // 'steam' | 'wikipedia'
  launchOnStartup: false,        // start app when Windows boots
  startMinimized: false,         // start hidden to tray
};

function getSettings() {
  return { ...DEFAULT_SETTINGS, ...(ctx.db.settings || {}) };
}

function registerSettingsIpcHandlers({ createTray, destroyTray, DB_PATH }) {
  ipcMain.handle('settings:get', () => getSettings());

  ipcMain.handle('settings:save', (event, newSettings) => {
    ctx.db.settings = { ...DEFAULT_SETTINGS, ...(ctx.db.settings || {}), ...newSettings };
    ctx.saveDB(ctx.db);

    // Connect/disconnect Discord RPC based on setting
    if (ctx.db.settings.discordPresence) {
      connectDiscord();
    } else {
      disconnectDiscord();
    }

    // Update Windows startup registration
    if ('launchOnStartup' in newSettings) {
      try { app.setLoginItemSettings({ openAtLogin: !!newSettings.launchOnStartup }); } catch (e) { /* ok */ }
    }

    // Create or destroy tray based on closeToTray setting
    if ('closeToTray' in newSettings) {
      if (newSettings.closeToTray) createTray();
      else destroyTray();
    }

    return ctx.db.settings;
  });

  ipcMain.handle('settings:reset', () => {
    ctx.db.settings = { ...DEFAULT_SETTINGS };
    ctx.saveDB(ctx.db);
    return ctx.db.settings;
  });

  ipcMain.handle('settings:exportLibrary', async () => {
    const result = await dialog.showSaveDialog(ctx.mainWindow, {
      title: 'Export Library',
      defaultPath: 'cereal-library.json',
      filters: [{ name: 'JSON', extensions: ['json'] }]
    });
    if (result.canceled || !result.filePath) return { cancelled: true };
    try {
      const exportData = { games: ctx.db.games, categories: ctx.db.categories, exportedAt: new Date().toISOString() };
      fs.writeFileSync(result.filePath, JSON.stringify(exportData, null, 2));
      return { success: true, path: result.filePath };
    } catch (e) {
      return { error: e.message };
    }
  });

  ipcMain.handle('settings:importLibrary', async () => {
    const result = await dialog.showOpenDialog(ctx.mainWindow, {
      title: 'Import Library',
      filters: [{ name: 'JSON', extensions: ['json'] }],
      properties: ['openFile']
    });
    if (result.canceled || !result.filePaths.length) return { cancelled: true };
    try {
      const raw = fs.readFileSync(result.filePaths[0], 'utf-8');
      const imported = JSON.parse(raw);
      let addedCount = 0;
      if (imported.games && Array.isArray(imported.games)) {
        const existingIds = new Set(ctx.db.games.map(g => g.name + '|' + g.platform));
        for (const g of imported.games) {
          const key = g.name + '|' + g.platform;
          if (!existingIds.has(key)) {
            g.id = Date.now().toString(36) + Math.random().toString(36).substring(2, 7);
            ctx.db.games.push(g);
            existingIds.add(key);
            addedCount++;
          }
        }
      }
      if (imported.categories && Array.isArray(imported.categories)) {
        const catSet = new Set(ctx.db.categories);
        imported.categories.forEach(c => catSet.add(c));
        ctx.db.categories = [...catSet];
      }
      ctx.saveDB(ctx.db);
      return { success: true, added: addedCount, games: ctx.db.games, categories: ctx.db.categories };
    } catch (e) {
      return { error: e.message };
    }
  });

  ipcMain.handle('settings:clearCovers', () => {
    for (const game of ctx.db.games) {
      if (game.localCoverPath) { cleanupFile(game.localCoverPath); game.localCoverPath = null; }
      if (game.localHeaderPath) { cleanupFile(game.localHeaderPath); game.localHeaderPath = null; }
      game._imgStamp = Date.now();
      if (game.platform === 'steam' && game.platformId) {
        game.coverUrl = `https://shared.steamstatic.com/store_item_assets/steam/apps/${game.platformId}/library_600x900_2x.jpg`;
        game.headerUrl = `https://shared.steamstatic.com/store_item_assets/steam/apps/${game.platformId}/library_hero.jpg`;
      } else {
        game.coverUrl = '';
        game.headerUrl = '';
      }
    }
    ctx.saveDB(ctx.db);
    return { success: true, games: ctx.db.games };
  });

  ipcMain.handle('settings:clearAllGames', () => {
    ctx.db.games = [];
    ctx.saveDB(ctx.db);
    return { success: true };
  });

  ipcMain.handle('settings:getDataPath', () => DB_PATH);

  ipcMain.handle('settings:getAppVersion', () => app.getVersion());
}

module.exports = {
  DEFAULT_SETTINGS,
  getSettings,
  registerSettingsIpcHandlers,
};
