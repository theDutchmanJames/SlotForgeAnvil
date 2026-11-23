import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { bounds, meshStats, replay } from '../src/geometry/engine.js';
import { applyFloor, applyHollow, thicknessAt, volume, wallThickness } from '../src/geometry/shell.js';
import { readSTLMesh } from '../src/geometry/stl-mesh.js';
import { model } from './models.js';

// A closed box, subdivided so the wall has corners to work with.
function box(sx, sy, sz, n = 8) {
  const pos = [], idx = [], key = new Map();
  const vert = (x, y, z) => {
    const k = `${x},${y},${z}`;
    if (!key.has(k)) {
      key.set(k, pos.length / 3);
      pos.push(x, y, z);
    }
    return key.get(k);
  };
  // Each face as an n×n grid, wound outwards.
  const face = (o, u, v) => {
    for (let j = 0; j < n; j++)
      for (let i = 0; i < n; i++) {
        const p = (a, b) => vert(...o.map((x, k) => x + u[k] * a / n + v[k] * b / n));
        const a = p(i, j), b = p(i + 1, j), c = p(i + 1, j + 1), d = p(i, j + 1);
        idx.push(a, b, c, a, c, d);
      }
  };
  face([0, 0, 0], [0, sy, 0], [sx, 0, 0]); // bottom, facing down
  face([0, 0, sz], [sx, 0, 0], [0, sy, 0]); // top
  face([0, 0, 0], [sx, 0, 0], [0, 0, sz]); // front y=0
  face([0, sy, 0], [0, 0, sz], [sx, 0, 0]); // back
  face([0, 0, 0], [0, 0, sz], [0, sy, 0]); // x=0
  face([sx, 0, 0], [0, sy, 0], [0, 0, sz]); // x=sx
  return { positions: Float32Array.from(pos), indices: Uint32Array.from(idx) };
}

test('floor line cut opens the underside', () => {
  const m = applyFloor(box(100, 40, 30), { mode: 'cut', at: 2 });
  assert.equal(bounds(m.positions).min[2], 2);
  assert.ok(meshStats(m).openEdges > 0);
  assert.throws(() => applyFloor(box(10, 10, 10), { mode: 'cut', at: -1 }), /below the car/);
});

test('floor line squish keeps the top and presses the bottom up', () => {
  const m = applyFloor(box(100, 40, 30), { mode: 'squish', at: 3, blend: 6 });
  const b = bounds(m.positions);
  assert.ok(b.min[2] >= 3 && b.min[2] < 3.1, `bottom at ${b.min[2]}`);
  assert.equal(b.max[2], 30);
  assert.equal(b.size[0], 100);
});

test('hollow builds a closed wall of the chosen thickness from a solid', () => {
  const open = applyFloor(box(100, 40, 30), { mode: 'cut', at: 0.5 });
  const shell = applyHollow(open, { wall: 1 });
  const s = meshStats(shell);
  assert.equal(s.openEdges, 0);
  assert.equal(s.faultyEdges, 0);
  assert.ok(volume(shell) > 0, 'faces point outwards');
  // Wall in the middle of the roof.
  const t = wallThickness(shell);
  const roof = [];
  for (let v = 0; v < t.length; v++) {
    const [x, y, z] = shell.positions.subarray(v * 3, v * 3 + 3);
    if (z === 30 && x > 20 && x < 80 && y > 10 && y < 30) roof.push(t[v]);
  }
  assert.ok(roof.length > 3);
  for (const w of roof) assert.ok(Math.abs(w - 1) < 0.02, `roof wall ${w}`);
  assert.deepEqual(bounds(shell.positions), bounds(open.positions), 'outside unchanged');
});

test('hollow needs an open underside', () => {
  assert.throws(() => applyHollow(box(100, 40, 30), { wall: 1 }), /floor line/);
});

