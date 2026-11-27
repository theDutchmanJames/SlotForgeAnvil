// Clear parts: printed glass for every open window, headlights and
// taillights included, shaped for where its glass sits (see glassFor in
// windows.js): inside fills the opening with a lip behind the wall (the light
// lens); flush is a pane in the rebate, its face level with the body; on top
// a pane lying on the body over the opening; set in a pane in the rebate
// with a plug that fills the opening. Every face and back is the body's own
// outside there, moved along the window's facing, so the part follows the
// curve exactly. The rest of this note is about the inside lens.
//
// Light lenses: a clear lens that fits a headlight or taillight opening
// exactly. The opening is an open window marked Lens; both kinds of lens are
// made from that same outline, on the body before its windows are cut:
//
//  - printed: a clear resin plug that fills the opening, its outside the
//    body's own surface there, a fit clearance smaller all round, with a lip
//    behind the wall so it cannot be pushed through;
//  - buck: a small plug per light to vac-form the lens over. The formed lens
//    is glued in from the inside, like the window insert: the plug is the
//    outside moved in by wall + sheet + allowance, with a glue margin round
//    the opening, a skirt, a plinth and a little draft.
//
// Each is made in the light's own frame (see cutter): x, y across the
// opening, h out of the car (along -d). Car frame: X along, Y across, Z up.
import { tube } from './buck.js';
import { fillLoop } from './fill.js';
import { rayCaster } from './rays.js';
import { refine } from './detail.js';
import { applyReduce } from './reduce.js';
import { consistentFlips, joinMeshes, pairEdges } from './topology.js';
import { cutter, insetPoly } from './windows.js';

export const LENS_DEFAULTS = { clearance: 0.1, lip: 0.6, lipWidth: 0.8, sheet: 0.3, allowance: 0.1, margin: 1.5, skirt: 2, plinth: 2, draft: 2, guide: 0.1, gap: 4 };

