// ─── Metadata Art Search (moved from main.js) ─────────────────────────────────
const { net, ipcMain, dialog, shell } = require('electron');
const crypto = require('crypto');
const ctx = require('./context');
const { getMetadataSettings, httpGet } = require('./metadata');
const { safeStore, validateProviderKey, summarizeSecret } = require('../main'); // TODO: move these to modules

function searchSteam(gameName) {
  const results = [];
  const q = encodeURIComponent(gameName);
  return httpGet(`https://store.steampowered.com/api/storesearch/?term=${q}&l=english&cc=US`).then(search => {
    if (search?.items?.length) {
      for (const item of search.items.slice(0, 3)) {
        const id = item.id;
        const name = item.name || '';
        try {
          const det = await httpGet(`https://store.steampowered.com/api/appdetails?appids=${id}&l=english`);
          const info = det?.[String(id)]?.data;
          if (info) {
            results.push({ url: `https://shared.steamstatic.com/store_item_assets/steam/apps/${id}/library_600x900_2x.jpg`, type: 'cover', source: 'Steam', label: name + ' - Portrait (HD)' });
            if (info.header_image) results.push({ url: info.header_image, type: 'header', source: 'Steam', label: name + ' - Header' });
            results.push({ url: `https://shared.steamstatic.com/store_item_assets/steam/apps/${id}/library_hero.jpg`, type: 'header', source: 'Steam', label: name + ' - Hero' });
            if (info.screenshots) {
              for (const ss of info.screenshots.slice(0, 2)) {
                results.push({ url: ss.path_full, type: 'screenshot', source: 'Steam', label: name + ' - Screenshot' });
              }
            }
          }
        } catch(e) {}
      }
    }
    return results;
  });
}

async function searchDuckDuckGo(gameName) {
  const results = [];
  const q = encodeURIComponent(gameName + ' video game');
  const ddg = await httpGet(`https://api.duckduckgo.com/?q=${q}&format=json&no_redirect=1`);
  if (ddg?.Image) {
    const ddgUrl = ddg.Image.startsWith('http') ? ddg.Image : 'https://duckduckgo.com' + ddg.Image;
    results.push({ url: ddgUrl, type: 'cover', source: 'DuckDuckGo', label: ddg.Heading || gameName });
  }
  if (ddg?.RelatedTopics) {
    for (const topic of ddg.RelatedTopics.slice(0, 4)) {
      if (topic?.Icon?.URL) {
        const iconUrl = topic.Icon.URL.startsWith('http') ? topic.Icon.URL : 'https://duckduckgo.com' + topic.Icon.URL;
        results.push({ url: iconUrl, type: 'screenshot', source: 'DuckDuckGo', label: (topic.Text || '').slice(0, 60) });
      }
    }
  }
  return results;
}

async function searchWikidata(gameName) {
  const results = [];
  const q = encodeURIComponent(gameName);
  const searchUrl = `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${q}&language=en&format=json&limit=3`;
  const searchData = await httpGet(searchUrl);
  if (searchData?.search?.length) {
    for (const entity of searchData.search.slice(0, 2)) {
      const desc = (entity.description || '').toLowerCase();
      if (desc && !desc.includes('game') && !desc.includes('video') && !desc.includes('software')) continue;
      try {
        const claimsUrl = `https://www.wikidata.org/w/api.php?action=wbgetclaims&entity=${entity.id}&property=P18&format=json`;
        const claims = await httpGet(claimsUrl);
        const imageClaims = claims?.claims?.P18;
        if (imageClaims?.length) {
          for (const claim of imageClaims.slice(0, 2)) {
            const filename = claim?.mainsnak?.datavalue?.value;
            if (filename) {
              const fn = filename.replace(/ /g, '_');
              const md5 = crypto.createHash('md5').update(fn).digest('hex');
              const fullUrl = `https://upload.wikimedia.org/wikipedia/commons/${md5[0]}/${md5[0]}${md5[1]}/${encodeURIComponent(fn)}`;
              const thumbUrl = `https://upload.wikimedia.org/wikipedia/commons/thumb/${md5[0]}/${md5[0]}${md5[1]}/${encodeURIComponent(fn)}/600px-${encodeURIComponent(fn)}`;
              results.push({ url: thumbUrl, type: 'header', source: 'Wikidata', label: entity.label + ' (Commons)' });
              results.push({ url: fullUrl, type: 'screenshot', source: 'Wikidata', label: entity.label + ' (Full)' });
            }
          }
        }
      } catch (e2) {}
    }
  }
  return results;
}

