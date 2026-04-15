// ─── Platform Game Detection ──────────────────────────────────────────────────
// Pure scan functions for detecting installed games from various platforms.
// IPC handlers remain in main.js and call these functions.

const path = require('path');
const fs = require('fs');

// ─── Steam Root Resolution ───────────────────────────────────────────────────
function findSteamRoot() {
  const steamPaths = [
    path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Steam'),
    path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Steam'),
    path.join(process.env.HOME || process.env.USERPROFILE || '', 'Steam'),
  ];
  for (const p of steamPaths) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

// ─── Steam Game Detection ─────────────────────────────────────────────────────
function scanSteamInstalled() {
  const games = [];
  const steamRoot = findSteamRoot();
  if (!steamRoot) return { games: [], error: 'Steam not found' };

  // Read libraryfolders.vdf to find all library paths
  const libraryFolders = [path.join(steamRoot, 'steamapps')];
  const vdfPath = path.join(steamRoot, 'steamapps', 'libraryfolders.vdf');

  if (fs.existsSync(vdfPath)) {
    const vdfContent = fs.readFileSync(vdfPath, 'utf-8');
    for (const [, p] of vdfContent.matchAll(/"path"\s+"([^"]+)"/g)) {
      const appsDir = path.join(p.replace(/\\\\/g, '\\'), 'steamapps');
      if (fs.existsSync(appsDir) && !libraryFolders.includes(appsDir)) {
        libraryFolders.push(appsDir);
      }
    }
  }

  // Scan each library folder for .acf manifest files
  for (const libFolder of libraryFolders) {
    if (!fs.existsSync(libFolder)) continue;
    const files = fs.readdirSync(libFolder).filter(f => f.endsWith('.acf'));

    for (const file of files) {
      try {
        const content = fs.readFileSync(path.join(libFolder, file), 'utf-8');
        const appid = content.match(/"appid"\s+"(\d+)"/);
        const name = content.match(/"name"\s+"([^"]+)"/);
        const installdir = content.match(/"installdir"\s+"([^"]+)"/);

        if (appid && name && installdir) {
          const gamePath = path.join(libFolder, 'common', installdir[1]);
          games.push({
            name: name[1],
            platform: 'steam',
            platformId: appid[1],
            installPath: gamePath,
            executablePath: '', // User may need to set this
            coverUrl: `https://shared.steamstatic.com/store_item_assets/steam/apps/${appid[1]}/library_600x900_2x.jpg`,
            headerUrl: `https://shared.steamstatic.com/store_item_assets/steam/apps/${appid[1]}/library_hero.jpg`,
            categories: [],
            source: 'auto-detected',
            installed: true,
          });
        }
      } catch (_e) { /* skip bad manifest */ }
    }
  }

  return { games };
}

// ─── Epic Games Detection ─────────────────────────────────────────────────────
function scanEpicInstalled() {
  const games = [];
  try {
    const manifestDir = path.join(
      process.env.PROGRAMDATA || 'C:\\ProgramData',
      'Epic', 'EpicGamesLauncher', 'Data', 'Manifests'
    );
    if (!fs.existsSync(manifestDir)) return games;
    const files = fs.readdirSync(manifestDir).filter(f => f.endsWith('.item'));
    for (const file of files) {
      try {
        const content = JSON.parse(fs.readFileSync(path.join(manifestDir, file), 'utf-8'));
        if (content.DisplayName && content.InstallLocation) {
          games.push({
            name: content.DisplayName,
            platform: 'epic',
            platformId: content.CatalogNamespace || content.AppName,
            installPath: content.InstallLocation,
            executablePath: content.LaunchExecutable
              ? path.join(content.InstallLocation, content.LaunchExecutable) : '',
            coverUrl: '',
            categories: [],
            source: 'auto-detected',
            installed: true,
          });
        }
      } catch (_e) { /* skip bad manifest */ }
    }
  } catch (_e) { /* Epic not installed */ }
  return games;
}

// ─── GOG Detection ────────────────────────────────────────────────────────────
function scanGogInstalled() {
  const games = [];
  try {
    const gogGamesDir = 'C:\\GOG Games';
    const gogProgramFiles = path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'GOG Galaxy', 'Games');
    const dirsToScan = [gogGamesDir, gogProgramFiles].filter(d => { try { return fs.existsSync(d); } catch { return false; } });
    for (const dir of dirsToScan) {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const gameDir = path.join(dir, entry.name);
          const infoFiles = fs.readdirSync(gameDir).filter(f => f.startsWith('goggame-') && f.endsWith('.info'));
          for (const infoFile of infoFiles) {
            try {
              const info = JSON.parse(fs.readFileSync(path.join(gameDir, infoFile), 'utf-8'));
              if (info.name) {
                games.push({
                  name: info.name,
                  platform: 'gog',
                  platformId: info.gameId || '',
                  installPath: gameDir,
                  executablePath: info.playTasks?.[0]?.path
                    ? path.join(gameDir, info.playTasks[0].path) : '',
                  coverUrl: '',
                  categories: [],
                  source: 'auto-detected',
                  installed: true,
                });
              }
            } catch (_e) { /* skip */ }
          }
        }
      }
    }
  } catch (_e) { /* GOG not installed */ }
  return games;
}

// ─── Xbox Game Pass / Xbox App Detection ──────────────────────────────────────
function scanXboxInstalled() {
  const games = [];

  // Scan XboxGames directory (common custom install location)
  const xboxGamesDir = 'C:\\XboxGames';
  if (fs.existsSync(xboxGamesDir)) {
    const entries = fs.readdirSync(xboxGamesDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && entry.name !== 'Content') {
        games.push({
          name: entry.name.replace(/([A-Z])/g, ' $1').trim(), // CamelCase to spaces
          platform: 'xbox',
          platformId: '',
          installPath: path.join(xboxGamesDir, entry.name),
          executablePath: '',
          coverUrl: '',
          categories: [],
          source: 'auto-detected',
        });
      }
    }
  }

  // Check if Xbox app is installed for cloud gaming
  const xboxAppPaths = [
    path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WindowsApps', 'XboxApp.exe'),
    path.join(process.env.ProgramFiles || '', 'WindowsApps', 'Microsoft.GamingApp_*'),
  ];

  let xboxAppFound = false;
  for (const p of xboxAppPaths) {
    if (p.includes('*')) {
      const dir = path.dirname(p);
      const prefix = path.basename(p).replace('*', '');
      if (fs.existsSync(dir)) {
        const matches = fs.readdirSync(dir).filter(f => f.startsWith(prefix));
        if (matches.length > 0) xboxAppFound = true;
      }
    } else if (fs.existsSync(p)) {
      xboxAppFound = true;
    }
  }

  return { games, xboxAppFound, cloudGamingUrl: 'https://www.xbox.com/play' };
}

module.exports = {
  findSteamRoot,
  scanSteamInstalled,
  scanEpicInstalled,
  scanGogInstalled,
  scanXboxInstalled,
};
