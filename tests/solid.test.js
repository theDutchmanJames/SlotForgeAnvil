import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applySolid, solidPreview } from '../src/geometry/solid.js';
import { applySlice, meshStats } from '../src/geometry/engine.js';
import { applyHollow, volume } from '../src/geometry/shell.js';
import { box, shell } from './shapes.js';

test('make solid: a hollow shell loses its inner skin and is closed', () => {
  const s = shell();
  const pv = solidPreview(s);
  assert.equal(pv.error, undefined);
  assert.ok(pv.share > 0.3 && pv.share < 0.6, `share ${pv.share}`);
  assert.ok(Math.abs(pv.wall - 1) < 0.2, `wall ${pv.wall}`);
  const out = applySolid(s);
  const st = meshStats(out);
  assert.equal(st.openEdges, 0);
  assert.equal(st.faultyEdges, 0);
  assert.equal(out.info.closed, 1);
  // The whole box above the floor line, not just its wall.
  const v = volume(out);
  assert.ok(Math.abs(v - 100 * 40 * 29.5) < 300, `volume ${v}`);
});

test('make solid: with a flat bottom, solid all the way across at that height', () => {
  const out = applySolid(shell(), { bottom: 10 });
  const st = meshStats(out);
  assert.equal(st.openEdges, 0);
  assert.equal(st.faultyEdges, 0);
  assert.ok(Math.abs(st.bounds.min[2] - 10) < 1e-4);
  const v = volume(out);
  assert.ok(Math.abs(v - 100 * 40 * 20) < 200, `volume ${v}`);
  assert.throws(() => applySolid(shell(), { bottom: 40 }), /above the car/);
});

test('make solid: wheel arches cut into the sides are closed flat too', () => {
  // Two half-round notches out of each side, like wheel arches, before hollowing.
  const b = box(100, 40, 30, 20);
  for (let i = 1; i < b.positions.length; i += 3) b.positions[i] -= 20;
  const notched = applySlice(b, { axis: 'z', at: 0.5, keep: 'above' });
  const keep = [];
  for (let f = 0; f < notched.indices.length / 3; f++) {
    const c = [0, 1, 2].map((k) => (notched.positions[notched.indices[f * 3] * 3 + k] + notched.positions[notched.indices[f * 3 + 1] * 3 + k] + notched.positions[notched.indices[f * 3 + 2] * 3 + k]) / 3);
    const arch = [20, 80].some((x) => Math.hypot(c[0] - x, c[2]) < 12);
    if (!arch) keep.push(notched.indices[f * 3], notched.indices[f * 3 + 1], notched.indices[f * 3 + 2]);
  }
  const s = applyHollow({ positions: notched.positions, indices: Uint32Array.from(keep) }, { wall: 1 });
  for (const bottom of [null, 5]) {
    const out = applySolid(s, { bottom });
    const st = meshStats(out);
    assert.equal(st.openEdges, 0, `bottom ${bottom}: open edges`);
    assert.equal(st.faultyEdges, 0, `bottom ${bottom}: faulty edges`);
  }
});

test('make solid: a loose piece inside the body (a seat) is taken out', () => {
  const s = shell();
  const seat = box(10, 10, 5, 2);
  for (let i = 0; i < seat.positions.length; i += 3) {
    seat.positions[i] += 40;
    seat.positions[i + 1] -= 5;
    seat.positions[i + 2] += 5;
  }
  const off = s.positions.length / 3;
  const m = {
    positions: Float32Array.from([...s.positions, ...seat.positions]),
    indices: Uint32Array.from([...s.indices, ...Array.from(seat.indices, (v) => v + off)]),
  };
  const out = applySolid(m);
  assert.equal(out.info.inside, 1);
  const st = meshStats(out);
  assert.equal(st.parts, 1);
  assert.equal(st.openEdges, 0);
});

test('make solid: a model that is already solid is left alone', () => {
  const b = box(100, 40, 30, 8);
  assert.throws(() => applySolid(b), /No inner skin/);
  assert.match(solidPreview(b).error, /No inner skin/);
});
