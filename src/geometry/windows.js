// Windows: outlines drawn on the body with the surface curve tool. An open
// window is cut straight through the wall, along the direction the window
// faces, and the cut is closed with a strip between the outer and the inner
// skin. A solid window is only an outline (for the buck's trim guides).
// Where an open window's glass sits (see glassOf) changes the cut: glass on
// the outside overlaps the body, so the hole is the outline made smaller by
// the overlap; flush and set-in glass also gets a rebate, the outside inside
// the outline sunk by the glass thickness and its set-back, with the wall
// behind it thickened where it would get too thin.
// Car frame: X along (front low), Y across (centre line 0), Z up.
import { clip } from './arches.js';
import { offsetOutline } from './lenses.js';
import { rayCaster } from './rays.js';
import { mirrorPoint, sampleClosedCurve } from './curve.js';
import { applyText, refine } from './detail.js';
import { fillLoop } from './fill.js';
import { boundaryLoops, joinMeshes, pairEdges, partsOf } from './topology.js';

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
  // Positive inside the shape, by the distance to its edge: exact within a
  // grid cell of the edge, at least a cell further off (the cut only needs
  // the sign there). Segments are kept per cell (for the distance) and per
  // row (for inside or out), so a long outline stays quick on a fine mesh.
  const cell = Math.max(0.3, size / 48);
  const gx = Math.ceil((maxX - minX) / cell) + 3, gy = Math.ceil((maxY - minY) / cell) + 3;
  const cx = (x) => Math.floor((x - minX) / cell) + 1, cy = (y) => Math.floor((y - minY) / cell) + 1;
  const cells = new Map(), rows = Array.from({ length: gy }, () => []);
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    for (let r = Math.max(0, cy(Math.min(yi, yj))); r <= Math.min(gy - 1, cy(Math.max(yi, yj))); r++) rows[r].push(j);
    for (let a = cx(Math.min(xi, xj)) - 1; a <= cx(Math.max(xi, xj)) + 1; a++)
      for (let r = cy(Math.min(yi, yj)) - 1; r <= cy(Math.max(yi, yj)) + 1; r++) {
        const k = a * gy + r;
        if (!cells.has(k)) cells.set(k, []);
        cells.get(k).push(j);
      }
  }
  const inside2d = (x, y) => {
    if (x < minX - 1 || x > maxX + 1 || y < minY - 1 || y > maxY + 1) return -1;
    const r = cy(y);
    let odd = false;
    for (const j of rows[Math.max(0, Math.min(gy - 1, r))] ?? []) {
      const [xj, yj] = poly[j], [xi, yi] = poly[(j + 1) % poly.length];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) odd = !odd;
    }
    let best = cell;
    for (const j of cells.get(cx(x) * gy + r) ?? []) {
      const [xj, yj] = poly[j], [xi, yi] = poly[(j + 1) % poly.length];
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
  inside2d.cell = cell;
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

// What a window does. Saved before `state` existed: open, or solid (open: false).
//   open:   cut through the wall
//   solid:  only an outline (for the buck)
//   fill:   close an opening the model came with: a pane in the outline
//   recess: sink the glass a fraction, for a crisp painted window
export const windowState = (w) => w.state ?? (w.open === false ? 'solid' : 'open');

// Where an open window's glass sits:
//   inside: behind the wall, glued in from inside (the opening is the outline)
//   flush:  in a rebate on the outside, its face level with the body
//   top:    on the outside, standing proud by its thickness
//   setin:  in a stepped seat: a flange in the rebate and a plug filling the
//           opening, a press fit
// depth: how far the glass face sits back from the body's outside (0: flush).
export const GLASS_KINDS = ['inside', 'flush', 'top', 'setin'];
export const GLASS_DEFAULTS = { glassThick: 1, overlap: 1.5, minWall: 0.6 };
export const glassOf = (w) => (GLASS_KINDS.includes(w.glass) ? w.glass : 'inside');
// The glass of a window: kind, thickness, set-back and overlap, with the step's defaults.
export function glassFor(w, params = {}) {
  const o = { ...GLASS_DEFAULTS, ...params };
  const kind = glassOf(w);
  return {
    kind,
    thick: w.thick > 0 ? w.thick : o.glassThick,
    depth: Math.max(0, w.depth ?? 0),
    overlap: kind === 'inside' ? 0 : o.overlap,
    rebate: kind === 'flush' || kind === 'setin',
  };
}

// A window outline made smaller by `by` along the body: the outline in the
// window's own frame, moved in, put back on its plane.
export function insetOutline(points, normal, by) {
  if (!(by > 0)) return points;
  const c = cutter(points, normal, 1);
  return insetPoly(c.poly, by).map(([x, y]) => {
    const s = c.at(x, y);
    return [0, 1, 2].map((k) => x * c.u[k] + y * c.v[k] + s * c.d[k]);
  });
}
// A closed outline in its plane, moved in by `by`. Each point moves square
// to its own edges, so near a sharp corner points end up past the corner,
// closer to the other edge than `by`: those go, which leaves the corner
// itself. Empty when nothing fits.
export function insetPoly(poly, by) {
  const inner = offsetOutline(poly, -by).filter(([x, y]) => edgeDistance(poly, x, y) > by * 0.98);
  return inner.length >= 3 ? inner : [];
}
// How far a point is from a closed outline's edge.
function edgeDistance(poly, x, y) {
  let best = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    const ex = xi - xj, ey = yi - yj;
    const t = Math.max(0, Math.min(1, ((x - xj) * ex + (y - yj) * ey) / (ex * ex + ey * ey || 1)));
    best = Math.min(best, Math.hypot(x - xj - t * ex, y - yj - t * ey));
  }
  return best;
}
// The area of a closed outline in its frame (0 when it turned inside out).
function areaOf(poly) {
  let a = 0;
  for (let i = 0; i < poly.length; i++) a += poly[i][0] * poly[(i + 1) % poly.length][1] - poly[(i + 1) % poly.length][0] * poly[i][1];
  return a / 2;
}

