const fs = require('fs');
const path = require('path');
const { canonicalize, findExisting, makeGameEntry, updateAccountSync } = require('./utils');

const BNET_PRODUCTS = {
  'wow': { name: 'World of Warcraft', id: 'wow' },
  'wow_classic': { name: 'World of Warcraft Classic', id: 'wow_classic' },
  'wow_classic_era': { name: 'WoW Classic Era', id: 'wow_classic_era' },
  'd3': { name: 'Diablo III', id: 'd3' },
  'fenris': { name: 'Diablo IV', id: 'fenris' },
  'osi': { name: 'Diablo II: Resurrected', id: 'osi' },
  'pro': { name: 'Overwatch 2', id: 'pro' },
  'hero': { name: 'Heroes of the Storm', id: 'hero' },
  'hs_beta': { name: 'Hearthstone', id: 'hs_beta' },
  's1': { name: 'StarCraft: Remastered', id: 's1' },
  's2': { name: 'StarCraft II', id: 's2' },
  'w3': { name: 'Warcraft III: Reforged', id: 'w3' },
  'viper': { name: 'Call of Duty: Black Ops 6', id: 'viper' },
  'odin': { name: 'Call of Duty: Modern Warfare III', id: 'odin' },
  'zeus': { name: 'Call of Duty: Modern Warfare II', id: 'zeus' },
  'auks': { name: 'Call of Duty: MW Warzone', id: 'auks' },
  'lazr': { name: 'Call of Duty: Black Ops Cold War', id: 'lazr' },
  'fore': { name: 'Call of Duty: Vanguard', id: 'fore' },
  'wlby': { name: 'Crash Bandicoot 4', id: 'wlby' },
  'rtro': { name: 'Blizzard Arcade Collection', id: 'rtro' },
  'anbs': { name: 'Diablo Immortal', id: 'anbs' },
};

// ─── Detect ALL owned products from Battle.net Agent's product.db ────────────
function detectOwned() {
  const owned = [];
  try {
    const productDbPaths = [
      path.join(process.env.PROGRAMDATA || 'C:\\ProgramData', 'Battle.net', 'Agent', 'product.db'),
      path.join(process.env.PROGRAMDATA || 'C:\\ProgramData', 'Battle.net', 'Agent', 'data', 'product.db'),
    ];

    let productDbBuf = null;
    for (const p of productDbPaths) {
      if (fs.existsSync(p)) {
        try { productDbBuf = fs.readFileSync(p); break; } catch (e) {}
      }
    }

    if (productDbBuf) {
      // product.db is protobuf; scan the binary for known product code strings
      const text = productDbBuf.toString('latin1');
      for (const [code, product] of Object.entries(BNET_PRODUCTS)) {
        // Product codes appear as ASCII strings in the binary
        if (text.includes(code)) {
          owned.push({
            name: product.name,
            platform: 'battlenet',
            platformId: product.id,
            installPath: '',
            executablePath: '',
            coverUrl: '',
            categories: [],
            source: 'product-db',
            installed: false,
          });
        }
      }
    }
  } catch (e) { /* ignore */ }
  return owned;
}

