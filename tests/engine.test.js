import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import {
  applyDelete,
  applyOrient,
  applyScale,
  applySlice,
  bounds,
  decodeRuns,
  encodeRuns,
  guessOrient,
  meshStats,
  orientMatrix,
  replay,
  runCount,
} from '../src/geometry/engine.js';
import { encodeSTL, readSTLMesh } from '../src/geometry/stl-mesh.js';
import { model } from './models.js';

// A closed box, x 0..sx, y 0..sy, z 0..sz, outward winding.
function box(sx, sy, sz) {
  const positions = new Float32Array([
    0, 0, 0, sx, 0, 0, sx, sy, 0, 0, sy, 0,
    0, 0, sz, sx, 0, sz, sx, sy, sz, 0, sy, sz,
  ]);
  const q = [
    [0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4],
    [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7],
  ];
  const indices = new Uint32Array(q.flatMap(([a, b, c, d]) => [a, b, c, a, c, d]));
  return { positions, indices };
}
const signedVolume = ({ positions: p, indices: t }) => {
  let v = 0;
  for (let f = 0; f < t.length; f += 3) {
    const a = t[f] * 3, b = t[f + 1] * 3, c = t[f + 2] * 3;
    v += p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1])
      - p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c])
      + p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c]);
  }
  return v / 6;
};

test('STL round trip keeps every triangle and vertex', () => {
  const mesh = box(10, 20, 30);
  const back = readSTLMesh(encodeSTL(mesh));
  assert.equal(back.indices.length, mesh.indices.length);
  assert.equal(back.positions.length, mesh.positions.length);
  assert.deepEqual(bounds(back.positions).size, [10, 20, 30]);
});

test('orient matrix is a proper rotation and rejects equal axes', () => {
  for (const [front, up] of [['+z', '+y'], ['-x', '+z'], ['+y', '-x']]) {
    const [a, b, c] = orientMatrix(front, up);
    const det = a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0]);
    assert.equal(det, 1);
  }
  assert.throws(() => orientMatrix('+z', '-z'));
});

test('orient stands the car on the ground, centred, length along X', () => {
  // Length 189 along +z, height 58 along +y, as the test model is.
  const mesh = applyOrient(box(88, 58, 189), { front: '+z', up: '+y' });
  const b = bounds(mesh.positions);
  assert.deepEqual(b.size.map((v) => Math.round(v)), [189, 88, 58]);
  assert.equal(b.min[2], 0);
  assert.ok(Math.abs(b.min[0] + b.max[0]) < 1e-4);
  assert.ok(Math.abs(b.min[1] + b.max[1]) < 1e-4);
  assert.ok(signedVolume(mesh) > 0, 'winding stays outward');
});

test('guessOrient finds length, height and which way is up', () => {
  // A tapering "car": wide at the bottom (z = 0), narrow at the top.
  const positions = new Float32Array([
    0, -40, 0, 180, -40, 0, 180, 40, 0, 0, 40, 0,
    20, -25, 50, 160, -25, 50, 160, 25, 50, 20, 25, 50,
  ]);
  const { indices } = box(1, 1, 1);
  const guess = guessOrient({ positions, indices });
  assert.equal(guess.up, '+z');
  assert.equal(guess.front[1], 'x');
  // Upside down: the top is now at low z.
  const flipped = positions.map((v, i) => (i % 3 === 2 ? -v : v));
  assert.equal(guessOrient({ positions: flipped, indices }).up, '-z');
});

test('scale multiplies every coordinate', () => {
  const mesh = applyScale(box(10, 10, 10), { factor: 1.5 });
  assert.deepEqual(bounds(mesh.positions).size, [15, 15, 15]);
  assert.throws(() => applyScale(box(1, 1, 1), { factor: 0 }));
});

test('slice keeps one side with an open, welded cut', () => {
  const mesh = applySlice(box(10, 10, 10), { axis: 'z', at: 4, keep: 'below' });
  const b = bounds(mesh.positions);
  assert.equal(b.max[2], 4);
  const stats = meshStats(mesh);
  assert.equal(stats.parts, 1);
  assert.equal(stats.faultyEdges, 0);
  assert.equal(stats.openEdges, 4 + 4, 'the cut leaves one open loop of 8 edges');
  const top = applySlice(box(10, 10, 10), { axis: 'z', at: 4, keep: 'above' });
  assert.equal(bounds(top.positions).min[2], 4);
  assert.throws(() => applySlice(box(1, 1, 1), { axis: 'z', at: -1, keep: 'below' }));
});

test('selection runs round trip', () => {
  const faces = [9, 3, 4, 5, 20, 3];
  const runs = encodeRuns(faces);
  assert.deepEqual(runs, [3, 3, 9, 1, 20, 1]);
  assert.deepEqual(decodeRuns(runs), [3, 4, 5, 9, 20]);
  assert.equal(runCount(runs), 5);
});

test('delete removes chosen faces and refuses stale selections', () => {
  const mesh = applyDelete(box(1, 1, 1), { faces: encodeRuns([2, 3]) });
  assert.equal(mesh.indices.length / 3, 10);
  assert.equal(meshStats(mesh).openEdges, 4);
  assert.throws(() => applyDelete(box(1, 1, 1), { faces: [10, 5] }), /no longer matches/);
});

