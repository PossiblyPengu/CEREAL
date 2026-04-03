//#region electron/preload.js
var { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("api", {
	minimize: () => ipcRenderer.invoke("window:minimize"),
	maximize: () => ipcRenderer.invoke("window:maximize"),
	close: () => ipcRenderer.invoke("window:close"),
	fullscreen: () => ipcRenderer.invoke("window:fullscreen"),
	openExternal: (url) => ipcRenderer.invoke("shell:openExternal", url),
	isFullscreen: () => ipcRenderer.invoke("window:isFullscreen"),
	getGames: () => ipcRenderer.invoke("games:getAll"),
	addGame: (game) => ipcRenderer.invoke("games:add", game),
	updateGame: (game) => ipcRenderer.invoke("games:update", game),
	fetchCoverNow: (gameId) => ipcRenderer.invoke("covers:fetchNow", gameId),
	deleteGame: (id) => ipcRenderer.invoke("games:delete", id),
	toggleFavorite: (id) => ipcRenderer.invoke("games:toggleFavorite", id),
	launchGame: (id) => ipcRenderer.invoke("games:launch", id),
	installGame: (id) => ipcRenderer.invoke("games:install", id),
	openGameInClient: (id) => ipcRenderer.invoke("games:openInClient", id),
	detectSteam: () => ipcRenderer.invoke("detect:steam"),
	detectEpic: () => ipcRenderer.invoke("detect:epic"),
	detectGOG: () => ipcRenderer.invoke("detect:gog"),
	detectPSRemote: () => ipcRenderer.invoke("detect:psremote"),
	detectXbox: () => ipcRenderer.invoke("detect:xbox"),
	detectEA: () => ipcRenderer.invoke("detect:ea"),
	detectBattleNet: () => ipcRenderer.invoke("detect:battlenet"),
	detectItchio: () => ipcRenderer.invoke("detect:itchio"),
	detectUbisoft: () => ipcRenderer.invoke("detect:ubisoft"),
	getChiakiStatus: () => ipcRenderer.invoke("chiaki:status"),
	chiakiCheckUpdate: () => ipcRenderer.invoke("chiaki:checkUpdate"),
	chiakiUpdate: () => ipcRenderer.invoke("chiaki:update"),
	getChiakiConfig: () => ipcRenderer.invoke("chiaki:getConfig"),
	saveChiakiConfig: (config) => ipcRenderer.invoke("chiaki:saveConfig", config),
	setChiakiStream: (gameId, streamConfig) => ipcRenderer.invoke("games:setChiakiStream", gameId, streamConfig),
	chiakiStartStreamDirect: (opts) => ipcRenderer.invoke("chiaki:startStreamDirect", opts),
	chiakiStartStream: (gameId) => ipcRenderer.invoke("chiaki:startStream", gameId),
	chiakiStopStream: (gameId) => ipcRenderer.invoke("chiaki:stopStream", gameId),
	chiakiGetSessions: () => ipcRenderer.invoke("chiaki:getSessions"),
	chiakiOpenGui: () => ipcRenderer.invoke("chiaki:openGui"),
	chiakiRegisterConsole: (opts) => ipcRenderer.invoke("chiaki:registerConsole", opts),
	chiakiDiscoverConsoles: () => ipcRenderer.invoke("chiaki:discoverConsoles"),
	chiakiWakeConsole: (opts) => ipcRenderer.invoke("chiaki:wakeConsole", opts),
	chiakiSetStreamBounds: (opts) => ipcRenderer.invoke("chiaki:setStreamBounds", opts),
	xcloudStartDirect: (url) => ipcRenderer.invoke("xcloud:startDirect", { url }),
	xcloudStart: (opts) => ipcRenderer.invoke("xcloud:start", opts),
	xcloudStop: (gameId) => ipcRenderer.invoke("xcloud:stop", gameId),
	xcloudGetSessions: () => ipcRenderer.invoke("xcloud:getSessions"),
	onChiakiEvent: (callback) => {
		const handler = (event, data) => callback(data);
		ipcRenderer.on("chiaki:event", handler);
		return () => ipcRenderer.removeListener("chiaki:event", handler);
	},
	onGamesRefresh: (callback) => {
		const handler = (event, data) => callback(data);
		ipcRenderer.on("games:refresh", handler);
		return () => ipcRenderer.removeListener("games:refresh", handler);
	},
	pickExecutable: () => ipcRenderer.invoke("dialog:pickExecutable"),
	pickImage: () => ipcRenderer.invoke("dialog:pickImage"),
	getCategories: () => ipcRenderer.invoke("games:getCategories"),
	addCategory: (cat) => ipcRenderer.invoke("categories:add", cat),
	removeCategory: (cat) => ipcRenderer.invoke("categories:remove", cat),
	fetchMetadata: (gameId) => ipcRenderer.invoke("metadata:fetch", gameId),
	applyMetadata: (gameId, force) => ipcRenderer.invoke("metadata:apply", gameId, force),
	fetchAllMetadata: () => ipcRenderer.invoke("metadata:fetchAll"),
	searchArt: (gameName, platform) => ipcRenderer.invoke("metadata:searchArt", gameName, platform),
	fetchMetadataForName: (name, platform, platformId) => ipcRenderer.invoke("metadata:fetchForName", name, platform, platformId),
	steamGridDbLogin: () => ipcRenderer.invoke("steamgriddb:login"),
	readClipboard: () => ipcRenderer.invoke("clipboard:readText"),
	syncPlaytime: () => ipcRenderer.invoke("playtime:sync"),
	getAccounts: () => ipcRenderer.invoke("accounts:get"),
	removeAccount: (platform) => ipcRenderer.invoke("accounts:remove", platform),
	platformAuth: (platform) => ipcRenderer.invoke(`accounts:${platform}:auth`),
	platformImport: (platform) => ipcRenderer.invoke(`accounts:${platform}:import`),
	onImportProgress: (callback) => {
		const handler = (event, data) => callback(data);
		ipcRenderer.on("import:progress", handler);
		return () => ipcRenderer.removeListener("import:progress", handler);
	},
	onMetadataProgress: (callback) => {
		const handler = (event, data) => callback(data);
		ipcRenderer.on("metadata:progress", handler);
		return () => ipcRenderer.removeListener("metadata:progress", handler);
	},
	onCoverProgress: (callback) => {
		const handler = (event, data) => callback(data);
		ipcRenderer.on("cover:progress", handler);
		return () => ipcRenderer.removeListener("cover:progress", handler);
	},
	getSettings: () => ipcRenderer.invoke("settings:get"),
	saveSettings: (s) => ipcRenderer.invoke("settings:save", s),
	resetSettings: () => ipcRenderer.invoke("settings:reset"),
	exportLibrary: () => ipcRenderer.invoke("settings:exportLibrary"),
	importLibrary: () => ipcRenderer.invoke("settings:importLibrary"),
	clearAllGames: () => ipcRenderer.invoke("settings:clearAllGames"),
	clearCovers: () => ipcRenderer.invoke("settings:clearCovers"),
	getDataPath: () => ipcRenderer.invoke("settings:getDataPath"),
	getAppVersion: () => ipcRenderer.invoke("settings:getAppVersion"),
	checkForUpdate: () => ipcRenderer.invoke("update:check"),
	installUpdate: () => ipcRenderer.invoke("update:install"),
	onUpdateEvent: (callback) => {
		const handler = (event, data) => callback(data);
		ipcRenderer.on("update:event", handler);
		return () => ipcRenderer.removeListener("update:event", handler);
	},
	getMediaInfo: () => ipcRenderer.invoke("media:getInfo"),
	mediaControl: (action) => ipcRenderer.invoke("media:control", action),
	saveApiKey: (provider, apiKey) => ipcRenderer.invoke("keys:set", {
		service: `cereal-${provider}`,
		account: "default",
		secret: apiKey
	}),
	getApiKeyInfo: (provider) => ipcRenderer.invoke("keys:get", {
		service: `cereal-${provider}`,
		account: "default"
	}),
	deleteApiKey: (provider) => ipcRenderer.invoke("keys:delete", {
		service: `cereal-${provider}`,
		account: "default"
	}),
	validateApiKey: (provider, apiKey) => ipcRenderer.invoke("keys:validate", {
		provider,
		apiKey
	}),
	validateStoredApiKey: (provider) => ipcRenderer.invoke("keys:validateStored", {
		provider,
		service: `cereal-${provider}`,
		account: "default"
	}),
	getDiscordStatus: () => ipcRenderer.invoke("discord:status"),
	signalReady: () => ipcRenderer.send("window:ready"),
	getSystemSpecs: () => ipcRenderer.invoke("system:getSpecs")
});
//#endregion
