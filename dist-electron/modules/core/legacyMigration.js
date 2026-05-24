// ─── Legacy credential / account-token migration ────────────────────────────
// Mirrors the C# port's `MigrateLegacySecrets()` helper. Runs once on startup
// (idempotent), is best-effort, and never throws — a migration failure must
// not block the app.
//
// What we look for, in order:
//   1. Old `keytar`-style entries in <userData>/credentials.json that used a
//      different service prefix (`cereal:steam` etc.) instead of the current
//      `cereal-steam` form.
//   2. Older XSTS / MS-token alias fields that lived directly on the account
//      record before the secret/non-secret split was introduced.
//
// Successful migrations leave a marker in <userData>/.migrations.json so we
// don't keep re-scanning every launch.

const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const log = require('./logger');

const MARKER_FILE = () => path.join(app.getPath('userData'), '.migrations.json');
const CRED_FILE = () => path.join(app.getPath('userData'), 'credentials.json');
const MIGRATION_VERSION = 1;

// Old → new keytar service prefixes that may live in legacy credentials.json
// payloads written by builds prior to the safeStore consolidation.
const LEGACY_SERVICE_ALIASES = [
  ['cereal:steamgriddb', 'cereal-steamgriddb'],
  ['cereal:steam',       'cereal-steam'],
  ['cereal:itchio',      'cereal-itchio'],
  ['cereal-account:steam',     'cereal-account-steam'],
  ['cereal-account:gog',       'cereal-account-gog'],
  ['cereal-account:epic',      'cereal-account-epic'],
  ['cereal-account:xbox',      'cereal-account-xbox'],
  ['cereal-account:battlenet', 'cereal-account-battlenet'],
  ['cereal-account:ea',        'cereal-account-ea'],
  ['cereal-account:itchio',    'cereal-account-itchio'],
  ['cereal-account:ubisoft',   'cereal-account-ubisoft'],
];

// Pre-split alias fields that may still live on db.accounts[*]. The current
// code reads/writes via `safeStore` and detaches secrets on load, but a stale
// db file from an older build can still hold these inline. We pull them out
// and re-store via the secret store.
const LEGACY_ACCOUNT_FIELDS = {
  xbox: ['xstsTokenLegacy', 'xboxLiveToken'], // older field aliases for xstsToken
};

function readMarker() {
  try {
    const p = MARKER_FILE();
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch (_e) { return null; }
}
function writeMarker(data) {
  try {
    const p = MARKER_FILE();
    fs.writeFileSync(p, JSON.stringify(data, null, 2));
  } catch (e) { log.warn('migration', 'Could not write marker:', e && e.message); }
}

function migrateCredentialAliases() {
  let migrated = 0;
  try {
    const credPath = CRED_FILE();
    if (!fs.existsSync(credPath)) return 0;
    const raw = fs.readFileSync(credPath, 'utf-8');
    let store;
    try { store = JSON.parse(raw); } catch (_e) { return 0; }
    if (!store || typeof store !== 'object') return 0;

    let changed = false;
    for (const [oldPrefix, newPrefix] of LEGACY_SERVICE_ALIASES) {
      for (const key of Object.keys(store)) {
        // keytar-style keys looked like `<service>/<account>` — same as ours,
        // just with a different service-prefix punctuation.
        if (!key.startsWith(oldPrefix + '/')) continue;
        const newKey = newPrefix + key.slice(oldPrefix.length);
        if (store[newKey]) {
          // Newer entry already exists — drop the legacy duplicate.
          delete store[key];
          changed = true;
          continue;
        }
        store[newKey] = store[key];
        delete store[key];
        migrated++;
        changed = true;
      }
    }
    if (changed) {
      const tmp = credPath + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(store, null, 2));
      fs.renameSync(tmp, credPath);
    }
  } catch (e) {
    log.warn('migration', 'cred-alias migration failed:', e && e.message);
  }
  return migrated;
}

function migrateLegacyAccountFields(db, safeStore) {
  if (!db || !db.accounts) return 0;
  let migrated = 0;
  for (const [platform, aliases] of Object.entries(LEGACY_ACCOUNT_FIELDS)) {
    const acct = db.accounts[platform];
    if (!acct || typeof acct !== 'object') continue;
    const service = `cereal-account-${platform}`;
    let storeRaw;
    try { storeRaw = safeStore.getPassword(service, 'tokens'); } catch (_e) { storeRaw = null; }
    let secrets = {};
    try { if (storeRaw) secrets = JSON.parse(storeRaw); } catch (_e) { secrets = {}; }
    for (const aliasField of aliases) {
      if (acct[aliasField] == null) continue;
      // Aliases all map to xstsToken in the unified schema today.
      if (!secrets.xstsToken) secrets.xstsToken = acct[aliasField];
      delete acct[aliasField];
      migrated++;
    }
    if (migrated > 0) {
      try { safeStore.setPassword(service, 'tokens', JSON.stringify(secrets)); }
      catch (e) { log.warn('migration', 'Could not re-store secrets for', platform, e && e.message); }
      acct.hasCredentials = !!Object.keys(secrets).length;
    }
  }
  return migrated;
}

/**
 * Run all pending migrations. Pass the in-memory db and the safeStore so we
 * can rewrite both. Returns a summary object for logging/diagnostics.
 */
function runMigrations({ db, safeStore } = {}) {
  const marker = readMarker() || {};
  if (Number(marker.version) >= MIGRATION_VERSION) {
    return { skipped: true, version: marker.version };
  }
  const summary = { version: MIGRATION_VERSION, ranAt: new Date().toISOString(), credAliases: 0, accountFields: 0 };
  summary.credAliases = migrateCredentialAliases();
  if (db && safeStore) summary.accountFields = migrateLegacyAccountFields(db, safeStore);
  writeMarker({ ...marker, version: MIGRATION_VERSION, last: summary });
  if (summary.credAliases || summary.accountFields) {
    log.info('migration', 'Legacy migrations complete:', JSON.stringify(summary));
  }
  return summary;
}

module.exports = { runMigrations, MIGRATION_VERSION };
