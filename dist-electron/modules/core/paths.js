// ─── Centralized path resolution for dev vs production builds ────────────────
// All Electron main process code should use these helpers to ensure paths
// work correctly in both development and packaged builds.

const path = require('path');
const fs = require('fs');
const { app } = require('electron');

/**
 * Get the root directory where scripts/, providers/, and resources/ are located.
 * Packaged: Electron extraResources place scripts under resources/scripts (see electron-builder.yml).
 * Dev: prefer repo `electron/` when cwd is the project root; otherwise use the directory that
 * contains this bundle (`dist-electron/` when running `electron dist-electron/main.js`).
 */
function getResourcesRoot() {
  if (app?.isPackaged) {
    return process.resourcesPath;
  }
  const electronFromCwd = path.join(process.cwd(), 'electron');
  const cwdScripts = path.join(electronFromCwd, 'scripts', 'setup-chiaki.ps1');
  if (fs.existsSync(cwdScripts)) return electronFromCwd;
  const bundleScripts = path.join(__dirname, 'scripts', 'setup-chiaki.ps1');
  if (fs.existsSync(bundleScripts)) return __dirname;
  return electronFromCwd;
}

/**
 * Get the path to a script in the scripts/ directory
 */
function getScriptPath(scriptName) {
  return path.join(getResourcesRoot(), 'scripts', scriptName);
}

/**
 * Get the path to the providers/ directory (memoized — stable for the app lifetime)
 */
let _providersDir = null;
function getProvidersDir() {
  if (_providersDir) return _providersDir;
  // Providers are always emitted next to main.js (dev: dist-electron/providers, prod: inside app.asar).
  // `process.resourcesPath/providers` is wrong for default electron-builder (providers live in the asar).
  const candidates = [
    path.join(__dirname, 'providers'),
    path.join(process.cwd(), 'electron', 'providers'),
    path.join(process.cwd(), 'dist-electron', 'providers'),
  ];
  if (process.resourcesPath) {
    candidates.push(path.join(process.resourcesPath, 'providers'));
  }
  const seen = new Set();
  for (const candidate of candidates) {
    if (!candidate || seen.has(candidate)) continue;
    seen.add(candidate);
    if (fs.existsSync(path.join(candidate, 'index.js'))) {
      _providersDir = candidate;
      return _providersDir;
    }
  }
  throw new Error('Cannot find providers directory. Tried: ' + [...seen].join(', '));
}

/**
 * Get the path to a file in the resources/ directory (for bundled resources like chiaki-ng)
 */
function getResourcePath(resourceName) {
  return path.join(getResourcesRoot(), 'resources', resourceName);
}

/**
 * Require a module from the providers/ directory
 */
function requireProvider(moduleName) {
  return require(path.join(getProvidersDir(), moduleName));
}

// ─── Windows well-known directory helpers ───────────────────────────────────
// Centralized so the `'C:\\…'` fallback string only lives in one place. Each
// helper prefers the matching env var (set on every Windows install) and only
// uses the C:-drive default if the env var is missing — which is rare but does
// happen in stripped-down service contexts and on systems where the system
// drive isn't C:.
//
// On non-Windows platforms these still return paths but they will simply fail
// the subsequent fs.existsSync checks, which is the desired behavior for a
// Windows-only feature gate.

function programDataDir() {
  return process.env.PROGRAMDATA || 'C:\\ProgramData';
}
function programFilesDir() {
  return process.env.ProgramFiles || 'C:\\Program Files';
}
function programFilesX86Dir() {
  return process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
}
function localAppDataDir() {
  return process.env.LOCALAPPDATA || '';
}
function systemDriveDir() {
  // Used for things like XboxGames/ that live at the root of the OS drive.
  return process.env.SystemDrive || 'C:';
}

module.exports = {
  getResourcesRoot,
  getScriptPath,
  getProvidersDir,
  getResourcePath,
  requireProvider,
  programDataDir,
  programFilesDir,
  programFilesX86Dir,
  localAppDataDir,
  systemDriveDir,
};