async function searchWikipedia(gameName) {
  const results = [];
  const q = encodeURIComponent(gameName + ' video game');
  const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${q}&srnamespace=0&srlimit=3&format=json`;
  const searchData = await httpGet(searchUrl);
  if (searchData?.query?.search?.length) {
    for (const r of searchData.query.search.slice(0, 2)) {
      const t = encodeURIComponent(r.title);
      try {
        const pgUrl = `https://en.wikipedia.org/w/api.php?action=query&titles=${t}&prop=pageimages&piprop=thumbnail|original&pithumbsize=600&format=json`;
        const pgData = await httpGet(pgUrl);
        const pages = pgData?.query?.pages;
        if (pages) {
          const pg = Object.values(pages)[0];
          if (pg?.thumbnail?.source) results.push({ url: pg.thumbnail.source, type: 'cover', source: 'Wikipedia', label: r.title });
          if (pg?.original?.source) results.push({ url: pg.original.source, type: 'header', source: 'Wikipedia', label: r.title + ' (Full)' });
        }
      } catch (e2) {}
      try {
        const imgUrl = `https://en.wikipedia.org/w/api.php?action=query&titles=${t}&prop=images&format=json`;
        const imgData = await httpGet(imgUrl);
        const pages = imgData?.query?.pages;
        if (pages) {
          const pg = Object.values(pages)[0];
          const articleImages = (pg.images || []).filter(i => {
            const n = i.title.toLowerCase();
            return (n.endsWith('.jpg') || n.endsWith('.png')) && !n.includes('logo') && !n.includes('icon') && !n.includes('symbol') && !n.includes('commons') && !n.includes('edit');
          });
          for (const img of articleImages.slice(0, 3)) {
            try {
              const infoUrl = `https://en.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(img.title)}&prop=imageinfo&iiprop=url&iiurlwidth=600&format=json`;
              const infoData = await httpGet(infoUrl);
              const infoPages = infoData?.query?.pages;
              if (infoPages) {
                const infoPg = Object.values(infoPages)[0];
                const ii = infoPg?.imageinfo?.[0];
                if (ii?.thumburl) results.push({ url: ii.thumburl, type: 'screenshot', source: 'Wikipedia', label: img.title.replace('File:', '') });
              }
            } catch (e3) {}
          }
        }
      } catch (e2) {}
    }
  }
  return results;
}

async function searchSteamGridDB(gameName, apiKey) {
  if (!apiKey) return [];
  const results = [];
  const q = encodeURIComponent(gameName);
  const sgdbFetch = async (endpoint) => {
    const resp = await net.fetch(endpoint, {
      headers: { 'Authorization': 'Bearer ' + apiKey },
    });
    if (!resp.ok) throw new Error('SGDB HTTP ' + resp.status);
    return resp.json();
  };
  const searchData = await sgdbFetch(`https://www.steamgriddb.com/api/v2/search/autocomplete/${q}`);
  if (!searchData?.success || !searchData?.data?.length) return results;
  const gameId = searchData.data[0].id;
  const gamLabel = searchData.data[0].name || gameName;
  const [portraitGrids, landscapeGrids, heroes, logos] = await Promise.allSettled([
    sgdbFetch(`https://www.steamgriddb.com/api/v2/grids/game/${gameId}?dimensions=600x900&limit=8`),
    sgdbFetch(`https://www.steamgriddb.com/api/v2/grids/game/${gameId}?dimensions=460x215,920x430&limit=4`),
    sgdbFetch(`https://www.steamgriddb.com/api/v2/heroes/game/${gameId}?limit=4`),
    sgdbFetch(`https://www.steamgriddb.com/api/v2/logos/game/${gameId}?limit=2`),
  ]);
  if (portraitGrids.status === 'fulfilled' && portraitGrids.value?.data) {
    for (const g of portraitGrids.value.data.slice(0, 8)) {
      if (g.url) results.push({ url: g.url, type: 'cover', source: 'SteamGridDB', label: gamLabel + ' - Cover' });
    }
  }
  if (landscapeGrids.status === 'fulfilled' && landscapeGrids.value?.data) {
    for (const g of landscapeGrids.value.data.slice(0, 4)) {
      if (g.url) results.push({ url: g.url, type: 'header', source: 'SteamGridDB', label: gamLabel + ' - Header' });
    }
  }
  if (heroes.status === 'fulfilled' && heroes.value?.data) {
    for (const h of heroes.value.data.slice(0, 4)) {
      if (h.url) results.push({ url: h.url, type: 'header', source: 'SteamGridDB', label: gamLabel + ' - Hero' });
    }
  }
  if (logos.status === 'fulfilled' && logos.value?.data) {
    for (const l of logos.value.data.slice(0, 2)) {
      if (l.url) results.push({ url: l.url, type: 'logo', source: 'SteamGridDB', label: gamLabel + ' - Logo' });
    }
  }
  return results;
}

async function handleSearchArt(event, gameName, platform) {
  if (!gameName) return { images: [] };
  const ms = getMetadataSettings();

  // Prefer SteamGridDB, but fall back to Steam store images when SGDB yields nothing
  const sgdb = await searchSteamGridDB(gameName, ms.steamGridDbKey).catch(e => { console.log('[ArtSearch] SteamGridDB failed:', e.message); return []; });
  const images = [];
  const seen = new Set();
  for (const img of sgdb) {
    if (img.url && !seen.has(img.url)) {
      seen.add(img.url);
      images.push(img);
    }
  }
  if (images.length === 0) {
    try {
      const steamImgs = await searchSteam(gameName).catch(e => { console.log('[ArtSearch] Steam fallback failed:', e && e.message); return []; });
      for (const img of steamImgs) {
        if (img.url && !seen.has(img.url)) {
          seen.add(img.url);
          images.push(img);
        }
      }
    } catch (e) {
      console.log('[ArtSearch] Steam fallback threw:', e && e.message);
    }
  }
  return { images };
}

function registerMetadataSearchHandlers() {
  ipcMain.handle('metadata:searchArt', handleSearchArt);
}

module.exports = {
  registerMetadataSearchHandlers,
  searchSteam,
  searchDuckDuckGo,
  searchWikidata,
  searchWikipedia,
  searchSteamGridDB,
};
