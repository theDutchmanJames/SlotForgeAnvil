// Anvil's geometry engine: replays a project's steps over the imported mesh.
// Pure functions on indexed meshes { positions: Float32Array, indices: Uint32Array },
// so the same code runs in the worker and in Node tests.
//
// Anvil's car frame: Z is up, the car stands on Z = 0, its centre line is Y = 0,
// and X runs from the front (low X) to the back (high X).
import { meshEdges } from './mesh-topology.js';
import { bounds } from './bounds.js';

export { bounds };
import { applyFill, applyRepair } from './repair.js';
import { applyReduce } from './reduce.js';
import { applyFloor, applyHollow } from './shell.js';
import { applyHammer } from './hammer.js';
import { applyArchCut, applyStretch } from './arches.js';
import { applyPosts } from './posts.js';
import { applyWindows } from './windows.js';
import { applyAddPart, applySmooth, capPlane } from './finish.js';
import { boundaryLoops, pairEdges, splitTouching } from './topology.js';
import { fillLoop } from './fill.js';

export const AXES = ['+x', '-x', '+y', '-y', '+z', '-z'];
const unitOf = (axis) => {
  const v = [0, 0, 0];
  v['xyz'.indexOf(axis[1])] = axis[0] === '-' ? -1 : 1;
  return v;
};
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

// ---------------------------------------------------------------- helpers

// Selections are stored as runs: [start, length, start, length, ...].
export function encodeRuns(faces) {
  const sorted = [...new Set(faces)].sort((a, b) => a - b);
  const runs = [];
  for (const f of sorted) {
    const last = runs.length - 2;
    if (last >= 0 && runs[last] + runs[last + 1] === f) runs[last + 1]++;
    else runs.push(f, 1);
  }
  return runs;
}
export function decodeRuns(runs) {
  const out = [];
  for (let i = 0; i < runs.length; i += 2)
    for (let f = runs[i]; f < runs[i] + runs[i + 1]; f++) out.push(f);
  return out;
}
export const runCount = (runs) => runs.reduce((n, v, i) => (i % 2 ? n + v : n), 0);

// Drop vertices no triangle uses, keeping the order of the rest.
// Drop corners no triangle uses. flags (optional, one per corner) are carried along.
function compact(positions, indices, flags = null) {
  const map = new Int32Array(positions.length / 3).fill(-1);
  let n = 0;
  for (const v of indices) if (map[v] < 0) map[v] = n++;
  const out = new Float32Array(n * 3);
  const kept = flags ? new Uint8Array(n) : null;
  for (let v = 0; v < map.length; v++)
    if (map[v] >= 0) {
      out.set(positions.subarray(v * 3, v * 3 + 3), map[v] * 3);
      if (kept) kept[map[v]] = flags[v];
    }
  return { positions: out, indices: indices.map((v) => map[v]), touched: kept };
}

// ---------------------------------------------------------------- orient

// front / up: the direction in the imported file that points to the car's
// front / roof. Rows of the rotation are the new X (towards the back), Y, Z.
export function orientMatrix(front, up) {
  if (!AXES.includes(front) || !AXES.includes(up))
    throw Error('Choose a direction for the front and for the top.');
  if (front[1] === up[1]) throw Error('Front and top must be different axes.');
  const r1 = unitOf(front).map((v) => -v);
  const r3 = unitOf(up);
  const r2 = cross(r3, r1);
  return [r1, r2, r3];
}

