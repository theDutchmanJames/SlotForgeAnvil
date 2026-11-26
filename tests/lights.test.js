import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyLights } from '../src/geometry/lights.js';
import { meshStats } from '../src/geometry/engine.js';
import { rayCaster } from '../src/geometry/rays.js';
import { box, shell } from './shapes.js';

// The test shell: 100 × 40 × 30, 1 mm wall, open underneath. A light on its
// front (x = 0), its middle off the grid so no corner lies on the bore.
const light = (over = {}) => ({ at: [0, 3.13, 15.07], normal: [-1, 0, 0], d: 3, length: 5.5, ...over });
const look = (m) => rayCaster(m.positions, m.indices)([-5, 3.13, 15.07], [1, 0, 0]) - 5; // from the outside, along the bore

test('open light: a bore through the wall with a socket behind, the wall closed round it', () => {
  const s = shell();
  const out = applyLights(s, { lights: [light()] });
  const st = meshStats(out);
  assert.equal(st.openEdges, meshStats(s).openEdges);
  assert.equal(st.faultyEdges, 0);
  assert.deepEqual(out.info.warnings, []);
  // Looking down the bore: right through the front wall and the socket, to the back wall.
  assert.ok(look(out) > 90, `first surface at ${look(out)}`);
  // Off to the side of the bore, inside the socket's wall: the socket is there.
  const cast = rayCaster(out.positions, out.indices);
  const tubeHit = cast([0.5, 3.13 + 2.1, 15.07], [1, 0, 0]);
  assert.ok(tubeHit < 1, `socket wall at ${tubeHit}`);
});

test('window light: a thin skin is left on the outside', () => {
  // Wall 1 mm: a 0.9 mm skin leaves no room for the bore. Made open, and said.
  const thin = applyLights(shell(), { lights: [light({ mode: 'window', skin: 0.9 })] });
  assert.match(thin.info.warnings.join(' '), /too thin to leave a window/);
  // A 2 mm wall takes a window with a 0.4 mm skin.
  const out2 = applyLights(shell2(), { lights: [light({ mode: 'window', skin: 0.4 })] });
  assert.deepEqual(out2.info.warnings, []);
  const first = look(out2);
  assert.ok(Math.abs(first) < 0.01, `outside skin still there: first hit at ${first}`);
  // Behind the skin: the bore, then the far wall.
  const cast = rayCaster(out2.positions, out2.indices);
  assert.ok(cast([0.2, 3.13, 15.07], [1, 0, 0]) - 0.2 < 0.25, 'skin 0.4 thick');
  assert.ok(cast([0.45, 3.13, 15.07], [1, 0, 0]) > 50, 'bore open behind the skin');
  assert.equal(meshStats(out2).faultyEdges, 0);
  assert.equal(meshStats(out2).openEdges, 0);
});

test('solid body: a blind hole as deep as the LED', () => {
  const b = box(100, 40, 30, 16);
  for (let i = 1; i < b.positions.length; i += 3) b.positions[i] -= 20;
  const out = applyLights(b, { lights: [light()] });
  const st = meshStats(out);
  assert.equal(st.openEdges, 0);
  assert.equal(st.faultyEdges, 0);
  const cast = rayCaster(out.positions, out.indices);
  const bottom = cast([0.3, 3.13, 15.07], [1, 0, 0]) + 0.3;
  assert.ok(Math.abs(bottom - 5.5) < 0.01, `hole bottom at ${bottom}`);
  const off = applyLights(b, { lights: [light({ at: [-50, 0, 15] })] });
  assert.match(off.info.warnings[0], /not on the body/);
});

// A shell with a 2 mm wall.
function shell2() {
  const outer = box(100, 40, 30, 16), inner = box(96, 36, 28, 16);
  const pos = [...outer.positions];
  for (let i = 0; i < inner.positions.length; i += 3) pos.push(inner.positions[i] + 2, inner.positions[i + 1] + 2, inner.positions[i + 2] + 2);
  const off = outer.positions.length / 3;
  const idx = [...outer.indices];
  for (let i = 0; i < inner.indices.length; i += 3) idx.push(inner.indices[i] + off, inner.indices[i + 2] + off, inner.indices[i + 1] + off);
  for (let i = 1; i < pos.length; i += 3) pos[i] -= 20;
  return { positions: Float32Array.from(pos), indices: Uint32Array.from(idx) };
}
