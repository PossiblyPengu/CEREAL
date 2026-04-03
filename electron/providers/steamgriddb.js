const { httpGetJson } = require('./http');

async function validateKey(apiKey) {
  if (!apiKey) return { ok: false, error: 'no-key' };
  try {
    // Use a known game lookup (Half-Life 2, Steam ID 220) — the /users/me endpoint doesn't exist
    const url = 'https://www.steamgriddb.com/api/v2/games/steam/220';
    const res = await httpGetJson(url, { Authorization: 'Bearer ' + apiKey });
    if (res && res.status === 200 && res.data && res.data.success) return { ok: true, info: res.data.data };
    const errBody = res && res.data;
    const errMsg = (errBody && (errBody.errors?.[0] || errBody.message || errBody.error)) ||
      (res && res.status ? 'HTTP ' + res.status : null) || 'invalid key';
    return { ok: false, error: typeof errMsg === 'string' ? errMsg : JSON.stringify(errMsg) };
  } catch (err) {
    return { ok: false, error: err && err.message };
  }
}

module.exports = { validateKey };