test('replay skips switched-off steps and reports broken ones', () => {
  const steps = [
    { id: 'a', type: 'orient', enabled: true, params: { front: '+z', up: '+y' } },
    { id: 'b', type: 'scale', enabled: false, params: { factor: 2 } },
    { id: 'c', type: 'delete', enabled: true, params: { faces: [100, 1] } },
    { id: 'd', type: 'slice', enabled: true, params: { axis: 'z', at: 10, keep: 'below' } },
  ];
  const { mesh, original, results } = replay(box(40, 20, 100), steps);
  assert.deepEqual(results.map((r) => r.state), ['ok', 'off', 'error', 'ok']);
  assert.equal(bounds(mesh.positions).max[2], 10);
  assert.deepEqual(bounds(original.positions).size.map(Math.round), [100, 40, 20]);
});

// The test car is never part of Anvil: only used when present on this machine.
const MAIN3 = model('Main3.stl');
test('test car Main3.stl: import, orient and statistics', { skip: !existsSync(MAIN3) }, () => {
  const mesh = readSTLMesh(readFileSync(MAIN3));
  assert.equal(mesh.indices.length / 3, 156988);
  const guess = guessOrient(mesh);
  assert.equal(guess.up, '+y');
  assert.equal(guess.front[1], 'z');
  const { mesh: car } = replay(mesh, [{ id: 'o', type: 'orient', enabled: true, params: guess }]);
  const stats = meshStats(car);
  assert.deepEqual(stats.bounds.size.map(Math.round), [189, 88, 58]);
  assert.equal(stats.parts, 1);
  assert.equal(stats.openEdges, 0);
  // Exactly welded, the file is one clean closed shell. (An earlier rough
  // check that rounded coordinates reported 14 faults; those were vertices
  // a few thousandths of a millimetre apart, not real faults.)
  assert.equal(stats.faultyEdges, 0);
});

// More test cars from James, never part of Anvil. Each runs only when present.
const CARS = [
  // Already straight; front was guessed backwards before the "nose is lower" rule.
  { file: model('datsun.stl'), triangles: 23082, front: '-y', up: '+z', turn: 0, size: [100, 46, 30] },
  // Straight in the file, nose along +x.
  { file: model('McLaren_MP4_12C.stl'), triangles: 21376, front: '+x', up: '+z', turn: 0, size: [141, 62, 13] },
];
// A car that sits off straight in its file: the McLaren, turned in plan.
for (const deg of [14, -14]) {
  test(`test car McLaren turned ${deg} degrees: the guess turns it straight`, { skip: !existsSync(CARS[1].file) }, () => {
    const mesh = readSTLMesh(readFileSync(CARS[1].file));
    const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
    const p = mesh.positions.slice();
    for (let i = 0; i < p.length; i += 3) {
      const x = p[i], y = p[i + 1];
      p[i] = c * x - s * y;
      p[i + 1] = s * x + c * y;
    }
    const turned = { positions: p, indices: mesh.indices };
    const guess = guessOrient(turned);
    assert.equal(guess.front, '+x');
    assert.ok(Math.abs(guess.turn + deg) <= 1, `turn ${guess.turn}`);
    const { mesh: oriented } = replay(turned, [{ id: 'o', type: 'orient', enabled: true, params: guess }]);
    const size = bounds(oriented.positions).size;
    assert.ok(Math.abs(size[0] - 141) < 1.5 && Math.abs(size[1] - 61.5) < 1.5, `size ${size.map(Math.round)}`);
  });
}
for (const car of CARS) {
  test(`test car ${car.file.split(/[\\/]/).pop()}: orientation guess`, { skip: !existsSync(car.file) }, () => {
    const mesh = readSTLMesh(readFileSync(car.file));
    assert.equal(mesh.indices.length / 3, car.triangles);
    const guess = guessOrient(mesh);
    assert.equal(guess.front, car.front);
    assert.equal(guess.up, car.up);
    if ('turn' in car) assert.equal(guess.turn, car.turn);
    else assert.ok(Math.abs(guess.turn - car.turnNear) <= 1, `turn ${guess.turn}`);
    const { mesh: oriented } = replay(mesh, [{ id: 'o', type: 'orient', enabled: true, params: guess }]);
    assert.deepEqual(bounds(oriented.positions).size.map(Math.round), car.size);
  });
}

test('Main3 sits straight: no turn is guessed', { skip: !existsSync(MAIN3) }, () => {
  const guess = guessOrient(readSTLMesh(readFileSync(MAIN3)));
  assert.equal(guess.turn, 0);
  assert.equal(guess.front, '+z');
});

test('orient turn straightens a box turned in plan', () => {
  // A 100 x 40 box, turned 20 degrees about Z.
  const b = box(100, 40, 10);
  const c = Math.cos(0.349), s = Math.sin(0.349);
  const p = b.positions.slice();
  for (let i = 0; i < p.length; i += 3) {
    const x = p[i] - 50, y = p[i + 1] - 20;
    p[i] = c * x - s * y;
    p[i + 1] = s * x + c * y;
  }
  const guess = guessOrient({ positions: p, indices: b.indices });
  const { mesh } = replay({ positions: p, indices: b.indices }, [{ id: 'o', type: 'orient', enabled: true, params: guess }]);
  assert.deepEqual(bounds(mesh.positions).size.map(Math.round), [100, 40, 10]);
});
