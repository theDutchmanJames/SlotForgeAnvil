import { test } from 'node:test';
import assert from 'node:assert/strict';
import { replay, bounds } from '../src/geometry/engine.js';
import { wallThickness } from '../src/geometry/shell.js';
import { variantChassis, variantFactor, variantSteps } from '../src/variants.js';
import { box } from './shapes.js';

// A 60 × 30 × 20 block, as imported.
const source = () => {
  const b = box(60, 30, 20, 12);
  for (let i = 1; i < b.positions.length; i += 3) b.positions[i] -= 15;
  return b;
};
const type = { id: 'screw', name: 'M2', kind: 'screw', outer: 4, hole: 1.6, depth: 6, fillet: 1.2 };
const steps = [
  { id: 'o', type: 'orient', enabled: true, params: { front: '-x', up: '+z', turn: 0 } },
  { id: 'f', type: 'floor', enabled: true, params: { mode: 'cut', at: 2 } },
  { id: 'h', type: 'hollow', enabled: true, params: { wall: 1 } },
  { id: 'p', type: 'posts', enabled: true, params: { posts: [{ x: 0, y: 0 }], type, base: 3, length: 0 } },
];
const median = (a) => {
  const s = Array.from(a).filter(Number.isFinite).sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
};

test('variant factor: 1:32 to 1:24 is 32 / 24; the same scale is 1', () => {
  assert.equal(variantFactor({ from: 32, to: 24 }), 32 / 24);
  assert.equal(variantFactor({ from: 32, to: 32 }), 1);
  assert.equal(variantFactor({}), 1);
});

test('variant: leaving a step out', () => {
  const v = variantSteps(steps, { off: ['p'] });
  assert.deepEqual(v.map((s) => s.id), ['o', 'f', 'h']);
});

test('variant at another scale: the body grows, the wall and the posts stay their real size', () => {
  const plain = replay(source(), steps).mesh;
  const v = variantSteps(steps, { id: 'big', from: 32, to: 24 });
  assert.equal(v[1].type, 'scale');
  assert.equal(v[2].params.at, 2 * (32 / 24), 'the floor line moves with the body');
  const big = replay(source(), v).mesh;
  const f = 32 / 24;
  const a = bounds(plain.positions).size, b = bounds(big.positions).size;
  assert.ok(Math.abs(b[0] - a[0] * f) < 1e-3 && Math.abs(b[1] - a[1] * f) < 1e-3, `size ${a} → ${b}`);
  // The wall: 1 mm in both (measured all round, the typical value).
  const w1 = median(wallThickness(plain)), w2 = median(wallThickness(big));
  assert.ok(Math.abs(w1 - 1) < 0.1 && Math.abs(w2 - 1) < 0.1, `wall ${w1} and ${w2}`);
  // The post: 4 mm round in both (its piece: the corners near its spot, low down).
  const postWidth = (m, x) => {
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < m.positions.length; i += 3) {
      const [px, py, pz] = [m.positions[i], m.positions[i + 1], m.positions[i + 2]];
      if (Math.abs(px - x) < 5 && Math.abs(py) < 5 && pz < 8) (lo = Math.min(lo, py)), (hi = Math.max(hi, py));
    }
    return hi - lo;
  };
  assert.ok(Math.abs(postWidth(plain, 0) - 4) < 0.05, `post ${postWidth(plain, 0)}`);
  assert.ok(Math.abs(postWidth(big, 0) - 4) < 0.05, `post ${postWidth(big, 0)}`);
});

test('variant chassis: grown with the body', () => {
  const c = { frontX: 10, wheelbase: 40, clearance: 1, deck: 3, guideAhead: 8, front: { diameter: 16, width: 8, inOut: 12 }, rear: { diameter: 16, width: 8, inOut: 12 } };
  const g = variantChassis(c, 1.5);
  assert.equal(g.wheelbase, 60);
  assert.equal(g.front.diameter, 24);
  assert.equal(variantChassis(c, 1), c);
});
