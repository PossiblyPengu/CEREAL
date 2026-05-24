// ─── HTTP utilities ──────────────────────────────────────────────────────────
// Default flow uses Electron's net.fetch (redirect following, HTTP/2, proxy
// support, decompression).
//
// XBL.signin and the rest of *.xboxlive.com sit behind an edge layer that
// blocks Chromium-fingerprinted traffic with a 403 (empty body). Reference
// libraries — xboxreplay/xboxlive-auth, OpenXBL, Heroic's nile/legendary
// integration — all use Node's plain https module which negotiates a different
// TLS handshake. We expose `httpPostNode` for those callers; everything else
// keeps using net.fetch.
const { net } = require('electron');
const https = require('node:https');
const { URL } = require('node:url');

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

// Node-https POST. Use this for endpoints that reject Chromium's TLS/HTTP
// fingerprint (specifically *.xboxlive.com — see module header).
function httpPostNode(url, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const postData = typeof body === 'string' ? body : new URLSearchParams(body).toString();
    const req = https.request({
      protocol: u.protocol,
      hostname: u.hostname,
      port: u.port || 443,
      path: u.pathname + u.search,
      method: 'POST',
      headers: {
        'Content-Length': Buffer.byteLength(postData),
        ...headers,
      },
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        try { resolve({ status: res.statusCode, data: JSON.parse(raw), raw }); }
        catch (_e) { resolve({ status: res.statusCode, data: null, raw }); }
      });
    });
    req.on('error', reject);
    req.setTimeout(DEFAULT_TIMEOUT, () => { req.destroy(new Error('Request timed out')); });
    req.write(postData);
    req.end();
  });
}

module.exports = { httpGet, httpGetJson, httpPost, httpPostNode };
