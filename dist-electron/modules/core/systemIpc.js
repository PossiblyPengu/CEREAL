// System-level IPC: hardware specs used by the startup wizard's "recommended
// settings" engine. Kept separate from windowIpc.js because this is purely
// informational and doesn't touch app windows.

const os = require('os');
const { app, ipcMain } = require('electron');
const log = require('./logger');

function registerSystemIpc() {
  ipcMain.handle('system:getSpecs', async () => {
    const ramGb = Math.round(os.totalmem() / (1024 * 1024 * 1024));
    const cpus = os.cpus();
    const cpuCount = cpus.length;
    const cpuModel = cpus[0]?.model?.trim() || '';

    let gpuName = '';
    try {
      const gpuInfo = await app.getGPUInfo('basic');
      const gpu = gpuInfo?.gpuDevice?.[0];
      if (gpu?.description) gpuName = gpu.description;
    } catch (e) {
      log.debug('system', 'GPU info unavailable', e);
    }

    return {
      ramGb,
      cpuCount,
      cpuModel,
      gpuName,
      platform: process.platform,
      arch: process.arch,
    };
  });
}

module.exports = { registerSystemIpc };
