// ─── Secure credential store using Electron's safeStorage ─────────────────────
const { safeStorage } = require('electron');
const { app } = require('electron');
const path = require('path');
const fs = require('fs');

const credStorePath = () => path.join(app.getPath('userData'), 'credentials.json');

let _credCache = null;

function loadCredStore() {
  if (_credCache) return _credCache;
  const target = credStorePath();
  for (const filePath of [target, target + '.bak']) {
    try {
      if (!fs.existsSync(filePath)) continue;
      _credCache = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      return _credCache;
    } catch { /* try backup */ }
  }
  _credCache = {};
  return _credCache;
}

function saveCredStore(store) {
  _credCache = store;
  const target = credStorePath();
  try { if (fs.existsSync(target)) fs.copyFileSync(target, target + '.bak'); } catch (_e) { /* best-effort backup */ }
  const tmp = target + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2), 'utf-8');
  fs.renameSync(tmp, target);
}

const safeStore = {
  setPassword(service, account, secret) {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Encryption not available');
    const store = loadCredStore();
    const key = `${service}/${account}`;
    store[key] = safeStorage.encryptString(secret).toString('base64');
    saveCredStore(store);
  },
  getPassword(service, account) {
    const store = loadCredStore();
    const key = `${service}/${account}`;
    if (!store[key]) return null;
    return safeStorage.decryptString(Buffer.from(store[key], 'base64'));
  },
  deletePassword(service, account) {
    const store = loadCredStore();
    const key = `${service}/${account}`;
    if (!store[key]) return false;
    delete store[key];
    saveCredStore(store);
    return true;
  }
};

module.exports = { safeStore };
