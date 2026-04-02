const { exec } = require('child_process');
const path = require('path');

// Go up 2 levels: native/smtc -> native -> project root
const SCRIPT_PATH = path.join(__dirname, '..', '..', 'scripts', 'media-control.ps1');

function runPowerShell(action) {
  return new Promise((resolve, reject) => {
    const cmd = `powershell -ExecutionPolicy Bypass -File "${SCRIPT_PATH}" -Action ${action}`;
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
