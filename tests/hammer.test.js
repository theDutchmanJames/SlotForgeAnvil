import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { bounds, meshStats, replay } from '../src/geometry/engine.js';
import { applyHammer } from '../src/geometry/hammer.js';
import { readSTLMesh } from '../src/geometry/stl-mesh.js';
import { model } from './models.js';

// A flat 40 × 40 mm sheet of 4 × 4 squares: coarse on purpose.
function sheet(n = 4, size = 40) {
  const pos = [], idx = [];
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) pos.push((i / n) * size, (j / n) * size, 0);
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const a = j * (n + 1) + i, b = a + 1, c = a + n + 2, d = a + n + 1;
      idx.push(a, b, c, a, c, d);
    }
  return { positions: Float32Array.from(pos), indices: Uint32Array.from(idx) };
}
const zAt = (m, x, y) => {
  let best = Infinity, z = null;
  for (let v = 0; v < m.positions.length / 3; v++) {
    const d = Math.hypot(m.positions[v * 3] - x, m.positions[v * 3 + 1] - y);
    if (d < best) [best, z] = [d, m.positions[v * 3 + 2]];
  }
  return z;
};

test('a blow from behind raises a smooth bump, strongest in the middle', () => {
  const r = applyHammer(sheet(), { blows: [{ at: [20, 20, 0], radius: 8, depth: 1, kind: 'out' }] });
  assert.ok(Math.abs(zAt(r, 20, 20) - 1) < 1e-6, 'full depth under the head');
  assert.ok(zAt(r, 24, 20) > 0.3 && zAt(r, 24, 20) < 0.9, 'less towards the edge');
  assert.equal(zAt(r, 35, 35), 0, 'nothing beyond the head');
  assert.ok(r.info.added > 0, 'the coarse sheet was refined where the blow landed');
  assert.equal(meshStats(r).faultyEdges, 0);
});

test('a blow from outside pushes in; mirrored blows are just two blows', () => {
  const r = applyHammer(sheet(), { blows: [{ at: [20, 20, 0], radius: 8, depth: 0.5, kind: 'in' }] });
  assert.ok(Math.abs(zAt(r, 20, 20) + 0.5) < 1e-6);
});

test('a dolly holds its area in place', () => {
  const r = applyHammer(sheet(), {
    blows: [{ at: [20, 20, 0], radius: 10, depth: 1, kind: 'out' }],
    dollies: [{ at: [25, 20, 0], radius: 4 }],
  });
  assert.ok(Math.abs(zAt(r, 25, 20)) < 1e-6, 'held under the dolly');
  assert.ok(zAt(r, 17, 20) > 0.5, 'free elsewhere');
});

test('planishing evens out a dent', () => {
  const dented = applyHammer(sheet(8), { blows: [{ at: [20, 20, 0], radius: 4, depth: 1, kind: 'out' }] });
  const smoothed = applyHammer(dented, { blows: [{ at: [20, 20, 0], radius: 10, depth: 1, kind: 'planish' }] });
  assert.ok(zAt(smoothed, 20, 20) < zAt(dented, 20, 20) * 0.9);
});

test('a broken blow is refused', () => {
  assert.throws(() => applyHammer(sheet(), { blows: [{ at: [0, 0, 0], radius: 0, depth: 1, kind: 'out' }] }), /damaged/);
});

const MAIN3 = model('Main3.stl');
test('test car Main3: flaring a rear arch, then hollowing', { skip: !existsSync(MAIN3) }, () => {
  const src = readSTLMesh(readFileSync(MAIN3));
  const o = { id: 'o', type: 'orient', enabled: true, params: { front: '+z', up: '+y' } };
  const f = { id: 'f', type: 'floor', enabled: true, params: { mode: 'cut', at: 3.5 } };
  const plain = replay(src, [o, f]).mesh;
  const b = bounds(plain.positions);
  // The body side above the rear arch: the outermost point in a small window there.
  const x0 = b.min[0] + b.size[0] * 0.78;
  const sideAt = (m) => {
    let best = -Infinity;
    for (let v = 0; v < m.positions.length / 3; v++) {
      const [x, y, z] = m.positions.subarray(v * 3, v * 3 + 3);
      if (Math.abs(x - x0) < 3 && z > 22 && z < 28 && y > best) best = y;
    }
    return best;
  };
  const before = sideAt(plain);
  const at = [x0, before, 25];
  const h = { id: 'h', type: 'hammer', enabled: true, params: { blows: [{ at, radius: 12, depth: 1.5, kind: 'out' }] } };
  const t0 = performance.now();
  const { mesh, results } = replay(src, [o, f, h, { id: 'w', type: 'hollow', enabled: true, params: { wall: 1 } }]);
  const ms = performance.now() - t0;
  assert.deepEqual(results.map((r) => r.state), ['ok', 'ok', 'ok', 'ok'], JSON.stringify(results));
  const after = sideAt(mesh);
  assert.ok(after > before + 0.8, `side moved from ${before.toFixed(2)} to ${after.toFixed(2)}`);
  assert.equal(meshStats(mesh).faultyEdges, 0);
  assert.ok(ms < 30000, `took ${ms} ms`);
});