// Thicken the wall behind a rebate: the inside skin under the outline (and a
// ramp round it) moves in until the wall, measured along the window's
// facing, is at least `want`. keep: how far in from the outline the wall
// stays (the overlap; the rest is cut away). Returns the mesh and how many
// points moved.
function thickenBehind(mesh0, o, want, ramp, keep = Infinity) {
  const c = cutter(o.points, o.normal, 1);
  const reach0 = want * 3 + 6;
  // Signed distance to the outline (inside > 0), -Infinity well clear of it.
  let lo = [Infinity, Infinity], hi = [-Infinity, -Infinity];
  for (const [x, y] of c.poly) (lo = [Math.min(lo[0], x), Math.min(lo[1], y)]), (hi = [Math.max(hi[0], x), Math.max(hi[1], y)]);
  const pad = ramp + 1;
  const dist = (x, y) => {
    if (x < lo[0] - pad || x > hi[0] + pad || y < lo[1] - pad || y > hi[1] + pad) return -Infinity;
    let best = Infinity, odd = false;
    const poly = c.poly;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i], [xj, yj] = poly[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) odd = !odd;
      const ex = xi - xj, ey = yi - yj;
      const t = Math.max(0, Math.min(1, ((x - xj) * ex + (y - yj) * ey) / (ex * ex + ey * ey || 1)));
      best = Math.min(best, Math.hypot(x - xj - t * ex, y - yj - t * ey));
    }
    return odd ? best : -best;
  };
  // The inside skin there fine enough to follow the rebate (it is often
  // coarse: a flat panel's inner wall in a few big triangles).
  const near = (p) => {
    const x = dot(p, c.u), y = dot(p, c.v);
    if (Math.abs(dot(p, c.d) - c.at(x, y)) >= reach0) return false;
    const k = dist(x, y);
    return k > -ramp - 1 && k < keep + 1;
  };
  const mesh = refine(mesh0, (a, b, fn) => dot(fn, c.d) > 0.3 && Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) > 0.8 && (near(a.map((q, k) => (q + b[k]) / 2)) || near(a) || near(b)));
  const P = Float32Array.from(mesh.positions);
  const I = mesh.indices;
  const N = new Float32Array(P.length);
  for (let f = 0; f < I.length; f += 3) {
    const a = I[f] * 3, b = I[f + 1] * 3, q = I[f + 2] * 3;
    const n = cross([P[b] - P[a], P[b + 1] - P[a + 1], P[b + 2] - P[a + 2]], [P[q] - P[a], P[q + 1] - P[a + 1], P[q + 2] - P[a + 2]]);
    for (const v of [a, b, q]) for (let k = 0; k < 3; k++) N[v + k] += n[k];
  }
  const cast = rayCaster(mesh.positions, I);
  const out = c.d.map((x) => -x);
  const reach = want * 3 + 6;
  let moved = 0;
  for (let v = 0; v < P.length / 3; v++) {
    const p = [P[v * 3], P[v * 3 + 1], P[v * 3 + 2]];
    const x = dot(p, c.u), y = dot(p, c.v);
    const k = dist(x, y);
    if (k < -ramp || k > keep + 1) continue;
    // Only the inside skin just behind the window: facing into the car.
    const n = [N[v * 3], N[v * 3 + 1], N[v * 3 + 2]];
    const nl = Math.hypot(...n);
    if (!nl || dot(n, c.d) / nl < 0.3) continue;
    const s = dot(p, c.d) - c.at(x, y);
    if (s < -reach || s > reach) continue;
    const t = cast(p.map((q, j) => q + out[j] * 1e-3), out);
    if (!(t < reach)) continue;
    const wall = t + 1e-3;
    if (wall >= want) continue;
    const f = k >= 0 ? 1 : 1 + k / ramp;
    const by = (want - wall) * f;
    for (let j = 0; j < 3; j++) P[v * 3 + j] += c.d[j] * by;
    moved++;
  }
  return { mesh: { positions: P, indices: I }, moved };
}

