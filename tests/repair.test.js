import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { bounds, meshStats } from '../src/geometry/engine.js';
import { applyFill, applyRepair, checkModel, listOpenings } from '../src/geometry/repair.js';
import { applyReduce } from '../src/geometry/reduce.js';
import { encodeSTL, readSTLMesh } from '../src/geometry/stl-mesh.js';
import { model } from './models.js';

function box(sx, sy, sz, ox = 0, oy = 0, oz = 0) {
  const o = [ox, oy, oz];
  const positions = new Float32Array(
    [0, 0, 0, sx, 0, 0, sx, sy, 0, 0, sy, 0, 0, 0, sz, sx, 0, sz, sx, sy, sz, 0, sy, sz].map((v, i) => v + o[i % 3]),
  );
  const q = [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]];
  return { positions, indices: new Uint32Array(q.flatMap(([a, b, c, d]) => [a, b, c, a, c, d])) };
}
const inverted = (m) => ({
  positions: m.positions,
  indices: Uint32Array.from(m.indices, (_, i) => m.indices[i - (i % 3) + [0, 2, 1][i % 3]]),
});
function merge(...meshes) {
  const pos = [], idx = [];
  for (const m of meshes) {
    const off = pos.length / 3;
    pos.push(...m.positions);
    idx.push(...Array.from(m.indices, (v) => v + off));
  }
  return { positions: Float32Array.from(pos), indices: Uint32Array.from(idx) };
}
// Weld equal corners, as importing a file does.
const welded = (m) => readSTLMesh(encodeSTL(m));
// A flat sheet of nx × ny squares.
function grid(nx, ny, sx, sy, z) {
  const pos = [], idx = [];
  for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) pos.push((i / nx) * sx, (j / ny) * sy, z);
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      const a = j * (nx + 1) + i, b = a + 1, c = a + nx + 2, d = a + nx + 1;
      idx.push(a, b, c, a, c, d);
    }
  return { positions: Float32Array.from(pos), indices: Uint32Array.from(idx) };
}

test('light fix removes collapsed and doubled triangles', () => {
  const m = box(10, 10, 10);
  const idx = [...m.indices, 0, 0, 1, ...m.indices.slice(0, 3)];
  const r = applyRepair({ positions: m.positions, indices: Uint32Array.from(idx) }, {});
  assert.equal(r.info.collapsed, 1);
  assert.equal(r.info.doubled, 1);
  assert.equal(r.indices.length / 3, 12);
  assert.equal(meshStats(r).faultyEdges, 0);
});

test('light fix untangles two boxes that share an edge, without moving anything', () => {
  const m = welded(merge(box(10, 10, 10), box(10, 10, 10, 10, 10, 0)));
  assert.ok(meshStats(m).faultyEdges > 0);
  const r = applyRepair(m, {});
  const s = meshStats(r);
  assert.equal(s.faultyEdges, 0);
  assert.equal(s.openEdges, 0);
  assert.equal(s.parts, 2);
  assert.deepEqual(bounds(r.positions), bounds(m.positions));
});

test('light fix turns an inside-out part round', () => {
  const inv = inverted(box(10, 10, 10));
  assert.equal(checkModel(inv).insideOutParts, 1);
  const r = applyRepair(inv, {});
  assert.ok(r.info.flipped >= 12);
  assert.equal(checkModel(r).insideOutParts, 0);
});

test('light fix drops specks', () => {
  const r = applyRepair(merge(box(100, 40, 30), box(0.5, 0.5, 0.5, 50, 50, 50)), {});
  assert.equal(r.info.specks, 1);
  assert.equal(meshStats(r).parts, 1);
});

test('light fix closes small holes and leaves big openings alone', () => {
  const sheet = grid(80, 80, 100, 100, 0);
  const holed = { positions: sheet.positions, indices: Uint32Array.from([...sheet.indices.slice(0, 3000), ...sheet.indices.slice(3003)]) };
  const r = applyRepair(holed, {});
  assert.equal(r.info.holes, 1);
  assert.equal(meshStats(r).openEdges, 320, 'only the outer edge stays open');
});

test('check tells a shell from a solid and measures the wall', () => {
  const shell = checkModel(merge(box(100, 40, 30), inverted(box(98, 38, 28, 1, 1, 1))));
  assert.equal(shell.kind, 'shell');
  assert.ok(Math.abs(shell.wall - 1) < 0.05, `wall ${shell.wall}`);
  assert.equal(checkModel(box(100, 40, 30)).kind, 'solid');
});

test('openings are listed and closed, flat or smooth', () => {
  const lid = grid(10, 10, 50, 50, 0);
  const open = listOpenings(lid);
  assert.equal(open.length, 1);
  assert.equal(open[0].edges, 40);
  for (const mode of ['flat', 'smooth']) {
    const r = applyFill(lid, { loops: [0], mode, count: 1 });
    const s = meshStats(r);
    assert.equal(s.openEdges, 0, mode);
    assert.equal(s.faultyEdges, 0, mode);
  }
  assert.throws(() => applyFill(lid, { loops: [0], count: 2 }), /no longer matches/);
});

