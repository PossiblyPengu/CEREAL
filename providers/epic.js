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
  return name.replace(/\s*[-–:]\s*(Deluxe|Ultimate|Year One|Gold|Collector's|Special|Limited|Complete|Season Pass|DLC).*/i, '')
             .replace(/\s*\(.*(Deluxe|Edition|DLC|Season Pass).*\)\s*/i, '')
             .trim();
}

function canonicalize(name) {
  if (!name) return '';
  return stripEdition(String(name)).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

async function importLibrary({ db, saveDB, notify }) {
  const acct = (db.accounts || {}).epic;
  if (!acct?.accessToken || !acct?.accountId) return { error: 'Epic account not connected' };
  try {
    // Get library items
    const r = await httpGetJson(`https://library-service.live.use1a.on.epicgames.com/library/api/public/items?includeMetadata=true`, { 'Authorization': 'Bearer ' + acct.accessToken });
    const records = r.data?.records || r.data || [];
    const imported = [];
    const updated = [];
    const processedKeys = new Set();
    const processedNames = new Set();
    let idx = 0;
    for (const rec of records) {
      idx++;
      const ns = rec.namespace || rec.catalogNamespace || '';
      const catId = rec.catalogItemId || rec.catalogId || '';
      const title = rec.metadata?.title || rec.title || rec.appName || 'Unknown';
      const keyId = ns || catId || title;
      if (!keyId) continue;
      // prefer a canonical base name to dedupe editions/DLC
      const canonical = canonicalize(title);
      if (processedKeys.has(keyId) || processedNames.has(canonical)) continue;
      processedKeys.add(keyId); processedNames.add(canonical);

      // Prefer explicit key images, then images array
      let img = '';
      try {
        const keys = rec.metadata?.keyImages || rec.keyImages || rec.images || [];
        if (Array.isArray(keys) && keys.length) {
          // prefer types often used as key art
          const pref = keys.find(k => (k.type||k.imageType||'').toLowerCase().includes('key') || (k.type||'').toLowerCase().includes('offer') || (k.type||'').toLowerCase().includes('hero')) || keys[0];
          img = pref?.url || pref?.image || pref?.src || '';
        }
      } catch (e) { img = rec.metadata?.image || ''; }

      const titleClean = title;
      const existing = db.games.find(g => {
        if (g.platform !== 'epic') return false;
        if (g.platformId && g.platformId === keyId) return true;
        if (g.name && canonicalize(g.name) === canonical) return true;
        return false;
      });

      // mark DLC/editions as metadata on existing game rather than separate entries
      const isDlc = /\b(dlc|season pass|expansion|add-?on)\b/i.test(title) || (rec.metadata && /dlc|expansion/i.test(JSON.stringify(rec.metadata || {})));

      if (existing) {
        let changed = false;
        if (!existing.platformId) { existing.platformId = keyId; changed = true; }
        if (!existing.coverUrl && img) { existing.coverUrl = img; changed = true; }
        if (isDlc) {
          existing.editions = existing.editions || [];
          if (!existing.editions.includes(titleClean)) { existing.editions.push(titleClean); changed = true; }
        }
        if (changed) updated.push(existing.name);
      } else {
        db.games.push({ id: 'epic_' + keyId + '_' + Date.now(), name: titleClean, platform: 'epic', platformId: keyId, coverUrl: img || '', categories: [], playtimeMinutes: 0, lastPlayed: null, addedAt: new Date().toISOString(), favorite: false, editions: isDlc ? [titleClean] : [] });
        imported.push(titleClean);
      }

      // notify progress each 10 items
      if (notify && (idx % 10 === 0)) notify({ status: 'progress', processed: idx, imported: imported.length, updated: updated.length });
    }
    if (!db.accounts) db.accounts = {};
    if (db.accounts.epic) { db.accounts.epic.lastSync = new Date().toISOString(); db.accounts.epic.gameCount = processedKeys.size; }
    saveDB(db);
    if (notify) notify({ status: 'done', processed: processedKeys.size, imported: imported.length, updated: updated.length });
    return { imported, updated, total: processedKeys.size, games: db.games };
  } catch (e) {
    return { error: 'Epic import failed: ' + e.message };
  }
}

async function validateKey(apiKey) {
  if (!apiKey) return { ok: false, error: 'no-key' };
  try {
    // Epic account info endpoint (bearer token expected)
    const url = 'https://account-public-service-prod.ol.epicgames.com/account/api/public/account';
    const res = await httpGetJson(url, { 'Authorization': 'Bearer ' + apiKey });
    if (res && res.status === 200 && res.data) return { ok: true, info: res.data };
    return { ok: false, error: res && (res.data || res.raw) };
  } catch (e) { return { ok: false, error: e && e.message }; }
}

module.exports = { importLibrary, validateKey };
