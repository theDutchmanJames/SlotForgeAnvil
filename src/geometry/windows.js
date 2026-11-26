// Windows: outlines drawn on the body with the surface curve tool. An open
// window is cut straight through the wall, along the direction the window
// faces, and the cut is closed with a strip between the outer and the inner
// skin. A solid window is only an outline (for the buck's trim guides).
// Car frame: X along (front low), Y across (centre line 0), Z up.
import { clip } from './arches.js';
import { mirrorPoint, sampleClosedCurve } from './curve.js';
import { boundaryLoops, pairEdges } from './topology.js';

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => {
  const l = Math.hypot(...a);
  return l ? a.map((x) => x / l) : a;
};

// Every outline that is really there: each window, and its mirror image when
// the window is mirrored. { window, mirrored, points (closed curve), normal }
export function windowOutlines(windows = [], step = 0.4) {
  const out = [];
  for (const w of windows) {
    if (!(w.points?.length >= 3)) continue;
    const points = sampleClosedCurve(w.points, w.corners, step);
    out.push({ window: w, mirrored: false, points, normal: w.normal });
    if (w.mirror) out.push({ window: w, mirrored: true, points: points.map(mirrorPoint).reverse(), normal: mirrorPoint(w.normal) });
  }
  return out;
}

// The cutter of one outline: a 2D shape across the cutting direction d, and
// how deep it reaches. Depth is measured along d (into the car) from a plane
// fitted through the outline, so a curved windscreen is cut whole while the
// window on the far side of the car is left alone.
export function cutter(points, normal, depth) {
  const d = norm(normal.map((x) => -x));
  const ref = Math.abs(d[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  const u = norm(cross(ref, d)), v = cross(d, u);
  const poly = points.map((p) => [dot(p, u), dot(p, v)]);
  const s = points.map((p) => dot(p, d));
  // Least-squares plane s = a + b*u + c*v.
  const M = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], r = [0, 0, 0];
  poly.forEach(([x, y], i) => {
    const row = [1, x, y];
    for (let a = 0; a < 3; a++) {
      r[a] += row[a] * s[i];
      for (let b = 0; b < 3; b++) M[a][b] += row[a] * row[b];
    }
  });
  const plane = solve3(M, r) ?? [s.reduce((a, b) => a + b, 0) / s.length, 0, 0];
  const at = (x, y) => plane[0] + plane[1] * x + plane[2] * y;
  let resid = 0;
  poly.forEach(([x, y], i) => (resid = Math.max(resid, Math.abs(s[i] - at(x, y)))));
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [x, y] of poly) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  const size = Math.max(maxX - minX, maxY - minY);
  const lo = -(resid + size * 0.15 + 0.5), hi = resid + depth;
  // Positive inside the shape, by the distance to its edge.
  const inside2d = (x, y) => {
    if (x < minX - 1 || x > maxX + 1 || y < minY - 1 || y > maxY + 1) return -1;
    let best = Infinity, odd = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i], [xj, yj] = poly[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) odd = !odd;
      const ex = xi - xj, ey = yi - yj;
      const t = Math.max(0, Math.min(1, ((x - xj) * ex + (y - yj) * ey) / (ex * ex + ey * ey || 1)));
      best = Math.min(best, Math.hypot(x - xj - t * ex, y - yj - t * ey));
    }
    return odd ? best : -best;
  };
  // > 0 where the cutter takes material away.
  const f = (p) => {
    const x = dot(p, u), y = dot(p, v);
    const k = inside2d(x, y);
    if (k <= 0) return k;
    const z = dot(p, d) - at(x, y);
    return Math.min(k, z - lo, hi - z);
  };
  return { f, inside2d, u, v, d, at, lo, hi, size, poly };
}

function solve3(M, r) {
  const [[a, b, c], [d, e, f], [g, h, i]] = M;
  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  if (Math.abs(det) < 1e-9) return null;
  const col = (k) => M.map((row, j) => row.map((x, m) => (m === k ? r[j] : x)));
  const d3 = (N) => N[0][0] * (N[1][1] * N[2][2] - N[1][2] * N[2][1]) - N[0][1] * (N[1][0] * N[2][2] - N[1][2] * N[2][0]) + N[0][2] * (N[1][0] * N[2][1] - N[1][1] * N[2][0]);
  return [0, 1, 2].map((k) => d3(col(k)) / det);
}

