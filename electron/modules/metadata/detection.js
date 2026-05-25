// ─── Platform Game Detection ──────────────────────────────────────────────────
// Pure scan functions for detecting installed games from various platforms.
// IPC handlers remain in main.js and call these functions.

const path = require('path');
const fs = require('fs');
const ctx = require('../core/context');
const {
  programDataDir,
  programFilesDir,
  programFilesX86Dir,
  localAppDataDir,
  systemDriveDir,
} = require('../core/paths');

// User-supplied path overrides from db.settings, applied first so a user who
// installed Steam/Epic/GOG/Xbox to a non-default drive can point us at it.
function userPathOverride(field) {
  try {
    const v = ctx?.db?.settings?.[field];
    return (typeof v === 'string' && v.trim()) ? v.trim() : null;
  } catch (_e) { return null; }
}

// ─── Steam Root Resolution ───────────────────────────────────────────────────
function findSteamRoot() {
  const override = userPathOverride('steamPath');
  const steamPaths = [
    override,
    path.join(programFilesX86Dir(), 'Steam'),
    path.join(programFilesDir(), 'Steam'),
    path.join(process.env.HOME || process.env.USERPROFILE || '', 'Steam'),
  ].filter(Boolean);
  for (const p of steamPaths) {
    try { if (fs.existsSync(p)) return p; } catch (_e) { /* ignore */ }
  }
  return null;
}

// ─── Steam Game Detection ─────────────────────────────────────────────────────
function scanSteamInstalled() {
  const games = [];
  const steamRoot = findSteamRoot();
  if (!steamRoot) return { games: [], error: 'Steam not found' };

  // Read libraryfolders.vdf to find all library paths
  const libraryFolders = [path.join(steamRoot, 'steamapps')];
  const vdfPath = path.join(steamRoot, 'steamapps', 'libraryfolders.vdf');

  if (fs.existsSync(vdfPath)) {
    const vdfContent = fs.readFileSync(vdfPath, 'utf-8');
    for (const [, p] of vdfContent.matchAll(/"path"\s+"([^"]+)"/g)) {
      const appsDir = path.join(p.replace(/\\\\/g, '\\'), 'steamapps');
      if (fs.existsSync(appsDir) && !libraryFolders.includes(appsDir)) {
        libraryFolders.push(appsDir);
      }
    }
  }

  // Scan each library folder for .acf manifest files
  for (const libFolder of libraryFolders) {
    if (!fs.existsSync(libFolder)) continue;
    const files = fs.readdirSync(libFolder).filter(f => f.endsWith('.acf'));

    for (const file of files) {
      try {
        const content = fs.readFileSync(path.join(libFolder, file), 'utf-8');
        const appid = content.match(/"appid"\s+"(\d+)"/);
        const name = content.match(/"name"\s+"([^"]+)"/);
        const installdir = content.match(/"installdir"\s+"([^"]+)"/);

        if (appid && name && installdir) {
          const gamePath = path.join(libFolder, 'common', installdir[1]);
          // Intentionally no coverUrl / headerUrl here — the metadata pipeline
          // (modules/metadata/sources/steam.js) HEAD-probes the CDN to find
          // the actual portrait capsule (many Steam apps have no library art),
          // and the cover queue runs a metadata-rescue pass on first fetch.
          // Keeping detection cheap & free of network calls.
          games.push({
            name: name[1],
            platform: 'steam',
            platformId: appid[1],
            installPath: gamePath,
            executablePath: '',
            categories: [],
            source: 'auto-detected',
            installed: true,
          });
        }
      } catch (_e) { /* skip bad manifest */ }
    }
  }

  return { games };
}

// ─── Epic Games Detection ─────────────────────────────────────────────────────
function scanEpicInstalled() {
  const games = [];
  try {
    // The user can point `epicPath` at the Epic install root (e.g.
    // `D:\Epic Games`) OR at the manifests directory directly. Try the
    // override as a manifests-dir first, then as an install root.
    const override = userPathOverride('epicPath');
    const candidates = [];
    if (override) {
      candidates.push(override);
      candidates.push(path.join(override, 'Data', 'Manifests'));
      candidates.push(path.join(override, 'Manifests'));
    }
    candidates.push(path.join(programDataDir(), 'Epic', 'EpicGamesLauncher', 'Data', 'Manifests'));

    let manifestDir = null;
    for (const c of candidates) {
      try { if (c && fs.existsSync(c) && fs.statSync(c).isDirectory()) { manifestDir = c; break; } }
      catch (_e) { /* ignore */ }
    }
    if (!manifestDir) return games;
    const files = fs.readdirSync(manifestDir).filter(f => f.endsWith('.item'));
    for (const file of files) {
      try {
        const content = JSON.parse(fs.readFileSync(path.join(manifestDir, file), 'utf-8'));
        if (content.DisplayName && content.InstallLocation) {
          games.push({
            name: content.DisplayName,
            platform: 'epic',
            platformId: content.CatalogNamespace || content.AppName,
            installPath: content.InstallLocation,
            executablePath: content.LaunchExecutable
              ? path.join(content.InstallLocation, content.LaunchExecutable) : '',
            coverUrl: '',
            categories: [],
            source: 'auto-detected',
            installed: true,
          });
        }
      } catch (_e) { /* skip bad manifest */ }
    }
  } catch (_e) { /* Epic not installed */ }
  return games;
}

