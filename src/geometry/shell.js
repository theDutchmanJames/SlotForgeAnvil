// The shell: the floor line, and a new wall built inwards from the outer
// skin. The outer skin never moves. For a model that is already hollow, its
// old inner skin is taken away first; for a solid or a single skin, the
// outer surface is used as it is.
import { bounds } from './bounds.js';
import { cleanOut } from './cleanout.js';
import { applySlice } from './engine.js';
import { faceFrame, rayCaster, sampleFaces } from './rays.js';
import { next, pairEdges, partsOf, splitTouching } from './topology.js';

// ------------------------------------------------------------ floor line

// at: height of the floor line. cut: remove what is below. squish: press the
// lower body up onto the line over a blend zone above it, then open it there.
export function applyFloor(mesh, { mode = 'cut', at, blend = 6, closeWalls = true }) {
  if (!Number.isFinite(at)) throw Error('Set the height of the floor line.');
  const b = bounds(mesh.positions);
  if (at <= b.min[2] + 1e-6 && mode === 'cut') throw Error('The floor line is below the car: raise it to open the underside.');
  let m = mesh;
  let info = {};
  if (mode === 'squish') {
    if (!(blend > 0)) throw Error('Enter how high the squish reaches.');
    const zb = at + blend,
      z0 = b.min[2];
    if (at > z0) {
      const ratio = (zb - z0) / (zb - at); // how much the zone is pressed together
      const p = Float32Array.from(mesh.positions);
      for (let i = 2; i < p.length; i += 3) {
        if (p[i] >= zb) continue;
        const s = (p[i] - z0) / (zb - z0);
        // Smooth at the top of the zone where possible, straight if pressed hard.
        const f = ratio <= 2 ? (ratio - 1) * s * s + (2 - ratio) * s : s;
        p[i] = at + (zb - at) * f;
      }
      m = { positions: p, indices: mesh.indices };
      info.pressed = Math.round((1 - 1 / ratio) * 100);
    }
    // Open the underside just above the pressed-flat bottom.
    const cut = applySlice(m, { axis: 'z', at: at + Math.min(0.05, blend * 0.01), keep: 'above', cap: closeWalls, walls: true });
    return { positions: cut.positions, indices: cut.indices, info: { ...info, walls: cut.info.capped ?? 0 } };
  }
  // A shell's wall is closed along the cut, so it stays solid between its
  // skins; the inside of the body stays open underneath.
  const cut = applySlice(m, { axis: 'z', at, keep: 'above', cap: closeWalls, walls: true });
  return { positions: cut.positions, indices: cut.indices, info: { ...info, walls: cut.info.capped ?? 0 } };
}

// ------------------------------------------------------------ which skin is which

// Already hollow? From outward-looking faces, the next surface inwards is
// close by in a shell, far away in a solid.
export function wallEstimate(mesh, cast) {
  const { positions, indices } = mesh;
  const n = indices.length / 3;
  const diag = Math.hypot(...bounds(positions).size);
  const eps = diag * 1e-5;
  const all = Array.from({ length: n }, (_, i) => i);
  const walls = [];
  for (const f of sampleFaces(all, 500)) {
    const { centre, normal } = faceFrame(positions, indices, f);
    if (!normal) continue;
    if (cast(centre.map((x, k) => x + normal[k] * eps), normal) !== Infinity) continue;
    const d = cast(centre.map((x, k) => x - normal[k] * eps), normal.map((x) => -x));
    if (d !== Infinity) walls.push(d + eps);
  }
  walls.sort((a, b) => a - b);
  return walls.length ? walls[Math.floor(walls.length / 2)] : null;
}

// Label each triangle: 1 outer skin, 0 inner skin. From just in front of a
// surface, look around, but only sideways and upwards: the underside of a
// body is open, and looking down through it would make the inside look like
// the outside. Outside surfaces reach open air in a good share of those
// directions; the inside of the body only through a window. Where a surface
// is closed in (the cabin, a wheel well, a vent) the two sides of the wall
// are compared instead. Spread-out samples decide; every other triangle takes
// the answer of the nearest sample across its own surface.
export const LOOK = (() => {
  const dirs = [];
  const count = 96;
  for (let i = 0; i < count; i++) {
    const z = 1 - (2 * (i + 0.5)) / count;
    const r = Math.sqrt(1 - z * z);
    const a = i * Math.PI * (3 - Math.sqrt(5));
    if (z >= -0.1) dirs.push([r * Math.cos(a), r * Math.sin(a), z]);
  }
  return dirs;
})();