function detectInstalled() {
  const games = [];
  try {
    const configPath = path.join(process.env.APPDATA || '', 'Battle.net', 'Battle.net.config');
    const configPath2 = path.join(process.env.PROGRAMDATA || 'C:\\ProgramData', 'Battle.net', 'Setup', 'battle.net.config');

    let config = null;
    for (const cp of [configPath, configPath2]) {
      if (fs.existsSync(cp)) {
        try { config = JSON.parse(fs.readFileSync(cp, 'utf-8')); break; } catch (e) {}
      }
    }

    if (config) {
      const installPaths = {};
      const sections = [config.Games, config.Installs, config.Client?.Install];
      for (const section of sections) {
        if (!section || typeof section !== 'object') continue;
        for (const [key, val] of Object.entries(section)) {
          const code = key.toLowerCase();
          const product = BNET_PRODUCTS[code];
          if (!product) continue;
          const installDir = typeof val === 'string' ? val : (val?.InstallPath || val?.Path || val?.install_path || '');
          if (installDir) installPaths[code] = installDir;
        }
      }

      for (const [code, installDir] of Object.entries(installPaths)) {
        const product = BNET_PRODUCTS[code];
        if (!product) continue;
        games.push({
          name: product.name, platform: 'battlenet', platformId: product.id,
          installPath: installDir, executablePath: '', coverUrl: '',
          categories: [], source: 'auto-detected', installed: true,
        });
      }
    }

    const gameDirs = [
      'C:\\Program Files (x86)\\Overwatch',
      'C:\\Program Files (x86)\\StarCraft II',
      'C:\\Program Files (x86)\\Hearthstone',
      'C:\\Program Files (x86)\\Heroes of the Storm',
      'C:\\Program Files (x86)\\Diablo III',
      'C:\\Program Files (x86)\\World of Warcraft',
      'C:\\Program Files (x86)\\Call of Duty',
    ];

    const seen = new Set(games.map(g => g.platformId));
    for (const dir of gameDirs) {
      if (!fs.existsSync(dir)) continue;
      const dirName = path.basename(dir);
      for (const [code, product] of Object.entries(BNET_PRODUCTS)) {
        if (seen.has(product.id)) continue;
        if (canonicalize(dirName).includes(canonicalize(product.name).split(' ')[0])) {
          seen.add(product.id);
          games.push({
            name: product.name, platform: 'battlenet', platformId: product.id,
            installPath: dir, executablePath: '', coverUrl: '',
            categories: [], source: 'auto-detected', installed: true,
          });
          break;
        }
      }
    }
  } catch (err) {
    return { games: [], error: err.message };
  }
  return { games };
}

function isAppInstalled() {
  const paths = [
    path.join(process.env.ProgramFiles || '', 'Battle.net', 'Battle.net.exe'),
    path.join(process.env['ProgramFiles(x86)'] || '', 'Battle.net', 'Battle.net.exe'),
    path.join(process.env.PROGRAMDATA || 'C:\\ProgramData', 'Battle.net', 'Setup', 'Battle.net-Setup.exe'),
  ];
  return paths.some(p => fs.existsSync(p));
}

async function importLibrary({ db, saveDB, notify }) {
  const detected = detectInstalled();
  const allGames = [...(detected.games || [])];
  const seen = new Set(allGames.map(g => g.platformId));

  // Merge in owned-but-not-installed games from product.db
  const ownedGames = detectOwned();
  for (const g of ownedGames) {
    if (seen.has(g.platformId)) continue;
    seen.add(g.platformId);
    allGames.push(g);
  }

  const imported = [];
  const updated = [];
  for (const g of allGames) {
    const existing = findExisting(db, 'battlenet', g.platformId, g.name);
    if (existing) {
      let changed = false;
      if (!existing.platformId && g.platformId) { existing.platformId = g.platformId; changed = true; }
      if (!existing.installPath && g.installPath) { existing.installPath = g.installPath; changed = true; }
      if (g.installed && !existing.installed) { existing.installed = true; changed = true; }
      if (changed) updated.push(existing.name);
    } else {
      db.games.push(makeGameEntry('battlenet', 'bnet', {
        platformId: g.platformId,
        name: g.name,
        extra: {
          installPath: g.installPath || '',
          executablePath: '',
          installed: g.installed || false,
        },
      }));
      imported.push(g.name);
    }
  }

  updateAccountSync(db, saveDB, 'battlenet', allGames.length);
  if (notify) notify({ status: 'done', processed: allGames.length, imported: imported.length, updated: updated.length });
  return { imported, updated, total: allGames.length, games: db.games };
}

module.exports = { detectInstalled, detectOwned, isAppInstalled, importLibrary, BNET_PRODUCTS };
