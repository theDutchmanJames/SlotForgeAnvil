// Smooth scan: grain out, ragged edges straight, creases sharp, nothing
// moved further than allowed, nothing folded.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { applyScanSmooth, checkScanSmooth } from '../src/geometry/denoise.js';
import { meshStats } from '../src/geometry/engine.js';
import { readSTLMesh } from '../src/geometry/stl-mesh.js';
import { model } from './models.js';

// A closed cube of side s, each face an n × n grid of squares.
function gridCube(n, s) {
  const pos = [], idx = [], ids = new Map();
  const point = (x, y, z) => {
    const key = `${x},${y},${z}`;
    if (!ids.has(key)) {
      ids.set(key, pos.length / 3);
      pos.push((x / n) * s, (y / n) * s, (z / n) * s);
    }
    return ids.get(key);
  };
  // Each face: a fixed axis at 0 or n, the other two running over the grid,
  // wound so the normal points out.
  for (const [axis, side] of [[0, 0], [0, n], [1, 0], [1, n], [2, 0], [2, n]]) {
    const [u, v] = [0, 1, 2].filter((k) => k !== axis);
    const at = (i, j) => {
      const c = [0, 0, 0];
      c[axis] = side;
      c[u] = i;
      c[v] = j;
      return point(...c);
    };
    const flip = (side === n) !== ((axis + 1) % 3 === u);
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) {
        const q = [at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1)];
        const tris = [[q[0], q[1], q[2]], [q[0], q[2], q[3]]];
        for (const t of tris) idx.push(...(flip ? [t[0], t[2], t[1]] : t));
      }
  }
  return { positions: new Float32Array(pos), indices: new Uint32Array(idx) };
}
let seed = 7;
const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
// How far a point is from the cube's surface, and from its nearest edge line.
const s = 20;
const offFace = (x, y, z) => Math.min(...[x, y, z].map((c) => Math.min(Math.abs(c), Math.abs(c - s))));
const onEdge = (x, y, z) => [x, y, z].filter((c) => Math.abs(c) < 0.6 || Math.abs(c - s) < 0.6).length >= 2;
const turnedOver = (before, after) => {
  let bad = 0;
  const T = before.indices;
  const n = (P, f) => {
    const a = T[f] * 3, b = T[f + 1] * 3, c = T[f + 2] * 3;
    const u = [P[b] - P[a], P[b + 1] - P[a + 1], P[b + 2] - P[a + 2]], v = [P[c] - P[a], P[c + 1] - P[a + 1], P[c + 2] - P[a + 2]];
    return [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  };
  for (let f = 0; f < T.length; f += 3) {
    const x = n(before.positions, f), y = n(after.positions, f);
    if (x[0] * y[0] + x[1] * y[1] + x[2] * y[2] <= 0) bad++;
  }
  return bad;
};
const moves = (a, b) => Array.from({ length: a.length / 3 }, (_, v) => Math.hypot(a[v * 3] - b[v * 3], a[v * 3 + 1] - b[v * 3 + 1], a[v * 3 + 2] - b[v * 3 + 2]));

test('grain on the faces goes, the cube keeps its sharp edges and its size', () => {
  const cube = gridCube(40, s);
  const P = cube.positions;
  // Grain: every point off the edges moves in or out of its face a little.
  for (let v = 0; v < P.length / 3; v++) {
    const x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2];
    if (onEdge(x, y, z)) continue;
    const k = [x, y, z].findIndex((c) => c === 0 || c === s);
    P[v * 3 + k] += random() * 0.08;
  }
  const grain = (m) => {
    let sum = 0, n = 0;
    for (let v = 0; v < m.positions.length / 3; v++) {
      const p = [m.positions[v * 3], m.positions[v * 3 + 1], m.positions[v * 3 + 2]];
      if (onEdge(...p)) continue;
      sum += offFace(...p) ** 2;
      n++;
    }
    return Math.sqrt(sum / n);
  };
  const out = applyScanSmooth(cube, { strength: 4, tolerance: 0.1, rim: 0.3 });
  assert.ok(grain(out) < grain(cube) * 0.5, `grain ${grain(cube).toFixed(4)} → ${grain(out).toFixed(4)}`);
  // Corners do not move; edges stay on their lines.
  for (let v = 0; v < P.length / 3; v++) {
    const p = [P[v * 3], P[v * 3 + 1], P[v * 3 + 2]];
    if (p.every((c) => c === 0 || c === s)) assert.deepEqual([...out.positions.subarray(v * 3, v * 3 + 3)], p);
  }
  const size = meshStats(out).bounds.size;
  size.forEach((d) => assert.ok(Math.abs(d - s) < 0.1, `size ${size}`));
  const st = meshStats(out);
  assert.equal(st.openEdges, 0);
  assert.equal(st.faultyEdges, 0);
  assert.equal(turnedOver(cube, out), 0);
  assert.ok(Math.max(...moves(cube.positions, out.positions)) <= 0.3 + 1e-6);
});

