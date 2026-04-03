const fs = require('fs');
const path = require('path');
const { httpGetJson } = require('./http');
const { canonicalize, findExisting, makeGameEntry, updateAccountSync } = require('./utils');

function detectInstalled() {
  const games = [];
  try {
    const itchDbDir = path.join(process.env.APPDATA || '', 'itch');
    const itchGamesDir = path.join(process.env.APPDATA || '', 'itch', 'apps');
    const itchGamesDir2 = path.join(process.env.USERPROFILE || '', 'AppData', 'Local', 'itch', 'apps');

    const appsDirs = [itchGamesDir, itchGamesDir2].filter(d => fs.existsSync(d));
    const seen = new Set();

    for (const dir of appsDirs) {
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isDirectory()) continue;
          const gameName = entry.name;
          const canonical = canonicalize(gameName);
          if (seen.has(canonical)) continue;
          seen.add(canonical);

          const gameDir = path.join(dir, gameName);
          let exe = '';
          try {
            const walkForExe = (d, depth) => {
               if (depth >= 2 || exe) return;
              const files = fs.readdirSync(d);
              for (const f of files) {
                const fp = path.join(d, f);
                try {
                  const st = fs.statSync(fp);
                  if (st.isFile() && f.endsWith('.exe') && !/(unins|setup|redist|crash)/i.test(f)) { exe = fp; return; }
                  if (st.isDirectory() && depth < 2) walkForExe(fp, depth + 1);
                } catch (e) {}
              }
            };
            walkForExe(gameDir, 0);
          } catch (e) {}

          games.push({
            name: gameName.replace(/[-_]/g, ' '), platform: 'itchio', platformId: '',
            installPath: gameDir, executablePath: exe, coverUrl: '',
            categories: [], source: 'auto-detected', installed: true,
          });
        }
      } catch (e) {}
    }

    const receiptsDir = path.join(itchDbDir, 'receipts');
    if (fs.existsSync(receiptsDir)) {
      try {
        const files = fs.readdirSync(receiptsDir).filter(f => f.endsWith('.json'));
        for (const f of files) {
          try {
            const receipt = JSON.parse(fs.readFileSync(path.join(receiptsDir, f), 'utf-8'));
            const name = receipt.game?.title || receipt.title || '';
            if (!name) continue;
            const canonical = canonicalize(name);
            if (seen.has(canonical)) continue;
            seen.add(canonical);
            games.push({
              name, platform: 'itchio',
              platformId: String(receipt.game?.id || receipt.gameId || ''),
              installPath: receipt.installFolder || receipt.installPath || '',
              executablePath: '', coverUrl: receipt.game?.coverUrl || receipt.game?.cover_url || '',
              categories: [], source: 'auto-detected',
              installed: !!(receipt.installFolder || receipt.installPath),
            });
          } catch (e) {}
        }
      } catch (e) {}
    }
  } catch (err) {
    return { games: [], error: err.message };
  }
  return { games };
}

function isAppInstalled() {
  const itchDir = path.join(process.env.LOCALAPPDATA || '', 'itch');
  if (fs.existsSync(itchDir)) return true;
  const itchDir2 = path.join(process.env.APPDATA || '', 'itch');
  if (fs.existsSync(itchDir2)) return true;
  return false;
}

async function importLibrary({ db, saveDB, notify, apiKey }) {
  const detected = detectInstalled();
  const allGames = [...(detected.games || [])];

  if (apiKey) {
    try {
      let page = 1;
      let hasMore = true;
      while (hasMore && page <= 20) {
        const r = await httpGetJson(`https://api.itch.io/profile/owned-keys?page=${page}`, {
          'Authorization': 'Bearer ' + apiKey,
        });
        if (r.status !== 200 || !r.data?.owned_keys) break;
        const keys = r.data.owned_keys;
        if (keys.length === 0) { hasMore = false; break; }
        for (const key of keys) {
          const game = key.game;
          if (!game) continue;
          const existing = allGames.find(g => canonicalize(g.name) === canonicalize(game.title));
          if (!existing) {
            allGames.push({
              name: game.title, platform: 'itchio', platformId: String(game.id),
              installPath: '', executablePath: '', coverUrl: game.cover_url || '',
              categories: [], source: 'api', installed: false, storeUrl: game.url || '',
            });
          }
        }
        page++;
        if (notify) notify({ status: 'progress', processed: allGames.length, page });
      }
    } catch (e) { /* API failed, continue with local detection only */ }
  }

  const imported = [];
  const updated = [];
  for (const g of allGames) {
    const existing = findExisting(db, 'itchio', g.platformId, g.name);
    if (existing) {
      let changed = false;
      if (!existing.platformId && g.platformId) { existing.platformId = g.platformId; changed = true; }
      if (!existing.coverUrl && g.coverUrl) { existing.coverUrl = g.coverUrl; changed = true; }
      if (!existing.installPath && g.installPath) { existing.installPath = g.installPath; changed = true; }
      if (g.installed && !existing.installed) { existing.installed = true; changed = true; }
      if (g.storeUrl && !existing.storeUrl) { existing.storeUrl = g.storeUrl; changed = true; }
      if (changed) updated.push(existing.name);
    } else {
      db.games.push(makeGameEntry('itchio', 'itchio', {
        platformId: g.platformId,
        name: g.name,
        coverUrl: g.coverUrl,
        extra: {
          installPath: g.installPath || '',
          executablePath: g.executablePath || '',
          storeUrl: g.storeUrl || '',
          installed: g.installed || false,
        },
      }));
      imported.push(g.name);
    }
  }

  updateAccountSync(db, saveDB, 'itchio', allGames.length);
  if (notify) notify({ status: 'done', processed: allGames.length, imported: imported.length, updated: updated.length });
  return { imported, updated, total: allGames.length, games: db.games };
}

async function validateKey(apiKey) {
  if (!apiKey) return { ok: false, error: 'no-key' };
  try {
    const res = await httpGetJson('https://api.itch.io/profile', { 'Authorization': 'Bearer ' + apiKey });
    if (res.status === 200 && res.data?.user) return { ok: true, info: res.data.user };
    return { ok: false, error: res.data || res.raw || 'Invalid key' };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

module.exports = { detectInstalled, isAppInstalled, importLibrary, validateKey };
