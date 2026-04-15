// ─── Lightweight debug logger ──────────────────────────────────────────────────
// Set CEREAL_DEBUG=1 to enable verbose debug output.
// info/warn/error always print. debug() is gated behind the env flag.
// In packaged builds all levels are also written to app.getPath('logs').

const path = require('path');
const fs   = require('fs');
const { app } = require('electron');

const DEBUG = process.env.CEREAL_DEBUG === '1';

// Lazily resolved so app.getPath() is never called before app is ready.
let _logFile = null;
function getLogFile() {
  if (_logFile !== null) return _logFile;
  if (!app.isPackaged) { _logFile = false; return false; }
  try {
    const dir = app.getPath('logs');
    fs.mkdirSync(dir, { recursive: true });
    const date = new Date().toISOString().slice(0, 10);
    _logFile = path.join(dir, `cereal-${date}.log`);
  } catch (_e) { _logFile = false; }
  return _logFile;
}

function writeLine(level, tag, args) {
  const f = getLogFile();
  if (!f) return;
  try {
    const ts  = new Date().toISOString();
    const msg = args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
    fs.appendFileSync(f, `${ts} [${level}] [${tag}] ${msg}\n`);
  } catch (_e) { /* can't log the logger */ }
}

function info(tag, ...args)  { console.log(`[${tag}]`, ...args);   writeLine('INFO',  tag, args); }
function warn(tag, ...args)  { console.warn(`[${tag}]`, ...args);  writeLine('WARN',  tag, args); }
function error(tag, ...args) { console.error(`[${tag}]`, ...args); writeLine('ERROR', tag, args); }
function debug(tag, ...args) { if (!DEBUG) return; console.log(`[${tag}]`, ...args); writeLine('DEBUG', tag, args); }

module.exports = { info, warn, error, debug, DEBUG };
