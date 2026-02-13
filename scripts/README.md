# Build & Development Scripts

## Quick Start

```powershell
# Run the app in development mode
.\scripts\run.ps1

# Or with the dev helper (auto-installs dependencies)
.\scripts\dev.ps1
```

## Available Scripts

### `run.ps1`
Starts Cereal Launcher in development mode.

```powershell
.\scripts\run.ps1 -Verbose
```

**Options:**
- `-Verbose` — Show detailed output

---

### `dev.ps1`
Development workflow helper. Checks dependencies and runs the app.

```powershell
.\scripts\dev.ps1 [-CheckDeps] [-Install] [-Verbose]
```

**Options:**
- `-CheckDeps` — Only check dependencies without running the app
- `-Install` — Force reinstall npm dependencies
- `-Verbose` — Show detailed output

**Example:**
```powershell
# Start app (auto-installs dependencies if needed)
.\scripts\dev.ps1

# Check if everything is set up
.\scripts\dev.ps1 -CheckDeps -Verbose
```

---

### `build.ps1`
Build the complete distribution package.

```powershell
.\scripts\build.ps1 [-AppOnly] [-Verbose]
```

**Options:**
- `-AppOnly` — Build Electron app only (don't rebuild chiaki-ng)
- `-Verbose` — Show detailed output

**Examples:**
```powershell
# Full build (chiaki-ng + Electron installer)
.\scripts\build.ps1 -Verbose

# Quick build (skip chiaki-ng rebuild, for UI changes)
.\scripts\build.ps1 -AppOnly -Verbose
```

**Output:** Installers and portable builds in `dist/`

---

### `build-chiaki.ps1`
Build chiaki-ng from source (specialized, rarely needed directly).

```powershell
.\scripts\build-chiaki.ps1
```

See [build-chiaki.ps1](build-chiaki.ps1) for details.

---

### `clean.ps1`
Remove generated build artifacts.

```powershell
.\scripts\clean.ps1 [-Full] [-Verbose]
```

**Options:**
- `-Full` — Also remove `node_modules` (will need `npm install` after)
- `-Verbose` — Show detailed output

**Examples:**
```powershell
# Remove build outputs only
.\scripts\clean.ps1 -Verbose

# Full cleanup (including dependencies)
.\scripts\clean.ps1 -Full -Verbose
```

---

## Workflow

### First-time setup:
```powershell
git clone --recursive https://github.com/youruser/cereal-launcher.git
cd cereal-launcher
npm install
.\scripts\dev.ps1  # or .\scripts\run.ps1
```

### Development (React/JS changes):
```powershell
# From repo root, or use:
.\scripts\dev.ps1
```

### Full build (with chiaki-ng):
```powershell
.\scripts\build.ps1 -Verbose
```

### Quick rebuild (UI-only changes):
```powershell
.\scripts\build.ps1 -AppOnly -Verbose
```

### Clean and rebuild:
```powershell
.\scripts\clean.ps1 -Verbose
.\scripts\build.ps1 -Verbose
```

---

## Execution Policy

If PowerShell blocks script execution, run:

```powershell
# Allow scripts for current user
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser

# Or bypass for a single run
powershell -ExecutionPolicy Bypass -File .\scripts\run.ps1
```