test('a smooth patch bends with its rim', () => {
  // A square hole in a sheet whose rim rises in the middle of two sides.
  const sheet = grid(12, 12, 60, 60, 0);
  const p = sheet.positions;
  for (let i = 0; i < p.length; i += 3) p[i + 2] = 5 * Math.sin((Math.PI * p[i]) / 60);
  // Remove the 4 x 4 squares in the middle.
  const keep = [];
  for (let f = 0; f < sheet.indices.length / 3; f++) {
    const sq = Math.floor(f / 2), i = sq % 12, j = Math.floor(sq / 12);
    if (i >= 4 && i < 8 && j >= 4 && j < 8) continue;
    keep.push(...sheet.indices.slice(f * 3, f * 3 + 3));
  }
  const holed = { positions: p, indices: Uint32Array.from(keep) };
  const inner = listOpenings(holed).find((o) => o.edges === 16);
  const r = applyFill(holed, { loops: [inner.id], mode: 'smooth', count: 2 });
  // New points sit near the curved surface, not on a flat plane.
  let worst = 0;
  for (let v = p.length / 3; v < r.positions.length / 3; v++) {
    const x = r.positions[v * 3], z = r.positions[v * 3 + 2];
    worst = Math.max(worst, Math.abs(z - 5 * Math.sin((Math.PI * x) / 60)));
  }
  assert.ok(worst < 0.8, `patch strays ${worst.toFixed(2)} mm`);
});

test('reduce keeps a flat surface flat and its outline in place', () => {
  const lid = grid(40, 40, 50, 50, 0);
  const r = applyReduce(lid, { target: 0.1, tolerance: 0.01 });
  assert.ok(r.indices.length / 3 <= (lid.indices.length / 3) * 0.1 + 2, `kept ${r.indices.length / 3}`);
  const same = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 1e-9);
  assert.ok(same(bounds(r.positions).size, bounds(lid.positions).size), 'outline kept');
  assert.equal(meshStats(r).faultyEdges, 0);
  for (let i = 2; i < r.positions.length; i += 3) assert.ok(Math.abs(r.positions[i]) < 1e-9);
});

// James's test cars: never part of Anvil, only used when present.
const CARS = {
  datsun: model('datsun.stl'),
  mclaren: model('McLaren_MP4_12C.stl'),
  main3: model('Main3.stl'),
};
test('test car Datsun: the light fix clears its faults without moving the surface', { skip: !existsSync(CARS.datsun) }, () => {
  const m = readSTLMesh(readFileSync(CARS.datsun));
  assert.equal(checkModel(m).kind, 'shell');
  const r = applyRepair(m, {});
  assert.equal(meshStats(r).faultyEdges, 0);
  assert.deepEqual(bounds(r.positions), bounds(m.positions));
});
test('test car McLaren with faults added: the light fix clears them and the specks; reduce thins it', { skip: !existsSync(CARS.mclaren) }, () => {
  const m = readSTLMesh(readFileSync(CARS.mclaren));
  const triangles = m.indices.length / 3;
  // The file is clean: add doubled faces, collapsed ones and loose specks.
  const P = Array.from(m.positions), I = Array.from(m.indices);
  for (let f = 0; f < 30; f++) I.push(I[f * 3], I[f * 3 + 1], I[f * 3 + 2]);
  for (let f = 100; f < 110; f++) I.push(I[f * 3], I[f * 3], I[f * 3 + 1]);
  for (let k = 0; k < 6; k++) {
    const b = P.length / 3;
    P.push(k * 5, 80, 0, k * 5 + 0.3, 80, 0, k * 5, 80.3, 0, k * 5, 80, 0.3);
    I.push(b, b + 2, b + 1, b, b + 1, b + 3, b, b + 3, b + 2, b + 1, b + 2, b + 3);
  }
  const bad = { positions: Float32Array.from(P), indices: Uint32Array.from(I) };
  const c = checkModel(bad);
  assert.ok(c.specks >= 5, `specks ${c.specks}`);
  assert.ok(c.collapsed + c.doubled > 0);
  const r = applyRepair(bad, {});
  const s = meshStats(r);
  assert.equal(s.faultyEdges, 0);
  assert.equal(s.openEdges, 0);
  assert.equal(s.parts, 1);
  assert.equal(s.triangles, triangles, 'back to the clean car');
  // Already lean, so it thins less than a heavy file would.
  const red = applyReduce(r, { target: 0.3, tolerance: 0.02 });
  assert.ok(red.indices.length / 3 < s.triangles * 0.8, `kept ${red.indices.length / 3}`);
});
test('test car Main3: check says shell with about 3 mm walls', { skip: !existsSync(CARS.main3) }, () => {
  const c = checkModel(readSTLMesh(readFileSync(CARS.main3)));
  assert.equal(c.kind, 'shell');
  assert.ok(c.wall > 2 && c.wall < 4.5, `wall ${c.wall}`);
  assert.equal(c.parts.length, 1);
});
