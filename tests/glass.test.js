// Where a window's glass sits: inside, outside flush (a rebate), outside on
// top (the opening smaller by the overlap), set in (a stepped seat).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { meshStats } from '../src/geometry/engine.js';
import { rayCaster } from '../src/geometry/rays.js';
import { applyWindows, glassFor, insetOutline } from '../src/geometry/windows.js';
import { shell } from './shapes.js';

// The shell is 100 × 40 × 30 with a 1 mm wall, centred on Y = 0; a side
// window 30 × 12 on its -Y side.
const body = shell();
const side = (extra = {}) => ({
  id: 'w',
  name: 'Side window',
  points: [[30, -20, 10], [60, -20, 10], [60, -20, 22], [30, -20, 22]],
  corners: [true, true, true, true],
  normal: [0, -1, 0],
  mirror: false,
  state: 'open',
  ...extra,
});
const glass = { glassThick: 1, overlap: 1.5, minWall: 0.6 };
// Along +Y from outside the -Y side at x, z: how far in the first surface
// is, and how thick the wall there is (or null: through the opening).
function probe(mesh) {
  const cast = rayCaster(mesh.positions, mesh.indices);
  return (x, z) => {
    const a = cast([x, -40, z], [0, 1, 0]);
    if (!(a < 20 + 5)) return null;
    const b = cast([x, -40 + a + 1e-3, z], [0, 1, 0]);
    return { sunk: a - 20, wall: b + 1e-3 };
  };
}

test('glass defaults: inside has no overlap, flush and set in get a rebate', () => {
  assert.deepEqual(glassFor({}, glass), { kind: 'inside', thick: 1, depth: 0, overlap: 0, rebate: false });
  assert.equal(glassFor({ glass: 'top' }, glass).overlap, 1.5);
  assert.equal(glassFor({ glass: 'flush' }, glass).rebate, true);
  assert.equal(glassFor({ glass: 'setin', thick: 0.5, depth: 0.2 }, glass).thick, 0.5);
  assert.equal(glassFor({ glass: 'nonsense' }, glass).kind, 'inside');
});

test('glass inside: the opening is the outline, as before', () => {
  const at = probe(applyWindows(body, { windows: [side()], depth: 3, fine: true, ...glass }));
  assert.equal(at(45, 16), null);
  assert.equal(at(45, 10.5), null, 'open right up to the outline');
  assert.ok(Math.abs(at(45, 9).sunk) < 1e-3);
});

test('glass on top: the opening is the overlap smaller, the body round it untouched', () => {
  const out = applyWindows(body, { windows: [side({ glass: 'top' })], depth: 3, fine: true, ...glass });
  const at = probe(out);
  assert.equal(at(45, 16), null);
  const band = at(45, 10.7);
  assert.ok(band && Math.abs(band.sunk) < 1e-3, 'the band the glass rests on stays');
  assert.equal(at(45, 11.8), null, 'open past the overlap');
  const s = meshStats(out);
  assert.equal(s.openEdges, 0);
  assert.equal(s.faultyEdges, 0);
});

test('glass flush: a rebate as deep as the glass, the wall behind it never thinner than asked', () => {
  const out = applyWindows(body, { windows: [side({ glass: 'flush' })], depth: 3, fine: true, ...glass });
  const at = probe(out);
  assert.equal(at(45, 16), null);
  for (const [x, z] of [[45, 10.7], [45, 21.3], [30.7, 16], [59.3, 16], [31, 11]]) {
    const r = at(x, z);
    assert.ok(r, `band at ${x}, ${z}`);
    assert.ok(Math.abs(r.sunk - 1) < 0.02, `rebate depth ${r.sunk}`);
    assert.ok(r.wall >= 0.6 - 0.02, `wall behind ${r.wall}`);
  }
  // Outside the outline the body is as it was.
  assert.ok(Math.abs(at(45, 9).sunk) < 1e-3);
  assert.ok(Math.abs(at(25, 16).sunk) < 1e-3);
  assert.ok(Math.abs(at(20, 16).wall - 1) < 0.02, 'the wall away from the window stays as it was');
  const s = meshStats(out);
  assert.equal(s.openEdges, 0);
  assert.equal(s.faultyEdges, 0);
  assert.equal(out.info.rebates, 1);
  assert.ok(out.info.thickened > 0);
});

