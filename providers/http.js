const https = require('https');

const UA = 'CerealLauncher/1.0';

const DEFAULT_TIMEOUT = 15000; // 15s network timeout so imports don't hang forever

function attachTimeout(req, reject) {
  req.setTimeout(DEFAULT_TIMEOUT, () => {
    req.destroy(new Error('Request timed out'));
    reject(new Error('Request timed out'));
  });
}

function httpGet(url, headers) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': UA, ...(headers || {}) } }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, raw: data }));
    });
    req.on('error', e => reject(e));
    attachTimeout(req, reject);
  });
}

function httpGetJson(url, headers) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': UA, ...(headers || {}) } }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
        catch (e) { resolve({ status: res.statusCode, data: null, raw: data }); }
      });
    });
    req.on('error', e => reject(e));
    attachTimeout(req, reject);
  });
}

function httpPost(url, body, headers) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const postData = typeof body === 'string' ? body : new URLSearchParams(body).toString();
    const contentType = (typeof body === 'string' && body.startsWith('{'))
      ? 'application/json'
      : 'application/x-www-form-urlencoded';
    const req = https.request({
      hostname: u.hostname,
      port: u.port || 443,
      path: u.pathname + u.search,
      method: 'POST',
      headers: {
        'Content-Type': contentType,
        'Content-Length': Buffer.byteLength(postData),
        'User-Agent': UA,
        ...(headers || {}),
      },
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
        catch (e) { resolve({ status: res.statusCode, data: null, raw: data }); }
      });
    });
    req.on('error', e => reject(e));
    attachTimeout(req, reject);
    req.write(postData);
    req.end();
  });
}

module.exports = { httpGet, httpGetJson, httpPost };
