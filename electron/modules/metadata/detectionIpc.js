// ─── Platform Detection + Playtime Sync IPC handlers ─────────────────────────
const { ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const ctx = require('../core/context');
const { CHIAKI_SYSTEM_PATHS } = require('../core/constants');
const { findSteamRoot, scanSteamInstalled, scanEpicInstalled, scanGogInstalled, scanXboxInstalled } = require('./detection');
const { getBundledChiakiExe, getBundledChiakiVersion } = require('../integrations/chiaki');
const { getProvidersDir } = require('../core/paths');

function registerDetectionIpcHandlers() {
  const providersDir = getProvidersDir();
  const providers = require(providersDir);

  ipcMain.handle('detect:steam', async () => {
    try { return scanSteamInstalled(); }
    catch (err) { return { games: [], error: err.message }; }
  });

  ipcMain.handle('detect:epic', async () => {
    const games = scanEpicInstalled();
    return games.length ? { games } : { games: [], error: 'Epic Games not found' };
  });

  ipcMain.handle('detect:gog', async () => {
    const games = scanGogInstalled();
    return games.length ? { games } : { games: [], error: 'GOG not found' };
  });

  // ─── chiaki-ng Detection (PlayStation Remote Play) ──────────────────────────
  ipcMain.handle('detect:psremote', async () => {
    const result = {
      found: false,
      bundled: false,
      executablePath: null,
      version: null,
      consoles: [],
    };

    try {
      // 1. Check for bundled binary first
      const bundledExe = getBundledChiakiExe();
      if (bundledExe) {
        result.found = true;
        result.bundled = true;
        result.executablePath = bundledExe;
        result.version = getBundledChiakiVersion();
      }

      // 2. Fallback to system-installed
      if (!result.found) {
        for (const p of CHIAKI_SYSTEM_PATHS) {
          if (fs.existsSync(p)) {
            result.found = true;
            result.bundled = false;
            result.executablePath = p;
            break;
          }
        }
      }

      // 3. Try to list registered consoles (only if the path resolves to a known chiaki binary)
      if (result.executablePath && /^chiaki(-ng)?\.exe$/i.test(path.basename(result.executablePath))) {
        try {
          const listOutput = require('child_process').execFileSync(result.executablePath, ['list'], {
            timeout: 5000,
            env: { ...process.env, PATH: `${path.dirname(result.executablePath)};${process.env.PATH}` },
          }).toString();
          result.consoles = listOutput.trim().split('\n').filter(l => l.trim());
        } catch (_e) {
          result.consoles = [];
        }
      }
    } catch (err) {
      result.error = err.message;
    }

    return result;
  });

  ipcMain.handle('detect:xbox', async () => {
    try { return scanXboxInstalled(); }
    catch (err) { return { games: [], xboxAppFound: false, error: err.message }; }
  });

  // Generic provider detection factory — eliminates per-platform boilerplate
  function registerProviderDetectHandler(platform, label) {
    ipcMain.handle(`detect:${platform}`, async () => {
      try {
        const p = providers?.[platform];
        if (!p?.detectInstalled) return { games: [], appFound: false, error: `${label || platform} provider not available` };
        const res = p.detectInstalled();
        return { games: res?.games || [], appFound: !!p.isAppInstalled?.(), error: res?.error };
      } catch (err) {
        return { games: [], appFound: false, error: err.message };
      }
    });
  }
  registerProviderDetectHandler('ea', 'EA');
  registerProviderDetectHandler('battlenet', 'Battle.net');
  registerProviderDetectHandler('itchio', 'itch.io');
  registerProviderDetectHandler('ubisoft', 'Ubisoft');

  // ─── Playtime Sync from Platforms ───────────────────────────────────────────
  ipcMain.handle('playtime:sync', async () => {
    const db = ctx.db;
    const updated = [];
    try {
      // ── Steam playtime via Steam Web API or local stats ──
      const steamRoot = findSteamRoot();
      if (steamRoot) {
        // Try reading localconfig.vdf for playtime data
        const userdataDir = path.join(steamRoot, 'userdata');
        if (fs.existsSync(userdataDir)) {
          const userDirs = fs.readdirSync(userdataDir, { withFileTypes: true })
            .filter(d => d.isDirectory() && /^\d+$/.test(d.name))
            .map(d => d.name);
          for (const userId of userDirs) {
            const localConfigPath = path.join(userdataDir, userId, 'config', 'localconfig.vdf');
            if (!fs.existsSync(localConfigPath)) continue;
            const vdfContent = fs.readFileSync(localConfigPath, 'utf-8');
            // Parse VDF playtime_forever values — single pass covers both nested formats
            const playtimeMap = new Map();
            const appBlocks = vdfContent.matchAll(/"(\d+)"\s*\{[^}]*?"playtime_forever"\s+"(\d+)"[^}]*?\}/gs);
            for (const m of appBlocks) {
              const appId = m[1];
              const minutes = parseInt(m[2], 10);
              if (minutes > 0) {
                const prev = playtimeMap.get(appId) || 0;
                if (minutes > prev) playtimeMap.set(appId, minutes);
              }
            }
            for (const [appId, minutes] of playtimeMap) {
              const game = db.games.find(g => g.platform === 'steam' && g.platformId === appId);
              if (game && minutes > (game.playtimeMinutes || 0)) {
                game.playtimeMinutes = minutes;
                updated.push({ id: game.id, name: game.name, minutes, source: 'steam' });
              }
            }
          }
        }

        // Also try reading playtime from Steam acf manifests (StateFlags / BytesDownloaded can hint at use)
        // and appinfo.vdf — but localconfig is the primary source
      }

      // ── Epic / GOG — no accessible local playtime data without native SQLite ──

      if (updated.length > 0) {
        ctx.saveDB(db);
        ctx.sendToRenderer('games:refresh', db.games);
      }
    } catch (err) {
      return { updated: [], error: err.message };
    }

    return { updated, games: db.games };
  });
}

module.exports = { registerDetectionIpcHandlers };
