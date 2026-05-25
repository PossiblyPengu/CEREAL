// ─── Shared HTTP helpers for metadata + art ──────────────────────────────────
// Single home for all outgoing metadata HTTP calls. Consolidates what was
// previously three near-duplicates in metadata.js (getJson w/ Chrome UA),
// gameArt.js (sgdbGetJson w/ Bearer), and covers.js (downloadUrlToFile).

const fs = require('fs');
const { net } = require('electron');

const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const DEFAULT_TIMEOUT_MS = 15_000;

function abortAfter(ms) {
  if (typeof AbortController === 'undefined') return { signal: undefined, cancel: () => {} };
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  return { signal: ctl.signal, cancel: () => clearTimeout(t) };
}

async function fetchWithTimeout(url, init = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const { signal, cancel } = abortAfter(timeoutMs);
  try {
    const headers = { 'User-Agent': DEFAULT_UA, ...(init.headers || {}) };
    return await net.fetch(url, { ...init, headers, signal });
  } finally {
    cancel();
  }
}

function httpError(resp, url) {
  const err = new Error('HTTP ' + resp.status + ' from ' + url);
  err.status = resp.status;
  err.url = url;
  return err;
}

/** GET a URL and parse JSON. Throws on non-2xx. */
async function getJson(url, { headers, timeoutMs } = {}) {
  const resp = await fetchWithTimeout(
    url,
    { headers: { Accept: 'application/json, text/json, */*', ...(headers || {}) } },
    timeoutMs,
  );
  if (!resp.ok) throw httpError(resp, url);
  const text = await resp.text();
  try {
    return JSON.parse(text);
  } catch (e) {
    const err = new Error('Invalid JSON from ' + url + ': ' + e.message);
    err.url = url;
    throw err;
  }
}

/** HEAD probe a URL — returns true on 2xx, false on anything else (no throw). */
async function head(url, { timeoutMs } = {}) {
  try {
    const resp = await fetchWithTimeout(url, { method: 'HEAD' }, timeoutMs);
    return resp.ok;
  } catch (_e) {
    return false;
  }
}

/**
 * Download `url` to `destPath`. Rejects if response is non-2xx or body is
 * smaller than `minBytes` (default 1 KB — guards against CDN placeholder pixels).
 */
async function downloadToFile(url, destPath, { minBytes = 1024, timeoutMs = 30_000 } = {}) {
  const resp = await fetchWithTimeout(url, {}, timeoutMs);
  if (!resp.ok) throw httpError(resp, url);
  const buf = Buffer.from(await resp.arrayBuffer());
  if (buf.length < minBytes) {
    const err = new Error('File too small (' + buf.length + ' bytes)');
    err.url = url;
    throw err;
  }
  fs.writeFileSync(destPath, buf);
  return true;
}

module.exports = {
  DEFAULT_UA,
  DEFAULT_TIMEOUT_MS,
  fetchWithTimeout,
  getJson,
  head,
  downloadToFile,
};
