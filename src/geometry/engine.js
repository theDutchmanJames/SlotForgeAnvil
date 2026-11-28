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
import { applyScanSmooth } from './denoise.js';
import { applyFloor, applyHollow } from './shell.js';
import { applyHammer } from './hammer.js';
import { applyArchCut, applyGuideCut, applyStretch } from './arches.js';
import { applyPosts } from './posts.js';
import { applyWindows } from './windows.js';
import { applyAddPart, applySmooth, capPlane } from './finish.js';
import { boundaryLoops, pairEdges, splitTouching } from './topology.js';
import { fillLoop } from './fill.js';
import { applyCutoff } from './cutoff.js';
import { applySolid } from './solid.js';
import { applyMounts } from './mounts.js';
import { applyRebuild } from './rebuild.js';
import { glueTabs } from './gluetabs.js';
import { applyPanelLines, applyText } from './detail.js';
import { applyInterior } from './interior.js';
import { applyLights } from './lights.js';
import { applySymmetrize } from './symmetry.js';
import { applyBodyShape } from './bodyshape.js';
import { holdTaped, tapedFaces } from './tape.js';

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

// Fine angles in degrees, after the front and roof are chosen: turn about
// the roof axis (seen from above), tilt about the width (plus lifts the nose)
// and lean about the length (plus lifts the right side, +Y). The rotation is
// turn · tilt · lean. mirror swaps left and right.
const rad = (d) => (d * Math.PI) / 180;
export function angleMatrix(turn = 0, tilt = 0, lean = 0) {
  const ca = Math.cos(rad(turn)), sa = Math.sin(rad(turn));
  const cb = Math.cos(rad(tilt)), sb = Math.sin(rad(tilt));
  const cc = Math.cos(rad(lean)), sc = Math.sin(rad(lean));
  return [
    [ca * cb, ca * sb * sc - sa * cc, ca * sb * cc + sa * sc],
    [sa * cb, sa * sb * sc + ca * cc, sa * sb * cc - ca * sc],
    [-sb, cb * sc, cb * cc],
  ];
}
// The turn, tilt and lean of a rotation, to 0.1°.
export function matrixAngles(R) {
  const r = (v) => Math.round((v * 1800) / Math.PI) / 10 || 0;
  return {
    turn: r(Math.atan2(R[1][0], R[0][0])),
    tilt: r(Math.asin(Math.max(-1, Math.min(1, -R[2][0])))),
    lean: r(Math.atan2(R[2][1], R[2][2])),
  };
}
const mul = (A, B) => A.map((row) => [0, 1, 2].map((j) => row[0] * B[0][j] + row[1] * B[1][j] + row[2] * B[2][j]));

export function applyOrient(mesh, o) {
  return applyOrientAt(mesh, o, null);
}

// at: the shift to use instead of centring this mesh, so a second mesh (a
// part screwed to a chassis) can be turned and moved exactly like the first.
export function applyOrientAt(mesh, o, at) {
  const { mirror = false } = o;
  const out = turnOrient(mesh.positions, o);
  // Stand the car on Z = 0, centred on X and Y.
  const shift = at ?? centreShift(out);
  for (let i = 0; i < out.length; i += 3)
    for (let k = 0; k < 3; k++) out[i + k] += shift[k];
  if (!mirror) return { positions: out, indices: mesh.indices };
  // A mirror image turns the triangles inside out: wind them the other way.
  const idx = Uint32Array.from(mesh.indices);
  for (let f = 0; f < idx.length; f += 3) [idx[f + 1], idx[f + 2]] = [idx[f + 2], idx[f + 1]];
  return { positions: out, indices: idx };
}

// The shift applyOrient gives this mesh (to pass to it for another mesh).
export function orientShift(mesh, o) {
  return centreShift(turnOrient(mesh.positions, o));
}

function centreShift(p) {
  const { min, max } = bounds(p);
  return [-(min[0] + max[0]) / 2, -(min[1] + max[1]) / 2, -min[2]];
}

