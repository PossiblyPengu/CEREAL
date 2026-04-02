const { httpGetJson } = require('./http');
const { refreshXboxTokens } = require('./auth');
const { findExisting, makeGameEntry, updateAccountSync } = require('./utils');

async function importLibrary({ db, saveDB }) {
  const acct = (db.accounts || {}).xbox;
  if (!acct?.xuid && !acct?.msAccessToken) return { error: 'Xbox account not connected' };
  try {
    if (acct.msExpiresAt && Date.now() > acct.msExpiresAt - 60000) {
      if (!acct.msRefreshToken) return { error: 'Token expired. Please sign in again.' };
      const tokens = await refreshXboxTokens(acct.msRefreshToken);
      if (!tokens) return { error: 'Token expired. Please sign in again.' };
      Object.assign(acct, tokens);
      saveDB(db);
    }
    const xAuth = 'XBL3.0 x=' + acct.userHash + ';' + acct.xstsToken;
    const r = await httpGetJson(
      `https://titlehub.xboxlive.com/users/xuid(${acct.xuid})/titles/titlehistory/decoration/GamePass,Achievement,Image`,
      { 'Authorization': xAuth, 'x-xbl-contract-version': '2', 'Accept-Language': 'en-US' }
    );
    const titles = r.data?.titles || [];
    const imported = [];
    const updated = [];

    for (const t of titles) {
      if (!t.titleId || t.type === 'App' || t.type === 'WebApp') continue;
      const titleId = String(t.titleId);
      const name = t.name || 'Unknown';
      const imgUrl = t.displayImage || (t.images && t.images[0] && t.images[0].url) || '';
      const lastPlayed = t.titleHistory?.lastTimePlayed || null;
      const minutesPlayed = t.titleHistory?.totalMinutesPlayed || 0;
      const existing = findExisting(db, 'xbox', titleId, name);

      if (existing) {
        let changed = false;
        if (!existing.platformId) { existing.platformId = titleId; changed = true; }
        if (minutesPlayed > (existing.playtimeMinutes || 0)) { existing.playtimeMinutes = minutesPlayed; changed = true; }
        if (!existing.coverUrl && imgUrl) { existing.coverUrl = imgUrl; changed = true; }
        if (lastPlayed && (!existing.lastPlayed || new Date(lastPlayed) > new Date(existing.lastPlayed))) { existing.lastPlayed = lastPlayed; changed = true; }
        if (changed) updated.push(existing.name);
      } else {
        db.games.push(makeGameEntry('xbox', 'xbox', {
          platformId: titleId,
          name,
          coverUrl: imgUrl,
          playtimeMinutes: minutesPlayed,
          lastPlayed,
        }));
        imported.push(name);
      }
    }

    const gameCount = titles.filter(t => t.type !== 'App' && t.type !== 'WebApp').length;
    updateAccountSync(db, saveDB, 'xbox', gameCount);
    return { imported, updated, total: titles.length, games: db.games };
  } catch (e) {
    return { error: 'Import failed: ' + e.message };
  }
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

module.exports = { importLibrary, validateKey };
