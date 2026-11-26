import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyRebuild, insideVotes, rebuildGrid } from '../src/geometry/rebuild.js';
import { bounds, meshStats } from '../src/geometry/engine.js';
import { volume } from '../src/geometry/shell.js';
import { box, shell } from './shapes.js';

const moved = (m, dx, dy, dz) => ({ positions: m.positions.map((v, i) => v + [dx, dy, dz][i % 3]), indices: m.indices });
const join = (...ms) => {
  const pos = [], idx = [];
  for (const m of ms) {
    const off = pos.length / 3;
    pos.push(...m.positions);
    for (const v of m.indices) idx.push(v + off);
  }
  return { positions: Float32Array.from(pos), indices: Uint32Array.from(idx) };
};

test('rebuild: inside votes are all six for a closed box and none outside', () => {
  const b = box(10, 10, 10, 4);
  const grid = rebuildGrid(bounds(b.positions), 1);
  const votes = insideVotes(b, grid);
  const [nx, ny] = grid.n;
  const at = (x, y, z) => votes[Math.round((x - grid.o[0]) / 1) + nx * (Math.round((y - grid.o[1]) / 1) + ny * Math.round((z - grid.o[2]) / 1))];
  assert.equal(at(5, 5, 5), 6);
  assert.equal(at(-1, 5, 5), 0);
  assert.equal(at(5, 5, 11), 0);
});

test('rebuild: two overlapping boxes with a hole and doubled triangles become one clean closed piece', () => {
  const a = box(20, 10, 10, 6), b = moved(box(20, 10, 10, 6), 10, 3, 2);
  const m = join(a, b);
  // A hole: take out four triangles of the first box's top; double a few of the second's.
  const idx = Array.from(m.indices);
  const topStart = 6 * 6 * 3; // the second face of box() is the top
  idx.splice(topStart, 12);
  idx.push(...idx.slice(-9));
  const broken = { positions: m.positions, indices: Uint32Array.from(idx) };
  const sb = meshStats(broken);
  assert.ok(sb.openEdges > 0 && sb.faultyEdges > 0 && sb.parts > 1, 'the input is broken');
  const out = applyRebuild(broken, { cell: 0.4 });
  const st = meshStats(out);
  assert.equal(st.openEdges, 0);
  assert.equal(st.faultyEdges, 0);
  assert.equal(st.parts, 1);
  // The union: 2000 + 2000 less the overlap 10 × 7 × 8 = 560.
  const v = volume(out);
  assert.ok(Math.abs(v - 3440) < 3440 * 0.03, `volume ${v}`);
  const ob = bounds(out.positions);
  // Where the hole was, nothing is there to snap to: the patch is good to half a grid cell.
  assert.ok(Math.abs(ob.size[0] - 30) < 0.21 && Math.abs(ob.size[2] - 12) < 0.21, `size ${ob.size}`);
});

test('rebuild: a hollow shell stays a shell with the same wall', () => {
  const out = applyRebuild(shell(), { cell: 0.3 });
  const st = meshStats(out);
  assert.equal(st.faultyEdges, 0);
  assert.equal(st.openEdges, 0);
  // Wall 1 mm: about 2 × 100 × 40 + 2 × 140 × 29.5 of area times 1 mm.
  const v = volume(out);
  assert.ok(v > 11000 && v < 13500, `volume ${v}`);
});

test('rebuild: a single surface with no space inside says so', () => {
  const flat = { positions: Float32Array.from([0, 0, 0, 10, 0, 0, 0, 10, 0]), indices: Uint32Array.from([0, 1, 2]) };
  assert.throws(() => applyRebuild(flat, { cell: 0.5 }), /encloses no space/);
});
