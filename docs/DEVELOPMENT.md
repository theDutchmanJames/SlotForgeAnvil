# Developing SlotForge Anvil

## Run it

Needs Node.js 22 or newer (the release builds use Node.js 24). Install once; this also fetches the Electron desktop runtime:

```
npm install
```

- `npm start` builds the page and opens the Anvil window.
- `npm run dev` serves the page in a browser while you work on the code (http://127.0.0.1:5180 with the project's launch settings, or the address Vite prints).
- `npm test` runs the unit tests, including the update check's.
- `npm run test:desktop` starts the built desktop app twice on a throwaway data folder and checks that it opens with its top bar, menus, 3D view and update check.

## Downloads and builds

| | Installer | Portable |
|---|---|---|
| Windows | `SlotForgeAnvil-<version>-Setup-x64.exe` | `SlotForgeAnvil-<version>-Portable-x64.exe`, or `…-Windows-x64.zip` (unzip anywhere, run `SlotForgeAnvil.exe`) |
| macOS (Intel and Apple silicon) | `SlotForgeAnvil-<version>-mac-universal.dmg` | `…-mac-universal.zip` |
| Linux (x64 and arm64) | `SlotForgeAnvil-<version>-linux-<arch>.deb` | `…-linux-<arch>.AppImage` |

- Windows: `npm run dist:win` builds all three into `dist/desktop/v<version>/`; `npm run dist:zip` builds only the zip.
- macOS and Linux are built by GitHub (`.github/workflows/native-release.yml`) when a release is published. They are tested on each system and attached to the same release. `npm run dist:mac` and `npm run dist:linux` work on those systems too.
- `npx electron desktop/make-icons.cjs` redraws `desktop/build/icon.png` and `icon.ico` from `src/assets/slotforge-anvil.svg`.

## Releases

1. Set the version in `package.json` and run `npm run dist:win`.
2. Commit, tag `v<version>` and push the tag.
3. Publish a GitHub release for the tag with the Windows files and `SHA256SUMS-win-x64.txt` attached. The macOS and Linux files follow.

Release notes need a `## What's new` section with `- **Title:** text` lines: the update window in the app shows them.

## Updates and theme

Updates work as in the other SlotForge apps: `desktop/update-check.cjs` and `src/update-ui.js` are the same files as Foundry's. An installed or portable copy asks GitHub for the newest release a few seconds after it starts; a development copy only checks when asked in Settings.

The Light / Dark theme is `src/app-theme.js`, also from Foundry. It is saved under the shared SlotForge key, so the apps on one computer follow the same choice.

## Test models

- Car models used for testing are never added to this project or to a build.
- `anvil.local.json` (not committed) may name folders of test models: `{ "testModels": ["C:/path/to/models"] }`. The tests that need them look there and are skipped without them. The dev page can open one with `?open=/@fs/C:/path/to/models/car.stl`.

## Planning documents

[research.md](../research.md), [features.md](../features.md), [foundry-reuse.md](../foundry-reuse.md) and [plan.md](../plan.md), which also lists every milestone.
