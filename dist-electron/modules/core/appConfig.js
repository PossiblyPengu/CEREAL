// ─── App Settings & Env-var Configuration Overlay ───────────────────────────
// Mirrors the C# port's `appsettings.json` + IConfiguration model so a power-user
// can override OAuth client IDs/secrets without rebuilding the app.
//
// Resolution order (later wins):
//   1. Hard-coded defaults baked into providers/auth.js (CONFIG)
//   2. <cwd>/appsettings.json              ← dev only (repo root)
//   3. <folder-of-Cereal.exe>/appsettings.json  ← portable / install dir (packaged only)
//   4. <userData>/appsettings.json         ← survives upgrades; wins over 2–3
//   5. Environment variables (CEREAL_<PLATFORM>_<KEY>)
//
// We never throw on bad files — config overlays are best-effort, and a
// misconfigured override should never prevent the app from starting.

const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const log = require('./logger');

const ENV_PREFIX = 'CEREAL_';

// Platform → which CONFIG keys can be overridden. Whitelisting prevents an
// `appsettings.json` from accidentally rewriting `allowedDomains` etc.
//
// authUrl/tokenUrl are overridable so a power-user can swap out the default
// route — e.g. point Xbox at their own Azure AD app (login.microsoftonline.com)
// instead of the public login.live.com flow.
const OVERRIDABLE_KEYS = {
  steam: ['returnUrl', 'realm'],
  gog: ['clientId', 'clientSecret', 'redirectUri', 'authUrl', 'tokenUrl'],
  epic: ['clientId', 'clientSecret', 'redirectApiUrl', 'authUrl', 'tokenUrl'],
  xbox: ['clientId', 'redirectUri', 'scope', 'authUrl', 'tokenUrl'],
};

function readJsonSafe(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    const txt = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(txt);
  } catch (e) {
    log.warn('config', 'Could not parse', filePath, '-', e && e.message);
    return null;
  }
}

function camelCase(envSegment) {
  // CLIENT_ID -> clientId, CLIENT_SECRET -> clientSecret, REDIRECT_URI -> redirectUri.
  const parts = envSegment.toLowerCase().split('_').filter(Boolean);
  if (parts.length === 0) return '';
  return parts[0] + parts.slice(1).map(p => p.charAt(0).toUpperCase() + p.slice(1)).join('');
}

// Collect overrides from env vars matching CEREAL_<PLATFORM>_<KEY>.
// e.g. CEREAL_GOG_CLIENT_ID, CEREAL_EPIC_CLIENT_SECRET.
function readEnvOverrides() {
  const out = {};
  for (const [k, v] of Object.entries(process.env || {})) {
    if (!k.startsWith(ENV_PREFIX) || v == null || v === '') continue;
    const rest = k.slice(ENV_PREFIX.length);
    const sep = rest.indexOf('_');
    if (sep <= 0) continue;
    const platform = rest.slice(0, sep).toLowerCase();
    const fieldRaw = rest.slice(sep + 1);
    const field = camelCase(fieldRaw);
    if (!OVERRIDABLE_KEYS[platform] || !OVERRIDABLE_KEYS[platform].includes(field)) continue;
    out[platform] = out[platform] || {};
    out[platform][field] = v;
  }
  return out;
}

function readFileOverrides() {
  const candidates = [];
  // Lower priority first so the last entries win (userData should override cwd / portable file).
  try {
    if (!app?.isPackaged) {
      candidates.push(path.join(process.cwd(), 'appsettings.json'));
    }
  } catch (_e) { /* ignore */ }
  try {
    if (app?.isPackaged && process.execPath) {
      candidates.push(path.join(path.dirname(process.execPath), 'appsettings.json'));
    }
  } catch (_e) { /* ignore */ }
  try {
    if (app?.getPath) candidates.push(path.join(app.getPath('userData'), 'appsettings.json'));
  } catch (_e) { /* app not ready — fine, env-only */ }

  // Merge in order; later files win.
  const merged = {};
  for (const p of candidates) {
    const raw = readJsonSafe(p);
    if (!raw || typeof raw !== 'object') continue;
    const root = raw.OAuth || raw.oauth || raw;
    for (const [platform, vals] of Object.entries(root)) {
      const platformKey = String(platform).toLowerCase();
      if (!OVERRIDABLE_KEYS[platformKey] || !vals || typeof vals !== 'object') continue;
      merged[platformKey] = merged[platformKey] || {};
      for (const [field, value] of Object.entries(vals)) {
        if (!OVERRIDABLE_KEYS[platformKey].includes(field)) continue;
        if (typeof value !== 'string' || !value) continue;
        merged[platformKey][field] = value;
      }
    }
  }
  return merged;
}

let _applied = false;
let _summary = null;

/**
 * Apply config overlays to the OAuth CONFIG object exported from providers/auth.
 * Idempotent — calling more than once is a no-op.
 */
function applyOverrides(authConfig) {
  if (_applied || !authConfig) return _summary;
  _applied = true;
  _summary = { sources: [], applied: {} };

  const fileOv = readFileOverrides();
  const envOv = readEnvOverrides();
  const haveFile = Object.keys(fileOv).length > 0;
  const haveEnv = Object.keys(envOv).length > 0;
  if (!haveFile && !haveEnv) {
    log.info('config', 'OAuth: using built-in defaults (no appsettings.json or CEREAL_* env vars)');
    return _summary;
  }
  if (haveFile) _summary.sources.push('appsettings.json');
  if (haveEnv) _summary.sources.push('env');

  // env wins over file
  const merged = {};
  for (const platform of Object.keys(OVERRIDABLE_KEYS)) {
    merged[platform] = { ...(fileOv[platform] || {}), ...(envOv[platform] || {}) };
  }

  for (const [platform, fields] of Object.entries(merged)) {
    if (!authConfig[platform]) continue;
    for (const [field, value] of Object.entries(fields)) {
      authConfig[platform][field] = value;
      _summary.applied[platform] = _summary.applied[platform] || [];
      _summary.applied[platform].push(field);
    }
  }
  log.info('config', 'OAuth overrides applied:', JSON.stringify(_summary.applied));
  return _summary;
}

function getSummary() { return _summary; }

module.exports = { applyOverrides, getSummary, OVERRIDABLE_KEYS };
