// Finding the windows on a body, for the Windows step to start from. Three
// kinds of edge tell where the glass goes:
//   opening: a hole the model came with (the rim where its outer skin ends);
//   part:    glass that is a part of its own (a thin plate, its outside's edge);
//   recess:  a pane set into a frame (a patch of the outside that the
//            surface round it steps up from all along its edge).
// Each found edge becomes a window outline with few points (corners kept
// sharp), so it is easy to change, and spots that look wrong for a window (a
// small dent, a kink) are pointed out. Left and right side windows that
// mirror each other become one mirrored window.
// Car frame: X along (front low), Y across (centre line 0), Z up.
import { bounds } from './bounds.js';
import { sampleClosedCurve } from './curve.js';
import { rayCaster } from './rays.js';
import { boundaryLoops, next, pairEdges, partsOf } from './topology.js';

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const norm = (a) => {
  const l = Math.hypot(...a);
  return l ? a.map((x) => x / l) : a;
};

export const TRACE_DEFAULTS = { crease: 25, tolerance: 0.3, minSize: 4, minPart: 8 };

// mesh: the body before its windows are cut. Returns { found: [{ kind,
// points, corners, normal, mirror, centre, size, doubt, edge, step }] }:
// points and corners as a window has them; edge, the found edge itself
// (dense, both sides when mirrored) to snap to; step, how far a recessed
// pane sits below its frame.
export function traceWindows(mesh, opts = {}) {
  const o = { ...TRACE_DEFAULTS, ...opts };
  const P = mesh.positions, T = mesh.indices;
  const F = T.length / 3, V = P.length / 3;
  const b = bounds(P);
  const height = b.size[2];
  const { twins } = pairEdges(T, V, P);
  // Face normals, areas and centres.
  const N = new Float32Array(F * 3), A = new Float32Array(F), C = new Float32Array(F * 3);
  for (let f = 0; f < F; f++) {
    const a = T[f * 3] * 3, b2 = T[f * 3 + 1] * 3, c = T[f * 3 + 2] * 3;
    const n = cross([P[b2] - P[a], P[b2 + 1] - P[a + 1], P[b2 + 2] - P[a + 2]], [P[c] - P[a], P[c + 1] - P[a + 1], P[c + 2] - P[a + 2]]);
    const l = Math.hypot(...n);
    A[f] = l / 2;
    for (let k = 0; k < 3; k++) {
      N[f * 3 + k] = l ? n[k] / l : 0;
      C[f * 3 + k] = (P[a + k] + P[b2 + k] + P[c + k]) / 3;
    }
  }
  const nOf = (f) => [N[f * 3], N[f * 3 + 1], N[f * 3 + 2]];
  const cOf = (f) => [C[f * 3], C[f * 3 + 1], C[f * 3 + 2]];
  const pt = (v) => [P[v * 3], P[v * 3 + 1], P[v * 3 + 2]];

  // The body is its biggest part; smaller parts may be glass.
  const { part, sizes } = partsOf(F, twins);
  let main = 0;
  sizes.forEach((s, i) => s > sizes[main] && (main = i));
  const closed = !twins.some((t, e) => t < 0 && part[Math.floor(e / 3)] === main);
  // The outside of the body: all of a single surface, the outer skin of a shell.
  const outer = new Uint8Array(F);
  if (closed) {
    // Each face on its own (spreading a label across the faces would leak
    // round the rims): the skin further out from the middle of the car than
    // the one right behind it is the outside. Then a little smoothing, so a
    // stray face does not make a rim of its own.
    const cast0 = rayCaster(P, T);
    const mid = b.min.map((v, k) => (v + b.max[k]) / 2);
    const half = b.size.map((x) => Math.max(x / 2, 1e-6));
    const reach = (p) => Math.hypot(...p.map((x, k) => (x - mid[k]) / half[k]));
    const gap = Math.hypot(...b.size) * 2e-4;
    const lab = new Uint8Array(F);
    for (let f = 0; f < F; f++) {
      if (part[f] !== main) continue;
      const c = cOf(f), back = nOf(f).map((x) => -x);
      const d = cast0(c.map((x, k) => x + back[k] * gap), back);
      lab[f] = d === Infinity || reach(c) >= reach(c.map((x, k) => x + back[k] * (d + gap))) ? 1 : 0;
    }
    for (let round = 0; round < 2; round++) {
      const prev = Uint8Array.from(lab);
      for (let f = 0; f < F; f++) {
        if (part[f] !== main) continue;
        let votes = prev[f], n = 1;
        for (let e = f * 3; e < f * 3 + 3; e++) {
          const t2 = twins[e];
          if (t2 < 0) continue;
          votes += prev[Math.floor(t2 / 3)];
          n++;
        }
        lab[f] = votes * 2 > n ? 1 : votes * 2 < n ? 0 : prev[f];
      }
    }
    for (let f = 0; f < F; f++) outer[f] = lab[f];
  } else for (let f = 0; f < F; f++) outer[f] = part[f] === main ? 1 : 0;

  const found = [];
  const cast = rayCaster(P, T);
  // A loop of corners as points, if it is a candidate: closed, big enough,
  // clear of the floor and the wheel arches (low on the body).
  const low = b.min[2] + height * 0.22;
  const accept = (pts) => {
    if (pts.length < 8) return false;
    let len = 0, zmin = Infinity;
    for (let i = 0; i < pts.length; i++) {
      len += Math.hypot(...sub(pts[(i + 1) % pts.length], pts[i]));
      zmin = Math.min(zmin, pts[i][2]);
    }
    return len >= o.minSize * 3 && zmin > low;
  };

  // ---- openings: where the outside ends (the rims of the outer skin)
  {
    const sub3 = [];
    for (let f = 0; f < F; f++) if (outer[f]) sub3.push(T[f * 3], T[f * 3 + 1], T[f * 3 + 2]);
    const idx = Uint32Array.from(sub3);
    const tw = pairEdges(idx, V, P).twins;
    // A scan's rims can run into each other through a panel gap (the
    // windscreen into the bonnet's): split where a loop pinches.
    for (const pts of boundaryLoops(idx, tw).flatMap((l) => splitPinches(l.map(pt)))) {
      if (!accept(pts)) continue;
      // The glass faces the way the outside round the rim does.
      const n = normalNear(pts, outer, nOf, cOf, A, F);
      // Really a hole: seen along its facing, rays through it go on past
      // where glass would be (a seam in the skin's labels is not).
      if (lookThrough(cast, pts, n) < 0.7) continue;
      found.push({ kind: 'opening', loop: pts, normal: n });
    }
  }

  // ---- glass parts: thin plates of their own
  for (let p = 0; p < sizes.length; p++) {
    if (p === main || sizes[p] < 8) continue;
    const partSize = (pts) => perimeter(pts) / Math.PI;
    const faces = [];
    for (let f = 0; f < F; f++) if (part[f] === p) faces.push(f);
    // Thin: its area-weighted normal spread is small, and its faces lie close to one curved sheet.
    let n = [0, 0, 0], c = [0, 0, 0], area = 0;
    for (const f of faces) {
      const s = A[f];
      area += s;
      for (let k = 0; k < 3; k++) c[k] += C[f * 3 + k] * s;
    }
    c = c.map((x) => x / area);
    // Facing out from the middle of the car.
    const mid = b.min.map((v, k) => (v + b.max[k]) / 2);
    const away = norm(sub(c, mid));
    for (const f of faces) {
      const fn = nOf(f);
      if (dot(fn, away) > 0) for (let k = 0; k < 3; k++) n[k] += fn[k] * A[f];
    }
    n = norm(n);
    // The outside of the plate: the faces facing that way.
    const front = faces.filter((f) => dot(nOf(f), n) > 0.3);
    if (!front.length) continue;
    let frontArea = 0;
    for (const f of front) frontArea += A[f];
    if (frontArea < area * 0.35) continue; // not a plate
    // Thin: much thinner than it is wide (its spread along its facing).
    let lo = Infinity, hi = -Infinity, wlo = Infinity, whi = -Infinity;
    const side = norm(cross(n, Math.abs(n[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0]));
    for (const f of faces) {
      const c2 = cOf(f);
      lo = Math.min(lo, dot(c2, n));
      hi = Math.max(hi, dot(c2, n));
      wlo = Math.min(wlo, dot(c2, side));
      whi = Math.max(whi, dot(c2, side));
    }
    if (hi - lo > Math.max(1.5, (whi - wlo) * 0.25)) continue;
    const idx = Uint32Array.from(front.flatMap((f) => [T[f * 3], T[f * 3 + 1], T[f * 3 + 2]]));
    const loops = boundaryLoops(idx, pairEdges(idx, V, P).twins).map((l) => l.map(pt));
    if (!loops.length) continue;
    const loop = loops.reduce((x, y) => (perimeter(y) > perimeter(x) ? y : x));
    if (accept(loop) && partSize(loop) >= o.minPart) found.push({ kind: 'part', loop, normal: n });
  }

  // ---- recessed panes: patches of the outside with a step up all round
  {
    const cosCrease = Math.cos((o.crease * Math.PI) / 180);
    const region = new Int32Array(F).fill(-1);
    const regions = [];
    for (let f0 = 0; f0 < F; f0++) {
      if (!outer[f0] || region[f0] >= 0) continue;
      const id = regions.length;
      const list = [f0];
      region[f0] = id;
      for (let i = 0; i < list.length; i++) {
        const f = list[i];
        for (let e = f * 3; e < f * 3 + 3; e++) {
          const t2 = twins[e];
          if (t2 < 0) continue;
          const g = Math.floor(t2 / 3);
          if (!outer[g] || region[g] >= 0) continue;
          if (dot(nOf(f), nOf(g)) < cosCrease) continue; // a crease
          region[g] = id;
          list.push(g);
        }
      }
      regions.push(list);
    }
    let outerArea = 0;
    for (let f = 0; f < F; f++) if (outer[f]) outerArea += A[f];
    for (const list of regions) {
      let area = 0;
      for (const f of list) area += A[f];
      if (area < o.minSize * o.minSize || area > outerArea * 0.2) continue;
      // Its edge: every crease edge to another part of the outside steps up
      // (the neighbour lies above the patch's plane there).
      let n = [0, 0, 0];
      for (const f of list) for (let k = 0; k < 3; k++) n[k] += N[f * 3 + k] * A[f];
      n = norm(n);
      const id = region[list[0]];
      let edges = 0, up = 0, open = 0, rise = [];
      for (const f of list)
        for (let e = f * 3; e < f * 3 + 3; e++) {
          const t2 = twins[e];
          if (t2 < 0) {
            open++;
            continue;
          }
          const g = Math.floor(t2 / 3);
          if (region[g] === id) continue;
          edges++;
          const h = dot(sub(cOf(g), cOf(f)), n);
          if (h > 0) up++;
          rise.push(h);
        }
      // Mostly up (where a pane meets the roof or the cowl it may step down a little).
      if (!edges || up < edges * 0.6 || open > edges * 0.25) continue;
      if (n[2] < -0.3) continue; // facing down: under the nose, not glass
      const idx = Uint32Array.from(list.flatMap((f) => [T[f * 3], T[f * 3 + 1], T[f * 3 + 2]]));
      const loops = boundaryLoops(idx, pairEdges(idx, V, P).twins).map((l) => l.map(pt));
      if (!loops.length) continue;
      const loop = loops.reduce((x, y) => (perimeter(y) > perimeter(x) ? y : x));
      if (!accept(loop)) continue;
      // There is glass there: rays find the surface about at the edge's plane.
      if (lookThrough(cast, loop, n) > 0.3) continue;
      found.push({ kind: 'recess', loop, normal: n, step: stepOf(cast, loop, n) });
    }
  }

  // ---- one window per glass: an opening inside a recessed frame is that
  // pane's (the frame's edge is where the glass goes)
  const centreOf = (pts) => pts.reduce((s, p) => [s[0] + p[0], s[1] + p[1], s[2] + p[2]], [0, 0, 0]).map((x) => x / pts.length);
  for (const w of found) w.centre = centreOf(w.loop);
  // A shell's opening has two rims, the outer skin's and the inner's a wall
  // in: the outer one counts.
  const keep = found.filter((w) => {
    const pw = perimeter(w.loop);
    if (w.kind === 'opening' && found.some((r) => r !== w && r.kind !== 'opening' && inside2(r, w.centre) && perimeter(r.loop) >= pw * 0.8)) return false;
    return !found.some((r) => {
      if (r === w || r.kind !== w.kind) return false;
      const pr = perimeter(r.loop);
      if (pr < pw * 0.7 || pr > pw / 0.7 || !inside2(r, w.centre) || !inside2(w, r.centre)) return false;
      const out = dot(r.centre, w.normal) - dot(w.centre, w.normal);
      return out > 1e-6 || (Math.abs(out) <= 1e-6 && pr > pw);
    });
  });

  // ---- left and right become one mirrored window
  const used = new Set();
  const out = [];
  for (const w of keep) {
    if (used.has(w)) continue;
    used.add(w);
    const size = perimeter(w.loop) / Math.PI;
    let twin = null;
    if (Math.abs(w.centre[1]) > Math.max(2, size * 0.1))
      twin = keep.find((x) => !used.has(x) && x.kind === w.kind && Math.hypot(x.centre[0] - w.centre[0], x.centre[1] + w.centre[1], x.centre[2] - w.centre[2]) < Math.max(2, size * 0.1));
    if (twin) used.add(twin);
    // The left one (y < 0) is kept, as drawing does; its twin is the mirror.
    const base = twin && twin.centre[1] < w.centre[1] ? twin : w;
    const shape = simplify(base.loop, base.normal, o.tolerance);
    if (!shape) continue;
    out.push({
      kind: base.kind,
      points: shape.points,
      corners: shape.corners,
      doubt: shape.doubt,
      normal: base.normal.map((x) => Math.round(x * 1e4) / 1e4),
      mirror: !!twin,
      centre: base.centre,
      size,
      step: base.step ?? 0,
      edge: twin ? [base.loop, (base === w ? twin : w).loop] : [base.loop],
      // In the glasshouse (above the belt, not facing down): likely glass.
      // Lower ones may be lights, a grille or a number plate.
      likely: base.centre[2] > b.min[2] + height * 0.55 && base.normal[2] > -0.2,
    });
  }
  out.sort((p, q) => p.centre[0] - q.centre[0]);
  return { found: out };
}

// Seen along a closed edge's facing, the share of rays through its middle
// that pass the edge's plane by more than a wall (nothing there: a hole).
function lookThrough(cast, loop, normal) {
  const n = norm(normal);
  const u = norm(cross(Math.abs(n[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0], n)), v = cross(n, u);
  const poly = loop.map((q) => [dot(q, u), dot(q, v)]);
  const s = loop.map((q) => dot(q, n));
  const s0 = s.reduce((a, b) => a + b, 0) / s.length;
  const sag = Math.max(...s.map((x) => Math.abs(x - s0)));
  let lo = [Infinity, Infinity], hi = [-Infinity, -Infinity];
  for (const [x, y] of poly) (lo = [Math.min(lo[0], x), Math.min(lo[1], y)]), (hi = [Math.max(hi[0], x), Math.max(hi[1], y)]);
  const inside = (x, y) => {
    let odd = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i], [xj, yj] = poly[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) odd = !odd;
    }
    return odd;
  };
  let tried = 0, through = 0;
  const G = 9;
  for (let a = 1; a < G; a++)
    for (let c = 1; c < G; c++) {
      const x = lo[0] + ((hi[0] - lo[0]) * a) / G, y = lo[1] + ((hi[1] - lo[1]) * c) / G;
      if (!inside(x, y)) continue;
      tried++;
      const top = s0 + sag + 5;
      const start = [0, 1, 2].map((k) => x * u[k] + y * v[k] + top * n[k]);
      const t = cast(start, n.map((q) => -q));
      if (!(t < Infinity) || top - t < s0 - sag - 1.5) through++;
    }
  return tried ? through / tried : 0;
}

