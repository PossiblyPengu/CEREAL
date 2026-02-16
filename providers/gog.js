const https = require('https');

function httpGetJson(url, headers) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'CerealLauncher/1.0', ...(headers || {}) } }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
        catch (e) { resolve({ status: res.statusCode, data: null, raw: data }); }
      });
    }).on('error', e => reject(e));
  });
}

function stripEdition(name) {
  if (!name) return '';
  return name.replace(/\s*[-–:]\s*(Deluxe|Ultimate|Gold|Complete|Collector's|Special|Limited|Season Pass|DLC).*/i, '')
             .replace(/\s*\(.*(Deluxe|Edition|DLC|Season Pass).*\)\s*/i, '')
             .trim();
}

function canonicalize(name) {
  if (!name) return '';
  return stripEdition(String(name)).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

async function importLibrary({ db, saveDB, notify }) {
  const acct = (db.accounts || {}).gog;
  if (!acct?.accessToken) return { error: 'GOG account not connected' };
  try {
    // Refresh handled by caller if needed; here we request first page
    const r = await httpGetJson('https://embed.gog.com/account/getFilteredProducts?mediaType=1&totalPages=1', { 'Authorization': 'Bearer ' + acct.accessToken });
    if (!r.data?.products) return { error: 'Could not fetch GOG library (status ' + r.status + '). Try signing in again.' };
    let allProducts = [...r.data.products];
    const totalPages = r.data.totalPages || 1;
    for (let page = 2; page <= Math.min(totalPages, 20); page++) {
      const pr = await httpGetJson(`https://embed.gog.com/account/getFilteredProducts?mediaType=1&page=${page}`, { 'Authorization': 'Bearer ' + acct.accessToken });
      if (pr.data?.products) allProducts.push(...pr.data.products);
    }
    const imported = [];
    const updated = [];
    const processedNames = new Set();
    let idx = 0;
    for (const gp of allProducts) {
      idx++;
      const gogId = String(gp.id);
      const title = gp.title || gp.name || '';
      const canonical = canonicalize(title);
      if (processedNames.has(canonical)) continue; // dedupe editions/dlcs
      processedNames.add(canonical);

      // Prefer explicit media/key images when available
      let img = '';
      try {
        if (gp.media && Array.isArray(gp.media)) {
          const found = gp.media.find(m => m.type && /cover|header|hero|logo/i.test(m.type)) || gp.media[0];
          img = found?.url || found?.image || '';
        }
      } catch (e) { img = ''; }
      if (!img && gp.image) img = 'https:' + gp.image + '_392.jpg';

      const existing = db.games.find(g => {
        if (g.platform !== 'gog') return false;
        if (g.platformId && g.platformId === gogId) return true;
        if (g.name && canonicalize(g.name) === canonical) return true;
        return false;
      });
      const isDlc = gp.isDlc || /\b(dlc|expansion|season pass|add-?on)\b/i.test(title);

      if (existing) {
        let changed = false;
        if (!existing.platformId) { existing.platformId = gogId; changed = true; }
        if (!existing.coverUrl && img) { existing.coverUrl = img; changed = true; }
        if (isDlc) {
          existing.editions = existing.editions || [];
          if (!existing.editions.includes(title)) { existing.editions.push(title); changed = true; }
        }
        if (changed) updated.push(existing.name);
      } else {
        db.games.push({
          id: 'gog_' + gogId + '_' + Date.now(),
          name: title,
          platform: 'gog',
          platformId: gogId,
          coverUrl: img || '',
          categories: [],
          playtimeMinutes: 0,
          lastPlayed: null,
          addedAt: new Date().toISOString(),
          favorite: false,
          editions: isDlc ? [title] : []
        });
        imported.push(title);
      }

      if (notify && (idx % 10 === 0)) notify({ status: 'progress', processed: idx, imported: imported.length, updated: updated.length });
    }
    if (!db.accounts) db.accounts = {};
    if (db.accounts.gog) { db.accounts.gog.lastSync = new Date().toISOString(); db.accounts.gog.gameCount = allProducts.length; }
    saveDB(db);
    if (notify) notify({ status: 'done', processed: processedNames.size, imported: imported.length, updated: updated.length });
    return { imported, updated, total: allProducts.length, games: db.games };
  } catch (e) {
    return { error: 'GOG import failed: ' + e.message };
  }
}

async function validateKey(apiKey) {
  if (!apiKey) return { ok: false, error: 'no-key' };
  try {
    // Try bearer token first
    let res = await httpGetJson('https://embed.gog.com/account', { 'Authorization': 'Bearer ' + apiKey });
    if (res && res.status === 200 && res.data) return { ok: true, info: res.data };

    // If the supplied key looks like a cookie (contains =), try as Cookie header
    if (apiKey.includes('=')) {
      res = await httpGetJson('https://embed.gog.com/account', { 'Cookie': apiKey });
      if (res && res.status === 200 && res.data) return { ok: true, info: res.data };
    }

    return { ok: false, error: res && (res.data || res.raw) };
  } catch (e) { return { ok: false, error: e && e.message }; }
}

module.exports = { importLibrary, validateKey };
