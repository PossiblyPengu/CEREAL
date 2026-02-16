const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

function run(cmd, args, opts = {}) {
  const proc = spawnSync(cmd, args, Object.assign({ stdio: 'inherit', shell: false }, opts));
  return proc.status === 0;
}

function findCommand(cmd) {
  try {
    const which = process.platform === 'win32' ? 'where' : 'which';
    const w = spawnSync(which, [cmd], { stdio: 'pipe', encoding: 'utf8' });
    if (w.status === 0) {
      const out = w.stdout.split(/\r?\n/).filter(Boolean)[0];
      return out;
    }
  } catch (e) {}
  return null;
}

function runSetupChiaki() {
  // Prefer calling the PowerShell setup script. Try pwsh, then powershell.exe
  const scriptPath = path.join(__dirname, 'setup-chiaki.ps1');
  if (!fs.existsSync(scriptPath)) {
    console.warn('setup-chiaki.ps1 not found; skipping chiaki setup.');
    return true;
  }

  const pwsh = findCommand('pwsh');
  const powershell = findCommand('powershell');

  if (pwsh) {
    console.log('Running chiaki setup with pwsh...');
    return run(pwsh, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath]);
  }
  if (powershell) {
    console.log('Running chiaki setup with powershell...');
    return run(powershell, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath]);
  }

  console.warn('No PowerShell available to run setup-chiaki.ps1; skipping chiaki setup.');
  return false;
}

function runElectronBuilder() {
  const binName = process.platform === 'win32' ? 'electron-builder.cmd' : 'electron-builder';
  const binPath = path.join(process.cwd(), 'node_modules', '.bin', binName);
  if (fs.existsSync(binPath)) {
    console.log('Invoking local electron-builder:', binPath);
    return run(binPath, []);
  }
  console.log('Local electron-builder not found, trying global npx...');
  const npx = findCommand('npx');
  if (npx) {
    return run(npx, ['electron-builder']);
  }
  console.error('electron-builder not found locally and npx missing. Install dependencies (npm ci) and try again.');
  return false;
}

function main() {
  // Attempt to setup chiaki (best-effort)
  console.log('Attempting to set up chiaki (best-effort)');
  const ok = runSetupChiaki();
  if (!ok) {
    console.warn('Chiaki setup failed or was skipped; continuing to build.');
  }

  console.log('Building application with electron-builder...');
  const ok2 = runElectronBuilder();
  process.exit(ok2 ? 0 : 1);
}

main();
