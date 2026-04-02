//#region \0rolldown/runtime.js
var __commonJSMin = (cb, mod) => () => (mod || cb((mod = { exports: {} }).exports, mod), mod.exports);
//#endregion
//#region electron/native/smtc/index.js
var require_smtc = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	var path$1 = require("path");
	var { exec } = require("child_process");
	var EXE_PATH = path$1.join(__dirname, "..", "MediaInfoTool.exe");
	function runExe(args) {
		return new Promise((resolve) => {
			const safeArgs = (args || []).map((a) => "\"" + String(a).replace(/"/g, "") + "\"").join(" ");
			exec("\"" + EXE_PATH + "\"" + (safeArgs ? " " + safeArgs : ""), { timeout: 5e3 }, (err, stdout) => {
				try {
					resolve(JSON.parse(stdout.trim()));
				} catch {
					resolve({ error: err ? err.message : "parse error" });
				}
			});
		});
	}
	module.exports = {
		getMediaInfo: () => runExe(),
		sendMediaKey: (action) => runExe(["sendKey", action])
	};
}));
//#endregion
//#region electron/main.js
var { app, BrowserWindow, ipcMain, dialog, shell, session, WebContentsView, Tray, Menu, nativeImage, globalShortcut } = require("electron");
var path = require("path");
var fs = require("fs");
app.commandLine.appendSwitch("enable-gpu-rasterization");
app.commandLine.appendSwitch("enable-zero-copy");
app.commandLine.appendSwitch("ignore-gpu-blocklist");
app.commandLine.appendSwitch("enable-hardware-overlays", "single-fullscreen,single-on-top,underlay");
app.commandLine.appendSwitch("enable-features", "VaapiVideoDecodeLinuxGL,VaapiVideoEncoder,CanvasOopRasterization,UseSkiaRenderer");
var credStorePath = () => path.join(app.getPath("userData"), "credentials.json");
function loadCredStore() {
	try {
		return JSON.parse(fs.readFileSync(credStorePath(), "utf-8"));
	} catch {
		return {};
	}
}
function saveCredStore(store) {
	fs.writeFileSync(credStorePath(), JSON.stringify(store, null, 2), "utf-8");
}
var safeStore = {
	setPassword(service, account, secret) {
		const { safeStorage } = require("electron");
		if (!safeStorage.isEncryptionAvailable()) throw new Error("Encryption not available");
		const store = loadCredStore();
		const key = `${service}/${account}`;
		store[key] = safeStorage.encryptString(secret).toString("base64");
		saveCredStore(store);
	},
	getPassword(service, account) {
		const { safeStorage } = require("electron");
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
};
var { execSync, spawn } = require("child_process");
var readline = require("readline");
var http = require("http");
var https = require("https");
var crypto = require("crypto");
var zlib = require("zlib");
var { pipeline } = require("stream");
var { promisify } = require("util");
var { autoUpdater } = require("electron-updater");
promisify(pipeline);
var providers = require(path.join(__dirname, "providers"));
var ACCOUNT_SECRET_FIELDS = [
	"accessToken",
	"refreshToken",
	"msAccessToken",
	"msRefreshToken",
	"xblToken",
	"xstsToken",
	"userHash"
];
function accountSecretService(platform) {
	return `cereal-account-${platform}`;
}
function loadAccountSecrets(platform) {
	try {
		const raw = safeStore.getPassword(accountSecretService(platform), "tokens");
		if (!raw) return {};
		return JSON.parse(raw);
	} catch (e) {
		return {};
	}
}
function storeAccountSecrets(platform, secrets) {
	try {
		const service = accountSecretService(platform);
		if (secrets && Object.keys(secrets).length) safeStore.setPassword(service, "tokens", JSON.stringify(secrets));
		else safeStore.deletePassword(service, "tokens");
	} catch (e) {
		console.error("account secret store error", platform, e && e.message);
	}
}
function detachAccountSecrets(platform, { save = true } = {}) {
	const acct = db?.accounts?.[platform];
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
		if (save) saveDB(db);
	} else if (hasSecrets && save) saveDB(db);
	return hasSecrets;
}
function hydrateAccountSecrets(platform) {
	const acct = db?.accounts?.[platform];
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
	if (!db.accounts) db.accounts = {};
	const acct = db.accounts[platform] || {};
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
	db.accounts[platform] = acct;
	if (secretsChanged || removedSecrets) storeAccountSecrets(platform, hasSecrets ? secrets : null);
	if (Object.keys(data).length) saveDB(db);
	return acct;
}
var DiscordRPC = require("discord-rpc");
var DISCORD_CLIENT_ID = "1338877643523145789";
var discordRpc = null;
var discordReady = false;
var discordCurrentGame = null;
function connectDiscord() {
	if (discordRpc) return;
	try {
		discordRpc = new DiscordRPC.Client({ transport: "ipc" });
		discordRpc.on("ready", () => {
			discordReady = true;
			console.log("[Discord] RPC ready");
		});
		discordRpc.login({ clientId: DISCORD_CLIENT_ID }).catch((err) => {
			console.log("[Discord] Could not connect:", err.message);
			discordRpc = null;
		});
	} catch (e) {
		console.log("[Discord] Init error:", e.message);
		discordRpc = null;
	}
}
function disconnectDiscord() {
	if (discordRpc) {
		try {
			discordRpc.clearActivity();
		} catch (e) {}
		try {
			discordRpc.destroy();
		} catch (e) {}
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
	} catch (e) {
		console.log("[Discord] Presence error:", e.message);
	}
}
function clearDiscordPresence() {
	discordCurrentGame = null;
	if (!discordRpc || !discordReady) return;
	try {
		discordRpc.clearActivity();
	} catch (e) {}
}
function isDiscordEnabled() {
	return !!(db && db.settings && db.settings.discordPresence);
}
ipcMain.handle("discord:status", () => ({
	ready: discordReady,
	connected: !!discordRpc
}));
var pendingOAuthStates = /* @__PURE__ */ new Map();
var AUTH_TIMEOUT_MS = 300 * 1e3;
function generateOAuthState() {
	const state = crypto.randomBytes(32).toString("hex");
	pendingOAuthStates.set(state, { timestamp: Date.now() });
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
	"login.microsoftonline.com",
	"login.live.com",
	"account.live.com",
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
	const win = new BrowserWindow({
		width,
		height,
		parent: mainWindow,
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
var { httpGetJson, httpPost } = require("./providers/http");
function getChiakiDir() {
	const packaged = path.join(process.resourcesPath || "", "chiaki-ng");
	if (fs.existsSync(packaged)) return packaged;
	const dev = path.join(__dirname, "resources", "chiaki-ng");
	if (fs.existsSync(dev)) return dev;
	const src = path.join(__dirname, "..", "public", "resources", "chiaki-ng");
	if (fs.existsSync(src)) return src;
	return null;
}
function getBundledChiakiExe() {
	const dir = getChiakiDir();
	if (!dir) return null;
	const candidates = ["chiaki.exe", "chiaki-ng.exe"];
	for (const name of candidates) {
		const p = path.join(dir, name);
		if (fs.existsSync(p)) return p;
	}
	try {
		const entries = fs.readdirSync(dir, { withFileTypes: true });
		for (const entry of entries) if (entry.isDirectory()) for (const name of candidates) {
			const p = path.join(dir, entry.name, name);
			if (fs.existsSync(p)) return p;
		}
	} catch (e) {}
	return null;
}
function getBundledChiakiVersion() {
	const dir = getChiakiDir();
	if (!dir) return null;
	const vf = path.join(dir, ".version");
	try {
		return fs.readFileSync(vf, "utf-8").trim();
	} catch (e) {
		return null;
	}
}
function getCoversDir() {
	const dir = path.join(app.getPath("userData"), "covers");
	try {
		if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
	} catch (e) {}
	return dir;
}
async function downloadToFile(url, destPath) {
	return new Promise((resolve, reject) => {
		https.get(url, (res) => {
			if (res.statusCode && res.statusCode >= 400) return reject(/* @__PURE__ */ new Error("HTTP " + res.statusCode));
			const file = fs.createWriteStream(destPath);
			res.pipe(file);
			file.on("finish", () => file.close(() => resolve(true)));
			file.on("error", (err) => reject(err));
		}).on("error", reject);
	});
}
var coverQueue = [];
var coverWorkerRunning = false;
function enqueueCoverFetch(gameId) {
	if (!gameId) return;
	if (!coverQueue.includes(gameId)) coverQueue.push(gameId);
	if (!coverWorkerRunning) processCoverQueue();
}
async function processCoverQueue() {
	coverWorkerRunning = true;
	while (coverQueue.length > 0) {
		const batch = coverQueue.splice(0, 3);
		let anyChanged = false;
		await Promise.allSettled(batch.map(async (gid) => {
			try {
				const game = db.games.find((g) => g.id === gid);
				if (!game) return;
				if (game.localCoverPath && fs.existsSync(game.localCoverPath)) return;
				const url = game.coverUrl || game.headerUrl || game.screenshots && game.screenshots[0];
				if (!url) return;
				const ext = path.extname(new URL(url).pathname).split("?")[0] || ".jpg";
				const fname = "cover_" + gid + ext;
				const dest = path.join(getCoversDir(), fname);
				await downloadToFile(url, dest);
				game.localCoverPath = dest;
				game._imgStamp = Date.now();
				anyChanged = true;
				console.log("[CoverFetcher] saved", dest);
			} catch (e) {
				console.log("[CoverFetcher] download failed for", gid, e && e.message);
			}
		}));
		if (anyChanged) {
			saveDB(db);
			if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("games:refresh", db.games);
		}
		if (coverQueue.length > 0) await new Promise((r) => setTimeout(r, 150));
	}
	coverWorkerRunning = false;
}
var chiakiSessions = /* @__PURE__ */ new Map();
function resolveChiakiExe(fallbackPath) {
	const bundled = getBundledChiakiExe();
	if (bundled) return bundled;
	return [
		path.join(process.env.ProgramFiles || "", "chiaki-ng", "chiaki.exe"),
		path.join(process.env["ProgramFiles(x86)"] || "", "chiaki-ng", "chiaki.exe"),
		path.join(process.env.LOCALAPPDATA || "", "chiaki-ng", "chiaki.exe"),
		path.join(process.env.ProgramFiles || "", "chiaki-ng", "chiaki-ng.exe"),
		path.join(process.env.LOCALAPPDATA || "", "chiaki-ng", "chiaki-ng.exe"),
		fallbackPath
	].filter(Boolean).find((p) => p && fs.existsSync(p)) || null;
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
function startChiakiSession(gameId, chiakiExe, args) {
	stopChiakiSession(gameId);
	const chiakiDir = path.dirname(chiakiExe);
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
		session.process = spawn(chiakiExe, [], {
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
	session.process = spawn(chiakiExe, args, {
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
		} catch (e) {}
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
		if (titleElapsed > 0 && db) {
			const game = db.games.find((g) => g.id === trackId);
			if (game) {
				game.playtimeMinutes = (game.playtimeMinutes || 0) + titleElapsed;
				game.lastPlayed = (/* @__PURE__ */ new Date()).toISOString();
				saveDB(db);
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
		const game = db.games.find((g) => g.id === gameId);
		if (game) {
			if (!discordRpc) connectDiscord();
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
		if (process.platform === "win32") spawn("taskkill", [
			"/pid",
			String(session.process.pid),
			"/t",
			"/f"
		], { stdio: "ignore" });
		else session.process.kill("SIGTERM");
		setTimeout(() => {
			try {
				if (!session.process.killed) session.process.kill("SIGKILL");
			} catch (e) {}
		}, 3e3);
	} catch (e) {}
	chiakiSessions.delete(gameId);
	return true;
}
var xcloudSessions = /* @__PURE__ */ new Map();
function getXcloudBounds() {
	const [cw, ch] = mainWindow ? mainWindow.getContentSize() : [1280, 720];
	const barH = 40;
	return {
		x: 0,
		y: barH,
		width: cw,
		height: Math.max(1, ch - barH)
	};
}
function updateXcloudBounds(sess) {
	if (!sess || !sess.view) return;
	const b = getXcloudBounds();
	try {
		sess.view.setBounds(b);
	} catch (e) {}
}
function updateAllXcloudBounds() {
	for (const sess of xcloudSessions.values()) updateXcloudBounds(sess);
}
function startXcloudSession(gameId, url) {
	stopXcloudSession(gameId);
	const view = new WebContentsView({ webPreferences: {
		session: session.fromPartition("persist:xcloud"),
		contextIsolation: true,
		sandbox: true
	} });
	const ua = view.webContents.getUserAgent().replace(/Electron\/\S+\s*/, "") + " Edg/120.0.0.0";
	view.webContents.setUserAgent(ua);
	mainWindow.contentView.addChildView(view);
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
	view.webContents.on("did-fail-load", (e, code, desc) => {
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
	return sess;
}
function stopXcloudSession(gameId) {
	const sess = xcloudSessions.get(gameId);
	if (!sess) return false;
	if (sess._stopping) return false;
	sess._stopping = true;
	try {
		if (sess.view?.webContents && !sess.view.webContents.isDestroyed()) try {
			sess.view.webContents.loadURL("https://www.xbox.com/play");
		} catch (e) {}
		setTimeout(() => {
			try {
				if (mainWindow && !mainWindow.isDestroyed()) mainWindow.contentView.removeChildView(sess.view);
			} catch (e) {}
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
			} catch (e) {}
			try {
				if (!sess.view.webContents.isDestroyed()) sess.view.webContents.close();
			} catch (e) {}
			try {
				if (sess.view && !sess.view.isDestroyed()) sess.view = null;
			} catch (e) {}
			xcloudSessions.delete(gameId);
			sendStreamEvent(gameId, "disconnected", {
				reason: "stopped",
				platform: "xbox"
			});
			console.log(`[xcloud] Session ${gameId} stopped gracefully`);
		}, 500);
		return true;
	} catch (e) {
		console.error("[xcloud] Error stopping session:", e);
		try {
			mainWindow?.contentView?.removeChildView(sess.view);
		} catch (_) {}
		try {
			sess.view?.webContents?.close();
		} catch (_) {}
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
	const result = {};
	for (const [gameId, sess] of xcloudSessions) result[gameId] = {
		state: sess.state,
		platform: "xbox",
		startTime: sess.startTime
	};
	return result;
}
function getStreamBounds() {
	const [cw, ch] = mainWindow ? mainWindow.getContentSize() : [1280, 720];
	let sf = 1;
	try {
		const { screen } = require("electron");
		const winBounds = mainWindow.getBounds();
		sf = screen.getDisplayNearestPoint({
			x: winBounds.x + winBounds.width / 2,
			y: winBounds.y + winBounds.height / 2
		}).scaleFactor || 1;
	} catch (e) {}
	const barH = Math.round(40 * sf);
	return {
		x: 0,
		y: barH,
		w: Math.round(cw * sf),
		h: Math.max(1, Math.round(ch * sf) - barH)
	};
}
function startEmbedHelper(gameId, session) {
	if (process.platform !== "win32") return;
	if (!mainWindow || !session.process) return;
	const hwnd = mainWindow.getNativeWindowHandle().readBigUInt64LE(0).toString();
	const b = getStreamBounds();
	const ps = spawn("powershell.exe", [
		"-NoProfile",
		"-ExecutionPolicy",
		"Bypass",
		"-File",
		path.join(__dirname, "scripts", "win32-stream.ps1"),
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
		console.log("[win32-stream]", trimmed);
		if (trimmed === "ready") {
			session.embedded = true;
			sendChiakiEvent(gameId, "embedded", { embedded: true });
		} else if (trimmed.startsWith("error:")) {
			console.error("[win32-stream]", trimmed);
			sendChiakiEvent(gameId, "embedded", {
				embedded: false,
				error: trimmed
			});
		}
	});
	ps.stderr.on("data", (d) => console.error("[win32-stream stderr]", d.toString().trimEnd()));
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
	} catch (e) {}
	setTimeout(() => {
		try {
			if (!ps.killed) ps.kill();
		} catch (e) {}
	}, 500);
}
function sendEmbedBoundsToAll() {
	if (!mainWindow) return;
	const b = getStreamBounds();
	for (const session of chiakiSessions.values()) if (session.embedProcess && !session.embedProcess.killed) try {
		session.embedProcess.stdin.write(`bounds ${b.x} ${b.y} ${b.w} ${b.h}\n`);
	} catch (e) {}
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
			const prev = db.games.find((g) => g.id === session._currentGameId);
			if (prev) {
				prev.playtimeMinutes = (prev.playtimeMinutes || 0) + elapsed;
				prev.lastPlayed = (/* @__PURE__ */ new Date()).toISOString();
				saveDB(db);
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
	let matchedGame = db.games.find((g) => g.platform === "psn" && g.platformId && g.platformId.toUpperCase() === titleId.toUpperCase());
	if (!matchedGame && titleName) {
		const lower = titleName.toLowerCase();
		matchedGame = db.games.find((g) => g.platform === "psn" && g.name && g.name.toLowerCase() === lower);
	}
	if (!matchedGame && titleName) {
		matchedGame = {
			id: Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
			name: titleName,
			platform: "psn",
			platformId: titleId,
			categories: [],
			coverUrl: "",
			playtimeMinutes: 0,
			lastPlayed: (/* @__PURE__ */ new Date()).toISOString(),
			addedAt: (/* @__PURE__ */ new Date()).toISOString(),
			favorite: false,
			chiakiNickname: (db.games.find((g) => g.id === originalGameId) || {}).chiakiNickname || "",
			chiakiHost: (db.games.find((g) => g.id === originalGameId) || {}).chiakiHost || ""
		};
		db.games.push(matchedGame);
		saveDB(db);
		if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("games:refresh", db.games);
	}
	if (matchedGame && !matchedGame.platformId && titleId) {
		matchedGame.platformId = titleId;
		saveDB(db);
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
function sendStreamEvent(gameId, type, data) {
	if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("chiaki:event", {
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
function getActiveSessions() {
	const result = {};
	for (const [gameId, session] of chiakiSessions) result[gameId] = {
		state: session.state,
		startTime: session.startTime,
		streamInfo: session.streamInfo || {},
		quality: session.quality || {},
		exitCode: session.exitCode,
		reconnectAttempts: session._reconnectAttempts || 0
	};
	return result;
}
var DB_PATH = path.join(app ? app.getPath("userData") : ".", "games.json");
function loadDB() {
	try {
		if (fs.existsSync(DB_PATH)) {
			const data = JSON.parse(fs.readFileSync(DB_PATH, "utf-8"));
			if (data.games) {
				const before = data.games.length;
				data.games = data.games.filter((g) => g.platform !== "psn" && g.platform !== "psremote" && g.platform !== "xbox");
				if (data.games.length !== before) saveDB(data);
			}
			return data;
		}
	} catch (e) {
		console.error("Failed to load DB:", e);
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
function saveDB(db) {
	fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}
var db = null;
var mainWindow;
var trayIcon = null;
var isQuitting = false;
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
	} catch (e) {}
	if (process.env.VITE_DEV_SERVER_URL) mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
	else mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
	if (process.env.CEREAL_DEVTOOLS === "1") mainWindow.webContents.once("did-finish-load", () => {
		try {
			toggleDevTools();
		} catch (e) {
			console.error("Auto DevTools failed:", e.message);
		}
	});
	if (process.env.VITE_DEV_SERVER_URL) mainWindow.webContents.once("did-finish-load", () => {
		try {
			mainWindow.webContents.openDevTools({ mode: "detach" });
		} catch (_) {}
	});
	ipcMain.on("window:ready", () => {});
	mainWindow.webContents.on("before-input-event", (event, input) => {
		if (input.type !== "keyDown") return;
		if (!(input.control && input.shift && input.code === "KeyI" || input.code === "F12")) return;
		event.preventDefault();
		toggleDevTools();
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
		} catch (e) {}
		for (const sess of xcloudSessions.values()) try {
			sess.view.setVisible(false);
		} catch (e) {}
	});
	mainWindow.on("focus", () => {
		for (const session of chiakiSessions.values()) if (session.embedded && session.embedProcess && !session.embedProcess.killed) try {
			session.embedProcess.stdin.write("show\n");
		} catch (e) {}
		for (const sess of xcloudSessions.values()) try {
			sess.view.setVisible(true);
		} catch (e) {}
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
	} catch (e) {}
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
	db = loadDB();
	if (db.accounts && typeof db.accounts === "object") {
		for (const platform of Object.keys(db.accounts)) detachAccountSecrets(platform, { save: false });
		saveDB(db);
	}
	createWindow();
	if (db.settings && db.settings.closeToTray) createTray();
	try {
		globalShortcut.register("CommandOrControl+Shift+I", toggleDevTools);
	} catch (e) {
		console.error("Failed to register DevTools shortcut (Ctrl+Shift+I):", e.message);
	}
	try {
		globalShortcut.register("F12", toggleDevTools);
	} catch (e) {
		console.error("Failed to register DevTools shortcut (F12):", e.message);
	}
	if (db.settings && db.settings.startMinimized) mainWindow.hide();
	if (isDiscordEnabled()) connectDiscord();
	autoUpdater.autoDownload = true;
	autoUpdater.autoInstallOnAppQuit = true;
	setTimeout(() => {
		autoUpdater.checkForUpdates().catch(() => {});
	}, 5e3);
	for (const evt of [
		"checking-for-update",
		"update-available",
		"update-not-available",
		"download-progress",
		"update-downloaded",
		"error"
	]) autoUpdater.on(evt, (data) => {
		if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("update:event", {
			type: evt,
			data: evt === "error" ? data && data.message || String(data) : data
		});
	});
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
	} catch (e) {}
});
app.on("will-quit", () => {
	try {
		globalShortcut.unregisterAll();
	} catch (e) {}
	try {
		for (const [gameId, sess] of xcloudSessions) {
			try {
				mainWindow?.contentView?.removeChildView(sess.view);
			} catch (_) {}
			try {
				sess.view?.webContents?.close();
			} catch (_) {}
		}
		xcloudSessions.clear();
	} catch (_) {}
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
	const { shell } = require("electron");
	return shell.openExternal(url);
});
ipcMain.handle("system:getSpecs", async () => {
	const os = require("os");
	const ramGb = Math.round(os.totalmem() / (1024 * 1024 * 1024));
	const cpus = os.cpus();
	const cpuCount = cpus.length;
	const cpuModel = cpus[0]?.model?.trim() || "";
	let gpuName = "";
	try {
		const { app: _app } = require("electron");
		const gpu = (await _app.getGPUInfo("basic"))?.gpuDevice?.[0];
		if (gpu?.description) gpuName = gpu.description;
	} catch (e) {}
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
		const isMax = mainWindow.isMaximized ? mainWindow.isMaximized() : false;
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
		console.error("Failed saving window bounds", e && e.message);
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
ipcMain.handle("chiaki:setStreamBounds", (event, { gameId, x, y, width, height }) => {
	const session = chiakiSessions.get(gameId);
	if (session?.embedProcess && !session.embedProcess.killed) try {
		session.embedProcess.stdin.write(`bounds ${x} ${y} ${width} ${height}\n`);
	} catch (e) {}
	return { success: true };
});
var METADATA_CACHE = /* @__PURE__ */ new Map();
var METADATA_CACHE_TTL = 10080 * 60 * 1e3;
function getMetadataSettings() {
	const s = db.settings || {};
	let sgdbKey = s.steamGridDbKey || "";
	if (!sgdbKey) try {
		sgdbKey = safeStore.getPassword("cereal-steamgriddb", "default") || "";
	} catch (e) {}
	return {
		source: s.metadataSource || "steam",
		steamGridDbKey: sgdbKey
	};
}
function httpGet(url) {
	return new Promise((resolve, reject) => {
		(url.startsWith("https") ? https : http).get(url, { headers: {
			"User-Agent": "CerealLauncher/1.0",
			"Accept": "application/json, text/json, */*",
			"Accept-Encoding": "gzip, deflate, br"
		} }, (res) => {
			if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) return httpGet(new URL(res.headers.location, url).toString()).then(resolve, reject);
			const chunks = [];
			res.on("data", (chunk) => {
				chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
			});
			res.on("end", () => {
				const buffer = Buffer.concat(chunks);
				const encoding = (res.headers["content-encoding"] || "").toLowerCase();
				let payload = buffer;
				try {
					if (encoding.includes("gzip")) payload = zlib.gunzipSync(buffer);
					else if (encoding.includes("deflate")) try {
						payload = zlib.inflateSync(buffer);
					} catch (err) {
						payload = zlib.inflateRawSync(buffer);
					}
					else if (encoding.includes("br")) payload = zlib.brotliDecompressSync(buffer);
				} catch (e) {
					return reject(/* @__PURE__ */ new Error("Failed to decompress response from " + url + ": " + e.message));
				}
				if (res.statusCode >= 200 && res.statusCode < 300) try {
					const text = payload.toString("utf8");
					resolve(JSON.parse(text));
				} catch (e) {
					reject(/* @__PURE__ */ new Error("Invalid JSON from " + url));
				}
				else reject(/* @__PURE__ */ new Error("HTTP " + res.statusCode + " from " + url));
			});
			res.on("error", reject);
		}).on("error", reject);
	});
}
async function fetchSteamMetadata(appId) {
	try {
		const info = (await httpGet(`https://store.steampowered.com/api/appdetails?appids=${appId}&l=english`))?.[appId]?.data;
		if (!info) return null;
		let isSoftware = false;
		if (info.type && typeof info.type === "string" && info.type.toLowerCase() !== "game") isSoftware = true;
		if (!isSoftware && info.categories && Array.isArray(info.categories)) try {
			if (info.categories.some((c) => (c.description || "").toLowerCase().includes("software") || (c.description || "").toLowerCase().includes("utility") || (c.description || "").toLowerCase().includes("application"))) isSoftware = true;
		} catch (e) {}
		if (!isSoftware && info.genres && Array.isArray(info.genres)) try {
			if (info.genres.some((g) => (g.description || "").toLowerCase().includes("software"))) isSoftware = true;
		} catch (e) {}
		return {
			description: (info.short_description || "").slice(0, 500),
			developer: (info.developers || [])[0] || "",
			publisher: (info.publishers || [])[0] || "",
			releaseDate: info.release_date?.date || "",
			genres: (info.genres || []).map((g) => g.description),
			coverUrl: `https://shared.steamstatic.com/store_item_assets/steam/apps/${appId}/library_600x900_2x.jpg`,
			headerUrl: info.header_image || `https://shared.steamstatic.com/store_item_assets/steam/apps/${appId}/library_hero.jpg`,
			screenshots: (info.screenshots || []).slice(0, 4).map((s) => s.path_full),
			metacritic: info.metacritic?.score || null,
			website: info.website || "",
			_source: "steam",
			isSoftware
		};
	} catch (e) {
		console.log("[Metadata] Steam fetch failed for", appId, e.message);
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
		console.log("[Metadata] Steam search failed for", gameName, e.message);
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
		console.log("[Metadata] Wikipedia fetch failed for", gameName, e.message);
		return null;
	}
}
async function fetchSteamGridDBArt(gameName, apiKey) {
	if (!apiKey) return null;
	try {
		const q = encodeURIComponent(gameName);
		const searchData = await new Promise((resolve, reject) => {
			https.get(`https://www.steamgriddb.com/api/v2/search/autocomplete/${q}`, { headers: { "Authorization": "Bearer " + apiKey } }, (res) => {
				let data = "";
				res.on("data", (c) => data += c);
				res.on("end", () => {
					try {
						resolve(JSON.parse(data));
					} catch (e) {
						reject(e);
					}
				});
				res.on("error", reject);
			}).on("error", reject);
		});
		if (!searchData?.success || !searchData?.data?.length) return null;
		const gameId = searchData.data[0].id;
		const fetchSGDB = (type, params) => new Promise((resolve, reject) => {
			https.get(`https://www.steamgriddb.com/api/v2/${type}/game/${gameId}?${params}`, { headers: { "Authorization": "Bearer " + apiKey } }, (res) => {
				let data = "";
				res.on("data", (c) => data += c);
				res.on("end", () => {
					try {
						resolve(JSON.parse(data));
					} catch (e) {
						reject(e);
					}
				});
				res.on("error", reject);
			}).on("error", reject);
		});
		const [covers, heroes] = await Promise.allSettled([fetchSGDB("grids", "dimensions=600x900&limit=1"), fetchSGDB("heroes", "limit=1")]);
		const coverUrl = covers.status === "fulfilled" && covers.value?.data?.[0]?.url || "";
		const headerUrl = heroes.status === "fulfilled" && heroes.value?.data?.[0]?.url || "";
		if (coverUrl || headerUrl) return {
			coverUrl,
			headerUrl
		};
		return null;
	} catch (e) {
		console.log("[Metadata] SteamGridDB art fetch failed for", gameName, e.message);
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
			if (art.coverUrl) meta.coverUrl = art.coverUrl;
			if (art.headerUrl) meta.headerUrl = art.headerUrl;
		}
	} catch (e) {}
	if (meta) METADATA_CACHE.set(cacheKey, {
		data: meta,
		timestamp: Date.now()
	});
	return meta;
}
function applyMetadataToGame(game, meta) {
	if (!meta) return false;
	let changed = false;
	if (!game.coverUrl) {
		const coverFallback = meta.coverUrl || meta.headerUrl || meta.screenshots && meta.screenshots[0] || "";
		if (coverFallback) {
			game.coverUrl = coverFallback;
			changed = true;
		}
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
	} catch (e) {}
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
		} catch (e) {}
	}
	return changed;
}
ipcMain.handle("games:getAll", () => db.games);
ipcMain.handle("games:getCategories", () => db.categories);
ipcMain.handle("games:add", (event, game) => {
	function canonicalizeName(n) {
		if (!n) return "";
		return String(n).toLowerCase().replace(/\s*[-–:]\s*(deluxe|ultimate|gold|collector's|special|limited|complete|season pass|dlc|edition).*/i, "").replace(/[^a-z0-9]+/g, " ").trim();
	}
	let existing = null;
	try {
		if (game.platform && game.platformId) existing = db.games.find((g) => g.platform === game.platform && g.platformId && g.platformId === game.platformId);
		if (!existing) {
			const canon = canonicalizeName(game.name || "");
			if (canon) existing = db.games.find((g) => canonicalizeName(g.name) === canon && (!game.platform || g.platform === game.platform));
		}
	} catch (e) {
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
		} catch (e) {
			merged._imgStamp = prev._imgStamp;
		}
		if (!merged.platform) merged.platform = prev.platform;
		if (!merged.platformId) merged.platformId = prev.platformId;
		db.games[db.games.findIndex((g) => g.id === prev.id)] = merged;
		saveDB(db);
		console.log("[Main] games:update (dedupe merged)", merged.id, "coverUrl=", merged.coverUrl, "_imgStamp=", merged._imgStamp);
		if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("games:refresh", db.games);
		try {
			enqueueCoverFetch(merged.id);
		} catch (e) {}
		return merged;
	}
	game.id = Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
	game.addedAt = (/* @__PURE__ */ new Date()).toISOString();
	game.lastPlayed = null;
	game.playtimeMinutes = 0;
	game.favorite = false;
	if (game.coverUrl) game._imgStamp = Date.now();
	db.games.push(game);
	saveDB(db);
	console.log("[Main] games:add", game.id, "coverUrl=", game.coverUrl, "_imgStamp=", game._imgStamp);
	fetchGameMetadata(game).then((meta) => {
		if (meta && applyMetadataToGame(game, meta)) {
			saveDB(db);
			if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("games:refresh", db.games);
		}
	}).catch(() => {});
	try {
		enqueueCoverFetch(game.id);
	} catch (e) {}
	return game;
});
ipcMain.handle("games:update", (event, updatedGame) => {
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
			if (coverChanged || headerChanged) merged._imgStamp = Date.now();
			else merged._imgStamp = prev._imgStamp;
		} catch (e) {
			merged._imgStamp = prev._imgStamp;
		}
		db.games[idx] = merged;
		console.log("[Main] games:update", merged.id, "coverUrl=", merged.coverUrl, "_imgStamp=", merged._imgStamp, "localCoverPath=", merged.localCoverPath);
		saveDB(db);
		if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("games:refresh", db.games);
		try {
			enqueueCoverFetch(updatedGame.id);
		} catch (e) {}
		return db.games[idx];
	}
	return null;
});
ipcMain.handle("games:delete", (event, id) => {
	db.games = db.games.filter((g) => g.id !== id);
	saveDB(db);
	return true;
});
ipcMain.handle("games:toggleFavorite", (event, id) => {
	const game = db.games.find((g) => g.id === id);
	if (game) {
		game.favorite = !game.favorite;
		saveDB(db);
		return game;
	}
	return null;
});
ipcMain.handle("covers:fetchNow", async (event, gameId) => {
	try {
		enqueueCoverFetch(gameId);
		return { queued: true };
	} catch (e) {
		return { error: e.message };
	}
});
function summarizeSecret(secret) {
	if (!secret) return {
		hasSecret: false,
		fingerprint: null
	};
	try {
		return {
			hasSecret: true,
			fingerprint: crypto.createHash("sha256").update(secret).digest("hex").slice(0, 8)
		};
	} catch (e) {
		return {
			hasSecret: true,
			fingerprint: "unknown"
		};
	}
}
async function validateProviderKey(provider, apiKey) {
	if (!apiKey) return {
		ok: false,
		provider,
		error: "missing-key"
	};
	if (providers && providers[provider] && typeof providers[provider].validateKey === "function") try {
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
ipcMain.handle("keys:set", async (event, { service, account, secret }) => {
	try {
		safeStore.setPassword(service, account, secret);
		return {
			ok: true,
			...summarizeSecret(secret)
		};
	} catch (err) {
		console.error("keys:set error", err);
		return {
			ok: false,
			error: err && err.message
		};
	}
});
ipcMain.handle("keys:get", async (event, { service, account }) => {
	try {
		return {
			ok: true,
			...summarizeSecret(safeStore.getPassword(service, account))
		};
	} catch (err) {
		console.error("keys:get error", err);
		return {
			ok: false,
			error: err && err.message
		};
	}
});
ipcMain.handle("keys:delete", async (event, { service, account }) => {
	try {
		return { ok: safeStore.deletePassword(service, account) };
	} catch (err) {
		console.error("keys:delete error", err);
		return {
			ok: false,
			error: err && err.message
		};
	}
});
ipcMain.handle("keys:validate", async (event, { provider, apiKey }) => {
	try {
		return await validateProviderKey(provider, apiKey);
	} catch (err) {
		console.error("keys:validate error", err);
		return {
			ok: false,
			error: err && err.message
		};
	}
});
ipcMain.handle("keys:validateStored", async (event, { provider, service, account }) => {
	try {
		const secret = safeStore.getPassword(service, account);
		if (!secret) return {
			ok: false,
			error: "no-secret",
			provider
		};
		return await validateProviderKey(provider, secret);
	} catch (err) {
		console.error("keys:validateStored error", err);
		return {
			ok: false,
			error: err && err.message
		};
	}
});
ipcMain.handle("metadata:searchArt", async (event, gameName, platform) => {
	if (!gameName) return { images: [] };
	const ms = getMetadataSettings();
	async function searchSteam() {
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
			} catch (e) {}
		}
		return results;
	}
	async function searchSteamGridDB() {
		if (!ms.steamGridDbKey) return [];
		const results = [];
		const q = encodeURIComponent(gameName);
		const searchData = await new Promise((resolve, reject) => {
			https.get(`https://www.steamgriddb.com/api/v2/search/autocomplete/${q}`, { headers: { "Authorization": "Bearer " + ms.steamGridDbKey } }, (res) => {
				let data = "";
				res.on("data", (c) => data += c);
				res.on("end", () => {
					try {
						resolve(JSON.parse(data));
					} catch (e) {
						reject(e);
					}
				});
				res.on("error", reject);
			}).on("error", reject);
		});
		if (!searchData?.success || !searchData?.data?.length) return results;
		const gameId = searchData.data[0].id;
		const gamLabel = searchData.data[0].name || gameName;
		const fetchSGDB = (type, params) => new Promise((resolve, reject) => {
			https.get(`https://www.steamgriddb.com/api/v2/${type}/game/${gameId}?${params || "limit=6"}`, { headers: { "Authorization": "Bearer " + ms.steamGridDbKey } }, (res) => {
				let data = "";
				res.on("data", (c) => data += c);
				res.on("end", () => {
					try {
						resolve(JSON.parse(data));
					} catch (e) {
						reject(e);
					}
				});
				res.on("error", reject);
			}).on("error", reject);
		});
		const [portraitGrids, landscapeGrids, heroes, logos] = await Promise.allSettled([
			fetchSGDB("grids", "dimensions=600x900&limit=8"),
			fetchSGDB("grids", "dimensions=460x215,920x430&limit=4"),
			fetchSGDB("heroes", "limit=4"),
			fetchSGDB("logos", "limit=2")
		]);
		if (portraitGrids.status === "fulfilled" && portraitGrids.value?.data) {
			for (const g of portraitGrids.value.data.slice(0, 8)) if (g.url) results.push({
				url: g.url,
				type: "cover",
				source: "SteamGridDB",
				label: gamLabel + " - Cover"
			});
		}
		if (landscapeGrids.status === "fulfilled" && landscapeGrids.value?.data) {
			for (const g of landscapeGrids.value.data.slice(0, 4)) if (g.url) results.push({
				url: g.url,
				type: "header",
				source: "SteamGridDB",
				label: gamLabel + " - Header"
			});
		}
		if (heroes.status === "fulfilled" && heroes.value?.data) {
			for (const h of heroes.value.data.slice(0, 4)) if (h.url) results.push({
				url: h.url,
				type: "header",
				source: "SteamGridDB",
				label: gamLabel + " - Hero"
			});
		}
		if (logos.status === "fulfilled" && logos.value?.data) {
			for (const l of logos.value.data.slice(0, 2)) if (l.url) results.push({
				url: l.url,
				type: "logo",
				source: "SteamGridDB",
				label: gamLabel + " - Logo"
			});
		}
		return results;
	}
	const sgdb = await searchSteamGridDB().catch((e) => {
		console.log("[ArtSearch] SteamGridDB failed:", e.message);
		return [];
	});
	const images = [];
	const seen = /* @__PURE__ */ new Set();
	for (const img of sgdb) if (img.url && !seen.has(img.url)) {
		seen.add(img.url);
		images.push(img);
	}
	if (images.length === 0) try {
		const steamImgs = await searchSteam().catch((e) => {
			console.log("[ArtSearch] Steam fallback failed:", e && e.message);
			return [];
		});
		for (const img of steamImgs) if (img.url && !seen.has(img.url)) {
			seen.add(img.url);
			images.push(img);
		}
		if (images.length > 0) console.log("[ArtSearch] Using Steam fallback images");
	} catch (e) {
		console.log("[ArtSearch] Steam fallback threw:", e && e.message);
	}
	return { images };
});
ipcMain.handle("metadata:fetch", async (event, gameId) => {
	const game = db.games.find((g) => g.id === gameId);
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
ipcMain.handle("metadata:apply", async (event, gameId, force) => {
	const game = db.games.find((g) => g.id === gameId);
	if (!game) return { error: "Game not found" };
	try {
		const meta = await fetchGameMetadata(game);
		if (!meta) return { error: "No metadata found" };
		if (force) {
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
			saveDB(db);
			return {
				success: true,
				game
			};
		} else {
			if (applyMetadataToGame(game, meta)) saveDB(db);
			return {
				success: true,
				game
			};
		}
	} catch (e) {
		return { error: e.message };
	}
});
ipcMain.handle("metadata:fetchAll", async () => {
	let updated = 0, failed = 0;
	const total = db.games.length;
	const BATCH = 3;
	for (let i = 0; i < total; i += BATCH) {
		const batch = db.games.slice(i, i + BATCH);
		const results = await Promise.allSettled(batch.map(async (game) => {
			return {
				game,
				meta: await fetchGameMetadata(game)
			};
		}));
		for (const r of results) if (r.status === "fulfilled" && r.value.meta) {
			if (applyMetadataToGame(r.value.game, r.value.meta)) updated++;
		} else failed++;
		const done = Math.min(i + BATCH, total);
		if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("metadata:progress", {
			current: done,
			total,
			updated,
			failed,
			name: batch[batch.length - 1].name
		});
		if (i + BATCH < total) await new Promise((r) => setTimeout(r, 200));
	}
	if (updated > 0) saveDB(db);
	return {
		updated,
		failed,
		total
	};
});
ipcMain.handle("steamgriddb:login", async () => {
	try {
		const { shell, dialog, clipboard } = require("electron");
		await shell.openExternal("https://www.steamgriddb.com/profile/preferences/api");
		const { response } = await dialog.showMessageBox(mainWindow, {
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
		safeStore.setPassword("cereal-steamgriddb", "default", apiKey);
		return {
			ok: true,
			...summarizeSecret(apiKey)
		};
	} catch (e) {
		return { error: e.message };
	}
});
ipcMain.handle("clipboard:readText", () => {
	try {
		const { clipboard } = require("electron");
		return clipboard.readText();
	} catch (e) {
		return "";
	}
});
function normalizePlatform(platform) {
	if (platform === "psremote") return "psn";
	return platform;
}
function getLauncherExecutableCandidates(platform) {
	switch (platform) {
		case "steam": return [path.join(process.env["ProgramFiles(x86)"] || "", "Steam", "Steam.exe"), path.join(process.env.ProgramFiles || "", "Steam", "Steam.exe")];
		case "epic": return [path.join(process.env["ProgramFiles(x86)"] || "", "Epic Games", "Launcher", "Portal", "Binaries", "Win64", "EpicGamesLauncher.exe"), path.join(process.env.ProgramFiles || "", "Epic Games", "Launcher", "Portal", "Binaries", "Win64", "EpicGamesLauncher.exe")];
		case "gog": return [path.join(process.env["ProgramFiles(x86)"] || "", "GOG Galaxy", "GalaxyClient.exe"), path.join(process.env.ProgramFiles || "", "GOG Galaxy", "GalaxyClient.exe")];
		case "ea": return [
			path.join(process.env.ProgramFiles || "", "Electronic Arts", "EA Desktop", "EA Desktop", "EADesktop.exe"),
			path.join(process.env.LOCALAPPDATA || "", "Electronic Arts", "EA Desktop", "EA Desktop", "EADesktop.exe"),
			path.join(process.env["ProgramFiles(x86)"] || "", "Origin", "Origin.exe")
		];
		case "battlenet": return [path.join(process.env.ProgramFiles || "", "Battle.net", "Battle.net.exe"), path.join(process.env["ProgramFiles(x86)"] || "", "Battle.net", "Battle.net.exe")];
		case "ubisoft": return [
			path.join(process.env.ProgramFiles || "", "Ubisoft", "Ubisoft Game Launcher", "UbisoftConnect.exe"),
			path.join(process.env["ProgramFiles(x86)"] || "", "Ubisoft", "Ubisoft Game Launcher", "UbisoftConnect.exe"),
			path.join(process.env.ProgramFiles || "", "Ubisoft", "Ubisoft Game Launcher", "Uplay.exe"),
			path.join(process.env["ProgramFiles(x86)"] || "", "Ubisoft", "Ubisoft Game Launcher", "Uplay.exe")
		];
		case "itchio": return [path.join(process.env.LOCALAPPDATA || "", "itch", "app-25.6.1", "itch.exe")];
		case "xbox": return [path.join(process.env.LOCALAPPDATA || "", "Microsoft", "WindowsApps", "XboxApp.exe")];
		default: return [];
	}
}
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
	const uniq = (arr) => Array.from(new Set(arr.filter(Boolean)));
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
		await shell.openExternal(uri);
		return {
			success: true,
			opened: uri
		};
	} catch (e) {
		lastError = e;
	}
	const candidates = getLauncherExecutableCandidates(normalizePlatform(game.platform));
	for (const exe of candidates) {
		if (!exe || !fs.existsSync(exe)) continue;
		try {
			spawn(exe, [], {
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
			if (!discordRpc) connectDiscord();
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
		const ext = path.extname(src);
		const destName = `cover_${Date.now()}${ext}`;
		const destDir = path.join(app.getPath("userData"), "covers");
		if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
		const dest = path.join(destDir, destName);
		fs.copyFileSync(src, dest);
		return dest;
	}
	return null;
});
ipcMain.handle("detect:steam", async () => {
	const games = [];
	try {
		const steamPaths = [
			"C:\\Program Files (x86)\\Steam",
			"C:\\Program Files\\Steam",
			path.join(process.env.HOME || process.env.USERPROFILE || "", "Steam")
		];
		let steamRoot = null;
		for (const p of steamPaths) if (fs.existsSync(p)) {
			steamRoot = p;
			break;
		}
		if (!steamRoot) return {
			games: [],
			error: "Steam not found"
		};
		const libraryFolders = [path.join(steamRoot, "steamapps")];
		const vdfPath = path.join(steamRoot, "steamapps", "libraryfolders.vdf");
		if (fs.existsSync(vdfPath)) {
			const pathMatches = fs.readFileSync(vdfPath, "utf-8").match(/"path"\s+"([^"]+)"/g);
			if (pathMatches) pathMatches.forEach((m) => {
				const p = m.match(/"path"\s+"([^"]+)"/)[1].replace(/\\\\/g, "\\");
				const appsDir = path.join(p, "steamapps");
				if (fs.existsSync(appsDir) && !libraryFolders.includes(appsDir)) libraryFolders.push(appsDir);
			});
		}
		for (const libFolder of libraryFolders) {
			if (!fs.existsSync(libFolder)) continue;
			const files = fs.readdirSync(libFolder).filter((f) => f.endsWith(".acf"));
			for (const file of files) try {
				const content = fs.readFileSync(path.join(libFolder, file), "utf-8");
				const appid = content.match(/"appid"\s+"(\d+)"/);
				const name = content.match(/"name"\s+"([^"]+)"/);
				const installdir = content.match(/"installdir"\s+"([^"]+)"/);
				if (appid && name && installdir) {
					const gamePath = path.join(libFolder, "common", installdir[1]);
					games.push({
						name: name[1],
						platform: "steam",
						platformId: appid[1],
						installPath: gamePath,
						executablePath: "",
						coverUrl: `https://shared.steamstatic.com/store_item_assets/steam/apps/${appid[1]}/library_600x900_2x.jpg`,
						heroUrl: `https://shared.steamstatic.com/store_item_assets/steam/apps/${appid[1]}/library_hero.jpg`,
						categories: [],
						source: "auto-detected"
					});
				}
			} catch (e) {}
		}
	} catch (err) {
		return {
			games: [],
			error: err.message
		};
	}
	return { games };
});
ipcMain.handle("detect:epic", async () => {
	const games = [];
	try {
		const manifestDir = path.join(process.env.PROGRAMDATA || "C:\\ProgramData", "Epic", "EpicGamesLauncher", "Data", "Manifests");
		if (!fs.existsSync(manifestDir)) return {
			games: [],
			error: "Epic Games not found"
		};
		const files = fs.readdirSync(manifestDir).filter((f) => f.endsWith(".item"));
		for (const file of files) try {
			const content = JSON.parse(fs.readFileSync(path.join(manifestDir, file), "utf-8"));
			if (content.DisplayName && content.InstallLocation) games.push({
				name: content.DisplayName,
				platform: "epic",
				platformId: content.CatalogNamespace || content.AppName,
				installPath: content.InstallLocation,
				executablePath: content.LaunchExecutable ? path.join(content.InstallLocation, content.LaunchExecutable) : "",
				coverUrl: "",
				categories: [],
				source: "auto-detected"
			});
		} catch (e) {}
	} catch (err) {
		return {
			games: [],
			error: err.message
		};
	}
	return { games };
});
ipcMain.handle("detect:gog", async () => {
	const games = [];
	try {
		path.join(process.env.PROGRAMDATA || "C:\\ProgramData", "GOG.com", "Galaxy", "storage", "galaxy-2.0.db");
		const dirsToScan = ["C:\\GOG Games", path.join(process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", "GOG Galaxy", "Games")].filter(fs.existsSync);
		for (const dir of dirsToScan) {
			const entries = fs.readdirSync(dir, { withFileTypes: true });
			for (const entry of entries) if (entry.isDirectory()) {
				const gameDir = path.join(dir, entry.name);
				const infoFiles = fs.readdirSync(gameDir).filter((f) => f.startsWith("goggame-") && f.endsWith(".info"));
				for (const infoFile of infoFiles) try {
					const info = JSON.parse(fs.readFileSync(path.join(gameDir, infoFile), "utf-8"));
					if (info.name) games.push({
						name: info.name,
						platform: "gog",
						platformId: info.gameId || "",
						installPath: gameDir,
						executablePath: info.playTasks?.[0]?.path ? path.join(gameDir, info.playTasks[0].path) : "",
						coverUrl: "",
						categories: [],
						source: "auto-detected"
					});
				} catch (e) {}
			}
		}
	} catch (err) {
		return {
			games: [],
			error: err.message
		};
	}
	return { games };
});
ipcMain.handle("detect:psremote", async () => {
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
			const systemPaths = [
				path.join(process.env.ProgramFiles || "", "chiaki-ng", "chiaki.exe"),
				path.join(process.env["ProgramFiles(x86)"] || "", "chiaki-ng", "chiaki.exe"),
				path.join(process.env.LOCALAPPDATA || "", "chiaki-ng", "chiaki.exe")
			];
			for (const p of systemPaths) if (fs.existsSync(p)) {
				result.found = true;
				result.bundled = false;
				result.executablePath = p;
				break;
			}
		}
		if (result.executablePath) try {
			result.consoles = execSync(`"${result.executablePath}" list`, {
				timeout: 5e3,
				env: {
					...process.env,
					PATH: `${path.dirname(result.executablePath)};${process.env.PATH}`
				}
			}).toString().trim().split("\n").filter((l) => l.trim());
		} catch (e) {
			result.consoles = [];
		}
	} catch (err) {
		result.error = err.message;
	}
	return result;
});
ipcMain.handle("detect:xbox", async () => {
	const games = [];
	try {
		path.join(process.env.ProgramFiles || "", "WindowsApps"), path.join(process.env.LOCALAPPDATA || "", "Packages");
		const xboxGamesDir = "C:\\XboxGames";
		if (fs.existsSync(xboxGamesDir)) {
			const entries = fs.readdirSync(xboxGamesDir, { withFileTypes: true });
			for (const entry of entries) if (entry.isDirectory() && entry.name !== "Content") games.push({
				name: entry.name.replace(/([A-Z])/g, " $1").trim(),
				platform: "xbox",
				platformId: "",
				installPath: path.join(xboxGamesDir, entry.name),
				executablePath: "",
				coverUrl: "",
				categories: [],
				source: "auto-detected"
			});
		}
		const xboxAppPaths = [path.join(process.env.LOCALAPPDATA || "", "Microsoft", "WindowsApps", "XboxApp.exe"), path.join(process.env.ProgramFiles || "", "WindowsApps", "Microsoft.GamingApp_*")];
		let xboxAppFound = false;
		for (const p of xboxAppPaths) if (p.includes("*")) {
			const dir = path.dirname(p);
			const prefix = path.basename(p).replace("*", "");
			if (fs.existsSync(dir)) {
				if (fs.readdirSync(dir).filter((f) => f.startsWith(prefix)).length > 0) xboxAppFound = true;
			}
		} else if (fs.existsSync(p)) xboxAppFound = true;
		return {
			games,
			xboxAppFound,
			cloudGamingUrl: "https://www.xbox.com/play"
		};
	} catch (err) {
		return {
			games: [],
			xboxAppFound: false,
			error: err.message
		};
	}
});
ipcMain.handle("detect:ea", async () => {
	try {
		if (!providers?.ea?.detectInstalled) return {
			games: [],
			appFound: false,
			error: "EA provider not available"
		};
		const res = providers.ea.detectInstalled();
		return {
			games: res?.games || [],
			appFound: providers.ea.isAppInstalled ? !!providers.ea.isAppInstalled() : false,
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
ipcMain.handle("detect:battlenet", async () => {
	try {
		if (!providers?.battlenet?.detectInstalled) return {
			games: [],
			appFound: false,
			error: "Battle.net provider not available"
		};
		const res = providers.battlenet.detectInstalled();
		return {
			games: res?.games || [],
			appFound: providers.battlenet.isAppInstalled ? !!providers.battlenet.isAppInstalled() : false,
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
ipcMain.handle("detect:itchio", async () => {
	try {
		if (!providers?.itchio?.detectInstalled) return {
			games: [],
			appFound: false,
			error: "itch.io provider not available"
		};
		const res = providers.itchio.detectInstalled();
		return {
			games: res?.games || [],
			appFound: providers.itchio.isAppInstalled ? !!providers.itchio.isAppInstalled() : false,
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
ipcMain.handle("detect:ubisoft", async () => {
	try {
		if (!providers?.ubisoft?.detectInstalled) return {
			games: [],
			appFound: false,
			error: "Ubisoft provider not available"
		};
		const res = providers.ubisoft.detectInstalled();
		return {
			games: res?.games || [],
			appFound: providers.ubisoft.isAppInstalled ? !!providers.ubisoft.isAppInstalled() : false,
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
ipcMain.handle("playtime:sync", async () => {
	const updated = [];
	try {
		const steamPaths = [
			"C:\\Program Files (x86)\\Steam",
			"C:\\Program Files\\Steam",
			path.join(process.env.HOME || process.env.USERPROFILE || "", "Steam")
		];
		let steamRoot = null;
		for (const p of steamPaths) if (fs.existsSync(p)) {
			steamRoot = p;
			break;
		}
		if (steamRoot) {
			const userdataDir = path.join(steamRoot, "userdata");
			if (fs.existsSync(userdataDir)) {
				const userDirs = fs.readdirSync(userdataDir).filter((d) => {
					return fs.statSync(path.join(userdataDir, d)).isDirectory() && /^\d+$/.test(d);
				});
				for (const userId of userDirs) {
					const localConfigPath = path.join(userdataDir, userId, "config", "localconfig.vdf");
					if (!fs.existsSync(localConfigPath)) continue;
					const vdfContent = fs.readFileSync(localConfigPath, "utf-8");
					const appBlocks = vdfContent.matchAll(/"(\d+)"\s*\{[^}]*?"playtime_forever"\s+"(\d+)"[^}]*?\}/gs);
					for (const m of appBlocks) {
						const appId = m[1];
						const minutes = parseInt(m[2], 10);
						if (minutes > 0) {
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
					const appsSection = vdfContent.match(/"apps"\s*\{([\s\S]*?)\n\t\t\t\}/m);
					if (appsSection) {
						const appEntries = appsSection[1].matchAll(/"(\d+)"\s*\{([\s\S]*?)\}/g);
						for (const entry of appEntries) {
							const appId = entry[1];
							const ptMatch = entry[2].match(/"playtime_forever"\s+"(\d+)"/);
							if (ptMatch) {
								const minutes = parseInt(ptMatch[1], 10);
								if (minutes > 0) {
									const game = db.games.find((g) => g.platform === "steam" && g.platformId === appId);
									if (game && minutes > (game.playtimeMinutes || 0)) {
										game.playtimeMinutes = minutes;
										if (!updated.find((u) => u.id === game.id)) updated.push({
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
				}
			}
		}
		try {
			const gogDbPath = path.join(process.env.PROGRAMDATA || "C:\\ProgramData", "GOG.com", "Galaxy", "storage", "galaxy-2.0.db");
			if (fs.existsSync(gogDbPath)) {}
		} catch (e) {}
		if (updated.length > 0) saveDB(db);
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
ipcMain.handle("settings:get", () => {
	return {
		...DEFAULT_SETTINGS,
		...db.settings || {}
	};
});
ipcMain.handle("settings:save", (event, newSettings) => {
	db.settings = {
		...DEFAULT_SETTINGS,
		...db.settings || {},
		...newSettings
	};
	saveDB(db);
	if (db.settings.discordPresence) {
		if (!discordRpc) connectDiscord();
	} else disconnectDiscord();
	if ("launchOnStartup" in newSettings) try {
		app.setLoginItemSettings({ openAtLogin: !!newSettings.launchOnStartup });
	} catch (e) {}
	if ("closeToTray" in newSettings) if (newSettings.closeToTray) createTray();
	else destroyTray();
	return db.settings;
});
ipcMain.handle("settings:reset", () => {
	db.settings = { ...DEFAULT_SETTINGS };
	saveDB(db);
	return db.settings;
});
ipcMain.handle("settings:exportLibrary", async () => {
	const { dialog } = require("electron");
	const result = await dialog.showSaveDialog(mainWindow, {
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
			games: db.games,
			categories: db.categories,
			accounts: db.accounts || {},
			exportedAt: (/* @__PURE__ */ new Date()).toISOString()
		};
		fs.writeFileSync(result.filePath, JSON.stringify(exportData, null, 2));
		return {
			success: true,
			path: result.filePath
		};
	} catch (e) {
		return { error: e.message };
	}
});
ipcMain.handle("settings:importLibrary", async () => {
	const { dialog } = require("electron");
	const result = await dialog.showOpenDialog(mainWindow, {
		title: "Import Library",
		filters: [{
			name: "JSON",
			extensions: ["json"]
		}],
		properties: ["openFile"]
	});
	if (result.canceled || !result.filePaths.length) return { cancelled: true };
	try {
		const raw = fs.readFileSync(result.filePaths[0], "utf-8");
		const imported = JSON.parse(raw);
		let addedCount = 0;
		if (imported.games && Array.isArray(imported.games)) {
			const existingIds = new Set(db.games.map((g) => g.name + "|" + g.platform));
			for (const g of imported.games) {
				const key = g.name + "|" + g.platform;
				if (!existingIds.has(key)) {
					g.id = Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
					db.games.push(g);
					existingIds.add(key);
					addedCount++;
				}
			}
		}
		if (imported.categories && Array.isArray(imported.categories)) {
			const catSet = new Set(db.categories);
			imported.categories.forEach((c) => catSet.add(c));
			db.categories = [...catSet];
		}
		saveDB(db);
		return {
			success: true,
			added: addedCount,
			games: db.games,
			categories: db.categories
		};
	} catch (e) {
		return { error: e.message };
	}
});
ipcMain.handle("settings:clearCovers", () => {
	for (const game of db.games) if (game.platform === "steam" && game.platformId) {
		game.coverUrl = `https://shared.steamstatic.com/store_item_assets/steam/apps/${game.platformId}/library_600x900_2x.jpg`;
		game.headerUrl = `https://shared.steamstatic.com/store_item_assets/steam/apps/${game.platformId}/library_hero.jpg`;
	} else {
		game.coverUrl = "";
		game.headerUrl = "";
	}
	saveDB(db);
	return {
		success: true,
		games: db.games
	};
});
ipcMain.handle("settings:clearAllGames", () => {
	db.games = [];
	saveDB(db);
	return { success: true };
});
ipcMain.handle("settings:getDataPath", () => {
	return DB_PATH;
});
ipcMain.handle("settings:getAppVersion", () => {
	try {
		return JSON.parse(fs.readFileSync(path.join(__dirname, "package.json"), "utf-8")).version || "1.0.0";
	} catch (e) {
		return "1.0.0";
	}
});
ipcMain.handle("update:check", () => {
	return autoUpdater.checkForUpdates().catch((err) => ({ error: err.message }));
});
ipcMain.handle("update:install", () => {
	autoUpdater.quitAndInstall();
});
ipcMain.handle("accounts:get", () => {
	return sanitizeAccountsForRenderer(db.accounts);
});
ipcMain.handle("accounts:save", (event, platform, data) => {
	if (!platform || typeof platform !== "string") return sanitizeAccountsForRenderer(db.accounts || {});
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
	return sanitizeAccountsForRenderer(db.accounts);
});
ipcMain.handle("accounts:remove", (event, platform) => {
	if (!db.accounts) db.accounts = {};
	if (db.accounts[platform]) {
		detachAccountSecrets(platform);
		delete db.accounts[platform];
	}
	saveDB(db);
	return sanitizeAccountsForRenderer(db.accounts);
});
var auth = require("./providers/auth");
function runOAuthFlow({ partition, width, height, authUrl, redirectMatch, onRedirect, allowNavigate }) {
	return new Promise((resolve) => {
		const authSession = session.fromPartition(partition + ":" + Date.now());
		const authWin = createAuthWindow(width || 700, height || 700, authSession);
		let resolved = false;
		let authTimeout = null;
		const cleanup = () => {
			if (authTimeout) {
				clearTimeout(authTimeout);
				authTimeout = null;
			}
			try {
				authSession.clearStorageData();
			} catch (e) {}
		};
		const finish = (result) => {
			if (resolved) return;
			resolved = true;
			cleanup();
			try {
				authWin.close();
			} catch (e) {}
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
	const acct = (db.accounts || {})[platform];
	if (!acct) return false;
	const releaseSecrets = hydrateAccountSecrets(platform);
	try {
		let tokens;
		if (platform === "gog") {
			if (!acct.refreshToken) return false;
			tokens = await auth.refreshGogToken(acct.refreshToken);
		} else if (platform === "epic") {
			if (!acct.refreshToken) return false;
			tokens = await auth.refreshEpicToken(acct.refreshToken);
		} else if (platform === "xbox") {
			if (!acct.msRefreshToken) return false;
			tokens = await auth.refreshXboxTokens(acct.msRefreshToken);
		}
		if (!tokens) return false;
		Object.assign(acct, tokens);
		persistAccountData(platform, tokens);
		return true;
	} catch (e) {
		return false;
	} finally {
		releaseSecrets();
	}
}
function emitImportProgress(providerId, evt) {
	try {
		if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("import:progress", {
			provider: providerId,
			...evt
		});
	} catch (e) {}
}
function importCount(value) {
	if (Array.isArray(value)) return value.length;
	if (typeof value === "number" && Number.isFinite(value)) return value;
	return 0;
}
async function runProviderImportWithProgress(providerId, options = {}) {
	const provider = providers?.[providerId];
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
			db,
			saveDB,
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
	const acct = (db.accounts || {})[providerId];
	if (acct?.expiresAt && Date.now() > acct.expiresAt - 6e4) {
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
	const provider = providers?.[providerId];
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
		apiKey = safeStore.getPassword("cereal-itchio", "default") || null;
	} catch (e) {}
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
	detachAccountSecrets(platform);
}
ipcMain.handle("accounts:steam:auth", async () => {
	const c = auth.CONFIG.steam;
	return runOAuthFlow({
		partition: "auth:steam",
		...c.windowSize,
		authUrl: auth.buildSteamAuthUrl(),
		redirectMatch: (url) => url.startsWith(c.returnUrl),
		onRedirect: async (url, finish) => {
			try {
				const steamId = auth.extractSteamId(url);
				if (!steamId) {
					finish({ error: "Could not extract Steam ID" });
					return;
				}
				const profile = await auth.fetchSteamProfile(steamId);
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
ipcMain.handle("accounts:steam:import", async () => {
	if (!providers?.steam?.importLibrary) return { error: "Steam provider not available" };
	let apiKey = null;
	try {
		const r = safeStore.getPassword("cereal-steam", "default");
		if (r) apiKey = r;
	} catch (e) {}
	const steamSession = session.fromPartition("auth:steam");
	const sessionFetch = steamSession.fetch.bind(steamSession);
	return runProviderImportWithProgress("steam", {
		apiKey,
		sessionFetch
	});
});
ipcMain.handle("accounts:gog:auth", async () => {
	const c = auth.CONFIG.gog;
	const oauthState = generateOAuthState();
	return runOAuthFlow({
		partition: "auth:gog",
		...c.windowSize,
		authUrl: auth.buildGogAuthUrl(oauthState),
		redirectMatch: (url) => url.includes("on_login_success") && url.includes("code="),
		onRedirect: async (url, finish) => {
			try {
				const { code, error } = extractOAuthCode(url);
				if (error) {
					finish({ error });
					return;
				}
				const tokens = await auth.exchangeGogCode(code);
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
ipcMain.handle("accounts:gog:import", async () => {
	if (!providers?.gog?.importLibrary) return { error: "GOG provider not available" };
	return importWithTokenRefresh("gog");
});
ipcMain.handle("accounts:epic:auth", async () => {
	const c = auth.CONFIG.epic;
	return runOAuthFlow({
		partition: "auth:epic",
		...c.windowSize,
		authUrl: auth.buildEpicAuthUrl(),
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
				const tokens = await auth.exchangeEpicCode(exchangeCode);
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
ipcMain.handle("accounts:epic:import", async () => {
	if (!providers?.epic?.importLibrary) return { error: "Epic provider not available" };
	return importWithTokenRefresh("epic");
});
ipcMain.handle("accounts:xbox:auth", async () => {
	const c = auth.CONFIG.xbox;
	const oauthState = generateOAuthState();
	return runOAuthFlow({
		partition: "auth:xbox",
		...c.windowSize,
		authUrl: auth.buildXboxAuthUrl(oauthState),
		redirectMatch: (url) => url.startsWith(c.redirectUri),
		onRedirect: async (url, finish) => {
			try {
				const { code, error } = extractOAuthCode(url);
				if (error) {
					finish({ error });
					return;
				}
				const tokens = await auth.exchangeXboxCode(code);
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
ipcMain.handle("accounts:xbox:import", async () => {
	if (!providers?.xbox?.importLibrary) return { error: "Xbox provider not available" };
	return runProviderImportWithProgress("xbox");
});
ipcMain.handle("accounts:ea:auth", async () => handleLocalProviderAuth("ea", "EA App"));
ipcMain.handle("accounts:battlenet:auth", async () => handleLocalProviderAuth("battlenet", "Battle.net"));
ipcMain.handle("accounts:itchio:auth", async () => handleLocalProviderAuth("itchio", "itch.io"));
ipcMain.handle("accounts:ubisoft:auth", async () => handleLocalProviderAuth("ubisoft", "Ubisoft Connect"));
ipcMain.handle("accounts:ea:import", async () => handleProviderImport("ea"));
ipcMain.handle("accounts:battlenet:import", async () => handleProviderImport("battlenet"));
ipcMain.handle("accounts:itchio:import", async () => handleProviderImport("itchio"));
ipcMain.handle("accounts:ubisoft:import", async () => handleProviderImport("ubisoft"));
ipcMain.handle("chiaki:status", () => {
	const bundledExe = getBundledChiakiExe();
	const bundledVersion = getBundledChiakiVersion();
	if (bundledExe) return {
		status: "bundled",
		executablePath: bundledExe,
		version: bundledVersion,
		directory: getChiakiDir()
	};
	const systemPaths = [
		path.join(process.env.ProgramFiles || "", "chiaki-ng", "chiaki.exe"),
		path.join(process.env["ProgramFiles(x86)"] || "", "chiaki-ng", "chiaki.exe"),
		path.join(process.env.LOCALAPPDATA || "", "chiaki-ng", "chiaki.exe")
	];
	for (const p of systemPaths) if (fs.existsSync(p)) return {
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
ipcMain.handle("chiaki:checkUpdate", async () => {
	try {
		const repo = process.env.CHIAKI_RELEASE_REPO || "streetpea/chiaki-ng";
		const res = await new Promise((resolve, reject) => {
			const req = https.get(`https://api.github.com/repos/${repo}/releases/latest`, { headers: { "User-Agent": "cereal-launcher" } }, (resp) => {
				let body = "";
				resp.on("data", (c) => body += c);
				resp.on("end", () => {
					try {
						resolve(JSON.parse(body));
					} catch (e) {
						reject(e);
					}
				});
			});
			req.on("error", reject);
			req.setTimeout(1e4, () => {
				req.destroy();
				reject(/* @__PURE__ */ new Error("timeout"));
			});
		});
		const latestTag = res.tag_name || null;
		const currentVersion = getBundledChiakiVersion();
		return {
			current: currentVersion,
			latest: latestTag,
			hasUpdate: latestTag && currentVersion && latestTag !== currentVersion,
			releaseName: res.name || latestTag
		};
	} catch (e) {
		return { error: e.message };
	}
});
ipcMain.handle("chiaki:update", async () => {
	try {
		const scriptPath = path.join(__dirname, "scripts", "setup-chiaki.ps1");
		if (!fs.existsSync(scriptPath)) return { error: "setup-chiaki.ps1 not found" };
		return new Promise((resolve) => {
			const child = spawn("powershell", [
				"-ExecutionPolicy",
				"Bypass",
				"-File",
				scriptPath,
				"-Force"
			], {
				cwd: __dirname,
				stdio: "pipe"
			});
			let output = "";
			child.stdout.on("data", (d) => output += d.toString());
			child.stderr.on("data", (d) => output += d.toString());
			child.on("close", (code) => {
				if (code === 0) resolve({
					ok: true,
					version: getBundledChiakiVersion(),
					output
				});
				else resolve({
					error: `Setup exited with code ${code}`,
					output
				});
			});
			child.on("error", (err) => resolve({ error: err.message }));
		});
	} catch (e) {
		return { error: e.message };
	}
});
ipcMain.handle("chiaki:getConfig", () => {
	return db.chiakiConfig || {
		executablePath: "",
		consoles: []
	};
});
ipcMain.handle("chiaki:saveConfig", (event, config) => {
	const { cerealMode: _dropped, ...clean } = config || {};
	db.chiakiConfig = clean;
	saveDB(db);
	return clean;
});
ipcMain.handle("games:setChiakiStream", (event, gameId, streamConfig) => {
	const game = db.games.find((g) => g.id === gameId);
	if (game) {
		game.chiakiNickname = streamConfig.nickname || "";
		game.chiakiHost = streamConfig.host || "";
		game.chiakiProfile = streamConfig.profile || "";
		game.chiakiFullscreen = streamConfig.fullscreen !== false;
		game.chiakiRegistKey = streamConfig.registKey || "";
		game.chiakiMorning = streamConfig.morning || "";
		saveDB(db);
		return game;
	}
	return null;
});
ipcMain.handle("chiaki:startStreamDirect", (event, opts) => {
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
		}, db.chiakiConfig || {})).state
	};
});
ipcMain.handle("chiaki:startStream", (event, gameId) => {
	const game = db.games.find((g) => g.id === gameId);
	if (!game) return {
		success: false,
		error: "Game not found"
	};
	const chiakiExe = resolveChiakiExe(game.executablePath);
	if (!chiakiExe) return {
		success: false,
		error: "chiaki-ng not found"
	};
	const session = startChiakiSession(gameId, chiakiExe, buildChiakiArgs(game, db.chiakiConfig || {}));
	game.lastPlayed = (/* @__PURE__ */ new Date()).toISOString();
	saveDB(db);
	return {
		success: true,
		state: session.state
	};
});
ipcMain.handle("chiaki:stopStream", (event, gameId) => {
	return { success: stopChiakiSession(gameId) };
});
ipcMain.handle("chiaki:getSessions", () => {
	return getActiveSessions();
});
ipcMain.handle("xcloud:startDirect", (event, { url }) => {
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
ipcMain.handle("xcloud:start", (event, { gameId, url }) => {
	try {
		startXcloudSession(gameId, url);
		return { success: true };
	} catch (e) {
		return {
			success: false,
			error: e.message
		};
	}
});
ipcMain.handle("xcloud:stop", (event, gameId) => {
	return { success: stopXcloudSession(gameId) };
});
ipcMain.handle("xcloud:getSessions", () => {
	return getActiveXcloudSessions();
});
var smtcNative = null;
function getSmtcNative() {
	if (!smtcNative) try {
		smtcNative = require_smtc();
		console.log("[media] native addon loaded");
	} catch (e) {
		console.log("[media] failed to load native addon:", e.message);
	}
	return smtcNative;
}
ipcMain.handle("media:getInfo", async () => {
	const smtc = getSmtcNative();
	if (!smtc) return {};
	try {
		const info = await smtc.getMediaInfo();
		console.log("[media] native result:", info);
		if (info.error) {
			console.log("[media] error:", info.error);
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
		console.log("[media] exception:", e.message);
		return {};
	}
});
ipcMain.handle("media:control", async (event, action) => {
	const smtc = getSmtcNative();
	if (!smtc) return false;
	try {
		await smtc.sendMediaKey(action);
		return true;
	} catch (e) {
		console.log("[media] control error:", e.message);
		return false;
	}
});
ipcMain.handle("chiaki:openGui", () => {
	const chiakiExe = resolveChiakiExe();
	if (!chiakiExe) return {
		success: false,
		error: "chiaki-ng not found"
	};
	const chiakiDir = path.dirname(chiakiExe);
	spawn(chiakiExe, [], {
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
ipcMain.handle("chiaki:registerConsole", (event, { host, psnAccountId, pin }) => {
	const chiakiExe = resolveChiakiExe();
	if (!chiakiExe) return {
		success: false,
		error: "chiaki-ng not found"
	};
	return new Promise((resolve) => {
		const chiakiDir = path.dirname(chiakiExe);
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
		const proc = spawn(chiakiExe, args, {
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
			if (code === 0) resolve({
				success: true,
				registKey: output.match(/regist[_-]?key[=:]\s*([^\s\n]+)/i)?.[1] || "",
				morning: output.match(/morning[=:]\s*([^\s\n]+)/i)?.[1] || "",
				output
			});
			else resolve({
				success: false,
				error: output || "Registration failed (exit " + code + ")"
			});
		});
		setTimeout(() => {
			try {
				proc.kill();
			} catch (e) {}
			resolve({
				success: false,
				error: "Registration timed out (30s)"
			});
		}, 3e4);
	});
});
ipcMain.handle("chiaki:discoverConsoles", () => {
	const dgram = require("dgram");
	const os = require("os");
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
			console.log("[discovery] response from", rinfo.address, "status:", httpCode);
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
					} catch (e) {}
					tryBind(idx + 1);
				} else {
					console.error("[discovery] bind failed:", err.message);
					try {
						s.close();
					} catch (e) {}
					resolve({
						success: false,
						consoles: [],
						error: err.message
					});
				}
			});
			s.bind(ports[idx], () => {
				console.log("[discovery] bound to port", ports[idx] || "(random)");
				onBoundSock(s);
			});
		}
		tryBind(0);
		function onBoundSock(s) {
			s.setBroadcast(true);
			const broadcasts = new Set(["255.255.255.255"]);
			for (const addrs of Object.values(os.networkInterfaces())) for (const addr of addrs) {
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
				console.log("[discovery] done, found", found.size, "console(s)");
				try {
					s.close();
				} catch (e) {}
				resolve({
					success: true,
					consoles: [...found.values()]
				});
			}, 4e3);
		}
	});
});
ipcMain.handle("chiaki:wakeConsole", (event, { host, credentials }) => {
	const dgram = require("dgram");
	return new Promise((resolve) => {
		const registKey = credentials?.registKey || "";
		if (!registKey) return resolve({
			success: false,
			error: "No registration key — register the console first"
		});
		const chiakiExe = resolveChiakiExe();
		if (chiakiExe) {
			const chiakiDir = path.dirname(chiakiExe);
			const env = {
				...process.env,
				PATH: `${chiakiDir};${process.env.PATH}`
			};
			const proc = spawn(chiakiExe, [
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
				resolve({
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
				} catch (e) {}
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
				console.error("[wake] socket error:", err.message);
				try {
					sock.close();
				} catch (e) {}
				resolve({
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
					if (err) console.error("[wake] send error:", target, port, err.message);
					sent++;
					if (sent === total) setTimeout(() => {
						try {
							sock.close();
						} catch (e) {}
						console.log("[wake] sent to", host, "(both ports)");
						resolve({
							success: true,
							method: "udp"
						});
					}, 500);
				});
			});
		}
	});
});
ipcMain.handle("categories:add", (event, category) => {
	if (!db.categories.includes(category)) {
		db.categories.push(category);
		saveDB(db);
	}
	return db.categories;
});
ipcMain.handle("categories:remove", (event, category) => {
	db.categories = db.categories.filter((c) => c !== category);
	db.games.forEach((g) => {
		g.categories = (g.categories || []).filter((c) => c !== category);
	});
	saveDB(db);
	return db.categories;
});
//#endregion
