import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyCutoff, cutoffPreview } from '../src/geometry/cutoff.js';
import { bounds, meshStats } from '../src/geometry/engine.js';
import { box } from './shapes.js';

// A 40 × 40 × 20 block on the centre line with a spike (a "mirror") pulled
// up from its top at each given Y.
function blockWithSpikes(ys) {
  const b = box(40, 40, 20, 8);
  for (let i = 0; i < b.positions.length; i += 3) b.positions[i + 1] -= 20;
  for (let i = 0; i < b.positions.length; i += 3)
    if (b.positions[i] === 20 && b.positions[i + 2] === 20 && ys.includes(b.positions[i + 1])) b.positions[i + 2] = 40;
  return b;
}
const topZ = (m) => bounds(m.positions).max[2];
const cut = (y, w = 8) => ({ at: [20, y, 30], normal: [0, 0, 1], up: [1, 0, 0], w, h: w });

test('cut off: a small plane takes off a spike and closes the cut', () => {
  const m = blockWithSpikes([0]);
  const out = applyCutoff(m, { cuts: [cut(0)] });
  assert.ok(Math.abs(topZ(out) - 30) < 1e-4, `top now ${topZ(out)}`);
  const st = meshStats(out);
  assert.equal(st.openEdges, 0);
  assert.equal(st.faultyEdges, 0);
  assert.equal(out.info.capped, 1);
  // Left open when asked.
  assert.ok(meshStats(applyCutoff(m, { cuts: [cut(0)], open: true })).openEdges > 0);
});

test('cut off: mirrored, both spikes go; the preview shows the same faces', () => {
  const m = blockWithSpikes([-10, 10]);
  const out = applyCutoff(m, { cuts: [cut(-10)], mirror: true });
  assert.ok(Math.abs(topZ(out) - 30) < 1e-4);
  assert.equal(out.info.capped, 2);
  assert.equal(meshStats(out).openEdges, 0);
  const one = applyCutoff(m, { cuts: [cut(-10)] });
  assert.ok(topZ(one) > 39, 'without mirroring the other spike stays');
  const p = cutoffPreview(m, { cuts: [cut(-10)], mirror: true });
  assert.equal(p.error, null);
  assert.ok(p.faces.some(Boolean) && p.share < 0.1);
});

test('cut off: a plane too small to go round, or one that frees most of the model, stops', () => {
  const m = blockWithSpikes([0]);
  // The spike is 5 wide at Z = 30: a 2 wide plane cannot go round it.
  assert.throws(() => applyCutoff(m, { cuts: [cut(0, 2)] }), /does not cut through/);
  // A big plane low down "frees" the whole top of the block.
  const low = { at: [20, 0, 6], normal: [0, 0, 1], up: [1, 0, 0], w: 60, h: 60 };
  assert.throws(() => applyCutoff(m, { cuts: [low] }), /most of the model/);
  assert.match(cutoffPreview(m, { cuts: [low] }).error, /most of the model/);
  // Facing the other way, the plane would keep the spike and take the rest.
  assert.throws(() => applyCutoff(m, { cuts: [{ ...cut(0), normal: [0, 0, -1] }] }), /most of the model/);
});

test('cut off: a plane that also crosses the body only cuts where it goes all round', () => {
  // Tilted so it runs into the block's top as well; only the spike's line fits.
  const m = blockWithSpikes([0]);
  const out = applyCutoff(m, { cuts: [{ at: [20, 0, 30], normal: [0.3, 0, 1], up: [1, 0, 0], w: 9, h: 9 }] });
  assert.ok(topZ(out) < 33 && topZ(out) > 27);
  assert.equal(meshStats(out).openEdges, 0);
  assert.equal(meshStats(out).faultyEdges, 0);
});
