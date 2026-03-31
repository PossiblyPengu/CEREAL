const smtc = require('./build/Release/smtc.node');

module.exports = {
  getMediaInfo: () => smtc.getMediaInfo(),
  sendMediaKey: (action) => smtc.sendMediaKey(action)
};
