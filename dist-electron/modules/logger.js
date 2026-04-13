// ─── Lightweight debug logger ──────────────────────────────────────────────────
// Set CEREAL_DEBUG=1 to enable verbose debug output.
// info/warn/error always print. debug() is gated behind the env flag.

const DEBUG = process.env.CEREAL_DEBUG === '1';

function info(tag, ...args)  { console.log(`[${tag}]`, ...args); }
function warn(tag, ...args)  { console.warn(`[${tag}]`, ...args); }
function error(tag, ...args) { console.error(`[${tag}]`, ...args); }
function debug(tag, ...args) { if (DEBUG) console.log(`[${tag}]`, ...args); }

module.exports = { info, warn, error, debug, DEBUG };
