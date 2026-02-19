const { contextBridge, ipcRenderer } = require('electron');

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

  // Detection
  detectSteam: () => ipcRenderer.invoke('detect:steam'),
  detectEpic: () => ipcRenderer.invoke('detect:epic'),
  detectGOG: () => ipcRenderer.invoke('detect:gog'),
  detectPSRemote: () => ipcRenderer.invoke('detect:psremote'),
  detectXbox: () => ipcRenderer.invoke('detect:xbox'),

  // chiaki-ng (PlayStation Remote Play)
  getChiakiStatus: () => ipcRenderer.invoke('chiaki:status'),
  getChiakiConfig: () => ipcRenderer.invoke('chiaki:getConfig'),
  saveChiakiConfig: (config) => ipcRenderer.invoke('chiaki:saveConfig', config),
  setChiakiStream: (gameId, streamConfig) => ipcRenderer.invoke('games:setChiakiStream', gameId, streamConfig),

  // chiaki-ng deep integration
  chiakiStartStream: (gameId) => ipcRenderer.invoke('chiaki:startStream', gameId),
  chiakiStopStream: (gameId) => ipcRenderer.invoke('chiaki:stopStream', gameId),
  chiakiGetSessions: () => ipcRenderer.invoke('chiaki:getSessions'),
  chiakiOpenGui: () => ipcRenderer.invoke('chiaki:openGui'),
  chiakiRegisterConsole: (opts) => ipcRenderer.invoke('chiaki:registerConsole', opts),
  chiakiDiscoverConsoles: () => ipcRenderer.invoke('chiaki:discoverConsoles'),
  chiakiSetStreamBounds: (opts) => ipcRenderer.invoke('chiaki:setStreamBounds', opts),

  // xCloud (Xbox Cloud Gaming)
  xcloudStart: (opts) => ipcRenderer.invoke('xcloud:start', opts),
  xcloudStop: (gameId) => ipcRenderer.invoke('xcloud:stop', gameId),
  xcloudGetSessions: () => ipcRenderer.invoke('xcloud:getSessions'),

  // Unified stream events (PS + Xbox)
  onChiakiEvent: (callback) => {
    ipcRenderer.on('chiaki:event', (event, data) => callback(data));
    return () => ipcRenderer.removeAllListeners('chiaki:event');
  },

  // Game list refresh (e.g. auto-created PS games from title detection)
  onGamesRefresh: (callback) => {
    ipcRenderer.on('games:refresh', (event, data) => callback(data));
    return () => ipcRenderer.removeAllListeners('games:refresh');
  },

  // Dialogs
  pickExecutable: () => ipcRenderer.invoke('dialog:pickExecutable'),
  pickImage: () => ipcRenderer.invoke('dialog:pickImage'),

  // Categories
  getCategories: () => ipcRenderer.invoke('games:getCategories'),
  addCategory: (cat) => ipcRenderer.invoke('categories:add', cat),
  removeCategory: (cat) => ipcRenderer.invoke('categories:remove', cat),

  // Metadata
  fetchMetadata: (gameId) => ipcRenderer.invoke('metadata:fetch', gameId),
  applyMetadata: (gameId, force) => ipcRenderer.invoke('metadata:apply', gameId, force),
  fetchAllMetadata: () => ipcRenderer.invoke('metadata:fetchAll'),
  searchArt: (gameName, platform) => ipcRenderer.invoke('metadata:searchArt', gameName, platform),
  steamGridDbLogin: () => ipcRenderer.invoke('steamgriddb:login'),
  readClipboard: () => ipcRenderer.invoke('clipboard:readText'),

  // Playtime
  addPlaytime: (id, minutes) => ipcRenderer.invoke('playtime:add', id, minutes),
  syncPlaytime: () => ipcRenderer.invoke('playtime:sync'),

  // Platform Accounts
  getAccounts: () => ipcRenderer.invoke('accounts:get'),
  removeAccount: (platform) => ipcRenderer.invoke('accounts:remove', platform),
  platformAuth: (platform) => ipcRenderer.invoke(`accounts:${platform}:auth`),
  platformImport: (platform) => ipcRenderer.invoke(`accounts:${platform}:import`),

  // Import progress events (provider -> main -> renderer)
  onImportProgress: (callback) => {
    ipcRenderer.on('import:progress', (event, data) => callback(data));
    return () => ipcRenderer.removeAllListeners('import:progress');
  },
  onMetadataProgress: (callback) => {
    ipcRenderer.on('metadata:progress', (event, data) => callback(data));
    return () => ipcRenderer.removeAllListeners('metadata:progress');
  },

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
  // Secure API key storage
  saveApiKey: (provider, apiKey) => ipcRenderer.invoke('keys:set', { service: `cereal-${provider}`, account: 'default', secret: apiKey }),
  getApiKey: (provider) => ipcRenderer.invoke('keys:get', { service: `cereal-${provider}`, account: 'default' }),
  deleteApiKey: (provider) => ipcRenderer.invoke('keys:delete', { service: `cereal-${provider}`, account: 'default' }),
  validateApiKey: (provider, apiKey) => ipcRenderer.invoke('keys:validate', { provider, apiKey }),
});
