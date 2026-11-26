import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkClearance, guideZone } from '../src/geometry/clearance.js';
import { applyGuideCut } from '../src/geometry/arches.js';
import { meshStats } from '../src/geometry/engine.js';
import { applyFloor } from '../src/geometry/shell.js';
import { box } from './shapes.js';

// A 100 × 40 × 20 block standing 1 mm above the track, centred on Y = 0.
function body() {
  const b = box(100, 40, 20, 20);
  for (let i = 0; i < b.positions.length; i += 3) {
    b.positions[i + 1] -= 20;
    b.positions[i + 2] += 1;
  }
  return b;
}
// Tyres outside the body, guide well ahead of the nose, low deck.
const chassis = (over = {}) => ({
  frontX: 20, wheelbase: 60, clearance: 1, deck: 0.5, guideAhead: 40,
  front: { diameter: 16, width: 8, inOut: 30 }, rear: { diameter: 16, width: 8, inOut: 30 },
  ...over,
});

test('clearance: a body clear of the chassis has no hits', () => {
  const r = checkClearance(body(), chassis(), 0, { gap: 0.2 });
  assert.equal(r.parts.length, 0);
  assert.ok(!r.faces.some(Boolean));
});

test('clearance: tyres inside the body and the guide under the nose are found', () => {
  // Tyres 4 mm inside each side; guide under the front of the body.
  // (The deck sits 0.25 mm under the block: a gap of 0.2 leaves it out.)
  const r = checkClearance(body(), chassis({ guideAhead: 15, front: { diameter: 16, width: 8, inOut: 20 } }), 0, { gap: 0.2 });
  const keys = r.parts.map((p) => p.key).sort();
  assert.deepEqual(keys, ['front-left', 'front-right', 'guide']);
  const fl = r.parts.find((p) => p.key === 'front-left');
  assert.ok(fl.at[1] < 0 && Math.abs(fl.at[0] - 20) < 6, `front left at ${fl.at}`);
  assert.ok(Math.abs(fl.depth - 4.2) < 0.5, `depth ${fl.depth}`);
  assert.ok(r.faces.some(Boolean));
});

test('clearance: a chassis STL inside the body is found; corners near posts are left out', () => {
  // A 20 × 10 × 6 "motor" poking 2 mm up into the bottom of the body at x = 60.
  const motor = box(20, 10, 6, 2);
  for (let i = 0; i < motor.positions.length; i += 3) {
    motor.positions[i] += 50;
    motor.positions[i + 1] -= 5;
    motor.positions[i + 2] -= 3;
  }
  const r = checkClearance(body(), chassis(), 0, { gap: 0.3, mesh: motor });
  const c = r.parts.find((p) => p.kind === 'chassis');
  assert.ok(c, 'the motor hits');
  assert.ok(Math.abs(c.at[0] - 60) < 3 && Math.abs(c.at[1]) < 1, `at ${c.at}`);
  assert.ok(c.depth > 1.5 && c.depth < 2.6, `depth ${c.depth}`);
  const skipped = checkClearance(body(), chassis(), 0, { gap: 0.3, mesh: motor, skip: (x) => x > 45 && x < 75 });
  assert.equal(skipped.parts.length, 0);
});

test('guide cut: the room for the guide is cut and a shell wall is closed round it', () => {
  // A closed 1 mm shell, its underside opened by the floor line.
  const outer = box(100, 40, 30, 16), inner = box(98, 38, 28, 16);
  const pos = [...outer.positions];
  for (let i = 0; i < inner.positions.length; i += 3) pos.push(inner.positions[i] + 1, inner.positions[i + 1] + 1, inner.positions[i + 2] + 1);
  const off = outer.positions.length / 3;
  const idx = [...outer.indices];
  for (let i = 0; i < inner.indices.length; i += 3) idx.push(inner.indices[i] + off, inner.indices[i + 2] + off, inner.indices[i + 1] + off);
  for (let i = 1; i < pos.length; i += 3) pos[i] -= 20;
  const shell = applyFloor({ positions: Float32Array.from(pos), indices: Uint32Array.from(idx) }, { mode: 'cut', at: 5 });
  // Guide at the very nose, 6.3 mm round, 12 mm high: notches the front wall.
  const out = applyGuideCut(shell, { x: 0.4, y: 0.2, r: 6.3, top: 12 });
  assert.ok(out.info.removed > 0);
  const st = meshStats(out);
  assert.equal(st.openEdges, 0);
  assert.equal(st.faultyEdges, 0);
  assert.ok(out.info.walls >= 1);
  // The zone helper: defaults from the front tyre.
  const g = guideZone(chassis(), 0);
  assert.equal(g.x, -20);
  assert.ok(g.r > 0 && g.top > 0);
});
