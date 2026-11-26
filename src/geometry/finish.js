// Shape and finish: smoothing, closing a slice, and adding a part from a file.
// Car frame: X along (front low), Y across (centre line 0), Z up.
import { ShapeUtils, Vector2 } from 'three';
import { bounds } from './bounds.js';
import { rayCaster } from './rays.js';
import { classifySkins } from './shell.js';
import { boundaryLoops, pairEdges } from './topology.js';

// ------------------------------------------------------------ smooth

// params: { strokes: [{ at, radius }], faces: [run pairs] | null, strength
//           (1-10), keepEdges, protect }
// Laplacian smoothing, softened towards the edge of the brush. Open edges
// never move. keepEdges holds sharp edges still;
// protect holds the outer skin still (Protect the outside).
export function applySmooth(mesh, { strokes = [], faces = null, strength = 3, keepEdges = true, protect = false }) {
  const P = Float32Array.from(mesh.positions), T = mesh.indices;
  const V = P.length / 3, F = T.length / 3;
  const w = new Float32Array(V);
  for (const s of strokes) {
    const r2 = s.radius * s.radius;
    for (let v = 0; v < V; v++) {
      const d2 = (P[v * 3] - s.at[0]) ** 2 + (P[v * 3 + 1] - s.at[1]) ** 2 + (P[v * 3 + 2] - s.at[2]) ** 2;
      if (d2 < r2) w[v] = Math.max(w[v], (1 - d2 / r2) ** 2);
    }
  }
  if (faces)
    for (let i = 0; i < faces.length; i += 2) {
      if (faces[i] + faces[i + 1] > F) throw Error('This step no longer matches the model, because an earlier step changed it.');
      for (let f = faces[i]; f < faces[i] + faces[i + 1]; f++) for (let k = 0; k < 3; k++) w[T[f * 3 + k]] = 1;
    }
  // What may not move.
  const { twins } = pairEdges(T, V, P);
  const fixed = new Uint8Array(V);
  const normal = (f) => {
    const a = T[f * 3] * 3, b = T[f * 3 + 1] * 3, c = T[f * 3 + 2] * 3;
    const u = [P[b] - P[a], P[b + 1] - P[a + 1], P[b + 2] - P[a + 2]], q = [P[c] - P[a], P[c + 1] - P[a + 1], P[c + 2] - P[a + 2]];
    const n = [u[1] * q[2] - u[2] * q[1], u[2] * q[0] - u[0] * q[2], u[0] * q[1] - u[1] * q[0]];
    const l = Math.hypot(...n) || 1;
    return n.map((x) => x / l);
  };
  const nrm = Array.from({ length: F }, (_, f) => normal(f));
  for (let e = 0; e < T.length; e++) {
    const a = T[e], b = T[e % 3 === 2 ? e - 2 : e + 1];
    if (twins[e] < 0) fixed[a] = fixed[b] = 1;
    else if (keepEdges) {
      const n1 = nrm[Math.floor(e / 3)], n2 = nrm[Math.floor(twins[e] / 3)];
      if (n1[0] * n2[0] + n1[1] * n2[1] + n1[2] * n2[2] < Math.cos((35 * Math.PI) / 180)) fixed[a] = fixed[b] = 1;
    }
  }
  if (protect) {
    const outer = classifySkins({ positions: P, indices: T }, rayCaster(P, T));
    for (let f = 0; f < F; f++) if (outer[f] === 1) for (let k = 0; k < 3; k++) fixed[T[f * 3 + k]] = 1;
  }
  // Neighbours.
  const nb = Array.from({ length: V }, () => new Set());
  for (let f = 0; f < F; f++)
    for (let k = 0; k < 3; k++) {
      const a = T[f * 3 + k], b = T[f * 3 + ((k + 1) % 3)];
      if (w[a] > 0) nb[a].add(b);
      if (w[b] > 0) nb[b].add(a);
    }
  const moving = [];
  for (let v = 0; v < V; v++) if (w[v] > 0 && !fixed[v] && nb[v].size) moving.push(v);
  const passes = Math.max(1, Math.round(strength * 2));
  const step = (factor) => {
    const next = new Float32Array(moving.length * 3);
    moving.forEach((v, i) => {
      const c = [0, 0, 0];
      for (const u of nb[v]) for (let k = 0; k < 3; k++) c[k] += P[u * 3 + k];
      for (let k = 0; k < 3; k++) next[i * 3 + k] = P[v * 3 + k] + factor * w[v] * (c[k] / nb[v].size - P[v * 3 + k]);
    });
    moving.forEach((v, i) => P.set(next.subarray(i * 3, i * 3 + 3), v * 3));
  };
  // Mostly plain smoothing (bumps go), with a small pass back out so a
  // large area does not shrink much.
  for (let i = 0; i < passes; i++) {
    step(0.6);
    step(-0.15);
  }
  return { positions: P, indices: T, info: { moved: moving.length } };
}

