# Cereal Launcher — Licenses

## Cereal Launcher

MIT License — Copyright (c) 2025 Andrew

## Bundled: chiaki-ng

Cereal bundles [chiaki-ng](https://github.com/streetpea/chiaki-ng), a free and
open-source PlayStation Remote Play client.

**License:** GNU Affero General Public License v3 (AGPL-3.0)

Copyright (c) chiaki-ng contributors

Because chiaki-ng is licensed under AGPL v3, the following applies:

- The chiaki-ng source code is included as a git submodule at `vendor/chiaki-ng/`
- Any modifications to chiaki-ng source are documented in `vendor/chiaki-ng-patches/`
- The complete source code for the bundled chiaki-ng binary can be obtained from:
  https://github.com/streetpea/chiaki-ng

The AGPL v3 license applies **only** to the chiaki-ng component. The Cereal
launcher application code itself is MIT-licensed. The two are separate programs
that communicate via process spawning (CLI invocation), not linking.

### AGPL v3 Summary

This program is free software: you can redistribute it and/or modify it under
the terms of the GNU Affero General Public License version 3 as published by the
Free Software Foundation.

This program is distributed in the hope that it will be useful, but WITHOUT ANY
WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A
PARTICULAR PURPOSE. See the GNU Affero General Public License for more details.

Full license text: https://www.gnu.org/licenses/agpl-3.0.html

## Other Dependencies

This application also uses the following open-source libraries:

- **Electron** — MIT License
- **better-sqlite3** — MIT License
- **node-fetch** — MIT License
- **Qt6** — LGPL v3 (bundled with chiaki-ng)
- **FFmpeg** — LGPL v2.1+ (bundled with chiaki-ng)
- **SDL2** — zlib License (bundled with chiaki-ng)
- **OpenSSL** — Apache License 2.0 (bundled with chiaki-ng)
- **libopus** — BSD 3-Clause (bundled with chiaki-ng)