// The light's frame, and the body's outside seen along it. reach: how far
// behind the outline's plane the outside may lie round it (a lens on a
// rounded nose or wing curves away from it) before it counts as missed.
function lightFrame(o, cast, reach) {
  const c = cutter(o.points, o.normal, 10);
  const toCar = (x, y, h) => [0, 1, 2].map((k) => x * c.u[k] + y * c.v[k] - h * c.d[k]);
  // How far out the outside is at x, y (h), or NaN where the ray misses the
  // body or only finds it well behind the opening (the far side of the car).
  const limit = -c.lo + 1 + reach;
  const raw = (x, y) => {
    const s0 = c.at(x, y) + c.lo - 1;
    const t = cast(toCar(x, y, -s0), c.d);
    if (t === Infinity || s0 + t > c.at(x, y) + limit) return NaN;
    return -(s0 + t);
  };
  // An opening the model came with has no outside inside its outline: rays
  // fall through, or meet the inside well behind the rim. There the glass
  // gets a smooth skin across, grown in from the body round it (as glass
  // would run), so its face still follows the car's curve.
  let lo = [Infinity, Infinity], hi = [-Infinity, -Infinity];
  for (const [x, y] of c.poly) (lo = [Math.min(lo[0], x), Math.min(lo[1], y)]), (hi = [Math.max(hi[0], x), Math.max(hi[1], y)]);
  const g = Math.min(0.5, Math.max(0.1, c.size / 120));
  const pad = 4;
  const gx = Math.ceil((hi[0] - lo[0] + 2 * pad) / g) + 1, gy = Math.ceil((hi[1] - lo[1] + 2 * pad) / g) + 1;
  const X0 = lo[0] - pad, Y0 = lo[1] - pad;
  const inPoly = (x, y) => c.inside2d(x, y) > -0.3;
  let H = null;
  const fill = () => {
    H = new Float32Array(gx * gy);
    let hole = [];
    const inside = [];
    for (let i = 0; i < gx; i++)
      for (let j = 0; j < gy; j++) {
        const x = X0 + i * g, y = Y0 + j * g;
        let h = raw(x, y);
        // Behind the rim's own plane by more than a little: the inside, not glass.
        if (inPoly(x, y) && Number.isFinite(h) && h < -c.at(x, y) - 0.5) h = NaN;
        H[i * gy + j] = h;
        if (inPoly(x, y)) inside.push(i * gy + j);
        if (!Number.isFinite(h) && inPoly(x, y)) hole.push(i * gy + j);
      }
    if (!hole.length) return;
    // Mostly open: whatever the rays met in there (a lip, a dashboard) is
    // not glass either. The whole of it is grown in from round the rim.
    if (hole.length > inside.length * 0.5) {
      opening = true;
      for (const q of inside) H[q] = NaN;
      hole = inside;
    }
    let left = hole;
    for (let round = 0; round < gx + gy && left.length; round++) {
      const next = [], set = [];
      for (const q of left) {
        const i = Math.floor(q / gy), j = q % gy;
        let sum = 0, n = 0;
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const a2 = i + di, b2 = j + dj;
          if (a2 < 0 || b2 < 0 || a2 >= gx || b2 >= gy) continue;
          const v = H[a2 * gy + b2];
          if (Number.isFinite(v)) (sum += v), n++;
        }
        if (n) set.push([q, sum / n]);
        else next.push(q);
      }
      if (!set.length) break;
      for (const [q, v] of set) H[q] = v;
      left = next;
    }
    // A soap film: over-relaxed, so it settles in a few hundred rounds
    // even across a whole windscreen (plain averaging leaves ridges where
    // the fronts grown in from each side met).
    for (let it = 0; it < 600; it++) {
      let most = 0;
      for (const q of hole) {
        const i = Math.floor(q / gy), j = q % gy;
        let sum = 0, n = 0;
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const a2 = i + di, b2 = j + dj;
          if (a2 < 0 || b2 < 0 || a2 >= gx || b2 >= gy) continue;
          const v = H[a2 * gy + b2];
          if (Number.isFinite(v)) (sum += v), n++;
        }
        if (!n) continue;
        const d = 1.9 * (sum / n - H[q]);
        H[q] += d;
        most = Math.max(most, Math.abs(d));
      }
      if (most < 1e-4) break;
    }
    filled = true;
  };
  let filled = false, opening = false;
  const outside = (x, y) => {
    const h = raw(x, y);
    const glassy = Number.isFinite(h) && !(inPoly(x, y) && h < -c.at(x, y) - 0.5);
    if (!inPoly(x, y)) return glassy ? h : NaN;
    if (!H) fill();
    if (glassy && !opening) return h;
    if (!filled) return NaN;
    const fi = (x - X0) / g, fj = (y - Y0) / g;
    const i = Math.max(0, Math.min(gx - 2, Math.floor(fi))), j = Math.max(0, Math.min(gy - 2, Math.floor(fj)));
    const u = fi - i, w = fj - j;
    const at = (p, q) => H[(i + p) * gy + j + q];
    const v = at(0, 0) * (1 - u) * (1 - w) + at(1, 0) * u * (1 - w) + at(0, 1) * (1 - u) * w + at(1, 1) * u * w;
    return Number.isFinite(v) ? v : NaN;
  };
  // How far out the inside of the wall is behind the outside at x, y: the
  // next surface along the ray, within a few wall thicknesses; else NaN.
  const insideSkin = (x, y, wall) => {
    const s0 = c.at(x, y) + c.lo - 1;
    const p = toCar(x, y, -s0);
    const t1 = cast(p, c.d);
    if (t1 === Infinity || s0 + t1 > c.at(x, y) + limit) return NaN;
    const eps = 1e-3;
    const t2 = cast(p.map((q, k) => q + c.d[k] * (t1 + eps)), c.d);
    if (t2 === Infinity || t2 > wall * 4 + 1) return NaN;
    return -(s0 + t1 + eps + t2);
  };
  return { c, toCar, outside, insideSkin, cast };
}

