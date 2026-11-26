import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyMounts, prism } from '../src/geometry/mounts.js';
import { bounds, meshStats } from '../src/geometry/engine.js';
import { volume } from '../src/geometry/shell.js';
import { shell } from './shapes.js';

// The test shell: 100 × 40 × 30, 1 mm wall (inside of the side wall at |y| = 19), open underneath.
const added = (before, after) => ({
  positions: after.positions.slice(before.positions.length),
  indices: after.indices.slice(before.indices.length).map((v) => v - before.positions.length / 3),
});

test('prism: a closed piece facing outwards, also with a hole', () => {
  const p = prism([[0, 0], [10, 0], [10, 6], [0, 6]], [[[5, 3], [6, 3], [6, 4], [5, 4]]], 0, 2, (u, v, a) => [u, v, a]);
  const m = { positions: Float32Array.from(p.positions), indices: Uint32Array.from(p.indices) };
  assert.equal(meshStats(m).openEdges, 0);
  assert.ok(Math.abs(volume(m) - (60 - 1) * 2) < 1e-6);
  // Mirrored (left side): still outwards.
  const q = prism([[0, 0], [10, 0], [10, 6]], [], 0, 2, (u, v, a) => [u, -v, a]);
  assert.ok(volume({ positions: Float32Array.from(q.positions), indices: Uint32Array.from(q.indices) }) > 0);
});

test('screw tabs stick in from the side wall with a hole, on both sides', () => {
  const s = shell();
  const out = applyMounts(s, { tabs: [{ kind: 'screw', x: 50, side: 1 }, { kind: 'screw', x: 50, side: -1 }], base: 5 });
  assert.equal(out.info.warnings.length, 0);
  assert.equal(out.info.made, 6); // two tabs, two ribs each
  const tabs = added(s, out);
  assert.equal(meshStats(tabs).openEdges, 0);
  assert.ok(volume(tabs) > 0);
  const b = bounds(tabs.positions);
  // Into the wall by 0.5, 6 in from it; from the base up to the ribs.
  assert.ok(Math.abs(b.max[1] - 19.5) < 0.05 && Math.abs(b.min[1] + 19.5) < 0.05, `y ${b.min[1]} … ${b.max[1]}`);
  assert.ok(Math.abs(b.min[2] - 5) < 1e-4);
  // Plate alone: 6 × 6.5 × 1.6 less the hole, about 61 mm³ per tab.
});

test('clip tabs hook under the chassis edge; too narrow or no wall is a warning', () => {
  const s = shell();
  const p = { edge: 15, catchZ: 4, ground: 0 };
  const out = applyMounts(s, { tabs: [{ kind: 'clip', x: 30, side: 1 }], ...p });
  assert.equal(out.info.made, 1);
  const clip = added(s, out);
  assert.equal(meshStats(clip).openEdges, 0);
  assert.ok(volume(clip) > 0);
  const b = bounds(clip.positions);
  // The hook reaches in to the chassis edge less its depth, down to 4 - 1.2.
  assert.ok(Math.abs(b.min[1] - (15 + 0.15 - 0.8)) < 1e-3, `inner ${b.min[1]}`);
  assert.ok(Math.abs(b.min[2] - 2.8) < 1e-3 && Math.abs(b.max[2] - 10) < 1e-3);
  const narrow = applyMounts(s, { tabs: [{ kind: 'clip', x: 30, side: 1 }], ...p, edge: 18.5 });
  assert.equal(narrow.info.made, 0);
  assert.match(narrow.info.warnings[0], /too close to the chassis edge/);
  const off = applyMounts(s, { tabs: [{ kind: 'screw', x: 200, side: 1 }], base: 5 });
  assert.match(off.info.warnings[0], /No side wall/);
});
