// Find windows: openings the model came with, framed panes, left and right
// as one mirrored window, few points with the corners kept.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { simplify, traceWindows } from '../src/geometry/trace.js';
import { applyWindows } from '../src/geometry/windows.js';
import { box, shell } from './shapes.js';
import { readSTLMesh } from '../src/geometry/stl-mesh.js';
import { guessOrient, replay } from '../src/geometry/engine.js';
import { model } from './models.js';

// The shell is 100 × 40 × 30 with a 1 mm wall, centred on Y = 0.
const side = (y, extra = {}) => ({
  id: `s${y}`,
  name: 'Side',
  points: [[30, y, 16], [60, y, 16], [60, y, 26], [30, y, 26]],
  corners: [true, true, true, true],
  normal: [0, Math.sign(y), 0],
  mirror: false,
  state: 'open',
  ...extra,
});
const near = (p, q, tol) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) < tol;

test('openings the model came with are found, left and right as one mirrored window', () => {
  const body = applyWindows(shell(), { windows: [side(-20), side(20)], depth: 3, fine: true });
  const { found } = traceWindows(body);
  const sides = found.filter((w) => w.kind === 'opening' && w.centre[2] > 15);
  assert.equal(sides.length, 1, JSON.stringify(found.map((w) => [w.kind, w.centre])));
  const w = sides[0];
  assert.equal(w.mirror, true);
  assert.ok(w.centre[1] < 0, 'the left one is kept');
  assert.ok(Math.abs(w.normal[1] + 1) < 0.05, `faces out: ${w.normal}`);
  assert.equal(w.corners.filter(Boolean).length, 4, 'the four corners');
  assert.ok(w.points.length <= 16, `few points: ${w.points.length}`);
  for (const c of [[30, -20, 16], [60, -20, 16], [60, -20, 26], [30, -20, 26]])
    assert.ok(w.points.some((p) => near(p, c, 0.6)), `corner ${c}`);
  assert.equal(w.likely, true);
});

test('a pane set into a frame is found, with how far it sits below the frame', () => {
  const body = applyWindows(shell(), { windows: [side(-20, { state: 'recess' })], depth: 3, fine: true, recess: 0.4 });
  const { found } = traceWindows(body);
  const pane = found.find((w) => w.kind === 'recess' && w.centre[2] > 15 && w.centre[1] < -15);
  assert.ok(pane, JSON.stringify(found.map((w) => [w.kind, w.centre])));
  assert.ok(pane.step > 0.25 && pane.step < 0.5, `step ${pane.step}`);
  assert.equal(pane.mirror, false);
});

test('a plain body has no windows to find', () => {
  const { found } = traceWindows(shell());
  assert.equal(found.filter((w) => w.likely).length, 0);
  const solid = box(100, 40, 30, 16);
  assert.equal(traceWindows(solid).found.length, 0);
});

test('an outline from a found edge: corners sharp, points only where needed, dents pointed out', () => {
  // A 20 × 10 rectangle with a small dent in its top edge.
  const loop = [];
  for (let x = 0; x < 20; x += 0.25) loop.push([x, 0, 0]);
  for (let y = 0; y < 10; y += 0.25) loop.push([20, y, 0]);
  for (let x = 20; x > 0; x -= 0.25) loop.push([x, 10 - (Math.abs(x - 10) < 1 ? 1 - Math.abs(x - 10) : 0), 0]);
  for (let y = 10; y > 0; y -= 0.25) loop.push([0, y, 0]);
  const s = simplify(loop, [0, 0, 1], 0.3);
  assert.ok(s.corners.filter(Boolean).length >= 4);
  assert.ok(s.points.length < 30, `${s.points.length} points`);
  assert.ok(s.doubt.some((p) => Math.abs(p[0] - 10) < 1.5 && p[1] > 8), `dent at the top: ${JSON.stringify(s.doubt)}`);
});

const DATSUN = model('datsun.stl');
test('test car Datsun: its windscreen, both pairs of side windows and its rear window', { skip: !existsSync(DATSUN) }, () => {
  const src = readSTLMesh(readFileSync(DATSUN));
  const car = replay(src, [{ id: 'o', type: 'orient', enabled: true, params: guessOrient(src) }]).mesh;
  const likely = traceWindows(car).found.filter((w) => w.likely);
  assert.equal(likely.length, 4, JSON.stringify(likely.map((w) => [w.kind, w.centre])));
  assert.equal(likely.filter((w) => w.mirror).length, 2);
  for (const w of likely) assert.ok(w.points.length <= 40, `${w.points.length} points`);
});
