import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applySlice, meshStats } from '../src/geometry/engine.js';
import { applyFloor, applyHollow } from '../src/geometry/shell.js';
import { applyArchCut } from '../src/geometry/arches.js';
import { box } from './shapes.js';

// A closed hollow box: a 1 mm wall all round, both skins, no openings.
function closedShell() {
  const outer = box(100, 40, 30, 16);
  const inner = box(98, 38, 28, 16);
  const pos = [...outer.positions];
  for (let i = 0; i < inner.positions.length; i += 3) pos.push(inner.positions[i] + 1, inner.positions[i + 1] + 1, inner.positions[i + 2] + 1);
  const off = outer.positions.length / 3;
  const idx = [...outer.indices];
  // The inner skin faces into the hollow: turned round.
  for (let i = 0; i < inner.indices.length; i += 3) idx.push(inner.indices[i] + off, inner.indices[i + 2] + off, inner.indices[i + 1] + off);
  for (let i = 1; i < pos.length; i += 3) pos[i] -= 20;
  return { positions: Float32Array.from(pos), indices: Uint32Array.from(idx) };
}

test('floor line on a shell closes the wall along the cut and leaves the inside open', () => {
  const out = applyFloor(closedShell(), { mode: 'cut', at: 5 });
  const st = meshStats(out);
  assert.equal(st.openEdges, 0);
  assert.equal(st.faultyEdges, 0);
  assert.equal(out.info.walls, 1);
  // Inside still open: the floor is a ring, not a plate across the body.
  const flat = [];
  for (let f = 0; f < out.indices.length; f += 3) {
    const zs = [0, 1, 2].map((k) => out.positions[out.indices[f + k] * 3 + 2]);
    if (zs.every((z) => Math.abs(z - 5) < 1e-4)) flat.push(f);
  }
  let area = 0;
  for (const f of flat) {
    const [a, b, c] = [0, 1, 2].map((k) => out.indices[f + k] * 3);
    const p = out.positions;
    area += Math.abs((p[b] - p[a]) * (p[c + 1] - p[a + 1]) - (p[b + 1] - p[a + 1]) * (p[c] - p[a])) / 2;
  }
  assert.ok(Math.abs(area - (100 * 40 - 98 * 38)) < 1, `ring area ${area}`);
  // The old open behaviour is still there when asked.
  assert.ok(meshStats(applyFloor(closedShell(), { mode: 'cut', at: 5, closeWalls: false })).openEdges > 0);
});

test('floor line on a solid body still opens the underside for Hollow', () => {
  const b = box(100, 40, 30, 16);
  const out = applyFloor(b, { mode: 'cut', at: 2 });
  assert.ok(meshStats(out).openEdges > 0);
  assert.equal(out.info.walls, 0);
  assert.equal(meshStats(applyHollow(out, { wall: 1 })).openEdges, 0);
});

test('wheel arches cut through a shell close the wall round the cut', () => {
  const s = applyFloor(closedShell(), { mode: 'cut', at: 5 });
  const out = applyArchCut(s, { cuts: [{ x: 25.3, z: 5, r: 10 }, { x: 75.3, z: 5, r: 10 }], fine: true });
  const st = meshStats(out);
  assert.equal(st.openEdges, 0);
  assert.equal(st.faultyEdges, 0);
  assert.ok(out.info.walls >= 2);
});

test('closing a cut whose outline crosses itself (skins through each other) still closes it', async () => {
  const { capPlane } = await import('../src/geometry/finish.js');
  // A tube, open at the top (z = 10), whose cross-section is a figure eight.
  const ring = [[0, 0], [10, 6], [10, 0], [0, 6]]; // crosses itself between the 2nd and 4th side
  const N = ring.length;
  const pos = [], idx = [];
  for (const z of [0, 10]) for (const [x, y] of ring) pos.push(x, y, z);
  pos.push(5, 3, 0); // the bottom's middle
  for (let i = 0; i < N; i++) {
    const j = (i + 1) % N;
    idx.push(i, j, N + j, i, N + j, N + i); // the sides
    idx.push(2 * N, j, i); // the bottom, a fan
  }
  const tube = { positions: Float32Array.from(pos), indices: Uint32Array.from(idx) };
  assert.equal(meshStats(tube).openEdges, N, 'open at the top only');
  const c = capPlane(tube, 'z', 10);
  const st = meshStats(c.mesh);
  assert.equal(st.openEdges, 0);
  assert.equal(st.faultyEdges, 0);
});

test('slice: a closed cut through a shell is a ring', () => {
  const out = applySlice(closedShell(), { axis: 'x', at: 50, keep: 'below', cap: true, walls: true });
  assert.equal(meshStats(out).openEdges, 0);
  assert.equal(out.info.capped, 1);
});
