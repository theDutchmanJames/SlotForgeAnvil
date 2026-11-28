// Masking tape: what lies under a taped spot is left alone by the tools after it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyDelete, encodeRuns, replay } from '../src/geometry/engine.js';
import { applyArchCut } from '../src/geometry/arches.js';
import { applyWindows } from '../src/geometry/windows.js';
import { holdTaped, keepTaped, tapeField, tapedCorners } from '../src/geometry/tape.js';
import { box, shell } from './shapes.js';

const near = (mesh, at, r) => {
  let n = 0;
  for (let i = 0; i < mesh.positions.length; i += 3) if (Math.hypot(mesh.positions[i] - at[0], mesh.positions[i + 1] - at[1], mesh.positions[i + 2] - at[2]) < r) n++;
  return n;
};

test('the tape field: below 0 inside a spot, above it outside, null without tape', () => {
  assert.equal(tapeField([]), null);
  const t = tapeField([{ at: [0, 0, 0], r: 2 }, { at: [10, 0, 0], r: 1 }]);
  assert.ok(t([0, 0, 1]) < 0);
  assert.ok(t([10, 0.5, 0]) < 0);
  assert.ok(t([5, 0, 0]) > 0);
  assert.ok(t([100, 0, 0]) > 0);
  // A cut's field stays as it was outside the tape.
  const f = keepTaped((p) => 1, [{ at: [0, 0, 0], r: 2 }]);
  assert.ok(f([0, 0, 0]) <= 0 && f([50, 0, 0]) === 1);
});

test('a wheel arch cut keeps what is under the tape', () => {
  // A block 100 × 40 × 20; the arch cuts a circle round x 30, z 0.
  const b = box(100, 40, 20, 20);
  const spot = { at: [30, 0, 5], r: 4 };
  const plain = applyArchCut(b, { cuts: [{ x: 30, z: 0, r: 12 }] });
  const taped = applyArchCut(b, { cuts: [{ x: 30, z: 0, r: 12 }] }, { tape: [spot] });
  assert.equal(near(plain, spot.at, 3.5), 0, 'without tape the arch takes it');
  assert.ok(near(taped, spot.at, 4.01) > 0, 'with tape the side wall stays there');
});

test('a window cut leaves a taped mirror stalk across the opening', () => {
  const body = shell();
  const win = { id: 'w', name: 'Side', points: [[30, -20, 10], [60, -20, 10], [60, -20, 22], [30, -20, 22]], corners: [true, true, true, true], normal: [0, -1, 0], mirror: false, state: 'open' };
  const spot = { at: [45, -19.5, 16], r: 3 };
  const plain = applyWindows(body, { windows: [win], depth: 3, fine: true });
  const taped = applyWindows(body, { windows: [win], depth: 3, fine: true }, { tape: [spot] });
  assert.equal(near(plain, spot.at, 2.5), 0);
  assert.ok(near(taped, spot.at, 3.01) > 0);
});

test('Delete keeps the taped faces it was asked to take', () => {
  const b = box(10, 10, 10, 4);
  const all = encodeRuns([...Array(b.indices.length / 3).keys()]);
  const out = applyDelete(b, { faces: all }, { tape: [{ at: [0, 0, 0], r: 4 }] });
  assert.ok(out.indices.length > 0 && out.indices.length < b.indices.length);
});

test('a Tape step holds its corners still in a smoothing step after it, not before', () => {
  const b = box(40, 40, 20, 20);
  for (let i = 0; i < b.positions.length; i += 3) if (b.positions[i + 2] === 20 && Math.abs(b.positions[i] - 20) < 3 && Math.abs(b.positions[i + 1] - 20) < 3) b.positions[i + 2] = 20.8;
  const spot = { at: [20, 20, 20.8], r: 2.5 };
  const smooth = { id: 's', type: 'smooth', enabled: true, params: { strokes: [{ at: [20, 20, 20], radius: 8 }], strength: 5 } };
  const tape = { id: 't', type: 'tape', enabled: true, params: { spots: [spot] } };
  const under = tapedCorners(b.positions, [spot]);
  assert.ok(under.some(Boolean));
  const held = replay(b, [tape, smooth]);
  const moved = replay(b, [smooth, tape]);
  let same = 0, differs = 0;
  for (let v = 0; v < under.length; v++) {
    if (!under[v]) continue;
    if (held.mesh.positions[v * 3 + 2] === b.positions[v * 3 + 2]) same++;
    if (moved.mesh.positions[v * 3 + 2] !== b.positions[v * 3 + 2]) differs++;
  }
  assert.equal(same, under.filter(Boolean).length, 'all taped corners held');
  assert.ok(differs > 0, 'tape put on after smoothing changes nothing');
  assert.equal(held.results[1].info.taped, 1);
  // holdTaped leaves a changed mesh alone (a step that rebuilt it).
  assert.equal(holdTaped(b, box(1, 1, 1), [spot]).held, 0);
});
