const https = require('https');

function httpGetJson(url, headers) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'CerealLauncher/1.0', ...(headers || {}) } }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
        catch (e) { resolve({ status: res.statusCode, data: null, raw: data }); }
      });
    }).on('error', e => reject(e));
  });
}

async function validateKey(apiKey) {
  if (!apiKey) return { ok: false, error: 'no-key' };
  try {
    const url = 'https://www.steamgriddb.com/api/v2/users/me';
    const res = await httpGetJson(url, { Authorization: 'Bearer ' + apiKey });
    if (res && res.status === 200 && res.data && res.data.data) return { ok: true, info: res.data.data };
    return { ok: false, error: res && (res.data || res.raw) };
  } catch (err) {
    return { ok: false, error: err && err.message };
  }
}

module.exports = { validateKey };
