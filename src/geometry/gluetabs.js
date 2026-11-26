// Glue tabs: small strips on the inside of the wall at a cut, fused to one
// piece and sticking out past the cut, so the other piece's wall slides over
// them when the two are glued back together. They line the pieces up and give
// the glue more to hold on to than the thin edge of the wall.
//
// A cut is given by its frame { c, n, u, v }: c a point on the plane, n its
// normal pointing from this piece to the other one, u and v along the plane.
import { Vector2 } from 'three';
import { rayCaster } from './rays.js';
import { boundaryLoops, pairEdges } from './topology.js';

export const GLUE_DEFAULTS = { width: 6, reach: 4, thick: 0.8, clearance: 0.15 };

// How far the tab runs back into its own piece, and into its wall.
const ANCHOR = 3, EMBED = 0.4;

const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

// The inside edge of the cut: where the wall's cut faces the hollow of the
// body, as runs of points along it. piece: this piece, cut and still open at
// the plane. model: the whole model before the cut (to tell inside from out).
export function insideEdges(piece, model, frame) {
  const P = piece.positions;
  const { c, n, u, v } = frame;
  const tol = 1e-4 * Math.max(1, Math.hypot(...c)) + 1e-5;
  const on = (i) => Math.abs((P[i * 3] - c[0]) * n[0] + (P[i * 3 + 1] - c[1]) * n[1] + (P[i * 3 + 2] - c[2]) * n[2]) < tol;
  const { twins } = pairEdges(piece.indices, P.length / 3, P);
  const loops = boundaryLoops(piece.indices, twins).filter((l) => l.every(on));
  const flat = (i) => {
    const r = [P[i * 3] - c[0], P[i * 3 + 1] - c[1], P[i * 3 + 2] - c[2]];
    return new Vector2(dot3(r, u), dot3(r, v));
  };
  const polys = loops.map((l) => l.map(flat));
  // Inside the wall's cut (an odd number of outlines round the point)?
  const material = (p) => {
    let odd = false;
    for (const ring of polys)
      for (let a = 0, b = ring.length - 1; a < ring.length; b = a++)
        if (ring[a].y > p.y !== ring[b].y > p.y && p.x < ((ring[b].x - ring[a].x) * (p.y - ring[a].y)) / (ring[b].y - ring[a].y) + ring[a].x) odd = !odd;
    return odd;
  };
  const cast = rayCaster(model.positions, model.indices);
  const to3 = (p) => [c[0] + p.x * u[0] + p.y * v[0], c[1] + p.x * u[1] + p.y * v[1], c[2] + p.x * u[2] + p.y * v[2]];
  const dir3 = (m) => [m.x * u[0] + m.y * v[0], m.x * u[1] + m.y * v[1], m.x * u[2] + m.y * v[2]];
  const runs = [];
  for (const ring of polys) {
    const N = ring.length;
    // Each edge: the side away from the wall, and whether that is the hollow.
    const edges = ring.map((a, i) => {
      const b = ring[(i + 1) % N];
      const t = b.clone().sub(a);
      const len = t.length();
      if (len < 1e-9) return { inside: false, len, m: new Vector2() };
      t.divideScalar(len);
      let m = new Vector2(t.y, -t.x);
      const mid = a.clone().add(b).multiplyScalar(0.5);
      if (material(mid.clone().addScaledVector(m, Math.min(0.02, len * 0.25)))) m.negate();
      // The hollow: looking out from there across the cut, fanned out to 80°
      // either way, most looks meet the body again (the other side, the
      // roof). From the outside of the wall they go off into the open.
      const from = to3(mid.clone().addScaledVector(m, 0.05));
      let hits = 0;
      for (let deg = -80; deg <= 80; deg += 20) {
        const a = (deg * Math.PI) / 180;
        const d = new Vector2(m.x * Math.cos(a) - m.y * Math.sin(a), m.x * Math.sin(a) + m.y * Math.cos(a));
        if (Number.isFinite(cast(from, dir3(d)))) hits++;
      }
      return { inside: hits >= 5, len, m };
    });
    // Runs of inside edges, started just after an outside one (if any).
    const start = Math.max(0, edges.findIndex((e) => !e.inside));
    const all = edges.every((e) => e.inside);
    let cur = null;
    for (let s = 0; s < N; s++) {
      const i = (start + s) % N;
      const e = edges[i];
      if (!e.inside) {
        if (cur) runs.push(cur), (cur = null);
        continue;
      }
      if (!cur) cur = { pts: [ring[i].clone()], ms: [e.m.clone()], len: 0, closed: false };
      cur.pts.push(ring[(i + 1) % N].clone());
      cur.ms.push(e.m.clone());
      cur.len += e.len;
    }
    if (cur) runs.push(Object.assign(cur, { closed: all }));
  }
  // The side away from the wall at each point: the average of its two edges.
  for (const r of runs) {
    const ms = r.ms;
    r.normals = r.pts.map((_, i) => {
      const a = ms[Math.max(0, i - 1)] ?? ms[i], b = ms[Math.min(ms.length - 1, i)];
      const s = a.clone().add(b);
      return s.lengthSq() > 1e-12 ? s.normalize() : b.clone();
    });
  }
  return { runs: runs.filter((r) => r.len > 1e-6), total: runs.reduce((s, r) => s + r.len, 0), to3, dir3 };
}

