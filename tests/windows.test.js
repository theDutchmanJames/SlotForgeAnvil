import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { bounds, meshStats, replay } from '../src/geometry/engine.js';
import { applyFloor, applyHollow, volume } from '../src/geometry/shell.js';
import { applyWindows, pillarWarnings, windowOutlines } from '../src/geometry/windows.js';
import { sampleClosedCurve } from '../src/geometry/curve.js';
import { readSTLMesh } from '../src/geometry/stl-mesh.js';
import { box, shell } from './shapes.js';
import { model } from './models.js';

// A side window on the -Y side (it faces -Y).
const side = (x0 = 30, x1 = 60, extra = {}) => ({
  id: 'w1',
  name: 'Side window',
  points: [[x0, -20, 12], [x1, -20, 12], [x1, -20, 24], [x0, -20, 24]],
  corners: [true, true, true, true],
  normal: [0, -1, 0],
  mirror: true,
  open: true,
  ...extra,
});

test('a curve through clicked points passes through them; corners stay sharp', () => {
  const pts = [[0, 0, 0], [10, 0, 0], [10, 10, 0], [0, 10, 0]];
  const c = sampleClosedCurve(pts, [true, true, true, true], 1);
  for (const p of pts) assert.ok(c.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < 1e-9));
  assert.ok(c.every((q) => q[0] >= -1e-9 && q[0] <= 10 + 1e-9), 'straight between corners');
  const smooth = sampleClosedCurve(pts, [], 1);
  assert.ok(smooth.some((q) => q[0] > 10.5), 'smooth points bulge out');
});

test('an open window is cut through both skins and the cut edge is closed', () => {
  const body = shell();
  const out = applyWindows(body, { windows: [side()], depth: 3 });
  assert.deepEqual(out.info.warnings, []);
  assert.equal(out.info.cut, 2, 'and its mirror');
  const s = meshStats(out);
  assert.equal(s.openEdges, 0);
  assert.equal(s.faultyEdges, 0);
  assert.ok(volume(out) > 0 && volume(out) < volume(body));
  // Nothing is left in the window, on either side.
  for (let i = 0; i < out.positions.length; i += 3) {
    const [x, y, z] = [out.positions[i], out.positions[i + 1], out.positions[i + 2]];
    if (Math.abs(Math.abs(y) - 19.5) < 0.6) assert.ok(!(x > 30.01 && x < 59.99 && z > 12.01 && z < 23.99), `left in the opening: ${x},${y},${z}`);
  }
  // The roof and the far side are untouched elsewhere.
  assert.ok(Math.abs(bounds(out.positions).size[1] - 40) < 1e-4);
});

test('a solid window is only an outline, and close windows warn about the pillar', () => {
  const body = shell();
  const out = applyWindows(body, { windows: [side(30, 60, { open: false })] });
  assert.equal(out.info.cut, 0);
  assert.equal(out.indices.length, body.indices.length);
  const w = pillarWarnings([side(30, 60, { mirror: false }), side(61, 80, { id: 'w2', name: 'Rear side', mirror: false })]);
  assert.equal(w.length, 1);
  assert.ok(w[0].distance < 1.5);
  assert.equal(windowOutlines([side()]).length, 2);
});

test('a recessed window sinks the glass by its depth, sharp at the outline; the body stays closed', () => {
  const body = shell();
  const out = applyWindows(body, { windows: [side(30.3, 60.3, { state: 'recess' })], recess: 0.3 });
  assert.deepEqual(out.info.warnings, []);
  assert.equal(out.info.recessed, 2);
  const s = meshStats(out);
  assert.equal(s.openEdges, meshStats(body).openEdges);
  assert.equal(s.faultyEdges, 0);
  // 30 × 12 of glass, 0.3 deep, on both sides.
  const dv = volume(body) - volume(out);
  assert.ok(Math.abs(dv - 2 * 30 * 12 * 0.3) < 4, `volume less by ${dv}`);
});

test('a filled window closes an opening the model came with: a pane as thick as the wall', () => {
  const body = shell();
  // The opening the model "came with": cut first, then filled with the same outline.
  const cut = applyWindows(body, { windows: [side()], depth: 3 });
  const filled = applyWindows(cut, { windows: [side(30, 60, { state: 'fill' })], pane: 1 });
  assert.equal(filled.info.filled, 2);
  const s = meshStats(filled);
  assert.equal(s.openEdges, 0);
  assert.equal(s.faultyEdges, 0);
  // The panes give back what the openings took: 30 × 12 × 1, twice.
  const back = volume(filled) - volume(cut);
  assert.ok(Math.abs(back - 2 * 30 * 12) < 8, `panes add ${back}`);
});

