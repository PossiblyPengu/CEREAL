// ─── Shared Constants ─────────────────────────────────────────────────────────
const path = require('path');

const CONTROL_BAR_HEIGHT = 40;

const ALLOWED_KEY_SERVICES = [
  'cereal-steam', 'cereal-steamgriddb', 'cereal-itchio',
  'cereal-account-steam', 'cereal-account-gog', 'cereal-account-epic',
  'cereal-account-xbox', 'cereal-account-ea', 'cereal-account-battlenet',
  'cereal-account-itchio', 'cereal-account-ubisoft', 'cereal-account-psn',
];

const CHIAKI_SYSTEM_PATHS = [
  path.join(process.env.ProgramFiles || '', 'chiaki-ng', 'chiaki.exe'),
  path.join(process.env['ProgramFiles(x86)'] || '', 'chiaki-ng', 'chiaki.exe'),
  path.join(process.env.LOCALAPPDATA || '', 'chiaki-ng', 'chiaki.exe'),
];

const ACCOUNT_SECRET_FIELDS = [
  'accessToken', 'refreshToken',
  'msAccessToken', 'msRefreshToken',
  'xblToken', 'xstsToken',
  'userHash',
];

module.exports = {
  CONTROL_BAR_HEIGHT,
  ALLOWED_KEY_SERVICES,
  CHIAKI_SYSTEM_PATHS,
  ACCOUNT_SECRET_FIELDS,
};
