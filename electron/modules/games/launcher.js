// ─── Platform Launch Helpers ──────────────────────────────────────────────────
// Pure functions for resolving launcher executables and building platform URIs.

const path = require('path');
const fs = require('fs');
const { shell } = require('electron');
const { spawn } = require('child_process');

function normalizePlatform(platform) {
  if (platform === 'psremote') return 'psn';
  return platform;
}

function getLauncherExecutableCandidates(platform) {
  switch (platform) {
    case 'steam':
      return [
        path.join(process.env['ProgramFiles(x86)'] || '', 'Steam', 'Steam.exe'),
        path.join(process.env.ProgramFiles || '', 'Steam', 'Steam.exe'),
      ];
    case 'epic':
      return [
        path.join(process.env['ProgramFiles(x86)'] || '', 'Epic Games', 'Launcher', 'Portal', 'Binaries', 'Win64', 'EpicGamesLauncher.exe'),
        path.join(process.env.ProgramFiles || '', 'Epic Games', 'Launcher', 'Portal', 'Binaries', 'Win64', 'EpicGamesLauncher.exe'),
      ];
    case 'gog':
      return [
        path.join(process.env['ProgramFiles(x86)'] || '', 'GOG Galaxy', 'GalaxyClient.exe'),
        path.join(process.env.ProgramFiles || '', 'GOG Galaxy', 'GalaxyClient.exe'),
      ];
    case 'ea':
      return [
        path.join(process.env.ProgramFiles || '', 'Electronic Arts', 'EA Desktop', 'EA Desktop', 'EADesktop.exe'),
        path.join(process.env.LOCALAPPDATA || '', 'Electronic Arts', 'EA Desktop', 'EA Desktop', 'EADesktop.exe'),
        path.join(process.env['ProgramFiles(x86)'] || '', 'Origin', 'Origin.exe'),
      ];
    case 'battlenet':
      return [
        path.join(process.env.ProgramFiles || '', 'Battle.net', 'Battle.net.exe'),
        path.join(process.env['ProgramFiles(x86)'] || '', 'Battle.net', 'Battle.net.exe'),
      ];
    case 'ubisoft':
      return [
        path.join(process.env.ProgramFiles || '', 'Ubisoft', 'Ubisoft Game Launcher', 'UbisoftConnect.exe'),
        path.join(process.env['ProgramFiles(x86)'] || '', 'Ubisoft', 'Ubisoft Game Launcher', 'UbisoftConnect.exe'),
        path.join(process.env.ProgramFiles || '', 'Ubisoft', 'Ubisoft Game Launcher', 'Uplay.exe'),
        path.join(process.env['ProgramFiles(x86)'] || '', 'Ubisoft', 'Ubisoft Game Launcher', 'Uplay.exe'),
      ];
    case 'itchio': {
      const itchBase = path.join(process.env.LOCALAPPDATA || '', 'itch');
      try {
        const dirs = fs.readdirSync(itchBase, { withFileTypes: true })
          .filter(d => d.isDirectory() && d.name.startsWith('app-'))
          .sort((a, b) => b.name.localeCompare(a.name, undefined, { numeric: true }));
        return dirs.map(d => path.join(itchBase, d.name, 'itch.exe'));
      } catch (_e) { return []; }
    }
    case 'xbox':
      return [
        path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WindowsApps', 'XboxApp.exe'),
      ];
    default:
      return [];
  }
}

const uniq = arr => Array.from(new Set(arr.filter(Boolean)));