// ─── GOG Detection ────────────────────────────────────────────────────────────
function scanGogInstalled() {
  const games = [];
  try {
    const override = userPathOverride('gogPath');
    const dirsToScan = [
      override,
      path.join(systemDriveDir(), 'GOG Games'), // matches the GOG Galaxy default
      path.join(programFilesX86Dir(), 'GOG Galaxy', 'Games'),
      path.join(programFilesDir(), 'GOG Galaxy', 'Games'),
    ].filter(Boolean).filter(d => { try { return fs.existsSync(d); } catch { return false; } });
    for (const dir of dirsToScan) {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const gameDir = path.join(dir, entry.name);
          const infoFiles = fs.readdirSync(gameDir).filter(f => f.startsWith('goggame-') && f.endsWith('.info'));
          for (const infoFile of infoFiles) {
            try {
              const info = JSON.parse(fs.readFileSync(path.join(gameDir, infoFile), 'utf-8'));
              if (info.name) {
                games.push({
                  name: info.name,
                  platform: 'gog',
                  platformId: info.gameId || '',
                  installPath: gameDir,
                  executablePath: info.playTasks?.[0]?.path
                    ? path.join(gameDir, info.playTasks[0].path) : '',
                  coverUrl: '',
                  categories: [],
                  source: 'auto-detected',
                  installed: true,
                });
              }
            } catch (_e) { /* skip */ }
          }
        }
      }
    }
  } catch (_e) { /* GOG not installed */ }
  return games;
}

// ─── Xbox Game Pass / Xbox App Detection ──────────────────────────────────────
// Each game installed via the Xbox app drops a `MicrosoftGame.config` XML into
// its top-level folder. The file is shallow, predictable, and authored by
// Microsoft's gaming-services build tool — we can probe a handful of well-
// known tags with regex and skip pulling in a full XML parser dep.
//
// What we want out of it:
//   • Identity/@Name   — the package's bare identity (e.g. "Microsoft.HaloInfinite").
//                        Combined with the publisher-id hash from `%LOCALAPPDATA%\Packages\`
//                        this yields the Package Family Name (PFN).
//   • ShellVisuals/@DefaultDisplayName — better display name than the folder.
//   • Executable/@Id   — the AUMID suffix; AUMID = "<PFN>!<Id>".
//   • TitleId          — hex (e.g. 0x9DDA0000). Convert to decimal so we can
//                        dedup against the decimal titleId XBL's titlehub API
//                        returns for the same game.
//   • StoreId          — 12-char Microsoft Store product ID. Same identifier
//                        Xbox Cloud Gaming uses for deep-linking, so we can
//                        stamp `xcloudProductId` directly and avoid round-
//                        tripping through the Game Pass catalog match.
function parseMicrosoftGameConfig(installPath) {
  const cfgPath = path.join(installPath, 'MicrosoftGame.config');
  if (!fs.existsSync(cfgPath)) return null;
  let xml;
  try { xml = fs.readFileSync(cfgPath, 'utf8'); } catch (_e) { return null; }
  const attr = (tag, attrName) => {
    const re = new RegExp('<' + tag + '\\b[^>]*\\b' + attrName + '\\s*=\\s*"([^"]*)"', 'i');
    const m = xml.match(re);
    return m ? m[1] : '';
  };
  const text = (tag) => {
    const re = new RegExp('<' + tag + '\\s*>([^<]+)<\\/' + tag + '>', 'i');
    const m = xml.match(re);
    return m ? m[1].trim() : '';
  };
  const identityName = attr('Identity', 'Name');
  const displayName = attr('ShellVisuals', 'DefaultDisplayName');
  const executableId = attr('Executable', 'Id') || 'App';
  const titleIdHex = text('TitleId');
  const storeId = text('StoreId');
  // Normalize the titleId to decimal — XBL's titlehub returns the same id in
  // decimal string form, so converting here lets `findExisting` dedup the
  // local-scan row and the XBL-import row into a single entry.
  let titleIdDec = '';
  if (titleIdHex) {
    try {
      const v = titleIdHex.startsWith('0x') ? BigInt(titleIdHex) : BigInt('0x' + titleIdHex);
      titleIdDec = v.toString(10);
    } catch (_e) { /* malformed — leave blank, fall back to name-canonical match */ }
  }
  return { identityName, displayName, executableId, titleIdHex, titleIdDec, storeId };
}

