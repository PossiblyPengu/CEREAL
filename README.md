# Cereal 🥣

A unified game launcher with built-in PlayStation Remote Play and Xbox Cloud Gaming.

## Platforms

| Source     | Detection | Launch Method                |
|------------|-----------|------------------------------|
| Steam      | Auto      | `steam://rungameid/` protocol |
| Epic Games | Auto      | `com.epicgames.launcher://` protocol |
| GOG        | Auto      | `goggalaxy://` protocol      |
| PlayStation| Manual    | chiaki-ng (bundled from source) |
| Xbox Cloud | Manual    | Xbox app / browser streaming |
| Custom     | Manual    | Direct executable            |

## Architecture

```
cereal-launcher/
├── main.js                    # Electron main process
├── preload.js                 # IPC bridge
├── src/index.html             # React UI (single file)
├── package.json
│
├── vendor/
│   └── chiaki-ng/             # Git submodule (source code)
│
├── scripts/
│   ├── build-chiaki.sh        # MSYS2 build script
│   └── build-chiaki.ps1       # PowerShell wrapper
│
├── resources/
│   └── chiaki-ng/             # Built binary + DLLs (git-ignored)
│       ├── chiaki.exe
│       ├── *.dll
│       └── .version
│
├── chiaki-dist/               # Build staging (git-ignored)
├── LICENSES.md
└── .gitmodules
```

## Prerequisites

### For the Electron app
- Node.js 18+
- npm

### For building chiaki-ng from source
- **MSYS2** — https://www.msys2.org/
- ~10 GB disk space (MSYS2 packages + Qt6 + build artifacts)
- ~15 min build time on a modern machine

The build script handles all MSYS2 package installation automatically.

## Quick Start

```bash
# 1. Clone with submodules
git clone --recursive https://github.com/youruser/cereal-launcher.git
cd cereal-launcher

# 2. Install Node dependencies
npm install

# 3. Build chiaki-ng from source (first time takes ~15 min)
#    From PowerShell:
.\scripts\build-chiaki.ps1

#    Or from MSYS2 MinGW64 shell:
bash scripts/build-chiaki.sh

# 4. Run the launcher
npm start
```

## Build Pipeline

### What `build-chiaki.sh` does

1. **Installs MSYS2 packages** — Qt6, FFmpeg, SDL2, opus, OpenSSL, Vulkan headers,
   protobuf, libplacebo, shaderc, spirv-cross, miniupnpc, json-c, speexdsp, nasm
2. **Clones/updates** the chiaki-ng submodule at `vendor/chiaki-ng/`
3. **Configures CMake** — Release build, Ninja generator, SDL gamecontroller enabled
4. **Compiles** — Builds the `chiaki` target
5. **Deploys Qt** — Runs `windeployqt6.exe` to collect Qt DLLs and plugins
6. **Collects MinGW DLLs** — Copies runtime DLLs (libgcc, libstdc++, ffmpeg, etc.)
7. **Stages to `chiaki-dist/`** then copies to `resources/chiaki-ng/`

### What `build-chiaki.ps1` does

1. Checks if MSYS2 is installed (tries winget or chocolatey if missing)
2. Converts paths and launches `build-chiaki.sh` inside the MSYS2 MinGW64 shell

### Packaging the Electron app

```bash
# Full build (chiaki + Electron)
npm run build

# Or just the Electron app (if chiaki is already built)
npm run build:app
```

electron-builder is configured to include `resources/chiaki-ng/` as an
`extraResource`, so the compiled chiaki binary ships inside the installer.

## How chiaki-ng Integration Works

### At build time
The chiaki-ng source is compiled via CMake/Ninja in the MSYS2 MinGW64
environment. The resulting `chiaki.exe` plus all required DLLs (~200 MB) are
staged into `resources/chiaki-ng/`.

### At runtime
The Electron main process resolves the bundled binary via:

```
Packaged app:  {process.resourcesPath}/chiaki-ng/chiaki.exe
Dev mode:      {__dirname}/resources/chiaki-ng/chiaki.exe
Fallback:      System-installed chiaki-ng (Program Files, etc.)
```

### Launching PlayStation games
When a game with `platform: 'psremote'` is launched:

1. If the game has `chiakiNickname` + `chiakiHost` set →
   runs `chiaki.exe stream <nickname> <host>` (direct connect)
2. Otherwise → opens the chiaki-ng GUI for console selection/registration

The `PATH` is augmented with the chiaki-ng directory so all DLLs resolve.

## Updating chiaki-ng

```bash
cd vendor/chiaki-ng
git fetch --tags
git checkout v1.x.x          # desired version
cd ../..
bash scripts/build-chiaki.sh  # rebuild
```

## Licensing

The Cereal launcher is MIT-licensed. The bundled chiaki-ng component is
AGPL v3. See [LICENSES.md](LICENSES.md) for details.

Since chiaki-ng is launched as a separate process (not linked), the AGPL
applies only to the chiaki-ng binary and its source code, which is provided
via the git submodule.
