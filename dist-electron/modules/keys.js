// ─── Secure key storage and validation IPC handlers ──────────────────────────
const { ipcMain, dialog, shell, clipboard } = require('electron');
const crypto = require('crypto');
const path = require('path');
const ctx = require('./context');
const { ALLOWED_KEY_SERVICES } = require('./constants');
const { httpGetJson } = require('../providers/http');
const log = require('./logger');

function summarizeSecret(secret) {
  if (!secret) return { hasSecret: false, fingerprint: null };
  try {
    const fingerprint = crypto.createHash('sha256').update(secret).digest('hex').slice(0, 8);
    return { hasSecret: true, fingerprint };
  } catch (_e) {
    return { hasSecret: true, fingerprint: 'unknown' };
  }
}

async function validateProviderKey(provider, apiKey) {
  const providers = require(path.join(__dirname, '..', 'providers'));
  if (!apiKey) return { ok: false, provider, error: 'missing-key' };
  if (providers && providers[provider] && typeof providers[provider].validateKey === 'function') {
    try {
      const res = await providers[provider].validateKey(apiKey);
      return { ok: !!res.ok, provider, info: res.info, error: res.error };
    } catch (err) {
      return { ok: false, provider, error: err && err.message };
    }
  }

  if (provider === 'steam') {
    const url = `https://api.steampowered.com/ISteamWebAPIUtil/GetServerInfo/v1/?key=${encodeURIComponent(apiKey)}`;
    const res = await httpGetJson(url);
    if (res && res.status === 200 && res.data) {
      return { ok: true, provider: 'steam', info: res.data };
    }
    return { ok: false, provider: 'steam', error: res && (res.data || res.raw || 'Steam API error') };
  }

  return { ok: false, provider, error: 'unknown-provider' };
}

function registerKeysIpcHandlers() {
  ipcMain.handle('keys:set', async (_event, {service, account, secret}) => {
    if (!ALLOWED_KEY_SERVICES.includes(service)) return {ok: false, error: 'Unauthorized service: ' + service};
    try {
      ctx.safeStore.setPassword(service, account, secret);
      return {ok: true, ...summarizeSecret(secret)};
    } catch (err) {
      console.error('keys:set error', err);
      return {ok: false, error: err && err.message};
    }
  });

  ipcMain.handle('keys:get', async (_event, {service, account}) => {
    if (!ALLOWED_KEY_SERVICES.includes(service)) return {ok: false, error: 'Unauthorized service: ' + service};
    try {
      const secret = ctx.safeStore.getPassword(service, account);
      return {ok: true, ...summarizeSecret(secret)};
    } catch (err) {
      console.error('keys:get error', err);
      return {ok: false, error: err && err.message};
    }
  });

  ipcMain.handle('keys:delete', async (_event, {service, account}) => {
    if (!ALLOWED_KEY_SERVICES.includes(service)) return {ok: false, error: 'Unauthorized service: ' + service};
    try {
      const res = ctx.safeStore.deletePassword(service, account);
      return {ok: res};
    } catch (err) {
      console.error('keys:delete error', err);
      return {ok: false, error: err && err.message};
    }
  });

  ipcMain.handle('keys:validate', async (_event, {provider, apiKey}) => {
    try {
      return await validateProviderKey(provider, apiKey);
    } catch (err) {
      console.error('keys:validate error', err);
      return {ok: false, error: err && err.message};
    }
  });

  ipcMain.handle('keys:validateStored', async (_event, {provider, service, account}) => {
    if (!ALLOWED_KEY_SERVICES.includes(service)) return {ok: false, error: 'Unauthorized service: ' + service};
    try {
      const secret = ctx.safeStore.getPassword(service, account);
      if (!secret) return { ok: false, error: 'no-secret', provider };
      return await validateProviderKey(provider, secret);
    } catch (err) {
      console.error('keys:validateStored error', err);
      return { ok: false, error: err && err.message };
    }
  });

  ipcMain.handle('steamgriddb:login', async () => {
    try {
      await shell.openExternal('https://www.steamgriddb.com/profile/preferences/api');
      const { response } = await dialog.showMessageBox(ctx.mainWindow, {
        type: 'info',
        buttons: ['Paste API Key', 'Cancel'],
        defaultId: 0,
        message: 'SteamGridDB Login',
        detail: 'Copy your API key from the SteamGridDB page that opened, then click "Paste API Key".'
      });
      if (response !== 0) return { cancelled: true };
      const apiKey = clipboard.readText().trim();
      if (!apiKey) return { error: 'Clipboard is empty. Copy your SteamGridDB API key first, then try again.' };
      const vr = await validateProviderKey('steamgriddb', apiKey);
      if (!vr?.ok) return { error: 'API key appears invalid: ' + (vr?.error || 'unknown error') };
      ctx.safeStore.setPassword('cereal-steamgriddb', 'default', apiKey);
      return { ok: true, ...summarizeSecret(apiKey) };
    } catch (e) {
      return { error: e.message };
    }
  });

  ipcMain.handle('clipboard:readText', () => {
    try {
      return clipboard.readText();
    } catch (_e) {
      return '';
    }
  });
}

module.exports = { registerKeysIpcHandlers, validateProviderKey, summarizeSecret };
