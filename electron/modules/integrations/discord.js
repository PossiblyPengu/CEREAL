// ─── Discord Rich Presence ─────────────────────────────────────────────────────
const ctx = require('../core/context');
const log = require('../core/logger');

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
      log.info('discord', 'RPC ready');
    });
    discordRpc.login({ clientId: DISCORD_CLIENT_ID }).catch(err => {
      log.warn('discord', 'Could not connect:', err.message);
      discordRpc = null;
    });
  } catch (_e) {
    log.warn('discord', 'Init error:', _e.message);
    discordRpc = null;
  }
}

function disconnectDiscord() {
  if (discordRpc) {
    try { discordRpc.clearActivity(); } catch (_e) { /* best-effort */ }
    try { discordRpc.destroy(); } catch (_e) { /* best-effort */ }
    discordRpc = null;
    discordReady = false;
    discordCurrentGame = null;
  }
}

const PLATFORM_LABELS = {
  steam: 'Steam', epic: 'Epic Games', gog: 'GOG', psn: 'PlayStation',
  xbox: 'Xbox', custom: 'PC', psremote: 'PlayStation',
  battlenet: 'Battle.net', ea: 'EA App', ubisoft: 'Ubisoft Connect', itchio: 'itch.io',
};

// Only set smallImageKey for platforms that have a registered Discord asset.
// Sending an unknown key shows nothing in the client and may emit a warning.
const KNOWN_SMALL_IMAGE_KEYS = new Set([
  'steam', 'epic', 'gog', 'psn', 'xbox', 'custom',
  'battlenet', 'ea', 'ubisoft', 'itchio', 'psremote',
]);

function setDiscordPresence(gameName, platform, startTimestamp) {
  discordCurrentGame = { name: gameName, platform, startTimestamp: startTimestamp || Date.now() };
  if (!discordRpc || !discordReady) return;
  try {
    const activity = {
      details: gameName,
      state: 'via ' + (PLATFORM_LABELS[platform] || 'Cereal Launcher'),
      startTimestamp: discordCurrentGame.startTimestamp,
      largeImageKey: 'cereal_logo',
      largeImageText: 'Cereal Launcher',
      instance: false,
    };
    if (platform && KNOWN_SMALL_IMAGE_KEYS.has(platform)) {
      activity.smallImageKey = platform;
      activity.smallImageText = PLATFORM_LABELS[platform] || 'Game';
    }
    discordRpc.setActivity(activity);
  } catch (_e) { log.warn('discord', 'Presence error:', _e.message); }
}

function clearDiscordPresence() {
  discordCurrentGame = null;
  if (!discordRpc || !discordReady) return;
  try { discordRpc.clearActivity(); } catch (_e) { /* best-effort */ }
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
