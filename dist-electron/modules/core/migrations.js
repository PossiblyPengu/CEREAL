// ─── Versioned schema migrations for the JSON game database ──────────────────
// This is the JSON-store equivalent of the C# port's EF-style migration list.
// Each entry has:
//   - version: integer, must be unique and strictly increasing
//   - name:    short slug for logs
//   - apply:   ({ db, deps }) => void — mutates db in place
//
// The runner:
//   1. Reads `db.settings._migrationVersion` (defaults to 0).
//   2. Backs up <userData>/games.json → games.json.pre-migrate.<v>.bak before
//      applying any pending migration (one backup per upgrade hop).
//   3. Applies each pending migration in order, persisting the new version
//      number after EACH success so a crash mid-stream resumes from the right
//      place instead of replaying completed work.
//   4. Returns a summary { from, to, ran:[{version, name, ok, error?}] }.
//
// `deps` lets migrations pull side-effecting helpers (e.g. cleanupFile,
// getCoversDir) without dragging this module into a dependency cycle.

const fs = require('fs');
const path = require('path');
const log = require('./logger');

const MIGRATIONS = [
  {
    version: 1,
    name: 'clear-corrupt-cover-refs',
    apply: ({ db, deps }) => {
      let cleaned = 0;
      for (const game of (db.games || [])) {
        for (const field of ['localCoverPath', 'localHeaderPath']) {
          const p = game[field];
          if (!p) continue;
          try {
            if (!fs.existsSync(p) || fs.statSync(p).size < 1024) {
              deps.cleanupFile?.(p);
              game[field] = null;
              cleaned++;
            }
          } catch (_e) { game[field] = null; cleaned++; }
        }
      }
      // Purge small corrupt files from covers directory (orphans).
      try {
        const dir = deps.getCoversDir?.();
        if (dir) {
          let purged = 0;
          for (const f of fs.readdirSync(dir)) {
            const fp = path.join(dir, f);
            try { if (fs.statSync(fp).size < 1024) { fs.unlinkSync(fp); purged++; } } catch { /* ignore */ }
          }
          if (purged > 0) log.info('migrations', `v1: purged ${purged} corrupt cover orphans`);
        }
      } catch (_e) { /* ignore */ }
      if (cleaned > 0) log.info('migrations', `v1: cleared ${cleaned} corrupt cover refs`);
    },
  },
  {
    version: 2,
    name: 'backfill-steam-headers',
    apply: ({ db }) => {
      let backfilled = 0;
      for (const game of (db.games || [])) {
        if (game.platform === 'steam' && game.platformId && !game.headerUrl) {
          game.headerUrl = `https://shared.steamstatic.com/store_item_assets/steam/apps/${game.platformId}/header.jpg`;
          backfilled++;
        }
      }
      if (backfilled > 0) log.info('migrations', `v2: backfilled ${backfilled} Steam header URLs`);
    },
  },
  {
    version: 3,
    name: 'normalize-toolbar-position',
    apply: ({ db }) => {
      // Earlier builds wrote toolbar position only as `toolbarPosition`. The
      // CS port + recent settings.js add `navPosition` as the canonical key;
      // mirror values so both stay in sync for old DBs.
      db.settings = db.settings || {};
      if (db.settings.toolbarPosition && !db.settings.navPosition) {
        db.settings.navPosition = db.settings.toolbarPosition;
      } else if (db.settings.navPosition && !db.settings.toolbarPosition) {
        db.settings.toolbarPosition = db.settings.navPosition;
      }
    },
  },
];

const CURRENT_VERSION = MIGRATIONS.reduce((m, x) => Math.max(m, x.version), 0);

function getCurrentVersion(db) {
  return Number((db && db.settings && db.settings._migrationVersion) || 0);
}

function backupBefore(filePath, version) {
  if (!filePath || !fs.existsSync(filePath)) return;
  const dest = filePath + '.pre-migrate.v' + version + '.bak';
  try { fs.copyFileSync(filePath, dest); }
  catch (e) { log.warn('migrations', 'pre-migrate backup failed:', e && e.message); }
}

/**
 * Run all pending migrations on `db`. Persists incrementally via `saveDB`
 * after each success. Returns a summary object.
 */
function runMigrations({ db, saveDB, dbPath, deps = {} } = {}) {
  if (!db) return { skipped: 'no-db' };
  const from = getCurrentVersion(db);
  if (from >= CURRENT_VERSION) return { skipped: 'up-to-date', from, to: CURRENT_VERSION };

  const pending = MIGRATIONS
    .filter(m => m.version > from)
    .sort((a, b) => a.version - b.version);

  if (pending.length > 0 && dbPath) backupBefore(dbPath, from);

  const ran = [];
  for (const m of pending) {
    try {
      m.apply({ db, deps });
      db.settings = db.settings || {};
      db.settings._migrationVersion = m.version;
      // Persist after each step so a crash resumes from the right place.
      try { saveDB?.(db); } catch (e) { log.warn('migrations', 'saveDB after v' + m.version + ' failed:', e && e.message); }
      ran.push({ version: m.version, name: m.name, ok: true });
      log.info('migrations', `applied v${m.version} (${m.name})`);
    } catch (e) {
      log.error('migrations', `v${m.version} (${m.name}) failed:`, e && e.message);
      ran.push({ version: m.version, name: m.name, ok: false, error: e && e.message });
      break;
    }
  }
  return { from, to: getCurrentVersion(db), ran };
}

module.exports = { runMigrations, CURRENT_VERSION, MIGRATIONS };
