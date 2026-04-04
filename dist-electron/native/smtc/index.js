const path = require('path');
const { exec } = require('child_process');

// Path is relative to dist-electron/native/ at runtime (smtc module lives at dist-electron/native/smtc/)
// In production, native files are asarUnpacked so we replace .asar with .asar.unpacked for exec()
const EXE_PATH = path.join(__dirname, '..', 'MediaInfoTool.exe').replace('app.asar', 'app.asar.unpacked');

function runExe(args) {
  return new Promise(resolve => {
    const safeArgs = (args || []).map(a => '"' + String(a).replace(/["%!^&|<>]/g, '') + '"').join(' ');
    exec('"' + EXE_PATH + '"' + (safeArgs ? ' ' + safeArgs : ''), { timeout: 5000 }, (err, stdout) => {
      try { resolve(JSON.parse(stdout.trim())); }
      catch { resolve({ error: err ? err.message : 'parse error' }); }
    });
  });
}

module.exports = {
  getMediaInfo: () => runExe(),
  sendMediaKey: (action) => runExe(['sendKey', action]),
};
