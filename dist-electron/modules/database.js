// ─── Database Setup ──────────────────────────────────────────────────────────
const { app } = require('electron');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(app ? app.getPath('userData') : '.', 'games.json');

function writeDBSync(data) {
  try { if (fs.existsSync(DB_PATH)) fs.copyFileSync(DB_PATH, DB_PATH + '.bak'); } catch (_e) { /* best-effort backup */ }
  const tmp = DB_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, DB_PATH);
}

let _saveDBTimer = null;
function saveDB(data) {
  clearTimeout(_saveDBTimer);
  _saveDBTimer = setTimeout(() => {
    _saveDBTimer = null;
    try { writeDBSync(data); }
    catch (e) { console.error('Failed to save DB:', e.message); }
  }, 150);
}

function flushDB(db) {
  if (_saveDBTimer) {
    clearTimeout(_saveDBTimer);
    _saveDBTimer = null;
    try { writeDBSync(db); }
    catch (e) { console.error('Failed to flush DB:', e.message); }
  }
}

function loadDB() {
  // Try primary file, then .bak fallback if primary is corrupt
  for (const filePath of [DB_PATH, DB_PATH + '.bak']) {
    try {
      if (!fs.existsSync(filePath)) continue;
      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      if (filePath !== DB_PATH) console.warn('[DB] Loaded from backup — primary was corrupt');
      // Purge PSN/psremote streaming bookmark entries — these are ephemeral session stubs,
      // not library games. Xbox games are imported via accounts:xbox:import and must persist.
      if (data.games) {
        const before = data.games.length;
        data.games = data.games.filter(g => g.platform !== 'psn' && g.platform !== 'psremote');
        if (data.games.length !== before) saveDB(data);
      }
      return data;
    } catch (e) {
      console.error('[DB] Failed to load', filePath, e.message);
    }
  }
  // Both failed or missing — start with empty library on first run
  const seed = {
    categories: ['Action', 'Adventure', 'RPG', 'Strategy', 'Puzzle', 'Simulation', 'Sports', 'FPS', 'Indie', 'Multiplayer'],
    playtime: {},
    games: []
  };
  saveDB(seed);
  return seed;
}

module.exports = { DB_PATH, loadDB, saveDB, flushDB, writeDBSync };
