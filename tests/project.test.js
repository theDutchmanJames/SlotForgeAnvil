import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createHistory,
  decodeProjectFile,
  encodeProjectFile,
  fmtLen,
  fromUnits,
  newProject,
  restore,
  snapshot,
  toUnits,
} from '../src/project.js';

const bytes = new Uint8Array(Array.from({ length: 70000 }, (_, i) => (i * 37) % 256)).buffer;

test('a project file keeps the model and every step', () => {
  const p = newProject('Main3.stl', bytes, { front: '+z', up: '+y' });
  p.steps.push({ id: 'x', type: 'scale', enabled: false, params: { factor: 0.75 } });
  const back = decodeProjectFile(encodeProjectFile(p));
  assert.equal(back.name, 'Main3');
  assert.deepEqual(back.steps, p.steps);
  assert.deepEqual(new Uint8Array(back.source.bytes), new Uint8Array(bytes));
  assert.equal(back.source.fileName, 'Main3.stl');
});

test('other files are refused with a plain message', () => {
  assert.throws(() => decodeProjectFile('not json'), /not an Anvil project/);
  assert.throws(() => decodeProjectFile('{"format":"other"}'), /not an Anvil project/);
  assert.throws(
    () => decodeProjectFile(JSON.stringify({ format: 'slotforge-anvil-project', version: 99, steps: [], source: { stl: '' } })),
    /newer Anvil/,
  );
});

test('undo and redo restore the steps', () => {
  const h = createHistory();
  let p = newProject('a.stl', bytes, { front: '+x', up: '+z' });
  h.push(snapshot(p));
  p.steps.push({ id: 'y', type: 'scale', enabled: true, params: { factor: 2 } });
  p = restore(p, h.undo(snapshot(p)));
  assert.equal(p.steps.length, 1);
  assert.ok(h.canRedo);
  p = restore(p, h.redo(snapshot(p)));
  assert.equal(p.steps.length, 2);
  assert.equal(p.source.bytes, bytes, 'the imported file is never copied by undo');
});

test('lengths show in millimetres or inches', () => {
  assert.equal(fmtLen(141.6, 'mm'), '141.6 mm');
  assert.equal(fmtLen(4.5, 'mm'), '4.50 mm');
  assert.equal(fmtLen(25.4, 'in'), '1.000 in');
  assert.equal(fromUnits(toUnits(80, 'in'), 'in'), 80);
});