// Resolve the full Package Family Name by matching `<IdentityName>_*` against
// the per-user package state dir Windows creates on install. Returns '' if we
// can't find one (e.g. the game's package dir was renamed or the user is on
// an unusual MS Store profile).
function resolveXboxPackageFamilyName(identityName) {
  if (!identityName) return '';
  const packagesDir = path.join(localAppDataDir(), 'Packages');
  let entries;
  try { entries = fs.existsSync(packagesDir) ? fs.readdirSync(packagesDir, { withFileTypes: true }) : null; }
  catch (_e) { return ''; }
  if (!entries) return '';
  const prefix = identityName + '_';
  const match = entries.find(e => e.isDirectory() && e.name.startsWith(prefix));
  return match ? match.name : '';
}

function scanXboxInstalled() {
  const games = [];

  // Honor the user's `xboxPath` override (set in Settings ▸ System ▸ Platform
  // Paths) for users who relocated their install drive in the Xbox app's
  // "Change where new things install" dialog. Otherwise fall back to the
  // system-drive default.
  const override = userPathOverride('xboxPath');
  const xboxGamesCandidates = [
    override,
    path.join(systemDriveDir(), 'XboxGames'),
  ].filter(Boolean);

  for (const xboxGamesDir of xboxGamesCandidates) {
    let entries;
    try { entries = fs.existsSync(xboxGamesDir) ? fs.readdirSync(xboxGamesDir, { withFileTypes: true }) : null; }
    catch (_e) { continue; }
    if (!entries) continue;
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name === 'Content') continue;
      const installPath = path.join(xboxGamesDir, entry.name);
      const cfg = parseMicrosoftGameConfig(installPath);
      const pfn = cfg ? resolveXboxPackageFamilyName(cfg.identityName) : '';
      // AUMID = "<PackageFamilyName>!<ExecutableId>". Used by Explorer's
      // shell:AppsFolder protocol to launch the game natively without
      // bouncing through the Xbox app's home screen.
      const aumid = (pfn && cfg) ? `${pfn}!${cfg.executableId}` : '';
      const niceName = (cfg && cfg.displayName)
        ? cfg.displayName
        : entry.name.replace(/([A-Z])/g, ' $1').trim();
      games.push({
        name: niceName,
        platform: 'xbox',
        // platformId follows XBL's decimal-titleId convention so the Xbox
        // library importer can merge this entry with its remote counterpart.
        platformId: cfg ? cfg.titleIdDec || '' : '',
        installPath,
        installed: true,
        executablePath: '',
        coverUrl: '',
        categories: [],
        source: 'auto-detected',
        // Local-launch metadata (used by main.js launch routing).
        xboxAumid: aumid,
        xboxPfn: pfn,
        xboxTitleIdHex: cfg ? cfg.titleIdHex : '',
        xboxIdentityName: cfg ? cfg.identityName : '',
        // The StoreId in MicrosoftGame.config IS the Microsoft Store big-
        // catalog product ID — same value used by xCloud deep-links. We can
        // surface "Stream on Xbox Cloud" without waiting for the next catalog
        // refresh.
        xcloudProductId: cfg ? cfg.storeId : '',
      });
    }
    // If we successfully read one of the candidates, prefer those results and
    // don't keep scanning lower-priority paths (avoids duplicates if the user
    // happens to keep both the override and the C: default populated).
    break;
  }

  // Check if Xbox app is installed for cloud gaming
  const xboxAppPaths = [
    path.join(localAppDataDir(), 'Microsoft', 'WindowsApps', 'XboxApp.exe'),
    path.join(programFilesDir(), 'WindowsApps', 'Microsoft.GamingApp_*'),
  ];

  let xboxAppFound = false;
  for (const p of xboxAppPaths) {
    if (p.includes('*')) {
      const dir = path.dirname(p);
      const prefix = path.basename(p).replace('*', '');
      if (fs.existsSync(dir)) {
        const matches = fs.readdirSync(dir).filter(f => f.startsWith(prefix));
        if (matches.length > 0) xboxAppFound = true;
      }
    } else if (fs.existsSync(p)) {
      xboxAppFound = true;
    }
  }

  return { games, xboxAppFound, cloudGamingUrl: 'https://www.xbox.com/play' };
}

module.exports = {
  findSteamRoot,
  scanSteamInstalled,
  scanEpicInstalled,
  scanGogInstalled,
  scanXboxInstalled,
};
