# Releasing Cereal

This document explains how to build and publish releases for the full Cereal app and the bundled `chiaki-ng` runtime.

Prerequisites (local)
- Node.js 18+ and npm
- `git` (repo cloned with submodules) 
- For Windows builds: Visual Studio 2022/2023 with "Desktop development with C++" workload
- For macOS builds: Xcode and command line tools
- For Linux builds: distro build toolchain (make/gcc), required dev packages
- `gh` (GitHub CLI) recommended but not required — `GITHUB_TOKEN` may be used instead

Useful NPM scripts
- `npm run setup:chiaki` — download prebuilt chiaki Windows portable release into `resources/chiaki-ng/`
- `npm run build:chiaki:deps` — bootstraps `vcpkg` and installs chiaki dependencies (Windows)
- `npm run build:chiaki` — attempts to build `chiaki-ng` from `vendor/chiaki-ng` and copies result into `resources/chiaki-ng/`
- `npm run build` — builds the Electron app (electron-builder)
- `npm run release` — builds the app and publishes a GitHub Release with installer artifacts (scripts/publish-release.ps1)
- `npm run release:chiaki` — publishes only a chiaki artifact (scripts/publish-chiaki-release.ps1)

CI

The repository contains a GitHub Actions workflow `.github/workflows/build-and-release.yml` that:
- Runs builds on `windows-latest`, `macos-latest`, and `ubuntu-latest`.
- Uploads `dist/` artifacts for each job.
- When a tag matching `v*.*.*` is pushed, the `publish` job collects all `dist/` artifacts and runs `scripts/publish-release.ps1 -SkipBuild` to create a GitHub Release and upload the installers.

Publishing manually

Using GitHub CLI (recommended):

1. Create a tag and push it:

```powershell
git tag v1.2.3
git push origin v1.2.3
```

2. Let CI run and create the release automatically, or run locally:

```powershell
npm run build
npm run release -- -Tag v1.2.3 -Repo youruser/cereal-launcher
```

Using REST API (without `gh`):

1. Export `GITHUB_TOKEN` (with `repo` scope) into your environment.
2. Run:

```powershell
.\scripts\publish-release.ps1 -Tag v1.2.3 -Repo youruser/cereal-launcher -SkipBuild
```

Notes
- Building `chiaki-ng` from source on Windows requires Visual Studio and CMake. The CI workflow builds the app on each platform and aggregates artifacts for release.
- If you want releases to be fully automated, ensure GitHub Actions has access to any secrets required and enable artifacts retention as needed.