// Work on the patch of the body round a window only, then put it back: a
// whole car is large, a window small. The patch is every triangle that
// reaches into the outline's box (pad wider) in the window's frame, between
// `from` and `to` from its plane. fn(patch) returns the patch changed,
// keeping every corner it was given at its own number (moved or not) and
// adding new ones after; the edge of the patch must be left as it was.
function onPatch(mesh, o, pad, from, to, fn) {
  const c = cutter(o.points, o.normal, 1);
  let lo = [Infinity, Infinity], hi = [-Infinity, -Infinity];
  for (const [x, y] of c.poly) (lo = [Math.min(lo[0], x), Math.min(lo[1], y)]), (hi = [Math.max(hi[0], x), Math.max(hi[1], y)]);
  const P = mesh.positions, I = mesh.indices;
  const V = P.length / 3;
  const X = new Float64Array(V), Y = new Float64Array(V), S = new Float64Array(V);
  for (let v = 0; v < V; v++) {
    const p = [P[v * 3], P[v * 3 + 1], P[v * 3 + 2]];
    X[v] = dot(p, c.u);
    Y[v] = dot(p, c.v);
    S[v] = dot(p, c.d) - c.at(X[v], Y[v]);
  }
  const local = new Int32Array(V).fill(-1);
  const ids = [], keep = [], sub = [];
  for (let f = 0; f < I.length; f += 3) {
    const a = I[f], b = I[f + 1], q = I[f + 2];
    const inBox =
      Math.max(X[a], X[b], X[q]) >= lo[0] - pad && Math.min(X[a], X[b], X[q]) <= hi[0] + pad &&
      Math.max(Y[a], Y[b], Y[q]) >= lo[1] - pad && Math.min(Y[a], Y[b], Y[q]) <= hi[1] + pad &&
      Math.max(S[a], S[b], S[q]) >= from && Math.min(S[a], S[b], S[q]) <= to;
    if (!inBox) {
      keep.push(a, b, q);
      continue;
    }
    for (const v of [a, b, q]) {
      if (local[v] < 0) (local[v] = ids.length), ids.push(v);
      sub.push(local[v]);
    }
  }
  if (!sub.length) return { mesh, result: fn(null) };
  const sp = new Float32Array(ids.length * 3);
  ids.forEach((v, i) => sp.set(P.subarray(v * 3, v * 3 + 3), i * 3));
  const result = fn({ positions: sp, indices: Uint32Array.from(sub) });
  const r = result.mesh;
  // Back together: the patch's corners at their own numbers, new ones after.
  const pos = new Float32Array((V + r.positions.length / 3 - ids.length) * 3);
  pos.set(P);
  ids.forEach((v, i) => pos.set(r.positions.subarray(i * 3, i * 3 + 3), v * 3));
  pos.set(r.positions.subarray(ids.length * 3), V * 3);
  const map = (i) => (i < ids.length ? ids[i] : V + i - ids.length);
  const idx = new Uint32Array(keep.length + r.indices.length);
  idx.set(keep);
  for (let i = 0; i < r.indices.length; i++) idx[keep.length + i] = map(r.indices[i]);
  return { mesh: compactMesh(pos, idx), result };
}
// Drop corners no triangle uses.
function compactMesh(pos, idx) {
  const map = new Int32Array(pos.length / 3).fill(-1);
  let n = 0;
  for (const v of idx) if (map[v] < 0) map[v] = n++;
  const positions = new Float32Array(n * 3);
  for (let v = 0; v < map.length; v++) if (map[v] >= 0) positions.set(pos.subarray(v * 3, v * 3 + 3), map[v] * 3);
  return { positions, indices: Uint32Array.from(idx, (v) => map[v]) };
}

