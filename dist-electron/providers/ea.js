const fs = require('fs');
const path = require('path');
const { canonicalize, findExisting, makeGameEntry, updateAccountSync } = require('./utils');

const LAUNCHER_NAMES = new Set([
  'ea desktop',
  'ea app',
  'ea play app',
  'origin',
]);

function isLauncherTitle(name) {
  if (!name) return false;
  const normalized = name.trim().toLowerCase();
  if (!normalized) return false;
  if (LAUNCHER_NAMES.has(normalized)) return true;
  return normalized === 'ea desktop app' || normalized === 'ea app beta';
}

// ─── Detect ALL owned games from EA Desktop's local IS cache ─────────────────
function detectOwned() {
  const owned = [];
  try {
    const eaDesktopBase = path.join(process.env.LOCALAPPDATA || '', 'Electronic Arts', 'EA Desktop');
    if (!fs.existsSync(eaDesktopBase)) return owned;

    // IS cache is stored under a hashed subfolder
    const subDirs = fs.readdirSync(eaDesktopBase, { withFileTypes: true })
      .filter(d => d.isDirectory() && /^[a-f0-9]{20,}$/i.test(d.name));

    for (const sub of subDirs) {
      const isDir = path.join(eaDesktopBase, sub.name, 'IS');
      if (!fs.existsSync(isDir)) continue;

      const files = fs.readdirSync(isDir).filter(f => f.endsWith('.json'));
      for (const f of files) {
        try {
          const data = JSON.parse(fs.readFileSync(path.join(isDir, f), 'utf-8'));
          const title = data.displayName || data.baseSlug || data.offerId || '';
          if (!title || isLauncherTitle(title)) continue;
          owned.push({
            name: title,
            platform: 'ea',
            platformId: data.contentId || data.offerId || f.replace('.json', ''),
            installPath: data.baseInstallPath || '',
            executablePath: '',
            coverUrl: '',
            categories: [],
            source: 'is-cache',
            installed: !!(data.baseInstallPath && fs.existsSync(data.baseInstallPath)),
          });
        } catch (e) { /* skip bad file */ }
      }
    }
  } catch (e) { /* ignore */ }
  return owned;
}

function detectInstalled() {
  const games = [];
  try {
    const eaDataDirs = [
      path.join(process.env.PROGRAMDATA || 'C:\\ProgramData', 'EA Desktop', 'InstallData'),
      path.join(process.env.PROGRAMDATA || 'C:\\ProgramData', 'Origin', 'LocalContent'),
    ];

    const installDirs = [
      'C:\\Program Files\\EA Games',
      'C:\\Program Files (x86)\\EA Games',
      'C:\\Program Files\\Electronic Arts',
      'C:\\Program Files (x86)\\Electronic Arts',
      path.join(process.env.ProgramFiles || 'C:\\Program Files', 'EA Games'),
      path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Origin Games'),
    ];

    for (const dataDir of eaDataDirs) {
      if (!fs.existsSync(dataDir)) continue;
      const entries = fs.readdirSync(dataDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const installerDataPath = path.join(dataDir, entry.name, 'installerdata.xml');
        if (!fs.existsSync(installerDataPath)) continue;
        try {
          const xml = fs.readFileSync(installerDataPath, 'utf-8');
          const nameMatch = xml.match(/<gameTitle[^>]*>(.*?)<\/gameTitle>/i) ||
                           xml.match(/<title[^>]*>(.*?)<\/title>/i) ||
                           xml.match(/<name[^>]*>(.*?)<\/name>/i);
          const idMatch = xml.match(/<contentID[^>]*>(.*?)<\/contentID>/i) ||
                         xml.match(/<softwareID[^>]*>(.*?)<\/softwareID>/i);
          const pathMatch = xml.match(/<filePath[^>]*>(.*?)<\/filePath>/i) ||
                           xml.match(/<installDir[^>]*>(.*?)<\/installDir>/i);
          if (nameMatch) {
            const resolvedName = nameMatch[1].replace(/<!\[CDATA\[|\]\]>/g, '').trim();
            if (isLauncherTitle(resolvedName)) continue;
            games.push({
              name: resolvedName,
              platform: 'ea',
              platformId: idMatch ? idMatch[1].trim() : entry.name,
              installPath: pathMatch ? pathMatch[1].trim() : path.join(dataDir, entry.name),
              executablePath: '',
              coverUrl: '',
              categories: [],
              source: 'auto-detected',
              installed: true,
            });
          }
        } catch (e) { /* skip bad manifest */ }
      }
    }

    const seen = new Set(games.map(g => canonicalize(g.name)));
    for (const dir of installDirs) {
      if (!fs.existsSync(dir)) continue;
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isDirectory()) continue;
          const gameName = entry.name;
          if (isLauncherTitle(gameName)) continue;
          if (seen.has(canonicalize(gameName))) continue;
          seen.add(canonicalize(gameName));
          const gameDir = path.join(dir, gameName);
          let exe = '';
          try {
            const files = fs.readdirSync(gameDir);
            const exeFile = files.find(f => f.endsWith('.exe') && !/(unins|setup|redist|vcredist|dxsetup)/i.test(f));
            if (exeFile) exe = path.join(gameDir, exeFile);
          } catch (e) {}
          games.push({
            name: gameName,
            platform: 'ea',
            platformId: '',
            installPath: gameDir,
            executablePath: exe,
            coverUrl: '',
            categories: [],
            source: 'auto-detected',
            installed: true,
          });
        }
      } catch (e) {}
    }
  } catch (err) {
    return { games: [], error: err.message };
  }
  return { games };
}

