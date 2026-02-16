const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Window controls
  minimize: () => ipcRenderer.invoke('window:minimize'),
  maximize: () => ipcRenderer.invoke('window:maximize'),
  close: () => ipcRenderer.invoke('window:close'),

  // Games
  getGames: () => ipcRenderer.invoke('games:getAll'),
  addGame: (game) => ipcRenderer.invoke('games:add', game),
  updateGame: (game) => ipcRenderer.invoke('games:update', game),
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
  // chiaki-ng (PlayStation Remote Play) - REMOVED
  getChiakiStatus: () => Promise.resolve({ status: 'removed' }),
  getChiakiConfig: () => Promise.resolve({ executablePath: '', consoles: [] }),
  saveChiakiConfig: (config) => Promise.resolve({ error: 'chiaki removed' }),
  setChiakiStream: (gameId, streamConfig) => Promise.resolve({ error: 'chiaki removed' }),

  // chiaki-ng deep integration - REMOVED (stubs)
  chiakiStartStream: (gameId) => Promise.resolve({ success: false, error: 'chiaki removed' }),
  chiakiStopStream: (gameId) => Promise.resolve({ success: false, error: 'chiaki removed' }),
  chiakiGetSessions: () => Promise.resolve([]),
  chiakiOpenGui: () => Promise.resolve({ success: false, error: 'chiaki removed' }),
  chiakiRegisterConsole: (opts) => Promise.resolve({ success: false, error: 'chiaki removed' }),
  chiakiDiscoverConsoles: (opts) => Promise.resolve({ success: false, consoles: [], error: 'chiaki removed' }),
  psnAuth: () => ipcRenderer.invoke('psn:auth'),
  // PSN account and probe history
  psnGetAccount: () => ipcRenderer.invoke('psn:getAccount'),
  psnSetAccount: (id) => ipcRenderer.invoke('psn:setAccount', id),
  getProbeHistory: () => ipcRenderer.invoke('psn:getProbeHistory'),
  recordProbe: (entry) => ipcRenderer.invoke('psn:recordProbe', entry),
  clearProbeHistory: () => ipcRenderer.invoke('psn:clearProbeHistory'),
  chiakiProbeConsole: (host) => Promise.resolve({ success: false, error: 'chiaki removed' }),
  psnOAuthInfo: () => ipcRenderer.invoke('psn:oauth:info'),
  startPsnOAuth: (opts) => ipcRenderer.invoke('psn:oauth:start', opts),
  chiakiSetStreamBounds: (opts) => ipcRenderer.invoke('chiaki:setStreamBounds', opts),
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

  // Playtime
  addPlaytime: (id, minutes) => ipcRenderer.invoke('playtime:add', id, minutes),
  syncPlaytime: () => ipcRenderer.invoke('playtime:sync'),

  // Platform Accounts
  getAccounts: () => ipcRenderer.invoke('accounts:get'),
  removeAccount: (platform) => ipcRenderer.invoke('accounts:remove', platform),
  steamAuth: () => ipcRenderer.invoke('accounts:steam:auth'),
  importSteamLibrary: () => ipcRenderer.invoke('accounts:steam:import'),
  gogAuth: () => ipcRenderer.invoke('accounts:gog:auth'),
  importGogLibrary: () => ipcRenderer.invoke('accounts:gog:import'),
  epicAuth: () => ipcRenderer.invoke('accounts:epic:auth'),
  importEpicLibrary: () => ipcRenderer.invoke('accounts:epic:import'),
  xboxAuth: () => ipcRenderer.invoke('accounts:xbox:auth'),
  importXboxLibrary: () => ipcRenderer.invoke('accounts:xbox:import'),

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
});