// How far a pane sits below its frame: the outside a little outside its
// edge against a little inside, seen along its facing, round the edge.
function stepOf(cast, loop, normal) {
  const n = norm(normal);
  const c = loop.reduce((s, p) => [s[0] + p[0], s[1] + p[1], s[2] + p[2]], [0, 0, 0]).map((x) => x / loop.length);
  const steps = [];
  const every = Math.max(1, Math.floor(loop.length / 40));
  for (let i = 0; i < loop.length; i += every) {
    const p = loop[i];
    // Across the edge, in the pane's plane: towards the middle is in.
    let w = sub(c, p);
    w = sub(w, n.map((x) => x * dot(w, n)));
    const l = Math.hypot(...w);
    if (l < 1e-6) continue;
    w = w.map((x) => x / l);
    const at = (d) => {
      const q = p.map((x, k) => x + w[k] * d + n[k] * 5);
      const t = cast(q, n.map((x) => -x));
      return t < 15 ? 5 - t : NaN;
    };
    const inside = at(0.8), outside = at(-0.8);
    if (Number.isFinite(inside) && Number.isFinite(outside)) steps.push(outside - inside);
  }
  if (!steps.length) return 0;
  steps.sort((a, b) => a - b);
  return Math.max(0, steps[Math.floor(steps.length / 2)]);
}