// The outside inside each outline sinks by its own depth, along the
// window's facing (like cut-in text). list: [{ o, depth }]. Returns the mesh
// and the names of outlines not on the body.
function sinkOutlines(m, list) {
  if (!list.length) return { mesh: m, missed: [] };
  const missed = [];
  for (const item of list) {
    // As far round the plane as cut-in text looks (see applyText), and more.
    const c = cutter(item.o.points, item.o.normal, 1);
    let w = 0;
    for (const p of c.poly) for (const q of c.poly) w = Math.max(w, Math.abs(p[0] - q[0]), Math.abs(p[1] - q[1]));
    const reach = w * 0.6 + 8;
    const r = onPatch(m, item.o, 8, -reach, reach, (patch) => {
      if (!patch) return { mesh: null, missed: true };
      const out = sinkAll(patch, [item]);
      return { mesh: out.mesh, missed: out.missed.length > 0 };
    });
    if (r.result.missed) missed.push(`${item.o.window.name}${item.o.mirrored ? ' (mirrored)' : ''}`);
    else m = r.mesh;
  }
  return { mesh: m, missed };
}
function sinkAll(m, list) {
  const texts = list.map(({ o, depth }) => {
    const c = cutter(o.points, o.normal, 1);
    const mid = o.points.reduce((s, p) => [s[0] + p[0], s[1] + p[1], s[2] + p[2]], [0, 0, 0]).map((x) => x / o.points.length);
    // The outline in the text frame: across (u) and up (v), round the middle, facing out (-d).
    const up = cross(norm(c.d.map((x) => -x)), c.u);
    const polys = [o.points.map((p) => [dot([p[0] - mid[0], p[1] - mid[1], p[2] - mid[2]], c.u), dot([p[0] - mid[0], p[1] - mid[1], p[2] - mid[2]], up)])];
    return { at: mid, normal: c.d.map((x) => -x), up, polys, mode: 'cut', depth, name: `${o.window.name}${o.mirrored ? ' (mirrored)' : ''}` };
  });
  const out = applyText(m, { texts, grain: 1.5 });
  // applyText says "Text n is not on the body": name the window instead.
  const missed = out.info.warnings.map((w) => texts[Number(/Text (\d+)/.exec(w)?.[1]) - 1]?.name ?? 'A window');
  return { mesh: { positions: out.positions, indices: out.indices }, missed };
}

