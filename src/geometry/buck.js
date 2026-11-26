// The window buck: one solid plug for the whole cabin, to vac-form a single
// glazing insert that is glued in from the inside.
//
// Made as a height map seen from above, so the sheet can always come off
// (nothing hangs over). The body's outer surface is moved inward by wall +
// sheet + fit allowance (an exact ball offset of the height map), so the
// formed sheet sits against the inside of the wall. Cut at the trim line,
// it stands on a short skirt and a plinth, with a little draft. Fine raised
// lines show the window outlines and the trim line on the formed sheet.
// Car frame: X along (front low), Y across, Z up.
import { bounds } from './bounds.js';
import { rayCaster } from './rays.js';
import { applyReduce } from './reduce.js';

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => {
  const l = Math.hypot(...a);
  return l ? a.map((x) => x / l) : a;
};

const AROUND = [[0, 0], ...Array.from({ length: 8 }, (_, k) => [Math.cos((k * Math.PI) / 4), Math.sin((k * Math.PI) / 4)])];

export const BUCK_DEFAULTS = { sheet: 0.5, allowance: 0.1, margin: 3, skirt: 3, plinth: 2, draft: 1, guide: 0.15 };

// opts: { wall, sheet, allowance, trim: { front, rear }, skirt, plinth, draft,
//         margin, guide, outlines: [{ name, points, normal }], posts: [{ x, y }], cell }
export function makeBuck(mesh, opts) {
  const o = { ...BUCK_DEFAULTS, ...opts };
  if (!(o.wall > 0)) throw Error('Enter the wall thickness of the body.');
  if (!Number.isFinite(o.trim?.front) || !Number.isFinite(o.trim?.rear)) throw Error('Set the trim line.');
  const b = bounds(mesh.positions);
  const cell = o.cell ?? Math.min(0.3, Math.max(0.08, b.size[0] / 450));
  const r = o.wall + o.sheet + o.allowance;
  const trimAt = (x) => o.trim.front + ((o.trim.rear - o.trim.front) * (x - b.min[0])) / (b.size[0] || 1);
  const lowTrim = Math.min(o.trim.front, o.trim.rear);

  // ---- the body seen from above
  const nx = Math.ceil(b.size[0] / cell) + 5,
    ny = Math.ceil(b.size[1] / cell) + 5;
  const x0 = b.min[0] - 2 * cell,
    y0 = b.min[1] - 2 * cell;
  const X = (i) => x0 + i * cell,
    Y = (j) => y0 + j * cell;
  const cast = rayCaster(mesh.positions, mesh.indices);
  const top = b.max[2] + 1;
  const H = new Float32Array(nx * ny).fill(-Infinity);
  const shoot = (i, j) => {
    const d = cast([X(i), Y(j), top], [0, 0, -1]);
    return d === Infinity ? -Infinity : top - d;
  };
  // A coarse look first, then every cell only where the roof is high enough to matter.
  const step = 4;
  let lo = [nx, ny], hi = [-1, -1];
  for (let i = 0; i < nx; i += step)
    for (let j = 0; j < ny; j += step) {
      const h = shoot(i, j);
      H[i * ny + j] = h;
      if (h >= lowTrim - r - 1) {
        lo = [Math.min(lo[0], i), Math.min(lo[1], j)];
        hi = [Math.max(hi[0], i), Math.max(hi[1], j)];
      }
    }
  if (hi[0] < 0) throw Error('The trim line is above the roof: lower it.');
  const pad = step + Math.ceil(r / cell) + 1;
  const I0 = Math.max(0, lo[0] - pad), I1 = Math.min(nx - 1, hi[0] + pad);
  const J0 = Math.max(0, lo[1] - pad), J1 = Math.min(ny - 1, hi[1] + pad);
  for (let i = I0; i <= I1; i++) for (let j = J0; j <= J1; j++) if (i % step || j % step) H[i * ny + j] = shoot(i, j);
  // Only the cabin counts: along the car between `cabin.from` and `cabin.to`,
  // and only where the body is on both sides of the spot at the trim line,
  // so not under a door mirror. (Along the car a ray can leave through a
  // wheel arch, so only the sides are asked.)
  const from = o.cabin?.from ?? -Infinity, to = o.cabin?.to ?? Infinity;
  const DIRS = [[0, 1, 0], [0, -1, 0]];
  for (let i = I0; i <= I1; i++) {
    const x = X(i);
    const t = trimAt(x);
    for (let j = J0; j <= J1; j++) {
      const k2 = i * ny + j;
      // Below the trim line nothing is cut off, and the true surface there
      // keeps the inward offset right where the cabin rises out of it.
      if (H[k2] < t) continue;
      if (x < from || x > to || DIRS.some((d) => cast([x, Y(j), t], d) === Infinity)) H[k2] = -Infinity;
    }
  }

  // ---- move inward by r: the deepest the ball can sit under the surface
  const R = Math.ceil(r / cell);
  const disk = [];
  for (let di = -R; di <= R; di++)
    for (let dj = -R; dj <= R; dj++) {
      const d2 = (di * di + dj * dj) * cell * cell;
      if (d2 <= r * r) disk.push([di, dj, Math.sqrt(r * r - d2)]);
    }
  const B = new Float32Array(nx * ny).fill(-Infinity);
  for (let i = I0; i <= I1; i++)
    for (let j = J0; j <= J1; j++) {
      if (H[i * ny + j] < lowTrim - r) continue;
      let m = Infinity;
      for (const [di, dj, h] of disk) {
        const a = i + di, c = j + dj;
        const v = a < 0 || c < 0 || a >= nx || c >= ny ? -Infinity : H[a * ny + c] - h;
        if (v < m) {
          m = v;
          if (m === -Infinity) break;
        }
      }
      // The highest a ball of radius r can sit with its centre here and stay
      // under the surface: its centre is then r inside the surface.
      B[i * ny + j] = m;
    }

  // ---- cut at the trim line, onto the skirt
  let fi0 = nx, fi1 = -1, fj0 = ny, fj1 = -1;
  for (let i = I0; i <= I1; i++)
    for (let j = J0; j <= J1; j++)
      if (B[i * ny + j] >= trimAt(X(i))) {
        fi0 = Math.min(fi0, i);
        fi1 = Math.max(fi1, i);
        fj0 = Math.min(fj0, j);
        fj1 = Math.max(fj1, j);
      }
  if (fi1 < 0) throw Error('Nothing of the cabin is above the trim line: lower it.');
  const k = o.draft > 0 ? 1 / Math.tan((o.draft * Math.PI) / 180) : Infinity;
  const spread = Math.ceil(((o.skirt + o.plinth) / Math.min(k, 1e6) + 1) / cell) + 2;
  const ci0 = Math.max(0, fi0 - spread), ci1 = Math.min(nx - 1, fi1 + spread);
  const cj0 = Math.max(0, fj0 - spread), cj1 = Math.min(ny - 1, fj1 + spread);
  const cx = ci1 - ci0 + 1, cy = cj1 - cj0 + 1;
  const F = new Float32Array(cx * cy);
  const G = new Float32Array(cx * cy); // B - trim, for the trim line
  let baseLow = Infinity;
  for (let a = 0; a < cx; a++)
    for (let c = 0; c < cy; c++) {
      const i = a + ci0, j = c + cj0;
      const t = trimAt(X(i));
      const v = B[i * ny + j];
      G[a * cy + c] = Number.isFinite(v) ? v - t : -1e3;
      F[a * cy + c] = v >= t ? v : t - o.skirt;
      baseLow = Math.min(baseLow, t - o.skirt);
    }
  // Draft: the sides lean out a little, so the sheet lets go.
  if (Number.isFinite(k)) {
    const nb = [[-1, -1], [-1, 0], [-1, 1], [0, -1]];
    const pass = (forward) => {
      for (let s = 0; s < cx * cy; s++) {
        const q = forward ? s : cx * cy - 1 - s;
        const a = Math.floor(q / cy), c = q % cy;
        for (const [da0, dc0] of nb) {
          const da = forward ? da0 : -da0, dc = forward ? dc0 : -dc0;
          const a2 = a + da, c2 = c + dc;
          if (a2 < 0 || c2 < 0 || a2 >= cx || c2 >= cy) continue;
          const v = F[a2 * cy + c2] - k * cell * Math.hypot(da, dc);
          if (v > F[q]) F[q] = v;
        }
      }
    };
    pass(true);
    pass(false);
  }
  const Fat = (x, y) => {
    const fa = (x - X(ci0)) / cell, fc = (y - Y(cj0)) / cell;
    if (fa < 0 || fc < 0 || fa > cx - 1 || fc > cy - 1) return -Infinity;
    const a = Math.min(cx - 2, Math.floor(fa)), c = Math.min(cy - 2, Math.floor(fc));
    const u = fa - a, v = fc - c;
    const f = (p, q) => F[(a + p) * cy + c + q];
    return f(0, 0) * (1 - u) * (1 - v) + f(1, 0) * u * (1 - v) + f(0, 1) * (1 - u) * v + f(1, 1) * u * v;
  };
  const Gat = (x, y) => {
    const a = Math.round((x - X(ci0)) / cell), c = Math.round((y - Y(cj0)) / cell);
    if (a < 0 || c < 0 || a >= cx || c >= cy) return -1;
    return G[a * cy + c];
  };

  // ---- the solid
  const pos = [], idx = [];
  for (let a = 0; a < cx; a++) for (let c = 0; c < cy; c++) pos.push(X(a + ci0), Y(c + cj0), F[a * cy + c]);
  const at = (a, c) => a * cy + c;
  for (let a = 0; a < cx - 1; a++)
    for (let c = 0; c < cy - 1; c++) {
      const p00 = at(a, c), p10 = at(a + 1, c), p11 = at(a + 1, c + 1), p01 = at(a, c + 1);
      // Split each square along its flatter diagonal.
      if (Math.abs(F[p00] - F[p11]) <= Math.abs(F[p10] - F[p01])) idx.push(p00, p10, p11, p00, p11, p01);
      else idx.push(p00, p10, p01, p10, p11, p01);
    }
  const bottom = baseLow - o.plinth;
  const ring = [];
  for (let a = 0; a < cx - 1; a++) ring.push(at(a, 0));
  for (let c = 0; c < cy - 1; c++) ring.push(at(cx - 1, c));
  for (let a = cx - 1; a > 0; a--) ring.push(at(a, cy - 1));
  for (let c = cy - 1; c > 0; c--) ring.push(at(0, c));
  const under = ring.map((v) => {
    pos.push(pos[v * 3], pos[v * 3 + 1], bottom);
    return pos.length / 3 - 1;
  });
  pos.push((X(ci0) + X(ci1)) / 2, (Y(cj0) + Y(cj1)) / 2, bottom);
  const centre = pos.length / 3 - 1;
  for (let n = 0; n < ring.length; n++) {
    const p = ring[n], q = ring[(n + 1) % ring.length], p2 = under[n], q2 = under[(n + 1) % ring.length];
    idx.push(p, p2, q2, p, q2, q, centre, q2, p2);
  }
  let solid = { positions: pos, indices: idx };
  if (o.reduce !== false) {
    // The height map is dense everywhere; thin it where it is flat, moving
    // the surface by no more than a hundredth of a millimetre.
    const r2 = applyReduce({ positions: Float32Array.from(pos), indices: Uint32Array.from(idx) }, { target: 0.15, tolerance: 0.01 });
    solid = { positions: Array.from(r2.positions), indices: Array.from(r2.indices) };
  }
  const pieces = [solid];

  // ---- trim line: where the cabin meets the skirt
  const trimLoops = contours(G, cx, cy, (a, c) => [X(a + ci0), Y(c + cj0)]).filter((l) => l.length > 8);
  const trimPoints = [];
  for (const l of trimLoops) for (const [x, y] of l) trimPoints.push([x, y, trimAt(x)]);
  if (o.guide > 0)
    for (const l of trimLoops) pieces.push(tube(l.map(([x, y]) => [x, y, trimAt(x)]), o.guide));

  // ---- window outlines on the buck, and the glue margin round them
  const warnings = [];
  const short = [];
  for (const w of o.outlines ?? []) {
    const d = norm(w.normal.map((x) => -x));
    const on = [];
    let missed = 0;
    for (const p of w.points) {
      const g = (s) => {
        const q = [p[0] + d[0] * s, p[1] + d[1] * s, p[2] + d[2] * s];
        return q[2] - Fat(q[0], q[1]);
      };
      // Walk in from the outer surface until under the buck's surface, then home in.
      let s0 = 0, s1 = null;
      const ds = cell * 0.5;
      for (let s = ds; s <= 3 * r + 1; s += ds) {
        if (g(s) <= 0) {
          s1 = s;
          break;
        }
        s0 = s;
      }
      if (s1 == null || g(s0) <= 0) {
        missed++;
        continue;
      }
      for (let it = 0; it < 30; it++) {
        const m = (s0 + s1) / 2;
        if (g(m) > 0) s0 = m;
        else s1 = m;
      }
      const q = [p[0] + d[0] * s1, p[1] + d[1] * s1, p[2] + d[2] * s1];
      on.push(q);
      // Glue margin: the formed sheet ends at the trim line.
      let near = q[2] < trimAt(q[0]) ? 0 : Infinity;
      for (const t of trimPoints) near = Math.min(near, Math.hypot(q[0] - t[0], q[1] - t[1], q[2] - t[2]));
      if (near < o.margin && !short.some((x) => Math.hypot(x[0] - p[0], x[1] - p[1], x[2] - p[2]) < 2)) short.push(p.slice());
    }
    if (missed > w.points.length * 0.1) warnings.push(`${w.name}: the outline is below the trim line or off the cabin, so the buck cannot show it`);
    else if (o.guide > 0 && on.length > 8) pieces.push(tube(on, o.guide));
  }
  if (short.length) warnings.push(`The glue margin is shorter than ${o.margin} mm in ${short.length} place${short.length === 1 ? '' : 's'} (marked on the car)`);

  // ---- posts through the insert
  const postHits = [];
  (o.posts ?? []).forEach((p, n) => {
    const i = Math.round((p.x - x0) / cell), j = Math.round((p.y - y0) / cell);
    if (i >= 0 && j >= 0 && i < nx && j < ny && B[i * ny + j] >= trimAt(p.x)) postHits.push(n);
  });
  if (postHits.length)
    warnings.push(`${postHits.length} post${postHits.length === 1 ? ' goes' : 's go'} through the glazing insert: drill the formed sheet there, or move ${postHits.length === 1 ? 'it' : 'them'} out of the cabin`);

  // ---- where the buck differs from the inside of the wall (undercuts, draft)
  const P = mesh.positions, T = mesh.indices;
  const faces = T.length / 3;
  const changed = []; // [x, y, z, how much], at least 2 mm apart
  let count = 0, most = 0;
  for (let f = 0; f < faces; f++) {
    const a = T[f * 3] * 3, b2 = T[f * 3 + 1] * 3, c = T[f * 3 + 2] * 3;
    const n = norm(cross([P[b2] - P[a], P[b2 + 1] - P[a + 1], P[b2 + 2] - P[a + 2]], [P[c] - P[a], P[c + 1] - P[a + 1], P[c + 2] - P[a + 2]]));
    const ce = [0, 1, 2].map((k2) => (P[a + k2] + P[b2 + k2] + P[c + k2]) / 3);
    const q = [ce[0] - n[0] * r, ce[1] - n[1] * r, ce[2] - n[2] * r];
    if (q[2] < trimAt(q[0]) + 0.2 || Gat(q[0], q[1]) < 0) continue;
    // The lowest the buck is right round this spot: on a steep side some of
    // it is outside, so only a real overhang (or draft) counts.
    let d = Infinity;
    for (const [dx, dy] of AROUND) d = Math.min(d, Fat(q[0] + dx * cell * 1.5, q[1] + dy * cell * 1.5) - q[2]);
    if (d > 0.1) {
      count++;
      most = Math.max(most, d);
      const near = changed.find((s) => Math.hypot(s[0] - ce[0], s[1] - ce[1], s[2] - ce[2]) < 2);
      if (!near) changed.push([ce[0], ce[1], ce[2], d]);
      else if (d > near[3]) near[3] = d;
    }
  }

  // ---- all pieces as one mesh, each piece facing outwards
  let positions = [], indices = [];
  for (const pc of pieces) {
    const off = positions.length / 3;
    const ind = pc.indices.slice();
    if (signedVolume(pc.positions, ind) < 0) for (let f = 0; f < ind.length; f += 3) [ind[f + 1], ind[f + 2]] = [ind[f + 2], ind[f + 1]];
    positions = positions.concat(pc.positions);
    for (const v of ind) indices.push(v + off);
  }
  const out = { positions: Float32Array.from(positions), indices: Uint32Array.from(indices) };
  const ob = bounds(out.positions);
  return {
    mesh: out,
    info: {
      cell,
      offset: r,
      size: ob.size,
      triangles: out.indices.length / 3,
      guides: pieces.length - 1,
      changed,
      changedCount: count,
      changedMost: most,
      short,
      postHits,
      warnings,
    },
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

// A thin closed tube along a closed line: a raised guide line once it sits
// half in the buck's surface.
export function tube(points, radius, sides = 6) {
  // Even spacing, so the rings do not bunch up.
  const pts = [];
  const spacing = Math.max(radius * 1.5, 0.2);
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    if (!pts.length || Math.hypot(a[0] - pts.at(-1)[0], a[1] - pts.at(-1)[1], a[2] - pts.at(-1)[2]) >= spacing) pts.push(a);
    for (let s = spacing; s < L; s += spacing) {
      const t = s / L;
      const q = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
      if (Math.hypot(q[0] - pts.at(-1)[0], q[1] - pts.at(-1)[1], q[2] - pts.at(-1)[2]) >= spacing) pts.push(q);
    }
  }
  const n = pts.length;
  const pos = [], idx = [];
  let prevN = null;
  for (let i = 0; i < n; i++) {
    const t = norm(pts[(i + 1) % n].map((x, k) => x - pts[(i - 1 + n) % n][k]));
    let N = prevN ? norm(prevN.map((x, k) => x - t[k] * dot(prevN, t))) : norm(cross(t, Math.abs(t[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0]));
    if (!Number.isFinite(N[0]) || Math.hypot(...N) < 0.5) N = norm(cross(t, [0, 1, 0]));
    prevN = N;
    const Bv = cross(t, N);
    for (let s = 0; s < sides; s++) {
      const a = (2 * Math.PI * s) / sides;
      pos.push(...[0, 1, 2].map((k) => pts[i][k] + radius * (Math.cos(a) * N[k] + Math.sin(a) * Bv[k])));
    }
  }
  for (let i = 0; i < n; i++)
    for (let s = 0; s < sides; s++) {
      const a0 = i * sides + s, a1 = i * sides + ((s + 1) % sides);
      const b0 = ((i + 1) % n) * sides + s, b1 = ((i + 1) % n) * sides + ((s + 1) % sides);
      idx.push(a0, b0, b1, a0, b1, a1);
    }
  return { positions: pos, indices: idx };
}

// Closed lines where a grid value crosses 0 (marching squares), as lists of
// [x, y]. at(a, c) gives the place of grid point a, c.
function contours(G, cx, cy, at) {
  const segs = [];
  const v = (a, c) => G[a * cy + c];
  const edge = (a1, c1, a2, c2) => {
    const f1 = v(a1, c1), f2 = v(a2, c2);
    const t = f1 / (f1 - f2);
    const p = at(a1, c1), q = at(a2, c2);
    return [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, `${a1},${c1},${a2},${c2}`];
  };
  for (let a = 0; a < cx - 1; a++)
    for (let c = 0; c < cy - 1; c++) {
      const s = [v(a, c) >= 0, v(a + 1, c) >= 0, v(a + 1, c + 1) >= 0, v(a, c + 1) >= 0];
      const crossings = [];
      if (s[0] !== s[1]) crossings.push(edge(a, c, a + 1, c));
      if (s[1] !== s[2]) crossings.push(edge(a + 1, c, a + 1, c + 1));
      if (s[2] !== s[3]) crossings.push(edge(a, c + 1, a + 1, c + 1));
      if (s[3] !== s[0]) crossings.push(edge(a, c, a, c + 1));
      if (crossings.length === 2) segs.push(crossings);
      else if (crossings.length === 4) segs.push([crossings[0], crossings[1]], [crossings[2], crossings[3]]);
    }
  // Chain the pieces by their shared grid edges.
  const byKey = new Map();
  segs.forEach((s, n) => {
    for (const p of s) (byKey.get(p[2]) ?? byKey.set(p[2], []).get(p[2])).push(n);
  });
  const used = new Uint8Array(segs.length);
  const loops = [];
  for (let n = 0; n < segs.length; n++) {
    if (used[n]) continue;
    used[n] = 1;
    const line = [segs[n][0], segs[n][1]];
    for (;;) {
      const key = line.at(-1)[2];
      const nextSeg = (byKey.get(key) ?? []).find((m) => !used[m]);
      if (nextSeg === undefined) break;
      used[nextSeg] = 1;
      const s = segs[nextSeg];
      line.push(s[0][2] === key ? s[1] : s[0]);
    }
    if (line.at(-1)[2] === line[0][2]) line.pop();
    loops.push(line.map(([x, y]) => [x, y]));
  }
  return loops;
}
