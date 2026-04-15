// Shared mutable context — populated by main.js after initialization.
// Other modules `require` this file to access db, mainWindow, etc.
// without creating circular dependencies.

module.exports = {
  /** @type {any} */ db: null,
  /** @type {import('electron').BrowserWindow|null} */ mainWindow: null,
  /** @type {Function} */ saveDB: null,
  /** @type {Function} */ flushDB: null,
  /** @type {Function} */ sendToRenderer: null,
  /** @type {object} */ safeStore: null,
};