function buildPlatformUris(game, action) {
  const platform = normalizePlatform(game.platform);
  const platformId = game.platformId ? String(game.platformId) : '';
  const storeUrl = game.storeUrl || '';
  const steamIdFromUrl = (() => {
    const m = String(storeUrl).match(/\/app\/(\d+)/i);
    return m ? m[1] : '';
  })();
  const steamId = platformId || steamIdFromUrl;
  const epicAppName = game.epicAppName || platformId;
  const epicNamespace = game.epicNamespace || '';
  const epicCatalogItemId = game.epicCatalogItemId || '';
  const eaOfferId = game.eaOfferId || platformId;
  const ubiGameId = game.ubisoftGameId || platformId;
  const gogId = platformId || (() => {
    const m = String(storeUrl).match(/\/openGameView\/(\d+)/i);
    return m ? m[1] : '';
  })();

  if (platform === 'steam' && steamId) {
    if (action === 'install') return uniq([`steam://install/${steamId}`, `steam://nav/games/details/${steamId}`, storeUrl]);
    if (action === 'client') return [`steam://open/games`, `steam://nav/library`];
    return uniq([`steam://rungameid/${steamId}`, `steam://nav/games/details/${steamId}`]);
  }

  if (platform === 'epic') {
    if (action === 'install') {
      return uniq([
        epicAppName ? `com.epicgames.launcher://apps/${epicAppName}?action=install&silent=true` : '',
        platformId ? `com.epicgames.launcher://apps/${platformId}?action=install&silent=true` : '',
        (epicNamespace && epicCatalogItemId) ? `com.epicgames.launcher://store/product/${epicNamespace}/${epicCatalogItemId}` : '',
        storeUrl,
      ]);
    }
    if (action === 'client') {
      return uniq([
        epicAppName ? `com.epicgames.launcher://apps/${epicAppName}` : '',
        platformId ? `com.epicgames.launcher://apps/${platformId}` : '',
        storeUrl,
      ]);
    }
    return uniq([
      epicAppName ? `com.epicgames.launcher://apps/${epicAppName}?action=launch&silent=true` : '',
      platformId ? `com.epicgames.launcher://apps/${platformId}?action=launch&silent=true` : '',
      storeUrl,
    ]);
  }

  if (platform === 'gog' && gogId) {
    if (action === 'install') return uniq([storeUrl, `goggalaxy://openGameView/${gogId}`]);
    return uniq([`goggalaxy://openGameView/${gogId}`, storeUrl]);
  }

  if (platform === 'ea') {
    if (eaOfferId) {
      if (action === 'install') return uniq([`origin2://store/open?offerId=${eaOfferId}`, `origin2://store/open?offerIds=${eaOfferId}`, storeUrl]);
      return uniq([`origin2://game/launch?offerIds=${eaOfferId}`, `origin2://library/open`, storeUrl]);
    }
    return ['origin2://library/open'];
  }

  if (platform === 'battlenet') {
    if (platformId) return [`battlenet://${platformId}`];
    return ['battlenet://'];
  }

  if (platform === 'ubisoft') {
    if (ubiGameId) {
      if (action === 'install') return uniq([`uplay://launch/${ubiGameId}/1`, storeUrl]);
      return uniq([`uplay://launch/${ubiGameId}/0`, storeUrl]);
    }
    return ['uplay://'];
  }

  if (platform === 'itchio') {
    if (storeUrl) return [storeUrl];
    return ['https://itch.io/my-purchases'];
  }

  if (platform === 'xbox') {
    if (action === 'install') return ['msxbox://', 'https://www.xbox.com/en-US/games'];
    if (action === 'client') return ['msxbox://'];
    return ['https://www.xbox.com/play'];
  }

  if (storeUrl) return [storeUrl];
  return [];
}

async function openInPlatformClient(game, action) {
  const uris = buildPlatformUris(game, action);
  let lastError = null;

  for (const uri of uris) {
    try {
      await shell.openExternal(uri);
      return { success: true, opened: uri };
    } catch (e) {
      lastError = e;
    }
  }

  const candidates = getLauncherExecutableCandidates(normalizePlatform(game.platform));
  for (const exe of candidates) {
    if (!exe || !fs.existsSync(exe)) continue;
    try {
      spawn(exe, [], { detached: true, stdio: 'ignore' }).unref();
      return { success: true, opened: exe };
    } catch (e) {
      lastError = e;
    }
  }

  return { success: false, error: (lastError && lastError.message) || 'Could not open platform client' };
}

module.exports = {
  normalizePlatform,
  openInPlatformClient,
};
