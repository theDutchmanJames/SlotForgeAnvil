import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applySlice, meshStats, sliceTabs } from '../src/geometry/engine.js';
import { applyCutoff } from '../src/geometry/cutoff.js';
import { spreadTabs } from '../src/geometry/gluetabs.js';
import { box, shell } from './shapes.js';

// The test shell: 100 × 40 × 30, 1 mm wall, open underneath. Cut across at x = 50.
const plane = { axis: 'x', at: 50.3 };

test('glue tabs: only on the inside edge of a hollow body, sticking out past the cut', () => {
  const s = shell();
  const g = sliceTabs(s, plane, { on: 'below', tabs: spreadTabs(4) });
  assert.equal(g.placed.length, 4);
  assert.deepEqual(g.warnings, []);
  // The inside edge is the inside of the U the wall makes: sides and roof, 28 + 38 + 28 or so.
  assert.ok(Math.abs(g.edge.total - (2 * 28.5 + 38)) < 2, `inside edge ${g.edge.total}`);
  for (const p of g.pieces) {
    for (let i = 0; i < p.positions.length; i += 3) {
      const [x, y, z] = [p.positions[i], p.positions[i + 1], p.positions[i + 2]];
      // Never out through the outside of the wall.
      // (The test shell's inside is within a few hundredths of 19 and 29.)
      assert.ok(Math.abs(y) <= 19.45 && z <= 29.45, `corner ${x}, ${y}, ${z}`);
      // Past the cut, a clearance off where the other wall goes.
      if (x > 50.31) assert.ok(Math.abs(y) <= 19 - 0.15 + 0.05 && z <= 29 - 0.15 + 0.05 && x <= 54.31, `strip corner ${x}, ${y}, ${z}`);
    }
  }
});

test('glue tabs: added to the slice, as closed pieces moving with their half', () => {
  const s = shell();
  const plain = applySlice(s, { ...plane, keep: 'both', cap: true, gap: 10 });
  const glued = applySlice(s, { ...plane, keep: 'both', cap: true, gap: 10, glue: { on: 'above', tabs: spreadTabs(3) } });
  assert.equal(glued.info.glue, 3);
  // The tabs are closed: no more open edges than without them.
  assert.equal(meshStats(glued).openEdges, meshStats(plain).openEdges);
  assert.equal(meshStats(glued).faultyEdges, 0);
  // On the upper half (moved 10 on): their strips reach back over the cut, towards the other half.
  let low = Infinity;
  for (let i = plain.positions.length; i < glued.positions.length; i += 3) low = Math.min(low, glued.positions[i]);
  assert.ok(Math.abs(low - (50.3 + 10 - 4)) < 1e-3, `strip reaches ${low}`);
});

test('glue tabs: the mirrored copy of a cut gets the same tabs, exactly mirrored', async () => {
  const { splitTabPreview } = await import('../src/geometry/cutoff.js');
  // The back right corner cut off on a slant; the back left one as its mirror.
  const cut = { at: [93.1, 13.1, 15.2], normal: [Math.SQRT1_2, Math.SQRT1_2, 0], up: [0, 0, 1], w: 40, h: 24 };
  for (const s of [0.2, 0.8]) {
    const params = { cuts: [cut], mirror: true, split: { count: 0, gap: 5, glue: { on: 'body', tabs: [{ s, k: 0 }], width: 3, reach: 2, thick: 0.6, clearance: 0.1 } } };
    const pv = splitTabPreview(shell(), params);
    assert.equal(pv.placed.length, 2);
    const [a, b] = pv.placed;
    assert.ok(Math.hypot(a.at[0] - b.at[0], a.at[1] + b.at[1], a.at[2] - b.at[2]) < 1e-9);
    const out = applyCutoff(shell(), params);
    assert.equal(out.info.glue, 2);
    assert.equal(meshStats(out).openEdges, meshStats(shell()).openEdges);
    assert.equal(meshStats(out).faultyEdges, 0);
  }
});

test('glue tabs: a solid part has no inside edge, and says so', () => {
  const b = box(40, 40, 20, 6);
  const out = applyCutoff(b, { cuts: [{ at: [20, 20, 17.3], normal: [0, 0, 1], up: [1, 0, 0], w: 60, h: 60 }], split: { count: 0, glue: { tabs: spreadTabs(2) } } });
  assert.equal(out.info.glue, 0);
  assert.match(out.info.warnings.join(' '), /No inside edge/);
});
