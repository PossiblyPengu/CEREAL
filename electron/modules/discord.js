// ─── Discord Rich Presence ─────────────────────────────────────────────────────
const ctx = require('./context');

const DISCORD_CLIENT_ID = '1338877643523145789'; // Cereal Launcher app ID
let discordRpc = null;
let discordReady = false;
let discordCurrentGame = null;

function connectDiscord() {
  if (discordRpc) return;
  try {
    const DiscordRPC = require('discord-rpc');
    discordRpc = new DiscordRPC.Client({ transport: 'ipc' });
    discordRpc.on('ready', () => {
      discordReady = true;
      console.log('[Discord] RPC ready');
    });
    discordRpc.login({ clientId: DISCORD_CLIENT_ID }).catch(err => {
      console.log('[Discord] Could not connect:', err.message);
      discordRpc = null;
    });
  } catch (e) {
    console.log('[Discord] Init error:', e.message);
    discordRpc = null;
  }
}

function disconnectDiscord() {
  if (discordRpc) {
    try { discordRpc.clearActivity(); } catch(e) {}
    try { discordRpc.destroy(); } catch(e) {}
    discordRpc = null;
    discordReady = false;
    discordCurrentGame = null;
  }
}

const PLATFORM_LABELS = {
  steam: 'Steam', epic: 'Epic Games', gog: 'GOG', psn: 'PlayStation',
  xbox: 'Xbox', custom: 'PC', psremote: 'PlayStation'
};

function setDiscordPresence(gameName, platform, startTimestamp) {
  discordCurrentGame = { name: gameName, platform, startTimestamp: startTimestamp || Date.now() };
  if (!discordRpc || !discordReady) return;
  try {
    discordRpc.setActivity({
      details: gameName,
      state: 'via ' + (PLATFORM_LABELS[platform] || 'Cereal Launcher'),
      startTimestamp: discordCurrentGame.startTimestamp,
      largeImageKey: 'cereal_logo',
      largeImageText: 'Cereal Launcher',
      smallImageKey: platform || 'custom',
      smallImageText: PLATFORM_LABELS[platform] || 'Game',
      instance: false,
    });
  } catch (e) { console.log('[Discord] Presence error:', e.message); }
}

function clearDiscordPresence() {
  discordCurrentGame = null;
  if (!discordRpc || !discordReady) return;
  try { discordRpc.clearActivity(); } catch(e) {}
}

function isDiscordEnabled() {
  return !!(ctx.db && ctx.db.settings && ctx.db.settings.discordPresence);
}

function getDiscordStatus() {
  return { ready: discordReady, connected: !!discordRpc };
}

module.exports = {
  connectDiscord,
  disconnectDiscord,
  setDiscordPresence,
  clearDiscordPresence,
  isDiscordEnabled,
  getDiscordStatus,
};