// A patch over a closed outline in the light's plane: triangulated flat (so
// it cannot fold), its new points then lifted by height(x, y). The outline's
// own corners keep the ids given. Returns its triangles.
function liftedPatch(pos, ids, pts, height, fallback) {
  const flat0 = [];
  for (const [x, y] of pts) flat0.push(x, y, 0);
  let tris = fillLoop(flat0, pts.map((_, i) => i), 'smooth');
  // Small triangles across the whole patch, so a large curved pane (a
  // windscreen) follows its surface instead of showing long flat facets.
  // The outline's own edges stay whole: the bands round it join there.
  const n = pts.length;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const [x, y] of pts) (x0 = Math.min(x0, x)), (x1 = Math.max(x1, x)), (y0 = Math.min(y0, y)), (y1 = Math.max(y1, y));
  const most = Math.max(0.4, Math.min(1.5, Math.max(x1 - x0, y1 - y0) / 40));
  // Outline corners by their place, as the patch stores it (single precision).
  const ring = new Map();
  pts.forEach(([x, y], i) => ring.set(`${Math.fround(x)},${Math.fround(y)}`, i));
  // Two outline points in one place would make its edges ambiguous: then
  // the patch stays as it was triangulated.
  const fine = ring.size < n ? { positions: Float32Array.from(flat0), indices: Uint32Array.from(tris.flat()) } : refine({ positions: Float32Array.from(flat0), indices: Uint32Array.from(tris.flat()) }, (a, b) => {
    const len = Math.hypot(a[0] - b[0], a[1] - b[1]);
    if (len <= most) return false;
    // An outline edge: both ends on the outline, next to each other.
    const ia = ring.get(`${a[0]},${a[1]}`), ib = ring.get(`${b[0]},${b[1]}`);
    if (ia !== undefined && ib !== undefined && (Math.abs(ia - ib) === 1 || Math.abs(ia - ib) === n - 1)) return false;
    return true;
  });
  const flat = Array.from(fine.positions);
  tris = [];
  for (let t = 0; t < fine.indices.length; t += 3) tris.push([fine.indices[t], fine.indices[t + 1], fine.indices[t + 2]]);
  const map = ids.slice();
  for (let v = pts.length; v < flat.length / 3; v++) {
    const x = flat[v * 3], y = flat[v * 3 + 1];
    const h = height(x, y);
    pos.push(x, y, Number.isFinite(h) ? h : fallback);
    map.push(pos.length / 3 - 1);
  }
  return tris.map((t) => t.map((v) => map[v]));
}

// A closed outline moved out by `by` (in by -by), each corner along the
// mean of its two edges' normals.
export function offsetOutline(poly, by) {
  const n = poly.length;
  let area = 0;
  for (let i = 0; i < n; i++) area += poly[i][0] * poly[(i + 1) % n][1] - poly[(i + 1) % n][0] * poly[i][1];
  const sg = area >= 0 ? 1 : -1;
  const normal = (a, b) => {
    const ex = b[0] - a[0], ey = b[1] - a[1], l = Math.hypot(ex, ey) || 1;
    return [(sg * ey) / l, (-sg * ex) / l];
  };
  return poly.map((p, i) => {
    const n1 = normal(poly[(i - 1 + n) % n], p), n2 = normal(p, poly[(i + 1) % n]);
    let mx = n1[0] + n2[0], my = n1[1] + n2[1];
    const l = Math.hypot(mx, my);
    if (l < 1e-9) return [p[0] + n1[0] * by, p[1] + n1[1] * by];
    mx /= l;
    my /= l;
    const k = by / Math.max(0.5, mx * n1[0] + my * n1[1]);
    return [p[0] + mx * k, p[1] + my * k];
  });
}

// Signed distance to a closed outline: positive inside.
function distance2d(poly) {
  return (x, y) => {
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
}

function signedVolume(p, t) {
  let v = 0;
  for (let f = 0; f < t.length; f += 3) {
    const a = t[f] * 3, b = t[f + 1] * 3, c = t[f + 2] * 3;
    v += p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1]) - p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c]) + p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c]);
  }
  return v;
}

// Every triangle the same way round, facing out.
function outward(pos, idx) {
  const P = Float32Array.from(pos);
  const { twins } = pairEdges(idx, P.length / 3, P);
  const { flip } = consistentFlips(idx, twins);
  for (let f = 0; f < flip.length; f++) if (flip[f]) [idx[f * 3 + 1], idx[f * 3 + 2]] = [idx[f * 3 + 2], idx[f * 3 + 1]];
  if (signedVolume(pos, idx) < 0) for (let f = 0; f < idx.length; f += 3) [idx[f + 1], idx[f + 2]] = [idx[f + 2], idx[f + 1]];
  return { positions: pos, indices: idx };
}

