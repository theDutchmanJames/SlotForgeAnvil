import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applySymmetrize, symmetryReport } from '../src/geometry/symmetry.js';
import { bounds, meshStats } from '../src/geometry/engine.js';
import { volume } from '../src/geometry/shell.js';
import { box, shell } from './shapes.js';

// A 100 × 40 × 30 block on the centre line, its right side pushed out 3 mm
// over the middle third (a dent the other way round would do the same).
function lopsided() {
  const b = box(100, 40, 30, 12);
  for (let i = 0; i < b.positions.length; i += 3) {
    b.positions[i + 1] -= 20;
    const x = b.positions[i];
    if (b.positions[i + 1] > 19.99 && x > 33 && x < 67) b.positions[i + 1] += 3;
  }
  return b;
}

test('symmetrize: keep the left, mirror it over; closed, and both sides the same', () => {
  const out = applySymmetrize(lopsided(), { keep: 'left', at: 0 });
  const st = meshStats(out);
  assert.equal(st.openEdges, 0);
  assert.equal(st.faultyEdges, 0);
  assert.equal(st.parts, 1);
  const b = bounds(out.positions);
  assert.ok(Math.abs(b.max[1] - 20) < 1e-4 && Math.abs(b.min[1] + 20) < 1e-4, `y ${b.min[1]} … ${b.max[1]}`);
  assert.ok(Math.abs(volume(out) - 100 * 40 * 30) < 1);
});

test('symmetrize: keep the right, and its bump appears on both sides', () => {
  const out = applySymmetrize(lopsided(), { keep: 'right', at: 0 });
  const b = bounds(out.positions);
  assert.ok(Math.abs(b.max[1] - 23) < 1e-4 && Math.abs(b.min[1] + 23) < 1e-4);
  assert.equal(meshStats(out).openEdges, 0);
});

test('symmetrize: a hollow shell with an open underside stays clean', () => {
  const out = applySymmetrize(shell(), { keep: 'right', at: 0 });
  const st = meshStats(out);
  assert.equal(st.faultyEdges, 0);
  // Only the underside's opening is open, as before.
  assert.equal(st.openEdges, meshStats(shell()).openEdges);
});

test('symmetry report: finds the centre line of a body standing off centre', () => {
  const b = box(100, 40, 30, 12);
  for (let i = 0; i < b.positions.length; i += 3) b.positions[i + 1] -= 18.5; // middle at +1.5
  const r = symmetryReport(b);
  assert.ok(Math.abs(r.best - 1.5) < 0.05, `best ${r.best}`);
  assert.ok(r.atBest.most < 0.05 && r.atZero.most > 1, `at best ${r.atBest.most}, at 0 ${r.atZero.most}`);
  const lop = symmetryReport(lopsided());
  assert.ok(lop.atZero.most > 2, `most ${lop.atZero.most}`);
});
