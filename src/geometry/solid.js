// Make solid: a hollow shell (an outer and an inner skin a wall apart)
// becomes a solid. The inner skin goes, with anything closed in by the body
// (seats, a dashboard), and the openings that leaves are closed: windows with
// a patch, the underside with walls straight down to a flat bottom.
import { ShapeUtils, Vector2 } from 'three';
import { bounds } from './bounds.js';
import { applySlice } from './engine.js';
import { fillLoop } from './fill.js';
import { faceFrame, rayCaster, rayCounter, sampleFaces } from './rays.js';
import { classifySkins, wallEstimate } from './shell.js';
import { boundaryLoops, detachCrowded, loopLength, pairEdges, partsOf, splitTouching } from './topology.js';

export const NOT_HOLLOW = 'No inner skin found: this model is already solid, or a single surface.';

// Which triangles go (1) and which stay (0), without changing anything.
export function solidPlan(mesh) {
  const { positions, indices } = mesh;
  const cast = rayCaster(positions, indices);
  const b = bounds(positions);
  const wall = wallEstimate(mesh, cast);
  if (wall == null || wall >= b.size[2] * 0.2) throw Error(NOT_HOLLOW);
  const label = classifySkins(mesh, cast);
  const faces = new Uint8Array(label.length);
  let gone = 0;
  for (let f = 0; f < label.length; f++)
    if (label[f] === 0) {
      faces[f] = 1;
      gone++;
    }
  if (!gone) throw Error(NOT_HOLLOW);
  return { faces, wall, gone };
}

// For the panel: never throws.
export function solidPreview(mesh) {
  try {
    const { faces, wall, gone } = solidPlan(mesh);
    return { faces, wall, gone, share: gone / faces.length };
  } catch (e) {
    return { error: e.message };
  }
}

const loopArea = (p, loop) => {
  const n = [0, 0, 0];
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i] * 3, b = loop[(i + 1) % loop.length] * 3;
    n[0] += (p[a + 1] - p[b + 1]) * (p[a + 2] + p[b + 2]);
    n[1] += (p[a + 2] - p[b + 2]) * (p[a] + p[b]);
    n[2] += (p[a] - p[b]) * (p[a + 1] + p[b + 1]);
  }
  return Math.hypot(...n) / 2;
};

// bottom: a height to cut the underside off flat at, or null to close the
// underside at the lowest point of its edge.
export function applySolid(mesh, { bottom = null } = {}) {
  if (bottom != null && !Number.isFinite(bottom)) throw Error('Enter the height of the flat bottom.');
  const { faces, wall, gone } = solidPlan(mesh);
  let { positions } = mesh;
  const keep = [];
  for (let f = 0; f < faces.length; f++) if (!faces[f]) keep.push(mesh.indices[f * 3], mesh.indices[f * 3 + 1], mesh.indices[f * 3 + 2]);
  let indices = Uint32Array.from(keep);

  // Openings that touch at one corner each get their own corner; then drop
  // the scraps the inner skin leaves behind.
  {
    const { twins } = pairEdges(indices, positions.length / 3, positions);
    ({ positions, indices } = splitTouching(positions, indices, twins));
    const t2 = pairEdges(indices, positions.length / 3, positions).twins;
    const { part, sizes } = partsOf(indices.length / 3, t2);
    const biggest = Math.max(...sizes);
    const kept = [];
    for (let f = 0; f < part.length; f++)
      if (sizes[part[f]] >= Math.max(4, biggest * 0.002)) kept.push(indices[f * 3], indices[f * 3 + 1], indices[f * 3 + 2]);
    indices = Uint32Array.from(kept);
  }

  const info = { removed: gone, wall, closed: 0, inside: 0 };
  // The flat bottom: cut the outer skin there first, so the underside's edge
  // runs along that height and its walls drop down to it.
  if (bottom != null) {
    const b = bounds(positions);
    if (bottom >= b.max[2]) throw Error('The flat bottom is above the car: lower it.');
    if (bottom > b.min[2]) ({ positions, indices } = applySlice({ positions, indices }, { axis: 'z', at: bottom, keep: 'above' }));
  }
  {
    const diag = Math.hypot(...bounds(positions).size);
    const { twins } = pairEdges(indices, positions.length / 3, positions);
    const loops = boundaryLoops(indices, twins).filter((l) => loopArea(positions, l) > diag * diag * 1e-9);
    if (loops.length) {
      const edges = new Set();
      for (let f = 0; f < indices.length; f += 3)
        for (let k = 0; k < 3; k++) edges.add(edgeKey(indices[f + k], indices[f + ((k + 1) % 3)]));
      const pos = Array.from(positions);
      const add = [];
      // The underside: a large opening that reaches down to the bottom of the car.
      const zmin = bounds(positions).min[2];
      const underside = (loop) => loopLength(positions, loop) > diag * 0.04 && loop.some((v) => positions[v * 3 + 2] - zmin < diag * 1e-4);
      for (const loop of loops) for (const f of patch(pos, loop, edges, underside(loop))) add.push(...f);
      positions = Float32Array.from(pos);
      indices = detachCrowded(positions, Uint32Array.from([...indices, ...add])).indices;
      info.closed = loops.length;
      // Small gaps left where an outline folds back on itself: close them too.
      for (let round = 0; round < 2; round++) {
        const t2 = pairEdges(indices, positions.length / 3, positions).twins;
        const rest = boundaryLoops(indices, t2);
        if (!rest.length) break;
        const pos2 = Array.from(positions);
        const more = [];
        for (const loop of rest) for (const f of patch(pos2, loop, edges, false)) more.push(...f);
        positions = Float32Array.from(pos2);
        indices = detachCrowded(positions, Uint32Array.from([...indices, ...more])).indices;
      }
    }
  }
  ({ indices } = dropInside(positions, indices, info));
  return { ...compact(positions, indices), info };
}