// Four corners of a quad between two rings of the same length.
function bands(idx, A, B) {
  for (let i = 0; i < A.length; i++) {
    const j = (i + 1) % A.length;
    idx.push(A[i], A[j], B[j], A[i], B[j], B[i]);
  }
}

// Two rings round a part joined by a band, when they do not have the same
// number of points: each step goes along the ring whose next point is
// nearer (in the plane of the window).
function stitch(idx, pos, A, B) {
  const d = (a, b) => Math.hypot(pos[a * 3] - pos[b * 3], pos[a * 3 + 1] - pos[b * 3 + 1]);
  let start = 0, best = Infinity;
  B.forEach((v, j) => {
    const x = d(A[0], v);
    if (x < best) (best = x), (start = j);
  });
  B = [...B.slice(start), ...B.slice(0, start)];
  const nA = A.length, nB = B.length;
  let i = 0, j = 0;
  while (i < nA || j < nB) {
    const a = A[i % nA], a1 = A[(i + 1) % nA], b = B[j % nB], b1 = B[(j + 1) % nB];
    if (j >= nB || (i < nA && d(a1, b) <= d(a, b1))) {
      idx.push(a, a1, b);
      i++;
    } else {
      idx.push(a, b1, b);
      j++;
    }
  }
}

// A clear part for glass on the outside, in the window's frame (outside
// up). g: { kind: flush | top | setin, thick, depth, overlap, minWall }.
function outsidePart(f, o, g) {
  const { c, outside, insideSkin } = f;
  const pos = [], idx = [];
  const ring = (pts, h) =>
    pts.map(([x, y]) => {
      pos.push(x, y, h(x, y));
      return pos.length / 3 - 1;
    });
  const mean = (pts, h) => pts.reduce((s, [x, y]) => s + h(x, y), 0) / pts.length;
  const onBody = (pts) => pts.every(([x, y]) => Number.isFinite(outside(x, y)));
  // On top: the outline itself, lying on the body. Flush and set in: the
  // fit clearance smaller, sunk into the rebate.
  const pane = g.kind === 'top' ? c.poly : offsetOutline(c.poly, -o.clearance);
  if (!onBody(pane)) return { error: 'the outline is not all on the body' };
  const face = g.kind === 'top' ? (x, y) => outside(x, y) + g.thick : (x, y) => outside(x, y) - g.depth;
  const back = g.kind === 'top' ? (x, y) => outside(x, y) : (x, y) => outside(x, y) - g.depth - g.thick;
  const A = ring(pane, face), B = ring(pane, back);
  for (const t of liftedPatch(pos, A, pane, face, mean(pane, face))) idx.push(...t);
  bands(idx, A, B);
  if (g.kind !== 'setin') {
    for (const t of liftedPatch(pos, B, pane, back, mean(pane, back))) idx.push(...t);
    return { mesh: outward(pos, idx) };
  }
  // Set in: a plug through the opening (the overlap smaller than the
  // outline, and the fit clearance), down to the inside of the wall, which
  // Windows thickens to at least minWall behind the rebate.
  const plug = insetPoly(c.poly, g.overlap + o.clearance);
  if (!plug.length) return { error: `the window is too small for a ${g.overlap} mm overlap` };
  if (!onBody(plug)) return { error: 'the outline is not all on the body' };
  const inner = (x, y) => {
    const h0 = outside(x, y);
    const hi = insideSkin(x, y, o.wall);
    const floor = h0 - g.depth - g.thick;
    return Math.min(Number.isFinite(hi) ? hi : h0 - o.wall, floor - g.minWall);
  };
  const C = ring(plug, back), D = ring(plug, inner);
  stitch(idx, pos, B, C);
  bands(idx, C, D);
  for (const t of liftedPatch(pos, D, plug, inner, mean(plug, inner))) idx.push(...t);
  return { mesh: outward(pos, idx) };
}

