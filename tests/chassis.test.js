import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { replay } from '../src/geometry/engine.js';
import { findArches, fitReport, suggestChassis } from '../src/geometry/chassis.js';
import { readSTLMesh } from '../src/geometry/stl-mesh.js';
import { model } from './models.js';

// James's test cars: never part of Anvil, only used when present.
const CARS = [
  { name: 'Main3', file: model('Main3.stl'), orient: { front: '+z', up: '+y' }, wheelbase: 114.5 },
  { name: 'Datsun', file: model('datsun.stl'), orient: { front: '-y', up: '+z' }, wheelbase: 48.7 },
];
for (const car of CARS) {
  test(`test car ${car.name}: arches found and a fitting chassis suggested`, { skip: !existsSync(car.file) }, () => {
    const { mesh } = replay(readSTLMesh(readFileSync(car.file)), [{ id: 'o', type: 'orient', enabled: true, params: car.orient }]);
    const found = findArches(mesh);
    assert.equal(found.arches.length, 2);
    assert.ok(Math.abs(found.arches[1].x - found.arches[0].x - car.wheelbase) < 1.5, `arches ${found.arches.map((a) => a.x.toFixed(1))}`);
    const c = suggestChassis(found);
    assert.deepEqual(fitReport(c, found).problems, []);
    // A shorter chassis is reported, by how much.
    const short = fitReport({ ...c, wheelbase: c.wheelbase - 2.5 }, found);
    assert.ok(short.problems.includes('wheelbase'));
    assert.ok(Math.abs(short.wheelbaseOff - 2.5) < 0.06, `off ${short.wheelbaseOff}`); // the suggestion is rounded to 0.1 mm
    // Tyres pushed out are reported as sticking out.
    const wide = fitReport({ ...c, rear: { ...c.rear, inOut: c.rear.inOut + 3 } }, found);
    assert.ok(wide.problems.includes('rear-wide'));
  });
}
