const { httpGetJson } = require('./http');
const { findExisting, makeGameEntry, updateAccountSync, canonicalize } = require('./utils');
const xcloudCatalog = require('./xcloudCatalog');

// titlehub decorations we request. Notes on each:
//   GamePass       — `gamePass.isGamePass` flag (currently included in GP)
//   Achievement    — earned/total achievement counts (we surface these in UI)
//   Image          — display/background art
//   Detail         — release date, dev/publisher, capabilities
//   ServiceConfigId, ProductId — *intended* to surface bigCatalog product IDs
//                    but XBL's modern titlehub doesn't always honour these. We
//                    fall back to fuzzy name matching against the xCloud
//                    catalog for any title that doesn't ship a productId.
const TITLEHUB_DECORATIONS = 'GamePass,Achievement,Image,Detail';

async function importLibrary({ db, saveDB }) {
  const acct = (db.accounts || {}).xbox;
  if (!acct?.xuid && !acct?.msAccessToken) return { error: 'Xbox account not connected' };
  try {
    const xAuth = 'XBL3.0 x=' + acct.userHash + ';' + acct.xstsToken;
    const r = await httpGetJson(
      `https://titlehub.xboxlive.com/users/xuid(${acct.xuid})/titles/titlehistory/decoration/${TITLEHUB_DECORATIONS}`,
      { 'Authorization': xAuth, 'x-xbl-contract-version': '2', 'Accept-Language': 'en-US' }
    );
    const titles = r.data?.titles || [];

    // Resolve the cloud-streaming catalog in parallel with title processing.
    // A network failure here just means we can't enrich xcloudPlayable on this
    // run — the import itself still succeeds.
    let cloudCatalog = null;
    try { cloudCatalog = await xcloudCatalog.ensureCatalog(); }
    catch (_e) { /* import without cloud enrichment */ }

    const imported = [];
    const updated = [];
    let cloudPlayableCount = 0;
    let gamePassCount = 0;

    for (const t of titles) {
      if (!t.titleId || t.type === 'App' || t.type === 'WebApp') continue;
      const titleId = String(t.titleId);
      const name = t.name || 'Unknown';
      const imgUrl = t.displayImage || (t.images && t.images[0] && t.images[0].url) || '';
      const lastPlayed = t.titleHistory?.lastTimePlayed || null;
      const minutesPlayed = t.titleHistory?.totalMinutesPlayed || 0;
      const gamePassIncluded = !!(t.gamePass?.isGamePass);
      const productId = t.productId || t.detail?.productId || '';

      // Cross-reference with the cloud catalog to decide if the user can
      // actually stream this title via Xbox Cloud Gaming.
      const probe = { name, platformId: titleId, productId };
      const match = cloudCatalog ? xcloudCatalog.matchGame(probe, cloudCatalog) : null;
      const xcloudPlayable = !!match;
      const xcloudProductId = match?.productId || (productId || '');
      const xcloudSlug = match?.slug || '';

      if (gamePassIncluded) gamePassCount++;
      if (xcloudPlayable) cloudPlayableCount++;

      const existing = findExisting(db, 'xbox', titleId, name);

      if (existing) {
        let changed = false;
        if (!existing.platformId) { existing.platformId = titleId; changed = true; }
        if (minutesPlayed > (existing.playtimeMinutes || 0)) { existing.playtimeMinutes = minutesPlayed; changed = true; }
        if (!existing.coverUrl && imgUrl) { existing.coverUrl = imgUrl; changed = true; }
        if (lastPlayed && (!existing.lastPlayed || new Date(lastPlayed) > new Date(existing.lastPlayed))) {
          existing.lastPlayed = lastPlayed; changed = true;
        }
        // xCloud / Game Pass flags are mutable — refresh them every import so
        // we reflect titles entering/leaving Game Pass without forcing a
        // re-add.
        if (existing.xcloudPlayable !== xcloudPlayable) { existing.xcloudPlayable = xcloudPlayable; changed = true; }
        if (xcloudProductId && existing.xcloudProductId !== xcloudProductId) {
          existing.xcloudProductId = xcloudProductId; changed = true;
        }
        if (xcloudSlug && existing.xcloudSlug !== xcloudSlug) { existing.xcloudSlug = xcloudSlug; changed = true; }
        if (existing.gamePassIncluded !== gamePassIncluded) { existing.gamePassIncluded = gamePassIncluded; changed = true; }
        // Crucially, when the existing row was auto-detected from
        // `C:\XboxGames\` we DON'T overwrite `installPath` / `xboxAumid` /
        // `installed: true` here — the local-launch metadata is more useful
        // than the remote-only fields, and the launch path prefers AUMID
        // when present. (scanXboxInstalled stamps those; we just preserve.)
        if (changed) updated.push(existing.name);
      } else {
        db.games.push(makeGameEntry('xbox', 'xbox', {
          platformId: titleId,
          name,
          coverUrl: imgUrl,
          playtimeMinutes: minutesPlayed,
          lastPlayed,
          extra: {
            xcloudPlayable,
            xcloudProductId,
            xcloudSlug,
            gamePassIncluded,
          },
        }));
        imported.push(name);
      }
    }

    const gameCount = titles.filter(t => t.type !== 'App' && t.type !== 'WebApp').length;

    // Persist account-level summary so the Platforms panel can show "X of Y
    // cloud-playable" without re-walking the library.
    if (!db.accounts) db.accounts = {};
    if (!db.accounts.xbox) db.accounts.xbox = {};
    db.accounts.xbox.cloudPlayableCount = cloudPlayableCount;
    db.accounts.xbox.gamePassCount = gamePassCount;

    updateAccountSync(db, saveDB, 'xbox', gameCount);
    return {
      imported,
      updated,
      total: titles.length,
      cloudPlayable: cloudPlayableCount,
      gamePass: gamePassCount,
      games: db.games,
    };
  } catch (e) {
    return { error: 'Import failed: ' + e.message };
  }
}