test('lighten the top: thinner at the roof than at the sills', () => {
  const o = { wall: 1.2, top: 0.7, strokes: [] };
  assert.equal(thicknessAt([0, 0, 0], o, 0, 30), 1.2);
  assert.equal(thicknessAt([0, 0, 30], o, 0, 30), 0.7);
  const painted = { ...o, strokes: [{ at: [0, 0, 30], radius: 5, wall: 2 }] };
  assert.equal(thicknessAt([0, 0, 30], painted, 0, 30), 2);
  assert.equal(thicknessAt([0, 6, 30], painted, 0, 30), 0.7);
});

test('re-walling an existing shell keeps the outside and sets the new wall', () => {
  // A 3 mm shell, open at the bottom: hollow at 3 mm, then hollow again at 1 mm.
  const open = applyFloor(box(100, 40, 30), { mode: 'cut', at: 0.5 });
  const thick = applyHollow(open, { wall: 3 });
  const thin = applyHollow(thick, { wall: 1 });
  assert.ok(thin.info.oldWall > 2.5 && thin.info.oldWall < 3.5, `old wall ${thin.info.oldWall}`);
  assert.equal(meshStats(thin).openEdges, 0);
  assert.ok(volume(thin) < volume(thick) * 0.5);
  const b1 = bounds(thin.positions), b0 = bounds(thick.positions);
  assert.ok(b1.size.every((v, k) => Math.abs(v - b0.size[k]) < 1e-4), 'outside unchanged');
});

const MAIN3 = model('Main3.stl');
test('test car Main3: from 3 mm walls to 1 mm', { skip: !existsSync(MAIN3) }, () => {
  const src = readSTLMesh(readFileSync(MAIN3));
  const { mesh, results } = replay(src, [
    { id: 'o', type: 'orient', enabled: true, params: { front: '+z', up: '+y' } },
    { id: 'f', type: 'floor', enabled: true, params: { mode: 'cut', at: 4.5 } },
    { id: 'h', type: 'hollow', enabled: true, params: { wall: 1 } },
  ]);
  assert.deepEqual(results.map((r) => r.state), ['ok', 'ok', 'ok'], JSON.stringify(results));
  const before = replay(src, [
    { id: 'o', type: 'orient', enabled: true, params: { front: '+z', up: '+y' } },
    { id: 'f', type: 'floor', enabled: true, params: { mode: 'cut', at: 4.5 } },
  ]).mesh;
  const s = meshStats(mesh);
  assert.equal(s.faultyEdges, 0);
  const t = Array.from(wallThickness(mesh)).filter(Number.isFinite).sort((a, b) => a - b);
  const median = t[Math.floor(t.length / 2)];
  assert.ok(median > 0.85 && median < 1.15, `median wall ${median}`);
  assert.ok(volume(mesh) < volume(before) * 0.5, `volume ${volume(mesh)} vs ${volume(before)}`);
});

test('parts thinner than two walls stay solid', () => {
  // A body (open underneath) with a separate 1.5 mm wing above it, 1 mm wall:
  // the wing has no room for a hollow and must stay solid.
  const body = applyFloor(box(100, 40, 30), { mode: 'cut', at: 0.5 });
  const wing = box(30, 40, 1.5, 4);
  const lift = Float32Array.from(wing.positions, (v, i) => (i % 3 === 2 ? v + 35 : v + (i % 3 === 0 ? 60 : 0)));
  const off = body.positions.length / 3;
  const both = {
    positions: Float32Array.from([...body.positions, ...lift]),
    indices: Uint32Array.from([...body.indices, ...Array.from(wing.indices, (v) => v + off)]),
  };
  const shell = applyHollow(both, { wall: 1 });
  assert.ok(shell.info.solid > 0);
  const t = wallThickness(shell);
  const onWing = [];
  for (let v = 0; v < shell.positions.length / 6; v++) {
    const z = shell.positions[v * 3 + 2], x = shell.positions[v * 3];
    if (z > 36 && x > 65 && x < 85 && Number.isFinite(t[v])) onWing.push(t[v]);
  }
  onWing.sort((a, b) => a - b);
  const median = onWing[Math.floor(onWing.length / 2)];
  assert.ok(Math.abs(median - 1.5) < 0.1, `wing measures ${median}`);
});