export function openAir(cast, centre, normal, gap) {
  const q = centre.map((x, k) => x + normal[k] * gap);
  let seen = 0,
    out = 0;
  for (const d of LOOK) {
    if (d[0] * normal[0] + d[1] * normal[1] + d[2] * normal[2] < 0.15) continue;
    seen++;
    if (cast(q, d) === Infinity) out++;
  }
  return seen >= 3 ? out / seen : null;
}

export function classifySkins(mesh, cast) {
  const { positions, indices } = mesh;
  const n = indices.length / 3;
  const b = bounds(positions);
  const { twins } = pairEdges(indices, positions.length / 3, positions);
  const gap = Math.hypot(...b.size) * 2e-4;
  const label = new Int8Array(n).fill(-1);
  const step = Math.max(1, Math.floor(n / 9000));
  const queue = [];
  const mid = b.min.map((v, k) => (v + b.max[k]) / 2);
  const half = b.size.map((s) => Math.max(s / 2, 1e-6));
  const reach = (p) => Math.hypot(...p.map((x, k) => (x - mid[k]) / half[k]));
  for (let f = 0; f < n; f += step) {
    const { centre, normal } = faceFrame(positions, indices, f);
    if (!normal) continue;
    // Clearly in the open: outside.
    const s = normal[2] < -0.6 ? null : openAir(cast, centre, normal, gap);
    if (s != null && s > 0.25) label[f] = 1;
    else {
      // Closed in (the cabin, but also a wheel well or a vent): across the
      // wall, the side further out from the middle of the car is outside.
      const back = normal.map((x) => -x);
      const d = cast(centre.map((x, k) => x + back[k] * gap), back);
      if (d === Infinity) label[f] = 1;
      else label[f] = reach(centre) >= reach(centre.map((x, k) => x + back[k] * (d + gap))) ? 1 : 0;
    }
    queue.push(f);
  }
  for (let i = 0; i < queue.length; i++) {
    const f = queue[i];
    for (let e = f * 3; e < f * 3 + 3; e++) {
      const t2 = twins[e];
      if (t2 < 0) continue;
      const g = Math.floor(t2 / 3);
      if (label[g] >= 0) continue;
      label[g] = label[f];
      queue.push(g);
    }
  }
  for (let f = 0; f < n; f++) if (label[f] < 0) label[f] = 1;
  return label;
}

// ------------------------------------------------------------ the new wall

// Wall thickness for a point: the base wall, thinning towards the roof if
// asked, then any painted strokes on top (soft-edged, last one wins).
export function thicknessAt(p, opts, zmin, zmax) {
  let t = opts.wall;
  if (Number.isFinite(opts.top)) {
    const h = Math.min(1, Math.max(0, (p[2] - zmin) / Math.max(zmax - zmin, 1e-6)));
    t = opts.wall + (opts.top - opts.wall) * h;
  }
  for (const s of opts.strokes ?? []) {
    const d = Math.hypot(p[0] - s.at[0], p[1] - s.at[1], p[2] - s.at[2]);
    if (d >= s.radius) continue;
    const x = d / s.radius;
    const w = 1 - x * x * (3 - 2 * x); // soft edge
    t = t + (s.wall - t) * w;
  }
  return t;
}

