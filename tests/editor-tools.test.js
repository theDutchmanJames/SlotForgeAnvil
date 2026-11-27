import test from 'node:test';
import {existsSync, readFileSync} from 'node:fs';
import {model} from './models.js';
import {bounds} from '../src/geometry/engine.js';
import {readSTLMesh} from '../src/geometry/stl-mesh.js';
import assert from 'node:assert/strict';
import {box} from './shapes.js';
import {applyBodyShape} from '../src/geometry/bodyshape.js';
import {arrangeFeatures, shapeSteps, matchesStep, stepMetadata} from '../src/editor-operations.js';
import {replay, meshStats} from '../src/geometry/engine.js';
import {variantSteps} from '../src/variants.js';
import {encodeProjectFile, decodeProjectFile, newProject, snapshot, restore, createHistory} from '../src/project.js';
import {encodeSTL} from '../src/geometry/stl-mesh.js';
import {buildSheet} from '../src/build-sheet.js';
const opts = {from:10,to:90,blend:10,base:10,front:20,rear:20,height:-25};
const shape = () => { const m = box(100,40,30,20); for(let i=1;i<m.positions.length;i+=3)m.positions[i]-=20; return m; };
const step = (id,type,params) => ({id,type,enabled:true,params});

test('body shaping keeps boundary points, topology, symmetry and lower height while changing the interior', () => {
  const source=shape(), before=source.positions.slice(), result=applyBodyShape(source,opts);
  assert.deepEqual(source.positions,before); assert.equal(result.indices,source.indices);
  let changed=0;
  for(let i=0;i<before.length;i+=3){const [x,y,z]=before.slice(i,i+3); assert.equal(result.positions[i],x);
    if(x<=10||x>=90)assert.deepEqual(result.positions.slice(i,i+3),before.slice(i,i+3));
    if(z<=10)assert.equal(result.positions[i+2],z);
    if(x===50&&z===30){assert.equal(result.positions[i+2],25);assert.ok(Math.abs(result.positions[i+1]-y*1.2)<1e-5);changed++;}
  }
  assert.ok(changed); const stats=meshStats(result);assert.equal(stats.openEdges,0);assert.equal(stats.faultyEdges,0);
});
test('invalid shaping is rejected and replay records the error without damaging the mesh',()=>{
  for(const p of [{blend:0},{from:100},{height:-100},{rear:Infinity}])assert.throws(()=>applyBodyShape(shape(),{...opts,...p}));
  const m=shape(),r=replay(m,[step('bad','bodyshape',{...opts,blend:0})]);assert.equal(r.results[0].state,'error');assert.deepEqual(r.mesh.positions,m.positions);
});
test('shaping insertion precedes hollow/fittings, edits preserve identity, disabled steps bypass it',()=>{
  const input=[step('o','orient',{}),step('h','hollow',{wall:1}),step('p','posts',{})],original=structuredClone(input);
  const next=shapeSteps(input,opts);assert.deepEqual(input,original);assert.equal(next[1].type,'bodyshape');
  const edited=shapeSteps(next,{...opts,front:30},next[1].id);assert.equal(edited.length,4);assert.equal(edited[1].id,next[1].id);assert.equal(edited[1].params.front,30);
  const off=replay(shape(),[{...next[1],enabled:false}]);assert.deepEqual(off.mesh.positions,shape().positions);
});
test('variants scale shaping coordinates but retain percentage changes',()=>{
  const r=variantSteps([step('shape','bodyshape',opts)],{from:32,to:24});const p=r.find(s=>s.type==='bodyshape').params;
  assert.equal(p.to,120);assert.ok(Math.abs(p.base-opts.base*4/3)<1e-10);assert.equal(p.front,20);assert.equal(p.height,-25);
});
test('post patterns preserve hardware sizes, mirror flags and independent items; invalid operations are atomic',()=>{
  const input=[step('p','posts',{type:{outer:4,hole:1.6},posts:[{x:10,y:5,mirror:true}]})],before=structuredClone(input);
  const r=arrangeFeatures(input,'p',{count:3,delta:[10,0,0]});assert.deepEqual(r[0].params.posts.map(p=>p.x),[10,20,30,40]);
  assert.equal(r[0].params.type.outer,4);assert.equal(r[0].params.posts[2].mirror,true);r[0].params.posts[1].y=9;assert.equal(r[0].params.posts[0].y,5);
  assert.throws(()=>arrangeFeatures(input,'p',{delta:[0,0,1]}));assert.throws(()=>arrangeFeatures(input,'p',{count:21,delta:[1,0,0]}));
  assert.throws(()=>arrangeFeatures(input,'p',{delta:[0,0,0]}));assert.deepEqual(input,before);
});
test('window movement preserves relative outline, facing and corner flags; light copies preserve direction',()=>{
  const windows=[step('w','windows',{windows:[{id:'a',points:[[1,2,3],[4,2,3],[4,2,6]],normal:[0,1,0],corners:[true,false,true],mirror:true}]})];
  const r=arrangeFeatures(windows,'w',{mode:'move',item:'0',delta:[5,0,2]})[0].params.windows[0];
  assert.deepEqual(r.points,[[6,2,5],[9,2,5],[9,2,8]]);assert.deepEqual(r.normal,[0,1,0]);assert.deepEqual(r.corners,[true,false,true]);
  const lights=[step('l','lights',{lights:[{at:[10,20,30],normal:[0,1,0],d:3}]})];
  const l=arrangeFeatures(lights,'l',{delta:[2,0,0]})[0].params.lights[1];assert.deepEqual(l.at,[12,20,30]);assert.equal(l.d,3);
});
test('added part copies retain asset and rotation with fresh step IDs, without duplicating source files',()=>{
  const s=step('a','addpart',{part:'asset',join:false,place:{x:1,y:2,z:3,rx:20,pair:true,scale:1}});
  const r=arrangeFeatures([s],'a',{count:2,delta:[0,5,0]});assert.equal(new Set(r.map(s=>s.id)).size,3);
  assert.deepEqual(r.map(s=>s.params.place.y),[2,7,12]);assert.ok(r.every(s=>s.params.part==='asset'&&s.params.place.rx===20&&s.params.place.pair));
});
test('metadata, shaping and layouts survive project roundtrip and one-operation undo/redo',()=>{
  const p=newProject('generated.stl',encodeSTL(shape()),{front:'-x',up:'+z'});
  p.steps=shapeSteps(p.steps,opts);p.steps[1].editor=stepMetadata('Roof shape','Check glazing');p.steps.push(step('p','posts',{posts:[{x:10,y:5}]}));
  const history=createHistory();history.push(snapshot(p));p.steps=arrangeFeatures(p.steps,'p',{delta:[10,0,0]});
  const r=decodeProjectFile(encodeProjectFile(p));assert.deepEqual(r.steps,p.steps);assert.ok(matchesStep(r.steps[1],'glazing'));
  const back=restore(p,history.undo(snapshot(p)));assert.equal(back.steps.at(-1).params.posts.length,1);
  assert.equal(restore(back,history.redo(snapshot(back))).steps.at(-1).params.posts.length,2);
});
test('build sheet escapes project content, reports unavailable open-mesh mass and includes disabled/errors',()=>{
  const p=newProject('<script>alert(1)</script>.stl',new ArrayBuffer(0),{front:'-x',up:'+z'});p.steps[0].editor={name:'<img onerror=boom>',notes:'<script>bad</script>'};
  const stats={bounds:{size:[100,40,30]},triangles:12,openEdges:3,faultyEdges:0,volume:2000};
  const report=buildSheet(p,{stats,results:[{id:p.steps[0].id,state:'error',error:'<bad>'}]},new Date('2026-11-26T12:00:00Z'));
  assert.ok(!report.includes('<script>'));assert.ok(!report.includes('<img'));assert.match(report,/Not available/);assert.match(report,/&lt;bad&gt;/);
  const closed=buildSheet(p,{stats:{...stats,openEdges:0},results:[]});assert.match(closed,/2.30 g/);
});
test('only projects containing body shaping require the new file format, preventing old-reader skipped geometry',()=>{
  const p=newProject('body.stl',new ArrayBuffer(0),{front:'-x',up:'+z'});
  assert.equal(JSON.parse(encodeProjectFile(p)).version,1);
  p.steps=shapeSteps(p.steps,opts);const saved=JSON.parse(encodeProjectFile(p));assert.equal(saved.version,2);
  assert.deepEqual(decodeProjectFile(JSON.stringify(saved)).steps,p.steps);
  saved.version=6;assert.throws(()=>decodeProjectFile(JSON.stringify(saved)),/newer Anvil/);
});

