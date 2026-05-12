// Local-image protocol handler.
//
// The renderer loads from http:// in dev mode, where file:// URLs are blocked
// by Chromium's same-origin policy. This custom scheme serves cover/header art
// that lives in our local covers directory while preventing arbitrary path
// traversal.
//
// URL format: local-image:///C:/Users/me/AppData/Roaming/cereal/covers/foo.jpg

const path = require('path');
const { protocol, net } = require('electron');
const { getCoversDir } = require('../games/covers');

function registerLocalImageProtocol() {
  protocol.handle('local-image', (request) => {
    let filePath = decodeURIComponent(new URL(request.url).pathname);
    // Strip leading slash from /C:/... on Windows so path.resolve doesn't keep it.
    if (process.platform === 'win32' && filePath.startsWith('/')) filePath = filePath.slice(1);

    // Security: only files inside the covers directory are reachable. Any
    // attempt to traverse out (../../foo) resolves to a path that fails this
    // prefix check.
    const coversDir = path.resolve(getCoversDir());
    const resolved = path.resolve(filePath);
    const prefix = coversDir + path.sep;
    const inside = process.platform === 'win32'
      ? (resolved.toLowerCase().startsWith(prefix.toLowerCase()) || resolved.toLowerCase() === coversDir.toLowerCase())
      : (resolved.startsWith(prefix) || resolved === coversDir);
    if (!inside) {
      return new Response('Forbidden', { status: 403 });
    }
    return net.fetch('file:///' + resolved.replace(/\\/g, '/'));
  });
}

module.exports = { registerLocalImageProtocol };