test('ragged edges are straightened, within the rim distance', () => {
  const cube = gridCube(40, s);
  const P = cube.positions;
  const P0 = Float32Array.from(P);
  const gridAxis = (v) => [0, 1, 2].find((k) => !(P0[v * 3 + k] === 0 || P0[v * 3 + k] === s));
  // A sawtooth along the twelve edges: points move off the edge line, along
  // the face, by up to 0.15 (a third of a square).
  const ragged = [];
  for (let v = 0; v < P.length / 3; v++) {
    const p = [P[v * 3], P[v * 3 + 1], P[v * 3 + 2]];
    const ends = p.map((c) => c === 0 || c === s);
    if (ends.filter(Boolean).length !== 2) continue;
    const free = ends.indexOf(false);
    const across = ends.findIndex((e, k) => e && k !== free);
    const inward = p[across] === 0 ? 1 : -1;
    P[v * 3 + across] += inward * random() * 0.15;
    ragged.push(v);
  }
  // The zigzag: how far each edge point is from halfway between its two
  // neighbours along the edge.
  const lines = new Map();
  for (const v of ragged) {
    const free = gridAxis(v);
    const key = [0, 1, 2].map((k) => (k === free ? '*' : Math.round(Math.round(P0[v * 3 + k] / s) * s))).join(',');
    if (!lines.has(key)) lines.set(key, []);
    lines.get(key).push(v);
  }
  for (const [key, list] of lines) {
    const free = key.split(',').indexOf('*');
    list.sort((a, b) => P0[a * 3 + free] - P0[b * 3 + free]);
  }
  const raggedness = (m) => {
    let sum = 0, n = 0;
    for (const list of lines.values())
      for (let i = 1; i < list.length - 1; i++) {
        const [a, v, b] = [list[i - 1], list[i], list[i + 1]];
        sum += Math.hypot(...[0, 1, 2].map((k) => m.positions[v * 3 + k] - (m.positions[a * 3 + k] + m.positions[b * 3 + k]) / 2)) ** 2;
        n++;
      }
    return Math.sqrt(sum / n);
  };
  const out = applyScanSmooth(cube, { strength: 4, tolerance: 0.05, rim: 0.2 });
  assert.ok(raggedness(out) < raggedness(cube) * 0.6, `ragged ${raggedness(cube).toFixed(4)} → ${raggedness(out).toFixed(4)}`);
  const plain = applyScanSmooth(cube, { strength: 4, tolerance: 0.05, rim: 0.2, edges: false });
  assert.ok(raggedness(plain) > raggedness(out), 'Straighten edges off leaves the edges as they were');
  assert.equal(turnedOver(cube, out), 0);
  assert.equal(meshStats(out).openEdges, 0);
  assert.ok(Math.max(...moves(cube.positions, out.positions)) <= 0.2 + 1e-6);
});

test('a strength or distance out of range is refused', () => {
  assert.throws(() => checkScanSmooth({ strength: 0, tolerance: 0.1 }), /strength/);
  assert.throws(() => checkScanSmooth({ strength: 4, tolerance: 0 }), /surface may move/);
  assert.throws(() => checkScanSmooth({ strength: 4, tolerance: 0.1, rim: -1 }), /rims may move/);
});

const MCLAREN = model('McLaren_MP4_12C.stl');
test('test car McLaren: smoothed, still closed, nothing folded or moved too far', { skip: !existsSync(MCLAREN) }, () => {
  const car = readSTLMesh(readFileSync(MCLAREN));
  const before = meshStats(car);
  const out = applyScanSmooth(car, { strength: 4, tolerance: 0.1, rim: 0.3 });
  const after = meshStats(out);
  assert.equal(after.openEdges, before.openEdges);
  assert.equal(after.faultyEdges, before.faultyEdges);
  assert.equal(turnedOver(car, out), 0);
  assert.ok(Math.max(...moves(car.positions, out.positions)) <= 0.3 + 1e-6);
  after.bounds.size.forEach((d, k) => assert.ok(Math.abs(d - before.bounds.size[k]) < 0.6));
});

test('a project with Smooth scan needs the newer project format', async () => {
  const { encodeProjectFile, newProject } = await import('../src/project.js');
  const p = newProject('body.stl', new ArrayBuffer(0), { front: '-x', up: '+z' });
  assert.equal(JSON.parse(encodeProjectFile(p)).version, 1);
  p.steps.push({ id: 'sm', type: 'scansmooth', enabled: true, params: { strength: 4, tolerance: 0.1, rim: 0.4, edges: true } });
  assert.equal(JSON.parse(encodeProjectFile(p)).version, 4);
});