// params: { windows: [{ id, name, points, corners, normal, mirror, open }], depth }
//   depth: how far behind the outline the cut reaches (wall + room to spare)
// fine: see clip (on for windows drawn now, off for those saved before).
export function applyWindows(mesh, { windows = [], depth = 3, fine = false }) {
  let m = mesh;
  const report = [];
  for (const o of windowOutlines(windows.filter((w) => w.open !== false))) {
    const name = `${o.window.name}${o.mirrored ? ' (mirrored)' : ''}`;
    const c = cutter(o.points, o.normal, depth);
    const out = clip(m, c.f, fine);
    if (!out.removed) {
      report.push({ name, text: 'The outline is not on the body' });
      continue;
    }
    // The two new edges: on the outer skin and on the inner skin.
    const { twins } = pairEdges(out.indices, out.positions.length / 3, out.positions);
    const tol = Math.max(1e-3, c.size * 1e-5);
    const onCut = (v) => {
      const p = [out.positions[v * 3], out.positions[v * 3 + 1], out.positions[v * 3 + 2]];
      return Math.abs(c.inside2d(dot(p, c.u), dot(p, c.v))) < tol;
    };
    const loops = boundaryLoops(out.indices, twins).filter((l) => l.filter(onCut).length >= l.length * 0.8);
    const closed = closeCut(out, loops, c);
    m = closed.mesh;
    if (closed.error) report.push({ name, text: closed.error });
    else report.push({ name, ok: true });
  }
  return { positions: m.positions, indices: m.indices, info: { cut: report.filter((r) => r.ok).length, warnings: report.filter((r) => !r.ok).map((r) => `${r.name}: ${r.text}`) } };
}

// Close the cut. Every new edge lies on the cutter's side wall, so the wall
// is unrolled flat: t runs round the outline, s goes into the car. A loop that
// runs once round the window (an outer or an inner skin) is zipped to one
// running the other way; a loop that does not (where the skins touch, at a
// crease, the outer and inner edges join up) is a flat shape there and is
// filled as it lies.
function closeCut(mesh, loops, c) {
  const P = mesh.positions;
  const poly = c.poly;
  const seg = [0];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    seg.push(seg[i] + Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  const T = seg[poly.length];
  const tAt = (x, y) => {
    let best = Infinity, t = 0;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      const ex = b[0] - a[0], ey = b[1] - a[1];
      const k = Math.max(0, Math.min(1, ((x - a[0]) * ex + (y - a[1]) * ey) / (ex * ex + ey * ey || 1)));
      const dd = Math.hypot(x - a[0] - k * ex, y - a[1] - k * ey);
      if (dd < best) (best = dd), (t = seg[i] + k * (seg[i + 1] - seg[i]));
    }
    return t;
  };
  const flat = loops.map((l) => {
    let prev = null, shift = 0;
    const ts = l.map((v) => {
      const p = [P[v * 3], P[v * 3 + 1], P[v * 3 + 2]];
      let t = tAt(dot(p, c.u), dot(p, c.v));
      if (prev != null) {
        while (t + shift - prev > T / 2) shift -= T;
        while (t + shift - prev < -T / 2) shift += T;
      }
      prev = t + shift;
      return [t + shift, dot(p, c.d)];
    });
    // The last step back to the start, then: how many times round?
    let back = ts[0][0] - prev;
    while (back > T / 2) back -= T;
    while (back < -T / 2) back += T;
    return { loop: l, ts, winding: Math.round((prev + back - ts[0][0]) / T) };
  });
  if (!flat.length) return { mesh, error: 'The outline is not on the body' };
  const faces = [];
  const ring = flat.filter((f) => f.winding !== 0);
  for (const f of flat.filter((f) => f.winding === 0)) {
    const tri = earClip(f.ts);
    if (!tri) return { mesh, error: 'The cut edge could not be closed here; it is left open' };
    for (const k of tri) faces.push(f.loop[k]);
  }
  const plus = ring.filter((f) => f.winding === 1), minus = ring.filter((f) => f.winding === -1);
  if (plus.length !== minus.length || plus.length + minus.length !== ring.length)
    return {
      mesh,
      error: ring.length === 1 ? 'Cut through one skin only: the wall is thicker than the cutting depth, or the body is solid (hollow it first)' : 'The cut met more than the wall (an inside part?); its edge is left open',
    };
  // Pair each outer loop with the inner loop nearest to it in depth.
  const left = minus.slice();
  const depthOf = (f) => f.ts.reduce((s, x) => s + x[1], 0) / f.ts.length;
  for (const a of plus) {
    left.sort((x, y) => Math.abs(depthOf(x) - depthOf(a)) - Math.abs(depthOf(y) - depthOf(a)));
    faces.push(...zip(P, a.loop, left.shift().loop));
  }
  const idx = new Uint32Array(mesh.indices.length + faces.length);
  idx.set(mesh.indices);
  idx.set(faces, mesh.indices.length);
  return { mesh: { positions: mesh.positions, indices: idx } };
}

