import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fitPart, placePart, printLayout, roundHoles } from '../src/geometry/chassisparts.js';
import { applyOrient, applyOrientAt, guessOrient, orientShift } from '../src/geometry/engine.js';
import { bounds } from '../src/geometry/bounds.js';
import { readSTLMesh } from '../src/geometry/stl-mesh.js';
import { joinMeshes } from '../src/geometry/topology.js';
import { box } from './shapes.js';
import { model } from './models.js';

// A slab sx × sy, h high, standing at z0, made of 1 mm cells, with 2 × 2 mm
// holes centred on the given spots. Moved by at; turned a quarter turn if turn.
function slab(sx, sy, h, holes, { at = [0, 0, 0], z0 = 0, turn = false } = {}) {
  const cells = [];
  for (let j = 0; j < sy; j++)
    for (let i = 0; i < sx; i++) {
      const cx = i + 0.5, cy = j + 0.5;
      if (holes.some(([x, y]) => Math.abs(cx - x) < 1.5 && Math.abs(cy - y) < 1.5)) continue;
      const b = box(1, 1, h, 1);
      for (let k = 0; k < b.positions.length; k += 3) {
        b.positions[k] += i;
        b.positions[k + 1] += j;
        b.positions[k + 2] += z0;
      }
      cells.push(b);
    }
  const m = joinMeshes(cells);
  for (let k = 0; k < m.positions.length; k += 3) {
    let x = m.positions[k], y = m.positions[k + 1];
    if (turn) [x, y] = [-y, x];
    m.positions[k] = x + at[0];
    m.positions[k + 1] = y + at[1];
    m.positions[k + 2] += at[2];
  }
  return m;
}

// The chassis: a 40 × 30 plate, 2 high, with four screw holes 20 × 10 apart.
const SPOTS = [[10, 10], [30, 10], [10, 20], [30, 20]];
const chassis = slab(40, 30, 2, SPOTS);

test('round holes straight through are found, with their middle and width', () => {
  const h = roundHoles(chassis).sort((a, b) => a.y - b.y || a.x - b.x);
  assert.equal(h.length, 4);
  h.forEach((x, i) => {
    assert.ok(Math.hypot(x.x - SPOTS[i][0], x.y - SPOTS[i][1]) < 0.1, `hole ${i} at ${x.x},${x.y}`);
    assert.ok(x.d > 2 && x.d < 2.6, `width ${x.d}`);
  });
});

test('a part is fitted by its holes: turned, moved, and resting on the chassis', () => {
  // The part: a 26 × 16 bar, 5 high, with holes 20 × 10 apart, drawn
  // elsewhere and turned a quarter turn in its file.
  const part = slab(26, 16, 5, [[3, 3], [23, 3], [3, 13], [23, 13]], { at: [100, 50, 7], turn: true });
  const { fits, holes } = fitPart(chassis, part);
  assert.equal(holes, 4);
  assert.ok(fits.length >= 1);
  assert.equal(fits[0].matched, 4);
  const placed = placePart(part, fits[0]);
  const b = bounds(placed.positions);
  assert.ok(Math.abs(b.min[2] - 2) < 1e-3, `resting on the plate top, at ${b.min[2]}`);
  const got = roundHoles(placed).map((h) => [h.x, h.y]);
  for (const [x, y] of SPOTS) assert.ok(got.some(([u, v]) => Math.hypot(u - x, v - y) < 0.2), `a part hole over ${x},${y}`);
});

test('a part with holes that match nothing gets no fit', () => {
  const part = slab(12, 12, 3, [[3, 3], [9, 9]]);
  assert.equal(fitPart(chassis, part).fits.length, 0);
});

test('the chassis and its parts are laid out on one plate, not overlapping', () => {
  const parts = [slab(26, 16, 5, [[3, 3]], { z0: 9 }), slab(10, 10, 3, [], { at: [-50, 0, -4] }), slab(30, 8, 2, [])];
  const pieces = printLayout(chassis, parts);
  assert.equal(pieces.length, 4);
  const boxes = pieces.map((p) => bounds(p.positions));
  for (const b of boxes) assert.ok(Math.abs(b.min[2] - boxes[0].min[2]) < 1e-4, 'all on the plate');
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++) {
      const [a, c] = [boxes[i], boxes[j]];
      const apart = a.max[0] <= c.min[0] || c.max[0] <= a.min[0] || a.max[1] <= c.min[1] || c.max[1] <= a.min[1];
      assert.ok(apart, `pieces ${i} and ${j} overlap`);
    }
  // The chassis itself stays where it is in its file.
  assert.deepEqual(Array.from(pieces[0].positions), Array.from(chassis.positions));
});

test('a part turns with the chassis exactly as the chassis turns', () => {
  const o = { front: '+y', up: '+z', turn: 0, tilt: 0, lean: 0 };
  const both = applyOrient(joinMeshes([chassis, slab(5, 5, 1, [], { at: [3, 4, 2] })]), o);
  const shift = orientShift(chassis, o);
  const alone = applyOrientAt(slab(5, 5, 1, [], { at: [3, 4, 2] }), o, shift);
  const ch = applyOrient(chassis, o);
  // The chassis turned alone and the part turned with its shift: as if
  // they were turned together (the part lies within the chassis's bounds).
  const n = ch.positions.length;
  for (let i = 0; i < alone.positions.length; i++) assert.ok(Math.abs(alone.positions[i] - both.positions[n + i]) < 1e-4);
});

// Peter's chassis and its parts, where the test models are.
const peter = model("Peter's Chassis.stl");
const read = (f) => {
  const b = readFileSync(f);
  return readSTLMesh(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
};
test("Peter's posts and motor bracket fit his chassis", { skip: !existsSync(peter) || !existsSync(model('Bracket.stl')) }, () => {
  const raw = read(peter);
  const o = guessOrient(raw);
  const ch = applyOrient(raw, o), shift = orientShift(raw, o);
  const fit = (name) => fitPart(ch, applyOrientAt(read(model(name)), o, shift)).fits[0];
  const p1 = fit('pillar_1.stl'), p2 = fit('pillar_2.stl'), br = fit('Bracket.stl');
  assert.equal(p1.matched, 4);
  assert.equal(p2.matched, 4);
  assert.equal(br.matched, 2);
  // Posts stand on the deck; the bracket on the raised bosses by the motor.
  assert.equal([p1.turn, p2.turn, br.turn].join(), '0,0,0');
  assert.ok(Math.abs(p1.z + 9) < 0.01 && Math.abs(p2.z + 4) < 0.01 && Math.abs(br.z + 4) < 0.01, `${p1.z} ${p2.z} ${br.z}`);
});

test('parts travel with a chassis shared as a file', async () => {
  const { encodeChassisFile, decodeChassisFile } = await import('../src/library-db.js');
  const c = { name: 'Test', wheelbase: 60, clearance: 1, frontX: 0, front: { diameter: 20, width: 8, inOut: 25 }, rear: { diameter: 20, width: 10, inOut: 25 }, stl: { fileName: 'c.stl', flip: false }, parts: [{ id: 'p1', name: 'Bracket', fileName: 'Bracket.stl', stl: 'AAAA', on: false, mount: false, fit: { turn: 0, x: 1, y: 2, z: 3, matched: 2, of: 2 }, fits: 3, fitNo: 1 }] };
  const back = decodeChassisFile(encodeChassisFile(c, new Uint8Array([1, 2, 3]))).chassis;
  assert.deepEqual(back.parts, c.parts);
});
