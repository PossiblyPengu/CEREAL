const path = require('path');

// Load the native SMTC addon
const addon = require(path.join(__dirname, 'build', 'Release', 'smtc.node'));

module.exports = addon;