// params: { windows: [{ id, name, points, corners, normal, mirror, state,
//                       glass, depth, thick }], depth, pane, recess,
//           glassThick, overlap, minWall }
//   depth:  how far behind the outline the cut reaches (wall + room to spare)
//   pane:   how thick a filled window's pane is
//   recess: how far a recessed window sinks
//   glassThick, overlap: the glass's thickness, and how far glass on the
//           outside overlaps the body round the opening (see glassFor)
//   minWall: the thinnest wall left behind a rebate
// fine: see clip (on for windows drawn now, off for those saved before).
export function applyWindows(mesh, { windows = [], depth = 3, fine = false, pane = 1, recess = 0.3, ...rest }) {
  const gp = { ...GLASS_DEFAULTS, ...rest };
  let m = mesh;
  const report = [];
  // Recessed windows: the outside within the outline moves in, like cut-in text.
  const sunk = windowOutlines(windows.filter((w) => windowState(w) === 'recess'));
  if (sunk.length) {
    if (!(recess > 0)) throw Error('Enter how far the recessed windows sink.');
    const r = sinkOutlines(m, sunk.map((o) => ({ o, depth: recess })));
    m = r.mesh;
    for (const name of r.missed) report.push({ name, text: 'The outline is not on the body' });
  }
  // Glass on the outside: rebates first (the wall behind thickened where
  // needed), then the openings, the overlap smaller than the outline.
  const open = windowOutlines(windows.filter((w) => windowState(w) === 'open'));
  // An opening the model already has (Find windows traces its rim): there
  // is nothing to cut, and cutting along the rim would only leave slivers
  // (or close the opening up). Mostly open (a lip may reach in) counts.
  // Looked at before anything changes: rays through the outline's middle,
  // along its facing, that meet nothing within the cut's reach.
  const already = new Set();
  if (open.length) {
    const cast = rayCaster(m.positions, m.indices);
    for (const o of open) {
      const c = cutter(o.points, o.normal, depth);
      const inner = insetPoly(c.poly, Math.min(1, c.size * 0.05));
      if (!inner.length) continue;
      let lo = [Infinity, Infinity], hi = [-Infinity, -Infinity];
      for (const [x, y] of inner) (lo = [Math.min(lo[0], x), Math.min(lo[1], y)]), (hi = [Math.max(hi[0], x), Math.max(hi[1], y)]);
      let tried = 0, through = 0;
      for (let a = 1; a < 10; a++)
        for (let b = 1; b < 10; b++) {
          const x = lo[0] + ((hi[0] - lo[0]) * a) / 10, y = lo[1] + ((hi[1] - lo[1]) * b) / 10;
          // Well inside (the fast distance tops out at a grid cell).
          if (!(c.inside2d(x, y) >= Math.min(0.5, c.inside2d.cell * 0.8))) continue;
          tried++;
          const s0 = c.at(x, y) + c.lo - 1;
          const start = [0, 1, 2].map((k) => x * c.u[k] + y * c.v[k] + s0 * c.d[k]);
          const t = cast(start, c.d);
          if (!(s0 + t < c.at(x, y) + c.hi)) through++;
        }
      if (tried >= 8 && through >= tried * 0.6) already.add(o);
    }
  }
  if (open.some((o) => glassOf(o.window) !== 'inside')) {
    if (!(gp.glassThick > 0)) throw Error('Enter how thick the glass is.');
    if (!(gp.overlap > 0)) throw Error('Enter how far the glass overlaps the body.');
    if (!(gp.minWall > 0)) throw Error('Enter the thinnest wall behind a rebate.');
  }
  const rebates = open.filter((o) => glassFor(o.window, gp).rebate);
  let thickened = 0;
  for (const o of rebates) {
    const g = glassFor(o.window, gp);
    const want = g.thick + g.depth + gp.minWall, ramp = Math.max(2, g.overlap * 2);
    const reach = want * 3 + 6;
    const r = onPatch(m, o, ramp + 3, -reach - 2, reach + 2, (patch) => (patch ? thickenBehind(patch, o, want, ramp, g.overlap) : { mesh: null, moved: 0 }));
    m = r.mesh;
    thickened += r.result.moved;
  }
  if (rebates.length) {
    const r = sinkOutlines(m, rebates.map((o) => ({ o, depth: glassFor(o.window, gp).thick + glassFor(o.window, gp).depth })));
    m = r.mesh;
    for (const name of r.missed) report.push({ name, text: 'The outline is not on the body' });
  }
  for (const o of open) {
    const name = `${o.window.name}${o.mirrored ? ' (mirrored)' : ''}`;
    const g = glassFor(o.window, gp);
    if (already.has(o)) {
      report.push({ name, ok: true, already: true });
      continue;
    }
    let points = o.points;
    if (g.overlap > 0) {
      const c0 = cutter(o.points, o.normal, 1);
      const inner = insetPoly(c0.poly, g.overlap);
      const fits = inner.length >= 3 && inner.every(([x, y]) => c0.inside2d(x, y) > 0);
      if (!fits || !(areaOf(inner) * areaOf(c0.poly) > 0) || Math.abs(areaOf(inner)) < Math.abs(areaOf(c0.poly)) * 0.1) {
        report.push({ name, text: `The window is too small for a ${g.overlap} mm overlap: make the overlap smaller` });
        continue;
      }
      points = insetOutline(o.points, o.normal, g.overlap);
    }
    const reach = g.rebate ? Math.max(depth, g.thick + g.depth + gp.minWall + 1.5) : depth;
    const c = cutter(points, o.normal, reach);
    const cut = onPatch(m, { ...o, points }, 2, c.lo - 2, c.hi + 2, (patch) => {
      const r = patch ? clip(patch, c.f, fine, false) : { removed: 0 };
      return { mesh: r, removed: r.removed };
    });
    const out = cut.result.removed ? cut.mesh : { removed: 0 };
    if (!out.removed && !cut.result.removed) {
      report.push({ name, text: 'The outline is not on the body' });
      continue;
    }
    // The two new edges: on the outer skin and on the inner skin.
    const { twins } = pairEdges(out.indices, out.positions.length / 3, out.positions);
    const tol = Math.max(1e-3, c.size * 1e-5);
    // Every edge the cut made lies on the cutter: mostly on its sides, and on
    // its back where the wall is thicker along the cut than it reaches (a
    // sloping lamp bowl). Openings the model had elsewhere do not.
    const onCutter = (v) => Math.abs(c.f([out.positions[v * 3], out.positions[v * 3 + 1], out.positions[v * 3 + 2]])) < tol;
    const loops = boundaryLoops(out.indices, twins).filter((l) => l.filter(onCutter).length >= l.length * 0.8);
    const closed = closeCut(out, loops, c);
    m = closed.mesh;
    if (closed.error) report.push({ name, text: closed.error });
    else report.push({ name, ok: true });
  }
  // Crumbs a cut along a rim left loose (a few triangles): they go. Parts
  // the body had before stay.
  let crumbs = 0;
  if (open.length) {
    const before = partsOf(mesh.indices.length / 3, pairEdges(mesh.indices, mesh.positions.length / 3, mesh.positions).twins).sizes.length;
    const { part, sizes } = partsOf(m.indices.length / 3, pairEdges(m.indices, m.positions.length / 3, m.positions).twins);
    if (sizes.length > before) {
      const total = m.indices.length / 3;
      const small = sizes.map((x) => x < Math.max(24, total * 2e-4));
      const keep = [];
      for (let t = 0; t < part.length; t++) {
        if (small[part[t]]) crumbs++;
        else keep.push(m.indices[t * 3], m.indices[t * 3 + 1], m.indices[t * 3 + 2]);
      }
      if (crumbs) m = { positions: m.positions, indices: Uint32Array.from(keep) };
    }
  }
  // Filled windows: a pane in each outline, joined to the frame round it.
  const panes = [];
  for (const o of windowOutlines(windows.filter((w) => windowState(w) === 'fill'))) {
    if (!(pane > 0)) throw Error('Enter how thick a filled window is.');
    panes.push(paneIn(o.points, o.normal, pane));
  }
  if (panes.length) m = joinMeshes([m, ...panes]);
  const info = { cut: report.filter((r) => r.ok && !r.already).length, alreadyOpen: report.filter((r) => r.already).length, filled: panes.length, recessed: sunk.length, rebates: rebates.length, crumbs, outside: open.filter((o) => glassOf(o.window) !== 'inside').length, thickened };
  return { positions: m.positions, indices: m.indices, info: { ...info, warnings: report.filter((r) => !r.ok).map((r) => `${r.name}: ${r.text}`) } };
}