// Walk an existing library and re-evaluate cloud-playable status without
// re-importing from Xbox Live. Cheap path for users who just want to refresh
// "what's on Game Pass cloud right now?"
async function refreshCloudAvailability({ db, saveDB }) {
  let catalog;
  try { catalog = await xcloudCatalog.ensureCatalog({ force: true }); }
  catch (e) { return { error: 'Catalog fetch failed: ' + e.message }; }
  if (!catalog) return { error: 'Catalog unavailable' };

  let touched = 0;
  let cloudPlayableCount = 0;
  for (const g of db.games) {
    if (g.platform !== 'xbox') continue;
    const match = xcloudCatalog.matchGame({
      name: g.name,
      platformId: g.platformId,
      productId: g.xcloudProductId,
    }, catalog);
    const xcloudPlayable = !!match;
    if (xcloudPlayable) cloudPlayableCount++;
    if (g.xcloudPlayable !== xcloudPlayable) { g.xcloudPlayable = xcloudPlayable; touched++; }
    if (match?.productId && g.xcloudProductId !== match.productId) {
      g.xcloudProductId = match.productId; touched++;
    }
    if (match?.slug && g.xcloudSlug !== match.slug) {
      g.xcloudSlug = match.slug; touched++;
    }
  }
  if (!db.accounts) db.accounts = {};
  if (!db.accounts.xbox) db.accounts.xbox = {};
  db.accounts.xbox.cloudPlayableCount = cloudPlayableCount;
  if (touched > 0) saveDB(db);
  return { touched, cloudPlayable: cloudPlayableCount, total: catalog.productIds.size };
}

async function validateKey(apiKey) {
  if (!apiKey) return { ok: false, error: 'no-key' };
  try {
    const url = 'https://profile.xboxlive.com/users/me/profile/settings?settings=GameDisplayPicRaw';
    const res = await httpGetJson(url, { 'Authorization': apiKey, 'x-xbl-contract-version': '3' });
    if (res && res.status === 200 && res.data) return { ok: true, info: res.data };
    const res2 = await httpGetJson(url, { 'Authorization': 'Bearer ' + apiKey, 'x-xbl-contract-version': '3' });
    if (res2 && res2.status === 200 && res2.data) return { ok: true, info: res2.data };
    return { ok: false, error: (res && (res.data || res.raw)) || (res2 && (res2.data || res2.raw)) };
  } catch (e) { return { ok: false, error: e && e.message }; }
}

// Resolve a launch URL for an arbitrary game (Cereal entry). Returns null if
// the title isn't cloud-streamable.
async function resolveCloudLaunchUrl(game) {
  if (!game) return null;
  if (game.xcloudProductId) {
    // Trust persisted data if it already has a productId; just build the URL.
    const fakeMatch = { productId: game.xcloudProductId, slug: game.xcloudSlug || 'game' };
    return xcloudCatalog.buildLaunchUrl(fakeMatch);
  }
  let catalog;
  try { catalog = await xcloudCatalog.ensureCatalog(); }
  catch (_e) { return null; }
  const match = xcloudCatalog.matchGame({
    name: game.name,
    platformId: game.platformId,
    productId: game.xcloudProductId,
  }, catalog);
  return match ? xcloudCatalog.buildLaunchUrl(match) : null;
}

module.exports = { importLibrary, refreshCloudAvailability, validateKey, resolveCloudLaunchUrl, canonicalize };
