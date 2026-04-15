### New
- disable DevTools in production and add file-based logging for packaged builds
- add tab system with Steam API key fallback for private profiles

### Changes
- refactor: add credential store caching and backup, centralize path resolution, improve error handling
- refactor: centralize path resolution and improve production build compatibility
- refactor: extract IPC handlers and core infrastructure from main.js into modular files
- refactor: remove unused logger imports and improve error handling consistency
- docs: mark all refactoring tasks as completed in REFACTOR_PLAN.md
- refactor: minify main process bundle for production build
- refactor: improve type safety and remove type assertions throughout App.tsx