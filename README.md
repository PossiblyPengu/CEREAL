# C E R E A L

**A universal game launcher for Windows.**

Cereal aggregates your game libraries from Steam, Epic Games, GOG, itch.io, Battle.net, EA, Ubisoft, Xbox Cloud Gaming, and PlayStation 5 into a single polished interface. Add any executable as a custom game, stream your PS5 via Chiaki-ng, or play Xbox Cloud games in-app — all from one place.

---

## Features

- **Multi-platform library** — automatically detects installed games from Steam, Epic, GOG, itch.io, Battle.net, EA App, and Ubisoft Connect
- **Custom games** — add any `.exe` with its own artwork
- **SteamGridDB integration** — automatic cover and header art with optional API key for higher resolution
- **Orbit & card views** — switch between a cinematic orbit layout and a traditional card grid
- **Playtime tracking** — automatic session tracking synced to each game
- **Favorites & categories** — organize and filter your library your way
- **PlayStation 5 streaming** — launch Chiaki-ng sessions directly from the launcher
- **Xbox Cloud Gaming** — stream Xbox games through a built-in browser overlay
- **Discord Rich Presence** — live game status in your Discord profile
- **Windows media controls** — SMTC integration so media keys work in-game
- **Theming** — multiple themes and custom accent colors

---

## Download

Grab the latest installer from the [Releases](../../releases/latest) page:

```
Cereal-Setup-x.x.x.exe
```

The NSIS installer lets you choose your install directory and creates Start Menu and Desktop shortcuts.

---

## Building from Source

**Requirements:** Node.js 20+, .NET 8 SDK, Git

```powershell
# Install dependencies
npm install

# Start in development mode (builds native tools then launches Vite + Electron)
.\dev.ps1

# Build a distributable installer
npm run build
npx electron-builder --win
```

The `publish.ps1` script bumps the version, generates release notes from conventional commits, tags, and pushes — CI picks it up from there.

```powershell
# Patch bump (default)
.\publish.ps1

# Minor or major bump
.\publish.ps1 -Bump minor
.\publish.ps1 -Bump major
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| UI | React 19, TypeScript |
| Desktop shell | Electron |
| Bundler | Vite |
| Native tools | .NET 8 (MediaInfoTool) |
| Updates | electron-updater (GitHub Releases) |

---

## License

© 2026 PossiblyPengu. All rights reserved.
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```