const edgeKey = (a, b) => (a < b ? a * 4194304 + b : b * 4194304 + a);

// Close one opening without laying a patch edge on top of an edge the model
// already has (a narrow slit would otherwise get a third triangle on an
// edge). If that happens, fan out from the middle of the opening instead.
function patch(pos, loop, edges, big) {
  const rim = new Set(loop.map((v, i) => edgeKey(v, loop[(i + 1) % loop.length])));
  const clashes = (faces) =>
    faces.some((f) => [0, 1, 2].some((k) => {
      const e = edgeKey(f[k], f[(k + 1) % 3]);
      return !rim.has(e) && edges.has(e);
    }));
  let faces = big && facesDown(pos, loop) ? plinth(pos, loop) : null;
  if (!faces || clashes(faces)) faces = fillLoop(pos, loop, loop.length > 8 ? 'smooth' : 'flat');
  if (clashes(faces)) {
    const c = [0, 0, 0];
    for (const v of loop) for (let k = 0; k < 3; k++) c[k] += pos[v * 3 + k] / loop.length;
    const id = pos.length / 3;
    pos.push(...c);
    faces = loop.map((v, i) => [id, v, loop[(i + 1) % loop.length]]);
  }
  for (const f of faces) for (let k = 0; k < 3; k++) edges.add(edgeKey(f[k], f[(k + 1) % 3]));
  return faces;
}

// Does the patch for this opening face down (the underside of the car)?
function facesDown(pos, loop) {
  const n = [0, 0, 0];
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i] * 3, b = loop[(i + 1) % loop.length] * 3;
    n[0] += (pos[a + 1] - pos[b + 1]) * (pos[a + 2] + pos[b + 2]);
    n[1] += (pos[a + 2] - pos[b + 2]) * (pos[a] + pos[b]);
    n[2] += (pos[a] - pos[b]) * (pos[a + 1] + pos[b + 1]);
  }
  const l = Math.hypot(...n);
  return l > 0 && n[2] / l < -0.5;
}

