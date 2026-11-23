import { test } from 'node:test';
import assert from 'node:assert/strict';
import initSqlJs from 'sql.js';
import {
  decodeChassisFile,
  deleteChassis,
  encodeChassisFile,
  listChassis,
  openLibrary,
  readChassisStl,
  renameChassis,
  saveChassis,
} from '../src/library-db.js';

const SQL = await initSqlJs();
const chassis = {
  name: 'Adjustable metal chassis',
  frontX: -57,
  wheelbase: 112,
  wheelbaseMin: 96,
  wheelbaseMax: 116,
  clearance: 1,
  deck: 8,
  guideAhead: 22,
  front: { diameter: 25, width: 10, inOut: 34.5 },
  rear: { diameter: 25, width: 13, inOut: 34.15 },
};

test('a chassis is saved, found, renamed and removed', () => {
  const db = openLibrary(SQL);
  const id = saveChassis(db, chassis);
  let list = listChassis(db);
  assert.equal(list.length, 1);
  assert.equal(list[0].name, 'Adjustable metal chassis');
  assert.equal(list[0].data.wheelbaseMax, 116);
  renameChassis(db, id, 'Club chassis');
  assert.equal(listChassis(db)[0].data.name, 'Club chassis');
  // Saving again with the same id replaces it.
  saveChassis(db, { ...chassis, wheelbase: 100 }, null, id);
  list = listChassis(db);
  assert.equal(list.length, 1);
  assert.equal(list[0].data.wheelbase, 100);
  deleteChassis(db, id);
  assert.equal(listChassis(db).length, 0);
});

test('the library survives being stored and opened again, STL included', () => {
  const db = openLibrary(SQL);
  const stl = new Uint8Array([1, 2, 3, 4, 250]);
  const id = saveChassis(db, { ...chassis, stl: { fileName: 'printed.stl', flip: true } }, stl);
  const bytes = db.export();
  const again = openLibrary(SQL, bytes);
  const row = listChassis(again)[0];
  assert.equal(row.stlName, 'printed.stl');
  assert.equal(row.data.stl.flip, true);
  assert.deepEqual(Array.from(readChassisStl(again, id)), [1, 2, 3, 4, 250]);
});

test('a library from a newer Anvil is refused', () => {
  const db = openLibrary(SQL);
  db.run("UPDATE meta SET value = '99' WHERE key = 'version'");
  assert.throws(() => openLibrary(SQL, db.export()), /newer Anvil/);
});

test('a chassis shared as a file comes back the same', () => {
  const text = encodeChassisFile(chassis, new Uint8Array([9, 8, 7]));
  const back = decodeChassisFile(text);
  assert.equal(back.chassis.wheelbase, 112);
  assert.deepEqual(Array.from(back.stl), [9, 8, 7]);
  assert.throws(() => decodeChassisFile('{"format":"other"}'), /not an Anvil chassis/);
  assert.throws(() => decodeChassisFile(JSON.stringify({ format: 'slotforge-anvil-chassis', version: 1, chassis: { wheelbase: 1 } })), /damaged/);
});

import { deletePostType, listPostTypes, savePostType } from '../src/library-db.js';
test('own post types are kept in the library, and an old library gets the table', () => {
  const old = new SQL.Database();
  old.run('CREATE TABLE meta (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL)');
  const db = openLibrary(SQL, old.export());
  const id = savePostType(db, { name: 'M1.6 post', kind: 'screw', outer: 3.4, hole: 1.3, depth: 5, fillet: 1, stray: 'x' });
  const again = openLibrary(SQL, db.export());
  const list = listPostTypes(again);
  assert.equal(list.length, 1);
  assert.deepEqual(list[0], { id, name: 'M1.6 post', kind: 'screw', outer: 3.4, hole: 1.3, depth: 5, fillet: 1 });
  savePostType(again, { ...list[0], outer: 3.6 }, id);
  assert.equal(listPostTypes(again)[0].outer, 3.6);
  deletePostType(again, id);
  assert.equal(listPostTypes(again).length, 0);
});

import { deletePart, listParts, readPartStl, savePart } from '../src/library-db.js';
test('add-on parts are kept in the library with their file', () => {
  const db = openLibrary(SQL, null);
  const bytes = new Uint8Array([1, 2, 3, 4]).buffer;
  const id = savePart(db, { name: 'Rear wing', fileName: 'wing.stl', bytes, place: { z: 30, scale: 1 } });
  const again = openLibrary(SQL, db.export());
  assert.deepEqual(listParts(again), [{ id, name: 'Rear wing', stlName: 'wing.stl', data: { place: { z: 30, scale: 1 } } }]);
  assert.deepEqual(Array.from(readPartStl(again, id)), [1, 2, 3, 4]);
  deletePart(again, id);
  assert.equal(listParts(again).length, 0);
});
