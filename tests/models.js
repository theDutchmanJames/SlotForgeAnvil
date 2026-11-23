// Test car models are never part of Anvil. anvil.local.json (not committed)
// may name the folders they are in: { "testModels": ["C:/path/to/models"] }.
// model('car.stl') gives the path of the first folder that has it, or a path
// that does not exist, so tests that need it are skipped.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

let folders = [];
try {
  const url = new URL('../anvil.local.json', import.meta.url);
  if (existsSync(url)) folders = [JSON.parse(readFileSync(url, 'utf8')).testModels ?? []].flat();
} catch {}

export const model = (name) => folders.map((f) => join(f, name)).find(existsSync) ?? join('missing-test-models', name);