// ------------------------------------------------------------ caps

// Close the openings that lie in a plane (axis = at): outlines inside
// outlines become holes, so a shell's cut gets a ring, a solid's a full cap.
// tilted (from slicePlane): the plane is turned, and the outlines are laid
// flat along it.
// walls: close only the cut through a wall (a ring, or a thin strip where the
// outer and inner skin meet at its ends), never the whole inside of a body.
export function capPlane(mesh, axis, at, tol = 1e-4, tilted = null, walls = false) {
  const k = 'xyz'.indexOf(axis);
  const P = mesh.positions;
  const { twins } = pairEdges(mesh.indices, P.length / 3, P);
  const off = (v) => (tilted ? tilted.dist(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]) : P[v * 3 + k] - at);
  const loops = boundaryLoops(mesh.indices, twins).filter((l) => l.every((v) => Math.abs(off(v)) < tol * Math.max(1, Math.abs(at)) + 1e-4));
  if (!loops.length) return { mesh, capped: 0 };
  let flatten;
  if (tilted) {
    // Along the slope (in the plane) and along the line it turns about.
    const n = tilted.normal,
      j = 3 - tilted.k - tilted.i;
    const u = [0, 0, 0];
    u[tilted.i] = n[tilted.k];
    u[tilted.k] = -n[tilted.i];
    flatten = (v) => new Vector2(u[0] * P[v * 3] + u[1] * P[v * 3 + 1] + u[2] * P[v * 3 + 2], P[v * 3 + j]);
  } else {
    const [i, j] = [0, 1, 2].filter((c) => c !== k);
    flatten = (v) => new Vector2(P[v * 3 + i], P[v * 3 + j]);
  }
  return capLoops(mesh, loops, flatten, walls);
}

// Earcut leaves out points that lie in a straight line along an outline. The
// triangles round them would leave a crack: put each left-out point back into
// the triangle edge it lies on. rings: the point count of each outline, in
// the order their points were given (outer first, then the holes).
export function keepAllPoints(tris, rings) {
  const n = rings.reduce((s, k) => s + k, 0);
  const used = new Uint8Array(n);
  for (const t of tris) for (const i of t) used[i] = 1;
  if (used.every(Boolean)) return tris;
  const ringOf = new Int32Array(n), start = [];
  let s = 0;
  rings.forEach((k, r) => {
    start.push(s);
    ringOf.fill(r, s, s + k);
    s += k;
  });
  const after = (i) => {
    const r = ringOf[i];
    return i + 1 < start[r] + rings[r] ? i + 1 : start[r];
  };
  // The points left out between a and b, walking forward along their outline.
  const between = (a, b) => {
    if (ringOf[a] !== ringOf[b]) return null;
    const out = [];
    for (let i = after(a); i !== b; i = after(i)) {
      if (used[i] || i === a) return null;
      out.push(i);
    }
    return out;
  };
  const out = [];
  const queue = tris.map((t) => [...t]);
  while (queue.length) {
    const t = queue.pop();
    let split = false;
    for (let k = 0; k < 3 && !split; k++) {
      const a = t[k], b = t[(k + 1) % 3], o = t[(k + 2) % 3];
      let chain = between(a, b);
      if (!chain?.length) {
        const back = between(b, a);
        chain = back?.length ? back.reverse() : null;
      }
      if (!chain?.length) continue;
      const run = [a, ...chain, b];
      for (let i = 0; i < run.length - 1; i++) queue.push([run[i], run[i + 1], o]);
      for (const i of chain) used[i] = 1;
      split = true;
    }
    if (!split) out.push(t);
  }
  return out;
}

// Wider than this share of the model's diagonal, an outline is not a wall.
export const WALL_WIDTH = 0.05;

