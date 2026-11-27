// Hollow › Clean out the inside: only the outside stays, the inside and all
// straight below it go, then the even wall is built.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { bounds, meshStats } from '../src/geometry/engine.js';
import { rayCaster } from '../src/geometry/rays.js';
import { applyHollow } from '../src/geometry/shell.js';
import { cleanOut } from '../src/geometry/cleanout.js';
import { joinMeshes } from '../src/geometry/topology.js';
import { readSTLMesh } from '../src/geometry/stl-mesh.js';
import { guessOrient, replay } from '../src/geometry/engine.js';
import { box } from './shapes.js';
import { model } from './models.js';

const moved = (m, [x, y, z]) => {
  const P = Float32Array.from(m.positions);
  for (let v = 0; v < P.length; v += 3) (P[v] += x), (P[v + 1] += y), (P[v + 2] += z);
  return { positions: P, indices: m.indices };
};
// A solid 100 × 40 × 30 block standing on z = 0, with a "seat" (a block of
// its own) inside it and a "closed arch" (a block of its own) under its floor.
const body = () => moved(box(100, 40, 30, 16), [0, -20, 0]);
const seat = () => moved(box(10, 10, 8, 4), [40, -5, 5]);

test('a solid body cleaned out and hollowed: an even shell, open underneath, the outside where it was', () => {
  const out = applyHollow(body(), { wall: 1, clean: true });
  const s = meshStats(out);
  assert.equal(s.openEdges, 0);
  assert.equal(s.faultyEdges, 0);
  assert.equal(s.parts, 1);
  const b = bounds(out.positions);
  assert.deepEqual(b.min.map((x) => Math.round(x * 100) / 100), [0, -20, 0]);
  assert.deepEqual(b.max.map((x) => Math.round(x * 100) / 100), [100, 20, 30]);
  const cast = rayCaster(out.positions, out.indices);
  // From below, straight in: nothing until the roof's inside, a wall under the roof.
  const up = cast([50, 0, -5], [0, 0, 1]);
  assert.ok(Math.abs(up - 5 - 29) < 0.05, `roof inside at ${up - 5}`);
  // The side wall is the wall thick.
  const side = cast([50, -30, 15], [0, 1, 0]);
  const inner = cast([50, -30 + side + 1e-3, 15], [0, 1, 0]);
  assert.ok(Math.abs(inner - 1) < 0.05, `side wall ${inner}`);
});

test('what is inside goes: a seat, and a part closed in under the body', () => {
  const car = joinMeshes([body(), seat()]);
  const c = cleanOut(car, { wall: 1 });
  const b = bounds(c.mesh.positions);
  assert.deepEqual(b.max.map((x) => Math.round(x)), [100, 20, 30]);
  // No surface left round the seat's place, nor of the floor.
  const cast = rayCaster(c.mesh.positions, c.mesh.indices);
  assert.ok(Math.abs(cast([45, 0, -5], [0, 0, 1]) - 5 - 30) < 0.05, 'from below, the roof is the first thing');
  assert.ok(c.info.removed > 0);
});

test('a body without anything inside it keeps its outside as it is', () => {
  const thin = moved(box(60, 20, 2, 8), [0, -10, 0]); // a plate: no inside to clean
  const c = cleanOut(thin, { wall: 1 });
  assert.equal(c.mesh.indices.length, thin.indices.length);
});

const PORSCHE = model('Porsche 911 Body.stl');
test('test car Porsche (a scan with closed arches): an empty shell, the arches open', { skip: !existsSync(PORSCHE) }, () => {
  const src = readSTLMesh(readFileSync(PORSCHE));
  const car = replay(src, [{ id: 'o', type: 'orient', enabled: true, params: guessOrient(src) }]).mesh;
  const out = applyHollow(car, { wall: 1, clean: true });
  const s = meshStats(out);
  assert.equal(s.openEdges, 0);
  assert.equal(s.faultyEdges, 0);
  assert.equal(s.parts, 1);
  // Into the front wheel arch from the side: the old liner is gone.
  const cast = rayCaster(out.positions, out.indices);
  const b = bounds(out.positions);
  const x = b.min[0] + b.size[0] * 0.18;
  assert.ok(cast([x, b.min[1] - 5, b.min[2] + b.size[2] * 0.25], [0, 1, 0]) > 30, 'nothing behind the arch opening');
});
