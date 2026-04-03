const { httpGetJson } = require('./http');
const { canonicalize, isDlcTitle, findExisting, makeGameEntry, updateAccountSync } = require('./utils');

function pickCoverImage(rec) {
  try {
    const keys = rec.metadata?.keyImages || rec.keyImages || rec.images || [];
    if (Array.isArray(keys) && keys.length) {
      const pref = keys.find(k =>
        (k.type || k.imageType || '').toLowerCase().includes('key') ||
        (k.type || '').toLowerCase().includes('offer') ||
        (k.type || '').toLowerCase().includes('hero')
      ) || keys[0];
      return pref?.url || pref?.image || pref?.src || '';
    }
  } catch (e) { /* fall through */ }
  return rec.metadata?.image || '';
}

async function importLibrary({ db, saveDB, notify }) {
  const acct = (db.accounts || {}).epic;
  if (!acct?.accessToken || !acct?.accountId) return { error: 'Epic account not connected' };
  try {
    const r = await httpGetJson(
      'https://library-service.live.use1a.on.epicgames.com/library/api/public/items?includeMetadata=true',
      { 'Authorization': 'Bearer ' + acct.accessToken }
    );
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
      const appName = rec.appName || rec.metadata?.appName || '';
      const productSlug = rec.metadata?.productSlug || rec.metadata?.slug || '';
      const title = rec.metadata?.title || rec.title || rec.appName || 'Unknown';
      const keyId = ns || catId || title;
      if (!keyId) continue;

      const canonical = canonicalize(title);
      if (processedKeys.has(keyId) || processedNames.has(canonical)) continue;
      processedKeys.add(keyId);
      processedNames.add(canonical);

      const img = pickCoverImage(rec);
      const existing = findExisting(db, 'epic', keyId, title);
      const dlc = isDlcTitle(title, rec.metadata);

      if (existing) {
        let changed = false;
        if (!existing.platformId) { existing.platformId = keyId; changed = true; }
        if (!existing.epicNamespace && ns) { existing.epicNamespace = ns; changed = true; }
        if (!existing.epicCatalogItemId && catId) { existing.epicCatalogItemId = catId; changed = true; }
        if (!existing.epicAppName && appName) { existing.epicAppName = appName; changed = true; }
        if (!existing.storeUrl && productSlug) { existing.storeUrl = `https://store.epicgames.com/en-US/p/${productSlug}`; changed = true; }
        if (!existing.coverUrl && img) { existing.coverUrl = img; changed = true; }
        if (dlc) {
          existing.editions = existing.editions || [];
          if (!existing.editions.includes(title)) { existing.editions.push(title); changed = true; }
        }
        if (changed) updated.push(existing.name);
      } else {
        db.games.push(makeGameEntry('epic', 'epic', {
          platformId: keyId,
          name: title,
          coverUrl: img,
          extra: {
            epicNamespace: ns || '',
            epicCatalogItemId: catId || '',
            epicAppName: appName || '',
            storeUrl: productSlug ? `https://store.epicgames.com/en-US/p/${productSlug}` : '',
            editions: dlc ? [title] : [],
            installed: false,
          },
        }));
        imported.push(title);
      }

      if (notify && (idx % 10 === 0)) notify({ status: 'progress', processed: idx, imported: imported.length, updated: updated.length });
    }

    updateAccountSync(db, saveDB, 'epic', processedKeys.size);
    if (notify) notify({ status: 'done', processed: processedKeys.size, imported: imported.length, updated: updated.length });
    return { imported, updated, total: processedKeys.size, games: db.games };
  } catch (e) {
    return { error: 'Epic import failed: ' + e.message };
  }
}

async function validateKey(apiKey) {
  if (!apiKey) return { ok: false, error: 'no-key' };
  try {
    const url = 'https://account-public-service-prod.ol.epicgames.com/account/api/public/account';
    const res = await httpGetJson(url, { 'Authorization': 'Bearer ' + apiKey });
    if (res && res.status === 200 && res.data) return { ok: true, info: res.data };
    return { ok: false, error: res && (res.data || res.raw) };
  } catch (e) { return { ok: false, error: e && e.message }; }
}

module.exports = { importLibrary, validateKey };
