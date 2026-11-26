import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyInterior, interiorPieces, trayOutline } from '../src/geometry/interior.js';
import { bounds, meshStats } from '../src/geometry/engine.js';
import { volume } from '../src/geometry/shell.js';
import { shell } from './shapes.js';

// The test shell: 100 × 40 × 30, 1 mm wall (inside at |y| = 19), open underneath.
const cockpit = { x0: 30, x1: 70, z: 10 };
const asMesh = (p) => ({ positions: Float32Array.from(p.positions), indices: Uint32Array.from(p.indices) });

test('tray outline: the inside of the walls less the gap, all along', () => {
  const t = trayOutline(shell(), { ...cockpit, gap: 0.3 });
  assert.equal(t.missed, 0);
  const ys = t.outline.map(([, y]) => y);
  assert.ok(Math.abs(Math.max(...ys) - 18.7) < 0.05 && Math.abs(Math.min(...ys) + 18.7) < 0.05, `y ${Math.min(...ys)} … ${Math.max(...ys)}`);
});

test('clip-in tray: ledges on the walls, the tray and driver beside the car, all closed', () => {
  const s = shell();
  const out = applyInterior(s, { ...cockpit, mount: 'ledges', driver: true, helmet: 6 });
  assert.equal(out.info.ledges, 4);
  assert.deepEqual(out.info.warnings, []);
  assert.equal(meshStats(out).openEdges, meshStats(s).openEdges);
  // Beside the car (past its right side), on the same ground.
  const added = { positions: out.positions.slice(s.positions.length), indices: out.indices.slice(s.indices.length).map((v) => v - s.positions.length / 3) };
  const b = bounds(added.positions);
  assert.ok(b.max[1] > 20 + 8 + 30, `tray beside the car: y up to ${b.max[1]}`);
  // Each piece is closed and faces out (the tray alone is 40 × 37.4 × 1).
  const p = interiorPieces(s, { ...cockpit, driver: false });
  const v = volume(asMesh(p.tray[0]));
  assert.ok(Math.abs(v - 40 * 37.4) < 2, `tray volume ${v}`);
  for (const piece of [...p.tray, ...p.ledges]) assert.equal(meshStats(asMesh(piece)).openEdges, 0);
});

test('joined tray: into the walls, in place', () => {
  const s = shell();
  const p = interiorPieces(s, { ...cockpit, mount: 'joined', driver: false });
  assert.equal(p.ledges.length, 0);
  const b = bounds(Float32Array.from(p.tray[0].positions));
  assert.ok(Math.abs(b.max[1] - 19.5) < 0.05 && Math.abs(b.min[2] - 10) < 1e-4);
});

test('driver: pieces closed; a helmet too big for the roof says so', () => {
  const s = shell();
  const ok = interiorPieces(s, { ...cockpit, helmet: 6 });
  for (const piece of ok.tray) assert.equal(meshStats(asMesh(piece)).openEdges, 0);
  const big = interiorPieces(s, { ...cockpit, z: 15, helmet: 9 });
  assert.match(big.warnings.join(' '), /helmet touches the roof/);
  assert.throws(() => interiorPieces(s, { ...cockpit, z: 40 }), /No side walls/);
});