// The printed lens, in the light's frame (outside up). Returns a reason
// instead when the outline is not on the body. depth: how far its face sits
// back from the body's outside.
function printedLens(f, o, depth = 0) {
  const { c, cast, toCar } = f;
  const outside = depth > 0 ? (x, y) => f.outside(x, y) - depth : f.outside;
  const insideSkin = f.insideSkin;
  const inner = offsetOutline(c.poly, -o.clearance);
  const lip = offsetOutline(c.poly, o.lipWidth);
  const hIn = inner.map(([x, y]) => outside(x, y));
  if (hIn.some((h) => !Number.isFinite(h))) return { error: 'the outline is not all on the body' };
  // The back of the plug and the top of the lip: the clearance behind the
  // inside of the wall, found behind the outside (on a sloping nose the wall
  // is thicker along the light than across it). Where there is no inside to
  // find, a wall's thickness in.
  const behind = (x, y, hOut) => {
    const h = insideSkin(x, y, o.wall);
    return (Number.isFinite(h) ? h : hOut - o.wall) - o.clearance;
  };
  const hB = inner.map(([x, y], i) => Math.min(behind(x, y, hIn[i]), hIn[i] - 0.2));
  // Where the lip reaches off the body, it follows the lens edge instead.
  const hC = lip.map(([x, y], i) => {
    const h = outside(x, y);
    return Number.isFinite(h) ? Math.min(behind(x, y, h), hB[i]) : hB[i];
  });
  const pos = [];
  const ring = (pts, hs, down = 0) =>
    pts.map(([x, y], i) => {
      pos.push(x, y, hs[i] - down);
      return pos.length / 3 - 1;
    });
  const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  const A = ring(inner, hIn);
  const B = ring(inner, hB);
  const C = ring(lip, hC);
  const D = ring(lip, hC, o.lip);
  const idx = [];
  // The outside: the body's own surface there.
  for (const t of liftedPatch(pos, A, inner, outside, mean(hIn))) idx.push(...t);
  bands(idx, A, B);
  bands(idx, B, C);
  bands(idx, C, D);
  // The back: the lip's thickness behind the inside of the wall.
  const back = (x, y) => {
    const h = outside(x, y);
    return Number.isFinite(h) ? Math.min(behind(x, y, h), mean(hB)) - o.lip : NaN;
  };
  for (const t of liftedPatch(pos, D, lip, back, mean(hC) - o.lip)) idx.push(...t);
  // Does the lip meet the body behind the wall (a fold, a rib)? Looked for
  // straight back from round its top, through its thickness.
  let blocked = 0;
  lip.forEach(([x, y], i) => {
    if (cast(toCar(x, y, hC[i]), c.d) < o.lip) blocked++;
  });
  return { mesh: outward(pos, idx), blocked: blocked / lip.length };
}