test('with Mirror on, a light or text and its other side move and repeat as a mirrored pair', () => {
  const lights = [step('l', 'lights', { lights: [{ at: [10, 15, 5], normal: [0, 1, 0], d: 3 }, { at: [10, -15, 5], normal: [0, -1, 0], d: 3 }, { at: [0, 0, 8], normal: [-1, 0, 0], d: 2 }] })];
  // Moving one of the pair outward moves its other side outward too.
  const moved = arrangeFeatures(lights, 'l', { mode: 'move', item: '0', delta: [2, 1, 0], mirror: true })[0].params.lights;
  assert.deepEqual(moved.map((l) => l.at), [[12, 16, 5], [12, -16, 5], [0, 0, 8]]);
  // Without Mirror only the chosen one moves, the way it was told.
  const plain = arrangeFeatures(lights, 'l', { mode: 'move', item: '0', delta: [2, 1, 0] })[0].params.lights;
  assert.deepEqual(plain.map((l) => l.at), [[12, 16, 5], [10, -15, 5], [0, 0, 8]]);
  // Repeating all: each pair stays mirrored, the light on the centre line just moves along.
  const copied = arrangeFeatures(lights, 'l', { count: 1, delta: [0, 3, 0], mirror: true })[0].params.lights;
  assert.deepEqual(copied.slice(3).map((l) => l.at), [[10, 18, 5], [10, -18, 5], [0, 3, 8]]);
  const texts = [step('t', 'text', { texts: [{ label: '7', at: [50, 20, 10], normal: [0, 1, 0] }, { label: '7', at: [50, -20, 10], normal: [0, -1, 0], flip: true }] })];
  const t = arrangeFeatures(texts, 't', { mode: 'move', item: '1', delta: [-5, 0, 1], mirror: true })[0].params.texts;
  assert.deepEqual(t.map((x) => x.at), [[45, 20, 11], [45, -20, 11]]);
  assert.equal(t[1].flip, true);
});

