const fs = require('fs');
const path = require('path');
const { canonicalize, findExisting, makeGameEntry, updateAccountSync } = require('./utils');

// ─── Detect ALL owned games from Ubisoft Connect's local cache ───────────────
function detectOwned() {
  const owned = [];
  try {
    const configDir = path.join(process.env.LOCALAPPDATA || '', 'Ubisoft Game Launcher');

    // 1. Read ownership.dat — contains owned game IDs (protobuf binary)
    const ownershipPath = path.join(configDir, 'ownership.dat');
    const ownedIds = new Set();
    if (fs.existsSync(ownershipPath)) {
      try {
        // ownership.dat is protobuf; game IDs appear as numeric strings in the binary
        const buf = fs.readFileSync(ownershipPath);
        const text = buf.toString('latin1');
        // Ubisoft game IDs are typically 1-5 digit numbers embedded in the binary
        const matches = text.match(/\b(\d{1,5})\b/g);
        if (matches) matches.forEach(id => ownedIds.add(id));
      } catch (e) {}
    }

    // 2. Read configurations directory for game metadata
    const configsDir = path.join(configDir, 'cache', 'configuration', 'configurations');
    if (fs.existsSync(configsDir)) {
      try {
        const files = fs.readdirSync(configsDir).filter(f => f.endsWith('.yml') || f.endsWith('.yaml'));
        for (const f of files) {
          try {
            const content = fs.readFileSync(path.join(configsDir, f), 'utf-8');
            const rootM = content.match(/^root:\s*(.+)/im);
            const nameM = content.match(/^name:\s*(.+)/im);
            const gameId = rootM ? rootM[1].trim().replace(/"/g, '') : f.replace(/\.(yml|yaml)$/i, '');
            const gameName = nameM ? nameM[1].trim().replace(/"/g, '') : '';
            if (!gameName) continue;
            // Only include if the game ID appears in ownership data, or if ownership data is empty (fallback)
            if (ownedIds.size > 0 && !ownedIds.has(gameId)) continue;
            owned.push({
              name: gameName,
              platform: 'ubisoft',
              platformId: gameId,
              installPath: '',
              executablePath: '',
              coverUrl: '',
              categories: [],
              source: 'config-cache',
              installed: false,
            });
          } catch (e) {}
        }
      } catch (e) {}
    }

    // 3. Fallback: scan the legacy game configs at <configDir>/games/installs/
    //    for ownership entries that may include non-installed titles
    const legacyOwnership = path.join(configDir, 'ownership');
    if (owned.length === 0 && fs.existsSync(legacyOwnership)) {
      try {
        const files = fs.readdirSync(legacyOwnership).filter(f => f.endsWith('.yml') || f.endsWith('.yaml') || f.endsWith('.json'));
        for (const f of files) {
          try {
            const content = fs.readFileSync(path.join(legacyOwnership, f), 'utf-8');
            const nameM = content.match(/name:\s*(.+)/i) || content.match(/"name"\s*:\s*"([^"]+)"/i);
            const gameId = f.replace(/\.(yml|yaml|json)$/i, '');
            if (nameM) {
              owned.push({
                name: nameM[1].trim().replace(/"/g, ''),
                platform: 'ubisoft',
                platformId: gameId,
                installPath: '',
                executablePath: '',
                coverUrl: '',
                categories: [],
                source: 'ownership-cache',
                installed: false,
              });
            }
          } catch (e) {}
        }
      } catch (e) {}
    }
  } catch (e) { /* ignore */ }
  return owned;
}

function detectInstalled() {
  const games = [];
  try {
    const ubiDirs = [
      path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Ubisoft', 'Ubisoft Game Launcher', 'games'),
      path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Ubisoft', 'Ubisoft Game Launcher', 'games'),
      'C:\\Program Files (x86)\\Ubisoft\\Ubisoft Game Launcher\\games',
      'C:\\Program Files\\Ubisoft\\Ubisoft Game Launcher\\games',
    ];

    const configDir = path.join(process.env.LOCALAPPDATA || '', 'Ubisoft Game Launcher');
    const settingsYaml = path.join(configDir, 'settings.yml');

    const extraPaths = [];
    if (fs.existsSync(settingsYaml)) {
      try {
        const yml = fs.readFileSync(settingsYaml, 'utf-8');
        const gamesPath = yml.match(/game_installation_path:\s*(.+)/i);
        if (gamesPath) extraPaths.push(gamesPath[1].trim().replace(/"/g, ''));
      } catch (e) {}
    }

    const allDirs = [...new Set([...ubiDirs, ...extraPaths])].filter(d => fs.existsSync(d));
    const seen = new Set();

    for (const dir of allDirs) {
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isDirectory()) continue;
          const gameName = entry.name;
          const canonical = canonicalize(gameName);
          if (seen.has(canonical)) continue;
          seen.add(canonical);

          const gameDir = path.join(dir, gameName);
          let exe = '';
          try {
            const files = fs.readdirSync(gameDir);
            const exeFile = files.find(f => f.endsWith('.exe') && !/(unins|setup|redist|vcredist|dxsetup|uplay|crash)/i.test(f));
            if (exeFile) exe = path.join(gameDir, exeFile);
          } catch (e) {}

          games.push({
            name: gameName, platform: 'ubisoft', platformId: '',
            installPath: gameDir, executablePath: exe, coverUrl: '',
            categories: [], source: 'auto-detected', installed: true,
          });
        }
      } catch (e) {}
    }

    const launcherInstalls = path.join(configDir, 'games', 'installs');
    if (fs.existsSync(launcherInstalls)) {
      try {
        const cfgFiles = fs.readdirSync(launcherInstalls).filter(f => f.endsWith('.yml') || f.endsWith('.yaml'));
        for (const cf of cfgFiles) {
          try {
            const content = fs.readFileSync(path.join(launcherInstalls, cf), 'utf-8');
            const nameM = content.match(/name:\s*(.+)/i);
            const pathM = content.match(/install_?path:\s*(.+)/i) || content.match(/root:\s*(.+)/i);
            const idM = cf.replace(/\.(yml|yaml)$/i, '');
            if (nameM) {
              const name = nameM[1].trim().replace(/"/g, '');
              if (!seen.has(canonicalize(name))) {
                seen.add(canonicalize(name));
                games.push({
                  name, platform: 'ubisoft', platformId: idM,
                  installPath: pathM ? pathM[1].trim().replace(/"/g, '') : '',
                  executablePath: '', coverUrl: '',
                  categories: [], source: 'auto-detected', installed: true,
                });
              }
            }
          } catch (e) {}
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
    path.join(process.env.ProgramFiles || '', 'Ubisoft', 'Ubisoft Game Launcher', 'UbisoftConnect.exe'),
    path.join(process.env['ProgramFiles(x86)'] || '', 'Ubisoft', 'Ubisoft Game Launcher', 'UbisoftConnect.exe'),
    path.join(process.env.ProgramFiles || '', 'Ubisoft', 'Ubisoft Game Launcher', 'Uplay.exe'),
    path.join(process.env['ProgramFiles(x86)'] || '', 'Ubisoft', 'Ubisoft Game Launcher', 'Uplay.exe'),
  ];
  return paths.some(p => fs.existsSync(p));
}

async function importLibrary({ db, saveDB, notify }) {
  const detected = detectInstalled();
  const allGames = [...(detected.games || [])];
  const seen = new Set(allGames.map(g => canonicalize(g.name)));

  // Merge in owned-but-not-installed games from config/ownership cache
  const ownedGames = detectOwned();
  for (const g of ownedGames) {
    const canonical = canonicalize(g.name);
    if (seen.has(canonical)) continue;
    seen.add(canonical);
    allGames.push(g);
  }

  const imported = [];
  const updated = [];
  let notifyIdx = 0;
  for (const g of allGames) {
    const existing = findExisting(db, 'ubisoft', g.platformId, g.name);
    if (existing) {
      let changed = false;
      if (!existing.platformId && g.platformId) { existing.platformId = g.platformId; changed = true; }
      if (!existing.installPath && g.installPath) { existing.installPath = g.installPath; changed = true; }
      if (!existing.executablePath && g.executablePath) { existing.executablePath = g.executablePath; changed = true; }
      if (g.installed && !existing.installed) { existing.installed = true; changed = true; }
      if (changed) updated.push(existing.name);
    } else {
      db.games.push(makeGameEntry('ubisoft', 'ubisoft', {
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
    notifyIdx++;
    if (notify && notifyIdx % 10 === 0) notify({ status: 'progress', processed: notifyIdx, imported: imported.length, updated: updated.length });
  }

  updateAccountSync(db, saveDB, 'ubisoft', allGames.length);
  if (notify) notify({ status: 'done', processed: allGames.length, imported: imported.length, updated: updated.length });
  return { imported, updated, total: allGames.length, games: db.games };
}

module.exports = { detectInstalled, detectOwned, isAppInstalled, importLibrary };