// The lens buck, in the light's frame (standing on its plinth).
// spec (a window's own buck, see windowBuck): r, how far in the buck's
// surface is; grow, how far past the outline it reaches; trim, the line
// the formed sheet is cut along; glue, whether a glue margin line goes on.
function lensBuck(f, o, spec = null) {
  const { c, outside } = f;
  const r = spec ? spec.r : o.wall + o.sheet + o.allowance;
  const grow = spec ? spec.grow : o.margin;
  const cell = o.cell ?? Math.min(0.12, Math.max(0.05, c.size / 100));
  const k = o.draft > 0 ? 1 / Math.tan((o.draft * Math.PI) / 180) : Infinity;
  const spread = Number.isFinite(k) ? (o.skirt + o.plinth) / k + 1 : 1;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [x, y] of c.poly) (minX = Math.min(minX, x)), (maxX = Math.max(maxX, x)), (minY = Math.min(minY, y)), (maxY = Math.max(maxY, y));
  const pad = grow + r + spread + 2 * cell;
  const x0 = minX - pad, y0 = minY - pad;
  const nx = Math.ceil((maxX - minX + 2 * pad) / cell) + 1, ny = Math.ceil((maxY - minY + 2 * pad) / cell) + 1;
  const X = (i) => x0 + i * cell, Y = (j) => y0 + j * cell;
  // The outside, as a height map.
  const H = new Float32Array(nx * ny);
  for (let i = 0; i < nx; i++)
    for (let j = 0; j < ny; j++) {
      const h = outside(X(i), Y(j));
      H[i * ny + j] = Number.isFinite(h) ? h : -Infinity;
    }
  // The lens: the opening and its glue margin.
  const inLens = new Uint8Array(nx * ny);
  const dist = distance2d(c.poly);
  for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) inLens[i * ny + j] = dist(X(i), Y(j)) > -grow ? 1 : 0;
  // Moved in by r: the deepest a ball of radius r sits under the surface.
  const R = Math.ceil(r / cell);
  const disk = [];
  for (let di = -R; di <= R; di++)
    for (let dj = -R; dj <= R; dj++) {
      const d2 = (di * di + dj * dj) * cell * cell;
      if (d2 <= r * r) disk.push([di, dj, Math.sqrt(r * r - d2)]);
    }
  const Bh = new Float32Array(nx * ny).fill(-Infinity);
  // Rays that missed (off the body, through an opening) are left out; a spot
  // of the lens whose own ray missed counts as off the body.
  let low = Infinity, missed = 0, cells = 0;
  for (let i = 0; i < nx; i++)
    for (let j = 0; j < ny; j++) {
      if (!inLens[i * ny + j]) continue;
      cells++;
      if (H[i * ny + j] === -Infinity) {
        missed++;
        continue;
      }
      let m = Infinity;
      for (const [di, dj, h] of disk) {
        const a = i + di, b = j + dj;
        if (a < 0 || b < 0 || a >= nx || b >= ny) continue;
        const v = H[a * ny + b] - h;
        if (v < m && v > -Infinity) m = v;
      }
      Bh[i * ny + j] = m;
      low = Math.min(low, m);
    }
  if (!Number.isFinite(low)) return { error: 'the outline is not on the body' };
  const base = low - o.skirt;
  const F = new Float32Array(nx * ny);
  for (let q = 0; q < nx * ny; q++) F[q] = inLens[q] && Bh[q] > base ? Bh[q] : base;
  // Draft: the sides lean out, so the sheet lets go.
  if (Number.isFinite(k)) {
    const nb = [[-1, -1], [-1, 0], [-1, 1], [0, -1]];
    for (const forward of [true, false])
      for (let s = 0; s < nx * ny; s++) {
        const q = forward ? s : nx * ny - 1 - s;
        const a = Math.floor(q / ny), b = q % ny;
        for (const [da0, db0] of nb) {
          const a2 = a + (forward ? da0 : -da0), b2 = b + (forward ? db0 : -db0);
          if (a2 < 0 || b2 < 0 || a2 >= nx || b2 >= ny) continue;
          const v = F[a2 * ny + b2] - k * cell * Math.hypot(da0, db0);
          if (v > F[q]) F[q] = v;
        }
      }
  }
  // The solid: the height map, its sides down to the plinth, and its floor.
  const pos = [], idx = [];
  for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) pos.push(X(i), Y(j), F[i * ny + j]);
  const at = (i, j) => i * ny + j;
  for (let i = 0; i < nx - 1; i++)
    for (let j = 0; j < ny - 1; j++) {
      const p00 = at(i, j), p10 = at(i + 1, j), p11 = at(i + 1, j + 1), p01 = at(i, j + 1);
      if (Math.abs(F[p00] - F[p11]) <= Math.abs(F[p10] - F[p01])) idx.push(p00, p10, p11, p00, p11, p01);
      else idx.push(p00, p10, p01, p10, p11, p01);
    }
  const bottom = base - o.plinth;
  const ring = [];
  for (let i = 0; i < nx - 1; i++) ring.push(at(i, 0));
  for (let j = 0; j < ny - 1; j++) ring.push(at(nx - 1, j));
  for (let i = nx - 1; i > 0; i--) ring.push(at(i, ny - 1));
  for (let j = ny - 1; j > 0; j--) ring.push(at(0, j));
  const under = ring.map((v) => {
    pos.push(pos[v * 3], pos[v * 3 + 1], bottom);
    return pos.length / 3 - 1;
  });
  pos.push(X((nx - 1) / 2), Y((ny - 1) / 2), bottom);
  const centre = pos.length / 3 - 1;
  for (let n = 0; n < ring.length; n++) {
    const p = ring[n], q = ring[(n + 1) % ring.length];
    idx.push(p, under[n], under[(n + 1) % ring.length], p, under[(n + 1) % ring.length], q, centre, under[(n + 1) % ring.length], under[n]);
  }
  // The height map is dense everywhere; thin it where it is flat, moving the
  // surface by no more than a hundredth of a millimetre.
  let solid = outward(pos, idx);
  if (o.reduce !== false) {
    const r2 = applyReduce({ positions: Float32Array.from(solid.positions), indices: Uint32Array.from(solid.indices) }, { target: 0.1, tolerance: 0.01 });
    solid = { positions: Array.from(r2.positions), indices: Array.from(r2.indices) };
  }
  const pieces = [solid];
  // Raised guide lines: the opening, and the trim line at the glue margin.
  const Fat = (x, y) => {
    const fa = Math.max(0, Math.min(nx - 1.001, (x - x0) / cell)), fb = Math.max(0, Math.min(ny - 1.001, (y - y0) / cell));
    const a = Math.floor(fa), b = Math.floor(fb), u = fa - a, v = fb - b;
    const g = (p, q) => F[(a + p) * ny + b + q];
    return g(0, 0) * (1 - u) * (1 - v) + g(1, 0) * u * (1 - v) + g(0, 1) * (1 - u) * v + g(1, 1) * u * v;
  };
  if (o.guide > 0 && spec) {
    pieces.push(tube(spec.trim.map(([x, y]) => [x, y, Fat(x, y)]), o.guide));
  } else if (o.guide > 0) {
    pieces.push(tube(c.poly.map(([x, y]) => [x, y, Fat(x, y)]), o.guide));
    // Just inside the margin's edge, where the surface is still the lens.
    pieces.push(tube(offsetOutline(c.poly, o.margin - cell * 1.5).map(([x, y]) => [x, y, Fat(x, y)]), o.guide));
  }
  return { mesh: joinMeshes(pieces.map((p) => ({ positions: Float32Array.from(p.positions), indices: Uint32Array.from(p.indices) }))), cell, missed: missed / cells };
}

