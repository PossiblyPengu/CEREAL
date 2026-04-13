// ─── HTTP utilities using Electron's net.fetch ─────────────────────────────────
// net.fetch provides: redirect following, HTTP/2, proxy support, decompression.
// Falls back to Node.js https before app.whenReady() (module load time only).
const { net } = require('electron');

const UA = 'CerealLauncher/1.0';
const DEFAULT_TIMEOUT = 15000; // 15s network timeout

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('Request timed out')), ms)),
  ]);
}

async function httpGet(url, headers) {
  const res = await withTimeout(net.fetch(url, {
    headers: { 'User-Agent': UA, ...(headers || {}) },
  }), DEFAULT_TIMEOUT);
  const raw = await res.text();
  return { status: res.status, raw };
}

async function httpGetJson(url, headers) {
  const res = await withTimeout(net.fetch(url, {
    headers: { 'User-Agent': UA, ...(headers || {}) },
  }), DEFAULT_TIMEOUT);
  const raw = await res.text();
  try { return { status: res.status, data: JSON.parse(raw) }; }
  catch (_e) { return { status: res.status, data: null, raw }; }
}

async function httpPost(url, body, headers) {
  const postData = typeof body === 'string' ? body : new URLSearchParams(body).toString();
  const contentType = (typeof body === 'string' && body.startsWith('{'))
    ? 'application/json'
    : 'application/x-www-form-urlencoded';
  const res = await withTimeout(net.fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': contentType,
      'User-Agent': UA,
      ...(headers || {}),
    },
    body: postData,
  }), DEFAULT_TIMEOUT);
  const raw = await res.text();
  try { return { status: res.status, data: JSON.parse(raw) }; }
  catch (_e) { return { status: res.status, data: null, raw }; }
}

module.exports = { httpGet, httpGetJson, httpPost };
