//#region \0rolldown/runtime.js
var __commonJSMin = (cb, mod) => () => (mod || cb((mod = { exports: {} }).exports, mod), mod.exports);
//#endregion
//#region electron/modules/core/credentials.js
var require_credentials = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	var { safeStorage, app: app$7 } = require("electron");
	var path$14 = require("path");
	var fs$11 = require("fs");
	var credStorePath = () => path$14.join(app$7.getPath("userData"), "credentials.json");
	var _credCache = null;
	function loadCredStore() {
		if (_credCache) return _credCache;
		const target = credStorePath();
		for (const filePath of [target, target + ".bak"]) try {
			if (!fs$11.existsSync(filePath)) continue;
			_credCache = JSON.parse(fs$11.readFileSync(filePath, "utf-8"));
			return _credCache;
		} catch {}
		_credCache = {};
		return _credCache;
	}
	function saveCredStore(store) {
		_credCache = store;
		const target = credStorePath();
		try {
			if (fs$11.existsSync(target)) fs$11.copyFileSync(target, target + ".bak");
		} catch (_e) {}
		const tmp = target + ".tmp";
		fs$11.writeFileSync(tmp, JSON.stringify(store, null, 2), "utf-8");
		fs$11.renameSync(tmp, target);
	}
	module.exports = { safeStore: {
		setPassword(service, account, secret) {
			if (!safeStorage.isEncryptionAvailable()) throw new Error("Encryption not available");
			const store = loadCredStore();
			const key = `${service}/${account}`;
			store[key] = safeStorage.encryptString(secret).toString("base64");
			saveCredStore(store);
		},
		getPassword(service, account) {
			const store = loadCredStore();
			const key = `${service}/${account}`;
			if (!store[key]) return null;
			return safeStorage.decryptString(Buffer.from(store[key], "base64"));
		},
		deletePassword(service, account) {
			const store = loadCredStore();
			const key = `${service}/${account}`;
			if (!store[key]) return false;
			delete store[key];
			saveCredStore(store);
			return true;
		}
	} };
}));
//#endregion
//#region electron/modules/core/constants.js
var require_constants = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	var path$13 = require("path");
	module.exports = {
		CONTROL_BAR_HEIGHT: 40,
		ALLOWED_KEY_SERVICES: [
			"cereal-steam",
			"cereal-steamgriddb",
			"cereal-itchio",
			"cereal-account-steam",
			"cereal-account-gog",
			"cereal-account-epic",
			"cereal-account-xbox",
			"cereal-account-ea",
			"cereal-account-battlenet",
			"cereal-account-itchio",
			"cereal-account-ubisoft",
			"cereal-account-psn"
		],
		CHIAKI_SYSTEM_PATHS: [
			path$13.join(process.env.ProgramFiles || "", "chiaki-ng", "chiaki.exe"),
			path$13.join(process.env["ProgramFiles(x86)"] || "", "chiaki-ng", "chiaki.exe"),
			path$13.join(process.env.LOCALAPPDATA || "", "chiaki-ng", "chiaki.exe")
		],
		ACCOUNT_SECRET_FIELDS: [
			"accessToken",
			"refreshToken",
			"msAccessToken",
			"msRefreshToken",
			"xblToken",
			"xstsToken",
			"userHash"
		]
	};
}));
//#endregion
//#region electron/modules/core/logger.js
var require_logger = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	var path$12 = require("path");
	var fs$10 = require("fs");
	var { app: app$6 } = require("electron");
	var DEBUG = process.env.CEREAL_DEBUG === "1";
	var _logFile = null;
	function getLogFile() {
		if (_logFile !== null) return _logFile;
		if (!app$6.isPackaged) {
			_logFile = false;
			return false;
		}
		try {
			const dir = app$6.getPath("logs");
			fs$10.mkdirSync(dir, { recursive: true });
			const date = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
			_logFile = path$12.join(dir, `cereal-${date}.log`);
		} catch (_e) {
			_logFile = false;
		}
		return _logFile;
	}
	function writeLine(level, tag, args) {
		const f = getLogFile();
		if (!f) return;
		try {
			const ts = (/* @__PURE__ */ new Date()).toISOString();
			const msg = args.map((a) => typeof a === "string" ? a : JSON.stringify(a)).join(" ");
			fs$10.appendFileSync(f, `${ts} [${level}] [${tag}] ${msg}\n`);
		} catch (_e) {}
	}
	function info(tag, ...args) {
		console.log(`[${tag}]`, ...args);
		writeLine("INFO", tag, args);
	}
	function warn(tag, ...args) {
		console.warn(`[${tag}]`, ...args);
		writeLine("WARN", tag, args);
	}
	function error(tag, ...args) {
		console.error(`[${tag}]`, ...args);
		writeLine("ERROR", tag, args);
	}
	function debug(tag, ...args) {
		if (!DEBUG) return;
		console.log(`[${tag}]`, ...args);
		writeLine("DEBUG", tag, args);
	}
	module.exports = {
		info,
		warn,
		error,
		debug,
		DEBUG
	};
}));
//#endregion
//#region electron/modules/core/context.js
var require_context = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	module.exports = {
		db: null,
		mainWindow: null,
		saveDB: null,
		flushDB: null,
		sendToRenderer: null,
		safeStore: null
	};
}));
//#endregion
//#region electron/modules/metadata/detection.js
var require_detection = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	var path$11 = require("path");
	var fs$9 = require("fs");
	function findSteamRoot() {
		const steamPaths = [
			path$11.join(process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", "Steam"),
			path$11.join(process.env.ProgramFiles || "C:\\Program Files", "Steam"),
			path$11.join(process.env.HOME || process.env.USERPROFILE || "", "Steam")
		];
		for (const p of steamPaths) if (fs$9.existsSync(p)) return p;
		return null;
	}
	function scanSteamInstalled() {
		const games = [];
		const steamRoot = findSteamRoot();
		if (!steamRoot) return {
			games: [],
			error: "Steam not found"
		};
		const libraryFolders = [path$11.join(steamRoot, "steamapps")];
		const vdfPath = path$11.join(steamRoot, "steamapps", "libraryfolders.vdf");
		if (fs$9.existsSync(vdfPath)) {
			const vdfContent = fs$9.readFileSync(vdfPath, "utf-8");
			for (const [, p] of vdfContent.matchAll(/"path"\s+"([^"]+)"/g)) {
				const appsDir = path$11.join(p.replace(/\\\\/g, "\\"), "steamapps");
				if (fs$9.existsSync(appsDir) && !libraryFolders.includes(appsDir)) libraryFolders.push(appsDir);
			}
		}
		for (const libFolder of libraryFolders) {
			if (!fs$9.existsSync(libFolder)) continue;
			const files = fs$9.readdirSync(libFolder).filter((f) => f.endsWith(".acf"));
			for (const file of files) try {
				const content = fs$9.readFileSync(path$11.join(libFolder, file), "utf-8");
				const appid = content.match(/"appid"\s+"(\d+)"/);
				const name = content.match(/"name"\s+"([^"]+)"/);
				const installdir = content.match(/"installdir"\s+"([^"]+)"/);
				if (appid && name && installdir) {
					const gamePath = path$11.join(libFolder, "common", installdir[1]);
					games.push({
						name: name[1],
						platform: "steam",
						platformId: appid[1],
						installPath: gamePath,
						executablePath: "",
						coverUrl: `https://shared.steamstatic.com/store_item_assets/steam/apps/${appid[1]}/library_600x900_2x.jpg`,
						headerUrl: `https://shared.steamstatic.com/store_item_assets/steam/apps/${appid[1]}/library_hero.jpg`,
						categories: [],
						source: "auto-detected",
						installed: true
					});
				}
			} catch (_e) {}
		}
		return { games };
	}
	function scanEpicInstalled() {
		const games = [];
		try {
			const manifestDir = path$11.join(process.env.PROGRAMDATA || "C:\\ProgramData", "Epic", "EpicGamesLauncher", "Data", "Manifests");
			if (!fs$9.existsSync(manifestDir)) return games;
			const files = fs$9.readdirSync(manifestDir).filter((f) => f.endsWith(".item"));
			for (const file of files) try {
				const content = JSON.parse(fs$9.readFileSync(path$11.join(manifestDir, file), "utf-8"));
				if (content.DisplayName && content.InstallLocation) games.push({
					name: content.DisplayName,
					platform: "epic",
					platformId: content.CatalogNamespace || content.AppName,
					installPath: content.InstallLocation,
					executablePath: content.LaunchExecutable ? path$11.join(content.InstallLocation, content.LaunchExecutable) : "",
					coverUrl: "",
					categories: [],
					source: "auto-detected",
					installed: true
				});
			} catch (_e) {}
		} catch (_e) {}
		return games;
	}
	function scanGogInstalled() {
		const games = [];
		try {
			const dirsToScan = ["C:\\GOG Games", path$11.join(process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", "GOG Galaxy", "Games")].filter((d) => {
				try {
					return fs$9.existsSync(d);
				} catch {
					return false;
				}
			});
			for (const dir of dirsToScan) {
				const entries = fs$9.readdirSync(dir, { withFileTypes: true });
				for (const entry of entries) if (entry.isDirectory()) {
					const gameDir = path$11.join(dir, entry.name);
					const infoFiles = fs$9.readdirSync(gameDir).filter((f) => f.startsWith("goggame-") && f.endsWith(".info"));
					for (const infoFile of infoFiles) try {
						const info = JSON.parse(fs$9.readFileSync(path$11.join(gameDir, infoFile), "utf-8"));
						if (info.name) games.push({
							name: info.name,
							platform: "gog",
							platformId: info.gameId || "",
							installPath: gameDir,
							executablePath: info.playTasks?.[0]?.path ? path$11.join(gameDir, info.playTasks[0].path) : "",
							coverUrl: "",
							categories: [],
							source: "auto-detected",
							installed: true
						});
					} catch (_e) {}
				}
			}
		} catch (_e) {}
		return games;
	}
	function scanXboxInstalled() {
		const games = [];
		const xboxGamesDir = "C:\\XboxGames";
		if (fs$9.existsSync(xboxGamesDir)) {
			const entries = fs$9.readdirSync(xboxGamesDir, { withFileTypes: true });
			for (const entry of entries) if (entry.isDirectory() && entry.name !== "Content") games.push({
				name: entry.name.replace(/([A-Z])/g, " $1").trim(),
				platform: "xbox",
				platformId: "",
				installPath: path$11.join(xboxGamesDir, entry.name),
				executablePath: "",
				coverUrl: "",
				categories: [],
				source: "auto-detected"
			});
		}
		const xboxAppPaths = [path$11.join(process.env.LOCALAPPDATA || "", "Microsoft", "WindowsApps", "XboxApp.exe"), path$11.join(process.env.ProgramFiles || "", "WindowsApps", "Microsoft.GamingApp_*")];
		let xboxAppFound = false;
		for (const p of xboxAppPaths) if (p.includes("*")) {
			const dir = path$11.dirname(p);
			const prefix = path$11.basename(p).replace("*", "");
			if (fs$9.existsSync(dir)) {
				if (fs$9.readdirSync(dir).filter((f) => f.startsWith(prefix)).length > 0) xboxAppFound = true;
			}
		} else if (fs$9.existsSync(p)) xboxAppFound = true;
		return {
			games,
			xboxAppFound,
			cloudGamingUrl: "https://www.xbox.com/play"
		};
	}
	module.exports = {
		findSteamRoot,
		scanSteamInstalled,
		scanEpicInstalled,
		scanGogInstalled,
		scanXboxInstalled
	};
}));
//#endregion
//#region electron/modules/core/paths.js
var require_paths = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	var path$10 = require("path");
	var fs$8 = require("fs");
	var { app: app$5 } = require("electron");
	/**
	* Get the root directory where scripts/, providers/, and resources/ are located.
	* In dev: electron/ folder
	* In production: resources/ folder (next to the app executable)
	*/
	function getResourcesRoot() {
		if (app$5?.isPackaged) return process.resourcesPath;
		return path$10.join(process.cwd(), "electron");
	}
	/**
	* Get the path to a script in the scripts/ directory
	*/
	function getScriptPath(scriptName) {
		return path$10.join(getResourcesRoot(), "scripts", scriptName);
	}
	/**
	* Get the path to the providers/ directory (memoized — stable for the app lifetime)
	*/
	var _providersDir = null;
	function getProvidersDir() {
		if (_providersDir) return _providersDir;
		const candidates = [path$10.join(process.cwd(), "electron", "providers")];
		if (app$5?.isPackaged) candidates.unshift(path$10.join(process.resourcesPath, "providers"));
		for (const candidate of candidates) if (fs$8.existsSync(path$10.join(candidate, "index.js"))) {
			_providersDir = candidate;
			return _providersDir;
		}
		throw new Error("Cannot find providers directory. Tried: " + candidates.join(", "));
	}
	/**
	* Get the path to a file in the resources/ directory (for bundled resources like chiaki-ng)
	*/
	function getResourcePath(resourceName) {
		return path$10.join(getResourcesRoot(), "resources", resourceName);
	}
	/**
	* Require a module from the providers/ directory
	*/
	function requireProvider(moduleName) {
		return require(path$10.join(getProvidersDir(), moduleName));
	}
	module.exports = {
		getResourcesRoot,
		getScriptPath,
		getProvidersDir,
		getResourcePath,
		requireProvider
	};
}));
//#endregion
//#region electron/modules/integrations/accounts.js
var require_accounts = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	var { BrowserWindow: BrowserWindow$1, session: session$2, ipcMain: ipcMain$9 } = require("electron");
	var crypto$3 = require("crypto");
	var path$9 = require("path");
	var ctx = require_context();
	var { ACCOUNT_SECRET_FIELDS } = require_constants();
	var { scanEpicInstalled, scanGogInstalled } = require_detection();
	var log = require_logger();
	var { getProvidersDir } = require_paths();
	var providers = null;
	var auth = null;
	function getProviders() {
		if (!providers) providers = require(getProvidersDir());
		return providers;
	}
	function getAuth() {
		if (!auth) auth = require(path$9.join(getProvidersDir(), "auth"));
		return auth;
	}
	function accountSecretService(platform) {
		return `cereal-account-${platform}`;
	}
	function loadAccountSecrets(platform) {
		try {
			const raw = ctx.safeStore.getPassword(accountSecretService(platform), "tokens");
			if (!raw) return {};
			return JSON.parse(raw);
		} catch (_e) {
			return {};
		}
	}
	function storeAccountSecrets(platform, secrets) {
		try {
			const service = accountSecretService(platform);
			if (secrets && Object.keys(secrets).length) ctx.safeStore.setPassword(service, "tokens", JSON.stringify(secrets));
			else ctx.safeStore.deletePassword(service, "tokens");
		} catch (e) {
			log.error("accounts", "account secret store error", platform, e && e.message);
		}
	}
	function detachAccountSecrets(platform, { save = true } = {}) {
		const acct = ctx.db?.accounts?.[platform];
		if (!acct) {
			storeAccountSecrets(platform, null);
			return false;
		}
		const secrets = {};
		let hasSecrets = false;
		for (const key of ACCOUNT_SECRET_FIELDS) if (acct[key] !== void 0 && acct[key] !== null) {
			secrets[key] = acct[key];
			delete acct[key];
			hasSecrets = true;
		}
		storeAccountSecrets(platform, hasSecrets ? secrets : null);
		if (acct.hasCredentials !== hasSecrets) {
			acct.hasCredentials = hasSecrets;
			if (save) ctx.saveDB(ctx.db);
		} else if (hasSecrets && save) ctx.saveDB(ctx.db);
		return hasSecrets;
	}
	function hydrateAccountSecrets(platform) {
		const acct = ctx.db?.accounts?.[platform];
		if (!acct) return () => {};
		const secrets = loadAccountSecrets(platform);
		if (Object.keys(secrets).length) {
			Object.assign(acct, secrets);
			acct.hasCredentials = true;
		}
		return () => detachAccountSecrets(platform);
	}
	function persistAccountData(platform, data = {}) {
		if (!platform) return;
		if (!ctx.db.accounts) ctx.db.accounts = {};
		const acct = ctx.db.accounts[platform] || {};
		const secrets = loadAccountSecrets(platform);
		let secretsChanged = false;
		let removedSecrets = false;
		for (const [key, val] of Object.entries(data)) if (ACCOUNT_SECRET_FIELDS.includes(key)) {
			if (val === void 0) continue;
			if (val === null) {
				if (secrets[key] !== void 0) {
					delete secrets[key];
					secretsChanged = true;
					removedSecrets = true;
				}
			} else if (secrets[key] !== val) {
				secrets[key] = val;
				secretsChanged = true;
			}
		} else if (val !== void 0) acct[key] = val;
		if (data.connected !== void 0) acct.connected = data.connected;
		else if (acct.connected === void 0) acct.connected = true;
		const hasSecrets = Object.keys(secrets).length > 0;
		acct.hasCredentials = hasSecrets;
		ctx.db.accounts[platform] = acct;
		if (secretsChanged || removedSecrets) storeAccountSecrets(platform, hasSecrets ? secrets : null);
		if (Object.keys(data).length) ctx.saveDB(ctx.db);
		return acct;
	}
	var pendingOAuthStates = /* @__PURE__ */ new Map();
	var AUTH_TIMEOUT_MS = 300 * 1e3;
	function generateOAuthState() {
		const now = Date.now();
		for (const [s, entry] of pendingOAuthStates) if (now - entry.timestamp >= AUTH_TIMEOUT_MS) pendingOAuthStates.delete(s);
		const state = crypto$3.randomBytes(32).toString("hex");
		pendingOAuthStates.set(state, { timestamp: now });
		return state;
	}
	function validateOAuthState(state) {
		if (!state || !pendingOAuthStates.has(state)) return false;
		const entry = pendingOAuthStates.get(state);
		pendingOAuthStates.delete(state);
		return Date.now() - entry.timestamp < AUTH_TIMEOUT_MS;
	}
	function sanitizeAccountsForRenderer(accounts) {
		if (!accounts) return {};
		const safe = {};
		const sensitiveKeys = [
			"accessToken",
			"refreshToken",
			"xblToken",
			"xstsToken",
			"msAccessToken",
			"msRefreshToken",
			"userHash"
		];
		for (const [platform, data] of Object.entries(accounts)) {
			if (!data || typeof data !== "object") continue;
			safe[platform] = {};
			for (const [key, val] of Object.entries(data)) if (!sensitiveKeys.includes(key)) safe[platform][key] = val;
			safe[platform].hasCredentials = !!data.hasCredentials;
		}
		return safe;
	}
	var ALLOWED_AUTH_DOMAINS = [
		"steamcommunity.com",
		"store.steampowered.com",
		"login.steampowered.com",
		"login.gog.com",
		"auth.gog.com",
		"embed.gog.com",
		"gog.com",
		"epicgames.com",
		"www.epicgames.com",
		"microsoftonline.com",
		"live.com",
		"microsoft.com",
		"msauth.net",
		"msftauth.net",
		"localhost",
		"cereal-launcher.local"
	];
	function isAllowedAuthDomain(url) {
		try {
			const hostname = new URL(url).hostname;
			return ALLOWED_AUTH_DOMAINS.some((d) => hostname === d || hostname.endsWith("." + d));
		} catch {
			return false;
		}
	}
	function createAuthWindow(width, height, authSession) {
		const win = new BrowserWindow$1({
			width,
			height,
			parent: ctx.mainWindow,
			modal: true,
			webPreferences: {
				nodeIntegration: false,
				contextIsolation: true,
				sandbox: true,
				session: authSession
			}
		});
		win.setMenuBarVisibility(false);
		win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
		return win;
	}
	function runOAuthFlow({ partition, width, height, authUrl, redirectMatch, onRedirect, allowNavigate, keepSession }) {
		return new Promise((resolve) => {
			const partitionStr = keepSession ? partition : partition + ":" + Date.now();
			const authSession = session$2.fromPartition(partitionStr);
			const authWin = createAuthWindow(width || 700, height || 700, authSession);
			let resolved = false;
			let authTimeout = null;
			const cleanup = () => {
				if (authTimeout) {
					clearTimeout(authTimeout);
					authTimeout = null;
				}
				if (!keepSession) try {
					authSession.clearStorageData();
				} catch (_e) {}
			};
			const finish = (result) => {
				if (resolved) return;
				resolved = true;
				cleanup();
				try {
					authWin.close();
				} catch (_e) {}
				resolve(result);
			};
			authTimeout = setTimeout(() => finish({ error: "Authentication timed out" }), AUTH_TIMEOUT_MS);
			const handleUrl = (url) => {
				if (resolved) return;
				if (redirectMatch(url)) onRedirect(url, finish, {
					win: authWin,
					session: authSession
				});
			};
			authWin.webContents.on("will-navigate", (event, url) => {
				if (redirectMatch(url)) {
					if (!allowNavigate) event.preventDefault();
					handleUrl(url);
					return;
				}
				if (!isAllowedAuthDomain(url)) event.preventDefault();
			});
			authWin.webContents.on("will-redirect", (event, url) => {
				if (redirectMatch(url)) {
					if (!allowNavigate) event.preventDefault();
					handleUrl(url);
				}
			});
			authWin.webContents.on("did-navigate", (event, url) => handleUrl(url));
			authWin.on("closed", () => {
				cleanup();
				if (!resolved) {
					resolved = true;
					resolve({ error: "cancelled" });
				}
			});
			authWin.loadURL(authUrl);
		});
	}
	async function refreshAccountToken(platform) {
		const a = getAuth();
		const acct = (ctx.db.accounts || {})[platform];
		if (!acct) return false;
		const releaseSecrets = hydrateAccountSecrets(platform);
		try {
			let tokens;
			if (platform === "gog") {
				if (!acct.refreshToken) return false;
				tokens = await a.refreshGogToken(acct.refreshToken);
			} else if (platform === "epic") {
				if (!acct.refreshToken) return false;
				tokens = await a.refreshEpicToken(acct.refreshToken);
			} else if (platform === "xbox") {
				if (!acct.msRefreshToken) return false;
				tokens = await a.refreshXboxTokens(acct.msRefreshToken);
			}
			if (!tokens) return false;
			persistAccountData(platform, tokens);
			return true;
		} catch (_e) {
			return false;
		} finally {
			releaseSecrets();
		}
	}
	function emitImportProgress(providerId, evt) {
		try {
			ctx.sendToRenderer("import:progress", {
				provider: providerId,
				...evt
			});
		} catch (_e) {}
	}
	function importCount(value) {
		if (Array.isArray(value)) return value.length;
		if (typeof value === "number" && Number.isFinite(value)) return value;
		return 0;
	}
	async function runProviderImportWithProgress(providerId, options = {}) {
		const provider = getProviders()?.[providerId];
		if (!provider || typeof provider.importLibrary !== "function") return { error: `${providerId} provider not available` };
		const releaseSecrets = hydrateAccountSecrets(providerId);
		const counts = {
			processed: 0,
			imported: 0,
			updated: 0
		};
		let sawTerminalStatus = false;
		const notify = (evt = {}) => {
			const next = { ...evt };
			if (typeof next.processed === "number" && Number.isFinite(next.processed)) counts.processed = next.processed;
			if (typeof next.imported === "number" && Number.isFinite(next.imported)) counts.imported = next.imported;
			if (typeof next.updated === "number" && Number.isFinite(next.updated)) counts.updated = next.updated;
			if (next.status === "done" || next.status === "error") sawTerminalStatus = true;
			emitImportProgress(providerId, {
				status: next.status || "progress",
				processed: counts.processed,
				imported: counts.imported,
				updated: counts.updated,
				message: next.message
			});
		};
		notify({
			status: "start",
			processed: 0,
			imported: 0,
			updated: 0
		});
		try {
			const res = await provider.importLibrary({
				db: ctx.db,
				saveDB: ctx.saveDB,
				notify,
				...options
			});
			const importedCount = importCount(res?.imported);
			const updatedCount = importCount(res?.updated);
			const processedCount = typeof res?.processed === "number" && Number.isFinite(res.processed) ? res.processed : typeof res?.total === "number" && Number.isFinite(res.total) ? res.total : importedCount + updatedCount;
			const hasError = !!res?.error;
			if (!sawTerminalStatus) emitImportProgress(providerId, {
				status: hasError ? "error" : "done",
				processed: Math.max(counts.processed, processedCount),
				imported: Math.max(counts.imported, importedCount),
				updated: Math.max(counts.updated, updatedCount),
				message: hasError ? String(res.error || "") : void 0
			});
			return res;
		} catch (e) {
			emitImportProgress(providerId, {
				status: "error",
				processed: counts.processed,
				imported: counts.imported,
				updated: counts.updated,
				message: e.message
			});
			return { error: `${providerId} import failed: ` + e.message };
		} finally {
			releaseSecrets();
		}
	}
	async function importWithTokenRefresh(providerId) {
		const acct = (ctx.db.accounts || {})[providerId];
		const expiry = acct?.msExpiresAt ?? acct?.expiresAt;
		if (expiry && Date.now() > expiry - 6e4) {
			if (!await refreshAccountToken(providerId)) return { error: `${providerId} session expired. Please sign in again.` };
		}
		let res = await runProviderImportWithProgress(providerId);
		if (res?.error && /(401|403|unauthor|token|expired)/i.test(String(res.error || ""))) {
			if (!await refreshAccountToken(providerId)) return res;
			res = await runProviderImportWithProgress(providerId);
		}
		return res;
	}
	async function handleLocalProviderAuth(providerId, displayName) {
		const provider = getProviders()?.[providerId];
		if (!provider || typeof provider.detectInstalled !== "function") return { error: `${displayName} provider not available` };
		const detected = provider.detectInstalled();
		if (detected?.error) return { error: detected.error };
		const accountData = {
			connected: true,
			displayName,
			gameCount: Array.isArray(detected?.games) ? detected.games.length : 0,
			lastSync: (/* @__PURE__ */ new Date()).toISOString()
		};
		persistAccountData(providerId, accountData);
		return {
			success: true,
			displayName,
			gameCount: accountData.gameCount,
			localOnly: true
		};
	}
	async function handleProviderImport(providerId) {
		let apiKey = null;
		if (providerId === "itchio") try {
			apiKey = ctx.safeStore.getPassword("cereal-itchio", "default") || null;
		} catch (_e) {}
		return runProviderImportWithProgress(providerId, apiKey ? { apiKey } : {});
	}
	function extractOAuthCode(url) {
		const u = new URL(url);
		const code = u.searchParams.get("code");
		const error = u.searchParams.get("error");
		const returnedState = u.searchParams.get("state");
		if (error) return { error: u.searchParams.get("error_description") || error };
		if (returnedState && !validateOAuthState(returnedState)) return { error: "Security validation failed (state mismatch)" };
		if (!code) return { error: "No authorization code received" };
		return { code };
	}
	function saveAccountAndReturn(platform, data) {
		persistAccountData(platform, {
			...data,
			connected: true
		});
	}
	function registerAccountIpcHandlers() {
		const a = getAuth();
		const p = getProviders();
		ipcMain$9.handle("accounts:get", () => {
			return sanitizeAccountsForRenderer(ctx.db.accounts);
		});
		ipcMain$9.handle("accounts:save", (event, platform, data) => {
			if (!platform || typeof platform !== "string") return sanitizeAccountsForRenderer(ctx.db.accounts || {});
			const allowedKeys = [
				"connected",
				"displayName",
				"gamertag",
				"avatarUrl",
				"lastSync",
				"gameCount"
			];
			const filtered = {};
			for (const [key, val] of Object.entries(data || {})) if (allowedKeys.includes(key)) filtered[key] = val;
			persistAccountData(platform, filtered);
			return sanitizeAccountsForRenderer(ctx.db.accounts);
		});
		ipcMain$9.handle("accounts:remove", (event, platform) => {
			if (!ctx.db.accounts) ctx.db.accounts = {};
			if (ctx.db.accounts[platform]) {
				detachAccountSecrets(platform);
				delete ctx.db.accounts[platform];
			}
			if (platform === "steam") try {
				session$2.fromPartition("persist:steam-auth").clearStorageData();
			} catch (_e) {}
			ctx.saveDB(ctx.db);
			return sanitizeAccountsForRenderer(ctx.db.accounts);
		});
		ipcMain$9.handle("accounts:steam:auth", async () => {
			const c = a.CONFIG.steam;
			return runOAuthFlow({
				partition: "persist:steam-auth",
				...c.windowSize,
				authUrl: a.buildSteamAuthUrl(),
				redirectMatch: (url) => url.startsWith(c.returnUrl),
				keepSession: true,
				onRedirect: async (url, finish) => {
					try {
						const steamId = a.extractSteamId(url);
						if (!steamId) {
							finish({ error: "Could not extract Steam ID" });
							return;
						}
						const profile = await a.fetchSteamProfile(steamId);
						saveAccountAndReturn("steam", {
							steamId,
							...profile
						});
						finish({
							success: true,
							steamId,
							...profile
						});
					} catch (e) {
						finish({ error: e.message });
					}
				}
			});
		});
		ipcMain$9.handle("accounts:steam:import", async () => {
			if (!p?.steam?.importLibrary) return { error: "Steam provider not available" };
			let apiKey = null;
			try {
				const r = ctx.safeStore.getPassword("cereal-steam", "default");
				if (r) apiKey = r;
			} catch (_e) {}
			const steamSession = session$2.fromPartition("persist:steam-auth");
			const sessionFetch = steamSession.fetch.bind(steamSession);
			return runProviderImportWithProgress("steam", {
				apiKey,
				sessionFetch
			});
		});
		ipcMain$9.handle("accounts:gog:auth", async () => {
			const c = a.CONFIG.gog;
			const oauthState = generateOAuthState();
			return runOAuthFlow({
				partition: "auth:gog",
				...c.windowSize,
				authUrl: a.buildGogAuthUrl(oauthState),
				redirectMatch: (url) => url.includes("on_login_success") && url.includes("code="),
				onRedirect: async (url, finish) => {
					try {
						const { code, error } = extractOAuthCode(url);
						if (error) {
							finish({ error });
							return;
						}
						const tokens = await a.exchangeGogCode(code);
						if (tokens.error) {
							finish(tokens);
							return;
						}
						saveAccountAndReturn("gog", tokens);
						finish({
							success: true,
							userId: tokens.userId
						});
					} catch (e) {
						finish({ error: e.message });
					}
				}
			});
		});
		ipcMain$9.handle("accounts:gog:import", async () => {
			if (!p?.gog?.importLibrary) return { error: "GOG provider not available" };
			const res = await importWithTokenRefresh("gog");
			if (!res?.error) {
				const installed = scanGogInstalled();
				if (installed.length > 0) {
					const installedIds = new Set(installed.map((g) => g.platformId).filter(Boolean));
					let changed = false;
					for (const g of ctx.db.games) if (g.platform === "gog") {
						const isInstalled = !!(g.platformId && installedIds.has(g.platformId));
						if (isInstalled && !g.installed) {
							g.installed = true;
							changed = true;
						} else if (!isInstalled && g.installed === void 0) {
							g.installed = false;
							changed = true;
						}
					}
					if (changed) ctx.saveDB(ctx.db);
				}
			}
			return res;
		});
		ipcMain$9.handle("accounts:epic:auth", async () => {
			const c = a.CONFIG.epic;
			return runOAuthFlow({
				partition: "auth:epic",
				...c.windowSize,
				authUrl: a.buildEpicAuthUrl(),
				redirectMatch: (url) => url.includes("epicgames.com/id/api/redirect"),
				allowNavigate: true,
				onRedirect: async (url, finish, { session: authSess }) => {
					try {
						const resp = await authSess.fetch(url);
						if (!resp.ok) {
							finish({ error: "Epic redirect fetch failed: " + resp.status });
							return;
						}
						const data = await resp.json();
						const exchangeCode = data.exchangeCode || data.redirectUrl && new URL(data.redirectUrl).searchParams.get("code");
						if (!exchangeCode) {
							finish({ error: "No exchange code in Epic response" });
							return;
						}
						const tokens = await a.exchangeEpicCode(exchangeCode);
						if (tokens.error) {
							finish(tokens);
							return;
						}
						saveAccountAndReturn("epic", tokens);
						finish({
							success: true,
							displayName: tokens.displayName
						});
					} catch (e) {
						finish({ error: e.message });
					}
				}
			});
		});
		ipcMain$9.handle("accounts:epic:import", async () => {
			if (!p?.epic?.importLibrary) return { error: "Epic provider not available" };
			const res = await importWithTokenRefresh("epic");
			if (!res?.error) {
				const installed = scanEpicInstalled();
				if (installed.length > 0) {
					const installedIds = new Set(installed.map((g) => g.platformId).filter(Boolean));
					let changed = false;
					for (const g of ctx.db.games) if (g.platform === "epic") {
						const isInstalled = !!(g.platformId && installedIds.has(g.platformId));
						if (isInstalled && !g.installed) {
							g.installed = true;
							changed = true;
						} else if (!isInstalled && g.installed === void 0) {
							g.installed = false;
							changed = true;
						}
					}
					if (changed) ctx.saveDB(ctx.db);
				}
			}
			return res;
		});
		ipcMain$9.handle("accounts:xbox:auth", async () => {
			const c = a.CONFIG.xbox;
			const oauthState = generateOAuthState();
			return runOAuthFlow({
				partition: "auth:xbox",
				...c.windowSize,
				authUrl: a.buildXboxAuthUrl(oauthState),
				redirectMatch: (url) => url.startsWith(c.redirectUri),
				onRedirect: async (url, finish) => {
					try {
						const { code, error } = extractOAuthCode(url);
						if (error) {
							finish({ error });
							return;
						}
						const tokens = await a.exchangeXboxCode(code);
						if (tokens.error) {
							finish(tokens);
							return;
						}
						saveAccountAndReturn("xbox", tokens);
						finish({
							success: true,
							gamertag: tokens.gamertag,
							avatarUrl: tokens.avatarUrl
						});
					} catch (e) {
						finish({ error: "Xbox auth chain failed: " + e.message });
					}
				}
			});
		});
		ipcMain$9.handle("accounts:xbox:import", async () => {
			if (!p?.xbox?.importLibrary) return { error: "Xbox provider not available" };
			return importWithTokenRefresh("xbox");
		});
		ipcMain$9.handle("accounts:ea:auth", async () => handleLocalProviderAuth("ea", "EA App"));
		ipcMain$9.handle("accounts:battlenet:auth", async () => handleLocalProviderAuth("battlenet", "Battle.net"));
		ipcMain$9.handle("accounts:itchio:auth", async () => handleLocalProviderAuth("itchio", "itch.io"));
		ipcMain$9.handle("accounts:ubisoft:auth", async () => handleLocalProviderAuth("ubisoft", "Ubisoft Connect"));
		ipcMain$9.handle("accounts:ea:import", async () => handleProviderImport("ea"));
		ipcMain$9.handle("accounts:battlenet:import", async () => handleProviderImport("battlenet"));
		ipcMain$9.handle("accounts:itchio:import", async () => handleProviderImport("itchio"));
		ipcMain$9.handle("accounts:ubisoft:import", async () => handleProviderImport("ubisoft"));
	}
	module.exports = {
		detachAccountSecrets,
		registerAccountIpcHandlers
	};
}));
//#endregion
//#region electron/modules/integrations/discord.js
var require_discord = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	var ctx = require_context();
	var log = require_logger();
	var DISCORD_CLIENT_ID = "1338877643523145789";
	var discordRpc = null;
	var discordReady = false;
	var discordCurrentGame = null;
	function connectDiscord$1() {
		if (discordRpc) return;
		try {
			discordRpc = new (require("discord-rpc")).Client({ transport: "ipc" });
			discordRpc.on("ready", () => {
				discordReady = true;
				log.info("discord", "RPC ready");
			});
			discordRpc.login({ clientId: DISCORD_CLIENT_ID }).catch((err) => {
				log.warn("discord", "Could not connect:", err.message);
				discordRpc = null;
			});
		} catch (_e) {
			log.warn("discord", "Init error:", _e.message);
			discordRpc = null;
		}
	}
	function disconnectDiscord() {
		if (discordRpc) {
			try {
				discordRpc.clearActivity();
			} catch (_e) {}
			try {
				discordRpc.destroy();
			} catch (_e) {}
			discordRpc = null;
			discordReady = false;
			discordCurrentGame = null;
		}
	}
	var PLATFORM_LABELS = {
		steam: "Steam",
		epic: "Epic Games",
		gog: "GOG",
		psn: "PlayStation",
		xbox: "Xbox",
		custom: "PC",
		psremote: "PlayStation"
	};
	function setDiscordPresence(gameName, platform, startTimestamp) {
		discordCurrentGame = {
			name: gameName,
			platform,
			startTimestamp: startTimestamp || Date.now()
		};
		if (!discordRpc || !discordReady) return;
		try {
			discordRpc.setActivity({
				details: gameName,
				state: "via " + (PLATFORM_LABELS[platform] || "Cereal Launcher"),
				startTimestamp: discordCurrentGame.startTimestamp,
				largeImageKey: "cereal_logo",
				largeImageText: "Cereal Launcher",
				smallImageKey: platform || "custom",
				smallImageText: PLATFORM_LABELS[platform] || "Game",
				instance: false
			});
		} catch (_e) {
			log.warn("discord", "Presence error:", _e.message);
		}
	}
	function clearDiscordPresence() {
		discordCurrentGame = null;
		if (!discordRpc || !discordReady) return;
		try {
			discordRpc.clearActivity();
		} catch (_e) {}
	}
	function isDiscordEnabled() {
		return !!(ctx.db && ctx.db.settings && ctx.db.settings.discordPresence);
	}
	function getDiscordStatus() {
		return {
			ready: discordReady,
			connected: !!discordRpc
		};
	}
	module.exports = {
		connectDiscord: connectDiscord$1,
		disconnectDiscord,
		setDiscordPresence,
		clearDiscordPresence,
		isDiscordEnabled,
		getDiscordStatus
	};
}));
//#endregion
//#region electron/modules/metadata/metadata.js
var require_metadata = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	var { net: net$4 } = require("electron");
	var ctx = require_context();
	var log = require_logger();
	var METADATA_CACHE = /* @__PURE__ */ new Map();
	var METADATA_CACHE_TTL = 10080 * 60 * 1e3;
	function getMetadataSettings() {
		const s = ctx.db && ctx.db.settings || {};
		let sgdbKey = s.steamGridDbKey || "";
		if (!sgdbKey) try {
			sgdbKey = ctx.safeStore.getPassword("cereal-steamgriddb", "default") || "";
		} catch (_e) {}
		return {
			source: s.metadataSource || "steam",
			steamGridDbKey: sgdbKey
		};
	}
	async function httpGet(url) {
		const resp = await net$4.fetch(url, { headers: {
			"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
			"Accept": "application/json, text/json, */*"
		} });
		if (!resp.ok) throw new Error("HTTP " + resp.status + " from " + url);
		const text = await resp.text();
		return JSON.parse(text);
	}
	async function fetchSteamMetadata(appId) {
		try {
			const info = (await httpGet(`https://store.steampowered.com/api/appdetails?appids=${appId}&l=english`))?.[appId]?.data;
			if (!info) return null;
			let isSoftware = false;
			if (info.type && typeof info.type === "string" && info.type.toLowerCase() !== "game") isSoftware = true;
			if (!isSoftware && info.categories && Array.isArray(info.categories)) try {
				if (info.categories.some((c) => (c.description || "").toLowerCase().includes("software") || (c.description || "").toLowerCase().includes("utility") || (c.description || "").toLowerCase().includes("application"))) isSoftware = true;
			} catch (_e) {}
			if (!isSoftware && info.genres && Array.isArray(info.genres)) try {
				if (info.genres.some((g) => (g.description || "").toLowerCase().includes("software"))) isSoftware = true;
			} catch (_e) {}
			let coverUrl = "";
			const capsuleUrls = [`https://shared.steamstatic.com/store_item_assets/steam/apps/${appId}/library_600x900_2x.jpg`, `https://shared.steamstatic.com/store_item_assets/steam/apps/${appId}/library_600x900.jpg`];
			try {
				const first = (await Promise.allSettled(capsuleUrls.map((url) => net$4.fetch(url, { method: "HEAD" }).then((r) => r.ok ? url : Promise.reject())))).find((r) => r.status === "fulfilled");
				if (first) coverUrl = first.value;
			} catch (_e) {}
			return {
				description: (info.short_description || "").slice(0, 500),
				developer: (info.developers || [])[0] || "",
				publisher: (info.publishers || [])[0] || "",
				releaseDate: info.release_date?.date || "",
				genres: (info.genres || []).map((g) => g.description),
				coverUrl,
				headerUrl: info.header_image || `https://shared.steamstatic.com/store_item_assets/steam/apps/${appId}/library_hero.jpg`,
				screenshots: (info.screenshots || []).slice(0, 4).map((s) => s.path_full),
				metacritic: info.metacritic?.score || null,
				website: info.website || "",
				_source: "steam",
				isSoftware
			};
		} catch (e) {
			log.debug("metadata", "Steam fetch failed for", appId, e.message);
			return null;
		}
	}
	async function fetchSteamSearchMetadata(gameName) {
		try {
			const search = await httpGet(`https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(gameName)}&l=english&cc=US`);
			if (!search?.items?.length) return null;
			const lower = gameName.toLowerCase().replace(/[^a-z0-9]/g, "");
			let best = search.items[0];
			for (const item of search.items) if ((item.name || "").toLowerCase().replace(/[^a-z0-9]/g, "") === lower) {
				best = item;
				break;
			}
			return await fetchSteamMetadata(String(best.id));
		} catch (e) {
			log.debug("metadata", "Steam search failed for", gameName, e.message);
			return null;
		}
	}
	async function fetchWikipediaMetadata(gameName) {
		try {
			const searchData = await httpGet(`https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(gameName + " video game")}&srnamespace=0&srlimit=5&format=json`);
			if (!searchData?.query?.search?.length) return null;
			const lower = gameName.toLowerCase().replace(/[^a-z0-9]/g, "");
			let bestTitle = searchData.query.search[0].title;
			for (const r of searchData.query.search) if (r.title.toLowerCase().replace(/[^a-z0-9]/g, "").replace(/videogame$/, "") === lower) {
				bestTitle = r.title;
				break;
			}
			const title = encodeURIComponent(bestTitle);
			const pages = (await httpGet(`https://en.wikipedia.org/w/api.php?action=query&titles=${title}&prop=extracts|pageimages|revisions&exintro=true&explaintext=true&pithumbsize=600&rvprop=content&rvslots=main&rvsection=0&format=json`))?.query?.pages;
			if (!pages) return null;
			const page = Object.values(pages)[0];
			if (!page || page.missing !== void 0) return null;
			const extract = (page.extract || "").slice(0, 500);
			const thumbUrl = page.thumbnail?.source || "";
			const wikitext = page.revisions?.[0]?.slots?.main?.["*"] || "";
			const infoField = (field) => {
				const re = new RegExp("\\|\\s*" + field + "\\s*=\\s*(.+)", "i");
				const m = wikitext.match(re);
				if (!m) return "";
				return m[1].replace(/\[\[([^|\]]*\|)?([^\]]*)\]\]/g, "$2").replace(/\{\{[^}]*\}\}/g, "").replace(/<[^>]+>/g, "").trim();
			};
			const developer = infoField("developer");
			const publisher = infoField("publisher");
			const released = infoField("released") || infoField("release_date");
			const genreRaw = infoField("genre");
			const genres = genreRaw ? genreRaw.split(/[,;]/).map((g) => g.trim()).filter(Boolean).slice(0, 5) : [];
			if (!extract && !developer) return null;
			return {
				description: extract,
				developer,
				publisher,
				releaseDate: released.replace(/\{\{.*?\}\}/g, "").trim().slice(0, 30),
				genres,
				coverUrl: thumbUrl,
				headerUrl: "",
				screenshots: [],
				metacritic: null,
				website: `https://en.wikipedia.org/wiki/${title}`,
				_source: "wikipedia"
			};
		} catch (e) {
			log.debug("metadata", "Wikipedia fetch failed for", gameName, e.message);
			return null;
		}
	}
	async function fetchSteamGridDBArt(gameName, apiKey) {
		if (!apiKey) return null;
		try {
			const q = encodeURIComponent(gameName);
			const sgdbFetch = async (endpoint) => {
				const resp = await net$4.fetch(endpoint, { headers: { "Authorization": "Bearer " + apiKey } });
				if (!resp.ok) throw new Error("SGDB HTTP " + resp.status);
				return resp.json();
			};
			const searchData = await sgdbFetch(`https://www.steamgriddb.com/api/v2/search/autocomplete/${q}`);
			if (!searchData?.success || !searchData?.data?.length) return null;
			const gameId = searchData.data[0].id;
			const [covers, heroes] = await Promise.allSettled([sgdbFetch(`https://www.steamgriddb.com/api/v2/grids/game/${gameId}?dimensions=600x900&limit=1`), sgdbFetch(`https://www.steamgriddb.com/api/v2/heroes/game/${gameId}?limit=1`)]);
			const coverUrl = covers.status === "fulfilled" && covers.value?.data?.[0]?.url || "";
			const headerUrl = heroes.status === "fulfilled" && heroes.value?.data?.[0]?.url || "";
			if (coverUrl || headerUrl) return {
				coverUrl,
				headerUrl
			};
			return null;
		} catch (e) {
			log.debug("metadata", "SteamGridDB art fetch failed for", gameName, e.message);
			return null;
		}
	}
	async function fetchGameMetadata(game) {
		if (!game || !game.name) return null;
		const cacheKey = (game.platform || "") + ":" + (game.platformId || game.name);
		const cached = METADATA_CACHE.get(cacheKey);
		if (cached && Date.now() - cached.timestamp < METADATA_CACHE_TTL) return cached.data;
		const ms = getMetadataSettings();
		let meta = null;
		if (game.platform === "steam") {
			if (game.platformId) meta = await fetchSteamMetadata(game.platformId);
			if (!meta) meta = await fetchSteamSearchMetadata(game.name);
		}
		if (!meta) if (ms.source === "wikipedia") {
			meta = await fetchWikipediaMetadata(game.name);
			if (!meta) meta = await fetchSteamSearchMetadata(game.name);
		} else {
			meta = await fetchSteamSearchMetadata(game.name);
			if (!meta) meta = await fetchWikipediaMetadata(game.name);
		}
		if (meta && ms.steamGridDbKey) try {
			const art = await fetchSteamGridDBArt(game.name, ms.steamGridDbKey);
			if (art) {
				if (art.coverUrl && !meta.coverUrl) meta.coverUrl = art.coverUrl;
				else if (art.coverUrl) meta.sgdbCoverUrl = art.coverUrl;
				if (art.headerUrl) meta.headerUrl = art.headerUrl;
			}
		} catch (_e) {}
		if (meta) METADATA_CACHE.set(cacheKey, {
			data: meta,
			timestamp: Date.now()
		});
		return meta;
	}
	function applyMetadataToGame(game, meta) {
		if (!meta) return false;
		let changed = false;
		if (!game.coverUrl && meta.coverUrl) {
			game.coverUrl = meta.coverUrl;
			changed = true;
		}
		if (!game.sgdbCoverUrl && meta.sgdbCoverUrl) {
			game.sgdbCoverUrl = meta.sgdbCoverUrl;
			changed = true;
		}
		if (!game.description && meta.description) {
			game.description = meta.description;
			changed = true;
		}
		if (!game.developer && meta.developer) {
			game.developer = meta.developer;
			changed = true;
		}
		if (!game.publisher && meta.publisher) {
			game.publisher = meta.publisher;
			changed = true;
		}
		if (!game.releaseDate && meta.releaseDate) {
			game.releaseDate = meta.releaseDate;
			changed = true;
		}
		if ((!game.categories || game.categories.length === 0) && meta.genres?.length) {
			game.categories = meta.genres;
			changed = true;
		}
		if (!game.headerUrl) {
			const headerFallback = meta.headerUrl || meta.coverUrl || meta.screenshots && meta.screenshots[0] || "";
			if (headerFallback) {
				game.headerUrl = headerFallback;
				changed = true;
			}
		}
		if ((!game.screenshots || game.screenshots.length === 0) && meta.screenshots?.length) {
			game.screenshots = meta.screenshots;
			changed = true;
		}
		if (game.metacritic == null && meta.metacritic != null) {
			game.metacritic = meta.metacritic;
			changed = true;
		}
		if (!game.website && meta.website) {
			game.website = meta.website;
			changed = true;
		}
		try {
			const existing = (game.categories || []).filter(Boolean).map((c) => String(c).trim());
			const add = [];
			if (meta.genres && Array.isArray(meta.genres)) {
				for (const g of meta.genres) if (g) add.push(String(g).trim());
			}
			if (meta.categories && Array.isArray(meta.categories)) {
				for (const c of meta.categories) if (c) add.push(String(c).trim());
			}
			if (meta.type && typeof meta.type === "string") {
				const t = meta.type.trim();
				if (t && t.toLowerCase() !== "game") add.push(t.charAt(0).toUpperCase() + t.slice(1));
			}
			if (add.length > 0) {
				const merged = Array.from(new Map([...existing, ...add].map((x) => [x.toLowerCase(), x])).values());
				const existingNorm = existing.map((x) => x.toLowerCase()).join("|");
				if (merged.map((x) => x.toLowerCase()).join("|") !== existingNorm) {
					game.categories = merged;
					changed = true;
				}
			}
		} catch (_e) {}
		if (meta._source === "steam" && meta.isSoftware) {
			if (!game.software) {
				game.software = true;
				changed = true;
			}
			try {
				const cats = game.categories || [];
				if (!cats.some((c) => typeof c === "string" && c.toLowerCase() === "software")) {
					game.categories = [...cats, "Software"];
					changed = true;
				}
			} catch (_e) {}
		}
		return changed;
	}
	function invalidateMetadataCache(cacheKey) {
		METADATA_CACHE.delete(cacheKey);
	}
	module.exports = {
		httpGet,
		fetchSteamMetadata,
		fetchSteamSearchMetadata,
		fetchWikipediaMetadata,
		fetchSteamGridDBArt,
		fetchGameMetadata,
		applyMetadataToGame,
		getMetadataSettings,
		invalidateMetadataCache
	};
}));
//#endregion
//#region electron/modules/games/covers.js
var require_covers = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	var { app: app$4, net: net$3 } = require("electron");
	var path$8 = require("path");
	var fs$7 = require("fs");
	var ctx = require_context();
	var { fetchGameMetadata, applyMetadataToGame } = require_metadata();
	var log = require_logger();
	var _coversDir = null;
	function getCoversDir() {
		if (_coversDir) return _coversDir;
		const dir = path$8.join(app$4.getPath("userData"), "covers");
		try {
			fs$7.mkdirSync(dir, { recursive: true });
		} catch (e) {
			log.warn("covers", "Failed to create covers directory:", e.message);
		}
		_coversDir = dir;
		return _coversDir;
	}
	async function downloadToFile(url, destPath) {
		try {
			const resp = await net$3.fetch(url);
			if (!resp.ok) throw new Error("HTTP " + resp.status);
			const buf = Buffer.from(await resp.arrayBuffer());
			if (buf.length < 1024) throw new Error("File too small (" + buf.length + " bytes)");
			fs$7.writeFileSync(destPath, buf);
			return true;
		} catch (e) {
			cleanupFile(destPath);
			throw e;
		}
	}
	function cleanupFile(p) {
		try {
			if (fs$7.existsSync(p)) fs$7.unlinkSync(p);
		} catch (_e) {}
	}
	function isValidLocalFile(p) {
		try {
			return !!p && fs$7.existsSync(p) && fs$7.statSync(p).size >= 1024;
		} catch (_e) {
			return false;
		}
	}
	var coverQueue = /* @__PURE__ */ new Set();
	var coverRetries = /* @__PURE__ */ new Map();
	var MAX_COVER_RETRIES = 2;
	var coverWorkerRunning = false;
	function enqueueCoverFetch(gameId) {
		if (!gameId) return;
		coverQueue.add(gameId);
		if (!coverWorkerRunning) processCoverQueue();
	}
	async function processCoverQueue() {
		coverWorkerRunning = true;
		const coversDir = getCoversDir();
		const db = ctx.db;
		while (coverQueue.size > 0) {
			const batch = [];
			for (const id of coverQueue) {
				batch.push(id);
				if (batch.length >= 5) break;
			}
			for (const id of batch) coverQueue.delete(id);
			let anyChanged = false;
			await Promise.allSettled(batch.map(async (gid) => {
				try {
					const game = db.games.find((g) => g.id === gid);
					if (!game) return;
					if (!isValidLocalFile(game.localCoverPath)) {
						if (game.localCoverPath) {
							cleanupFile(game.localCoverPath);
							game.localCoverPath = null;
						}
						let candidates = [game.coverUrl, game.sgdbCoverUrl].filter(Boolean);
						let downloaded = false;
						for (const coverUrl of candidates) try {
							const ext = path$8.extname(new URL(coverUrl).pathname).split("?")[0] || ".jpg";
							const dest = path$8.join(coversDir, "cover_" + gid + ext);
							await downloadToFile(coverUrl, dest);
							game.localCoverPath = dest;
							game._imgStamp = Date.now();
							anyChanged = true;
							coverRetries.delete(gid);
							downloaded = true;
							break;
						} catch (_e) {}
						if (!downloaded && !game.headerUrl) try {
							const meta = await fetchGameMetadata(game);
							if (meta) {
								applyMetadataToGame(game, meta);
								anyChanged = true;
								if (game.coverUrl && !candidates.includes(game.coverUrl)) try {
									const ext = path$8.extname(new URL(game.coverUrl).pathname).split("?")[0] || ".jpg";
									const dest = path$8.join(coversDir, "cover_" + gid + ext);
									await downloadToFile(game.coverUrl, dest);
									game.localCoverPath = dest;
									game._imgStamp = Date.now();
									coverRetries.delete(gid);
									downloaded = true;
								} catch (_e) {}
							}
						} catch (_e) {}
						if (!downloaded) {
							const total = [game.coverUrl, game.sgdbCoverUrl].filter(Boolean).length;
							if (total > 0) throw new Error("All cover URLs failed (" + total + " candidates)");
						}
					}
					if (!isValidLocalFile(game.localHeaderPath)) {
						if (game.localHeaderPath) {
							cleanupFile(game.localHeaderPath);
							game.localHeaderPath = null;
						}
						const headerUrl = game.headerUrl;
						if (headerUrl) {
							const ext = path$8.extname(new URL(headerUrl).pathname).split("?")[0] || ".jpg";
							const dest = path$8.join(coversDir, "header_" + gid + ext);
							await downloadToFile(headerUrl, dest);
							game.localHeaderPath = dest;
							game._imgStamp = Date.now();
							anyChanged = true;
						}
					}
				} catch (e) {
					log.warn("covers", "download failed for", gid, e && e.message);
					const retries = (coverRetries.get(gid) || 0) + 1;
					if (retries <= MAX_COVER_RETRIES) {
						coverRetries.set(gid, retries);
						coverQueue.add(gid);
					} else coverRetries.delete(gid);
				}
			}));
			if (anyChanged) {
				ctx.saveDB(db);
				ctx.sendToRenderer("games:refresh", db.games);
			}
			ctx.sendToRenderer("cover:progress", {
				remaining: coverQueue.size,
				downloaded: anyChanged ? batch.length : 0
			});
			if (coverQueue.size > 0) await new Promise((r) => setTimeout(r, 150));
		}
		ctx.sendToRenderer("cover:progress", {
			remaining: 0,
			done: true
		});
		coverWorkerRunning = false;
	}
	module.exports = {
		getCoversDir,
		cleanupFile,
		enqueueCoverFetch
	};
}));
//#endregion
//#region electron/modules/integrations/chiaki.js
var require_chiaki = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	var path$7 = require("path");
	var fs$6 = require("fs");
	var readline = require("readline");
	var { spawn: spawn$2 } = require("child_process");
	var dgram = require("dgram");
	var os$1 = require("os");
	var { screen: electronScreen, app: app$3, ipcMain: ipcMain$8, net: net$2 } = require("electron");
	var ctx = require_context();
	var { CONTROL_BAR_HEIGHT, CHIAKI_SYSTEM_PATHS } = require_constants();
	var { connectDiscord, setDiscordPresence, clearDiscordPresence, isDiscordEnabled } = require_discord();
	var log = require_logger();
	var { getScriptPath, getResourcePath } = require_paths();
	function getChiakiDir() {
		const userData = path$7.join(app$3.getPath("userData"), "chiaki-ng");
		if (fs$6.existsSync(userData)) return userData;
		const dev = getResourcePath("chiaki-ng");
		if (fs$6.existsSync(dev)) return dev;
		return null;
	}
	function getBundledChiakiExe() {
		const dir = getChiakiDir();
		log.info("chiaki", "[getBundledChiakiExe] dir: " + dir);
		if (!dir) return null;
		const candidates = ["chiaki.exe", "chiaki-ng.exe"];
		for (const name of candidates) {
			const p = path$7.join(dir, name);
			const exists = fs$6.existsSync(p);
			log.info("chiaki", "[getBundledChiakiExe] checking: " + p + " exists: " + exists);
			if (exists) return p;
		}
		try {
			const entries = fs$6.readdirSync(dir, { withFileTypes: true });
			log.info("chiaki", "[getBundledChiakiExe] subdirectories: " + entries.filter((e) => e.isDirectory()).map((e) => e.name).join(", "));
			for (const entry of entries) if (entry.isDirectory()) for (const name of candidates) {
				const p = path$7.join(dir, entry.name, name);
				const exists = fs$6.existsSync(p);
				log.info("chiaki", "[getBundledChiakiExe] checking subdir: " + p + " exists: " + exists);
				if (exists) return p;
			}
		} catch (_e) {}
		log.info("chiaki", "[getBundledChiakiExe] no exe found");
		return null;
	}
	function getBundledChiakiVersion() {
		const dir = getChiakiDir();
		if (!dir) return null;
		const vf = path$7.join(dir, ".version");
		try {
			return fs$6.readFileSync(vf, "utf-8").trim();
		} catch (_e) {
			return null;
		}
	}
	var chiakiSessions = /* @__PURE__ */ new Map();
	function resolveChiakiExe(fallbackPath) {
		const bundled = getBundledChiakiExe();
		if (bundled) return bundled;
		return [
			...CHIAKI_SYSTEM_PATHS,
			path$7.join(process.env.ProgramFiles || "", "chiaki-ng", "chiaki-ng.exe"),
			path$7.join(process.env.LOCALAPPDATA || "", "chiaki-ng", "chiaki-ng.exe"),
			fallbackPath
		].filter(Boolean).find((p) => p && fs$6.existsSync(p)) || null;
	}
	function buildChiakiArgs(game, config) {
		const nickname = game.chiakiNickname || game.chiakiProfile || "";
		const host = game.chiakiHost || "";
		if (!host) return [];
		const args = ["stream"];
		args.push(nickname || "default");
		args.push(host);
		if (game.chiakiRegistKey) args.push("--registkey", game.chiakiRegistKey);
		if (game.chiakiMorning) args.push("--morning", game.chiakiMorning);
		if (game.chiakiProfile) args.push("--profile", game.chiakiProfile);
		args.push("--exit-app-on-stream-exit");
		const displayMode = game.chiakiDisplayMode || config?.displayMode || "fullscreen";
		if (displayMode === "zoom") args.push("--zoom");
		else if (displayMode === "stretch") args.push("--stretch");
		else args.push("--fullscreen");
		if (game.chiakiDualsense || config?.dualsense) args.push("--dualsense");
		if (game.chiakiPasscode) args.push("--passcode", game.chiakiPasscode);
		return args;
	}
	function sendStreamEvent(gameId, type, data) {
		ctx.sendToRenderer("chiaki:event", {
			gameId,
			type,
			...data
		});
	}
	function sendChiakiEvent(gameId, type, data) {
		sendStreamEvent(gameId, type, {
			platform: "psn",
			...data
		});
	}
	function startChiakiSession(gameId, chiakiExe, args) {
		stopChiakiSession(gameId);
		const chiakiDir = path$7.dirname(chiakiExe);
		const env = {
			...process.env,
			PATH: `${chiakiDir};${process.env.PATH}`
		};
		const session = {
			gameId,
			process: null,
			state: "launching",
			startTime: Date.now(),
			streamInfo: {},
			quality: {},
			lastEvent: null,
			exitCode: null
		};
		if (args.length === 0) {
			session.process = spawn$2(chiakiExe, [], {
				cwd: chiakiDir,
				env,
				detached: true,
				stdio: "ignore"
			});
			session.process.unref();
			session.state = "gui";
			chiakiSessions.set(gameId, session);
			sendChiakiEvent(gameId, "state", { state: "gui" });
			return session;
		}
		session.process = spawn$2(chiakiExe, args, {
			cwd: chiakiDir,
			env,
			stdio: [
				"ignore",
				"pipe",
				"pipe"
			]
		});
		let stderrBuf = "";
		const processLine = (line) => {
			const trimmed = line.trim();
			if (!trimmed) return;
			if (trimmed.startsWith("{")) try {
				handleChiakiJsonEvent(gameId, JSON.parse(trimmed));
				return;
			} catch (_e) {}
			handleChiakiLogLine(gameId, trimmed);
		};
		readline.createInterface({ input: session.process.stdout }).on("line", processLine);
		readline.createInterface({ input: session.process.stderr }).on("line", (line) => {
			stderrBuf += line + "\n";
			if (stderrBuf.length > 4096) stderrBuf = stderrBuf.slice(-4096);
			processLine(line);
		});
		session.process.on("exit", (code, signal) => {
			session.exitCode = code;
			session.state = "disconnected";
			stopEmbedHelper(session);
			let reason = "unknown";
			let wasError = true;
			if (code === 0) {
				reason = "clean_exit";
				wasError = false;
			} else if (signal) {
				reason = "killed";
				wasError = false;
			} else reason = "error";
			const elapsed = Math.floor((Date.now() - session.startTime) / 6e4);
			sendChiakiEvent(gameId, "disconnected", {
				reason,
				wasError,
				exitCode: code,
				signal,
				sessionMinutes: elapsed,
				stderr: wasError ? stderrBuf.slice(-1024) : ""
			});
			if (isDiscordEnabled()) clearDiscordPresence();
			const trackId = session._currentGameId || gameId;
			const titleElapsed = session._titleStartTime ? Math.floor((Date.now() - session._titleStartTime) / 6e4) : 0;
			if (titleElapsed > 0 && ctx.db) {
				const game = ctx.db.games.find((g) => g.id === trackId);
				if (game) {
					game.playtimeMinutes = (game.playtimeMinutes || 0) + titleElapsed;
					game.lastPlayed = (/* @__PURE__ */ new Date()).toISOString();
					ctx.saveDB(ctx.db);
					ctx.sendToRenderer("games:refresh", ctx.db.games);
				}
			}
			const isAuthError = stderrBuf.toLowerCase().includes("regist failed") || stderrBuf.toLowerCase().includes("auth") || stderrBuf.toLowerCase().includes("invalid psn");
			const reconnectAttempts = session._reconnectAttempts || 0;
			if (code !== 0 && !isAuthError && reconnectAttempts < 5) {
				const nextAttempt = reconnectAttempts + 1;
				const delay = Math.min(1e3 * Math.pow(2, nextAttempt - 1), 16e3);
				sendChiakiEvent(gameId, "reconnecting", {
					attempt: nextAttempt,
					maxAttempts: 5,
					delayMs: delay
				});
				const carryReconnect = nextAttempt;
				session._reconnectTimer = setTimeout(() => {
					if (chiakiSessions.has(gameId)) {
						const newSession = startChiakiSession(gameId, chiakiExe, args);
						if (newSession) newSession._reconnectAttempts = carryReconnect;
					}
				}, delay);
			} else chiakiSessions.delete(gameId);
		});
		session._reconnectAttempts = 0;
		session._currentTitleId = null;
		session._currentGameId = gameId;
		session._titleStartTime = Date.now();
		session.embedded = false;
		chiakiSessions.set(gameId, session);
		sendChiakiEvent(gameId, "state", { state: "launching" });
		startEmbedHelper(gameId, session);
		if (isDiscordEnabled()) {
			const game = ctx.db.games.find((g) => g.id === gameId);
			if (game) {
				connectDiscord();
				setDiscordPresence(game.name, game.platform);
			}
		}
		return session;
	}
	function stopChiakiSession(gameId) {
		const session = chiakiSessions.get(gameId);
		if (!session) return false;
		if (session._reconnectTimer) clearTimeout(session._reconnectTimer);
		stopEmbedHelper(session);
		if (session.process && !session.process.killed && session.process.exitCode === null) try {
			if (process.platform === "win32") spawn$2("taskkill", [
				"/pid",
				String(session.process.pid),
				"/t",
				"/f"
			], {
				stdio: "ignore",
				windowsHide: true
			}).on("error", () => {});
			else session.process.kill("SIGTERM");
			setTimeout(() => {
				try {
					if (!session.process.killed) session.process.kill("SIGKILL");
				} catch (_e) {}
			}, 3e3);
		} catch (_e) {}
		chiakiSessions.delete(gameId);
		return true;
	}
	function getStreamBounds() {
		const [cw, ch] = ctx.mainWindow ? ctx.mainWindow.getContentSize() : [1280, 720];
		let sf = 1;
		try {
			const winBounds = ctx.mainWindow.getBounds();
			sf = electronScreen.getDisplayNearestPoint({
				x: winBounds.x + winBounds.width / 2,
				y: winBounds.y + winBounds.height / 2
			}).scaleFactor || 1;
		} catch (_e) {}
		const barH = Math.round(CONTROL_BAR_HEIGHT * sf);
		return {
			x: 0,
			y: barH,
			w: Math.round(cw * sf),
			h: Math.max(1, Math.round(ch * sf) - barH)
		};
	}
	function startEmbedHelper(gameId, session) {
		if (process.platform !== "win32") return;
		if (!ctx.mainWindow || !session.process) return;
		const hwnd = ctx.mainWindow.getNativeWindowHandle().readBigUInt64LE(0).toString();
		const b = getStreamBounds();
		const psScript = getScriptPath("win32-stream.ps1");
		if (!fs$6.existsSync(psScript)) {
			log.warn("chiaki", "win32-stream.ps1 not found, skipping embed");
			return;
		}
		const ps = spawn$2("powershell.exe", [
			"-NoProfile",
			"-ExecutionPolicy",
			"Bypass",
			"-File",
			psScript,
			"-ChiakiPid",
			String(session.process.pid),
			"-ParentHwnd",
			hwnd,
			"-X",
			String(b.x),
			"-Y",
			String(b.y),
			"-W",
			String(b.w),
			"-H",
			String(b.h)
		], { stdio: [
			"pipe",
			"pipe",
			"pipe"
		] });
		session.embedProcess = ps;
		readline.createInterface({ input: ps.stdout }).on("line", (line) => {
			const trimmed = line.trim();
			if (trimmed === "ready") {
				session.embedded = true;
				sendChiakiEvent(gameId, "embedded", { embedded: true });
			} else if (trimmed.startsWith("error:")) {
				log.error("win32-stream", trimmed);
				sendChiakiEvent(gameId, "embedded", {
					embedded: false,
					error: trimmed
				});
			}
		});
		ps.stderr.on("data", (d) => log.error("win32-stream", d.toString().trimEnd()));
		ps.on("exit", () => {
			session.embedProcess = null;
		});
	}
	function stopEmbedHelper(session) {
		if (!session.embedProcess) return;
		const ps = session.embedProcess;
		session.embedProcess = null;
		try {
			ps.stdin.write("exit\n");
		} catch (_e) {}
		setTimeout(() => {
			try {
				if (!ps.killed) ps.kill();
			} catch (_e) {}
		}, 500);
	}
	function sendEmbedBoundsToAll() {
		if (!ctx.mainWindow) return;
		const b = getStreamBounds();
		for (const session of chiakiSessions.values()) if (session.embedProcess && !session.embedProcess.killed) try {
			session.embedProcess.stdin.write(`bounds ${b.x} ${b.y} ${b.w} ${b.h}\n`);
		} catch (_e) {}
	}
	function handleChiakiJsonEvent(gameId, evt) {
		const session = chiakiSessions.get(gameId);
		if (!session) return;
		session.lastEvent = evt;
		switch (evt.event) {
			case "connecting":
				session.state = "connecting";
				sendChiakiEvent(gameId, "state", {
					state: "connecting",
					host: evt.host,
					console: evt.console
				});
				break;
			case "streaming":
				session.state = "streaming";
				session.streamInfo = {
					resolution: evt.resolution,
					codec: evt.codec,
					fps: evt.fps
				};
				sendChiakiEvent(gameId, "state", {
					state: "streaming",
					...session.streamInfo
				});
				break;
			case "quality":
				session.quality = {
					bitrate: evt.bitrate_mbps,
					packetLoss: evt.packet_loss,
					fpsActual: evt.fps_actual,
					latencyMs: evt.latency_ms
				};
				sendChiakiEvent(gameId, "quality", session.quality);
				break;
			case "title_change":
				handleChiakiTitleChange(gameId, evt);
				break;
			case "disconnected":
				session.state = "disconnected";
				sendChiakiEvent(gameId, "chiaki_disconnect", {
					reason: evt.reason,
					wasError: evt.was_error
				});
				break;
			default: sendChiakiEvent(gameId, "event", evt);
		}
	}
	function handleChiakiTitleChange(originalGameId, evt) {
		const session = chiakiSessions.get(originalGameId);
		if (!session) return;
		const titleId = (evt.title_id || "").trim();
		const titleName = (evt.title_name || "").trim();
		const now = Date.now();
		if (session._currentTitleId === titleId) return;
		if (session._currentGameId && session._titleStartTime) {
			const elapsed = Math.floor((now - session._titleStartTime) / 6e4);
			if (elapsed > 0) {
				const prev = ctx.db.games.find((g) => g.id === session._currentGameId);
				if (prev) {
					prev.playtimeMinutes = (prev.playtimeMinutes || 0) + elapsed;
					prev.lastPlayed = (/* @__PURE__ */ new Date()).toISOString();
					ctx.saveDB(ctx.db);
					ctx.sendToRenderer("games:refresh", ctx.db.games);
				}
			}
		}
		session._currentTitleId = titleId;
		session._titleStartTime = now;
		if (!titleId) {
			session._currentGameId = null;
			if (isDiscordEnabled()) clearDiscordPresence();
			sendChiakiEvent(originalGameId, "title_change", {
				titleId: "",
				titleName: "",
				gameId: null
			});
			return;
		}
		let matchedGame = ctx.db.games.find((g) => g.platform === "psn" && g.platformId && g.platformId.toUpperCase() === titleId.toUpperCase());
		if (!matchedGame && titleName) {
			const lower = titleName.toLowerCase();
			matchedGame = ctx.db.games.find((g) => g.platform === "psn" && g.name && g.name.toLowerCase() === lower);
		}
		if (!matchedGame && titleName) {
			matchedGame = {
				id: Date.now().toString(36) + Math.random().toString(36).substring(2, 7),
				name: titleName,
				platform: "psn",
				platformId: titleId,
				categories: [],
				coverUrl: "",
				playtimeMinutes: 0,
				lastPlayed: (/* @__PURE__ */ new Date()).toISOString(),
				addedAt: (/* @__PURE__ */ new Date()).toISOString(),
				favorite: false,
				chiakiNickname: (ctx.db.games.find((g) => g.id === originalGameId) || {}).chiakiNickname || "",
				chiakiHost: (ctx.db.games.find((g) => g.id === originalGameId) || {}).chiakiHost || ""
			};
			ctx.db.games.push(matchedGame);
			ctx.saveDB(ctx.db);
			ctx.sendToRenderer("games:refresh", ctx.db.games);
		}
		if (matchedGame && !matchedGame.platformId && titleId) {
			matchedGame.platformId = titleId;
			ctx.saveDB(ctx.db);
			ctx.sendToRenderer("games:refresh", ctx.db.games);
		}
		session._currentGameId = matchedGame ? matchedGame.id : null;
		if (isDiscordEnabled() && matchedGame) setDiscordPresence(matchedGame.name, "psn", session.startTime);
		sendChiakiEvent(originalGameId, "title_change", {
			titleId,
			titleName,
			gameId: matchedGame ? matchedGame.id : null,
			gameName: matchedGame ? matchedGame.name : titleName
		});
	}
	function handleChiakiLogLine(gameId, line) {
		const session = chiakiSessions.get(gameId);
		if (!session) return;
		const lower = line.toLowerCase();
		if (lower.includes("starting session request") || lower.includes("starting ctrl")) {
			if (session.state !== "streaming") {
				session.state = "connecting";
				sendChiakiEvent(gameId, "state", { state: "connecting" });
			}
		} else if (lower.includes("senkusha completed successfully") || lower.includes("streamconnection completed") || lower.includes("stream connection started") || lower.includes("video decoder")) {
			if (session.state !== "streaming") {
				session.state = "streaming";
				session._reconnectAttempts = 0;
				sendChiakiEvent(gameId, "state", { state: "streaming" });
			}
		} else if (lower.includes("session has quit") || lower.includes("ctrl stopped")) {} else if (lower.includes("ctrl has failed") || lower.includes("streamconnection run failed") || lower.includes("remote disconnected")) sendChiakiEvent(gameId, "log", {
			level: "error",
			message: line
		});
	}
	function getActiveSessions() {
		return Object.fromEntries([...chiakiSessions].map(([gameId, s]) => [gameId, {
			state: s.state,
			startTime: s.startTime,
			streamInfo: s.streamInfo || {},
			quality: s.quality || {},
			exitCode: s.exitCode,
			reconnectAttempts: s._reconnectAttempts || 0
		}]));
	}
	function autoSetupChiakiIfMissing() {
		if (getBundledChiakiExe()) return;
		if (CHIAKI_SYSTEM_PATHS.some((p) => fs$6.existsSync(p))) return;
		log.info("chiaki", "Not found — starting automatic setup...");
		ctx.sendToRenderer("chiaki:event", { type: "setup_started" });
		const scriptPath = getScriptPath("setup-chiaki.ps1");
		if (!fs$6.existsSync(scriptPath)) {
			log.warn("chiaki", "setup-chiaki.ps1 not found, skipping auto-setup");
			return;
		}
		const SETUP_TIMEOUT = 300 * 1e3;
		const child = spawn$2("powershell", [
			"-ExecutionPolicy",
			"Bypass",
			"-File",
			scriptPath,
			"-InstallDir",
			path$7.join(app$3.getPath("userData"), "chiaki-ng")
		], {
			cwd: path$7.dirname(scriptPath),
			stdio: "pipe"
		});
		let output = "";
		let finished = false;
		const setupTimer = setTimeout(() => {
			if (finished) return;
			finished = true;
			try {
				child.kill();
			} catch (_e) {}
			log.error("chiaki", "Auto-setup timed out after 5 minutes");
			ctx.sendToRenderer("chiaki:event", {
				type: "setup_failed",
				error: "Setup timed out after 5 minutes"
			});
		}, SETUP_TIMEOUT);
		child.stdout.on("data", (d) => output += d.toString());
		child.stderr.on("data", (d) => output += d.toString());
		child.on("close", (code) => {
			if (finished) return;
			finished = true;
			clearTimeout(setupTimer);
			if (code === 0) {
				const version = getBundledChiakiVersion();
				log.info("chiaki", `Auto-setup complete — v${version}`);
				ctx.sendToRenderer("chiaki:event", {
					type: "setup_complete",
					version
				});
			} else {
				log.error("chiaki", `Auto-setup failed (exit ${code}):`, output);
				ctx.sendToRenderer("chiaki:event", {
					type: "setup_failed",
					error: `Setup exited with code ${code}`
				});
			}
		});
		child.on("error", (err) => {
			if (finished) return;
			finished = true;
			clearTimeout(setupTimer);
			log.error("chiaki", "Auto-setup spawn error:", err.message);
		});
	}
	function registerChiakiIpcHandlers() {
		const saveDB = () => ctx.saveDB?.(ctx.db);
		ipcMain$8.handle("chiaki:setStreamBounds", (event, { gameId, x, y, width, height }) => {
			const session = chiakiSessions.get(gameId);
			if (session?.embedProcess && !session.embedProcess.killed) try {
				session.embedProcess.stdin.write(`bounds ${x} ${y} ${width} ${height}\n`);
			} catch (_e) {}
			return { success: true };
		});
		ipcMain$8.handle("chiaki:status", () => {
			const dir = getChiakiDir();
			const bundledExe = getBundledChiakiExe();
			const bundledVersion = getBundledChiakiVersion();
			log.info("chiaki", "[chiaki:status] dir: " + dir + " exe: " + bundledExe + " version: " + bundledVersion);
			if (dir) try {
				const entries = fs$6.readdirSync(dir);
				log.info("chiaki", "[chiaki:status] entries in dir: " + entries.join(", "));
			} catch (e) {
				log.info("chiaki", "[chiaki:status] error reading dir: " + e.message);
			}
			if (bundledExe) return {
				status: "bundled",
				executablePath: bundledExe,
				version: bundledVersion,
				directory: getChiakiDir()
			};
			for (const p of CHIAKI_SYSTEM_PATHS) if (fs$6.existsSync(p)) return {
				status: "system",
				executablePath: p,
				version: null
			};
			return {
				status: "missing",
				executablePath: null,
				version: null
			};
		});
		ipcMain$8.handle("chiaki:checkUpdate", async () => {
			try {
				const repo = process.env.CHIAKI_RELEASE_REPO || "streetpea/chiaki-ng";
				const res = await net$2.fetch(`https://api.github.com/repos/${repo}/releases/latest`, { headers: { "User-Agent": "cereal-launcher" } });
				if (!res.ok) throw new Error(`GitHub API returned ${res.status}`);
				const data = await res.json();
				const latestTag = data.tag_name || null;
				const currentVersion = getBundledChiakiVersion();
				return {
					current: currentVersion,
					latest: latestTag,
					hasUpdate: !!(latestTag && (!currentVersion || latestTag !== currentVersion)),
					releaseName: data.name || latestTag
				};
			} catch (e) {
				return { error: e.message };
			}
		});
		ipcMain$8.handle("chiaki:update", async () => {
			try {
				const scriptPath = getScriptPath("setup-chiaki.ps1");
				if (!fs$6.existsSync(scriptPath)) return { error: "setup-chiaki.ps1 not found at: " + scriptPath };
				const chiakiInstallDir = path$7.join(app$3.getPath("userData"), "chiaki-ng");
				const SETUP_TIMEOUT = 300 * 1e3;
				return new Promise((resolve) => {
					const child = spawn$2("powershell", [
						"-ExecutionPolicy",
						"Bypass",
						"-File",
						scriptPath,
						"-Force",
						"-InstallDir",
						chiakiInstallDir
					], {
						cwd: path$7.dirname(scriptPath),
						stdio: "pipe"
					});
					let output = "";
					let resolved = false;
					const finish = (result) => {
						if (resolved) return;
						resolved = true;
						clearTimeout(timer);
						resolve(result);
					};
					const timer = setTimeout(() => {
						try {
							child.kill();
						} catch (_e) {}
						finish({ error: "Setup timed out after 5 minutes" });
					}, SETUP_TIMEOUT);
					child.stdout.on("data", (d) => {
						const text = d.toString();
						output += text;
						for (const raw of text.split("\n")) {
							const line = raw.trim();
							if (!line) continue;
							let phase = "working", percent = 15;
							if (line.startsWith("Fetching")) {
								phase = "fetching";
								percent = 10;
							} else if (line.startsWith("Downloading")) {
								phase = "downloading";
								const m = line.match(/(\d+\.?\d*)\s*\/\s*(\d+\.?\d*)\s*MB/);
								percent = m ? Math.round(30 + parseFloat(m[1]) / parseFloat(m[2]) * 48) : 30;
							} else if (line.startsWith("Using .NET extraction") || line.startsWith("Found ") || line.startsWith("Extracting file")) {
								phase = "extracting";
								const m = line.match(/(\d+)\s*\/\s*(\d+)/);
								percent = m ? Math.round(80 + parseInt(m[1]) / parseInt(m[2]) * 19) : 85;
							} else if (line.startsWith("Flattening")) {
								phase = "extracting";
								percent = 98;
							} else if (line.startsWith("Found executable") || line.startsWith("chiaki-ng ")) {
								phase = "done";
								percent = 100;
							}
							ctx.sendToRenderer("chiaki:installProgress", {
								phase,
								message: line,
								percent
							});
						}
					});
					child.stderr.on("data", (d) => output += d.toString());
					child.on("close", (code) => {
						log.info("chiaki", "[chiaki:update] child closed with code: " + code);
						if (code === 0) {
							const newVersion = getBundledChiakiVersion();
							const newExe = getBundledChiakiExe();
							const newDir = getChiakiDir();
							log.info("chiaki", "[chiaki:update] success - dir: " + newDir + " exe: " + newExe + " version: " + newVersion);
							finish({
								ok: true,
								version: newVersion,
								output
							});
						} else finish({
							error: `Setup exited with code ${code}`,
							output
						});
					});
					child.on("error", (err) => finish({ error: err.message }));
				});
			} catch (e) {
				return { error: e.message };
			}
		});
		ipcMain$8.handle("chiaki:getConfig", () => {
			return ctx.db.chiakiConfig || {
				executablePath: "",
				consoles: []
			};
		});
		ipcMain$8.handle("chiaki:saveConfig", (event, config) => {
			const { cerealMode: _dropped, ...clean } = config || {};
			ctx.db.chiakiConfig = clean;
			saveDB();
			return clean;
		});
		ipcMain$8.handle("games:setChiakiStream", (event, gameId, streamConfig) => {
			const game = ctx.db.games.find((g) => g.id === gameId);
			if (game) {
				game.chiakiNickname = streamConfig.nickname || "";
				game.chiakiHost = streamConfig.host || "";
				game.chiakiProfile = streamConfig.profile || "";
				game.chiakiFullscreen = streamConfig.fullscreen !== false;
				game.chiakiRegistKey = streamConfig.registKey || "";
				game.chiakiMorning = streamConfig.morning || "";
				saveDB();
				return game;
			}
			return null;
		});
		ipcMain$8.handle("chiaki:startStreamDirect", (event, opts) => {
			const chiakiExe = resolveChiakiExe();
			if (!chiakiExe) return {
				success: false,
				error: "chiaki-ng not found. Run scripts/setup-chiaki.ps1 to install it."
			};
			const sessionKey = "console:" + (opts.host || "unknown");
			return {
				success: true,
				sessionKey,
				state: startChiakiSession(sessionKey, chiakiExe, buildChiakiArgs({
					chiakiHost: opts.host || "",
					chiakiNickname: opts.nickname || "",
					chiakiProfile: opts.profile || "",
					chiakiRegistKey: opts.registKey || "",
					chiakiMorning: opts.morning || "",
					chiakiFullscreen: opts.fullscreen !== false,
					chiakiDisplayMode: opts.displayMode || ""
				}, ctx.db.chiakiConfig || {})).state
			};
		});
		ipcMain$8.handle("chiaki:startStream", (event, gameId) => {
			const game = ctx.db.games.find((g) => g.id === gameId);
			if (!game) return {
				success: false,
				error: "Game not found"
			};
			const chiakiExe = resolveChiakiExe(game.executablePath);
			if (!chiakiExe) return {
				success: false,
				error: "chiaki-ng not found"
			};
			const session = startChiakiSession(gameId, chiakiExe, buildChiakiArgs(game, ctx.db.chiakiConfig || {}));
			game.lastPlayed = (/* @__PURE__ */ new Date()).toISOString();
			saveDB();
			return {
				success: true,
				state: session.state
			};
		});
		ipcMain$8.handle("chiaki:stopStream", (event, gameId) => {
			return { success: stopChiakiSession(gameId) };
		});
		ipcMain$8.handle("chiaki:getSessions", () => {
			return getActiveSessions();
		});
		ipcMain$8.handle("chiaki:openGui", () => {
			const chiakiExe = resolveChiakiExe();
			if (!chiakiExe) return {
				success: false,
				error: "chiaki-ng not found"
			};
			const chiakiDir = path$7.dirname(chiakiExe);
			spawn$2(chiakiExe, [], {
				cwd: chiakiDir,
				env: {
					...process.env,
					PATH: `${chiakiDir};${process.env.PATH}`
				},
				detached: true,
				stdio: "ignore"
			}).unref();
			return { success: true };
		});
		ipcMain$8.handle("chiaki:registerConsole", (event, { host, psnAccountId, pin }) => {
			const chiakiExe = resolveChiakiExe();
			if (!chiakiExe) return {
				success: false,
				error: "chiaki-ng not found"
			};
			return new Promise((resolve) => {
				const chiakiDir = path$7.dirname(chiakiExe);
				const env = {
					...process.env,
					PATH: `${chiakiDir};${process.env.PATH}`
				};
				const args = [
					"register",
					"--host",
					host
				];
				if (psnAccountId) args.push("--psn-account-id", psnAccountId);
				if (pin) args.push("--pin", pin);
				let output = "";
				let resolved = false;
				const finish = (result) => {
					if (resolved) return;
					resolved = true;
					resolve(result);
				};
				const proc = spawn$2(chiakiExe, args, {
					cwd: chiakiDir,
					env,
					stdio: [
						"ignore",
						"pipe",
						"pipe"
					]
				});
				proc.stdout.on("data", (d) => output += d.toString());
				proc.stderr.on("data", (d) => output += d.toString());
				proc.on("exit", (code) => {
					if (code === 0) finish({
						success: true,
						registKey: output.match(/regist[_-]?key[=:]\s*([^\s\n]+)/i)?.[1] || "",
						morning: output.match(/morning[=:]\s*([^\s\n]+)/i)?.[1] || "",
						output
					});
					else finish({
						success: false,
						error: output || "Registration failed (exit " + code + ")"
					});
				});
				setTimeout(() => {
					try {
						proc.kill();
					} catch (_e) {}
					finish({
						success: false,
						error: "Registration timed out (30s)"
					});
				}, 3e4);
			});
		});
		ipcMain$8.handle("chiaki:discoverConsoles", () => {
			const TARGETS = [{
				port: 987,
				srch: Buffer.from("SRCH * HTTP/1.1\ndevice-discovery-protocol-version:00020020\n")
			}, {
				port: 9302,
				srch: Buffer.from("SRCH * HTTP/1.1\ndevice-discovery-protocol-version:00030010\n")
			}];
			return new Promise((resolve) => {
				const found = /* @__PURE__ */ new Map();
				function onMessage(msg, rinfo) {
					const text = msg.toString();
					const statusMatch = text.match(/^HTTP\/1\.1\s+(\d+)/);
					if (!statusMatch) return;
					const httpCode = parseInt(statusMatch[1], 10);
					if (httpCode !== 200 && httpCode !== 620) return;
					log.debug("discovery", "response from", rinfo.address, "status:", httpCode);
					const state = httpCode === 200 ? "ready" : "standby";
					const entry = {
						host: rinfo.address,
						state
					};
					for (const line of text.split("\n")) {
						const colon = line.indexOf(":");
						if (colon === -1) continue;
						const k = line.substring(0, colon).trim().toLowerCase();
						const v = line.substring(colon + 1).trim();
						if (k === "host-name") entry.name = v;
						if (k === "host-type") entry.type = v;
						if (k === "host-id") entry.hostId = v;
						if (k === "system-version") entry.firmwareVersion = v;
						if (k === "running-app-titleid") entry.runningTitleId = v;
						if (k === "running-app-name") entry.runningTitle = v;
						if (k === "device-discovery-protocol-version") entry.protocolVersion = v;
					}
					const existing = found.get(rinfo.address);
					if (existing) Object.assign(existing, Object.fromEntries(Object.entries(entry).filter(([, v]) => v != null && v !== "")));
					else found.set(rinfo.address, entry);
				}
				const ports = [];
				for (let p = 9303; p <= 9319; p++) ports.push(p);
				ports.push(0);
				function tryBind(idx) {
					const s = dgram.createSocket({
						type: "udp4",
						reuseAddr: true
					});
					s.on("message", onMessage);
					s.on("error", (err) => {
						if (err.code === "EADDRINUSE" && idx + 1 < ports.length) {
							try {
								s.close();
							} catch (_e) {}
							tryBind(idx + 1);
						} else {
							log.error("discovery", "bind failed:", err.message);
							try {
								s.close();
							} catch (_e) {}
							resolve({
								success: false,
								consoles: [],
								error: err.message
							});
						}
					});
					s.bind(ports[idx], () => {
						log.debug("discovery", "bound to port", ports[idx] || "(random)");
						onBoundSock(s);
					});
				}
				tryBind(0);
				function onBoundSock(s) {
					s.setBroadcast(true);
					const broadcasts = new Set(["255.255.255.255"]);
					for (const addrs of Object.values(os$1.networkInterfaces())) for (const addr of addrs) {
						if (addr.family !== "IPv4" || addr.internal) continue;
						if (addr.netmask) {
							const ipParts = addr.address.split(".").map(Number);
							const maskParts = addr.netmask.split(".").map(Number);
							const bcast = ipParts.map((octet, i) => octet | ~maskParts[i] & 255).join(".");
							broadcasts.add(bcast);
						} else {
							const parts = addr.address.split(".");
							parts[3] = "255";
							broadcasts.add(parts.join("."));
						}
					}
					console.log("[discovery] broadcasting to:", [...broadcasts]);
					const sendRound = () => {
						for (const bcast of broadcasts) for (const { port, srch } of TARGETS) s.send(srch, port, bcast, (err) => {
							if (err) console.error("[discovery] send error:", bcast, port, err.message);
						});
					};
					sendRound();
					setTimeout(sendRound, 500);
					setTimeout(sendRound, 1500);
					setTimeout(() => {
						log.debug("discovery", "done, found", found.size, "console(s)");
						try {
							s.close();
						} catch (_e) {}
						resolve({
							success: true,
							consoles: [...found.values()]
						});
					}, 4e3);
				}
			});
		});
		ipcMain$8.handle("chiaki:wakeConsole", (event, { host, credentials }) => {
			return new Promise((resolve) => {
				const registKey = credentials?.registKey || "";
				if (!registKey) return resolve({
					success: false,
					error: "No registration key — register the console first"
				});
				let resolved = false;
				const finish = (result) => {
					if (resolved) return;
					resolved = true;
					resolve(result);
				};
				const chiakiExe = resolveChiakiExe();
				if (chiakiExe) {
					const chiakiDir = path$7.dirname(chiakiExe);
					const env = {
						...process.env,
						PATH: `${chiakiDir};${process.env.PATH}`
					};
					const proc = spawn$2(chiakiExe, [
						"wakeup",
						"--host",
						host,
						"--regist-key",
						registKey
					], {
						cwd: chiakiDir,
						env,
						stdio: [
							"ignore",
							"pipe",
							"pipe"
						]
					});
					let output = "";
					proc.stdout.on("data", (d) => output += d.toString());
					proc.stderr.on("data", (d) => output += d.toString());
					proc.on("exit", (code) => {
						finish({
							success: code === 0,
							output,
							method: "chiaki-cli"
						});
					});
					proc.on("error", () => {
						sendUdpWake();
					});
					setTimeout(() => {
						try {
							proc.kill();
						} catch (_e) {}
						finish({
							success: false,
							error: "Wake CLI timed out (10s)",
							method: "chiaki-cli"
						});
					}, 1e4);
					return;
				}
				sendUdpWake();
				function sendUdpWake() {
					const WAKE_TARGETS = [{
						port: 987,
						msg: Buffer.from("WAKEUP * HTTP/1.1\nclient-type:vr\nauth-type:R\nmodel:w\napp-type:r\nuser-credential:" + registKey + "\ndevice-discovery-protocol-version:00020020\n")
					}, {
						port: 9302,
						msg: Buffer.from("WAKEUP * HTTP/1.1\nclient-type:vr\nauth-type:R\nmodel:w\napp-type:r\nuser-credential:" + registKey + "\ndevice-discovery-protocol-version:00030010\n")
					}];
					const sock = dgram.createSocket("udp4");
					sock.on("error", (err) => {
						log.error("wake", "socket error:", err.message);
						try {
							sock.close();
						} catch (_e) {}
						finish({
							success: false,
							error: err.message,
							method: "udp"
						});
					});
					sock.bind(0, () => {
						sock.setBroadcast(true);
						const hosts = [host];
						const parts = host.split(".");
						if (parts.length === 4) {
							parts[3] = "255";
							hosts.push(parts.join("."));
						}
						let total = hosts.length * WAKE_TARGETS.length;
						let sent = 0;
						for (const target of hosts) for (const { port, msg } of WAKE_TARGETS) sock.send(msg, port, target, (err) => {
							if (err) log.error("wake", "send error:", target, port, err.message);
							sent++;
							if (sent === total) setTimeout(() => {
								try {
									sock.close();
								} catch (_e) {}
								log.info("wake", "sent to", host, "(both ports)");
								finish({
									success: true,
									method: "udp"
								});
							}, 500);
						});
					});
				}
			});
		});
	}
	module.exports = {
		getChiakiDir,
		getBundledChiakiExe,
		getBundledChiakiVersion,
		chiakiSessions,
		resolveChiakiExe,
		buildChiakiArgs,
		startChiakiSession,
		stopChiakiSession,
		getStreamBounds,
		startEmbedHelper,
		stopEmbedHelper,
		sendEmbedBoundsToAll,
		sendStreamEvent,
		sendChiakiEvent,
		getActiveSessions,
		autoSetupChiakiIfMissing,
		registerChiakiIpcHandlers
	};
}));
//#endregion
//#region electron/modules/integrations/xcloud.js
var require_xcloud = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	var { WebContentsView, session: session$1 } = require("electron");
	var ctx = require_context();
	var { CONTROL_BAR_HEIGHT } = require_constants();
	var log = require_logger();
	var xcloudSessions = /* @__PURE__ */ new Map();
	function sendStreamEvent(gameId, type, data) {
		ctx.sendToRenderer("chiaki:event", {
			gameId,
			type,
			...data
		});
	}
	function getXcloudBounds() {
		const [cw, ch] = ctx.mainWindow ? ctx.mainWindow.getContentSize() : [1280, 720];
		return {
			x: 0,
			y: CONTROL_BAR_HEIGHT,
			width: cw,
			height: Math.max(1, ch - CONTROL_BAR_HEIGHT)
		};
	}
	function updateXcloudBounds(sess) {
		if (!sess || !sess.view) return;
		const b = getXcloudBounds();
		try {
			sess.view.setBounds(b);
		} catch (_e) {}
	}
	function updateAllXcloudBounds() {
		for (const sess of xcloudSessions.values()) updateXcloudBounds(sess);
	}
	function startXcloudSession(gameId, url, title) {
		stopXcloudSession(gameId);
		const view = new WebContentsView({ webPreferences: {
			session: session$1.fromPartition("persist:xcloud"),
			contextIsolation: true,
			sandbox: true
		} });
		const ua = view.webContents.getUserAgent().replace(/Electron\/\S+\s*/, "") + " Edg/120.0.0.0";
		view.webContents.setUserAgent(ua);
		ctx.mainWindow.contentView.addChildView(view);
		const sess = {
			gameId,
			view,
			state: "loading",
			startTime: Date.now()
		};
		xcloudSessions.set(gameId, sess);
		updateXcloudBounds(sess);
		view.webContents.loadURL(url || "https://www.xbox.com/play");
		view.webContents.on("dom-ready", () => {
			sess.state = "streaming";
			sendStreamEvent(gameId, "state", {
				state: "streaming",
				platform: "xbox"
			});
		});
		view.webContents.on("did-fail-load", (_e, code, desc) => {
			sess.state = "disconnected";
			sendStreamEvent(gameId, "disconnected", {
				reason: desc,
				platform: "xbox"
			});
		});
		sendStreamEvent(gameId, "state", {
			state: "connecting",
			platform: "xbox"
		});
		ctx.sendToRenderer("tabs:opened", {
			id: gameId,
			title: title || "Xbox Cloud Gaming",
			platform: "xbox"
		});
		return sess;
	}
	function stopXcloudSession(gameId) {
		const sess = xcloudSessions.get(gameId);
		if (!sess) return false;
		if (sess._stopping) return false;
		sess._stopping = true;
		try {
			try {
				if (ctx.mainWindow && !ctx.mainWindow.isDestroyed()) ctx.mainWindow.contentView.removeChildView(sess.view);
			} catch (_e) {}
			xcloudSessions.delete(gameId);
			sendStreamEvent(gameId, "disconnected", {
				reason: "stopped",
				platform: "xbox"
			});
			ctx.sendToRenderer("tabs:closed", { id: gameId });
			if (sess.view?.webContents && !sess.view.webContents.isDestroyed()) try {
				sess.view.webContents.loadURL("https://www.xbox.com/play");
			} catch (_e) {}
			setTimeout(() => {
				if (sess.view?.webContents?.session && !sess.view.webContents.isDestroyed()) try {
					sess.view.webContents.session.clearStorageData({
						origin: "https://www.xbox.com",
						storages: [
							"cookies",
							"localstorage",
							"sessionstorage",
							"cachestorage"
						]
					}).catch(() => {});
				} catch (_e) {}
				try {
					if (sess.view?.webContents && !sess.view.webContents.isDestroyed()) sess.view.webContents.close();
				} catch (_e) {}
				sess.view = null;
				log.info("xcloud", `Session ${gameId} stopped gracefully`);
			}, 500);
			return true;
		} catch (e) {
			log.error("xcloud", "Error stopping session:", e.message);
			try {
				ctx.mainWindow?.contentView?.removeChildView(sess.view);
			} catch (_e) {}
			try {
				sess.view?.webContents?.close();
			} catch (_e) {}
			xcloudSessions.delete(gameId);
			sendStreamEvent(gameId, "disconnected", {
				reason: "error",
				platform: "xbox",
				error: e.message
			});
			return false;
		}
	}
	function getActiveXcloudSessions() {
		return Object.fromEntries([...xcloudSessions].map(([gameId, sess]) => [gameId, {
			state: sess.state,
			platform: "xbox",
			startTime: sess.startTime
		}]));
	}
	module.exports = {
		xcloudSessions,
		updateAllXcloudBounds,
		startXcloudSession,
		stopXcloudSession,
		getActiveXcloudSessions
	};
}));
//#endregion
//#region electron/modules/games/gameCrud.js
var require_gameCrud = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	var { ipcMain: ipcMain$7 } = require("electron");
	var fs$5 = require("fs");
	var path$6 = require("path");
	var crypto$2 = require("crypto");
	var ctx = require_context();
	var { getProvidersDir } = require_paths();
	var { enqueueCoverFetch } = require_covers();
	var { fetchGameMetadata, applyMetadataToGame } = require_metadata();
	var log = require_logger();
	function registerGameCrudIpcHandlers() {
		const { canonicalize: canonicalizeName } = require(path$6.join(getProvidersDir(), "utils"));
		ipcMain$7.handle("games:getAll", () => ctx.db.games);
		ipcMain$7.handle("games:getCategories", () => ctx.db.categories);
		ipcMain$7.handle("games:add", (_event, game) => {
			const db = ctx.db;
			if (!game || typeof game !== "object") return { error: "Invalid game data" };
			if (!game.name || typeof game.name !== "string" || !game.name.trim()) return { error: "Game name is required" };
			game.name = game.name.trim();
			let existing = null;
			try {
				if (game.platform && game.platformId) existing = db.games.find((g) => g.platform === game.platform && g.platformId && g.platformId === game.platformId);
				if (!existing) {
					const canon = canonicalizeName(game.name || "");
					if (canon) existing = db.games.find((g) => canonicalizeName(g.name) === canon && (!game.platform || g.platform === game.platform));
				}
			} catch (_e) {
				existing = null;
			}
			if (existing) {
				const prev = existing;
				const merged = {
					...prev,
					...game
				};
				try {
					const coverChanged = typeof game.coverUrl === "string" && game.coverUrl !== prev.coverUrl;
					const headerChanged = typeof game.headerUrl === "string" && game.headerUrl !== prev.headerUrl;
					if (coverChanged || headerChanged) merged._imgStamp = Date.now();
					else merged._imgStamp = prev._imgStamp;
				} catch (_e) {
					merged._imgStamp = prev._imgStamp;
				}
				if (!merged.platform) merged.platform = prev.platform;
				if (!merged.platformId) merged.platformId = prev.platformId;
				if (prev.installed === true && merged.installed === false) merged.installed = true;
				db.games[db.games.findIndex((g) => g.id === prev.id)] = merged;
				ctx.saveDB(db);
				ctx.sendToRenderer("games:refresh", db.games);
				enqueueCoverFetch(merged.id);
				return merged;
			}
			game.id = Date.now().toString(36) + crypto$2.randomBytes(4).toString("hex");
			game.addedAt = (/* @__PURE__ */ new Date()).toISOString();
			game.lastPlayed = null;
			game.playtimeMinutes = 0;
			game.favorite = false;
			if (game.coverUrl) game._imgStamp = Date.now();
			db.games.push(game);
			ctx.saveDB(db);
			enqueueCoverFetch(game.id);
			fetchGameMetadata(game).then((meta) => {
				if (meta && applyMetadataToGame(game, meta)) {
					ctx.saveDB(db);
					ctx.sendToRenderer("games:refresh", db.games);
					enqueueCoverFetch(game.id);
				}
			}).catch((e) => log.debug("gameCrud", "auto-metadata failed", e.message));
			return game;
		});
		ipcMain$7.handle("games:update", (_event, updatedGame) => {
			const db = ctx.db;
			if (!updatedGame || typeof updatedGame !== "object" || !updatedGame.id) return null;
			if (updatedGame.name !== void 0 && (typeof updatedGame.name !== "string" || !updatedGame.name.trim())) return null;
			const idx = db.games.findIndex((g) => g.id === updatedGame.id);
			if (idx !== -1) {
				const prev = db.games[idx];
				const merged = {
					...prev,
					...updatedGame
				};
				try {
					const coverChanged = typeof updatedGame.coverUrl === "string" && updatedGame.coverUrl !== prev.coverUrl;
					const headerChanged = typeof updatedGame.headerUrl === "string" && updatedGame.headerUrl !== prev.headerUrl;
					if (coverChanged) {
						if (prev.localCoverPath) try {
							fs$5.unlinkSync(prev.localCoverPath);
						} catch (_e) {
							log.debug("covers", "unlink cover failed");
						}
						merged.localCoverPath = null;
						merged._imgStamp = Date.now();
					}
					if (headerChanged) {
						if (prev.localHeaderPath) try {
							fs$5.unlinkSync(prev.localHeaderPath);
						} catch (_e) {
							log.debug("covers", "unlink header failed");
						}
						merged.localHeaderPath = null;
						merged._imgStamp = Date.now();
					}
					if (!coverChanged && !headerChanged) merged._imgStamp = prev._imgStamp;
				} catch (_e) {
					merged._imgStamp = prev._imgStamp;
				}
				db.games[idx] = merged;
				ctx.saveDB(db);
				ctx.sendToRenderer("games:refresh", db.games);
				enqueueCoverFetch(updatedGame.id);
				return db.games[idx];
			}
			return null;
		});
		ipcMain$7.handle("games:delete", (_event, id) => {
			const db = ctx.db;
			db.games = db.games.filter((g) => g.id !== id);
			ctx.saveDB(db);
			ctx.sendToRenderer("games:refresh", db.games);
			return true;
		});
		ipcMain$7.handle("games:toggleFavorite", (_event, id) => {
			const db = ctx.db;
			const game = db.games.find((g) => g.id === id);
			if (game) {
				game.favorite = !game.favorite;
				ctx.saveDB(db);
				ctx.sendToRenderer("games:refresh", db.games);
				return game;
			}
			return null;
		});
		ipcMain$7.handle("covers:fetchNow", (_event, gameId) => {
			enqueueCoverFetch(gameId);
			return { queued: true };
		});
		ipcMain$7.handle("categories:add", (_event, category) => {
			const db = ctx.db;
			if (!db.categories.includes(category)) {
				db.categories.push(category);
				ctx.saveDB(db);
			}
			return db.categories;
		});
		ipcMain$7.handle("categories:remove", (_event, category) => {
			const db = ctx.db;
			db.categories = db.categories.filter((c) => c !== category);
			db.games.forEach((g) => {
				g.categories = (g.categories || []).filter((c) => c !== category);
			});
			ctx.saveDB(db);
			return db.categories;
		});
	}
	module.exports = { registerGameCrudIpcHandlers };
}));
//#endregion
//#region electron/modules/core/database.js
var require_database = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	var { app: app$2 } = require("electron");
	var path$5 = require("path");
	var fs$4 = require("fs");
	var log = require_logger();
	var DB_PATH = path$5.join(app$2 ? app$2.getPath("userData") : ".", "games.json");
	function writeDBSync(data) {
		try {
			if (fs$4.existsSync(DB_PATH)) fs$4.copyFileSync(DB_PATH, DB_PATH + ".bak");
		} catch (_e) {}
		const tmp = DB_PATH + ".tmp";
		fs$4.writeFileSync(tmp, JSON.stringify(data, null, 2));
		fs$4.renameSync(tmp, DB_PATH);
	}
	var _saveDBTimer = null;
	function saveDB(data) {
		clearTimeout(_saveDBTimer);
		_saveDBTimer = setTimeout(() => {
			_saveDBTimer = null;
			try {
				writeDBSync(data);
			} catch (e) {
				log.error("db", "Failed to save DB:", e.message);
			}
		}, 150);
	}
	function flushDB(db) {
		if (_saveDBTimer) {
			clearTimeout(_saveDBTimer);
			_saveDBTimer = null;
			try {
				writeDBSync(db);
			} catch (e) {
				log.error("db", "Failed to flush DB:", e.message);
			}
		}
	}
	function loadDB() {
		for (const filePath of [DB_PATH, DB_PATH + ".bak"]) try {
			if (!fs$4.existsSync(filePath)) continue;
			const data = JSON.parse(fs$4.readFileSync(filePath, "utf-8"));
			if (filePath !== DB_PATH) log.warn("db", "Loaded from backup — primary was corrupt");
			if (data.games) {
				const before = data.games.length;
				data.games = data.games.filter((g) => g.platform !== "psn" && g.platform !== "psremote");
				if (data.games.length !== before) saveDB(data);
			}
			return data;
		} catch (e) {
			log.error("db", "Failed to load", filePath, e.message);
		}
		const seed = {
			categories: [
				"Action",
				"Adventure",
				"RPG",
				"Strategy",
				"Puzzle",
				"Simulation",
				"Sports",
				"FPS",
				"Indie",
				"Multiplayer"
			],
			playtime: {},
			games: []
		};
		saveDB(seed);
		return seed;
	}
	module.exports = {
		DB_PATH,
		loadDB,
		saveDB,
		flushDB,
		writeDBSync
	};
}));
//#endregion
//#region electron/modules/integrations/keys.js
var require_keys = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	var { ipcMain: ipcMain$6, dialog: dialog$2, shell: shell$2, clipboard } = require("electron");
	var crypto$1 = require("crypto");
	var path$4 = require("path");
	var ctx = require_context();
	var { ALLOWED_KEY_SERVICES } = require_constants();
	var { getProvidersDir } = require_paths();
	var providers = null;
	function getProviders() {
		if (!providers) providers = require(getProvidersDir());
		return providers;
	}
	var { httpGetJson } = require(path$4.join(getProvidersDir(), "http"));
	var log = require_logger();
	function summarizeSecret(secret) {
		if (!secret) return {
			hasSecret: false,
			fingerprint: null
		};
		try {
			return {
				hasSecret: true,
				fingerprint: crypto$1.createHash("sha256").update(secret).digest("hex").slice(0, 8)
			};
		} catch (_e) {
			return {
				hasSecret: true,
				fingerprint: "unknown"
			};
		}
	}
	async function validateProviderKey(provider, apiKey) {
		const providers = getProviders();
		if (!apiKey) return {
			ok: false,
			provider,
			error: "missing-key"
		};
		if (providers[provider] && typeof providers[provider].validateKey === "function") try {
			const res = await providers[provider].validateKey(apiKey);
			return {
				ok: !!res.ok,
				provider,
				info: res.info,
				error: res.error
			};
		} catch (err) {
			return {
				ok: false,
				provider,
				error: err && err.message
			};
		}
		if (provider === "steam") {
			const res = await httpGetJson(`https://api.steampowered.com/ISteamWebAPIUtil/GetServerInfo/v1/?key=${encodeURIComponent(apiKey)}`);
			if (res && res.status === 200 && res.data) return {
				ok: true,
				provider: "steam",
				info: res.data
			};
			return {
				ok: false,
				provider: "steam",
				error: res && (res.data || res.raw || "Steam API error")
			};
		}
		return {
			ok: false,
			provider,
			error: "unknown-provider"
		};
	}
	function registerKeysIpcHandlers() {
		ipcMain$6.handle("keys:set", async (_event, { service, account, secret }) => {
			if (!ALLOWED_KEY_SERVICES.includes(service)) return {
				ok: false,
				error: "Unauthorized service: " + service
			};
			try {
				ctx.safeStore.setPassword(service, account, secret);
				return {
					ok: true,
					...summarizeSecret(secret)
				};
			} catch (err) {
				log.error("keys", "keys:set error", err && err.message);
				return {
					ok: false,
					error: err && err.message
				};
			}
		});
		ipcMain$6.handle("keys:get", async (_event, { service, account }) => {
			if (!ALLOWED_KEY_SERVICES.includes(service)) return {
				ok: false,
				error: "Unauthorized service: " + service
			};
			try {
				return {
					ok: true,
					...summarizeSecret(ctx.safeStore.getPassword(service, account))
				};
			} catch (err) {
				log.error("keys", "keys:get error", err && err.message);
				return {
					ok: false,
					error: err && err.message
				};
			}
		});
		ipcMain$6.handle("keys:delete", async (_event, { service, account }) => {
			if (!ALLOWED_KEY_SERVICES.includes(service)) return {
				ok: false,
				error: "Unauthorized service: " + service
			};
			try {
				return { ok: ctx.safeStore.deletePassword(service, account) };
			} catch (err) {
				log.error("keys", "keys:delete error", err && err.message);
				return {
					ok: false,
					error: err && err.message
				};
			}
		});
		ipcMain$6.handle("keys:validate", async (_event, { provider, apiKey }) => {
			try {
				return await validateProviderKey(provider, apiKey);
			} catch (err) {
				log.error("keys", "keys:validate error", err && err.message);
				return {
					ok: false,
					error: err && err.message
				};
			}
		});
		ipcMain$6.handle("keys:validateStored", async (_event, { provider, service, account }) => {
			if (!ALLOWED_KEY_SERVICES.includes(service)) return {
				ok: false,
				error: "Unauthorized service: " + service
			};
			try {
				const secret = ctx.safeStore.getPassword(service, account);
				if (!secret) return {
					ok: false,
					error: "no-secret",
					provider
				};
				return await validateProviderKey(provider, secret);
			} catch (err) {
				log.error("keys", "keys:validateStored error", err && err.message);
				return {
					ok: false,
					error: err && err.message
				};
			}
		});
		ipcMain$6.handle("steamgriddb:login", async () => {
			try {
				await shell$2.openExternal("https://www.steamgriddb.com/profile/preferences/api");
				const { response } = await dialog$2.showMessageBox(ctx.mainWindow, {
					type: "info",
					buttons: ["Paste API Key", "Cancel"],
					defaultId: 0,
					message: "SteamGridDB Login",
					detail: "Copy your API key from the SteamGridDB page that opened, then click \"Paste API Key\"."
				});
				if (response !== 0) return { cancelled: true };
				const apiKey = clipboard.readText().trim();
				if (!apiKey) return { error: "Clipboard is empty. Copy your SteamGridDB API key first, then try again." };
				const vr = await validateProviderKey("steamgriddb", apiKey);
				if (!vr?.ok) return { error: "API key appears invalid: " + (vr?.error || "unknown error") };
				ctx.safeStore.setPassword("cereal-steamgriddb", "default", apiKey);
				return {
					ok: true,
					...summarizeSecret(apiKey)
				};
			} catch (e) {
				return { error: e.message };
			}
		});
		ipcMain$6.handle("clipboard:readText", () => {
			try {
				return clipboard.readText();
			} catch (_e) {
				return "";
			}
		});
	}
	module.exports = {
		registerKeysIpcHandlers,
		validateProviderKey,
		summarizeSecret
	};
}));
//#endregion
//#region electron/modules/metadata/metadataSearch.js
var require_metadataSearch = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	var { net: net$1, ipcMain: ipcMain$5 } = require("electron");
	var { getMetadataSettings, httpGet } = require_metadata();
	var log = require_logger();
	async function searchSteam(gameName) {
		const results = [];
		const search = await httpGet(`https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(gameName)}&l=english&cc=US`);
		if (search?.items?.length) for (const item of search.items.slice(0, 3)) {
			const id = item.id;
			const name = item.name || "";
			try {
				const info = (await httpGet(`https://store.steampowered.com/api/appdetails?appids=${id}&l=english`))?.[String(id)]?.data;
				if (info) {
					results.push({
						url: `https://shared.steamstatic.com/store_item_assets/steam/apps/${id}/library_600x900_2x.jpg`,
						type: "cover",
						source: "Steam",
						label: name + " - Portrait (HD)"
					});
					if (info.header_image) results.push({
						url: info.header_image,
						type: "header",
						source: "Steam",
						label: name + " - Header"
					});
					results.push({
						url: `https://shared.steamstatic.com/store_item_assets/steam/apps/${id}/library_hero.jpg`,
						type: "header",
						source: "Steam",
						label: name + " - Hero"
					});
					if (info.screenshots) for (const ss of info.screenshots.slice(0, 2)) results.push({
						url: ss.path_full,
						type: "screenshot",
						source: "Steam",
						label: name + " - Screenshot"
					});
				}
			} catch (_e) {}
		}
		return results;
	}
	async function searchSteamGridDB(gameName, apiKey) {
		if (!apiKey) return [];
		const results = [];
		const q = encodeURIComponent(gameName);
		const sgdbFetch = async (endpoint) => {
			const resp = await net$1.fetch(endpoint, { headers: { "Authorization": "Bearer " + apiKey } });
			if (!resp.ok) throw new Error("SGDB HTTP " + resp.status);
			return resp.json();
		};
		const searchData = await sgdbFetch(`https://www.steamgriddb.com/api/v2/search/autocomplete/${q}`);
		if (!searchData?.success || !searchData?.data?.length) return results;
		const gameId = searchData.data[0].id;
		const gameLabel = searchData.data[0].name || gameName;
		const [portraitGrids, landscapeGrids, heroes, logos] = await Promise.allSettled([
			sgdbFetch(`https://www.steamgriddb.com/api/v2/grids/game/${gameId}?dimensions=600x900&limit=8`),
			sgdbFetch(`https://www.steamgriddb.com/api/v2/grids/game/${gameId}?dimensions=460x215,920x430&limit=4`),
			sgdbFetch(`https://www.steamgriddb.com/api/v2/heroes/game/${gameId}?limit=4`),
			sgdbFetch(`https://www.steamgriddb.com/api/v2/logos/game/${gameId}?limit=2`)
		]);
		if (portraitGrids.status === "fulfilled" && portraitGrids.value?.data) {
			for (const g of portraitGrids.value.data.slice(0, 8)) if (g.url) results.push({
				url: g.url,
				type: "cover",
				source: "SteamGridDB",
				label: gameLabel + " - Cover"
			});
		}
		if (landscapeGrids.status === "fulfilled" && landscapeGrids.value?.data) {
			for (const g of landscapeGrids.value.data.slice(0, 4)) if (g.url) results.push({
				url: g.url,
				type: "header",
				source: "SteamGridDB",
				label: gameLabel + " - Header"
			});
		}
		if (heroes.status === "fulfilled" && heroes.value?.data) {
			for (const h of heroes.value.data.slice(0, 4)) if (h.url) results.push({
				url: h.url,
				type: "header",
				source: "SteamGridDB",
				label: gameLabel + " - Hero"
			});
		}
		if (logos.status === "fulfilled" && logos.value?.data) {
			for (const l of logos.value.data.slice(0, 2)) if (l.url) results.push({
				url: l.url,
				type: "logo",
				source: "SteamGridDB",
				label: gameLabel + " - Logo"
			});
		}
		return results;
	}
	async function handleSearchArt(event, gameName, _platform) {
		if (!gameName) return { images: [] };
		const ms = getMetadataSettings();
		const [sgdbResult, steamResult] = await Promise.allSettled([searchSteamGridDB(gameName, ms.steamGridDbKey), searchSteam(gameName)]);
		const sgdb = sgdbResult.status === "fulfilled" ? sgdbResult.value : [];
		if (sgdbResult.status !== "fulfilled") log.debug("metadataSearch", "SteamGridDB failed:", sgdbResult.reason?.message);
		const steam = steamResult.status === "fulfilled" ? steamResult.value : [];
		if (steamResult.status !== "fulfilled") log.debug("metadataSearch", "Steam failed:", steamResult.reason?.message);
		const images = [];
		const seen = /* @__PURE__ */ new Set();
		for (const img of sgdb) if (img.url && !seen.has(img.url)) {
			seen.add(img.url);
			images.push(img);
		}
		if (images.length === 0) {
			for (const img of steam) if (img.url && !seen.has(img.url)) {
				seen.add(img.url);
				images.push(img);
			}
		}
		return { images };
	}
	function registerMetadataSearchHandlers() {
		ipcMain$5.handle("metadata:searchArt", handleSearchArt);
	}
	module.exports = { registerMetadataSearchHandlers };
}));
//#endregion
//#region electron/modules/metadata/metadataIpc.js
var require_metadataIpc = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	var { ipcMain: ipcMain$4 } = require("electron");
	var ctx = require_context();
	var { fetchGameMetadata, applyMetadataToGame, invalidateMetadataCache } = require_metadata();
	var { enqueueCoverFetch } = require_covers();
	var { registerMetadataSearchHandlers } = require_metadataSearch();
	function registerMetadataIpcHandlers() {
		registerMetadataSearchHandlers();
		ipcMain$4.handle("metadata:fetch", async (_event, gameId) => {
			const game = ctx.db.games.find((g) => g.id === gameId);
			if (!game) return { error: "Game not found" };
			try {
				const meta = await fetchGameMetadata(game);
				if (!meta) return { error: "No metadata found" };
				return {
					success: true,
					metadata: meta
				};
			} catch (e) {
				return { error: e.message };
			}
		});
		ipcMain$4.handle("metadata:apply", async (_event, gameId, force) => {
			const db = ctx.db;
			const game = db.games.find((g) => g.id === gameId);
			if (!game) return { error: "Game not found" };
			try {
				invalidateMetadataCache((game.platform || "") + ":" + (game.platformId || game.name));
				const meta = await fetchGameMetadata(game);
				if (!meta) return { error: "No metadata found" };
				if (force) {
					const prevCoverUrl = game.coverUrl;
					const prevHeaderUrl = game.headerUrl;
					game.coverUrl = meta.coverUrl || meta.headerUrl || meta.screenshots && meta.screenshots[0] || game.coverUrl;
					if (meta.description) game.description = meta.description;
					if (meta.developer) game.developer = meta.developer;
					if (meta.publisher) game.publisher = meta.publisher;
					if (meta.releaseDate) game.releaseDate = meta.releaseDate;
					if (meta.genres?.length) game.categories = meta.genres;
					game.headerUrl = meta.headerUrl || meta.coverUrl || meta.screenshots && meta.screenshots[0] || game.headerUrl;
					if (meta.screenshots?.length) game.screenshots = meta.screenshots;
					if (meta.metacritic != null) game.metacritic = meta.metacritic;
					if (meta.website) game.website = meta.website;
					if (game.coverUrl !== prevCoverUrl) {
						game.localCoverPath = null;
						game._imgStamp = Date.now();
					}
					if (game.headerUrl !== prevHeaderUrl) {
						game.localHeaderPath = null;
						game._imgStamp = Date.now();
					}
					ctx.saveDB(db);
					ctx.sendToRenderer("games:refresh", db.games);
					enqueueCoverFetch(game.id);
					return {
						success: true,
						game
					};
				} else {
					if (applyMetadataToGame(game, meta)) {
						ctx.saveDB(db);
						ctx.sendToRenderer("games:refresh", db.games);
						enqueueCoverFetch(game.id);
					}
					return {
						success: true,
						game
					};
				}
			} catch (e) {
				return { error: e.message };
			}
		});
		ipcMain$4.handle("metadata:fetchForName", async (_event, name, platform, platformId) => {
			if (!name) return { error: "No name provided" };
			try {
				const meta = await fetchGameMetadata({
					name,
					platform: platform || "custom",
					platformId: platformId || void 0
				});
				if (!meta) return { error: "No metadata found" };
				return {
					success: true,
					meta
				};
			} catch (e) {
				return { error: e.message };
			}
		});
		ipcMain$4.handle("metadata:fetchAll", async () => {
			const db = ctx.db;
			let updated = 0, failed = 0;
			const queue = [...db.games].sort((a, b) => {
				return (a.installed === false ? 1 : 0) - (b.installed === false ? 1 : 0);
			});
			const total = queue.length;
			const BATCH = 3;
			const REFRESH_INTERVAL = 500;
			let lastRefreshAt = 0;
			let pendingRefresh = false;
			for (let i = 0; i < total; i += BATCH) {
				const batch = queue.slice(i, i + BATCH);
				const results = await Promise.allSettled(batch.map(async (game) => {
					return {
						game,
						meta: await fetchGameMetadata(game)
					};
				}));
				let batchUpdated = 0;
				for (const r of results) if (r.status === "fulfilled" && r.value.meta) {
					if (applyMetadataToGame(r.value.game, r.value.meta)) {
						updated++;
						batchUpdated++;
						enqueueCoverFetch(r.value.game.id);
					}
				} else failed++;
				if (batchUpdated > 0) {
					ctx.saveDB(db);
					pendingRefresh = true;
				}
				const now = Date.now();
				if (pendingRefresh && now - lastRefreshAt >= REFRESH_INTERVAL) {
					ctx.sendToRenderer("games:refresh", db.games);
					lastRefreshAt = now;
					pendingRefresh = false;
				}
				const done = Math.min(i + BATCH, total);
				ctx.sendToRenderer("metadata:progress", {
					current: done,
					total,
					updated,
					failed,
					name: batch[batch.length - 1].name,
					phase: "metadata"
				});
				if (i + BATCH < total) await new Promise((r) => setTimeout(r, 200));
			}
			if (updated > 0) {
				ctx.saveDB(db);
				ctx.sendToRenderer("games:refresh", db.games);
			}
			return {
				updated,
				failed,
				total
			};
		});
	}
	module.exports = { registerMetadataIpcHandlers };
}));
//#endregion
//#region electron/modules/games/launcher.js
var require_launcher = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	var path$3 = require("path");
	var fs$3 = require("fs");
	var { shell: shell$1 } = require("electron");
	var { spawn: spawn$1 } = require("child_process");
	function normalizePlatform(platform) {
		if (platform === "psremote") return "psn";
		return platform;
	}
	function getLauncherExecutableCandidates(platform) {
		switch (platform) {
			case "steam": return [path$3.join(process.env["ProgramFiles(x86)"] || "", "Steam", "Steam.exe"), path$3.join(process.env.ProgramFiles || "", "Steam", "Steam.exe")];
			case "epic": return [path$3.join(process.env["ProgramFiles(x86)"] || "", "Epic Games", "Launcher", "Portal", "Binaries", "Win64", "EpicGamesLauncher.exe"), path$3.join(process.env.ProgramFiles || "", "Epic Games", "Launcher", "Portal", "Binaries", "Win64", "EpicGamesLauncher.exe")];
			case "gog": return [path$3.join(process.env["ProgramFiles(x86)"] || "", "GOG Galaxy", "GalaxyClient.exe"), path$3.join(process.env.ProgramFiles || "", "GOG Galaxy", "GalaxyClient.exe")];
			case "ea": return [
				path$3.join(process.env.ProgramFiles || "", "Electronic Arts", "EA Desktop", "EA Desktop", "EADesktop.exe"),
				path$3.join(process.env.LOCALAPPDATA || "", "Electronic Arts", "EA Desktop", "EA Desktop", "EADesktop.exe"),
				path$3.join(process.env["ProgramFiles(x86)"] || "", "Origin", "Origin.exe")
			];
			case "battlenet": return [path$3.join(process.env.ProgramFiles || "", "Battle.net", "Battle.net.exe"), path$3.join(process.env["ProgramFiles(x86)"] || "", "Battle.net", "Battle.net.exe")];
			case "ubisoft": return [
				path$3.join(process.env.ProgramFiles || "", "Ubisoft", "Ubisoft Game Launcher", "UbisoftConnect.exe"),
				path$3.join(process.env["ProgramFiles(x86)"] || "", "Ubisoft", "Ubisoft Game Launcher", "UbisoftConnect.exe"),
				path$3.join(process.env.ProgramFiles || "", "Ubisoft", "Ubisoft Game Launcher", "Uplay.exe"),
				path$3.join(process.env["ProgramFiles(x86)"] || "", "Ubisoft", "Ubisoft Game Launcher", "Uplay.exe")
			];
			case "itchio": {
				const itchBase = path$3.join(process.env.LOCALAPPDATA || "", "itch");
				try {
					return fs$3.readdirSync(itchBase, { withFileTypes: true }).filter((d) => d.isDirectory() && d.name.startsWith("app-")).sort((a, b) => b.name.localeCompare(a.name, void 0, { numeric: true })).map((d) => path$3.join(itchBase, d.name, "itch.exe"));
				} catch (_e) {
					return [];
				}
			}
			case "xbox": return [path$3.join(process.env.LOCALAPPDATA || "", "Microsoft", "WindowsApps", "XboxApp.exe")];
			default: return [];
		}
	}
	var uniq = (arr) => Array.from(new Set(arr.filter(Boolean)));
	function buildPlatformUris(game, action) {
		const platform = normalizePlatform(game.platform);
		const platformId = game.platformId ? String(game.platformId) : "";
		const storeUrl = game.storeUrl || "";
		const steamIdFromUrl = (() => {
			const m = String(storeUrl).match(/\/app\/(\d+)/i);
			return m ? m[1] : "";
		})();
		const steamId = platformId || steamIdFromUrl;
		const epicAppName = game.epicAppName || platformId;
		const epicNamespace = game.epicNamespace || "";
		const epicCatalogItemId = game.epicCatalogItemId || "";
		const eaOfferId = game.eaOfferId || platformId;
		const ubiGameId = game.ubisoftGameId || platformId;
		const gogId = platformId || (() => {
			const m = String(storeUrl).match(/\/openGameView\/(\d+)/i);
			return m ? m[1] : "";
		})();
		if (platform === "steam" && steamId) {
			if (action === "install") return uniq([
				`steam://install/${steamId}`,
				`steam://nav/games/details/${steamId}`,
				storeUrl
			]);
			if (action === "client") return [`steam://open/games`, `steam://nav/library`];
			return uniq([`steam://rungameid/${steamId}`, `steam://nav/games/details/${steamId}`]);
		}
		if (platform === "epic") {
			if (action === "install") return uniq([
				epicAppName ? `com.epicgames.launcher://apps/${epicAppName}?action=install&silent=true` : "",
				platformId ? `com.epicgames.launcher://apps/${platformId}?action=install&silent=true` : "",
				epicNamespace && epicCatalogItemId ? `com.epicgames.launcher://store/product/${epicNamespace}/${epicCatalogItemId}` : "",
				storeUrl
			]);
			if (action === "client") return uniq([
				epicAppName ? `com.epicgames.launcher://apps/${epicAppName}` : "",
				platformId ? `com.epicgames.launcher://apps/${platformId}` : "",
				storeUrl
			]);
			return uniq([
				epicAppName ? `com.epicgames.launcher://apps/${epicAppName}?action=launch&silent=true` : "",
				platformId ? `com.epicgames.launcher://apps/${platformId}?action=launch&silent=true` : "",
				storeUrl
			]);
		}
		if (platform === "gog" && gogId) {
			if (action === "install") return uniq([storeUrl, `goggalaxy://openGameView/${gogId}`]);
			return uniq([`goggalaxy://openGameView/${gogId}`, storeUrl]);
		}
		if (platform === "ea") {
			if (eaOfferId) {
				if (action === "install") return uniq([
					`origin2://store/open?offerId=${eaOfferId}`,
					`origin2://store/open?offerIds=${eaOfferId}`,
					storeUrl
				]);
				return uniq([
					`origin2://game/launch?offerIds=${eaOfferId}`,
					`origin2://library/open`,
					storeUrl
				]);
			}
			return ["origin2://library/open"];
		}
		if (platform === "battlenet") {
			if (platformId) return [`battlenet://${platformId}`];
			return ["battlenet://"];
		}
		if (platform === "ubisoft") {
			if (ubiGameId) {
				if (action === "install") return uniq([`uplay://launch/${ubiGameId}/1`, storeUrl]);
				return uniq([`uplay://launch/${ubiGameId}/0`, storeUrl]);
			}
			return ["uplay://"];
		}
		if (platform === "itchio") {
			if (storeUrl) return [storeUrl];
			return ["https://itch.io/my-purchases"];
		}
		if (platform === "xbox") {
			if (action === "install") return ["msxbox://", "https://www.xbox.com/en-US/games"];
			if (action === "client") return ["msxbox://"];
			return ["https://www.xbox.com/play"];
		}
		if (storeUrl) return [storeUrl];
		return [];
	}
	async function openInPlatformClient(game, action) {
		const uris = buildPlatformUris(game, action);
		let lastError = null;
		for (const uri of uris) try {
			await shell$1.openExternal(uri);
			return {
				success: true,
				opened: uri
			};
		} catch (e) {
			lastError = e;
		}
		const candidates = getLauncherExecutableCandidates(normalizePlatform(game.platform));
		for (const exe of candidates) {
			if (!exe || !fs$3.existsSync(exe)) continue;
			try {
				spawn$1(exe, [], {
					detached: true,
					stdio: "ignore"
				}).unref();
				return {
					success: true,
					opened: exe
				};
			} catch (e) {
				lastError = e;
			}
		}
		return {
			success: false,
			error: lastError && lastError.message || "Could not open platform client"
		};
	}
	module.exports = {
		normalizePlatform,
		openInPlatformClient
	};
}));
//#endregion
//#region electron/modules/metadata/detectionIpc.js
var require_detectionIpc = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	var { ipcMain: ipcMain$3 } = require("electron");
	var path$2 = require("path");
	var fs$2 = require("fs");
	var ctx = require_context();
	var { CHIAKI_SYSTEM_PATHS } = require_constants();
	var { findSteamRoot, scanSteamInstalled, scanEpicInstalled, scanGogInstalled, scanXboxInstalled } = require_detection();
	var { getBundledChiakiExe, getBundledChiakiVersion } = require_chiaki();
	var { getProvidersDir } = require_paths();
	function registerDetectionIpcHandlers$1() {
		const providersDir = getProvidersDir();
		const providers = require(providersDir);
		ipcMain$3.handle("detect:steam", async () => {
			try {
				return scanSteamInstalled();
			} catch (err) {
				return {
					games: [],
					error: err.message
				};
			}
		});
		ipcMain$3.handle("detect:epic", async () => {
			const games = scanEpicInstalled();
			return games.length ? { games } : {
				games: [],
				error: "Epic Games not found"
			};
		});
		ipcMain$3.handle("detect:gog", async () => {
			const games = scanGogInstalled();
			return games.length ? { games } : {
				games: [],
				error: "GOG not found"
			};
		});
		ipcMain$3.handle("detect:psremote", async () => {
			const result = {
				found: false,
				bundled: false,
				executablePath: null,
				version: null,
				consoles: []
			};
			try {
				const bundledExe = getBundledChiakiExe();
				if (bundledExe) {
					result.found = true;
					result.bundled = true;
					result.executablePath = bundledExe;
					result.version = getBundledChiakiVersion();
				}
				if (!result.found) {
					for (const p of CHIAKI_SYSTEM_PATHS) if (fs$2.existsSync(p)) {
						result.found = true;
						result.bundled = false;
						result.executablePath = p;
						break;
					}
				}
				if (result.executablePath && /^chiaki(-ng)?\.exe$/i.test(path$2.basename(result.executablePath))) try {
					result.consoles = require("child_process").execFileSync(result.executablePath, ["list"], {
						timeout: 5e3,
						env: {
							...process.env,
							PATH: `${path$2.dirname(result.executablePath)};${process.env.PATH}`
						}
					}).toString().trim().split("\n").filter((l) => l.trim());
				} catch (_e) {
					result.consoles = [];
				}
			} catch (err) {
				result.error = err.message;
			}
			return result;
		});
		ipcMain$3.handle("detect:xbox", async () => {
			try {
				return scanXboxInstalled();
			} catch (err) {
				return {
					games: [],
					xboxAppFound: false,
					error: err.message
				};
			}
		});
		function registerProviderDetectHandler(platform, label) {
			ipcMain$3.handle(`detect:${platform}`, async () => {
				try {
					const p = providers?.[platform];
					if (!p?.detectInstalled) return {
						games: [],
						appFound: false,
						error: `${label || platform} provider not available`
					};
					const res = p.detectInstalled();
					return {
						games: res?.games || [],
						appFound: !!p.isAppInstalled?.(),
						error: res?.error
					};
				} catch (err) {
					return {
						games: [],
						appFound: false,
						error: err.message
					};
				}
			});
		}
		registerProviderDetectHandler("ea", "EA");
		registerProviderDetectHandler("battlenet", "Battle.net");
		registerProviderDetectHandler("itchio", "itch.io");
		registerProviderDetectHandler("ubisoft", "Ubisoft");
		ipcMain$3.handle("playtime:sync", async () => {
			const db = ctx.db;
			const updated = [];
			try {
				const steamRoot = findSteamRoot();
				if (steamRoot) {
					const userdataDir = path$2.join(steamRoot, "userdata");
					if (fs$2.existsSync(userdataDir)) {
						const userDirs = fs$2.readdirSync(userdataDir, { withFileTypes: true }).filter((d) => d.isDirectory() && /^\d+$/.test(d.name)).map((d) => d.name);
						for (const userId of userDirs) {
							const localConfigPath = path$2.join(userdataDir, userId, "config", "localconfig.vdf");
							if (!fs$2.existsSync(localConfigPath)) continue;
							const vdfContent = fs$2.readFileSync(localConfigPath, "utf-8");
							const playtimeMap = /* @__PURE__ */ new Map();
							const appBlocks = vdfContent.matchAll(/"(\d+)"\s*\{[^}]*?"playtime_forever"\s+"(\d+)"[^}]*?\}/gs);
							for (const m of appBlocks) {
								const appId = m[1];
								const minutes = parseInt(m[2], 10);
								if (minutes > 0) {
									if (minutes > (playtimeMap.get(appId) || 0)) playtimeMap.set(appId, minutes);
								}
							}
							for (const [appId, minutes] of playtimeMap) {
								const game = db.games.find((g) => g.platform === "steam" && g.platformId === appId);
								if (game && minutes > (game.playtimeMinutes || 0)) {
									game.playtimeMinutes = minutes;
									updated.push({
										id: game.id,
										name: game.name,
										minutes,
										source: "steam"
									});
								}
							}
						}
					}
				}
				if (updated.length > 0) {
					ctx.saveDB(db);
					ctx.sendToRenderer("games:refresh", db.games);
				}
			} catch (err) {
				return {
					updated: [],
					error: err.message
				};
			}
			return {
				updated,
				games: db.games
			};
		});
	}
	module.exports = { registerDetectionIpcHandlers: registerDetectionIpcHandlers$1 };
}));
//#endregion
//#region electron/modules/games/settings.js
var require_settings = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	var { app: app$1, ipcMain: ipcMain$2, dialog: dialog$1 } = require("electron");
	var fs$1 = require("fs");
	var crypto = require("crypto");
	var ctx = require_context();
	var { connectDiscord, disconnectDiscord } = require_discord();
	var { cleanupFile } = require_covers();
	var DEFAULT_SETTINGS = {
		defaultView: "orbit",
		accentColor: "#d4a853",
		starDensity: "normal",
		showAnimations: true,
		rememberWindowBounds: true,
		autoSyncPlaytime: false,
		minimizeOnLaunch: false,
		closeToTray: false,
		defaultTab: "all",
		discordPresence: false,
		metadataSource: "steam",
		launchOnStartup: false,
		startMinimized: false
	};
	function getSettings() {
		return {
			...DEFAULT_SETTINGS,
			...ctx.db.settings || {}
		};
	}
	function registerSettingsIpcHandlers({ createTray, destroyTray, DB_PATH }) {
		ipcMain$2.handle("settings:get", () => getSettings());
		ipcMain$2.handle("settings:save", (event, newSettings) => {
			ctx.db.settings = {
				...DEFAULT_SETTINGS,
				...ctx.db.settings || {},
				...newSettings
			};
			ctx.saveDB(ctx.db);
			if (ctx.db.settings.discordPresence) connectDiscord();
			else disconnectDiscord();
			if ("launchOnStartup" in newSettings) try {
				app$1.setLoginItemSettings({ openAtLogin: !!newSettings.launchOnStartup });
			} catch (_e) {}
			if ("closeToTray" in newSettings) if (newSettings.closeToTray) createTray();
			else destroyTray();
			return ctx.db.settings;
		});
		ipcMain$2.handle("settings:reset", () => {
			ctx.db.settings = { ...DEFAULT_SETTINGS };
			ctx.saveDB(ctx.db);
			return ctx.db.settings;
		});
		ipcMain$2.handle("settings:exportLibrary", async () => {
			const result = await dialog$1.showSaveDialog(ctx.mainWindow, {
				title: "Export Library",
				defaultPath: "cereal-library.json",
				filters: [{
					name: "JSON",
					extensions: ["json"]
				}]
			});
			if (result.canceled || !result.filePath) return { cancelled: true };
			try {
				const exportData = {
					games: ctx.db.games,
					categories: ctx.db.categories,
					exportedAt: (/* @__PURE__ */ new Date()).toISOString()
				};
				fs$1.writeFileSync(result.filePath, JSON.stringify(exportData, null, 2));
				return {
					success: true,
					path: result.filePath
				};
			} catch (e) {
				return { error: e.message };
			}
		});
		ipcMain$2.handle("settings:importLibrary", async () => {
			const result = await dialog$1.showOpenDialog(ctx.mainWindow, {
				title: "Import Library",
				filters: [{
					name: "JSON",
					extensions: ["json"]
				}],
				properties: ["openFile"]
			});
			if (result.canceled || !result.filePaths.length) return { cancelled: true };
			try {
				const raw = fs$1.readFileSync(result.filePaths[0], "utf-8");
				const imported = JSON.parse(raw);
				let addedCount = 0;
				if (imported.games && Array.isArray(imported.games)) {
					const existingIds = new Set(ctx.db.games.map((g) => (g.name || "") + "|" + (g.platform || "")));
					for (const g of imported.games) {
						const key = (g.name || "") + "|" + (g.platform || "");
						if (!existingIds.has(key)) {
							g.id = Date.now().toString(36) + crypto.randomBytes(4).toString("hex");
							ctx.db.games.push(g);
							existingIds.add(key);
							addedCount++;
						}
					}
				}
				if (imported.categories && Array.isArray(imported.categories)) ctx.db.categories = [...new Set([...ctx.db.categories, ...imported.categories])];
				ctx.saveDB(ctx.db);
				return {
					success: true,
					added: addedCount,
					games: ctx.db.games,
					categories: ctx.db.categories
				};
			} catch (e) {
				return { error: e.message };
			}
		});
		ipcMain$2.handle("settings:clearCovers", () => {
			for (const game of ctx.db.games) {
				if (game.localCoverPath) {
					cleanupFile(game.localCoverPath);
					game.localCoverPath = null;
				}
				if (game.localHeaderPath) {
					cleanupFile(game.localHeaderPath);
					game.localHeaderPath = null;
				}
				game._imgStamp = Date.now();
				if (game.platform === "steam" && game.platformId) {
					game.coverUrl = `https://shared.steamstatic.com/store_item_assets/steam/apps/${game.platformId}/library_600x900_2x.jpg`;
					game.headerUrl = `https://shared.steamstatic.com/store_item_assets/steam/apps/${game.platformId}/library_hero.jpg`;
				} else {
					game.coverUrl = "";
					game.headerUrl = "";
				}
			}
			ctx.saveDB(ctx.db);
			return {
				success: true,
				games: ctx.db.games
			};
		});
		ipcMain$2.handle("settings:clearAllGames", () => {
			ctx.db.games = [];
			ctx.saveDB(ctx.db);
			return { success: true };
		});
		ipcMain$2.handle("settings:getDataPath", () => DB_PATH);
		ipcMain$2.handle("settings:getAppVersion", () => app$1.getVersion());
	}
	module.exports = {
		DEFAULT_SETTINGS,
		getSettings,
		registerSettingsIpcHandlers
	};
}));
//#endregion
//#region electron/modules/integrations/media.js
var require_media = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	var { ipcMain: ipcMain$1 } = require("electron");
	var path$1 = require("path");
	var { startXcloudSession, stopXcloudSession, getActiveXcloudSessions } = require_xcloud();
	var log = require_logger();
	var smtcNative = null;
	function getSmtcNative() {
		if (!smtcNative) try {
			smtcNative = require(path$1.join(__dirname, "native", "smtc"));
			log.info("media", "native addon loaded");
		} catch (e) {
			log.warn("media", "failed to load native addon:", e.message);
		}
		return smtcNative;
	}
	function registerMediaIpcHandlers() {
		ipcMain$1.handle("xcloud:startDirect", (_event, { url }) => {
			try {
				startXcloudSession("xbox:cloud", url || "https://www.xbox.com/play");
				return {
					success: true,
					sessionKey: "xbox:cloud"
				};
			} catch (e) {
				return {
					success: false,
					error: e.message
				};
			}
		});
		ipcMain$1.handle("xcloud:start", (_event, { gameId, url, title }) => {
			try {
				startXcloudSession(gameId, url, title);
				return { success: true };
			} catch (e) {
				return {
					success: false,
					error: e.message
				};
			}
		});
		ipcMain$1.handle("xcloud:stop", (_event, gameId) => {
			return { success: stopXcloudSession(gameId) };
		});
		ipcMain$1.handle("xcloud:getSessions", () => {
			return getActiveXcloudSessions();
		});
		ipcMain$1.handle("media:getInfo", async () => {
			const smtc = getSmtcNative();
			if (!smtc) return {};
			try {
				const info = await smtc.getMediaInfo();
				log.debug("media", "native result:", info);
				if (info.error) {
					log.warn("media", "error:", info.error);
					return {};
				}
				return {
					title: info.title || "",
					artist: info.artist || "",
					album: info.album || "",
					thumbnail: info.thumbnail || "",
					playing: info.playing,
					position: Math.floor(info.position || 0),
					duration: Math.floor(info.duration || 0)
				};
			} catch (e) {
				log.warn("media", "exception:", e.message);
				return {};
			}
		});
		ipcMain$1.handle("media:control", async (_event, action) => {
			const smtc = getSmtcNative();
			if (!smtc) return false;
			try {
				await smtc.sendMediaKey(action);
				return true;
			} catch (e) {
				log.warn("media", "control error:", e.message);
				return false;
			}
		});
	}
	module.exports = { registerMediaIpcHandlers };
}));
//#endregion
//#region electron/main.js
var { app, BrowserWindow, ipcMain, dialog, shell, session, Tray, Menu, nativeImage, net, protocol } = require("electron");
var path = require("path");
var fs = require("fs");
app.commandLine.appendSwitch("enable-gpu-rasterization");
app.commandLine.appendSwitch("enable-zero-copy");
app.commandLine.appendSwitch("ignore-gpu-blocklist");
app.commandLine.appendSwitch("enable-hardware-overlays", "single-fullscreen,single-on-top,underlay");
app.commandLine.appendSwitch("enable-features", "CanvasOopRasterization,UseSkiaRenderer");
protocol.registerSchemesAsPrivileged([{
	scheme: "local-image",
	privileges: {
		standard: false,
		supportFetchAPI: true,
		stream: true,
		bypassCSP: false
	}
}]);
var { safeStore } = require_credentials();
var { spawn } = require("child_process");
var os = require("os");
var { ACCOUNT_SECRET_FIELDS } = require_constants();
var log = require_logger();
var { detachAccountSecrets, registerAccountIpcHandlers } = require_accounts();
var { connectDiscord, disconnectDiscord, setDiscordPresence, isDiscordEnabled, getDiscordStatus } = require_discord();
ipcMain.handle("discord:status", () => getDiscordStatus());
var { getCoversDir, cleanupFile, enqueueCoverFetch } = require_covers();
var { chiakiSessions, resolveChiakiExe, buildChiakiArgs, startChiakiSession, sendEmbedBoundsToAll, autoSetupChiakiIfMissing, registerChiakiIpcHandlers } = require_chiaki();
var { xcloudSessions, updateAllXcloudBounds, startXcloudSession } = require_xcloud();
var { registerGameCrudIpcHandlers } = require_gameCrud();
registerGameCrudIpcHandlers();
var { DB_PATH, loadDB, saveDB, flushDB } = require_database();
var db = null;
var mainWindow;
var trayIcon = null;
var isQuitting = false;
function sendToRenderer(channel, ...args) {
	if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, ...args);
}
function toggleDevTools() {
	if (!mainWindow || mainWindow.isDestroyed()) return;
	const contents = mainWindow.webContents;
	if (!contents) return;
	if (contents.isDevToolsOpened()) contents.closeDevTools();
	else contents.openDevTools({ mode: "detach" });
}
function createWindow() {
	const savedBounds = db && db.settings && db.settings.rememberWindowBounds && db.settings.windowBounds ? db.settings.windowBounds : null;
	const winOpts = {
		width: 1280,
		height: 800,
		minWidth: 900,
		minHeight: 600,
		frame: false,
		show: true,
		backgroundColor: "#0a0a0f",
		webPreferences: {
			preload: path.join(__dirname, "preload.js"),
			contextIsolation: true,
			nodeIntegration: false,
			backgroundThrottling: false
		}
	};
	if (savedBounds) {
		if (typeof savedBounds.x === "number" && typeof savedBounds.y === "number") {
			winOpts.x = savedBounds.x;
			winOpts.y = savedBounds.y;
		}
		if (typeof savedBounds.width === "number" && typeof savedBounds.height === "number") {
			winOpts.width = savedBounds.width;
			winOpts.height = savedBounds.height;
		}
	}
	mainWindow = new BrowserWindow(winOpts);
	if (savedBounds && savedBounds.isMaximized) try {
		mainWindow.maximize();
	} catch (_e) {}
	if (process.env.VITE_DEV_SERVER_URL) mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
	else mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
	if (process.env.CEREAL_DEVTOOLS === "1") mainWindow.webContents.once("did-finish-load", () => {
		try {
			toggleDevTools();
		} catch (e) {
			log.error("main", "Auto DevTools failed:", e.message);
		}
	});
	mainWindow.webContents.on("will-navigate", (event, url) => {
		const devServer = process.env.VITE_DEV_SERVER_URL;
		if (devServer && url.startsWith(devServer)) return;
		if (url.startsWith("file://")) return;
		event.preventDefault();
	});
	mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
	mainWindow.webContents.on("before-input-event", (event, input) => {
		if (input.type !== "keyDown") return;
		if (!(input.control && input.shift && input.code === "KeyI" || input.code === "F12")) return;
		event.preventDefault();
		if (!app.isPackaged) toggleDevTools();
	});
	mainWindow.on("resize", onWindowBoundsChanged);
	mainWindow.on("move", onWindowBoundsChanged);
	mainWindow.on("restore", onWindowBoundsChanged);
	mainWindow.on("maximize", onWindowBoundsChanged);
	mainWindow.on("unmaximize", onWindowBoundsChanged);
	mainWindow.on("close", (e) => {
		saveWindowBounds();
		if (!isQuitting && db && db.settings && db.settings.closeToTray) {
			e.preventDefault();
			mainWindow.hide();
		}
	});
	mainWindow.on("minimize", () => {
		for (const session of chiakiSessions.values()) if (session.embedProcess && !session.embedProcess.killed) try {
			session.embedProcess.stdin.write("hide\n");
		} catch (_e) {}
		for (const sess of xcloudSessions.values()) try {
			sess.view.setVisible(false);
		} catch (_e) {}
	});
	mainWindow.on("focus", () => {
		for (const session of chiakiSessions.values()) if (session.embedded && session.embedProcess && !session.embedProcess.killed) try {
			session.embedProcess.stdin.write("show\n");
		} catch (_e) {}
		for (const sess of xcloudSessions.values()) try {
			sess.view.setVisible(true);
		} catch (_e) {}
	});
}
if (!app.requestSingleInstanceLock()) app.quit();
else app.on("second-instance", () => {
	if (mainWindow) {
		if (!mainWindow.isVisible()) mainWindow.show();
		if (mainWindow.isMinimized()) mainWindow.restore();
		mainWindow.focus();
	}
});
function destroyTray() {
	if (!trayIcon) return;
	try {
		trayIcon.destroy();
	} catch (_e) {}
	trayIcon = null;
}
function createTray() {
	if (trayIcon) return;
	trayIcon = new Tray(nativeImage.createFromDataURL("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAY0lEQVR42mP4z8BQz0BAwAADTAxEAqpawMRAAYAa8J+BgQEkTbQBjFiEGYgxgJGBgYERqoERp9OhhjBS0wsoF7AwkOYFcn0BdQHRvsBnAMVeGIAGdCAL4AFixu8FBgYGBgC3+y+Mfb/haQAAAABJRU5ErkJggg=="));
	trayIcon.setToolTip("Cereal Launcher");
	const contextMenu = Menu.buildFromTemplate([
		{
			label: "Show Cereal",
			click: () => {
				if (mainWindow) {
					mainWindow.show();
					mainWindow.focus();
				}
			}
		},
		{ type: "separator" },
		{
			label: "Quit",
			click: () => {
				isQuitting = true;
				app.quit();
			}
		}
	]);
	trayIcon.setContextMenu(contextMenu);
	trayIcon.on("click", () => {
		if (mainWindow) {
			mainWindow.show();
			mainWindow.focus();
		}
	});
}
app.whenReady().then(() => {
	protocol.handle("local-image", (request) => {
		let filePath = decodeURIComponent(new URL(request.url).pathname);
		if (process.platform === "win32" && filePath.startsWith("/")) filePath = filePath.slice(1);
		const coversDir = getCoversDir();
		const resolved = path.resolve(filePath);
		if (!resolved.startsWith(coversDir + path.sep) && resolved !== coversDir) return new Response("Forbidden", { status: 403 });
		return net.fetch("file:///" + resolved.replace(/\\/g, "/"));
	});
	db = loadDB();
	const ctx = require_context();
	ctx.db = db;
	ctx.safeStore = safeStore;
	ctx.saveDB = saveDB;
	ctx.flushDB = () => flushDB(db);
	ctx.sendToRenderer = sendToRenderer;
	if (db.accounts && typeof db.accounts === "object") {
		let changed = false;
		for (const platform of Object.keys(db.accounts)) {
			const acct = db.accounts[platform];
			if (acct && ACCOUNT_SECRET_FIELDS.some((k) => acct[k] != null)) {
				detachAccountSecrets(platform, { save: false });
				changed = true;
			}
		}
		if (changed) saveDB(db);
	}
	const CURRENT_MIGRATION = 2;
	const lastMigration = db.settings && db.settings._migrationVersion || 0;
	if (lastMigration < 1) {
		let coversCleaned = 0;
		for (const game of db.games || []) {
			if (game.localCoverPath) try {
				if (!fs.existsSync(game.localCoverPath) || fs.statSync(game.localCoverPath).size < 1024) {
					cleanupFile(game.localCoverPath);
					game.localCoverPath = null;
					coversCleaned++;
				}
			} catch (_e) {
				game.localCoverPath = null;
				coversCleaned++;
			}
			if (game.localHeaderPath) try {
				if (!fs.existsSync(game.localHeaderPath) || fs.statSync(game.localHeaderPath).size < 1024) {
					cleanupFile(game.localHeaderPath);
					game.localHeaderPath = null;
					coversCleaned++;
				}
			} catch (_e) {
				game.localHeaderPath = null;
				coversCleaned++;
			}
		}
		if (coversCleaned > 0) log.info("main", "Cleaned", coversCleaned, "corrupt cover references");
		try {
			const coversDir = getCoversDir();
			let purged = 0;
			for (const f of fs.readdirSync(coversDir)) {
				const fp = path.join(coversDir, f);
				try {
					if (fs.statSync(fp).size < 1024) {
						fs.unlinkSync(fp);
						purged++;
					}
				} catch (_e) {}
			}
			if (purged > 0) log.info("main", "Purged", purged, "corrupt files from covers directory");
		} catch (_e) {}
	}
	if (lastMigration < 2) {
		let backfilled = 0;
		for (const game of db.games || []) if (game.platform === "steam" && game.platformId && !game.headerUrl) {
			game.headerUrl = `https://shared.steamstatic.com/store_item_assets/steam/apps/${game.platformId}/header.jpg`;
			backfilled++;
		}
		if (backfilled > 0) log.info("main", "Backfilled", backfilled, "Steam header URLs");
	}
	if (lastMigration < CURRENT_MIGRATION) {
		db.settings = db.settings || {};
		db.settings._migrationVersion = CURRENT_MIGRATION;
		saveDB(db);
	}
	setTimeout(() => {
		let requeued = 0;
		for (const game of db.games || []) {
			const needsCover = !game.localCoverPath && (game.coverUrl || game.headerUrl || game.screenshots && game.screenshots.length);
			const needsHeader = !game.localHeaderPath && game.headerUrl;
			if (needsCover || needsHeader) {
				enqueueCoverFetch(game.id);
				requeued++;
			}
		}
		if (requeued > 0) log.info("main", "Re-enqueued", requeued, "games for cover download");
	}, 3e3);
	session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
		callback([
			"clipboard-read",
			"clipboard-sanitized-write",
			"fullscreen"
		].includes(permission));
	});
	session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
		callback({ responseHeaders: {
			...details.responseHeaders,
			"Content-Security-Policy": [
				"default-src 'self'",
				"script-src 'self' 'unsafe-inline'",
				"style-src 'self' 'unsafe-inline'",
				"img-src 'self' data: local-image: https: http:",
				"font-src 'self' data:",
				[
					"connect-src 'self'",
					"https://*.steampowered.com https://*.steamstatic.com https://store.steampowered.com https://api.steampowered.com https://steamcdn-a.akamaihd.net",
					"https://*.steamgriddb.com https://*.gog.com https://*.epicgames.com",
					"https://*.xbox.com https://*.xboxlive.com",
					"https://*.wikipedia.org https://*.wikidata.org https://*.wikimedia.org https://*.duckduckgo.com",
					...!app.isPackaged ? ["https://localhost ws://localhost wss://localhost"] : []
				].join(" ")
			].join("; ")
		} });
	});
	createWindow();
	ctx.mainWindow = mainWindow;
	if (db.settings && db.settings.closeToTray) createTray();
	if (db.settings && db.settings.startMinimized) mainWindow.hide();
	if (isDiscordEnabled()) setTimeout(connectDiscord, 8e3);
	setTimeout(autoSetupChiakiIfMissing, 6e3);
	setTimeout(() => {
		const { autoUpdater } = require("electron-updater");
		autoUpdater.autoDownload = true;
		autoUpdater.autoInstallOnAppQuit = true;
		for (const evt of [
			"checking-for-update",
			"update-available",
			"update-not-available",
			"download-progress",
			"update-downloaded",
			"error"
		]) autoUpdater.on(evt, (data) => {
			sendToRenderer("update:event", {
				type: evt,
				data: evt === "error" ? data && data.message || String(data) : data
			});
		});
		autoUpdater.checkForUpdates().catch(() => {});
	}, 5e3);
});
app.on("window-all-closed", () => {
	disconnectDiscord();
	if (db && db.settings && db.settings.closeToTray) return;
	if (process.platform !== "darwin") app.quit();
});
app.on("before-quit", () => {
	isQuitting = true;
	try {
		saveWindowBounds();
	} catch (_e) {}
	flushDB(db);
});
app.on("will-quit", () => {
	try {
		for (const [_gameId, sess] of xcloudSessions) {
			try {
				mainWindow?.contentView?.removeChildView(sess.view);
			} catch (_e) {
				log.debug("xcloud", "cleanup removeChildView failed");
			}
			try {
				sess.view?.webContents?.close();
			} catch (_e) {
				log.debug("xcloud", "cleanup webContents close failed");
			}
		}
		xcloudSessions.clear();
	} catch (_e) {
		log.debug("xcloud", "session cleanup error");
	}
});
ipcMain.handle("window:minimize", () => mainWindow.minimize());
ipcMain.handle("window:maximize", () => {
	if (mainWindow.isMaximized()) mainWindow.unmaximize();
	else mainWindow.maximize();
	return mainWindow.isMaximized();
});
ipcMain.handle("window:close", () => mainWindow.close());
ipcMain.handle("window:fullscreen", () => {
	mainWindow.setFullScreen(!mainWindow.isFullScreen());
	return mainWindow.isFullScreen();
});
ipcMain.handle("window:isFullscreen", () => mainWindow.isFullScreen());
ipcMain.handle("shell:openExternal", (event, url) => {
	try {
		const parsed = new URL(url);
		if (![
			"http:",
			"https:",
			"mailto:",
			"steam:",
			"epicgames:",
			"com.epicgames.launcher:",
			"goggalaxy:",
			"origin:",
			"origin2:",
			"uplay:",
			"battlenet:",
			"xbox:",
			"msxbox:",
			"ms-xbl-multiplayer:"
		].includes(parsed.protocol)) return { error: "Blocked protocol: " + parsed.protocol };
	} catch (_e) {
		return { error: "Invalid URL" };
	}
	return shell.openExternal(url);
});
ipcMain.handle("system:getSpecs", async () => {
	const ramGb = Math.round(os.totalmem() / (1024 * 1024 * 1024));
	const cpus = os.cpus();
	const cpuCount = cpus.length;
	const cpuModel = cpus[0]?.model?.trim() || "";
	let gpuName = "";
	try {
		const gpu = (await app.getGPUInfo("basic"))?.gpuDevice?.[0];
		if (gpu?.description) gpuName = gpu.description;
	} catch (_e) {
		log.debug("system", "GPU info unavailable", _e);
	}
	return {
		ramGb,
		cpuCount,
		cpuModel,
		gpuName
	};
});
var _embedResizeTimer = null;
var _saveBoundsTimer = null;
function scheduleSaveWindowBounds() {
	clearTimeout(_saveBoundsTimer);
	_saveBoundsTimer = setTimeout(saveWindowBounds, 500);
}
function saveWindowBounds() {
	try {
		if (!mainWindow || mainWindow.isDestroyed()) return;
		if (db && db.settings && db.settings.rememberWindowBounds === false) return;
		const isMax = mainWindow.isMaximized();
		const bounds = isMax ? db.settings && db.settings.windowBounds ? db.settings.windowBounds : {} : mainWindow.getBounds();
		db.settings = db.settings || {};
		db.settings.windowBounds = {
			x: bounds.x || 0,
			y: bounds.y || 0,
			width: bounds.width || 1280,
			height: bounds.height || 800,
			isMaximized: !!isMax
		};
		saveDB(db);
	} catch (e) {
		log.error("main", "Failed saving window bounds", e && e.message);
	}
}
function onWindowBoundsChanged() {
	clearTimeout(_embedResizeTimer);
	_embedResizeTimer = setTimeout(() => {
		sendEmbedBoundsToAll();
		updateAllXcloudBounds();
	}, 50);
	scheduleSaveWindowBounds();
}
var { registerKeysIpcHandlers } = require_keys();
registerKeysIpcHandlers();
var { registerMetadataIpcHandlers } = require_metadataIpc();
registerMetadataIpcHandlers();
var { normalizePlatform, openInPlatformClient } = require_launcher();
ipcMain.handle("games:launch", async (event, id) => {
	const game = db.games.find((g) => g.id === id);
	if (!game) return {
		success: false,
		error: "Game not found"
	};
	try {
		let launchPath = game.executablePath;
		if (game.platform === "psremote" || game.platform === "psn") {
			const chiakiExe = resolveChiakiExe(launchPath);
			if (!chiakiExe) return {
				success: false,
				error: "chiaki-ng not found. It should download automatically — try again in a moment, or check Settings > PlayStation."
			};
			const chiakiConfig = db.chiakiConfig || {};
			const consoles = chiakiConfig.consoles || [];
			let effectiveGame = game;
			if (!game.chiakiHost || !game.chiakiRegistKey) {
				const matched = game.chiakiHost ? consoles.find((c) => c.host === game.chiakiHost) : consoles.find((c) => c.registKey && c.morning);
				if (matched) effectiveGame = {
					...game,
					chiakiHost: game.chiakiHost || matched.host,
					chiakiNickname: game.chiakiNickname || matched.nickname || "",
					chiakiProfile: game.chiakiProfile || matched.profile || "",
					chiakiRegistKey: game.chiakiRegistKey || matched.registKey || "",
					chiakiMorning: game.chiakiMorning || matched.morning || ""
				};
				else if (!game.chiakiHost) return {
					success: false,
					error: "No registered PlayStation console found. Open Remote Play to add and register a console first."
				};
			}
			startChiakiSession(id, chiakiExe, buildChiakiArgs(effectiveGame, chiakiConfig));
		} else if (game.platform === "xbox") startXcloudSession(id, game.streamUrl || "https://www.xbox.com/play");
		else if ([
			"steam",
			"epic",
			"gog",
			"ea",
			"battlenet",
			"ubisoft",
			"itchio"
		].includes(normalizePlatform(game.platform))) {
			const openRes = await openInPlatformClient(game, "play");
			if (!openRes.success) return openRes;
		} else if (launchPath && fs.existsSync(launchPath)) spawn(launchPath, [], {
			cwd: path.dirname(launchPath),
			detached: true,
			stdio: "ignore"
		}).unref();
		else return {
			success: false,
			error: "Executable not found"
		};
		if (![
			"psn",
			"psremote",
			"xbox"
		].includes(game.platform)) {
			game.lastPlayed = (/* @__PURE__ */ new Date()).toISOString();
			saveDB(db);
		}
		if (db.settings && db.settings.minimizeOnLaunch && mainWindow) mainWindow.minimize();
		if (isDiscordEnabled()) {
			connectDiscord();
			setDiscordPresence(game.name, game.platform);
		}
		return {
			success: true,
			lastPlayed: game.lastPlayed
		};
	} catch (err) {
		return {
			success: false,
			error: err.message
		};
	}
});
ipcMain.handle("games:install", async (event, id) => {
	const game = db.games.find((g) => g.id === id);
	if (!game) return {
		success: false,
		error: "Game not found"
	};
	try {
		if (normalizePlatform(game.platform) === "psn") return {
			success: false,
			error: "Install is not supported for Remote Play titles"
		};
		if (normalizePlatform(game.platform) === "custom") return {
			success: false,
			error: "Custom games must be installed manually"
		};
		return await openInPlatformClient(game, "install");
	} catch (err) {
		return {
			success: false,
			error: err.message
		};
	}
});
ipcMain.handle("games:openInClient", async (event, id) => {
	const game = db.games.find((g) => g.id === id);
	if (!game) return {
		success: false,
		error: "Game not found"
	};
	try {
		return await openInPlatformClient(game, "client");
	} catch (err) {
		return {
			success: false,
			error: err.message
		};
	}
});
ipcMain.handle("dialog:pickExecutable", async () => {
	const result = await dialog.showOpenDialog(mainWindow, {
		properties: ["openFile"],
		filters: [{
			name: "Executables",
			extensions: [
				"exe",
				"bat",
				"cmd",
				"lnk"
			]
		}, {
			name: "All Files",
			extensions: ["*"]
		}]
	});
	if (!result.canceled && result.filePaths.length > 0) return result.filePaths[0];
	return null;
});
ipcMain.handle("dialog:pickImage", async () => {
	const result = await dialog.showOpenDialog(mainWindow, {
		properties: ["openFile"],
		filters: [{
			name: "Images",
			extensions: [
				"png",
				"jpg",
				"jpeg",
				"webp",
				"gif",
				"bmp"
			]
		}]
	});
	if (!result.canceled && result.filePaths.length > 0) {
		const src = result.filePaths[0];
		try {
			const fd = fs.openSync(src, "r");
			const magic = Buffer.alloc(4);
			fs.readSync(fd, magic, 0, 4, 0);
			fs.closeSync(fd);
			if (!(magic[0] === 255 && magic[1] === 216 && magic[2] === 255 || magic[0] === 137 && magic[1] === 80 && magic[2] === 78 && magic[3] === 71 || magic[0] === 71 && magic[1] === 73 && magic[2] === 70 || magic[0] === 82 && magic[1] === 73 && magic[2] === 70 && magic[3] === 70 || magic[0] === 66 && magic[1] === 77)) return null;
		} catch (_e) {
			return null;
		}
		const ext = path.extname(src);
		const destName = `cover_${Date.now()}${ext}`;
		const dest = path.join(getCoversDir(), destName);
		fs.copyFileSync(src, dest);
		return dest;
	}
	return null;
});
var { registerDetectionIpcHandlers } = require_detectionIpc();
registerDetectionIpcHandlers();
var { registerSettingsIpcHandlers } = require_settings();
registerSettingsIpcHandlers({
	createTray,
	destroyTray,
	DB_PATH
});
ipcMain.handle("update:check", () => {
	const { autoUpdater } = require("electron-updater");
	return autoUpdater.checkForUpdates().catch((err) => ({ error: err.message }));
});
ipcMain.handle("update:install", () => {
	const { autoUpdater } = require("electron-updater");
	autoUpdater.quitAndInstall();
});
registerAccountIpcHandlers();
registerChiakiIpcHandlers();
var { registerMediaIpcHandlers } = require_media();
registerMediaIpcHandlers();
//#endregion
