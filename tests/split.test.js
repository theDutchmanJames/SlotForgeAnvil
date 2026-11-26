import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyCutoff } from '../src/geometry/cutoff.js';
import { bounds, meshStats } from '../src/geometry/engine.js';
import { volume } from '../src/geometry/shell.js';
import { box } from './shapes.js';

// A 40 × 40 × 20 block with a 6 × 6 post standing in it from z = 15 to 35,
// its middle at (20, 0). A wing leg, more or less.
function model(postW = 6) {
  const b = box(40, 40, 20, 6);
  for (let i = 0; i < b.positions.length; i += 3) b.positions[i + 1] -= 20;
  const p = box(postW, postW, 20, 4);
  for (let i = 0; i < p.positions.length; i += 3) {
    p.positions[i] += 20 - postW / 2;
    p.positions[i + 1] -= postW / 2;
    p.positions[i + 2] += 15;
  }
  const off = b.positions.length / 3;
  return {
    positions: Float32Array.from([...b.positions, ...p.positions]),
    indices: Uint32Array.from([...b.indices, ...Array.from(p.indices, (v) => v + off)]),
  };
}
const cut = { at: [20, 0, 25.3], normal: [0, 0, 1], up: [1, 0, 0], w: 10, h: 10 };

test('split off: the part is kept, moved away, both faces closed, with a pin and a hole', () => {
  const out = applyCutoff(model(), { cuts: [cut], split: { gap: 10 } });
  const st = meshStats(out);
  assert.equal(st.openEdges, 0);
  assert.equal(st.faultyEdges, 0);
  assert.equal(out.info.pins, 1);
  assert.deepEqual(out.info.warnings, []);
  // Block, lower post, upper post (moved up 10), and the pin.
  assert.equal(st.parts, 4);
  const b = bounds(out.positions);
  assert.ok(Math.abs(b.max[2] - 45) < 1e-3, `top ${b.max[2]}`);
  // The volume: block + post, plus the pin, less the hole (a little bigger than the pin).
  const r = 0.75, rh = 0.85, len = 3;
  const area = (rr) => 24 * 0.5 * rr * rr * Math.sin((2 * Math.PI) / 24); // the 24-sided circle
  const expect = 40 * 40 * 20 + 6 * 6 * 20 + area(r) * (len + 0.5) - area(rh) * (len + 0.3);
  assert.ok(Math.abs(volume(out) - expect) < 0.05, `volume ${volume(out)} vs ${expect}`);
});

test('split off: pins on the part or on the body, both closed', () => {
  for (const on of ['part', 'body']) {
    const out = applyCutoff(model(), { cuts: [cut], split: { on, gap: 8 } });
    const st = meshStats(out);
    assert.equal(st.openEdges, 0, `${on}: open`);
    assert.equal(st.faultyEdges, 0, `${on}: faulty`);
    assert.equal(out.info.pins, 1);
  }
});

test('split off: two pins when asked and there is room; a thin leg says there is no room', () => {
  const wide = applyCutoff(model(10), { cuts: [{ ...cut, w: 14, h: 14 }], split: { count: 2 } });
  assert.equal(wide.info.pins, 2);
  assert.equal(meshStats(wide).openEdges, 0);
  const thin = applyCutoff(model(2), { cuts: [cut], split: {} });
  assert.equal(thin.info.pins, 0);
  assert.match(thin.info.warnings[0], /No room for a 1.5 mm pin/);
  assert.equal(meshStats(thin).openEdges, 0);
});

test('split off: a short part gets a shorter pin', () => {
  // Cut 1.6 mm below the top of the post: the part is too thin for a 3 mm hole.
  const out = applyCutoff(model(), { cuts: [{ ...cut, at: [20, 0, 33.4] }], split: { on: 'part' } });
  assert.match(out.info.warnings.join(' '), /No room for a pin hole|shortened/);
  assert.equal(meshStats(out).openEdges, 0);
});
