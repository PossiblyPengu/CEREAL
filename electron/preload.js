const { contextBridge, ipcRenderer } = require('electron');

const ipcOn = (channel, cb) => {
  const handler = (_event, data) => cb(data);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};

contextBridge.exposeInMainWorld('api', {
  // Window controls
  minimize: () => ipcRenderer.invoke('window:minimize'),
  maximize: () => ipcRenderer.invoke('window:maximize'),
  close: () => ipcRenderer.invoke('window:close'),
  fullscreen: () => ipcRenderer.invoke('window:fullscreen'),
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
  isFullscreen: () => ipcRenderer.invoke('window:isFullscreen'),

  // Games
  getGames: () => ipcRenderer.invoke('games:getAll'),
  addGame: (game) => ipcRenderer.invoke('games:add', game),
  updateGame: (game) => ipcRenderer.invoke('games:update', game),
  fetchCoverNow: (gameId) => ipcRenderer.invoke('covers:fetchNow', gameId),
  deleteGame: (id) => ipcRenderer.invoke('games:delete', id),
  toggleFavorite: (id) => ipcRenderer.invoke('games:toggleFavorite', id),
  launchGame: (id) => ipcRenderer.invoke('games:launch', id),
  installGame: (id) => ipcRenderer.invoke('games:install', id),
  openGameInClient: (id) => ipcRenderer.invoke('games:openInClient', id),

  // Detection
  detectSteam: () => ipcRenderer.invoke('detect:steam'),
  detectEpic: () => ipcRenderer.invoke('detect:epic'),
  detectGOG: () => ipcRenderer.invoke('detect:gog'),
  detectPSRemote: () => ipcRenderer.invoke('detect:psremote'),
  detectXbox: () => ipcRenderer.invoke('detect:xbox'),
  detectEA: () => ipcRenderer.invoke('detect:ea'),
  detectBattleNet: () => ipcRenderer.invoke('detect:battlenet'),
  detectItchio: () => ipcRenderer.invoke('detect:itchio'),
  detectUbisoft: () => ipcRenderer.invoke('detect:ubisoft'),

  // chiaki-ng (PlayStation Remote Play)
  getChiakiStatus: () => ipcRenderer.invoke('chiaki:status'),
  chiakiCheckUpdate: () => ipcRenderer.invoke('chiaki:checkUpdate'),
  chiakiUpdate: (opts) => ipcRenderer.invoke('chiaki:update', opts),
  getChiakiConfig: () => ipcRenderer.invoke('chiaki:getConfig'),
  saveChiakiConfig: (config) => ipcRenderer.invoke('chiaki:saveConfig', config),
  setChiakiStream: (gameId, streamConfig) => ipcRenderer.invoke('games:setChiakiStream', gameId, streamConfig),

  // chiaki-ng deep integration
  chiakiStartStreamDirect: (opts) => ipcRenderer.invoke('chiaki:startStreamDirect', opts),
  chiakiStartStream: (gameId) => ipcRenderer.invoke('chiaki:startStream', gameId),
  chiakiStopStream: (gameId) => ipcRenderer.invoke('chiaki:stopStream', gameId),
  chiakiGetSessions: () => ipcRenderer.invoke('chiaki:getSessions'),
  chiakiOpenGui: () => ipcRenderer.invoke('chiaki:openGui'),
  chiakiRegisterConsole: (opts) => ipcRenderer.invoke('chiaki:registerConsole', opts),
  chiakiDiscoverConsoles: () => ipcRenderer.invoke('chiaki:discoverConsoles'),
  chiakiWakeConsole: (opts) => ipcRenderer.invoke('chiaki:wakeConsole', opts),
  chiakiSetStreamBounds: (opts) => ipcRenderer.invoke('chiaki:setStreamBounds', opts),

  // xCloud (Xbox Cloud Gaming)
  xcloudStartDirect: (url) => ipcRenderer.invoke('xcloud:startDirect', { url }),
  xcloudStart: (opts) => ipcRenderer.invoke('xcloud:start', opts),
  xcloudStop: (gameId) => ipcRenderer.invoke('xcloud:stop', gameId),
  xcloudGetSessions: () => ipcRenderer.invoke('xcloud:getSessions'),

  // Unified stream events (PS + Xbox)
  onChiakiEvent:  (cb) => ipcOn('chiaki:event',  cb),
  onChiakiInstallProgress: (cb) => ipcOn('chiaki:installProgress', cb),

  // Game list refresh (e.g. auto-created PS games from title detection)
  onGamesRefresh: (cb) => ipcOn('games:refresh', cb),

  // Dialogs
  pickExecutable: () => ipcRenderer.invoke('dialog:pickExecutable'),
  pickImage: () => ipcRenderer.invoke('dialog:pickImage'),
  pickFolder: () => ipcRenderer.invoke('dialog:pickFolder'),
  pickFile: (opts) => ipcRenderer.invoke('dialog:pickFile', opts),

  // Categories
  getCategories: () => ipcRenderer.invoke('games:getCategories'),
  addCategory: (cat) => ipcRenderer.invoke('categories:add', cat),
  removeCategory: (cat) => ipcRenderer.invoke('categories:remove', cat),

  // Metadata
  fetchMetadata: (gameId) => ipcRenderer.invoke('metadata:fetch', gameId),
  applyMetadata: (gameId, force) => ipcRenderer.invoke('metadata:apply', gameId, force),
  fetchAllMetadata: () => ipcRenderer.invoke('metadata:fetchAll'),
  searchArt: (gameName, platform) => ipcRenderer.invoke('metadata:searchArt', gameName, platform),
  fetchMetadataForName: (name, platform, platformId) => ipcRenderer.invoke('metadata:fetchForName', name, platform, platformId),
  steamGridDbLogin: () => ipcRenderer.invoke('steamgriddb:login'),
  readClipboard: () => ipcRenderer.invoke('clipboard:readText'),

  // Playtime
  syncPlaytime: () => ipcRenderer.invoke('playtime:sync'),

  // Platform Accounts
  getAccounts: () => ipcRenderer.invoke('accounts:get'),
  removeAccount: (platform) => ipcRenderer.invoke('accounts:remove', platform),
  platformAuth: (platform) => ipcRenderer.invoke(`accounts:${platform}:auth`),
  platformImport: (platform) => ipcRenderer.invoke(`accounts:${platform}:import`),

  // Import progress events (provider -> main -> renderer)
  onImportProgress:   (cb) => ipcOn('import:progress',   cb),
  onMetadataProgress: (cb) => ipcOn('metadata:progress', cb),
  onCoverProgress:    (cb) => ipcOn('cover:progress',    cb),

  // Settings
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (s) => ipcRenderer.invoke('settings:save', s),
  resetSettings: () => ipcRenderer.invoke('settings:reset'),
  exportLibrary: () => ipcRenderer.invoke('settings:exportLibrary'),
  importLibrary: () => ipcRenderer.invoke('settings:importLibrary'),
  clearAllGames: () => ipcRenderer.invoke('settings:clearAllGames'),
  clearCovers: () => ipcRenderer.invoke('settings:clearCovers'),
  getDataPath: () => ipcRenderer.invoke('settings:getDataPath'),
  getAppVersion: () => ipcRenderer.invoke('settings:getAppVersion'),
  // Auto-Update
  checkForUpdate: () => ipcRenderer.invoke('update:check'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  onUpdateEvent: (cb) => ipcOn('update:event', cb),

  // System media controls (SMTC)
  getMediaInfo: () => ipcRenderer.invoke('media:getInfo'),
  mediaControl: (action) => ipcRenderer.invoke('media:control', action),

  // Secure API key storage
  saveApiKey: (provider, apiKey) => ipcRenderer.invoke('keys:set', { service: `cereal-${provider}`, account: 'default', secret: apiKey }),
  getApiKeyInfo: (provider) => ipcRenderer.invoke('keys:get', { service: `cereal-${provider}`, account: 'default' }),
  deleteApiKey: (provider) => ipcRenderer.invoke('keys:delete', { service: `cereal-${provider}`, account: 'default' }),
  validateApiKey: (provider, apiKey) => ipcRenderer.invoke('keys:validate', { provider, apiKey }),
  validateStoredApiKey: (provider) => ipcRenderer.invoke('keys:validateStored', { provider, service: `cereal-${provider}`, account: 'default' }),
  getDiscordStatus: () => ipcRenderer.invoke('discord:status'),

  // Tab system
  onTabsOpened: (cb) => ipcOn('tabs:opened', cb),
  onTabsClosed: (cb) => ipcOn('tabs:closed', cb),

  // Signal to main process that the renderer has finished loading all data
  signalReady: () => ipcRenderer.send('window:ready'),
  // System specs
  getSystemSpecs: () => ipcRenderer.invoke('system:getSpecs'),
});