// A window's own buck, for where its glass sits. Inside: the lens buck (the
// sheet glued in from inside, with a glue margin). Outside: the formed
// sheet's inside is the body's outside (on top), or that moved in by the
// set-back and the sheet (flush, set in: a vac-formed set-in pane is a
// flush pane); the buck reaches `runoff` past the outline so the sheet
// forms right up to the trim line, which is the outline (on top) or the
// outline the fit clearance smaller (in the rebate).
function windowBuck(f, o, g) {
  if (g.kind === 'inside') return lensBuck(f, o);
  const top = g.kind === 'top';
  const r = top ? 0 : g.depth + o.sheet;
  const trim = top ? f.c.poly : offsetOutline(f.c.poly, -o.clearance);
  return lensBuck(f, o, { r, grow: o.runoff, trim });
}

// A buck per window: outlines as for makeLenses (with glass); opts as for
// makeLenses plus runoff. Returns the bucks on the car and laid out.
export function makeWindowBucks(mesh, outlines, opts) {
  const o = { ...LENS_DEFAULTS, runoff: 2, ...opts };
  if (!(o.wall > 0)) throw Error('Enter the wall thickness of the body.');
  const cast = rayCaster(mesh.positions, mesh.indices);
  const print = [], car = [], windows = [], warnings = [];
  for (const ol of outlines) {
    const g = { kind: 'inside', thick: 1, depth: 0, overlap: 0, ...ol.glass };
    const f = lightFrame(ol, cast, o.margin + o.runoff + o.wall + o.sheet + o.allowance + 2 + g.depth);
    const b = windowBuck(f, o, g);
    if (b.error) {
      warnings.push(`${ol.name}: ${b.error}, so it has no buck`);
      continue;
    }
    if (b.missed > 0.02) warnings.push(`${ol.name}: ${Math.round(b.missed * 100)}% of the buck's edge is off the body; the buck is filled there`);
    print.push(b.mesh);
    car.push(onCar(f, b.mesh));
    windows.push({ name: ol.name, kind: g.kind });
  }
  const join = (l) => (l.length ? joinMeshes(l) : EMPTY());
  return { car: join(car), print: layOut(print, o.gap) ?? EMPTY(), info: { windows, warnings } };
}