// Close the given openings (all in one plane) flat. flatten(v) lays a corner
// out in that plane, as a Vector2. walls: see capPlane.
export function capLoops(mesh, loops, flatten, walls = false) {
  const flat = loops.map((l) => l.map(flatten));
  const area = (pts) => pts.reduce((s, p, n) => s + p.x * pts[(n + 1) % pts.length].y - pts[(n + 1) % pts.length].x * p.y, 0) / 2;
  const perimeter = (pts) => pts.reduce((s, p, n) => s + p.distanceTo(pts[(n + 1) % pts.length]), 0);
  let maxWidth = Infinity;
  if (walls) {
    const P = mesh.positions;
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < P.length; i++) {
      lo[i % 3] = Math.min(lo[i % 3], P[i]);
      hi[i % 3] = Math.max(hi[i % 3], P[i]);
    }
    maxWidth = Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) * WALL_WIDTH;
  }
  // A strip's width: twice its area over its length round.
  const thin = (pts) => (2 * Math.abs(area(pts))) / Math.max(perimeter(pts), 1e-12) < maxWidth;
  const inside = (p, pts) => {
    let odd = false;
    for (let a = 0, b = pts.length - 1; a < pts.length; b = a++)
      if (pts[a].y > p.y !== pts[b].y > p.y && p.x < ((pts[b].x - pts[a].x) * (p.y - pts[a].y)) / (pts[b].y - pts[a].y) + pts[a].x) odd = !odd;
    return odd;
  };
  // How deep each outline sits inside the others: even = an outer edge, odd = a hole.
  const depth = flat.map((pts, n) => flat.filter((o, m) => m !== n && Math.abs(area(o)) > Math.abs(area(pts)) && inside(pts[0], o)).length);
  const faces = [];
  const extra = []; // new corners (a fan's middle), after the mesh's own
  const P = mesh.positions;
  const V0 = P.length / 3;
  let capped = 0;
  flat.forEach((outer, n) => {
    if (depth[n] % 2) return;
    const holes = flat.map((h, m) => m).filter((m) => depth[m] === depth[n] + 1 && inside(flat[m][0], outer));
    if (walls && !holes.length && !thin(outer)) return;
    capped++;
    const contour = outer, holePts = holes.map((m) => flat[m]);
    const ids = [...loops[n], ...holes.flatMap((m) => loops[m])];
    const tris = keepAllPoints(ShapeUtils.triangulateShape(contour, holePts), [contour.length, ...holePts.map((h) => h.length)]);
    // The cap runs the way its outline asks (boundaryLoops gives that order).
    const want = Math.sign(area(contour));
    const all = [...contour, ...holePts.flat()];
    const mine = [];
    for (const [a, b, c] of tris) {
      const s = (all[b].x - all[a].x) * (all[c].y - all[a].y) - (all[b].y - all[a].y) * (all[c].x - all[a].x);
      if (Math.sign(s) === want || s === 0) mine.push(ids[a], ids[b], ids[c]);
      else mine.push(ids[a], ids[c], ids[b]);
    }
    // A hole added by the caller (a pin hole) may run either way round: for
    // the fallback, turn it to run against the outline, as a hole does.
    const rings = [loops[n], ...holes.map((m) => (Math.sign(area(flat[m])) === want ? [...loops[m]].reverse() : loops[m]))];
    if (closes(mine, rings)) return faces.push(...mine);
    // An outline that crosses itself (where a hollowed body's skins pass
    // through each other) is not filled whole by the triangulation. Close it
    // in a way that always closes, whatever its shape: wound by the outline's
    // own order, so it fits the surface round it.
    if (rings.length === 1) {
      const ring = rings[0];
      const mid = V0 + extra.length / 3;
      for (let k = 0; k < 3; k++) extra.push(ring.reduce((s, v) => s + P[v * 3 + k], 0) / ring.length);
      for (let i = 0; i < ring.length; i++) faces.push(mid, ring[i], ring[(i + 1) % ring.length]);
    } else if (rings.length === 2) faces.push(...zipRings(P, rings[0], rings[1]));
    else faces.push(...mine);
  });
  const idx = new Uint32Array(mesh.indices.length + faces.length);
  idx.set(mesh.indices);
  idx.set(faces, mesh.indices.length);
  let positions = mesh.positions;
  if (extra.length) {
    positions = new Float32Array(P.length + extra.length);
    positions.set(P);
    positions.set(extra, P.length);
  }
  return { mesh: { positions, indices: idx }, capped };
}

// Does this patch close the outlines exactly: every outline edge used once,
// all of an outline the same way round, every other edge shared by two of
// its triangles?
function closes(tris, rings) {
  const count = new Map();
  const key = (a, b) => `${a}>${b}`;
  for (let f = 0; f < tris.length; f += 3)
    for (let k = 0; k < 3; k++) {
      const kk = key(tris[f + k], tris[f + ((k + 1) % 3)]);
      count.set(kk, (count.get(kk) ?? 0) + 1);
    }
  const rim = new Set();
  for (const r of rings) {
    // The way round the patch uses this outline: from its first edge.
    const fwd = count.get(key(r[0], r[1 % r.length])) === 1;
    for (let i = 0; i < r.length; i++) {
      const [a, b] = fwd ? [r[i], r[(i + 1) % r.length]] : [r[(i + 1) % r.length], r[i]];
      const kk = key(a, b);
      if (count.get(kk) !== 1) return false;
      rim.add(kk);
    }
  }
  for (const [kk, n] of count) {
    if (n !== 1) return false;
    if (rim.has(kk)) continue;
    const [a, b] = kk.split('>');
    if (count.get(key(b, a)) !== 1) return false;
  }
  return true;
}