// A pane filling a window outline drawn round an opening: its outside is a
// smooth patch through the outline (so it follows the body's curve), its
// inside the same set `thick` in (against the window's facing), joined by a
// band round the edge. The outline lies on the frame, so the pane's edge is
// built into it and the two print as one.
function paneIn(points, normal, thick) {
  const pos = [];
  for (const p of points) pos.push(p[0], p[1], p[2]);
  const ring = points.map((_, i) => i);
  let top = fillLoop(pos, ring, 'smooth');
  // Facing out along the window's normal.
  const n0 = norm(normal);
  let facing = 0;
  for (const [a, b, c] of top) {
    const A = [pos[a * 3], pos[a * 3 + 1], pos[a * 3 + 2]], B = [pos[b * 3], pos[b * 3 + 1], pos[b * 3 + 2]], C = [pos[c * 3], pos[c * 3 + 1], pos[c * 3 + 2]];
    facing += dot(cross([B[0] - A[0], B[1] - A[1], B[2] - A[2]], [C[0] - A[0], C[1] - A[1], C[2] - A[2]]), n0);
  }
  if (facing < 0) top = top.map(([a, b, c]) => [a, c, b]);
  // The inside: every corner moved in by the thickness.
  const V = pos.length / 3;
  for (let v = 0; v < V; v++) for (let k = 0; k < 3; k++) pos.push(pos[v * 3 + k] - n0[k] * thick);
  const idx = [];
  for (const [a, b, c] of top) idx.push(a, b, c, a + V, c + V, b + V);
  // The band: each outline edge, the way the outside does not run it.
  const used = new Set(top.flatMap(([a, b, c]) => [`${a}>${b}`, `${b}>${c}`, `${c}>${a}`]));
  for (let i = 0; i < ring.length; i++) {
    let p = ring[i], q = ring[(i + 1) % ring.length];
    if (used.has(`${p}>${q}`)) [p, q] = [q, p];
    idx.push(p, q, q + V, p, q + V, p + V);
  }
  return { positions: Float32Array.from(pos), indices: Uint32Array.from(idx) };
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
  const extra = []; // new corners (a fan's middle), after the mesh's own
  const ring = flat.filter((f) => f.winding !== 0);
  for (const f of flat.filter((f) => f.winding === 0)) {
    const tri = earClip(f.ts);
    if (tri) {
      for (const k of tri) faces.push(f.loop[k]);
      continue;
    }
    // A shape that folds back over itself (where the hollow's skins pass
    // through each other): closed by a fan from its middle, which always closes.
    const mid = P.length / 3 + extra.length / 3;
    for (let k = 0; k < 3; k++) extra.push(f.loop.reduce((a, v) => a + P[v * 3 + k], 0) / f.loop.length);
    for (let i = 0; i < f.loop.length; i++) faces.push(mid, f.loop[i], f.loop[(i + 1) % f.loop.length]);
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
  let positions = mesh.positions;
  if (extra.length) {
    positions = new Float32Array(P.length + extra.length);
    positions.set(P);
    positions.set(extra, P.length);
  }
  return { mesh: { positions, indices: idx } };
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
