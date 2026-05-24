//#region electron/main.js
var { app, BrowserWindow, ipcMain, dialog, Tray, Menu, nativeImage, protocol, screen } = require("electron");
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
var { safeStore } = require("./modules/core/credentials");
var { spawn, spawnSync } = require("child_process");
var { ACCOUNT_SECRET_FIELDS } = require("./modules/core/constants");
var log = require("./modules/core/logger");
var { detachAccountSecrets, registerAccountIpcHandlers } = require("./modules/integrations/accounts");
var { connectDiscord, disconnectDiscord, setDiscordPresence, isDiscordEnabled, getDiscordStatus } = require("./modules/integrations/discord");
ipcMain.handle("discord:status", () => getDiscordStatus());
var { getCoversDir, cleanupFile, enqueueCoverFetch, evictOldCovers, shouldSkipDueToPriorFailure } = require("./modules/games/covers");
var { chiakiSessions, resolveChiakiExe, buildChiakiArgs, startChiakiSession, sendEmbedBoundsToAll, autoSetupChiakiIfMissing, registerChiakiIpcHandlers } = require("./modules/integrations/chiaki");
var { xcloudSessions, updateAllXcloudBounds, startXcloudSession, stopXcloudSession } = require("./modules/integrations/xcloud");
ipcMain.handle("tabs:switch", (_event, id) => {
	try {
		for (const [gid, sess] of xcloudSessions) try {
			if (sess && sess.view) sess.view.setVisible(gid === id);
		} catch (_e) {}
		return { success: true };
	} catch (e) {
		return {
			success: false,
			error: e && e.message
		};
	}
});
ipcMain.handle("tabs:close", (_event, id) => {
	try {
		return { success: stopXcloudSession(id) };
	} catch (e) {
		return {
			success: false,
			error: e && e.message
		};
	}
});
var { registerGameCrudIpcHandlers } = require("./modules/games/gameCrud");
registerGameCrudIpcHandlers();
var { DB_PATH, loadDB, saveDB, flushDB } = require("./modules/core/database");
var db = null;
var { registerLocalImageProtocol } = require("./modules/core/protocol");
var { registerSecurityHandlers } = require("./modules/core/security");
var { registerWindowIpc } = require("./modules/core/windowIpc");
var { registerSystemIpc } = require("./modules/core/systemIpc");
var { clampBoundsToWorkArea, isOnScreen } = require("./modules/core/display");
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
	const defaults = {
		width: 1280,
		height: 800
	};
	const primaryWa = screen.getPrimaryDisplay().workArea;
	defaults.width = Math.min(defaults.width, primaryWa.width - 24);
	defaults.height = Math.min(defaults.height, primaryWa.height - 24);
	const rawSaved = !!(db && db.settings && db.settings.rememberWindowBounds) ? db.settings && db.settings.windowBounds : null;
	let savedBounds = null;
	if (rawSaved && isOnScreen(rawSaved)) savedBounds = clampBoundsToWorkArea(rawSaved);
	const winOpts = {
		width: defaults.width,
		height: defaults.height,
		minWidth: 900,
		minHeight: 600,
		frame: false,
		show: false,
		backgroundColor: "#0a0a0f",
		webPreferences: {
			preload: path.join(__dirname, "preload.js"),
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: true,
			backgroundThrottling: false
		}
	};
	if (savedBounds) {
		winOpts.x = savedBounds.x;
		winOpts.y = savedBounds.y;
		winOpts.width = savedBounds.width;
		winOpts.height = savedBounds.height;
	}
	mainWindow = new BrowserWindow(winOpts);
	if (savedBounds && rawSaved && rawSaved.isMaximized) try {
		mainWindow.maximize();
	} catch (_e) {}
	mainWindow.once("ready-to-show", () => {
		if (db && db.settings && db.settings.startMinimized) return;
		mainWindow.show();
	});
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
	mainWindow.on("show", onWindowBoundsChanged);
	mainWindow.on("restore", onWindowBoundsChanged);
	mainWindow.on("maximize", onWindowBoundsChanged);
	mainWindow.on("unmaximize", onWindowBoundsChanged);
	mainWindow.on("enter-full-screen", onWindowBoundsChanged);
	mainWindow.on("leave-full-screen", onWindowBoundsChanged);
	mainWindow.on("enter-html-full-screen", onWindowBoundsChanged);
	mainWindow.on("leave-html-full-screen", onWindowBoundsChanged);
	mainWindow.on("close", (e) => {
		saveWindowBounds();
		if (!isQuitting && db && db.settings && db.settings.closeToTray) {
			e.preventDefault();
			mainWindow.hide();
		}
	});
	mainWindow.on("minimize", (e) => {
		if (db && db.settings && db.settings.minimizeToTray) {
			try {
				e.preventDefault();
			} catch (_e) {}
			mainWindow.hide();
		}
		for (const sess of chiakiSessions.values()) if (sess.embedProcess && !sess.embedProcess.killed) try {
			sess.embedProcess.stdin.write("hide\n");
		} catch (_e) {}
		for (const sess of xcloudSessions.values()) try {
			sess.view.setVisible(false);
		} catch (_e) {}
	});
	mainWindow.on("focus", () => {
		for (const sess of chiakiSessions.values()) if (sess.embedded && sess.embedProcess && !sess.embedProcess.killed) try {
			sess.embedProcess.stdin.write("show\n");
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
	registerLocalImageProtocol();
	db = loadDB();
	const ctx = require("./modules/core/context");
	ctx.db = db;
	ctx.safeStore = safeStore;
	ctx.saveDB = saveDB;
	ctx.flushDB = () => flushDB(db);
	ctx.sendToRenderer = sendToRenderer;
	try {
		const { runMigrations } = require("./modules/core/legacyMigration");
		runMigrations({
			db,
			safeStore
		});
	} catch (e) {
		require("./modules/core/logger").warn("migration", "Legacy migration runner threw:", e && e.message);
	}
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
	try {
		const { runMigrations: runDbMigrations } = require("./modules/core/migrations");
		const summary = runDbMigrations({
			db,
			saveDB,
			dbPath: DB_PATH,
			deps: {
				cleanupFile,
				getCoversDir
			}
		});
		if (summary && summary.ran && summary.ran.length > 0) log.info("main", `DB migrations: v${summary.from} → v${summary.to}, ${summary.ran.length} applied`);
	} catch (e) {
		log.error("main", "Migration runner failed:", e && e.message);
	}
	setTimeout(() => {
		let requeued = 0;
		let skipped = 0;
		for (const game of db.games || []) {
			const needsCover = !game.localCoverPath && (game.coverUrl || game.headerUrl || game.screenshots && game.screenshots.length);
			const needsHeader = !game.localHeaderPath && game.headerUrl;
			if (needsCover || needsHeader) {
				if (shouldSkipDueToPriorFailure(game)) {
					skipped++;
					continue;
				}
				enqueueCoverFetch(game.id);
				requeued++;
			}
		}
		if (requeued > 0 || skipped > 0) log.info("main", `Re-enqueued ${requeued} games for cover download` + (skipped > 0 ? ` (skipped ${skipped} with recent failures)` : ""));
		evictOldCovers({ force: true }).catch(() => {});
	}, 3e3);
	registerSecurityHandlers();
	registerWindowIpc();
	registerSystemIpc();
	createWindow();
	ctx.mainWindow = mainWindow;
	const _onDisp = () => onDisplayConfigChanged();
	screen.on("display-added", _onDisp);
	screen.on("display-removed", _onDisp);
	screen.on("display-metrics-changed", _onDisp);
	app.once("before-quit", () => {
		try {
			screen.removeListener("display-added", _onDisp);
			screen.removeListener("display-removed", _onDisp);
			screen.removeListener("display-metrics-changed", _onDisp);
		} catch (_e) {}
	});
	if (db.settings && (db.settings.closeToTray || db.settings.minimizeToTray)) createTray();
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
	try {
		try {
			const smtcNative = require(path.join(__dirname, "native", "smtc"));
			if (smtcNative && typeof smtcNative.cleanup === "function") try {
				smtcNative.cleanup();
			} catch (_e) {}
		} catch (_e) {}
		if (process.platform === "win32") try {
			spawnSync("taskkill", [
				"/IM",
				"MediaInfoTool.exe",
				"/F"
			]);
		} catch (_e) {}
	} catch (_e) {}
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
function onDisplayConfigChanged() {
	if (!mainWindow || mainWindow.isDestroyed()) return;
	if (mainWindow.isMinimized() || mainWindow.isFullScreen()) return;
	try {
		if (!mainWindow.isMaximized()) {
			const cur = mainWindow.getBounds();
			const next = clampBoundsToWorkArea(cur);
			if (next && (next.x !== cur.x || next.y !== cur.y || next.width !== cur.width || next.height !== cur.height)) mainWindow.setBounds(next);
		}
	} catch (e) {
		log.warn("main", "display reflow failed:", e && e.message);
	}
	onWindowBoundsChanged();
}
var { registerKeysIpcHandlers } = require("./modules/integrations/keys");
registerKeysIpcHandlers();
var { registerMetadataIpcHandlers } = require("./modules/metadata/metadataIpc");
registerMetadataIpcHandlers();
var { normalizePlatform, openInPlatformClient } = require("./modules/games/launcher");
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
var { registerDetectionIpcHandlers } = require("./modules/metadata/detectionIpc");
registerDetectionIpcHandlers();
var { registerSettingsIpcHandlers } = require("./modules/games/settings");
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
var { registerMediaIpcHandlers } = require("./modules/integrations/media");
registerMediaIpcHandlers();
//#endregion