export function applyHollow(mesh, opts) {
  const o = { wall: 1, top: null, strokes: [], ...opts };
  if (!(o.wall > 0)) throw Error('Enter a wall thickness above 0.');
  const info = {};
  // Clean out first (see cleanout.js): what is not the outside goes, and
  // all below the shrunk car, so the shell is empty and open underneath.
  if (o.clean) {
    const thickest = Math.max(o.wall, Number.isFinite(o.top) ? o.top : 0, ...(o.strokes ?? []).map((s) => s.wall ?? 0));
    const c = cleanOut(mesh, { wall: thickest });
    mesh = c.mesh;
    info.cleaned = c.info.removed;
  }
  let { positions, indices } = mesh;
  let cast = rayCaster(positions, indices);
  const b0 = bounds(positions);

  // A model that is already hollow: keep only its outer skin (cleaned out,
  // there is only the outer skin left).
  const wall = o.clean ? null : wallEstimate(mesh, cast);
  if (wall != null && wall < b0.size[2] * 0.2) {
    const label = classifySkins(mesh, cast);
    const keep = [];
    for (let f = 0; f < label.length; f++) if (label[f] === 1) keep.push(indices[f * 3], indices[f * 3 + 1], indices[f * 3 + 2]);
    info.oldWall = wall;
    indices = Uint32Array.from(keep);
    ({ positions, indices } = compact(positions, indices));
  }

  // Where two openings touch at one corner, give each its own corner, so
  // the band along the openings never doubles up. Then drop stray scraps.
  {
    const { twins } = pairEdges(indices, positions.length / 3, positions);
    ({ positions, indices } = splitTouching(positions, indices, twins));
    const t2 = pairEdges(indices, positions.length / 3, positions).twins;
    const { part, sizes } = partsOf(indices.length / 3, t2);
    const biggest = Math.max(...sizes);
    const keep = [];
    for (let f = 0; f < part.length; f++)
      if (sizes[part[f]] >= Math.max(4, biggest * 0.002)) keep.push(indices[f * 3], indices[f * 3 + 1], indices[f * 3 + 2]);
    info.scraps = indices.length / 3 - keep.length / 3;
    ({ positions, indices } = compact(positions, Uint32Array.from(keep)));
    cast = rayCaster(positions, indices);
  }

  const V = positions.length / 3,
    F = indices.length / 3;
  const { twins } = pairEdges(indices, V);
  let open = 0;
  for (const t of twins) if (t < 0) open++;
  if (!open) throw Error('The body is closed all round. Set the floor line first, so the underside is open.');

  // Smoothed vertex normals, so the inner wall does not crease where the outer one does.
  const normals = new Float64Array(V * 3);
  for (let f = 0; f < F; f++) {
    const { normal, area } = faceFrame(positions, indices, f);
    if (!normal) continue;
    for (let k = 0; k < 3; k++) {
      const v = indices[f * 3 + k] * 3;
      for (let c = 0; c < 3; c++) normals[v + c] += normal[c] * area;
    }
  }
  const nb = Array.from({ length: V }, () => []);
  for (let f = 0; f < F; f++)
    for (let k = 0; k < 3; k++) nb[indices[f * 3 + k]].push(indices[f * 3 + ((k + 1) % 3)]);
  const unit = (arr) => {
    for (let v = 0; v < V; v++) {
      const l = Math.hypot(arr[v * 3], arr[v * 3 + 1], arr[v * 3 + 2]) || 1;
      for (let c = 0; c < 3; c++) arr[v * 3 + c] /= l;
    }
  };
  unit(normals);
  for (let it = 0; it < 3; it++) {
    const copy = normals.slice();
    for (let v = 0; v < V; v++) {
      const s = [copy[v * 3], copy[v * 3 + 1], copy[v * 3 + 2]];
      for (const w of nb[v]) for (let c = 0; c < 3; c++) s[c] += copy[w * 3 + c];
      for (let c = 0; c < 3; c++) normals[v * 3 + c] = s[c];
    }
    unit(normals);
  }

  // Inner points: straight in by the wall, but never past half the space
  // to the other side of the body.
  const b = bounds(positions);
  const inner = new Float32Array(V * 3);
  let thinned = 0;
  const eps = Math.hypot(...b.size) * 1e-5;
  for (let v = 0; v < V; v++) {
    const p = [positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2]];
    const n = [normals[v * 3], normals[v * 3 + 1], normals[v * 3 + 2]];
    let t = thicknessAt(p, o, b.min[2], b.max[2]);
    const room = cast(p.map((x, c) => x - n[c] * eps), n.map((x) => -x));
    // Thinner than two walls (a wing, a flare, a mirror): stop halfway. The
    // inner walls from both sides meet in the middle and the part stays solid.
    if (room !== Infinity && room < t * 2.1) {
      t = room * 0.5;
      thinned++;
    }
    for (let c = 0; c < 3; c++) inner[v * 3 + c] = p[c] - n[c] * t;
  }
  // Even out the inner skin where offsetting bunched it up, but keep each
  // corner's own wall: only the direction is shared with the neighbours.
  for (let it = 0; it < 2; it++) {
    const copy = inner.slice();
    for (let v = 0; v < V; v++) {
      if (!nb[v].length) continue;
      const s = [0, 0, 0];
      for (const w of nb[v]) for (let c = 0; c < 3; c++) s[c] += copy[w * 3 + c] - positions[w * 3 + c];
      const own = [0, 1, 2].map((c) => copy[v * 3 + c] - positions[v * 3 + c]);
      const len = Math.hypot(...own);
      const avg = s.map((x) => x / nb[v].length);
      const dir = own.map((x, c) => x + avg[c]);
      const dl = Math.hypot(...dir) || 1;
      for (let c = 0; c < 3; c++) inner[v * 3 + c] = positions[v * 3 + c] + (dir[c] / dl) * len;
    }
  }
  // Outer skin, inner skin (turned inside out) and a band along every opening.
  const pos = new Float32Array(V * 6);
  pos.set(positions);
  pos.set(inner, V * 3);
  const tri = [];
  for (let f = 0; f < F; f++) tri.push(indices[f * 3], indices[f * 3 + 1], indices[f * 3 + 2]);
  for (let f = 0; f < F; f++) tri.push(indices[f * 3] + V, indices[f * 3 + 2] + V, indices[f * 3 + 1] + V);
  for (let e = 0; e < indices.length; e++) {
    if (twins[e] >= 0) continue;
    const a = indices[e], c = indices[next(e)];
    tri.push(c, a, a + V, c, a + V, c + V);
  }
  info.solid = thinned; // corners where the body stays solid
  return { positions: pos, indices: Uint32Array.from(tri), info };
}

