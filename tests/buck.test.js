import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { bounds, meshStats, replay } from '../src/geometry/engine.js';
import { volume } from '../src/geometry/shell.js';
import { makeBuck } from '../src/geometry/buck.js';
import { windowOutlines } from '../src/geometry/windows.js';
import { readSTLMesh } from '../src/geometry/stl-mesh.js';
import { shell } from './shapes.js';
import { model } from './models.js';

// The shell is 100 Ã— 40 Ã— 30 with a 1 mm wall: outside y Â±20, roof at 30.
const opts = { wall: 1, sheet: 0.5, allowance: 0.1, trim: { front: 15, rear: 15 }, skirt: 3, plinth: 2, draft: 0, guide: 0 };

test('the buck sits wall + sheet + allowance inside the body, from the trim line up', () => {
  const { mesh, info } = makeBuck(shell(), opts);
  const s = meshStats(mesh);
  assert.equal(s.openEdges, 0);
  assert.equal(s.faultyEdges, 0);
  assert.ok(volume(mesh) > 0);
  const b = bounds(mesh.positions);
  assert.ok(Math.abs(b.max[2] - (30 - 1.6)) < 0.05, `top ${b.max[2]}`);
  let side = 0;
  for (let i = 0; i < mesh.positions.length; i += 3) if (mesh.positions[i + 2] > 15.5) side = Math.max(side, mesh.positions[i + 1]);
  assert.ok(Math.abs(side - (20 - 1.6)) < info.cell + 0.05, `side ${side}`);
  assert.ok(Math.abs(b.min[2] - (15 - 3 - 2)) < 1e-4, 'skirt and plinth');
  assert.equal(info.changedCount, 0, 'a box has no undercuts');
});

test('guide lines, posts through the insert and a short glue margin are reported', () => {
  const body = shell();
  const w = { id: 'w', name: 'Side', points: [[30, -20, 12], [60, -20, 12], [60, -20, 24], [30, -20, 24]], corners: [1, 1, 1, 1], normal: [0, -1, 0], mirror: true };
  const outlines = windowOutlines([w]).map((o) => ({ name: o.window.name, points: o.points, normal: o.normal }));
  const { mesh, info } = makeBuck(body, { ...opts, guide: 0.15, margin: 3, trim: { front: 14, rear: 14 }, outlines, posts: [{ x: 50, y: 0 }, { x: 150, y: 0 }] });
  assert.ok(info.guides >= 3, `trim line and two windows: ${info.guides}`);
  assert.deepEqual(info.postHits, [0]);
  assert.ok(info.short.length > 0, 'the window bottom is 2 mm from the trim line');
  assert.equal(meshStats(mesh).faultyEdges, 0);
  const ok = makeBuck(body, { ...opts, guide: 0.15, margin: 1.5, trim: { front: 10, rear: 10 }, outlines });
  assert.equal(ok.info.short.length, 0);
});

test('draft leans the sides out, and the body shows where the buck changed', () => {
  const { mesh, info } = makeBuck(shell(), { ...opts, draft: 3 });
  // Above the trim line the sides now reach further out than the wall allows.
  let side = 0;
  for (let i = 0; i < mesh.positions.length; i += 3) if (mesh.positions[i + 2] > 15) side = Math.max(side, mesh.positions[i + 1]);
  assert.ok(side > 20 - 1.6 + 0.3, `${side}`);
  assert.ok(info.changedCount > 0 && info.changedMost > 0.1);
});

test('a trim line above the roof is refused', () => {
  assert.throws(() => makeBuck(shell(), { ...opts, trim: { front: 40, rear: 40 } }), /lower it/);
});

const MAIN3 = model('Main3.stl');
test('test car Main3: a cabin buck', { skip: !existsSync(MAIN3) }, () => {
  const src = readSTLMesh(readFileSync(MAIN3));
  const body = replay(src, [
    { id: 'o', type: 'orient', enabled: true, params: { front: '+z', up: '+y' } },
    { id: 'f', type: 'floor', enabled: true, params: { mode: 'cut', at: 4.5 } },
    { id: 'h', type: 'hollow', enabled: true, params: { wall: 1 } },
  ]).mesh;
  const t0 = Date.now();
  const { mesh, info } = makeBuck(body, { ...opts, draft: 1, guide: 0.15, trim: { front: 40, rear: 40 } });
  const ms = Date.now() - t0;
  const s = meshStats(mesh);
  assert.equal(s.faultyEdges, 0);
  assert.equal(s.openEdges, 0);
  const b = bounds(mesh.positions), bb = bounds(body.positions);
  assert.ok(b.max[2] < bb.max[2] - 1.5, 'under the roof');
  assert.ok(b.size[1] < bb.size[1], 'inside the sides');
  console.log(`Main3 buck: ${info.triangles} triangles, ${ms} ms, changed ${info.changedCount} faces up to ${info.changedMost.toFixed(2)} mm, size ${b.size.map((v) => v.toFixed(1))}`);
});