test('new shaping goes before the floor, the arches and fine detail too; an edited step keeps its place', () => {
  for (const type of ['floor', 'arches', 'panellines', 'guidecut', 'hammer']) {
    const r = shapeSteps([step('o', 'orient', {}), step('x', type, {}), step('h', 'hollow', {})], opts);
    assert.deepEqual(r.map((s) => s.type), ['orient', 'bodyshape', type, 'hollow']);
  }
  const later = [step('o', 'orient', {}), step('h', 'hollow', {}), step('b', 'bodyshape', opts)];
  assert.deepEqual(shapeSteps(later, { ...opts, rear: -10 }, 'b').map((s) => s.id), ['o', 'h', 'b']);
});

test('a layout typed in inches is stored in millimetres', async () => {
  const { fromUnits } = await import('../src/project.js');
  const r = arrangeFeatures([step('p', 'posts', { posts: [{ x: -20, y: 8 }] })], 'p', { mode: 'move', delta: [fromUnits(0.1, 'in'), 0, 0] });
  assert.ok(Math.abs(r[0].params.posts[0].x - (-20 + 2.54)) < 1e-9);
});

// A private test car (never shipped): shaping keeps the mesh as it was, and Hollow then works on the shaped body.
test('test car McLaren: a narrower, lower tail, then hollowed', { skip: !existsSync(model('McLaren_MP4_12C.stl')) }, () => {
  const src = readSTLMesh(readFileSync(model('McLaren_MP4_12C.stl')));
  const orient = step('o', 'orient', { front: '+x', up: '+z' });
  const plain = replay(src, [orient]).mesh, b = bounds(plain.positions);
  const p = { from: b.min[0] + b.size[0] * 0.5, to: b.max[0], blend: b.size[0] * 0.2, base: b.min[2] + b.size[2] * 0.3, front: 0, rear: -8, height: -5 };
  const shaped = replay(src, [orient, step('b', 'bodyshape', p)]);
  assert.equal(shaped.results[1].state, 'ok');
  const s0 = meshStats(plain), s1 = meshStats(shaped.mesh), b1 = bounds(shaped.mesh.positions);
  assert.equal(s1.triangles, s0.triangles);
  assert.equal(s1.openEdges, s0.openEdges);
  assert.equal(s1.faultyEdges, s0.faultyEdges);
  assert.ok(Math.abs(b1.size[0] - b.size[0]) < 1e-6, 'length unchanged');
  assert.ok(b1.max[2] <= b.max[2] + 1e-6 && b1.size[1] <= b.size[1] + 1e-6);
  const hollow = replay(src, [orient, step('b', 'bodyshape', p), step('h', 'hollow', { wall: 1 })]);
  assert.deepEqual(hollow.results.map((r) => r.state), ['ok', 'ok', 'ok'], JSON.stringify(hollow.results.map((r) => r.error)));
  const sh = meshStats(hollow.mesh);
  assert.equal(sh.openEdges, 0);
  assert.equal(sh.faultyEdges, 0);
});
