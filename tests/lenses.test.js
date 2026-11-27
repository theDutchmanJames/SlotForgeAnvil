import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bounds, meshStats } from '../src/geometry/engine.js';
import { makeLenses, offsetOutline } from '../src/geometry/lenses.js';
import { windowOutlines } from '../src/geometry/windows.js';
import { shell } from './shapes.js';

// The shell is 100 × 40 × 30 with a 1 mm wall; its nose is the flat face at x = 0.
// A headlight on it: an oval 8 wide and 5 high round y = 8, z = 12, on both sides.
const light = (extra = {}) => {
  const points = Array.from({ length: 8 }, (_, k) => {
    const a = (k * Math.PI) / 4;
    return [0, 8 + 4 * Math.cos(a), 12 + 2.5 * Math.sin(a)];
  });
  return { id: 'h', name: 'Headlight', points, corners: [], normal: [-1, 0, 0], mirror: true, state: 'open', lens: true, ...extra };
};
const outlinesOf = (wins) => windowOutlines(wins, 0.25).map((o) => ({ name: o.window.name + (o.mirrored ? ' (mirrored)' : ''), points: o.points, normal: o.normal }));

test('light lenses: a printed lens and a buck per light, all closed', () => {
  const r = makeLenses(shell(), outlinesOf([light()]), { wall: 1 });
  assert.deepEqual(r.info.warnings, []);
  assert.equal(r.info.lights.length, 2, 'the light and its mirror image');
  for (const m of [r.car.lenses, r.car.plugs, r.print.lenses, r.print.plugs]) {
    const s = meshStats(m);
    assert.equal(s.openEdges, 0);
    assert.equal(s.faultyEdges, 0);
  }
  assert.equal(meshStats(r.car.lenses).parts, 2);
  // Two plugs, each with two guide lines (the opening and the trim line).
  assert.equal(meshStats(r.car.plugs).parts, 6);
});

test('the printed lens fills the opening flush, a fit clearance smaller, with a lip behind the wall', () => {
  const o = { wall: 1, clearance: 0.1, lip: 0.6, lipWidth: 0.8 };
  const r = makeLenses(shell(), outlinesOf([light({ mirror: false })]), o);
  const P = r.car.lenses.positions;
  const b = bounds(P);
  assert.ok(Math.abs(b.min[0]) < 1e-3, `outside flush with the nose: ${b.min[0]}`);
  assert.ok(Math.abs(b.max[0] - (o.wall + o.clearance + o.lip)) < 1e-3, `wall + clearance + lip deep: ${b.max[0]}`);
  // In the opening (in front of the inner skin) it is the outline less the clearance.
  let reach = 0, lipReach = 0;
  for (let v = 0; v < P.length; v += 3) {
    const e = Math.hypot((P[v + 1] - 8) / 4, (P[v + 2] - 12) / 2.5);
    if (P[v] < o.wall - 0.01) reach = Math.max(reach, e);
    else lipReach = Math.max(lipReach, Math.abs(P[v + 1] - 8));
  }
  assert.ok(reach < 1, `inside the opening: ${reach.toFixed(3)}`);
  assert.ok(reach > (4 - 0.15) / 4, `close to its edge: ${reach.toFixed(3)}`);
  assert.ok(Math.abs(lipReach - (4 + o.lipWidth)) < 0.05, `lip reaches past the opening: ${lipReach}`);
});

test('the lens buck sits wall + sheet + allowance inside the body, and prints standing on its plinth', () => {
  const o = { wall: 1, sheet: 0.3, allowance: 0.1, skirt: 2, plinth: 2, guide: 0 };
  const r = makeLenses(shell(), outlinesOf([light({ mirror: false })]), o);
  const b = bounds(r.car.plugs.positions);
  const offset = o.wall + o.sheet + o.allowance;
  assert.equal(r.info.offset, offset);
  assert.ok(Math.abs(b.min[0] - offset) < 1e-3, `surface ${b.min[0]}`);
  assert.ok(Math.abs(b.max[0] - (offset + o.skirt + o.plinth)) < 1e-3, `base ${b.max[0]}`);
  // Laid out to print: on z = 0, its lens surface on top.
  const pb = bounds(r.print.plugs.positions);
  assert.ok(Math.abs(pb.min[2]) < 1e-6);
  assert.ok(Math.abs(pb.max[2] - (o.skirt + o.plinth)) < 1e-3);
  const lb = bounds(r.print.lenses.positions);
  assert.ok(Math.abs(lb.min[2]) < 1e-6);
});

test('a light not on the body is reported and makes no lens; no lights at all is an error', () => {
  const off = light({ mirror: false, name: 'Stray', points: light().points.map((p) => [p[0], p[1] + 60, p[2]]) });
  const r = makeLenses(shell(), outlinesOf([light({ mirror: false }), off]), { wall: 1 });
  assert.equal(r.info.lights.length, 1);
  assert.equal(r.info.warnings.length, 1);
  assert.match(r.info.warnings[0], /^Stray:/);
  assert.throws(() => makeLenses(shell(), [], { wall: 1 }), /Draw a window or a light first/);
});

test('an outline moved out and in keeps its corners in step', () => {
  const sq = [[0, 0], [10, 0], [10, 10], [0, 10]];
  assert.deepEqual(offsetOutline(sq, 1).map((p) => p.map((x) => Math.round(x * 1000) / 1000)), [[-1, -1], [11, -1], [11, 11], [-1, 11]]);
  assert.deepEqual(offsetOutline([...sq].reverse(), -1).map((p) => p.map((x) => Math.round(x * 1000) / 1000)), [[1, 9], [9, 9], [9, 1], [1, 1]]);
});
