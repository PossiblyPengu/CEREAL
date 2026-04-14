// ─── Centralized path resolution for dev vs production builds ────────────────
// All Electron main process code should use these helpers to ensure paths
// work correctly in both development and packaged builds.

const path = require('path');
const fs = require('fs');
const { app } = require('electron');

/**
 * Get the root directory where scripts/, providers/, and resources/ are located.
 * In dev: electron/ folder
 * In production: resources/ folder (next to the app executable)
 */
function getResourcesRoot() {
  if (app?.isPackaged) {
    return process.resourcesPath;
  }
  // Development: go up from electron/modules/ to electron/
  return path.join(__dirname, '..');
}

/**
 * Get the path to a script in the scripts/ directory
 */
function getScriptPath(scriptName) {
  return path.join(getResourcesRoot(), 'scripts', scriptName);
}

/**
 * Get the path to the providers/ directory
 */
function getProvidersDir() {
  const candidates = [
    path.join(__dirname, '..', 'providers'),      // dev: electron/providers
    path.join(process.cwd(), 'electron', 'providers'), // fallback
  ];
  
  if (app?.isPackaged) {
    // In production, providers are in resources/
    candidates.unshift(path.join(process.resourcesPath, 'providers'));
  }
  
  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, 'index.js'))) {
      return candidate;
    }
  }
  throw new Error('Cannot find providers directory. Tried: ' + candidates.join(', '));
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

module.exports = {
  getResourcesRoot,
  getScriptPath,
  getProvidersDir,
  getResourcePath,
  requireProvider,
};