test('glass set in and set back: the rebate is the glass plus its set-back deep', () => {
  const out = applyWindows(body, { windows: [side({ glass: 'setin', depth: 0.3, thick: 0.8 })], depth: 3, fine: true, ...glass });
  const r = probe(out)(45, 10.7);
  assert.ok(Math.abs(r.sunk - 1.1) < 0.02, `seat depth ${r.sunk}`);
  assert.ok(r.wall >= 0.6 - 0.02);
  assert.equal(meshStats(out).openEdges, 0);
});

test('a window too small for its overlap is reported and left uncut', () => {
  const tiny = side({ glass: 'top', points: [[40, -20, 15], [42, -20, 15], [42, -20, 17], [40, -20, 17]] });
  const out = applyWindows(body, { windows: [tiny], depth: 3, fine: true, ...glass });
  assert.equal(out.info.cut, 0);
  assert.match(out.info.warnings[0], /too small for a 1.5 mm overlap/);
});

test('an outline made smaller keeps its plane and shrinks by the overlap all round', () => {
  const pts = insetOutline(side().points, [0, -1, 0], 1.5);
  for (const p of pts) assert.ok(Math.abs(p[1] + 20) < 1e-6);
  const xs = pts.map((p) => p[0]), zs = pts.map((p) => p[2]);
  assert.ok(Math.abs(Math.min(...xs) - 31.5) < 1e-6 && Math.abs(Math.max(...xs) - 58.5) < 1e-6);
  assert.ok(Math.abs(Math.min(...zs) - 11.5) < 1e-6 && Math.abs(Math.max(...zs) - 20.5) < 1e-6);
});

test('a project with glass outside needs the newer project format', async () => {
  const { encodeProjectFile, newProject } = await import('../src/project.js');
  const p = newProject('body.stl', new ArrayBuffer(0), { front: '-x', up: '+z' });
  p.steps.push({ id: 'w', type: 'windows', enabled: true, params: { windows: [side()] } });
  assert.equal(JSON.parse(encodeProjectFile(p)).version, 1);
  p.steps[p.steps.length - 1].params.windows = [side({ glass: 'flush' })];
  assert.equal(JSON.parse(encodeProjectFile(p)).version, 5);
});

test('clear parts follow where the glass sits: their face and back on the body, in the rebate or the seat', async () => {
  const { makeLenses } = await import('../src/geometry/lenses.js');
  const { windowOutlines } = await import('../src/geometry/windows.js');
  const { bounds } = await import('../src/geometry/engine.js');
  const part = (kind, extra = {}) => {
    const g = { kind, thick: 1, depth: 0, overlap: 1.5, minWall: 0.6, ...extra };
    const ol = windowOutlines([side()], 0.25).map((o) => ({ name: o.window.name, points: o.points, normal: o.normal, glass: g }));
    const r = makeLenses(body, ol, { wall: 1, clearance: 0.1 });
    assert.deepEqual(r.info.warnings, []);
    const s = meshStats(r.car.lenses);
    assert.equal(s.openEdges, 0);
    assert.equal(s.faultyEdges, 0);
    assert.equal(s.parts, 1);
    return { b: bounds(r.car.lenses.positions), r };
  };
  const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 0.02, `${msg}: ${a} not ${b}`);
  // Flush: face level with the body (y = -20), back on the rebate floor, the clearance smaller.
  let { b, r } = part('flush');
  near(b.min[1], -20, 'flush face');
  near(b.max[1], -19, 'flush back');
  near(b.min[0], 30.1, 'flush clearance');
  assert.equal(r.car.plugs.indices.length, 0, 'glass outside gets its buck under Glazing buck');
  // On top: lies on the body, the glass thickness proud, the outline's size.
  ({ b } = part('top'));
  near(b.min[1], -21, 'top face');
  near(b.max[1], -20, 'top back');
  near(b.min[0], 30, 'top size');
  // Set in, set back 0.3: the flange in the seat, the plug down to the inside of the wall.
  ({ b } = part('setin', { depth: 0.3 }));
  near(b.min[1], -19.7, 'set-in face');
  near(b.max[1], -18.1, 'plug to the inside of the thickened wall');
  // Inside, set back 0.2: the lens's face that far in.
  ({ b } = part('inside', { depth: 0.2 }));
  near(b.min[1], -19.8, 'inside face');
});