// turn: degrees to rotate about the up axis afterwards, to straighten a car
// that sits at an angle in the file.
export function applyOrient(mesh, { front, up, turn = 0 }) {
  const [r1, r2, r3] = orientMatrix(front, up);
  if (!Number.isFinite(turn) || Math.abs(turn) > 180) throw Error('Enter a turn between -180 and 180 degrees.');
  const c = Math.cos((turn * Math.PI) / 180),
    s = Math.sin((turn * Math.PI) / 180);
  const p = mesh.positions,
    out = new Float32Array(p.length);
  for (let i = 0; i < p.length; i += 3) {
    const x = p[i], y = p[i + 1], z = p[i + 2];
    const a = r1[0] * x + r1[1] * y + r1[2] * z,
      b = r2[0] * x + r2[1] * y + r2[2] * z;
    out[i] = c * a - s * b;
    out[i + 1] = s * a + c * b;
    out[i + 2] = r3[0] * x + r3[1] * y + r3[2] * z;
  }
  // Stand the car on Z = 0, centred on X and Y.
  const { min, max } = bounds(out);
  const shift = [-(min[0] + max[0]) / 2, -(min[1] + max[1]) / 2, -min[2]];
  for (let i = 0; i < out.length; i += 3)
    for (let k = 0; k < 3; k++) out[i + k] += shift[k];
  return { positions: out, indices: mesh.indices };
}

