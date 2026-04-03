const { httpGetJson } = require('./http');
const { canonicalize, isDlcTitle, findExisting, makeGameEntry, updateAccountSync } = require('./utils');

function pickCoverImage(gp) {
  try {
    if (gp.media && Array.isArray(gp.media)) {
      const found = gp.media.find(m => m.type && /cover|header|hero|logo/i.test(m.type)) || gp.media[0];
      const url = found?.url || found?.image || '';
      if (url) return url;
    }
  } catch (e) { /* fall through */ }
  if (gp.image) return 'https:' + gp.image + '_392.jpg';
  return '';
}

async function importLibrary({ db, saveDB, notify }) {
  const acct = (db.accounts || {}).gog;
  if (!acct?.accessToken) return { error: 'GOG account not connected' };
  try {
    const authHeader = { 'Authorization': 'Bearer ' + acct.accessToken };
    const r = await httpGetJson('https://embed.gog.com/account/getFilteredProducts?mediaType=1&totalPages=1', authHeader);
    if (!r.data?.products) return { error: 'Could not fetch GOG library (status ' + r.status + '). Try signing in again.' };

    let allProducts = [...r.data.products];
    const totalPages = r.data.totalPages || 1;
    for (let page = 2; page <= Math.min(totalPages, 20); page++) {
      const pr = await httpGetJson(`https://embed.gog.com/account/getFilteredProducts?mediaType=1&page=${page}`, authHeader);
      if (pr.data?.products) allProducts.push(...pr.data.products);
    }

    const imported = [];
    const updated = [];
    const processedNames = new Set();
    let idx = 0;

    for (const gp of allProducts) {
      idx++;
      if (!gp.id) continue;
      const gogId = String(gp.id);
      const slug = gp.slug || gp.url?.split('/').pop() || '';
      const title = gp.title || gp.name || '';
      const canonical = canonicalize(title);
      if (processedNames.has(canonical)) continue;
      processedNames.add(canonical);

      const img = pickCoverImage(gp);
      const existing = findExisting(db, 'gog', gogId, title);
      const dlc = gp.isDlc || isDlcTitle(title);

      if (existing) {
        let changed = false;
        if (!existing.platformId) { existing.platformId = gogId; changed = true; }
        if (!existing.storeUrl && slug) { existing.storeUrl = `https://www.gog.com/en/game/${slug}`; changed = true; }
        if (!existing.coverUrl && img) { existing.coverUrl = img; changed = true; }
        if (dlc) {
          existing.editions = existing.editions || [];
          if (!existing.editions.includes(title)) { existing.editions.push(title); changed = true; }
        }
        if (changed) updated.push(existing.name);
      } else {
        db.games.push(makeGameEntry('gog', 'gog', {
          platformId: gogId,
          name: title,
          coverUrl: img,
          extra: {
            storeUrl: slug ? `https://www.gog.com/en/game/${slug}` : '',
            editions: dlc ? [title] : [],
            installed: false,
          },
        }));
        imported.push(title);
      }

      if (notify && (idx % 10 === 0)) notify({ status: 'progress', processed: idx, imported: imported.length, updated: updated.length });
    }

    updateAccountSync(db, saveDB, 'gog', allProducts.length);
    if (notify) notify({ status: 'done', processed: processedNames.size, imported: imported.length, updated: updated.length });
    return { imported, updated, total: allProducts.length, games: db.games };
  } catch (e) {
    return { error: 'GOG import failed: ' + e.message };
  }
}

async function validateKey(apiKey) {
  if (!apiKey) return { ok: false, error: 'no-key' };
  try {
    let res = await httpGetJson('https://embed.gog.com/account', { 'Authorization': 'Bearer ' + apiKey });
    if (res && res.status === 200 && res.data) return { ok: true, info: res.data };

    if (apiKey.includes('=')) {
      res = await httpGetJson('https://embed.gog.com/account', { 'Cookie': apiKey });
      if (res && res.status === 200 && res.data) return { ok: true, info: res.data };
    }

    return { ok: false, error: res && (res.data || res.raw) };
  } catch (e) { return { ok: false, error: e && e.message }; }
}

module.exports = { importLibrary, validateKey };
