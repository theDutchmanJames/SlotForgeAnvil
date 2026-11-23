import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { bounds, meshStats, replay } from '../src/geometry/engine.js';
import { applyFloor, applyHollow, volume } from '../src/geometry/shell.js';
import { POST_TYPES, applyPosts, fitTestPiece, loosePost, postProfile, revolve } from '../src/geometry/posts.js';
import { readSTLMesh } from '../src/geometry/stl-mesh.js';
import { model } from './models.js';

function box(sx, sy, sz, n = 8) {
  const pos = [], idx = [], key = new Map();
  const vert = (x, y, z) => {
    const k = `${x},${y},${z}`;
    if (!key.has(k)) {
      key.set(k, pos.length / 3);
      pos.push(x, y, z);
    }
    return key.get(k);
  };
  const face = (o, u, v) => {
    for (let j = 0; j < n; j++)
      for (let i = 0; i < n; i++) {
        const p = (a, b) => vert(...o.map((x, k) => x + (u[k] * a) / n + (v[k] * b) / n));
        const a = p(i, j), b = p(i + 1, j), c = p(i + 1, j + 1), d = p(i, j + 1);
        idx.push(a, b, c, a, c, d);
      }
  };
  face([0, 0, 0], [0, sy, 0], [sx, 0, 0]);
  face([0, 0, sz], [sx, 0, 0], [0, sy, 0]);
  face([0, 0, 0], [sx, 0, 0], [0, 0, sz]);
  face([0, sy, 0], [0, 0, sz], [sx, 0, 0]);
  face([0, 0, 0], [0, 0, sz], [0, sy, 0]);
  face([sx, 0, 0], [0, sy, 0], [0, 0, sz]);
  return { positions: Float32Array.from(pos), indices: Uint32Array.from(idx) };
}
// A 100 × 40 × 30 shell with a 1 mm wall, open underneath, centred on Y = 0.
const shell = () => {
  const b = box(100, 40, 30);
  for (let i = 1; i < b.positions.length; i += 3) b.positions[i] -= 20;
  return applyHollow(applyFloor(b, { mode: 'cut', at: 0.5 }), { wall: 1 });
};
// Only the post: the faces added after the body.
const postPart = (body, out) => ({
  positions: out.positions.slice(body.positions.length),
  indices: Uint32Array.from(out.indices.slice(body.indices.length), (v) => v - body.positions.length / 3),
});

test('a turned profile is closed and faces outwards', () => {
  for (const t of Object.values(POST_TYPES)) {
    const m = revolve(postProfile(t, 0, 20, 10), 0, 0, 24);
    const mesh = { positions: Float32Array.from(m.positions), indices: Uint32Array.from(m.indices) };
    const s = meshStats(mesh);
    assert.equal(s.openEdges, 0, t.name);
    assert.equal(s.faultyEdges, 0, t.name);
    assert.ok(volume(mesh) > 0, 'faces outwards');
  }
});

test('an automatic post reaches from the chassis into the roof but not through it', () => {
  const body = shell();
  const out = applyPosts(body, { posts: [{ x: 50, y: 0, base: 4 }], type: POST_TYPES.screw });
  assert.equal(out.info.made, 1);
  assert.deepEqual(out.info.warnings, []);
  const b = bounds(postPart(body, out).positions);
  assert.ok(Math.abs(b.min[2] - 4) < 1e-4, `bottom ${b.min[2]}`);
  assert.ok(b.max[2] > 29.1 && b.max[2] < 29.7, `top ${b.max[2]} (roof underside 29, outside 30)`);
  assert.ok(Math.abs(b.size[0] - (4 + 2 * 1.2)) < 0.05, 'flared top');
  const p = meshStats(postPart(body, out));
  assert.equal(p.openEdges + p.faultyEdges, 0);
});

test('a fixed-length post hangs from the roof with a cut mark at the chassis', () => {
  const body = shell();
  const out = applyPosts(body, { posts: [{ x: 50, y: 0, base: 4, length: 30 }], type: POST_TYPES.screw });
  const post = postPart(body, out);
  const b = bounds(post.positions);
  assert.ok(Math.abs(b.max[2] - b.min[2] - 30) < 1e-3);
  // The groove: points just inside the post radius at the base height.
  let groove = false;
  for (let i = 0; i < post.positions.length; i += 3) {
    const r = Math.hypot(post.positions[i] - 50, post.positions[i + 1]);
    if (Math.abs(post.positions[i + 2] - 4) < 1e-3 && r < 1.99 && r > 1.7) groove = true;
  }
  assert.ok(groove, 'cut mark at the base');
});

test('posts warn when there is nothing above them or when too short', () => {
  const body = shell();
  const out = applyPosts(body, {
    posts: [
      { x: 150, y: 0, base: 4 },
      { x: 50, y: 0, base: 4, length: 10 },
    ],
    type: POST_TYPES.socket,
  });
  assert.equal(out.info.made, 1);
  assert.ok(out.info.warnings.some((w) => w.startsWith('No body above')));
  assert.ok(out.info.warnings.some((w) => w.includes('too short')));
  assert.throws(() => applyPosts(body, { posts: [], type: { outer: 2, hole: 3 } }));
});

test('loose post and fit test piece are closed solids', () => {
  for (const m of [loosePost(POST_TYPES.screw, 12), fitTestPiece(POST_TYPES.socket)]) {
    const s = meshStats(m);
    assert.equal(s.openEdges + s.faultyEdges, 0);
    assert.ok(volume(m) > 0);
  }
  assert.ok(Math.abs(bounds(loosePost(POST_TYPES.screw, 12).positions).size[2] - 12) < 1e-4);
});

const MAIN3 = model('Main3.stl');
test('test car Main3: two posts under the roof after hollowing', { skip: !existsSync(MAIN3) }, () => {
  const src = readSTLMesh(readFileSync(MAIN3));
  const steps = [
    { id: 'o', type: 'orient', enabled: true, params: { front: '+z', up: '+y' } },
    { id: 'f', type: 'floor', enabled: true, params: { mode: 'cut', at: 4.5 } },
    { id: 'h', type: 'hollow', enabled: true, params: { wall: 1 } },
  ];
  const body = replay(src, steps).mesh;
  const b = bounds(body.positions);
  const x1 = b.min[0] + b.size[0] * 0.3, x2 = b.min[0] + b.size[0] * 0.7;
  const posts = [x1, x2].map((x) => ({ x, y: 0, base: 3 }));
  const { mesh, results } = replay(src, [...steps, { id: 'p', type: 'posts', enabled: true, params: { posts, type: POST_TYPES.screw } }]);
  assert.equal(results[3].state, 'ok', JSON.stringify(results[3]));
  assert.equal(results[3].info.made, 2, JSON.stringify(results[3].info));
  const top = bounds(mesh.positions).max[2];
  assert.ok(Math.abs(top - b.max[2]) < 1e-4, 'nothing pokes out of the roof');
});