// The roof of the shell (z = 30) with a window drawn on it, facing up.
const roofWindow = (extra = {}) => ({
  id: 'r',
  name: 'Roof window',
  points: [[35, -10, 30], [65, -10, 30], [65, 10, 30], [35, 10, 30]],
  corners: [true, true, true, true],
  normal: [0, 0, 1],
  mirror: false,
  state: 'open',
  ...extra,
});
const buckOpts = (outlines, extra = {}) => ({ wall: 1, sheet: 0.5, allowance: 0.1, trim: { front: 20, rear: 20 }, outlines, posts: [], ...extra });
const heightOf = (mesh) => {
  const cast = rayCaster(mesh.positions, mesh.indices);
  return (x, y) => 100 - cast([x, y, 100], [0, 0, -1]);
};

test('the glazing buck spans an opening the model came with, instead of dropping into it', async () => {
  const { makeBuck } = await import('../src/geometry/buck.js');
  // A model with its roof window already open: rays from above fall through.
  const opened = applyWindows(body, { windows: [roofWindow()], depth: 3, fine: true });
  const r = makeBuck(opened, buckOpts([]));
  const h = heightOf(r.mesh);
  assert.ok(r.info.filledHoles > 0);
  assert.ok(Math.abs(h(50, 0) - (30 - 1.6)) < 0.1, `across the opening: ${h(50, 0)}`);
  assert.ok(Math.abs(h(20, 0) - (30 - 1.6)) < 0.05, `the roof: ${h(20, 0)}`);
  assert.equal(meshStats(r.mesh).openEdges, 0);
});

test('window marks on the glazing buck: raised areas stand proud, a groove runs along the outline', async () => {
  const { makeBuck } = await import('../src/geometry/buck.js');
  const { windowOutlines } = await import('../src/geometry/windows.js');
  const outlines = windowOutlines([roofWindow()]).map((o) => ({ name: o.window.name, points: o.points, normal: o.normal }));
  const roof = 30 - 1.6;
  const line = heightOf(makeBuck(body, buckOpts(outlines, { guide: 0 })).mesh);
  const raised = makeBuck(body, buckOpts(outlines, { guide: 0, marks: 'raised', raise: 0.5 }));
  const hr = heightOf(raised.mesh);
  assert.equal(raised.info.marks, 'raised');
  assert.ok(Math.abs(line(50, 0) - roof) < 0.02);
  assert.ok(Math.abs(hr(50, 0) - (roof + 0.5)) < 0.02, `raised window: ${hr(50, 0)}`);
  assert.ok(Math.abs(hr(20, 0) - roof) < 0.02, `roof round it: ${hr(20, 0)}`);
  // The raised area is about the outline, a sheet and the allowance smaller.
  assert.ok(hr(36.2, 0) > roof + 0.4 && hr(34.4, 0) < roof + 0.1, `edge: ${hr(36.2, 0)} ${hr(34.4, 0)}`);
  const groove = heightOf(makeBuck(body, buckOpts(outlines, { guide: 0, marks: 'groove', grooveWidth: 0.6, grooveDepth: 0.3 })).mesh);
  assert.ok(groove(35, 0) < roof - 0.15, `groove on the outline: ${groove(35, 0)}`);
  assert.ok(Math.abs(groove(50, 0) - roof) < 0.02);
  assert.throws(() => makeBuck(body, buckOpts(outlines, { marks: 'raised', raise: 2 })), /Raise the windows/);
});

test('a buck per window: its surface where the formed pane fits the glass', async () => {
  const { makeWindowBucks } = await import('../src/geometry/lenses.js');
  const { windowOutlines } = await import('../src/geometry/windows.js');
  const surface = (kind, depth = 0) => {
    const ol = windowOutlines([side()], 0.25).map((o) => ({ name: o.window.name, points: o.points, normal: o.normal, glass: { kind, thick: 1, depth, overlap: 1.5 } }));
    const r = makeWindowBucks(body, ol, { wall: 1, sheet: 0.5, allowance: 0.1 });
    assert.deepEqual(r.info.warnings, []);
    assert.equal(meshStats(r.car).openEdges, 0);
    assert.equal(meshStats(r.print).openEdges, 0);
    return -40 + rayCaster(r.car.positions, r.car.indices)([45, -40, 16], [0, 1, 0]);
  };
  assert.ok(Math.abs(surface('inside') + 18.4) < 0.02, 'inside: wall + sheet + allowance in');
  assert.ok(Math.abs(surface('flush') + 19.5) < 0.02, 'flush: a sheet in, so the pane is level');
  assert.ok(Math.abs(surface('top') + 20) < 0.02, 'on top: on the body');
  assert.ok(Math.abs(surface('setin', 0.3) + 19.2) < 0.02, 'set in: set-back and sheet in');
});
