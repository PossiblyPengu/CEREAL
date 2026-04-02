import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron'
import renderer from 'vite-plugin-electron-renderer'
import path from 'path'
import fs from 'fs'

function copyElectronProviders() {
  return {
    name: 'copy-electron-providers',
    closeBundle() {
      const src = path.resolve(__dirname, 'electron/providers')
      const dest = path.resolve(__dirname, 'dist-electron/providers')
      fs.cpSync(src, dest, { recursive: true })
      copyMediaInfoExe()
      copyPublicResources()
    },
    buildStart() {
      const src = path.resolve(__dirname, 'electron/providers')
      const dest = path.resolve(__dirname, 'dist-electron/providers')
      if (fs.existsSync(src)) fs.cpSync(src, dest, { recursive: true })
      copyMediaInfoExe()
      copyPublicResources()
    },
  }
}

function copyMediaInfoExe() {
  const src = path.resolve(__dirname, 'electron/native/MediaInfoTool/publish/MediaInfoTool.exe')
  const dest = path.resolve(__dirname, 'dist-electron/native/MediaInfoTool.exe')
  if (fs.existsSync(src)) {
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.copyFileSync(src, dest)
  }
  // Also copy smtc/index.js so it's available as a runtime module if not bundled
  const smtcSrc = path.resolve(__dirname, 'electron/native/smtc/index.js')
  const smtcDest = path.resolve(__dirname, 'dist-electron/native/smtc/index.js')
  if (fs.existsSync(smtcSrc)) {
    fs.mkdirSync(path.dirname(smtcDest), { recursive: true })
    fs.copyFileSync(smtcSrc, smtcDest)
  }
}

function copyPublicResources() {
  const src = path.resolve(__dirname, 'public/resources')
  const dest = path.resolve(__dirname, 'dist-electron/resources')
  if (fs.existsSync(src)) fs.cpSync(src, dest, { recursive: true })
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
})