// A strip between an outer outline and the one hole in it, both in the order
// a patch runs (the region on their left). They run opposite ways round, so
// the hole is walked backwards; each step takes the shorter new edge.
function zipRings(P, outer, hole) {
  const d2 = (a, b) => (P[a * 3] - P[b * 3]) ** 2 + (P[a * 3 + 1] - P[b * 3 + 1]) ** 2 + (P[a * 3 + 2] - P[b * 3 + 2]) ** 2;
  let j0 = 0;
  for (let j = 1; j < hole.length; j++) if (d2(outer[0], hole[j]) < d2(outer[0], hole[j0])) j0 = j;
  const out = [];
  const no = outer.length, nh = hole.length;
  let i = 0, j = 0; // steps taken on each
  while (i < no || j < nh) {
    const o = outer[i % no], o1 = outer[(i + 1) % no];
    const h = hole[(((j0 - j) % nh) + nh) % nh], h1 = hole[(((j0 - j - 1) % nh) + nh) % nh];
    const stepOuter = j >= nh || (i < no && d2(o1, h) <= d2(o, h1));
    if (stepOuter) {
      out.push(o, o1, h);
      i++;
    } else {
      out.push(h1, h, o);
      j++;
    }
  }
  return out;
}

// ------------------------------------------------------------ add a part

// Where an added part goes. The part's own file is first put with the middle
// of its base at 0, then scaled, turned (round Z, then Y, then X) and moved.
export function placePart(part, { x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, scale = 1 }) {
  const b = bounds(part.positions);
  const c = [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, b.min[2]];
  const rad = (d) => (d * Math.PI) / 180;
  const [cx, sx] = [Math.cos(rad(rx)), Math.sin(rad(rx))], [cy, sy] = [Math.cos(rad(ry)), Math.sin(rad(ry))], [cz, sz] = [Math.cos(rad(rz)), Math.sin(rad(rz))];
  const src = part.positions;
  const out = new Float32Array(src.length);
  for (let n = 0; n < src.length; n += 3) {
    let p = [(src[n] - c[0]) * scale, (src[n + 1] - c[1]) * scale, (src[n + 2] - c[2]) * scale];
    p = [p[0] * cz - p[1] * sz, p[0] * sz + p[1] * cz, p[2]];
    p = [p[0] * cy + p[2] * sy, p[1], -p[0] * sy + p[2] * cy];
    p = [p[0], p[1] * cx - p[2] * sx, p[1] * sx + p[2] * cx];
    out[n] = p[0] + x;
    out[n + 1] = p[1] + y;
    out[n + 2] = p[2] + z;
  }
  return { positions: out, indices: part.indices };
}

// The part as placed, and its mirror image across the centre line if asked.
export function partPieces(part, place) {
  const a = placePart(part, place);
  if (!place.pair) return [a];
  const pos = Float32Array.from(a.positions, (v, n) => (n % 3 === 1 ? -v : v));
  const idx = Uint32Array.from(a.indices);
  for (let f = 0; f < idx.length; f += 3) [idx[f + 1], idx[f + 2]] = [idx[f + 2], idx[f + 1]];
  return [a, { positions: pos, indices: idx }];
}

// params: { part: id, name, place, join }. ctx.parts: Map id → mesh.
// A joined part becomes part of the body (as its own piece overlapping it:
// the slicer joins them). A separate part is exported on its own instead.
export function applyAddPart(mesh, { part, name, place = {}, join = true }, ctx = {}) {
  const src = ctx.parts?.get(part);
  if (!src) throw Error(`The file of ${name ?? 'this part'} is missing. Load it again.`);
  if (!join) return { positions: mesh.positions, indices: mesh.indices, info: { separate: true } };
  let pos = Array.from(mesh.positions), idx = Array.from(mesh.indices);
  for (const p of partPieces(src, place)) {
    const off = pos.length / 3;
    pos = pos.concat(Array.from(p.positions));
    for (const v of p.indices) idx.push(v + off);
  }
  return { positions: Float32Array.from(pos), indices: Uint32Array.from(idx), info: { joined: true } };
}
