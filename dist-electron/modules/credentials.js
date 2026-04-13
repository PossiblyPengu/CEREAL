// ─── Secure credential store using Electron's safeStorage ─────────────────────
const { safeStorage } = require('electron');
const { app } = require('electron');
const path = require('path');
const fs = require('fs');

const credStorePath = () => path.join(app.getPath('userData'), 'credentials.json');

function loadCredStore() {
  try { return JSON.parse(fs.readFileSync(credStorePath(), 'utf-8')); } catch { return {}; }
}

function saveCredStore(store) {
  const target = credStorePath();
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
