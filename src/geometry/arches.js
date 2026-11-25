// Making a body fit its chassis: stretch or shorten it between the wheel
// arches, widen it, cut the arches round the tyres, and flare them out.
// Car frame: front at low X, Z up, centre line Y = 0.
import { Vector2 } from 'three';
import { bounds } from './bounds.js';
import { capLoops } from './finish.js';
import { boundaryLoops, pairEdges } from './topology.js';

// ------------------------------------------------------------ stretch

// Along the car: everything ahead of `from` stays, everything behind `to`
// moves back by `amount` as one piece, and the part in between stretches with
// a smooth blend. The arches sit outside that zone, so they stay round.
// Across the car: the body is made wider (or narrower) by `amount` in total.
export function applyStretch(mesh, { axis, amount, from, to }) {
  if (!Number.isFinite(amount)) throw Error('Enter how much longer or wider.');
  const p = Float32Array.from(mesh.positions);
  if (axis === 'x') {
    if (!(to > from)) throw Error('There is no room between the arches to stretch.');
    const span = to - from;
    if (amount <= -span * 0.6) throw Error('That would squeeze the middle of the body too much.');
    for (let i = 0; i < p.length; i += 3) {
      const x = p[i];
      if (x <= from) continue;
      if (x >= to) {
        p[i] += amount;
        continue;
      }
      const s = (x - from) / span;
      p[i] += amount * blend(s);
    }
  } else if (axis === 'y') {
    const w = bounds(p).size[1];
    if (!(w + amount > w * 0.5)) throw Error('That would make the body far too narrow.');
    const k = (w + amount) / w;
    for (let i = 1; i < p.length; i += 3) p[i] *= k;
  } else throw Error('Choose along or across the car.');
  return { positions: p, indices: mesh.indices, info: { axis, amount } };
}

// Displacement share across the stretch zone. Linear in the middle keeps
// straight lines straight; the ends ease in so there is no visible kink.
function blend(s) {
  const e = 0.2; // share of the zone used to ease in and out
  if (s <= 0) return 0;
  if (s >= 1) return 1;
  // Ease-in over [0, e], straight over [e, 1 - e], ease-out over [1 - e, 1].
  const slope = 1 / (1 - e); // speed of the straight part
  if (s < e) return (slope * s * s) / (2 * e);
  if (s > 1 - e) return 1 - (slope * (1 - s) * (1 - s)) / (2 * e);
  return slope * (s - e / 2);
}

// ------------------------------------------------------------ cutting the arches

// Remove everything inside a cylinder running across the car (x, z centre,
// radius r), keeping the rest. Where the cut goes through a shell's wall, the
// wall is closed along the cut so it stays solid between its skins; a solid
// body's cut stays open for Hollow, which closes it with the new wall.
export function applyArchCut(mesh, { cuts, closeWalls = true }) {
  let m = mesh;
  let removed = 0,
    walls = 0;
  for (const c of cuts ?? []) {
    if (!(c.r > 0) || !Number.isFinite(c.x) || !Number.isFinite(c.z)) throw Error('An arch cut is damaged. Remove the step and cut again.');
    const inside = (x, z) => c.r * c.r - ((x - c.x) ** 2 + (z - c.z) ** 2); // > 0 inside
    const out = clip(m, (p) => inside(p[0], p[2])); // keep where inside <= 0: outside the circle
    removed += out.removed;
    m = out;
    if (closeWalls && out.removed) {
      const closed = closeCylinderCut(m, c);
      walls += closed.capped;
      m = closed.mesh;
    }
  }
  return { positions: m.positions, indices: m.indices, info: { removed, walls } };
}

// The openings a cut left on the arch cylinder, closed where they are a wall.
// The cylinder is unrolled flat (round the axle, and across the car); the
// seam is straight down from the axle, where a body has no wall.
function closeCylinderCut(mesh, c) {
  const P = mesh.positions;
  const { twins } = pairEdges(mesh.indices, P.length / 3, P);
  const tol = c.r * 1e-4 + 1e-4;
  const onCut = (v) => Math.abs(Math.hypot(P[v * 3] - c.x, P[v * 3 + 2] - c.z) - c.r) < tol;
  const loops = boundaryLoops(mesh.indices, twins).filter((l) => l.every(onCut));
  if (!loops.length) return { mesh, capped: 0 };
  const flatten = (v) => {
    let a = Math.atan2(P[v * 3 + 2] - c.z, P[v * 3] - c.x);
    if (a < -Math.PI / 2) a += 2 * Math.PI;
    return new Vector2(a * c.r, P[v * 3 + 1]);
  };
  return capLoops(mesh, loops, flatten, true);
}