// Where a closed edge comes back to within `gap` of itself from far along
// it, it is two loops joined by a narrow neck: split it there, and again in
// each half. Far: more than `far` along the edge either way.
export function splitPinches(pts, gap = 1.2, far = 12) {
  if (pts.length < 16) return [pts];
  // Distance along the edge at each point.
  const at = [0];
  for (let i = 1; i < pts.length; i++) at.push(at[i - 1] + Math.hypot(...sub(pts[i], pts[i - 1])));
  const L = at.at(-1) + Math.hypot(...sub(pts[0], pts.at(-1)));
  if (L < far * 2.5) return [pts];
  // Look only every so often, then on a grid of cells, for speed.
  const step = Math.max(1, Math.floor(pts.length / 4000));
  const cells = new Map();
  const key = (p) => p.map((x) => Math.floor(x / gap)).join(',');
  for (let i = 0; i < pts.length; i += step) {
    const k = key(pts[i]);
    if (!cells.has(k)) cells.set(k, []);
    cells.get(k).push(i);
  }
  let best = null;
  for (let i = 0; i < pts.length; i += step) {
    const p = pts[i];
    const c = p.map((x) => Math.floor(x / gap));
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dz = -1; dz <= 1; dz++)
          for (const j of cells.get([c[0] + dx, c[1] + dy, c[2] + dz].join(',')) ?? []) {
            if (j <= i) continue;
            const along = at[j] - at[i];
            if (along < far || L - along < far) continue;
            const d = Math.hypot(...sub(p, pts[j]));
            if (d > gap) continue;
            // The most even split first.
            const score = Math.min(along, L - along);
            if (!best || score > best.score) best = { i, j, score };
          }
  }
  if (!best) return [pts];
  const a = pts.slice(best.i, best.j + 1), b = [...pts.slice(best.j), ...pts.slice(0, best.i + 1)];
  return [...splitPinches(a, gap, far), ...splitPinches(b, gap, far)];
}

