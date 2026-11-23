import { defineConfig, searchForWorkspaceRoot } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { existsSync, readFileSync } from 'node:fs';

// Development only: anvil.local.json (never committed) may name folders of
// test car models (one path or a list), so the dev page can open one with ?open=/@fs/<path>.
// Test models are never copied into the project or into a build.
function localSettings() {
  try {
    return existsSync('anvil.local.json')
      ? JSON.parse(readFileSync('anvil.local.json', 'utf8'))
      : {};
  } catch {
    return {};
  }
}
const local = localSettings();

const version = JSON.parse(readFileSync('package.json', 'utf8')).version;

export default defineConfig({
  define: { __ANVIL_VERSION__: JSON.stringify(version) },
  // One offline page (dist/index.html) that the desktop shell shows.
  plugins: [viteSingleFile({ removeViteModuleLoader: true })],
  worker: { format: 'iife' },
  build: { target: 'es2022', chunkSizeWarningLimit: 12000 },
  server: {
    fs: {
      allow: [
        searchForWorkspaceRoot(process.cwd()),
        ...[local.testModels ?? []].flat(),
      ],
    },
  },
});
