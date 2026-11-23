import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { bounds, meshStats, replay } from '../src/geometry/engine.js';
import { applyArchCut, applyStretch, flareBlows } from '../src/geometry/arches.js';
import { findArches } from '../src/geometry/chassis.js';
import { readSTLMesh } from '../src/geometry/stl-mesh.js';
import { model } from './models.js';

// A side panel with a round arch: points on a circle, for checking roundness.
const circle = (cx, cz, r, n = 24) => {
  const pos = [];
  for (let i = 0; i < n; i++) {
    const a = Math.PI * (i / (n - 1));
    pos.push(cx - Math.cos(a) * r, 10, cz + Math.sin(a) * r);
  }
  return pos;
};

test('stretch moves the rear arch as one piece, so both arches stay round', () => {
  const front = circle(-50, 0, 12), rear = circle(50, 0, 12);
  const mesh = { positions: Float32Array.from([...front, ...rear]), indices: new Uint32Array(0) };
  const s = applyStretch(mesh, { axis: 'x', amount: 2.5, from: -35, to: 35 });
  for (let i = 0; i < front.length; i += 3) assert.equal(s.positions[i], Math.fround(front[i]), 'front arch untouched');
  for (let i = 0; i < rear.length; i += 3) assert.ok(Math.abs(s.positions[front.length + i] - (rear[i] + 2.5)) < 1e-5, 'rear arch shifted whole');
});

test('stretch blends smoothly in between, without a kink', () => {
  const xs = Array.from({ length: 101 }, (_, i) => -35 + i * 0.7);
  const mesh = { positions: Float32Array.from(xs.flatMap((x) => [x, 0, 0])), indices: new Uint32Array(0) };
  const s = applyStretch(mesh, { axis: 'x', amount: 4, from: -35, to: 35 });
  let prev = null;
  for (let i = 1; i < xs.length; i++) {
    const step = s.positions[i * 3] - s.positions[(i - 1) * 3];
    if (prev != null) assert.ok(Math.abs(step - prev) < 0.01, 'spacing changes gradually');
    prev = step;
  }
  assert.ok(Math.abs(s.positions[(xs.length - 1) * 3] - (35 + 4)) < 1e-4);
});

test('widening makes the body wider by the amount asked', () => {
  const mesh = { positions: Float32Array.from([0, -20, 0, 0, 20, 0, 5, 10, 3]), indices: new Uint32Array(0) };
  const s = applyStretch(mesh, { axis: 'y', amount: 3 });
  assert.ok(Math.abs(bounds(s.positions).size[1] - 43) < 1e-4);
});

test('an arch cut removes the body inside the circle and leaves the cut open', () => {
  // A flat side panel (x 0..60, z 0..30) in the plane y = 10.
  const n = 30, pos = [], idx = [];
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) pos.push((i / n) * 60, 10, (j / n) * 30);
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const a = j * (n + 1) + i;
      idx.push(a, a + 1, a + n + 2, a, a + n + 2, a + n + 1);
    }
  const cut = applyArchCut({ positions: Float32Array.from(pos), indices: Uint32Array.from(idx) }, { cuts: [{ x: 30, z: 0, r: 12 }] });
  assert.ok(cut.info.removed > 0);
  for (let i = 0; i < cut.positions.length; i += 3) {
    const d = Math.hypot(cut.positions[i] - 30, cut.positions[i + 2]);
    assert.ok(d >= 12 - 1e-4, `a point is left inside the arch (${d})`);
  }
  assert.equal(meshStats(cut).faultyEdges, 0);
});

test('flare blows run round the arch on both sides', () => {
  const blows = flareBlows({ x: 50, z: 12, r: 13, side: 40, amount: 1, head: 6 });
  assert.ok(blows.length >= 10);
  assert.ok(blows.every((b) => b.kind === 'out' && b.at[2] > 12));
  assert.equal(blows.filter((b) => b.at[1] > 0).length, blows.length / 2);
});

const DATSUN = model('datsun.stl');
test('test car Datsun: stretched by 2 mm, the arches end up 2 mm further apart and stay as wide', { skip: !existsSync(DATSUN) }, () => {
  const src = readSTLMesh(readFileSync(DATSUN));
  const o = { id: 'o', type: 'orient', enabled: true, params: { front: '-y', up: '+z' } };
  const before = findArches(replay(src, [o]).mesh).arches;
  const from = before[0].x + before[0].width / 2, to = before[1].x - before[1].width / 2;
  const { mesh } = replay(src, [o, { id: 's', type: 'stretch', enabled: true, params: { axis: 'x', amount: 2, from, to } }]);
  const after = findArches(mesh).arches;
  assert.ok(Math.abs(after[1].x - after[0].x - (before[1].x - before[0].x) - 2) < 0.6, `${after[1].x - after[0].x}`);
  assert.ok(Math.abs(after[1].width - before[1].width) < 0.6, 'rear arch keeps its size');
});