function turnOrient(p, { front, up, turn = 0, tilt = 0, lean = 0, mirror = false }) {
  for (const [name, v] of [['turn', turn], ['tilt', tilt], ['lean', lean]])
    if (!Number.isFinite(v) || Math.abs(v) > 180) throw Error(`Enter a ${name} between -180 and 180 degrees.`);
  const [r1, r2, r3] = mul(angleMatrix(turn, tilt, lean), orientMatrix(front, up));
  const flip = mirror ? -1 : 1;
  const out = new Float32Array(p.length);
  for (let i = 0; i < p.length; i += 3) {
    const x = p[i], y = p[i + 1], z = p[i + 2];
    out[i] = r1[0] * x + r1[1] * y + r1[2] * z;
    out[i + 1] = flip * (r2[0] * x + r2[1] * y + r2[2] * z);
    out[i + 2] = r3[0] * x + r3[1] * y + r3[2] * z;
  }
  return out;
}

// The turn, tilt and lean that square up a car already pointing roughly the
// right way (within 45°). A car is mirror-symmetric, so the normal of its
// centre plane is a principal axis of its surface: that sets the turn and
// lean. The tilt is the one with the smallest outline seen from the side.
// Angles under 1° are mostly an uneven mesh, not a crooked car: they come back as 0.
export function squareAngles({ positions: p, indices: I }) {
  const zero = { turn: 0, tilt: 0, lean: 0 };
  const n = I.length / 3,
    step = Math.max(1, Math.floor(n / 80000));
  // The spread of the surface itself, triangle by triangle: area times the
  // exact second moment of each triangle, about a point near the middle.
  const o = bounds(p).min.map((v, k) => v + bounds(p).size[k] / 2);
  const S = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], c = [0, 0, 0];
  let W = 0;
  for (let f = 0; f < n; f += step) {
    const v = [I[f * 3], I[f * 3 + 1], I[f * 3 + 2]].map((i) => [p[i * 3] - o[0], p[i * 3 + 1] - o[1], p[i * 3 + 2] - o[2]]);
    const u = [0, 1, 2].map((k) => v[1][k] - v[0][k]),
      t = [0, 1, 2].map((k) => v[2][k] - v[0][k]);
    const w = Math.hypot(u[1] * t[2] - u[2] * t[1], u[2] * t[0] - u[0] * t[2], u[0] * t[1] - u[1] * t[0]) / 2;
    if (!(w > 0)) continue;
    const sum = [0, 1, 2].map((k) => v[0][k] + v[1][k] + v[2][k]);
    W += w;
    for (let r = 0; r < 3; r++) {
      c[r] += (w * sum[r]) / 3;
      for (let q = 0; q < 3; q++) S[r][q] += (w / 12) * (v[0][r] * v[0][q] + v[1][r] * v[1][q] + v[2][r] * v[2][q] + sum[r] * sum[q]);
    }
  }
  if (!(W > 0)) return zero;
  for (let k = 0; k < 3; k++) c[k] /= W;
  const A = S.map((row, r) => row.map((v, q) => v / W - c[r] * c[q]));
  // Jacobi: the columns of V become the principal axes.
  const V = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let sweep = 0; sweep < 30; sweep++)
    for (const [i, j] of [[0, 1], [0, 2], [1, 2]]) {
      if (Math.abs(A[i][j]) < 1e-12) continue;
      const th = 0.5 * Math.atan2(2 * A[i][j], A[j][j] - A[i][i]),
        cs = Math.cos(th), sn = Math.sin(th);
      for (let k = 0; k < 3; k++) [A[k][i], A[k][j]] = [cs * A[k][i] - sn * A[k][j], sn * A[k][i] + cs * A[k][j]];
      for (let k = 0; k < 3; k++) [A[i][k], A[j][k]] = [cs * A[i][k] - sn * A[j][k], sn * A[i][k] + cs * A[j][k]];
      for (let k = 0; k < 3; k++) [V[k][i], V[k][j]] = [cs * V[k][i] - sn * V[k][j], sn * V[k][i] + cs * V[k][j]];
    }
  const axes = [0, 1, 2].map((e) => [V[0][e], V[1][e], V[2][e]]);
  let w = axes.reduce((best, a) => (Math.abs(a[1]) > Math.abs(best[1]) ? a : best));
  if (Math.abs(w[1]) < Math.SQRT1_2) return zero;
  if (w[1] < 0) w = w.map((v) => -v);
  // The smallest rotation that takes w to +Y (Rodrigues).
  const k = [-w[2], 0, w[0]], s = Math.hypot(k[0], k[2]), cosA = w[1];
  let R1 = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  if (s > 1e-9) {
    const [kx, , kz] = k.map((v) => v / s), t = 1 - cosA;
    R1 = [
      [cosA + kx * kx * t, -kz * s, kx * kz * t],
      [kz * s, cosA, -kx * s],
      [kx * kz * t, kx * s, cosA + kz * kz * t],
    ];
  }
  // Side outline over the tilt, on the vertices.
  const vstep = Math.max(1, Math.floor(p.length / 3 / 100000)), xs = [], zs = [];
  for (let i = 0; i < p.length / 3; i += vstep) {
    const x = p[i * 3], y = p[i * 3 + 1], z = p[i * 3 + 2];
    xs.push(R1[0][0] * x + R1[0][1] * y + R1[0][2] * z);
    zs.push(R1[2][0] * x + R1[2][1] * y + R1[2][2] * z);
  }
  const side = (deg) => {
    const cb = Math.cos(rad(deg)), sb = Math.sin(rad(deg));
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let i = 0; i < xs.length; i++) {
      const x = cb * xs[i] + sb * zs[i], z = -sb * xs[i] + cb * zs[i];
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (z < z0) z0 = z;
      if (z > z1) z1 = z;
    }
    return (x1 - x0) * (z1 - z0);
  };
  let best = 0, bestArea = side(0);
  for (let d = -30; d <= 30; d += 1) {
    const a = side(d);
    if (a < bestArea) [best, bestArea] = [d, a];
  }
  for (let d = best - 1; d <= best + 1; d += 0.1) {
    const a = side(d);
    if (a < bestArea) [best, bestArea] = [d, a];
  }
  const angles = matrixAngles(mul(angleMatrix(0, best, 0), R1));
  for (const key in angles) if (Math.abs(angles[key]) < 1) angles[key] = 0;
  return angles;
}