function perimeter(pts) {
  let l = 0;
  for (let i = 0; i < pts.length; i++) l += Math.hypot(...sub(pts[(i + 1) % pts.length], pts[i]));
  return l;
}

// Is a point inside a found outline, seen along its facing?
function inside2(w, p) {
  const n = w.normal;
  const u = norm(cross(Math.abs(n[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0], n)), v = cross(n, u);
  const poly = w.loop.map((q) => [dot(q, u), dot(q, v)]);
  const x = dot(p, u), y = dot(p, v);
  let odd = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) odd = !odd;
  }
  return odd;
}

// The mean facing of the outside round a rim: the faces of the outer skin
// within a few millimetres of it.
function normalNear(pts, outer, nOf, cOf, A, F) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const p of pts) for (let k = 0; k < 3; k++) (lo[k] = Math.min(lo[k], p[k])), (hi[k] = Math.max(hi[k], p[k]));
  const reach = 3;
  const sample = pts.filter((_, i) => i % Math.max(1, Math.floor(pts.length / 60)) === 0);
  let n = [0, 0, 0];
  for (let f = 0; f < F; f++) {
    if (!outer[f]) continue;
    const c = cOf(f);
    if (c.some((x, k) => x < lo[k] - reach || x > hi[k] + reach)) continue;
    if (!sample.some((p) => Math.hypot(...sub(p, c)) < reach)) continue;
    const fn = nOf(f);
    for (let k = 0; k < 3; k++) n[k] += fn[k] * A[f];
  }
  return norm(n);
}

