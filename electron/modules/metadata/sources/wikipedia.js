// ─── Wikipedia metadata source ───────────────────────────────────────────────
// Uses the MediaWiki API: search → query article extract + infobox wikitext.
// No API key, generous rate limits, multilingual fallback would be possible
// but we restrict to English for now.

const log = require('../../core/logger');
const { getJson } = require('../http');

const DESCRIPTION_MAX = 500;

function parseInfoboxField(wikitext, field) {
  const re = new RegExp('\\|\\s*' + field + '\\s*=\\s*(.+)', 'i');
  const m = wikitext.match(re);
  if (!m) return '';
  return m[1]
    .replace(/\[\[([^|\]]*\|)?([^\]]*)\]\]/g, '$2')
    .replace(/\{\{[^}]*\}\}/g, '')
    .replace(/<[^>]+>/g, '')
    .trim();
}

async function fetchByName(gameName) {
  if (!gameName) return null;
  try {
    const q = encodeURIComponent(gameName + ' video game');
    const searchUrl =
      `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${q}` +
      `&srnamespace=0&srlimit=5&format=json`;
    const searchData = await getJson(searchUrl);
    if (!searchData?.query?.search?.length) return null;

    const norm = gameName.toLowerCase().replace(/[^a-z0-9]/g, '');
    let bestTitle = searchData.query.search[0].title;
    for (const r of searchData.query.search) {
      const rNorm = r.title.toLowerCase().replace(/[^a-z0-9]/g, '').replace(/videogame$/, '');
      if (rNorm === norm) { bestTitle = r.title; break; }
    }

    const title = encodeURIComponent(bestTitle);
    const detailUrl =
      `https://en.wikipedia.org/w/api.php?action=query&titles=${title}` +
      `&prop=extracts|pageimages|revisions&exintro=true&explaintext=true` +
      `&pithumbsize=600&rvprop=content&rvslots=main&rvsection=0&format=json`;
    const detailData = await getJson(detailUrl);
    const pages = detailData?.query?.pages;
    if (!pages) return null;
    const page = Object.values(pages)[0];
    if (!page || page.missing !== undefined) return null;

    const extract = (page.extract || '').slice(0, DESCRIPTION_MAX);
    const thumbUrl = page.thumbnail?.source || '';

    const wikitext = page.revisions?.[0]?.slots?.main?.['*'] || '';
    const developer = parseInfoboxField(wikitext, 'developer');
    const publisher = parseInfoboxField(wikitext, 'publisher');
    const released =
      parseInfoboxField(wikitext, 'released') ||
      parseInfoboxField(wikitext, 'release_date');
    const genreRaw = parseInfoboxField(wikitext, 'genre');
    const genres = genreRaw
      ? genreRaw.split(/[,;]/).map(g => g.trim()).filter(Boolean).slice(0, 5)
      : [];

    if (!extract && !developer) return null;

    return {
      description: extract,
      developer,
      publisher,
      releaseDate: released.replace(/\{\{.*?\}\}/g, '').trim().slice(0, 30),
      genres,
      coverUrl: thumbUrl,
      headerUrl: '',
      screenshots: [],
      videoUrl: '',
      metacritic: null,
      website: `https://en.wikipedia.org/wiki/${title}`,
      _source: 'wikipedia',
    };
  } catch (e) {
    log.debug('metadata.wikipedia', 'fetch failed for', gameName, e.message);
    return null;
  }
}

module.exports = {
  fetchByName,
};