// Keep the part of the mesh where f(p) <= 0. Triangles crossing the surface
// f = 0 are clipped, with the crossing found along each edge by bisection.
export function clip(mesh, f) {
  const p = mesh.positions,
    idx = mesh.indices;
  const V = p.length / 3;
  const val = new Float64Array(V);
  for (let v = 0; v < V; v++) val[v] = f([p[v * 3], p[v * 3 + 1], p[v * 3 + 2]]);
  const pos = Array.from(p);
  const cut = new Map();
  const onEdge = (a, b) => {
    const key = a < b ? a * V + b : b * V + a;
    let id = cut.get(key);
    if (id !== undefined) return id;
    const A = [p[a * 3], p[a * 3 + 1], p[a * 3 + 2]], B = [p[b * 3], p[b * 3 + 1], p[b * 3 + 2]];
    // Bisection between the kept end (f <= 0) and the removed end.
    let lo = 0, hi = 1;
    const at = (t) => A.map((x, k) => x + t * (B[k] - x));
    const keepA = val[a] <= 0;
    for (let i = 0; i < 30; i++) {
      const mid = (lo + hi) / 2;
      const kept = f(at(mid)) <= 0;
      if (kept === keepA) lo = mid;
      else hi = mid;
    }
    id = pos.length / 3;
    pos.push(...at(keepA ? lo : hi));
    cut.set(key, id);
    return id;
  };
  const out = [];
  let removed = 0;
  for (let i = 0; i < idx.length; i += 3) {
    const t = [idx[i], idx[i + 1], idx[i + 2]];
    const keep = t.map((v) => val[v] <= 0);
    const n = keep.filter(Boolean).length;
    if (n === 3) {
      out.push(...t);
      continue;
    }
    removed++;
    if (!n) continue;
    const poly = [];
    for (let k = 0; k < 3; k++) {
      const a = t[k], b = t[(k + 1) % 3];
      if (keep[k]) poly.push(a);
      if (keep[k] !== keep[(k + 1) % 3]) poly.push(onEdge(a, b));
    }
    for (let k = 1; k + 1 < poly.length; k++) out.push(poly[0], poly[k], poly[k + 1]);
  }
  // Drop corners no triangle uses.
  const map = new Int32Array(pos.length / 3).fill(-1);
  let m = 0;
  for (const v of out) if (map[v] < 0) map[v] = m++;
  const positions = new Float32Array(m * 3);
  for (let v = 0; v < map.length; v++) if (map[v] >= 0) positions.set(pos.slice(v * 3, v * 3 + 3), map[v] * 3);
  return { positions, indices: Uint32Array.from(out, (v) => map[v]), removed };
}

// ------------------------------------------------------------ flaring an arch

// Hammer blows along the arch edge on both sides: from just above the axle
// on one side, over the top, to the other side. For the Hammer step.
export function flareBlows({ x, z, r, side, amount, head }) {
  const blows = [];
  const count = Math.max(5, Math.round((Math.PI * r) / (head * 0.45)));
  for (let i = 0; i <= count; i++) {
    const a = Math.PI * (0.1 + (0.8 * i) / count); // 18° to 162° above the axle line
    const at = [x - Math.cos(a) * (r + head * 0.3), side, z + Math.sin(a) * (r + head * 0.3)];
    // Overlapping blows add up: each one does a share.
    blows.push({ at: at.map((v) => Number(v.toFixed(3))), radius: head, depth: Number((amount * 0.45).toFixed(3)), kind: 'out' });
    blows.push({ at: [at[0], -at[1], at[2]].map((v) => Number(v.toFixed(3))), radius: head, depth: Number((amount * 0.45).toFixed(3)), kind: 'out' });
  }
  return blows;
}
