import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync, mkdtempSync, rmSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import initSqlJs from 'sql.js';
import { addFolder, deleteChassis, encodeChassisFile, listChassis, listFolders, listParts, moveToFolder, openLibrary, renameFolder, saveChassis, savePart } from '../src/library-db.js';
import { pull, push } from '../src/library-sync.js';

const { LibraryFolders } = createRequire(import.meta.url)('../desktop/library-folders.cjs');
const SQL = await initSqlJs();
const chassis = (name) => ({ name, frontX: 0, wheelbase: 80, clearance: 1, front: { diameter: 20, width: 8, inOut: 25 }, rear: { diameter: 20, width: 10, inOut: 25 } });

// The desktop side, called directly (in the app it is reached through the preload).
async function setup() {
  const base = mkdtempSync(join(tmpdir(), 'anvil-lib-'));
  const L = new LibraryFolders(join(base, 'profile'));
  await L.load();
  mkdirSync(join(base, 'main'));
  await L.setMain(join(base, 'main'));
  const disk = {
    scan: () => L.scan(),
    read: (r, p) => L.read(r, p),
    write: (r, p, b, rep) => L.write(r, p, b, rep),
    remove: (r, p) => L.remove(r, p),
    mkdir: (r, p) => L.mkdir(r, p),
    rmdir: (r, p) => L.removeDir(r, p),
  };
  return { base, L, disk, main: join(base, 'main') };
}

test('the library goes out to a folder on disk and follows folder changes', async () => {
  const { base, L, disk, main } = await setup();
  try {
    const db = openLibrary(SQL, null);
    const a = saveChassis(db, chassis('Peter 1-43'));
    savePart(db, { name: 'Rear wing', fileName: 'wing.stl', bytes: new Uint8Array([1, 2, 3]).buffer });
    const f = addFolder(db, '', '', 'Peter');
    addFolder(db, '', '', 'Empty');
    moveToFolder(db, 'chassis', a, f);
    await push(db, disk, L.get());
    assert.ok(existsSync(join(main, 'Peter', 'Peter 1-43.anvilchassis')));
    assert.ok(existsSync(join(main, 'Rear wing.stl')));
    assert.ok(existsSync(join(main, 'Empty')));
    renameFolder(db, '', 'Peter', 'Peter M');
    await push(db, disk, L.get());
    assert.ok(existsSync(join(main, 'Peter M', 'Peter 1-43.anvilchassis')));
    assert.ok(!existsSync(join(main, 'Peter')), 'the old folder went once empty');
    deleteChassis(db, a);
    await push(db, disk, L.get());
    assert.deepEqual(readdirSync(join(main, 'Peter M')), []);
    // Nothing left to write: pulling changes nothing.
    const again = await pull(db, disk, L.get());
    assert.deepEqual([again.added, again.changed, again.removed], [0, 0, 0]);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('files put in the folders by hand come into the library, and go when removed', async () => {
  const { base, L, disk, main } = await setup();
  try {
    const db = openLibrary(SQL, null);
    mkdirSync(join(main, 'Club'));
    writeFileSync(join(main, 'Club', 'Plafit.anvilchassis'), encodeChassisFile(chassis('Plafit'), new Uint8Array([9, 9])));
    writeFileSync(join(main, 'Club', 'broken.anvilchassis'), 'not a chassis');
    writeFileSync(join(main, 'notes.txt'), 'ignored');
    // An extra folder, such as a club's shared folder.
    const club = join(base, 'club');
    mkdirSync(club);
    writeFileSync(join(club, 'Scoop.stl'), new Uint8Array([5, 6, 7]));
    await L.addExtra(club);
    const r = await pull(db, disk, L.get());
    assert.equal(r.added, 2);
    assert.deepEqual(r.unreadable, ['Club/broken.anvilchassis']);
    const [c] = listChassis(db);
    assert.deepEqual([c.name, c.root, c.folder], ['Plafit', '', 'Club']);
    const [p] = listParts(db);
    assert.deepEqual([p.name, p.root, p.folder], ['Scoop', club, '']);
    assert.ok(listFolders(db).some((x) => x.path === 'Club' && x.root === ''));
    rmSync(join(main, 'Club', 'Plafit.anvilchassis'));
    await pull(db, disk, L.get());
    assert.equal(listChassis(db).length, 0);
    // Forgetting the extra folder takes its things out of the library, not off the disk.
    await L.forget(club);
    await pull(db, disk, L.get());
    assert.equal(listParts(db).length, 0);
    assert.ok(existsSync(join(club, 'Scoop.stl')));
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('a name already taken on disk is not overwritten', async () => {
  const { base, L, disk, main } = await setup();
  try {
    writeFileSync(join(main, 'Same.anvilchassis'), 'someone else\'s file');
    const db = openLibrary(SQL, null);
    saveChassis(db, chassis('Same'));
    await push(db, disk, L.get());
    assert.ok(existsSync(join(main, 'Same (2).anvilchassis')));
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('the desktop side only touches chassis and STL files inside the chosen folders', async () => {
  const { base, L, main } = await setup();
  try {
    await assert.rejects(L.write(main, '../outside.stl', new Uint8Array([1])));
    await assert.rejects(L.write(main, 'virus.exe', new Uint8Array([1])));
    await assert.rejects(L.write(join(base, 'elsewhere'), 'a.stl', new Uint8Array([1])));
    await assert.rejects(L.read(main, 'C:/Windows/win.ini'));
    await assert.rejects(L.remove(main, '..'));
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