// A point along a run, `at` from its start: where, and which way is the hollow.
function along(run, at) {
  let s = 0;
  for (let i = 0; i + 1 < run.pts.length; i++) {
    const a = run.pts[i], b = run.pts[i + 1];
    const l = a.distanceTo(b);
    if (s + l >= at || i + 2 === run.pts.length) {
      const t = l > 0 ? Math.min(1, Math.max(0, (at - s) / l)) : 0;
      const m = run.normals[i].clone().lerp(run.normals[i + 1], t).normalize();
      return { p: a.clone().lerp(b, t), m };
    }
    s += l;
  }
  return { p: run.pts[0].clone(), m: run.normals[0].clone() };
}

// A closed block swept along a path: at each sample point p with hollow
// direction m, the rectangle [m0, m1] (out from the wall) × [n0, n1] (along n).
function sweep(samples, [m0, m1], [n0, n1], edge, n) {
  const pos = [], idx = [];
  for (const { p, m } of samples) {
    const base = edge.to3(p), dm = edge.dir3(m);
    for (const [a, b] of [[m0, n0], [m1, n0], [m1, n1], [m0, n1]]) pos.push(...[0, 1, 2].map((k) => base[k] + dm[k] * a + n[k] * b));
  }
  const S = samples.length;
  for (let s = 0; s + 1 < S; s++)
    for (let k = 0; k < 4; k++) {
      const a = s * 4 + k, b = s * 4 + ((k + 1) % 4), c2 = (s + 1) * 4 + ((k + 1) % 4), d = (s + 1) * 4 + k;
      idx.push(a, b, c2, a, c2, d);
    }
  // The two ends.
  idx.push(0, 2, 1, 0, 3, 2);
  const e = (S - 1) * 4;
  idx.push(e, e + 1, e + 2, e, e + 2, e + 3);
  let vol = 0;
  for (let f = 0; f < idx.length; f += 3) {
    const [a, b, c2] = [idx[f] * 3, idx[f + 1] * 3, idx[f + 2] * 3];
    vol += pos[a] * (pos[b + 1] * pos[c2 + 2] - pos[b + 2] * pos[c2 + 1]) - pos[a + 1] * (pos[b] * pos[c2 + 2] - pos[b + 2] * pos[c2]) + pos[a + 2] * (pos[b] * pos[c2 + 1] - pos[b + 1] * pos[c2]);
  }
  if (vol < 0) for (let f = 0; f < idx.length; f += 3) [idx[f + 1], idx[f + 2]] = [idx[f + 2], idx[f + 1]];
  return { positions: pos, indices: idx };
}

// Tabs at positions s (0..1 along all of the cut's inside edge). Each tab is
// two closed blocks: one fused into this piece's wall, and the strip that
// sticks out past the cut, a clearance away from where the other wall goes.
export function glueTabs(piece, model, frame, tabs, shape = {}) {
  const o = { ...GLUE_DEFAULTS, ...shape };
  const edge = insideEdges(piece, model, frame);
  const warnings = [];
  const pieces = [], placed = [];
  if (!tabs.length) return { pieces, placed, warnings, edge };
  if (!edge.runs.length) {
    warnings.push('No inside edge on this cut for glue tabs: they go on the inside of a hollow body.');
    return { pieces, placed, warnings, edge };
  }
  tabs.forEach((t, i) => {
    let at = (((t.s % 1) + 1) % 1) * edge.total;
    let run = edge.runs[0];
    for (const r of edge.runs) {
      run = r;
      if (at <= r.len) break;
      at -= r.len;
    }
    let w = o.width;
    if (run.len < w) {
      warnings.push(`Glue tab ${i + 1} is narrowed to ${run.len.toFixed(1)} mm: the inside edge is no longer there`);
      w = run.len;
    }
    if (w < 0.5) return;
    // Keep the tab on its run (a closed run may wrap round).
    if (!run.closed) at = Math.min(Math.max(at, w / 2), run.len - w / 2);
    const steps = Math.max(2, Math.ceil(w / 0.4));
    const samples = [];
    for (let k = 0; k <= steps; k++) {
      let a = at - w / 2 + (w * k) / steps;
      if (run.closed) a = ((a % run.len) + run.len) % run.len;
      samples.push(along(run, a));
    }
    // Fused part: from inside the wall out to the strip's far face, back into this piece.
    pieces.push(sweep(samples, [-EMBED, o.clearance + o.thick], [-ANCHOR, 0], edge, frame.n));
    // The strip: a clearance off the wall, out past the cut.
    pieces.push(sweep(samples, [o.clearance, o.clearance + o.thick], [-ANCHOR, o.reach], edge, frame.n));
    const mid = along(run, at);
    placed.push({ at: edge.to3(mid.p), s: t.s });
  });
  return { pieces, placed, warnings, edge };
}

// n tabs spread evenly along the inside edge.
export const spreadTabs = (n) => Array.from({ length: n }, (_, i) => ({ s: Math.round(((i + 0.5) / n) * 1e4) / 1e4 }));
