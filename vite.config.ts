import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron'
import renderer from 'vite-plugin-electron-renderer'
import path from 'path'
import fs from 'fs'
import { spawnSync } from 'child_process'

function copyElectronProviders() {
  return {
    name: 'copy-electron-providers',
    closeBundle() {
      const src = path.resolve(__dirname, 'electron/providers')
      const dest = path.resolve(__dirname, 'dist-electron/providers')
      fs.cpSync(src, dest, { recursive: true })
      copyScripts()
      copyMediaInfoExe()
    },
    buildStart() {
      const src = path.resolve(__dirname, 'electron/providers')
      const dest = path.resolve(__dirname, 'dist-electron/providers')
      if (fs.existsSync(src)) fs.cpSync(src, dest, { recursive: true })
      copyScripts()
      copyMediaInfoExe()
    },
  }
}

function copyScripts() {
  const src = path.resolve(__dirname, 'electron/scripts')
  const dest = path.resolve(__dirname, 'dist-electron/scripts')
  if (fs.existsSync(src)) fs.cpSync(src, dest, { recursive: true })
}

function copyMediaInfoExe() {
  const src = path.resolve(__dirname, 'electron/native/MediaInfoTool/publish/MediaInfoTool.exe')
  const dest = path.resolve(__dirname, 'dist-electron/native/MediaInfoTool.exe')
  if (fs.existsSync(src)) {
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    // Try a few times to copy the EXE. If it's locked by a lingering process, attempt to kill it first (Windows only).
    const attempts = 3
    for (let i = 0; i < attempts; i++) {
      try {
        fs.copyFileSync(src, dest)
        break
      } catch (err: any) {
        const code = err && err.code ? err.code : ''
        if ((code === 'EBUSY' || code === 'EPERM' || code === 'EACCES') && process.platform === 'win32') {
          try { spawnSync('taskkill', ['/IM', 'MediaInfoTool.exe', '/F'], { stdio: 'ignore' }); } catch (_e) { /* ignore */ }
          // small pause before retry
          try { spawnSync('powershell', ['-NoProfile', '-Command', 'Start-Sleep -Milliseconds 150'], { stdio: 'ignore' }); } catch (_e) { /* ignore */ }
          if (i === attempts - 1) throw err
          continue
        }
        throw err
      }
    }
  }
  // Also copy smtc/*.js so they're available as runtime modules
  const smtcFiles = ['index.js', 'powershell-bridge.js']
  for (const file of smtcFiles) {
    const smtcSrc = path.resolve(__dirname, 'electron/native/smtc', file)
    const smtcDest = path.resolve(__dirname, 'dist-electron/native/smtc', file)
    if (fs.existsSync(smtcSrc)) {
      fs.mkdirSync(path.dirname(smtcDest), { recursive: true })
      fs.copyFileSync(smtcSrc, smtcDest)
    }
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    electron([
      {
        // Main process entry
        entry: 'electron/main.js',
        vite: {
          build: {
            outDir: 'dist-electron',
            lib: { entry: 'electron/main.js', formats: ['cjs'] },
            rollupOptions: {
              external: [
                'electron', 'electron-updater', 'discord-rpc',
                'node-gyp-build', 'better-sqlite3',
                /^node:/,
                /^\.\/providers/,
                /^\.\/native/,
              ],
            },
          },
        },
      },
      {
        // Preload script
        entry: 'electron/preload.js',
        onstart(options) {
          options.reload()
        },
        vite: {
          build: {
            outDir: 'dist-electron',
            lib: { entry: 'electron/preload.js', formats: ['cjs'] },
          },
        },
      },
    ]),
    renderer(),
    copyElectronProviders(),
  ],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/react') || id.includes('node_modules/react-dom')) {
            return 'vendor-react';
          }
        },
      },
    },
  },
})