function isAppInstalled() {
  const paths = [
    path.join(process.env.ProgramFiles || '', 'Electronic Arts', 'EA Desktop', 'EA Desktop', 'EADesktop.exe'),
    path.join(process.env['ProgramFiles(x86)'] || '', 'Origin', 'Origin.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Electronic Arts', 'EA Desktop', 'EA Desktop', 'EADesktop.exe'),
  ];
  return paths.some(p => fs.existsSync(p));
}

async function importLibrary({ db, saveDB, notify }) {
  const detected = detectInstalled();
  const allGames = [...(detected.games || [])];
  const seen = new Set(allGames.map(g => canonicalize(g.name)));

  // Merge in owned-but-not-installed games from IS cache
  const ownedGames = detectOwned();
  for (const g of ownedGames) {
    const canonical = canonicalize(g.name);
    if (seen.has(canonical)) continue;
    seen.add(canonical);
    allGames.push(g);
  }

  const imported = [];
  const updated = [];
  for (const g of allGames) {
    const existing = findExisting(db, 'ea', g.platformId, g.name);
    if (existing) {
      let changed = false;
      if (!existing.platformId && g.platformId) { existing.platformId = g.platformId; changed = true; }
      if (!existing.installPath && g.installPath) { existing.installPath = g.installPath; changed = true; }
      if (!existing.executablePath && g.executablePath) { existing.executablePath = g.executablePath; changed = true; }
      if (g.installed && !existing.installed) { existing.installed = true; changed = true; }
      if (changed) updated.push(existing.name);
    } else {
      db.games.push(makeGameEntry('ea', 'ea', {
        platformId: g.platformId,
        name: g.name,
        extra: {
          installPath: g.installPath || '',
          executablePath: g.executablePath || '',
          installed: g.installed || false,
        },
      }));
      imported.push(g.name);
    }
    if (notify && (allGames.indexOf(g) % 10 === 0)) notify({ status: 'progress', processed: allGames.indexOf(g) + 1, imported: imported.length, updated: updated.length });
  }

  updateAccountSync(db, saveDB, 'ea', allGames.length);
  if (notify) notify({ status: 'done', processed: allGames.length, imported: imported.length, updated: updated.length });
  return { imported, updated, total: allGames.length, games: db.games };
}

module.exports = { detectInstalled, detectOwned, isAppInstalled, importLibrary };