// A mesh in a light's frame, put on the car.
function onCar(f, m) {
  const P = new Float32Array(m.positions.length);
  for (let v = 0; v < P.length; v += 3) P.set(f.toCar(m.positions[v], m.positions[v + 1], m.positions[v + 2]), v);
  // The frame (x, y, out) is mirrored against the car's: turn the triangles round.
  const I = Uint32Array.from(m.indices);
  for (let t = 0; t < I.length; t += 3) [I[t + 1], I[t + 2]] = [I[t + 2], I[t + 1]];
  return { positions: P, indices: I };
}

// Pieces in a row along X, each standing on z = 0, `gap` apart.
function layOut(list, gap) {
  const out = [];
  let x = 0;
  for (const m of list) {
    const P = Float32Array.from(m.positions);
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let v = 0; v < P.length; v++) (lo[v % 3] = Math.min(lo[v % 3], P[v])), (hi[v % 3] = Math.max(hi[v % 3], P[v]));
    for (let v = 0; v < P.length; v += 3) {
      P[v] += x - lo[0];
      P[v + 1] -= (lo[1] + hi[1]) / 2;
      P[v + 2] -= lo[2];
    }
    x += hi[0] - lo[0] + gap;
    out.push({ positions: P, indices: m.indices });
  }
  return out.length ? joinMeshes(out) : null;
}

const EMPTY = () => ({ positions: new Float32Array(0), indices: new Uint32Array(0) });

// outlines: [{ name, points, normal, glass }] of the windows and lights;
// glass: { kind, thick, depth, overlap, minWall } (see glassFor in
// windows.js; inside when left out). opts: LENS_DEFAULTS + wall. Returns
// both kinds on the car (to look at) and laid out (to print). A lens buck
// is made for glass inside; glass on the outside gets its own buck under
// Glazing buck.
export function makeLenses(mesh, outlines, opts) {
  const o = { ...LENS_DEFAULTS, ...opts };
  if (!(o.wall > 0)) throw Error('Enter the wall thickness of the body.');
  if (!outlines.length) throw Error('Draw a window or a light first (Windows), and set it Open.');
  const cast = rayCaster(mesh.positions, mesh.indices);
  const lenses = [], plugs = [], carLenses = [], carPlugs = [], lights = [], warnings = [];
  for (const ol of outlines) {
    const g = { kind: 'inside', thick: 1, depth: 0, overlap: 0, minWall: 0.6, ...ol.glass };
    const f = lightFrame(ol, cast, o.margin + o.wall + o.sheet + o.allowance + 2 + g.depth + g.thick);
    const lens = g.kind === 'inside' ? printedLens(f, o, g.depth) : outsidePart(f, o, g);
    const plug = g.kind === 'inside' ? lensBuck(f, o) : null;
    if (lens.error || plug?.error) {
      warnings.push(`${ol.name}: ${lens.error ?? plug.error}, so it has no clear part`);
      continue;
    }
    if (lens.blocked > 0.05) warnings.push(`${ol.name}: the printed lens's lip runs into the body behind the wall round ${Math.round(lens.blocked * 100)}% of it; make the lip narrower or thinner`);
    if (plug?.missed > 0.02) warnings.push(`${ol.name}: ${Math.round(plug.missed * 100)}% of the lens buck's glue margin is off the body (the lamp sits in a deep bowl, or near an edge); the buck is filled there. A smaller glue margin may fit`);
    lenses.push(lens.mesh);
    carLenses.push(onCar(f, lens.mesh));
    if (plug) {
      plugs.push(plug.mesh);
      carPlugs.push(onCar(f, plug.mesh));
    }
    let lo = [Infinity, Infinity], hi = [-Infinity, -Infinity];
    for (const [x, y] of f.c.poly) (lo = [Math.min(lo[0], x), Math.min(lo[1], y)]), (hi = [Math.max(hi[0], x), Math.max(hi[1], y)]);
    lights.push({ name: ol.name, kind: g.kind, size: [hi[0] - lo[0], hi[1] - lo[1]] });
  }
  const join = (l) => (l.length ? joinMeshes(l) : EMPTY());
  return {
    car: { lenses: join(carLenses), plugs: join(carPlugs) },
    print: { lenses: layOut(lenses, o.gap) ?? EMPTY(), plugs: layOut(plugs, o.gap) ?? EMPTY() },
    info: { lights, warnings, offset: o.wall + o.sheet + o.allowance },
  };
}