function compact(positions, indices) {
  const map = new Int32Array(positions.length / 3).fill(-1);
  let n = 0;
  for (const v of indices) if (map[v] < 0) map[v] = n++;
  const out = new Float32Array(n * 3);
  for (let v = 0; v < map.length; v++) if (map[v] >= 0) out.set(positions.subarray(v * 3, v * 3 + 3), map[v] * 3);
  return { positions: out, indices: indices.map((v) => map[v]) };
}

// ------------------------------------------------------------ measuring the wall

// Two inner walls closer than this have met in the middle of a solid part.
const MEETING = 0.06;

// Wall thickness at every corner: inwards along the corner's normal to the next surface.
export function wallThickness(mesh) {
  const { positions, indices } = mesh;
  const V = positions.length / 3;
  const normals = new Float64Array(V * 3);
  for (let f = 0; f < indices.length / 3; f++) {
    const { normal, area } = faceFrame(positions, indices, f);
    if (!normal) continue;
    for (let k = 0; k < 3; k++) {
      const v = indices[f * 3 + k] * 3;
      for (let c = 0; c < 3; c++) normals[v + c] += normal[c] * area;
    }
  }
  const cast = rayCaster(positions, indices);
  const eps = Math.hypot(...bounds(positions).size) * 1e-5;
  const out = new Float32Array(V).fill(Infinity);
  for (let v = 0; v < V; v++) {
    const n = [normals[v * 3], normals[v * 3 + 1], normals[v * 3 + 2]];
    const l = Math.hypot(...n);
    if (!l) continue;
    const d = n.map((x) => -x / l);
    const p = [positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2]];
    // Where inner walls meet in the middle of a solid part, look through
    // the meeting point: the material carries on behind it.
    let q = p.map((x, c) => x + d[c] * eps),
      total = eps;
    for (let i = 0; i < 4; i++) {
      const hit = cast(q, d);
      if (hit === Infinity) {
        if (!i) total = Infinity;
        break;
      }
      total += hit + eps;
      q = q.map((x, c) => x + d[c] * (hit + eps));
      // A real end of the wall, unless a second sheet lies right behind it.
      const behind = cast(q, d);
      if (behind > MEETING) break;
      total += behind + eps;
      q = q.map((x, c) => x + d[c] * (behind + eps));
    }
    out[v] = total;
  }
  return out;
}

// Volume of a closed mesh, in mm³.
export function volume({ positions: p, indices: t }) {
  let v = 0;
  for (let f = 0; f < t.length; f += 3) {
    const a = t[f] * 3, b = t[f + 1] * 3, c = t[f + 2] * 3;
    v +=
      p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1]) -
      p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c]) +
      p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c]);
  }
  return v / 6;
}
