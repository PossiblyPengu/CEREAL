const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');

// Resolve scripts directory - works in both dev and production.
// We deliberately do NOT fall back to `process.cwd()`; in a packaged Electron
// app cwd is wherever the user launched the EXE from (Start Menu, taskbar
// pin), not the install directory, so a cwd-relative `scripts/` lookup would
// occasionally hit unrelated folders.
function getScriptPath(scriptName) {
  const candidates = [
    // Production: resources/scripts (asar-unpacked)
    process.resourcesPath ? path.join(process.resourcesPath, 'scripts') : null,
    // Dev: electron/native/smtc/../../scripts
    path.join(__dirname, '..', '..', 'scripts'),
  ].filter(Boolean);

  for (const dir of candidates) {
    const fullPath = path.join(dir, scriptName);
    if (fs.existsSync(fullPath)) return fullPath;
  }

  // Return the most likely path even if not found — caller checks existence
  return path.join(candidates[0], scriptName);
}

const SCRIPT_PATH = getScriptPath('media-control.ps1');

function runPowerShell(action) {
  return new Promise((resolve, reject) => {
    const safeAction = String(action).replace(/[^a-zA-Z0-9_-]/g, '');
    const cmd = `powershell -ExecutionPolicy Bypass -File "${SCRIPT_PATH}" -Action ${safeAction}`;
    exec(cmd, { timeout: 5000 }, (error, stdout, stderr) => {
      if (error) {
        resolve({ playing: false, error: error.message });
        return;
      }
      try {
        const result = JSON.parse(stdout.trim());
        resolve(result);
      } catch {
        resolve({ playing: false });
      }
    });
  });
}

module.exports = {
  getMediaInfo: () => runPowerShell('getInfo'),
  sendMediaKey: (action) => runPowerShell(action)
};