// Ear clipping of a flat polygon given as [[x, y], ...]. Triangles keep the
// polygon's own order. Returns corner numbers, or null.
function earClip(pts) {
  const n = pts.length;
  if (n < 3) return null;
  let area = 0;
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    area += a[0] * b[1] - b[0] * a[1];
  }
  const sign = area >= 0 ? 1 : -1;
  const cr = (a, b, c) => ((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) * sign;
  const inTri = (p, a, b, c) => cr(a, b, p) > 1e-12 && cr(b, c, p) > 1e-12 && cr(c, a, p) > 1e-12;
  const idx = [...Array(n).keys()];
  const out = [];
  let guard = 0;
  while (idx.length > 3 && guard++ < n * n) {
    let best = -1, bestScore = -Infinity;
    for (let k = 0; k < idx.length; k++) {
      const ia = idx[(k + idx.length - 1) % idx.length], ib = idx[k], ic = idx[(k + 1) % idx.length];
      const a = pts[ia], b = pts[ib], c = pts[ic];
      const w = cr(a, b, c);
      if (w < -1e-12) continue;
      let blocked = false;
      for (const j of idx) {
        if (j === ia || j === ib || j === ic) continue;
        if (inTri(pts[j], a, b, c)) {
          blocked = true;
          break;
        }
      }
      if (blocked) continue;
      // Prefer well-shaped ears.
      const l = Math.hypot(a[0] - c[0], a[1] - c[1]);
      const score = w / (l * l + 1e-12);
      if (score > bestScore) (bestScore = score), (best = k);
    }
    if (best < 0) return null;
    const ia = idx[(best + idx.length - 1) % idx.length], ib = idx[best], ic = idx[(best + 1) % idx.length];
    out.push(ia, ib, ic);
    idx.splice(best, 1);
  }
  out.push(idx[0], idx[1], idx[2]);
  return out;
}

// A strip of triangles between two loops running round the same opening.
// Loops come from boundaryLoops (each runs the way a new face must run along
// it); the second one is walked backwards, so both go the same way round.
function zip(P, A, Bloop) {
  const pt = (v) => [P[v * 3], P[v * 3 + 1], P[v * 3 + 2]];
  let B = Bloop.slice().reverse();
  // Start B at the point nearest A's first point.
  const a0 = pt(A[0]);
  let best = 0, bd = Infinity;
  B.forEach((v, j) => {
    const p = pt(v);
    const dd = Math.hypot(p[0] - a0[0], p[1] - a0[1], p[2] - a0[2]);
    if (dd < bd) (bd = dd), (best = j);
  });
  B = [...B.slice(best), ...B.slice(0, best)];
  const len = (x, y) => {
    const p = pt(x), q = pt(y);
    return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
  };
  const nA = A.length, nB = B.length;
  const faces = [];
  let i = 0, j = 0;
  while (i < nA || j < nB) {
    const ai = A[i % nA], ai1 = A[(i + 1) % nA], bj = B[j % nB], bj1 = B[(j + 1) % nB];
    const takeA = j >= nB || (i < nA && len(ai1, bj) <= len(ai, bj1));
    if (takeA) {
      faces.push(ai, ai1, bj);
      i++;
    } else {
      faces.push(bj1, bj, ai);
      j++;
    }
  }
  return faces;
}

// Pillars: where two window outlines come closer than `min`.
export function pillarWarnings(windows, min = 1.5) {
  const list = windowOutlines(windows, 0.6);
  const out = [];
  for (let a = 0; a < list.length; a++)
    for (let b = a + 1; b < list.length; b++) {
      let d = Infinity;
      for (const p of list[a].points)
        for (const q of list[b].points) d = Math.min(d, Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]));
      if (d < min) {
        const n = (o) => `${o.window.name}${o.mirrored ? ' (mirrored)' : ''}`;
        out.push({ a: list[a].window.id, b: list[b].window.id, distance: d, text: `Only ${d.toFixed(2)} mm between ${n(list[a])} and ${n(list[b])}` });
      }
    }
  return out;
}