// The underside: walls straight down from its edge to the lowest point of
// that edge, and a flat bottom there. A patch spanning the opening would rise
// into the car round the wheel arches; this never goes inside the body, so a
// slice later cuts it cleanly.
function plinth(pos, loop) {
  let z0 = Infinity;
  for (const v of loop) z0 = Math.min(z0, pos[v * 3 + 2]);
  const tol = 1e-4;
  const low = loop.map((v) => {
    if (pos[v * 3 + 2] - z0 < tol) return v;
    const id = pos.length / 3;
    pos.push(pos[v * 3], pos[v * 3 + 1], z0);
    return id;
  });
  const faces = [];
  const add = (a, b, c) => {
    if (a !== b && b !== c && a !== c) faces.push([a, b, c]);
  };
  for (let i = 0; i < loop.length; i++) {
    const j = (i + 1) % loop.length;
    add(loop[i], loop[j], low[j]);
    add(loop[i], low[j], low[i]);
  }
  // The bottom: flat at z0, running the same way round as the opening did.
  const pts = low.map((v) => new Vector2(pos[v * 3], pos[v * 3 + 1]));
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    area += a.x * b.y - b.x * a.y;
  }
  const tris = keepAllPoints(ShapeUtils.triangulateShape(pts, []), pts.length);
  if (!tris.length) return null;
  for (const [a, b, c] of tris) {
    const s = (pts[b].x - pts[a].x) * (pts[c].y - pts[a].y) - (pts[b].y - pts[a].y) * (pts[c].x - pts[a].x);
    if (Math.sign(s) === Math.sign(area) || s === 0) add(low[a], low[b], low[c]);
    else add(low[a], low[c], low[b]);
  }
  return faces;
}

// Earcut leaves out points that lie in a straight line along the outline (the
// foot of a wall under a wheel arch). Their triangles would leave a crack
// along the wall: put each left-out point back into the triangle edge it lies on.
function keepAllPoints(tris, n) {
  const used = new Uint8Array(n);
  for (const t of tris) for (const i of t) used[i] = 1;
  if (used.every(Boolean)) return tris;
  // The points left out between outline points a and b, walking forward.
  const between = (a, b) => {
    const out = [];
    for (let i = (a + 1) % n; i !== b; i = (i + 1) % n) {
      if (used[i]) return null;
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

// Pieces of the interior that were not joined to the inner skin (a seat, a
// steering wheel) end up inside the solid: take them out. A piece is inside
// when most rays from it, sideways and upwards, cross the body an odd number
// of times. Downwards is left out: the underside may still be open.
const DIRS = [[0.31, 0.17, 0.93], [0.83, -0.41, 0.38], [-0.62, 0.71, 0.33], [-0.27, -0.88, 0.39], [0.97, 0.21, 0.12]];
function dropInside(positions, indices, info) {
  const { twins } = pairEdges(indices, positions.length / 3, positions);
  const { part, sizes } = partsOf(indices.length / 3, twins);
  if (sizes.length < 2) return { indices };
  const main = sizes.indexOf(Math.max(...sizes));
  const mainTris = [];
  const byPart = sizes.map(() => []);
  for (let f = 0; f < part.length; f++) {
    if (part[f] === main) mainTris.push(indices[f * 3], indices[f * 3 + 1], indices[f * 3 + 2]);
    else byPart[part[f]].push(f);
  }
  const count = rayCounter(positions, Uint32Array.from(mainTris));
  const drop = new Set();
  byPart.forEach((faces, p) => {
    if (p === main || !faces.length) return;
    let inside = 0, votes = 0;
    for (const f of sampleFaces(faces, 3)) {
      const { centre } = faceFrame(positions, indices, f);
      for (const d of DIRS) {
        votes++;
        if (count(centre, d) % 2) inside++;
      }
    }
    if (inside > votes / 2) drop.add(p);
  });
  if (!drop.size) return { indices };
  info.inside = drop.size;
  const keep = [];
  for (let f = 0; f < part.length; f++) if (!drop.has(part[f])) keep.push(indices[f * 3], indices[f * 3 + 1], indices[f * 3 + 2]);
  return { indices: Uint32Array.from(keep) };
}

function compact(positions, indices) {
  const map = new Int32Array(positions.length / 3).fill(-1);
  let n = 0;
  for (const v of indices) if (map[v] < 0) map[v] = n++;
  const out = new Float32Array(n * 3);
  for (let v = 0; v < map.length; v++) if (map[v] >= 0) out.set(positions.subarray(v * 3, v * 3 + 3), map[v] * 3);
  return { positions: out, indices: indices.map((v) => map[v]) };
}
