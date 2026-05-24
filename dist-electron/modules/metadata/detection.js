// ─── Platform Game Detection ──────────────────────────────────────────────────
// Pure scan functions for detecting installed games from various platforms.
// IPC handlers remain in main.js and call these functions.

const path = require('path');
const fs = require('fs');
const ctx = require('../core/context');
const {
  programDataDir,
  programFilesDir,
  programFilesX86Dir,
  localAppDataDir,
  systemDriveDir,
} = require('../core/paths');

// User-supplied path overrides from db.settings, applied first so a user who
// installed Steam/Epic/GOG/Xbox to a non-default drive can point us at it.
function userPathOverride(field) {
  try {
    const v = ctx?.db?.settings?.[field];
    return (typeof v === 'string' && v.trim()) ? v.trim() : null;
  } catch (_e) { return null; }
}

// ─── Steam Root Resolution ───────────────────────────────────────────────────
function findSteamRoot() {
  const override = userPathOverride('steamPath');
  const steamPaths = [
    override,
    path.join(programFilesX86Dir(), 'Steam'),
    path.join(programFilesDir(), 'Steam'),
    path.join(process.env.HOME || process.env.USERPROFILE || '', 'Steam'),
  ].filter(Boolean);
  for (const p of steamPaths) {
    try { if (fs.existsSync(p)) return p; } catch (_e) { /* ignore */ }
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
    // The user can point `epicPath` at the Epic install root (e.g.
    // `D:\Epic Games`) OR at the manifests directory directly. Try the
    // override as a manifests-dir first, then as an install root.
    const override = userPathOverride('epicPath');
    const candidates = [];
    if (override) {
      candidates.push(override);
      candidates.push(path.join(override, 'Data', 'Manifests'));
      candidates.push(path.join(override, 'Manifests'));
    }
    candidates.push(path.join(programDataDir(), 'Epic', 'EpicGamesLauncher', 'Data', 'Manifests'));

    let manifestDir = null;
    for (const c of candidates) {
      try { if (c && fs.existsSync(c) && fs.statSync(c).isDirectory()) { manifestDir = c; break; } }
      catch (_e) { /* ignore */ }
    }
    if (!manifestDir) return games;
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
    const override = userPathOverride('gogPath');
    const dirsToScan = [
      override,
      path.join(systemDriveDir(), 'GOG Games'), // matches the GOG Galaxy default
      path.join(programFilesX86Dir(), 'GOG Galaxy', 'Games'),
      path.join(programFilesDir(), 'GOG Galaxy', 'Games'),
    ].filter(Boolean).filter(d => { try { return fs.existsSync(d); } catch { return false; } });
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

  // Honor the user's `xboxPath` override (set in Settings ▸ System ▸ Platform
  // Paths) for users who relocated their install drive in the Xbox app's
  // "Change where new things install" dialog. Otherwise fall back to the
  // system-drive default.
  const override = userPathOverride('xboxPath');
  const xboxGamesCandidates = [
    override,
    path.join(systemDriveDir(), 'XboxGames'),
  ].filter(Boolean);

  for (const xboxGamesDir of xboxGamesCandidates) {
    let entries;
    try { entries = fs.existsSync(xboxGamesDir) ? fs.readdirSync(xboxGamesDir, { withFileTypes: true }) : null; }
    catch (_e) { continue; }
    if (!entries) continue;
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
    // If we successfully read one of the candidates, prefer those results and
    // don't keep scanning lower-priority paths (avoids duplicates if the user
    // happens to keep both the override and the C: default populated).
    break;
  }

  // Check if Xbox app is installed for cloud gaming
  const xboxAppPaths = [
    path.join(localAppDataDir(), 'Microsoft', 'WindowsApps', 'XboxApp.exe'),
    path.join(programFilesDir(), 'WindowsApps', 'Microsoft.GamingApp_*'),
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