// Degrees to turn about Z so the plan-view footprint is smallest. Returns 0
// unless turning saves more than 0.5% of the area.
export function straightenAngle(positions) {
  const n = positions.length / 3,
    step = Math.max(1, Math.floor(n / 20000));
  const xs = [],
    ys = [];
  for (let i = 0; i < n; i += step) {
    xs.push(positions[i * 3]);
    ys.push(positions[i * 3 + 1]);
  }
  const area = (deg) => {
    const c = Math.cos((deg * Math.PI) / 180),
      s = Math.sin((deg * Math.PI) / 180);
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (let i = 0; i < xs.length; i++) {
      const x = c * xs[i] - s * ys[i],
        y = s * xs[i] + c * ys[i];
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
    // Keep the length along X: a turn that swaps length and width is not wanted.
    return x1 - x0 >= y1 - y0 ? (x1 - x0) * (y1 - y0) : Infinity;
  };
  let best = 0,
    bestArea = area(0);
  const straight = bestArea;
  for (let d = -45; d <= 45; d += 1) {
    const a = area(d);
    if (a < bestArea) [best, bestArea] = [d, a];
  }
  for (let d = best - 1; d <= best + 1; d += 0.1) {
    const a = area(d);
    if (a < bestArea) [best, bestArea] = [d, a];
  }
  return bestArea < straight * 0.995 ? Math.round(best * 10) / 10 : 0;
}

// Guess which way the file is turned: the longest side is the length, the
// shortest the height, and the roof is narrower than the sills. A car sitting
// at an angle is straightened along its main axis seen from above, and the
// front is the lower end (bonnet and nose sit lower than the tail).
export function guessOrient(mesh) {
  const { min, size } = bounds(mesh.positions);
  const order = [0, 1, 2].sort((a, b) => size[b] - size[a]);
  const [lengthAxis, widthAxis, upAxis] = order;
  const p = mesh.positions;
  const band = size[upAxis] * 0.2;
  let lo = [Infinity, -Infinity],
    hi = [Infinity, -Infinity];
  for (let i = 0; i < p.length; i += 3) {
    const h = p[i + upAxis] - min[upAxis],
      w = p[i + widthAxis];
    if (h < band) lo = [Math.min(lo[0], w), Math.max(lo[1], w)];
    if (h > size[upAxis] - band) hi = [Math.min(hi[0], w), Math.max(hi[1], w)];
  }
  const roofUp = hi[1] - hi[0] <= lo[1] - lo[0];
  const name = (axis, positive) => (positive ? '+' : '-') + 'xyz'[axis];
  let guess = { front: name(lengthAxis, true), up: name(upAxis, roofUp), turn: 0 };

  // Straighten: the turn that gives the smallest footprint seen from above.
  // A straight car already has it; vertex density does not affect it.
  let car = applyOrient(mesh, guess).positions;
  const turn = straightenAngle(car);
  if (turn) {
    guess.turn = turn;
    car = applyOrient(mesh, guess).positions;
  }

  // Front: the end whose top is lower.
  const b = bounds(car);
  const end = b.size[0] * 0.12;
  let lowEnd = 0, highEnd = 0;
  for (let i = 0; i < car.length; i += 3) {
    if (car[i] < b.min[0] + end) lowEnd = Math.max(lowEnd, car[i + 2]);
    if (car[i] > b.max[0] - end) highEnd = Math.max(highEnd, car[i + 2]);
  }
  // Canonical front is low X. If the high-X end is lower, the car faces the other way.
  if (highEnd < lowEnd) guess.front = name(lengthAxis, false);
  return guess;
}

// ---------------------------------------------------------------- scale

export function applyScale(mesh, { factor }) {
  if (!(factor > 0) || !Number.isFinite(factor)) throw Error('Enter a scale factor above 0.');
  const out = new Float32Array(mesh.positions.length);
  for (let i = 0; i < out.length; i++) out[i] = mesh.positions[i] * factor;
  return { positions: out, indices: mesh.indices };
}

// ---------------------------------------------------------------- slice

// The cutting plane. Without a tilt it is axis = at. With one it is turned by
// `tilt` degrees so that it slopes along the `lean` axis, about the line
// where lean = pivot (and axis = at). Returns the signed distance of a point
// (above the plane is positive) and the plane's normal.
export function slicePlane({ axis, at, tilt = 0, lean, pivot = 0 }) {
  const k = 'xyz'.indexOf(axis);
  if (k < 0) throw Error('Choose the direction of the cut.');
  if (!Number.isFinite(at)) throw Error('Enter where to cut.');
  if (!tilt) {
    const normal = [0, 0, 0];
    normal[k] = 1;
    return { k, tilted: false, normal, dist: (x, y, z) => [x, y, z][k] - at };
  }
  const i = 'xyz'.indexOf(lean);
  if (i < 0 || i === k) throw Error('Choose which way the cut slopes.');
  if (!Number.isFinite(tilt) || Math.abs(tilt) > 80) throw Error('Enter a tilt between -80° and 80°.');
  const a = (tilt * Math.PI) / 180,
    c = Math.cos(a),
    s = Math.sin(a);
  const normal = [0, 0, 0];
  normal[k] = c;
  normal[i] = -s;
  const p = Number.isFinite(pivot) ? pivot : 0;
  return { k, i, tilted: true, normal, dist: (x, y, z) => { const v = [x, y, z]; return c * (v[k] - at) - s * (v[i] - p); } };
}

// Cut with the plane axis = at (tilted if asked, see slicePlane) and keep
// one side, or both (moved `gap` apart, to print in two). The cut stays open,
// which is what a body shell needs, unless cap is asked: then it is closed
// flat (a ring on a shell).
export function applySlice(mesh, { axis, at, keep, cap = false, gap = 10, tilt = 0, lean, pivot }) {
  const plane = { axis, at, tilt, lean, pivot };
  if (keep === 'both') {
    const k = 'xyz'.indexOf(axis);
    const lo = applySlice(mesh, { ...plane, keep: 'below', cap });
    const hi = applySlice(mesh, { ...plane, keep: 'above', cap });
    const shifted = Float32Array.from(hi.positions, (v, n) => (n % 3 === k ? v + gap : v));
    const off = lo.positions.length / 3;
    const idx = new Uint32Array(lo.indices.length + hi.indices.length);
    idx.set(lo.indices);
    idx.set(hi.indices.map((v) => v + off), lo.indices.length);
    const pos = new Float32Array(lo.positions.length + shifted.length);
    pos.set(lo.positions);
    pos.set(shifted, lo.positions.length);
    return { positions: pos, indices: idx, info: { changed: lo.info.changed, capped: (lo.info.capped ?? 0) + (hi.info.capped ?? 0) } };
  }
  const pl = slicePlane(plane);
  const out = sliceOne(mesh, pl, at, keep);
  if (!cap) return out;
  const c = capPlane(out, axis, at, 1e-4, pl.tilted ? pl : null);
  return { positions: c.mesh.positions, indices: c.mesh.indices, info: { ...out.info, capped: c.capped } };
}

function sliceOne(mesh, plane, at, keep) {
  const { k, tilted, dist } = plane;
  if (keep !== 'below' && keep !== 'above') throw Error('Choose which side to keep.');
  const sign = keep === 'below' ? 1 : -1;
  const p = mesh.positions,
    idx = mesh.indices;
  const vcount = p.length / 3;
  const d = new Float64Array(vcount);
  for (let v = 0; v < vcount; v++) d[v] = sign * dist(p[v * 3], p[v * 3 + 1], p[v * 3 + 2]); // <= 0 is kept
  const pos = Array.from(p);
  const out = [];
  const cutVertex = new Map();
  function onEdge(a, b) {
    // A corner right on the plane is the crossing itself: no second corner there.
    if (d[a] === 0) return a;
    if (d[b] === 0) return b;
    const key = a < b ? a * vcount + b : b * vcount + a;
    let id = cutVertex.get(key);
    if (id === undefined) {
      const t = d[a] / (d[a] - d[b]);
      id = pos.length / 3;
      for (let c = 0; c < 3; c++) pos.push(p[a * 3 + c] + t * (p[b * 3 + c] - p[a * 3 + c]));
      if (!tilted) pos[id * 3 + k] = at;
      cutVertex.set(key, id);
    }
    return id;
  }
  let removed = 0;
  for (let f = 0; f < idx.length; f += 3) {
    const tri = [idx[f], idx[f + 1], idx[f + 2]];
    const inside = tri.map((v) => d[v] <= 0);
    const n = inside.filter(Boolean).length;
    if (n === 3) {
      out.push(...tri);
      continue;
    }
    removed++;
    if (n === 0) continue;
    // Clip the triangle to the kept side, keeping its winding.
    const poly = [];
    const add = (v) => {
      if (poly.at(-1) !== v) poly.push(v);
    };
    for (let i = 0; i < 3; i++) {
      const a = tri[i],
        b = tri[(i + 1) % 3];
      if (inside[i]) add(a);
      if (inside[i] !== inside[(i + 1) % 3]) add(onEdge(a, b));
    }
    if (poly.length > 1 && poly[0] === poly.at(-1)) poly.pop();
    for (let i = 1; i + 1 < poly.length; i++) out.push(poly[0], poly[i], poly[i + 1]);
  }
  const result = compact(Float32Array.from(pos), Uint32Array.from(out));
  if (!result.indices.length) throw Error('This cut would remove the whole model. Keep the other side.');
  return { ...result, info: { changed: removed } };
}

// ---------------------------------------------------------------- delete

// Delete triangles. patch: 'smooth' closes the openings this leaves with a
// patch that bends with its rim (openings that were there before stay open).
export function applyDelete(mesh, { faces, patch = 'open' }) {
  const count = mesh.indices.length / 3;
  const drop = new Uint8Array(count);
  for (let i = 0; i < faces.length; i += 2) {
    if (faces[i] + faces[i + 1] > count)
      throw Error('This step no longer matches the model, because an earlier step changed it.');
    drop.fill(1, faces[i], faces[i] + faces[i + 1]);
  }
  const keep = [];
  const touched = new Uint8Array(mesh.positions.length / 3);
  for (let f = 0; f < count; f++)
    if (!drop[f]) keep.push(mesh.indices[f * 3], mesh.indices[f * 3 + 1], mesh.indices[f * 3 + 2]);
    else for (let k = 0; k < 3; k++) touched[mesh.indices[f * 3 + k]] = 1;
  if (!keep.length) throw Error('This would delete the whole model.');
  const out = compact(mesh.positions, Uint32Array.from(keep), touched);
  if (patch !== 'smooth') return { positions: out.positions, indices: out.indices };
  // Where the hole touches itself at a corner, give each side its own corner
  // first, so each opening is a clean outline.
  const sp = splitTouching(out.positions, out.indices, pairEdges(out.indices, out.positions.length / 3, out.positions).twins);
  const n0 = out.positions.length / 3;
  const wasTouched = (v) => (v < n0 ? out.touched[v] : out.touched[sp.extra[v - n0]]);
  // The new openings: every corner on them was on a deleted triangle.
  const { twins } = pairEdges(sp.indices, sp.positions.length / 3, sp.positions);
  const pos = Array.from(sp.positions);
  const add = [];
  let patched = 0;
  for (const loop of boundaryLoops(sp.indices, twins)) {
    if (!loop.every(wasTouched)) continue;
    for (const f of fillLoop(pos, loop, 'smooth')) add.push(...f);
    patched++;
  }
  return { positions: Float32Array.from(pos), indices: Uint32Array.from([...sp.indices, ...add]), info: { patched } };
}

// ---------------------------------------------------------------- replay

const OPS = {
  orient: applyOrient,
  scale: applyScale,
  slice: applySlice,
  delete: applyDelete,
  repair: applyRepair,
  fill: applyFill,
  reduce: applyReduce,
  floor: applyFloor,
  hollow: applyHollow,
  hammer: applyHammer,
  stretch: applyStretch,
  arches: applyArchCut,
  posts: applyPosts,
  windows: applyWindows,
  smooth: applySmooth,
  addpart: applyAddPart,
};
const SHAPES_ONLY = new Set(['orient', 'scale']);

// cache (optional): a Map kept between calls. Steps are only redone from the
// first one that changed, so a slow step (reduce, repair) is not repeated
// when a later step is edited.
// ctx: what some steps need besides their own numbers (ctx.parts: the files
// of added parts, by id).
export function replay(source, steps, cache = null, ctx = {}) {
  let mesh = source,
    original = source;
  let results = [];
  let start = 0;
  const keys = [];
  let key = '';
  for (const step of steps) keys.push((key += JSON.stringify(step) + '|'));
  if (cache) {
    for (let i = steps.length - 1; i >= 0; i--) {
      const hit = cache.get(keys[i]);
      if (!hit) continue;
      ({ mesh, original } = hit);
      results = hit.results.slice();
      start = i + 1;
      cache.delete(keys[i]);
      cache.set(keys[i], hit); // most recently used last
      break;
    }
  }
  for (let i = start; i < steps.length; i++) {
    const step = steps[i];
    if (!step.enabled) results.push({ id: step.id, state: 'off' });
    else {
      const op = OPS[step.type];
      try {
        if (!op) throw Error('Unknown step.');
        const next = op(mesh, step.params, ctx);
        mesh = { positions: next.positions, indices: next.indices };
        if (SHAPES_ONLY.has(step.type)) original = op(original, step.params);
        results.push({ id: step.id, state: 'ok', info: next.info });
      } catch (e) {
        results.push({ id: step.id, state: 'error', error: e.message });
      }
    }
    if (cache) {
      cache.set(keys[i], { mesh, original, results: results.slice() });
      while (cache.size > 8) cache.delete(cache.keys().next().value);
    }
  }
  return { mesh, original: { positions: original.positions, indices: original.indices }, results };
}

// ---------------------------------------------------------------- stats

export function meshStats(mesh) {
  const { positions, indices } = mesh;
  const { twins } = meshEdges(indices, positions.length / 3);
  let open = 0,
    faulty = 0;
  for (const t of twins) {
    if (t === -1) open++;
    else if (t === -2) faulty++;
  }
  // Loose pieces: faces joined through shared edges.
  const faces = indices.length / 3,
    seen = new Uint8Array(faces),
    stack = [];
  let parts = 0;
  for (let f = 0; f < faces; f++) {
    if (seen[f]) continue;
    parts++;
    seen[f] = 1;
    stack.push(f);
    while (stack.length) {
      const g = stack.pop();
      for (let e = g * 3; e < g * 3 + 3; e++) {
        const t = twins[e];
        if (t >= 0) {
          const h = Math.floor(t / 3);
          if (!seen[h]) {
            seen[h] = 1;
            stack.push(h);
          }
        }
      }
    }
  }
  return {
    triangles: faces,
    vertices: positions.length / 3,
    bounds: bounds(positions),
    openEdges: open,
    faultyEdges: faulty,
    parts,
    twins,
  };
}
