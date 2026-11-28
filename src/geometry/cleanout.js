// Clean out: everything of a body that is not its outside goes, before
// Hollow builds the new wall. The car is taken as a solid (the space its
// outside closes in), shrunk by the wall; what is in that shrunk car, and
// everything straight below it, is cut away: seats, a dashboard, an old
// inner skin, closed wheel arches, a floor. Left is the outer skin, with the
// underside open, ready for an even wall inwards. The outside never moves:
// only the old triangles inside the cut-away space go, the cut follows its
// edge.
//
// The solid: on a grid, a spot is inside the car when the body is above it
// and on at least three of its four sides (along and across the car); an
// open window or an open wheel arch lets one side out, which still counts as
// inside. Its depth: how far it is from the nearest spot outside.
// Car frame: X along, Y across, Z up.
import { clip } from './arches.js';
import { bounds } from './bounds.js';
import { rayCaster } from './rays.js';
import { pairEdges, partsOf } from './topology.js';
import { keepTaped } from './tape.js';

// opts: { wall (the thickest wall the body gets), cell (grid size; from the
// body's size when left out) }. Returns { mesh, info: { removed, cell } }.
export function cleanOut(mesh, { wall, cell = null, tape = null }) {
  if (!(wall > 0)) throw Error('Enter a wall thickness above 0.');
  const P = mesh.positions, T = mesh.indices;
  const b = bounds(P);
  const h = cell ?? Math.min(1, Math.max(0.3, Math.max(...b.size) / 360));
  const pad = 2;
  const o = b.min.map((v) => v - pad * h);
  const [nx, ny, nz] = b.size.map((s) => Math.ceil(s / h) + 2 * pad + 1);
  const X = (i) => o[0] + i * h, Y = (j) => o[1] + j * h, Z = (k) => o[2] + k * h;
  const at = (i, j, k) => (k * ny + j) * nx + i;
  const cast = rayCaster(P, T);
  const far = Math.hypot(...b.size) + 10;

  // ---- the first surface from each end of every grid line
  // Up: the top of each column. Along and across: both ends of each row.
  const top = new Float32Array(nx * ny).fill(-Infinity);
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      const t = cast([X(i), Y(j), b.max[2] + 5], [0, 0, -1]);
      if (t < far) top[j * nx + i] = b.max[2] + 5 - t;
    }
  const xLo = new Float32Array(ny * nz).fill(Infinity), xHi = new Float32Array(ny * nz).fill(-Infinity);
  for (let k = 0; k < nz; k++)
    for (let j = 0; j < ny; j++) {
      const a = cast([b.min[0] - 5, Y(j), Z(k)], [1, 0, 0]);
      if (a < far) {
        xLo[k * ny + j] = b.min[0] - 5 + a;
        xHi[k * ny + j] = b.max[0] + 5 - cast([b.max[0] + 5, Y(j), Z(k)], [-1, 0, 0]);
      }
    }
  const yLo = new Float32Array(nx * nz).fill(Infinity), yHi = new Float32Array(nx * nz).fill(-Infinity);
  for (let k = 0; k < nz; k++)
    for (let i = 0; i < nx; i++) {
      const a = cast([X(i), b.min[1] - 5, Z(k)], [0, 1, 0]);
      if (a < far) {
        yLo[k * nx + i] = b.min[1] - 5 + a;
        yHi[k * nx + i] = b.max[1] + 5 - cast([X(i), b.max[1] + 5, Z(k)], [0, -1, 0]);
      }
    }

  // ---- inside the car: the body above, and on three of the four sides
  const N = nx * ny * nz;
  const inside = new Uint8Array(N);
  let count = 0;
  for (let k = 0; k < nz; k++) {
    const z = Z(k);
    for (let j = 0; j < ny; j++) {
      const y = Y(j);
      const xl = xLo[k * ny + j], xh = xHi[k * ny + j];
      for (let i = 0; i < nx; i++) {
        if (!(z < top[j * nx + i])) continue;
        const x = X(i);
        const yl = yLo[k * nx + i], yh = yHi[k * nx + i];
        const sides = (x > xl) + (x < xh) + (y > yl) + (y < yh);
        if (sides >= 3) {
          inside[at(i, j, k)] = 1;
          count++;
        }
      }
    }
  }
  if (!count) return { mesh, info: { removed: 0, cell: h } };

  // ---- depth: the distance to the nearest spot outside (squared, exact,
  // one axis at a time)
  const D = new Float32Array(N);
  const INF = 1e20;
  for (let q = 0; q < N; q++) D[q] = inside[q] ? INF : 0;
  const line = new Float64Array(Math.max(nx, ny, nz)), out = new Float64Array(line.length);
  const v = new Int32Array(line.length + 1), zz = new Float64Array(line.length + 2);
  const edt1 = (n) => {
    // Felzenszwalb and Huttenlocher's lower envelope of parabolas.
    let k = 0;
    v[0] = 0;
    zz[0] = -INF;
    zz[1] = INF;
    for (let q = 1; q < n; q++) {
      let s;
      for (;;) {
        const p = v[k];
        s = (line[q] + q * q - (line[p] + p * p)) / (2 * q - 2 * p);
        if (s <= zz[k] && k > 0) k--;
        else break;
      }
      if (s <= zz[k]) {
        v[0] = q;
        zz[0] = -INF;
        zz[1] = INF;
        k = 0;
        continue;
      }
      k++;
      v[k] = q;
      zz[k] = s;
      zz[k + 1] = INF;
    }
    k = 0;
    for (let q = 0; q < n; q++) {
      while (zz[k + 1] < q) k++;
      const p = v[k];
      out[q] = (q - p) * (q - p) + line[p];
    }
  };
  for (let k = 0; k < nz; k++)
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) line[i] = D[at(i, j, k)];
      edt1(nx);
      for (let i = 0; i < nx; i++) D[at(i, j, k)] = out[i];
    }
  for (let k = 0; k < nz; k++)
    for (let i = 0; i < nx; i++) {
      for (let j = 0; j < ny; j++) line[j] = D[at(i, j, k)];
      edt1(ny);
      for (let j = 0; j < ny; j++) D[at(i, j, k)] = out[j];
    }
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      for (let k = 0; k < nz; k++) line[k] = D[at(i, j, k)];
      edt1(nz);
      for (let k = 0; k < nz; k++) D[at(i, j, k)] = Math.sqrt(out[k]) * h;
    }

  // ---- what goes: the shrunk car (deeper than the wall), grown out from
  // there to a thin layer under the outside (only the outer skin is needed:
  // Hollow builds the wall from it; an old inner wall goes too, however
  // thin), and all below it. A part thinner than two walls (a wing, a
  // mirror) has nothing that deep and stays as it is.
  const keep = Math.max(0.3, 1.5 * h);
  const gone = new Uint8Array(N);
  const queue = [];
  for (let q = 0; q < N; q++) if (D[q] > wall + h) (gone[q] = 1), queue.push(q);
  for (let n = 0; n < queue.length; n++) {
    const q = queue[n];
    const i = q % nx, j = Math.floor(q / nx) % ny, k = Math.floor(q / (nx * ny));
    for (const [di, dj, dk] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
      const a = i + di, c = j + dj, e = k + dk;
      if (a < 0 || c < 0 || e < 0 || a >= nx || c >= ny || e >= nz) continue;
      const r = at(a, c, e);
      if (!gone[r] && D[r] > keep) (gone[r] = 1), queue.push(r);
    }
  }
  // As a field for the cut: how far in past the thin layer, where it goes.
  for (let q = 0; q < N; q++) D[q] = gone[q] ? D[q] - keep : Math.min(0, D[q] - keep) - h;
  const roof = new Float32Array(nx * ny).fill(-1e6); // the cut-away space's top, per column
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++)
      for (let k = nz - 1; k >= 0; k--)
        if (gone[at(i, j, k)]) {
          roof[j * nx + i] = Z(k);
          break;
        }
  // The outside seen from the sides and the ends stays: where a sideways
  // ray from outside first meets the body, and that is no more than `tuck`
  // in from the furthest out the body reaches above it there (a door or a
  // bumper tucking in below its widest point). An arch's inner wall, seen
  // through the arch, lies well in from the wing above it, and goes.
  const tuck = Math.max(4, 3 * wall);
  const band = Math.max(0.3, 1.5 * h);
  // Per row: does its first meeting from that side count as the outside?
  // Going down row by row the outside steps in gradually; a jump (a ray
  // through a window opening onto the inside) does not count, nor what
  // follows it until the rows come back out to the outside.
  const step = Math.max(1.5, 3 * h);
  const outerAbove = (lo, rows, cols, out) => {
    const flag = new Uint8Array(rows * cols);
    for (let c = 0; c < cols; c++) {
      let best = out > 0 ? -Infinity : Infinity; // furthest out so far, from the top down
      let prev = null, prevOk = false;
      for (let k = rows - 1; k >= 0; k--) {
        const v = lo[k * cols + c];
        if (!Number.isFinite(v)) {
          prev = null;
          prevOk = false;
          continue;
        }
        if (out > 0 ? v > best : v < best) best = v;
        const ok = Math.abs(v - best) <= tuck && (Math.abs(v - best) <= step || (prevOk && Math.abs(v - prev) <= step));
        if (ok) flag[k * cols + c] = 1;
        prev = v;
        prevOk = ok;
      }
    }
    return flag;
  };
  const okYLo = outerAbove(yLo, nz, nx, -1), okYHi = outerAbove(yHi, nz, nx, 1);
  const okXLo = outerAbove(xLo, nz, ny, -1), okXHi = outerAbove(xHi, nz, ny, 1);
  const lerp = (a, b2, t) => a + (b2 - a) * t;
  // > 0 where the body goes.
  const f = (p) => {
    const fi = (p[0] - o[0]) / h, fj = (p[1] - o[1]) / h, fk = (p[2] - o[2]) / h;
    if (fi < 0 || fj < 0 || fk < 0 || fi > nx - 1.001 || fj > ny - 1.001 || fk > nz - 1.001) return -1;
    const i = Math.floor(fi), j = Math.floor(fj), k = Math.floor(fk);
    const u = fi - i, w = fj - j, s = fk - k;
    const d = (a, c, e) => D[at(i + a, j + c, k + e)];
    const depth = lerp(lerp(lerp(d(0, 0, 0), d(1, 0, 0), u), lerp(d(0, 1, 0), d(1, 1, 0), u), w), lerp(lerp(d(0, 0, 1), d(1, 0, 1), u), lerp(d(0, 1, 1), d(1, 1, 1), u), w), s);
    // Straight below the cut-away space: a column counts where all four
    // round the spot reach down here (so the cut stays inside the wall).
    const r = Math.min(roof[j * nx + i], roof[j * nx + i + 1], roof[(j + 1) * nx + i], roof[(j + 1) * nx + i + 1]);
    let go = Math.max(depth, r - p[2]);
    // Never the outside seen from a side or an end (see above).
    const ii = Math.round(fi), jj = Math.round(fj), kk = Math.round(fk);
    const keepIf = (ok, lo, idx, d) => {
      if (ok[idx]) go = Math.min(go, d - band);
    };
    keepIf(okYLo, yLo, kk * nx + ii, p[1] - yLo[kk * nx + ii]);
    keepIf(okYHi, yHi, kk * nx + ii, yHi[kk * nx + ii] - p[1]);
    keepIf(okXLo, xLo, kk * ny + jj, p[0] - xLo[kk * ny + jj]);
    keepIf(okXHi, xHi, kk * ny + jj, xHi[kk * ny + jj] - p[0]);
    return go;
  };
  // Every corner kept at its own number (the new ones after), so each
  // piece left can tell which part of the model it came from.
  const cut = clip(mesh, keepTaped(f, tape), false, false);
  const V0 = P.length / 3;
  // Bits left floating once their surroundings went: a piece cut off the
  // body itself (a scrap of a sill, a flare's lip) goes; parts the model
  // had on their own (glass, a mirror) stay unless tiny.
  const orig = partsOf(T.length / 3, pairEdges(T, P.length / 3, P).twins);
  let mainOrig = 0;
  orig.sizes.forEach((x, i) => x > orig.sizes[mainOrig] && (mainOrig = i));
  const partOfVertex = new Int32Array(V0).fill(-1);
  for (let t = 0; t < T.length / 3; t++) for (let k = 0; k < 3; k++) partOfVertex[T[t * 3 + k]] = orig.part[t];
  const { twins } = pairEdges(cut.indices, cut.positions.length / 3, cut.positions);
  const { part, sizes } = partsOf(cut.indices.length / 3, twins);
  let biggest = 0;
  sizes.forEach((x, i) => x > sizes[biggest] && (biggest = i));
  const from = new Int32Array(sizes.length).fill(-1);
  for (let t = 0; t < part.length; t++) {
    if (from[part[t]] >= 0) continue;
    for (let k = 0; k < 3; k++) {
      const v = cut.indices[t * 3 + k];
      if (v < V0 && partOfVertex[v] >= 0) {
        from[part[t]] = partOfVertex[v];
        break;
      }
    }
  }
  const kept = [];
  for (let t = 0; t < part.length; t++) {
    const p = part[t];
    const offBody = p !== biggest && from[p] === mainOrig;
    if (!offBody && sizes[p] >= Math.max(8, sizes[biggest] * 0.002)) kept.push(cut.indices[t * 3], cut.indices[t * 3 + 1], cut.indices[t * 3 + 2]);
  }
  const map = new Int32Array(cut.positions.length / 3).fill(-1);
  let n = 0;
  for (const x of kept) if (map[x] < 0) map[x] = n++;
  const positions = new Float32Array(n * 3);
  for (let x = 0; x < map.length; x++) if (map[x] >= 0) positions.set(cut.positions.subarray(x * 3, x * 3 + 3), map[x] * 3);
  const indices = Uint32Array.from(kept, (x) => map[x]);
  return { mesh: { positions, indices }, info: { removed: T.length / 3 - indices.length / 3, cell: h } };
}