test('a window drawn on a solid body warns that it needs hollowing', () => {
  const solid = applyFloor(box(100, 40, 30, 16), { mode: 'cut', at: 0.5 });
  for (let i = 1; i < solid.positions.length; i += 3) solid.positions[i] -= 20;
  const out = applyWindows(solid, { windows: [side(30, 60, { mirror: false })] });
  assert.equal(out.info.cut, 0);
  assert.ok(out.info.warnings[0].includes('one skin'));
});

const MAIN3 = model('Main3.stl');
test('test car Main3: side windows cut cleanly after hollowing', { skip: !existsSync(MAIN3) }, () => {
  const src = readSTLMesh(readFileSync(MAIN3));
  const steps = [
    { id: 'o', type: 'orient', enabled: true, params: { front: '+z', up: '+y' } },
    { id: 'f', type: 'floor', enabled: true, params: { mode: 'cut', at: 4.5 } },
    { id: 'h', type: 'hollow', enabled: true, params: { wall: 1 } },
  ];
  const body = replay(src, steps).mesh;
  const b = bounds(body.positions);
  // A window on the side of the cabin, found by shooting at the body side.
  const L = b.size[0], H = b.size[2];
  const xs = [0.42, 0.58].map((k) => b.min[0] + L * k), zs = [0.72, 0.85].map((k) => b.min[2] + H * k);
  const y = sideAt(body, (xs[0] + xs[1]) / 2, (zs[0] + zs[1]) / 2);
  const w = { id: 'w', name: 'Side', corners: [], normal: [0, -1, 0], mirror: true, open: true, points: [[xs[0], y, zs[0]], [xs[1], y, zs[0]], [xs[1], y, zs[1]], [xs[0], y, zs[1]]].map(([x, , z]) => [x, sideAt(body, x, z), z]) };
  const { mesh, results } = replay(src, [...steps, { id: 'w', type: 'windows', enabled: true, params: { windows: [w], depth: 3 } }]);
  assert.equal(results[3].state, 'ok', JSON.stringify(results[3]));
  assert.equal(results[3].info.cut, 2, JSON.stringify(results[3].info));
  const s = meshStats(mesh);
  assert.equal(s.openEdges, meshStats(body).openEdges, 'no new open edges');
  assert.equal(s.faultyEdges, 0);
});

// Where the body's -Y side is at (x, z): the outermost point found nearby.
function sideAt(mesh, x, z) {
  let y = 0;
  const p = mesh.positions;
  for (let i = 0; i < p.length; i += 3) if (Math.abs(p[i] - x) < 1.5 && Math.abs(p[i + 2] - z) < 1.5) y = Math.min(y, p[i + 1]);
  return y;
}

// A headlight drawn on the Datsun's lamp, which sits in a bowl: the hollowed
// skins fold there, and along the cut the wall is thicker than it reaches.
test('test car Datsun: an open window on the headlight in its bowl closes', { skip: !existsSync(model('datsun.stl')) }, async () => {
  const { guessOrient } = await import('../src/geometry/engine.js');
  const src = readSTLMesh(readFileSync(model('datsun.stl')));
  const g = guessOrient(src);
  const body = replay(src, [
    { id: 'o', type: 'orient', enabled: true, params: { front: g.front, up: g.up, turn: 0 } },
    { id: 'h', type: 'hollow', enabled: true, params: { wall: 1 } },
  ]).mesh;
  const points = [[-38.921, -17.966, 13.776], [-39.175, -17.37, 12.359], [-39.242, -15.953, 11.763], [-39.125, -14.537, 12.359], [-38.921, -13.941, 13.776], [-39.001, -14.537, 15.193], [-39.182, -15.953, 15.789], [-38.984, -17.37, 15.193]];
  const win = { id: 'h', name: 'Headlight', points, corners: points.map(() => false), normal: [-0.9215, -0.2818, -0.2671], mirror: true, state: 'open', lens: true };
  const out = applyWindows(body, { windows: [win], depth: 3, fine: true });
  assert.deepEqual(out.info.warnings, []);
  assert.equal(out.info.cut, 2);
  const s = meshStats(out);
  assert.equal(s.openEdges, 0);
  assert.equal(s.faultyEdges, 0);
});
