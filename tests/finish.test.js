import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyDelete, applySlice, bounds, encodeRuns, meshStats, replay } from '../src/geometry/engine.js';
import { applyAddPart, applySmooth, partPieces } from '../src/geometry/finish.js';
import { volume } from '../src/geometry/shell.js';
import { box, shell } from './shapes.js';

// A closed box with a dent pushed into the middle of its top.
function bumpy() {
  const b = box(40, 40, 20, 20);
  for (let i = 0; i < b.positions.length; i += 3) {
    const [x, y, z] = [b.positions[i], b.positions[i + 1], b.positions[i + 2]];
    if (z === 20 && Math.abs(x - 20) < 3 && Math.abs(y - 20) < 3) b.positions[i + 2] = 20.8;
  }
  return b;
}

test('smoothing a brushed spot flattens a bump, keeps the edges and the rest', () => {
  const m = bumpy();
  const out = applySmooth(m, { strokes: [{ at: [20, 20, 20], radius: 8 }], strength: 5 });
  const top = (mesh) => Math.max(...Array.from(mesh.positions).filter((_, i) => i % 3 === 2));
  assert.ok(top(out) < 20.45, `bump down to ${top(out)}`);
  const b0 = bounds(m.positions), b1 = bounds(out.positions);
  assert.ok(Math.abs(b1.size[0] - b0.size[0]) < 1e-6 && Math.abs(b1.min[2] - b0.min[2]) < 1e-6, 'box edges stay');
  // Corners far from the brush did not move.
  for (let i = 0; i < m.positions.length; i += 3)
    if (Math.hypot(m.positions[i] - 20, m.positions[i + 1] - 20, m.positions[i + 2] - 20) > 8.5) assert.equal(out.positions[i + 2], m.positions[i + 2]);
});

test('protect the outside: smoothing in a hollow body leaves the outer skin alone', () => {
  const s = shell();
  const out = applySmooth(s, { strokes: [{ at: [50, 0, 29], radius: 30 }], strength: 4, protect: true, keepEdges: false });
  let movedOuter = 0;
  for (let i = 0; i < s.positions.length; i += 3) {
    const onOuter = s.positions[i + 2] > 29.99 || Math.abs(s.positions[i + 1]) > 19.99;
    if (onOuter && out.positions[i + 2] !== s.positions[i + 2]) movedOuter++;
  }
  assert.equal(movedOuter, 0);
  assert.ok(out.info.moved > 0, 'the inside moved');
});

test('delete and patch closes only the new opening', () => {
  const b = box(40, 40, 20, 10);
  // Faces of the top (z = 20) near its middle.
  const P = b.positions, T = b.indices, faces = [];
  for (let f = 0; f < T.length / 3; f++) {
    const c = [0, 1, 2].map((k) => (P[T[f * 3] * 3 + k] + P[T[f * 3 + 1] * 3 + k] + P[T[f * 3 + 2] * 3 + k]) / 3);
    if (Math.abs(c[2] - 20) < 1e-6 && Math.abs(c[0] - 20) < 6 && Math.abs(c[1] - 20) < 6) faces.push(f);
  }
  const open = applyDelete(b, { faces: encodeRuns(faces) });
  assert.ok(meshStats(open).openEdges > 0);
  const patched = applyDelete(b, { faces: encodeRuns(faces), patch: 'smooth' });
  assert.ok(patched.info.patched >= 1);
  const s = meshStats(patched);
  assert.equal(s.openEdges, 0);
  assert.equal(s.faultyEdges, 0);
});

test('slice: keep both sides, capped: a shell gets a ring, both halves are closed', () => {
  const s = shell();
  const out = applySlice(s, { axis: 'x', at: 50, keep: 'both', cap: true, gap: 10 });
  const st = meshStats(out);
  assert.equal(st.faultyEdges, 0);
  // The only open edges left are the bottom openings of the two halves.
  const open = meshStats(applySlice(s, { axis: 'x', at: 50, keep: 'below', cap: false })).openEdges;
  assert.ok(st.openEdges < open * 2, `${st.openEdges} vs ${open * 2}`);
  assert.equal(out.info.capped, 2);
  assert.ok(Math.abs(bounds(out.positions).size[0] - 110) < 1e-3, 'moved 10 apart');
  // A solid box sliced and capped is closed again, with half the volume.
  const solid = box(40, 40, 20, 6);
  const half = applySlice(solid, { axis: 'z', at: 10, keep: 'below', cap: true });
  assert.equal(meshStats(half).openEdges, 0);
  assert.ok(Math.abs(volume(half) - 40 * 40 * 10) < 1e-2, `${volume(half)}`);
});

test('an added part is placed, mirrored if asked, and joined to the body', () => {
  const part = box(4, 2, 2, 1);
  const pieces = partPieces(part, { x: 50, y: 10, z: 30, scale: 2, rz: 90, pair: true });
  assert.equal(pieces.length, 2);
  const b = bounds(pieces[0].positions);
  assert.ok(Math.abs(b.size[0] - 4) < 1e-4 && Math.abs(b.size[1] - 8) < 1e-4, 'scaled and turned');
  assert.ok(Math.abs(b.min[2] - 30) < 1e-4 && Math.abs((b.min[1] + b.max[1]) / 2 - 10) < 1e-4);
  assert.ok(volume(pieces[1]) > 0, 'mirror image faces outwards');
  const body = shell();
  const ctx = { parts: new Map([['p1', part]]) };
  const joined = applyAddPart(body, { part: 'p1', place: { x: 50, z: 30 }, join: true }, ctx);
  assert.equal(joined.indices.length, body.indices.length + part.indices.length);
  const apart = applyAddPart(body, { part: 'p1', place: {}, join: false }, ctx);
  assert.equal(apart.indices.length, body.indices.length);
  assert.throws(() => applyAddPart(body, { part: 'gone', name: 'Wing' }, ctx), /Wing/);
  const r = replay(body, [{ id: 'a', type: 'addpart', enabled: true, params: { part: 'p1', place: { z: 30 } } }], null, ctx);
  assert.equal(r.results[0].state, 'ok');
});
