// Orient: turn, tilt, lean and mirror, and squaring up a car that lies at an
// angle in its file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { angleMatrix, applyOrient, bounds, guessOrient, matrixAngles, meshStats, squareAngles } from '../src/geometry/engine.js';
import { readSTLMesh } from '../src/geometry/stl-mesh.js';
import { encodeProjectFile, newProject } from '../src/project.js';
import { model } from './models.js';

function box(sx, sy, sz) {
  const positions = new Float32Array([0, 0, 0, sx, 0, 0, sx, sy, 0, 0, sy, 0, 0, 0, sz, sx, 0, sz, sx, sy, sz, 0, sy, sz]);
  const q = [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]];
  return { positions, indices: new Uint32Array(q.flatMap(([a, b, c, d]) => [a, b, c, a, c, d])) };
}
// The mesh turned by a rotation matrix, as a file that lies crooked.
function rotated(mesh, R) {
  const p = mesh.positions,
    out = new Float32Array(p.length);
  for (let i = 0; i < p.length; i += 3)
    for (let r = 0; r < 3; r++) out[i + r] = R[r][0] * p[i] + R[r][1] * p[i + 1] + R[r][2] * p[i + 2];
  return { positions: out, indices: mesh.indices };
}
const signedVolume = ({ positions: p, indices: t }) => {
  let v = 0;
  for (let f = 0; f < t.length; f += 3) {
    const a = t[f] * 3, b = t[f + 1] * 3, c = t[f + 2] * 3;
    v += p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1]) - p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c]) + p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c]);
  }
  return v / 6;
};
const near = (a, b, tol, what) => a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) <= tol, `${what}: ${a.map((x) => x.toFixed(2))} vs ${b}`));

test('turn, tilt and lean go in and come back out of the rotation', () => {
  const a = { turn: 20, tilt: -12.5, lean: 7 };
  assert.deepEqual(matrixAngles(angleMatrix(a.turn, a.tilt, a.lean)), a);
});

test('plus tilt lifts the nose and plus lean lifts the right side', () => {
  const b = box(100, 40, 10);
  const tilted = applyOrient(b, { front: '-x', up: '+z', tilt: 10 });
  // The nose is at low X: its lowest corner is now above the tail's.
  const lowestAtX = (m, sign) => Math.min(...[0, 1, 2, 3, 4, 5, 6, 7].filter((v) => Math.sign(m.positions[v * 3]) === sign).map((v) => m.positions[v * 3 + 2]));
  assert.ok(lowestAtX(tilted, -1) > lowestAtX(tilted, 1));
  const leaned = applyOrient(b, { front: '-x', up: '+z', lean: 10 });
  const lowestAtY = (m, sign) => Math.min(...[0, 1, 2, 3, 4, 5, 6, 7].filter((v) => Math.sign(m.positions[v * 3 + 1]) === sign).map((v) => m.positions[v * 3 + 2]));
  assert.ok(lowestAtY(leaned, 1) > lowestAtY(leaned, -1));
});

test('a box lying turned, tilted and leaning is squared up', () => {
  const crooked = rotated(box(100, 40, 10), angleMatrix(25, 12, -9));
  const guess = guessOrient(crooked);
  near(bounds(applyOrient(crooked, guess).positions).size, [100, 40, 10], 0.2, 'size');
});

test('turning around or rolling over keeps a squared car square', () => {
  const crooked = rotated(box(100, 40, 10), angleMatrix(25, 12, -9));
  const g = guessOrient(crooked);
  const flip = (s) => (s[0] === '+' ? '-' : '+') + s[1];
  // The same changes the Turn around and Upside down buttons make.
  const around = { ...g, front: flip(g.front), tilt: -g.tilt, lean: -g.lean };
  const over = { ...g, up: flip(g.up), turn: -g.turn, tilt: -g.tilt };
  for (const params of [around, over]) near(bounds(applyOrient(crooked, params).positions).size, [100, 40, 10], 0.2, 'size');
});

test('mirror swaps left and right and keeps the mesh closed and outward', () => {
  const b = box(100, 40, 10);
  const plain = applyOrient(b, { front: '-x', up: '+z', lean: 5 });
  const mirrored = applyOrient(b, { front: '-x', up: '+z', lean: 5, mirror: true });
  for (let i = 0; i < plain.positions.length; i += 3) assert.ok(Math.abs(mirrored.positions[i + 1] + plain.positions[i + 1]) < 1e-4);
  const s = meshStats(mirrored);
  assert.equal(s.openEdges, 0);
  assert.equal(s.faultyEdges, 0);
  // Outward still: the same signed volume, 100 x 40 x 10.
  for (const m of [plain, mirrored]) assert.ok(Math.abs(signedVolume(m) - 40000) < 1, String(signedVolume(m)));
});

test('a straight box needs no squaring', () => {
  assert.deepEqual(squareAngles(applyOrient(box(100, 40, 10), { front: '-x', up: '+z' })), { turn: 0, tilt: 0, lean: 0 });
});

const MCLAREN = model('McLaren_MP4_12C.stl');
for (const [name, R] of [
  ['turned, tilted and leaning', angleMatrix(20, 13, 6)],
  ['upside down and tilted', angleMatrix(0, 10, 180)],
]) {
  test(`test car McLaren ${name}: the guess stands it straight on its wheels`, { skip: !existsSync(MCLAREN) }, () => {
    const crooked = rotated(readSTLMesh(readFileSync(MCLAREN)), R);
    const guess = guessOrient(crooked);
    const car = applyOrient(crooked, guess);
    near(bounds(car.positions).size, [141, 61.5, 13], 1.5, 'size');
    // Same as the file straight: the nose to the left, the roof up.
    const straight = applyOrient(readSTLMesh(readFileSync(MCLAREN)), guessOrient(readSTLMesh(readFileSync(MCLAREN))));
    const sb = bounds(straight.positions), cb = bounds(car.positions);
    near(cb.max, sb.max, 1.5, 'max');
  });
}

test('only tilt, lean or mirror need the newer project format', () => {
  const p = newProject('body.stl', new ArrayBuffer(0), { front: '-x', up: '+z', turn: 5 });
  assert.equal(JSON.parse(encodeProjectFile(p)).version, 1);
  for (const change of [{ tilt: 2 }, { lean: -1 }, { mirror: true }]) {
    p.steps[0].params = { front: '-x', up: '+z', ...change };
    assert.equal(JSON.parse(encodeProjectFile(p)).version, 3);
  }
});
