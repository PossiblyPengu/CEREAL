const path = require('path');
const { spawn, spawnSync } = require('child_process');

// Path is relative to dist-electron/native/ at runtime (smtc module lives at dist-electron/native/smtc/)
// In production, native files are asarUnpacked so we replace .asar with .asar.unpacked for exec()/spawn()
const EXE_PATH = path.join(__dirname, '..', 'MediaInfoTool.exe').replace('app.asar', 'app.asar.unpacked');

const children = new Set();

function runExe(args) {
  return new Promise(resolve => {
    const argv = args || [];
    let child;
    try {
      child = spawn(EXE_PATH, argv, { windowsHide: true });
    } catch (e) {
      return resolve({ error: (e && e.message) || 'spawn failed' });
    }

    children.add(child);
    let stdout = '';
    let stderr = '';

    if (child.stdout) child.stdout.on('data', d => { stdout += d.toString(); });
    if (child.stderr) child.stderr.on('data', d => { stderr += d.toString(); });

    let finished = false;
    const finish = (res) => {
      if (finished) return;
      finished = true;
      children.delete(child);
      try { child.kill(); } catch (_e) { /* ignore */ }
      resolve(res);
    };

    const timeout = setTimeout(() => {
      try { child.kill(); } catch (_e) { /* ignore */ }
      // give taskkill a chance
      try { spawnSync('taskkill', ['/PID', String(child.pid), '/F'], { stdio: 'ignore' }); } catch (_e) { /* ignore */ }
      finish({ error: 'timeout' });
    }, 5000);

    child.on('error', (err) => {
      clearTimeout(timeout);
      finish({ error: err && err.message ? err.message : 'child error' });
    });

    child.on('close', (code) => {
      clearTimeout(timeout);
      const out = (stdout || '').trim();
      if (!out) {
        finish({ error: stderr.trim() || ('exit:' + code) });
        return;
      }
      try {
        finish(JSON.parse(out));
      } catch (e) {
        finish({ error: e && e.message ? e.message : 'parse error' });
      }
    });
  });
}

function cleanup() {
  for (const ch of Array.from(children)) {
    try { ch.kill(); } catch (_e) { /* ignore */ }
    try { spawnSync('taskkill', ['/PID', String(ch.pid), '/F'], { stdio: 'ignore' }); } catch (_e) { /* ignore */ }
    children.delete(ch);
  }
}

module.exports = {
  getMediaInfo: () => runExe(),
  sendMediaKey: (action) => runExe(['sendKey', action]),
  cleanup,
};

// Ensure child processes are cleaned up on unexpected exits
try {
  process.on('exit', () => { try { cleanup(); } catch (_e) {} });
  process.on('SIGINT', () => { try { cleanup(); } catch (_e) {} });
  process.on('SIGTERM', () => { try { cleanup(); } catch (_e) {} });
} catch (_e) { /* ignore - defensive */ }
