import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyPanelLines, applyText, grooves, refine } from '../src/geometry/detail.js';
import { meshStats } from '../src/geometry/engine.js';
import { volume } from '../src/geometry/shell.js';
import { box } from './shapes.js';

// An "O": 6 × 8 outside, a 3 × 5 hole. Letter area 48 − 15 = 33 mm².
const O = [
  [[-3, -4], [3, -4], [3, 4], [-3, 4]],
  [[-1.5, -2.5], [-1.5, 2.5], [1.5, 2.5], [1.5, -2.5]],
];

test('refine: finer triangles, still closed and the same shape', () => {
  const b = box(10, 10, 10, 2);
  const out = refine(b, (a, c) => Math.hypot(a[0] - c[0], a[1] - c[1], a[2] - c[2]) > 1.2);
  const st = meshStats(out);
  assert.equal(st.openEdges, 0);
  assert.equal(st.faultyEdges, 0);
  assert.ok(out.indices.length > b.indices.length * 10);
  assert.ok(Math.abs(volume(out) - 1000) < 1e-6);
});

test('text: raised and cut in by its depth over the letter area, the body stays closed', () => {
  const b = box(40, 20, 10, 4);
  const at = [20.13, 10.07, 10], normal = [0, 0, 1], up = [0, 1, 0];
  for (const [mode, sign] of [['raise', 1], ['cut', -1]]) {
    const out = applyText(b, { texts: [{ at, normal, up, polys: O, mode, depth: 0.5 }] });
    const st = meshStats(out);
    assert.equal(st.openEdges, 0, `${mode}: open`);
    assert.equal(st.faultyEdges, 0, `${mode}: faulty`);
    // The walls slope over at most an edge's width (0.05 mm): close to 33 × 0.5.
    const dv = volume(out) - 8000;
    assert.ok(Math.abs(dv - sign * 16.5) < 0.8, `${mode}: volume changed by ${dv}`);
    assert.deepEqual(out.info.warnings, []);
  }
});

test('text: the far side and the inside of the wall are left alone', () => {
  const b = box(40, 20, 10, 4);
  // Facing down at the bottom: nothing on top may move.
  const out = applyText(b, { texts: [{ at: [20.13, 10.07, 0], normal: [0, 0, -1], up: [0, 1, 0], polys: O, mode: 'raise', depth: 0.5 }] });
  let low = Infinity, high = -Infinity;
  for (let i = 2; i < out.positions.length; i += 3) (low = Math.min(low, out.positions[i])), (high = Math.max(high, out.positions[i]));
  assert.ok(Math.abs(low + 0.5) < 1e-4 && Math.abs(high - 10) < 1e-4, `${low} … ${high}`);
  // Off the body: a warning.
  const off = applyText(b, { texts: [{ at: [200, 0, 10], normal: [0, 0, 1], up: [0, 1, 0], polys: O, mode: 'raise', depth: 0.5 }] });
  assert.match(off.info.warnings[0], /not on the body/);
});

test('panel lines: a shallow groove is found and made deeper; edges of the body are not grooves', () => {
  // A 40 × 40 × 10 block, 1 mm grid; a 0.1 mm deep groove along y = 20 on top.
  const b = box(40, 40, 10, 40);
  const P = b.positions;
  for (let i = 0; i < P.length; i += 3) if (P[i + 2] === 10 && P[i + 1] === 20 && P[i] > 0 && P[i] < 40) P[i + 2] = 9.9;
  const g = grooves(b, { radius: 2, min: 0.04 });
  let found = 0, wrong = 0;
  for (let v = 0; v < g.depth.length; v++) {
    if (!g.depth[v]) continue;
    if (P[v * 3 + 2] === 9.9 || Math.abs(P[v * 3 + 2] - 9.9) < 1e-5) found++;
    else wrong++;
  }
  assert.ok(found >= 30, `found ${found}`);
  assert.equal(wrong, 0);
  const out = applyPanelLines(b, { depth: 0.5, radius: 2 });
  let deepest = Infinity;
  for (let i = 0; i < out.positions.length; i += 3) if (Math.abs(out.positions[i + 1] - 20) < 1e-5 && out.positions[i] > 5 && out.positions[i] < 35 && out.positions[i + 2] > 5) deepest = Math.min(deepest, out.positions[i + 2]);
  assert.ok(Math.abs(deepest - 9.5) < 0.02, `bottom at ${deepest}`);
  assert.equal(meshStats(out).openEdges, 0);
  // A plain block has no grooves.
  assert.throws(() => applyPanelLines(box(40, 40, 10, 10), { depth: 0.5 }), /No panel lines found/);
});