// Guess which way the file is turned: the longest side is the length, the
// shortest the height, and the roof is narrower than the sills. A car sitting
// at an angle, even tilted or leaning, is squared up first (squareAngles), and the
// front is the lower end (bonnet and nose sit lower than the tail).
export function guessOrient(mesh) {
  const { size } = bounds(mesh.positions);
  const order = [0, 1, 2].sort((a, b) => size[b] - size[a]);
  const [lengthAxis, , upAxis] = order;
  const name = (axis, positive) => (positive ? '+' : '-') + 'xyz'[axis];
  const guess = { front: name(lengthAxis, true), up: name(upAxis, true), turn: 0, tilt: 0, lean: 0 };
  // Squared up first, so a car lying at an angle in the file is judged on
  // its real sills and roof.
  const square = () => {
    Object.assign(guess, { turn: 0, tilt: 0, lean: 0 });
    Object.assign(guess, squareAngles(applyOrient(mesh, guess)));
    return applyOrient(mesh, guess).positions;
  };
  let car = square();

  // Roof: narrower than the sills.
  let b = bounds(car);
  const band = b.size[2] * 0.2;
  let lo = [Infinity, -Infinity],
    hi = [Infinity, -Infinity];
  for (let i = 0; i < car.length; i += 3) {
    const h = car[i + 2] - b.min[2],
      w = car[i + 1];
    if (h < band) lo = [Math.min(lo[0], w), Math.max(lo[1], w)];
    if (h > b.size[2] - band) hi = [Math.min(hi[0], w), Math.max(hi[1], w)];
  }
  if (hi[1] - hi[0] > lo[1] - lo[0]) {
    guess.up = name(upAxis, false);
    car = square();
    b = bounds(car);
  }

  // Front: the end whose top is lower (bonnet and nose sit lower than the
  // tail). Canonical front is low X.
  const end = b.size[0] * 0.12;
  let lowEnd = 0, highEnd = 0;
  for (let i = 0; i < car.length; i += 3) {
    if (car[i] < b.min[0] + end) lowEnd = Math.max(lowEnd, car[i + 2]);
    if (car[i] > b.max[0] - end) highEnd = Math.max(highEnd, car[i + 2]);
  }
  if (highEnd < lowEnd) {
    guess.front = name(lengthAxis, false);
    square();
  }
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
// walls (with cap): close only cuts through a wall, leaving the inside of a
// body open (for the floor line).
// The frame of the slice plane for glue tabs: a point on it, its normal from
// the `side` piece towards the other, and two directions along it.
export function sliceFrame({ axis, at, tilt = 0, lean, pivot }, side) {
  const pl = slicePlane({ axis, at, tilt, lean, pivot });
  const c = [0, 0, 0];
  c[pl.k] = at;
  if (pl.tilted) c[pl.i] = Number.isFinite(pivot) ? pivot : 0;
  const n = side === 'below' ? pl.normal : pl.normal.map((x) => -x);
  const t = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const cr = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const u0 = cr(n, t), ul = Math.hypot(...u0);
  const u = u0.map((x) => x / ul);
  return { c, n, u, v: cr(n, u) };
}

// Glue tabs for one piece of a slice (still open at the cut): their blocks
// and where they sit.
export function sliceTabs(mesh, plane, glue) {
  const side = glue.on === 'above' ? 'above' : 'below';
  const pl = slicePlane(plane);
  const raw = sliceOne(mesh, pl, plane.at, side);
  return { side, ...glueTabs(raw, mesh, sliceFrame(plane, side), glue.tabs ?? [], glue) };
}

export function applySlice(mesh, { axis, at, keep, cap = false, walls = false, gap = 10, tilt = 0, lean, pivot, glue = null }) {
  const plane = { axis, at, tilt, lean, pivot };
  if (keep === 'both') {
    const k = 'xyz'.indexOf(axis);
    let lo = applySlice(mesh, { ...plane, keep: 'below', cap, walls });
    let hi = applySlice(mesh, { ...plane, keep: 'above', cap, walls });
    // Glue tabs on one of the two, before they move apart.
    let glueInfo = null;
    if (glue?.tabs?.length) {
      const g = sliceTabs(mesh, plane, glue);
      const target = g.side === 'below' ? lo : hi;
      const pos = Array.from(target.positions), idx = Array.from(target.indices);
      for (const p of g.pieces) {
        const off = pos.length / 3;
        pos.push(...p.positions);
        for (const v of p.indices) idx.push(v + off);
      }
      const joined = { positions: Float32Array.from(pos), indices: Uint32Array.from(idx), info: target.info };
      if (g.side === 'below') lo = joined;
      else hi = joined;
      glueInfo = { tabs: g.placed.length, warnings: g.warnings };
    }
    const shifted = Float32Array.from(hi.positions, (v, n) => (n % 3 === k ? v + gap : v));
    const off = lo.positions.length / 3;
    const idx = new Uint32Array(lo.indices.length + hi.indices.length);
    idx.set(lo.indices);
    idx.set(hi.indices.map((v) => v + off), lo.indices.length);
    const pos = new Float32Array(lo.positions.length + shifted.length);
    pos.set(lo.positions);
    pos.set(shifted, lo.positions.length);
    return { positions: pos, indices: idx, info: { changed: lo.info.changed, capped: (lo.info.capped ?? 0) + (hi.info.capped ?? 0), ...(glueInfo ? { glue: glueInfo.tabs, warnings: glueInfo.warnings } : {}) } };
  }
  const pl = slicePlane(plane);
  const out = sliceOne(mesh, pl, at, keep);
  if (!cap) return out;
  const c = capPlane(out, axis, at, 1e-4, pl.tilted ? pl : null, walls);
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
export function applyDelete(mesh, { faces, patch = 'open' }, { tape } = {}) {
  const count = mesh.indices.length / 3;
  const drop = new Uint8Array(count);
  for (let i = 0; i < faces.length; i += 2) {
    if (faces[i] + faces[i + 1] > count)
      throw Error('This step no longer matches the model, because an earlier step changed it.');
    drop.fill(1, faces[i], faces[i] + faces[i + 1]);
  }
  // Faces under masking tape stay.
  if (tape?.length) for (const f of tapedFaces(mesh, tape)) drop[f] = 0;
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
  bodyshape: applyBodyShape,
  orient: applyOrient,
  scale: applyScale,
  slice: applySlice,
  cutoff: applyCutoff,
  delete: applyDelete,
  repair: applyRepair,
  fill: applyFill,
  solid: applySolid,
  reduce: applyReduce,
  scansmooth: applyScanSmooth,
  floor: applyFloor,
  hollow: applyHollow,
  hammer: applyHammer,
  stretch: applyStretch,
  arches: applyArchCut,
  guidecut: applyGuideCut,
  mounts: applyMounts,
  rebuild: applyRebuild,
  symmetrize: applySymmetrize,
  panellines: applyPanelLines,
  text: applyText,
  interior: applyInterior,
  lights: applyLights,
  posts: applyPosts,
  windows: applyWindows,
  smooth: applySmooth,
  addpart: applyAddPart,
  // Masking tape changes nothing itself: the steps after it see it (see replay).
  tape: (mesh, { spots = [] }) => ({ positions: mesh.positions, indices: mesh.indices, info: { spots: spots.length } }),
};
const SHAPES_ONLY = new Set(['orient', 'scale']);
// Steps that keep what lies under masking tape: these cut and are given the
// tape (ctx.tape); these move the surface, and the taped corners are held.
const TAPE_CUTS = new Set(['windows', 'arches', 'guidecut', 'lights', 'hollow', 'delete']);
const TAPE_HOLDS = new Set(['smooth', 'scansmooth', 'hammer']);

// cache (optional): a Map kept between calls. Steps are only redone from the
// first one that changed, so a slow step (reduce, repair) is not repeated
// when a later step is edited.
// ctx: what some steps need besides their own numbers (ctx.parts: the files
// of added parts, by id; ctx.tape: the masking tape, for the steps that keep it).
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
  // The masking tape each step sees: every spot of the Tape steps before it.
  const tapes = [];
  let tape = [];
  for (const step of steps) {
    tapes.push(tape);
    if (step.enabled && step.type === 'tape') tape = [...tape, ...(step.params.spots ?? [])];
  }
  for (let i = start; i < steps.length; i++) {
    const step = steps[i];
    if (!step.enabled) results.push({ id: step.id, state: 'off' });
    else {
      const op = OPS[step.type];
      try {
        if (!op) throw Error('Unknown step.');
        const taped = tapes[i].length && (TAPE_CUTS.has(step.type) || TAPE_HOLDS.has(step.type)) ? tapes[i] : null;
        let next = op(mesh, step.params, taped ? { ...ctx, tape: taped } : ctx);
        if (taped && TAPE_HOLDS.has(step.type)) next = { ...holdTaped(mesh, next, taped).mesh, info: next.info };
        mesh = { positions: next.positions, indices: next.indices };
        if (SHAPES_ONLY.has(step.type)) original = op(original, step.params);
        results.push({ id: step.id, state: 'ok', info: taped ? { ...next.info, taped: taped.length } : next.info });
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
