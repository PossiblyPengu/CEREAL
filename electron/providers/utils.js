function stripEdition(name) {
  if (!name) return '';
  return name
    .replace(/\s*[-–:]\s*(Deluxe|Ultimate|Year One|Gold|Collector's|Special|Limited|Complete|Season Pass|DLC).*/i, '')
    .replace(/\s*\(.*(Deluxe|Edition|DLC|Season Pass).*\)\s*/i, '')
    .trim();
}

function canonicalize(name) {
  if (!name) return '';
  return stripEdition(String(name)).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function isDlcTitle(title, metadata) {
  if (/\b(dlc|season pass|expansion|add-?on)\b/i.test(title)) return true;
  if (metadata && /dlc|expansion/i.test(JSON.stringify(metadata))) return true;
  return false;
}

function findExisting(db, platform, platformId, name) {
  const canonical = canonicalize(name);
  return db.games.find(g => {
    if (g.platform !== platform) return false;
    if (g.platformId && g.platformId === platformId) return true;
    if (g.name && canonicalize(g.name) === canonical) return true;
    return false;
  });
}

function makeGameEntry(platform, idPrefix, fields) {
  return {
    id: `${idPrefix}_${fields.platformId || canonicalize(fields.name || '').replace(/\s+/g, '_')}_${Date.now()}`,
    name: fields.name || 'Unknown',
    platform,
    platformId: fields.platformId || '',
    coverUrl: fields.coverUrl || '',
    headerUrl: fields.headerUrl || '',
    categories: [],
    playtimeMinutes: fields.playtimeMinutes || 0,
    lastPlayed: fields.lastPlayed || null,
    addedAt: new Date().toISOString(),
    favorite: false,
    ...fields.extra,
  };
}

function updateAccountSync(db, saveDB, platform, gameCount) {
  if (!db.accounts) db.accounts = {};
  if (!db.accounts[platform]) db.accounts[platform] = {};
  db.accounts[platform].lastSync = new Date().toISOString();
  db.accounts[platform].gameCount = gameCount;
  saveDB(db);
}

module.exports = {
  stripEdition,
  canonicalize,
  isDlcTitle,
  findExisting,
  makeGameEntry,
  updateAccountSync,
};