// A found edge as a window outline: corners where it turns sharply, a few
// points between, more only where the smooth line through them strays from
// the edge by more than \`tol\`. doubt: spots where the outline bends inward
// sharply (a dent), which a window seldom does.
export function simplify(loop, normal, tol = 0.15) {
  const n = norm(normal);
  const u = norm(cross(Math.abs(n[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0], n)), v = cross(n, u);
  // Evenly spaced, about every half millimetre, without spurs (where the
  // edge runs out and straight back, a stray face at the rim).
  // Smoothed a little (over about a millimetre, back and forth so it does
  // not shrink), so a scan's grain makes no corners or extra points.
  const dense = smoothLoop(despur(resample(loop, 0.5)), 4);
  const m = dense.length;
  if (m < 12) return null;
  const flat = dense.map((p) => [dot(p, u), dot(p, v)]);
  let area = 0;
  for (let i = 0; i < m; i++) area += flat[i][0] * flat[(i + 1) % m][1] - flat[(i + 1) % m][0] * flat[i][1];
  const sg = area >= 0 ? 1 : -1;
  // Turning at each point, over about 1.5 mm either side.
  const k = 3;
  const turn = flat.map((p, i) => {
    const a = flat[(i - k + m) % m], c = flat[(i + k) % m];
    const d1 = [p[0] - a[0], p[1] - a[1]], d2 = [c[0] - p[0], c[1] - p[1]];
    return Math.atan2(d1[0] * d2[1] - d1[1] * d2[0], d1[0] * d2[0] + d1[1] * d2[1]) * sg;
  });
  // Corners: a sharp turn, the sharpest round it.
  const isCorner = turn.map((t, i) => Math.abs(t) > (40 * Math.PI) / 180 && [1, 2, 3].every((d) => Math.abs(t) >= Math.abs(turn[(i + d) % m]) && Math.abs(t) >= Math.abs(turn[(i - d + m) % m])));
  let picks = [];
  isCorner.forEach((c, i) => c && picks.push(i));
  // Between corners (or round a smooth loop), points every few millimetres.
  const len = m * 0.5;
  const seg = Math.max(4, Math.min(12, len / 12));
  const starts = picks.length ? picks : [0];
  const all = new Set(starts);
  for (let s = 0; s < starts.length; s++) {
    const a = starts[s], b2 = starts[(s + 1) % starts.length];
    const span = ((b2 - a + m) % m || m) * 0.5;
    const count = Math.max(1, Math.round(span / seg));
    for (let c = 1; c < count; c++) all.add((a + Math.round((c * span) / count / 0.5)) % m);
  }
  picks = [...all].sort((x, y) => x - y);
  // More points where the smooth line strays from the edge.
  for (let round = 0; round < 6 && picks.length < 80; round++) {
    const pts = picks.map((i) => dense[i]);
    const cn = picks.map((i) => isCorner[i]);
    const curve = sampleClosedCurve(pts, cn, 0.25);
    let added = 0;
    const extra = [];
    for (let s = 0; s < picks.length; s++) {
      const a = picks[s], b2 = picks[(s + 1) % picks.length];
      const span = (b2 - a + m) % m || m;
      let worst = 0, at = -1;
      for (let j = 1; j < span; j++) {
        const q = dense[(a + j) % m];
        let best = Infinity;
        for (const c of curve) best = Math.min(best, Math.hypot(q[0] - c[0], q[1] - c[1], q[2] - c[2]));
        if (best > worst) (worst = best), (at = (a + j) % m);
      }
      if (worst > tol && at >= 0) extra.push(at), added++;
    }
    if (!added) break;
    picks = [...new Set([...picks, ...extra])].sort((x, y) => x - y);
  }
  // A corner where the edge itself turns sharpest (the even spacing may
  // have stepped over it): the original point nearby that turns most.
  const turnAt = (j) => {
    const L = loop.length;
    const walk = (dir) => {
      let d = 0, k2 = j;
      while (d < 1 && Math.abs(k2 - j) < L) {
        const n2 = (k2 + dir + L) % L;
        d += Math.hypot(...sub(loop[n2], loop[(k2 + L) % L]));
        k2 += dir;
      }
      return loop[(k2 + L * 4) % L];
    };
    const a = walk(-1), c = walk(1), p = loop[j];
    const d1 = [dot(sub(p, a), u), dot(sub(p, a), v)], d2 = [dot(sub(c, p), u), dot(sub(c, p), v)];
    return Math.abs(Math.atan2(d1[0] * d2[1] - d1[1] * d2[0], d1[0] * d2[0] + d1[1] * d2[1]));
  };
  for (const i of picks) {
    if (!isCorner[i]) continue;
    let best = -1, bt = -1;
    loop.forEach((q, j) => {
      if (Math.hypot(...sub(q, dense[i])) > 1.5) return;
      const t = turnAt(j);
      if (t > bt) (bt = t), (best = j);
    });
    if (best >= 0) dense[i] = loop[best].slice();
    // A corner the mesh cut off (a chamfer): where the straight runs either
    // side of it meet, if that is close by.
    const run = (dir) => {
      const pts = [];
      for (let j = 4; j <= 14; j++) pts.push(flat[(i + dir * j + m * 4) % m]);
      const c0 = pts.reduce((q, p) => [q[0] + p[0], q[1] + p[1]], [0, 0]).map((x) => x / pts.length);
      let sxx = 0, sxy = 0, syy = 0;
      for (const p of pts) {
        const dx = p[0] - c0[0], dy = p[1] - c0[1];
        sxx += dx * dx;
        sxy += dx * dy;
        syy += dy * dy;
      }
      const a = 0.5 * Math.atan2(2 * sxy, sxx - syy);
      return { c: c0, d: [Math.cos(a), Math.sin(a)] };
    };
    const A1 = run(-1), A2 = run(1);
    const det = A1.d[0] * -A2.d[1] - A1.d[1] * -A2.d[0];
    if (Math.abs(det) > 0.3) {
      const rx = A2.c[0] - A1.c[0], ry = A2.c[1] - A1.c[1];
      const t = (rx * -A2.d[1] - ry * -A2.d[0]) / det;
      const q = [A1.c[0] + A1.d[0] * t, A1.c[1] + A1.d[1] * t];
      const p = dense[i];
      const px = dot(p, u), py = dot(p, v);
      if (Math.hypot(q[0] - px, q[1] - py) < 3) dense[i] = [0, 1, 2].map((k) => p[k] + (q[0] - px) * u[k] + (q[1] - py) * v[k]);
    }
  }
  const points = picks.map((i) => dense[i].map((x) => Math.round(x * 1000) / 1000));
  const corners = picks.map((i) => isCorner[i]);
  // Dents: the outline turning inward, sharply and over a short stretch.
  const doubt = [];
  for (let i = 0; i < m; i++)
    if (turn[i] < (-20 * Math.PI) / 180 && turn[i] <= turn[(i + 1) % m] && turn[i] <= turn[(i - 1 + m) % m]) {
      const p = dense[i];
      if (!doubt.some((q) => Math.hypot(...sub(p, q)) < 3)) doubt.push(p.map((x) => Math.round(x * 1000) / 1000));
    }
  return { points, corners, doubt };
}

function smoothLoop(pts, rounds) {
  let p = pts;
  const m = p.length;
  for (let r = 0; r < rounds; r++)
    for (const w of [0.5, -0.53]) {
      p = p.map((q, i) => {
        const a = p[(i - 1 + m) % m], b = p[(i + 1) % m];
        return q.map((x, k) => x + w * ((a[k] + b[k]) / 2 - x));
      });
    }
  return p;
}

// Out and straight back again: a spur. Its points go, its ends stay.
function despur(pts) {
  let p = pts;
  for (let k = 20; k >= 2; k--) {
    let changed = true;
    while (changed && p.length > 8 * k) {
      changed = false;
      const m = p.length;
      for (let i = 0; i < m; i++) {
        const a = p[i], b = p[(i + 2 * k) % m], tip = p[(i + k) % m];
        const across = Math.hypot(...sub(a, b)), out = Math.hypot(...sub(tip, a));
        if (out > 0.8 && across < out * 0.35) {
          // Take out the points between a and b.
          const keep = [];
          for (let j = 0; j < m; j++) {
            const d = (j - i + m) % m;
            if (d === 0 || d >= 2 * k) keep.push(p[j]);
          }
          p = keep;
          changed = true;
          break;
        }
      }
    }
  }
  return p;
}

function resample(loop, step) {
  const L = perimeter(loop);
  const n = Math.max(12, Math.round(L / step));
  const out = [];
  let i = 0, t = 0;
  const seg = (j) => Math.hypot(...sub(loop[(j + 1) % loop.length], loop[j]));
  let acc = 0;
  for (let k = 0; k < n; k++) {
    const want = (k * L) / n;
    while (acc + seg(i) < want && i < loop.length - 1) acc += seg(i++);
    const s = seg(i) || 1;
    t = (want - acc) / s;
    const a = loop[i], b = loop[(i + 1) % loop.length];
    out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
  }
  return out;
}
