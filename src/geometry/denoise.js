// Smooth scan: takes the grain out of a scanned surface and straightens the
// ragged rims around openings and cut edges, without rounding creases or
// shrinking the body. No point moves further than it is allowed to, the
// triangles stay as they are (a closed mesh stays closed) and none turns over.
//
// 1. Bilateral normal filtering: each triangle's direction becomes the
//    average of its neighbours' that already point about the same way. Grain
//    goes, a crease keeps its two sides apart.
// 2. Crease lines (where the cleaned directions meet at an angle), such as
//    rims, are straightened across the line only, and the surface beside them
//    follows, fading out.
// 3. The points move to fit the cleaned directions (Sun et al. 2007).
//
// Every move is checked: one that would turn a triangle over, or stand it on
// edge, is halved or left out.
//
// params: { strength (1-10), tolerance (mm, the surface), rim (mm, rims and
//           creases), edges (straighten rims), protect }
import { pairEdges } from './topology.js';
import { rayCaster } from './rays.js';
import { classifySkins } from './shell.js';

const CREASE = Math.cos((30 * Math.PI) / 180);
// A triangle may turn at most this far from how it faced in the file (75°).
const TURN = Math.cos((75 * Math.PI) / 180);

export function checkScanSmooth({ strength, tolerance, rim = tolerance }) {
  if (!(strength >= 1 && strength <= 10)) throw Error('Choose a strength from 1 to 10.');
  if (!(tolerance > 0) || !Number.isFinite(tolerance)) throw Error('Enter how far the surface may move, above 0.');
  if (!(rim > 0) || !Number.isFinite(rim)) throw Error('Enter how far the rims may move, above 0.');
}

export function applyScanSmooth(mesh, { strength = 4, tolerance = 0.1, rim = tolerance * 4, edges = true, protect = false }) {
  checkScanSmooth({ strength, tolerance, rim });
  const P0 = mesh.positions,
    P = Float32Array.from(P0),
    T = mesh.indices;
  const V = P.length / 3,
    F = T.length / 3;
  const rounds = Math.round(strength);

  // Triangles around each point.
  const vfStart = new Uint32Array(V + 1);
  for (let i = 0; i < T.length; i++) vfStart[T[i] + 1]++;
  for (let v = 0; v < V; v++) vfStart[v + 1] += vfStart[v];
  const vf = new Uint32Array(T.length),
    fill = vfStart.slice(0, V);
  for (let i = 0; i < T.length; i++) vf[fill[T[i]]++] = Math.floor(i / 3);

  // What may not move: points on open edges, and the outside when protected.
  const { twins } = pairEdges(T, V, P);
  const fixed = new Uint8Array(V);
  for (let e = 0; e < T.length; e++) if (twins[e] < 0) fixed[T[e]] = fixed[T[e % 3 === 2 ? e - 2 : e + 1]] = 1;
  if (protect) {
    const outer = classifySkins({ positions: P, indices: T }, rayCaster(P, T));
    for (let f = 0; f < F; f++) if (outer[f] === 1) for (let k = 0; k < 3; k++) fixed[T[f * 3 + k]] = 1;
  }

  // Direction (unit normal), area and centre of each triangle, as it is now.
  const N = new Float32Array(F * 3),
    A = new Float32Array(F),
    C = new Float32Array(F * 3);
  const faceNormal = (f, out, o) => {
    const a = T[f * 3] * 3, b = T[f * 3 + 1] * 3, c = T[f * 3 + 2] * 3;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
    const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz);
    if (l > 0) {
      out[o] = nx / l;
      out[o + 1] = ny / l;
      out[o + 2] = nz / l;
    }
    return l / 2;
  };
  const faces = () => {
    for (let f = 0; f < F; f++) {
      A[f] = faceNormal(f, N, f * 3);
      const a = T[f * 3] * 3, b = T[f * 3 + 1] * 3, c = T[f * 3 + 2] * 3;
      for (let k = 0; k < 3; k++) C[f * 3 + k] = (P[a + k] + P[b + k] + P[c + k]) / 3;
    }
  };
  faces();
  const N0 = Float32Array.from(N),
    A0 = Float32Array.from(A);

  // Move point v to (x, y, z), or as near as it safely goes: no further from
  // where it was than allow[v], and no triangle around it turned over.
  const allow = new Float32Array(V).fill(tolerance);
  const n1 = new Float32Array(3);
  const ok = (v) => {
    for (let i = vfStart[v]; i < vfStart[v + 1]; i++) {
      const f = vf[i];
      if (!(A0[f] > 0)) continue;
      const area = faceNormal(f, n1, 0);
      if (!(area > A0[f] * 0.05) || n1[0] * N0[f * 3] + n1[1] * N0[f * 3 + 1] + n1[2] * N0[f * 3 + 2] < TURN) return false;
    }
    return true;
  };
  let refused = 0;
  const moveTo = (v, x, y, z) => {
    let dx = x - P0[v * 3], dy = y - P0[v * 3 + 1], dz = z - P0[v * 3 + 2];
    const d = Math.hypot(dx, dy, dz);
    if (d > allow[v]) {
      const k = allow[v] / d;
      dx *= k;
      dy *= k;
      dz *= k;
    }
    const ox = P[v * 3], oy = P[v * 3 + 1], oz = P[v * 3 + 2];
    let tx = P0[v * 3] + dx, ty = P0[v * 3 + 1] + dy, tz = P0[v * 3 + 2] + dz;
    for (let tries = 0; tries < 3; tries++) {
      P[v * 3] = tx;
      P[v * 3 + 1] = ty;
      P[v * 3 + 2] = tz;
      if (ok(v)) return;
      tx = (tx + ox) / 2;
      ty = (ty + oy) / 2;
      tz = (tz + oz) / 2;
    }
    P[v * 3] = ox;
    P[v * 3 + 1] = oy;
    P[v * 3 + 2] = oz;
    refused++;
  };

  // 1. Cleaned directions.
  const sigma2 = 2 * 0.35 * 0.35;
  let M = Float32Array.from(N);
  for (let r = 0; r < rounds; r++) {
    const out = new Float32Array(F * 3);
    for (let f = 0; f < F; f++) {
      const mx = M[f * 3], my = M[f * 3 + 1], mz = M[f * 3 + 2];
      let sx = 0, sy = 0, sz = 0;
      for (let k = 0; k < 3; k++) {
        const v = T[f * 3 + k];
        for (let i = vfStart[v]; i < vfStart[v + 1]; i++) {
          const g = vf[i];
          const dx = M[g * 3] - mx, dy = M[g * 3 + 1] - my, dz = M[g * 3 + 2] - mz;
          const w = A[g] * Math.exp(-(dx * dx + dy * dy + dz * dz) / sigma2);
          sx += w * M[g * 3];
          sy += w * M[g * 3 + 1];
          sz += w * M[g * 3 + 2];
        }
      }
      const l = Math.hypot(sx, sy, sz) || 1;
      out[f * 3] = sx / l;
      out[f * 3 + 1] = sy / l;
      out[f * 3 + 2] = sz / l;
    }
    M = out;
  }

  // 2. Crease lines: points on exactly two crease edges are straightened
  // along them; where three or more meet (a corner) the point stays.
  const creaseCount = new Uint8Array(V),
    link = new Int32Array(V * 2).fill(-1);
  for (let e = 0; e < T.length; e++) {
    const t = twins[e];
    if (t < e) continue;
    const f = Math.floor(e / 3), g = Math.floor(t / 3);
    if (M[f * 3] * M[g * 3] + M[f * 3 + 1] * M[g * 3 + 1] + M[f * 3 + 2] * M[g * 3 + 2] >= CREASE) continue;
    const a = T[e], b = T[e % 3 === 2 ? e - 2 : e + 1];
    for (const [p, q] of [[a, b], [b, a]]) {
      if (creaseCount[p] < 2) link[p * 2 + creaseCount[p]] = q;
      if (creaseCount[p] < 255) creaseCount[p]++;
    }
  }
  const onCrease = new Uint8Array(V);
  const chain = [];
  for (let v = 0; v < V; v++) {
    if (!creaseCount[v]) continue;
    onCrease[v] = 1;
    if (creaseCount[v] === 2 && !fixed[v]) chain.push(v);
  }
  if (edges && chain.length) {
    for (const v of chain) allow[v] = rim;
    const next = new Float32Array(chain.length * 3);
    // Only across the line, never along it: a point sliding along a rim
    // would crowd the triangles beside it.
    const pass = (factor) => {
      chain.forEach((v, i) => {
        const a = link[v * 2], b = link[v * 2 + 1];
        let dx = (P[a * 3] + P[b * 3]) / 2 - P[v * 3],
          dy = (P[a * 3 + 1] + P[b * 3 + 1]) / 2 - P[v * 3 + 1],
          dz = (P[a * 3 + 2] + P[b * 3 + 2]) / 2 - P[v * 3 + 2];
        const tx = P[b * 3] - P[a * 3], ty = P[b * 3 + 1] - P[a * 3 + 1], tz = P[b * 3 + 2] - P[a * 3 + 2];
        const tt = tx * tx + ty * ty + tz * tz;
        const along = tt > 0 ? (dx * tx + dy * ty + dz * tz) / tt : 0;
        dx -= along * tx;
        dy -= along * ty;
        dz -= along * tz;
        next[i * 3] = P[v * 3] + factor * dx;
        next[i * 3 + 1] = P[v * 3 + 1] + factor * dy;
        next[i * 3 + 2] = P[v * 3 + 2] + factor * dz;
      });
      chain.forEach((v, i) => moveTo(v, next[i * 3], next[i * 3 + 1], next[i * 3 + 2]));
    };
    // Taubin: a step in and a slightly larger one out, so curves keep their
    // size. A rim waves over many points, so it takes many rounds.
    for (let r = 0; r < rounds * 25; r++) {
      pass(0.5);
      pass(-0.53);
    }
    // The surface beside a rim follows it, fading over three rings, so no
    // step appears next to it.
    const shift = new Float32Array(V * 3),
      ring = new Uint8Array(V);
    for (const v of chain) {
      ring[v] = 1;
      for (let k = 0; k < 3; k++) shift[v * 3 + k] = P[v * 3 + k] - P0[v * 3 + k];
    }
    let front = chain;
    for (const share of [0.7, 0.45 / 0.7, 0.2 / 0.45]) {
      const sums = new Map();
      for (const v of front)
        for (let i = vfStart[v]; i < vfStart[v + 1]; i++)
          for (let k = 0; k < 3; k++) {
            const u = T[vf[i] * 3 + k];
            if (ring[u] || fixed[u] || onCrease[u]) continue;
            let e = sums.get(u);
            if (!e) sums.set(u, (e = [0, 0, 0, 0]));
            e[0] += shift[v * 3];
            e[1] += shift[v * 3 + 1];
            e[2] += shift[v * 3 + 2];
            e[3]++;
          }
      for (const [u, e] of sums) {
        ring[u] = 1;
        for (let k = 0; k < 3; k++) shift[u * 3 + k] = (e[k] / e[3]) * share;
        allow[u] = tolerance + Math.hypot(shift[u * 3], shift[u * 3 + 1], shift[u * 3 + 2]);
        moveTo(u, P0[u * 3] + shift[u * 3], P0[u * 3 + 1] + shift[u * 3 + 1], P0[u * 3 + 2] + shift[u * 3 + 2]);
        for (let k = 0; k < 3; k++) shift[u * 3 + k] = P[u * 3 + k] - P0[u * 3 + k];
      }
      front = [...sums.keys()];
    }
  }

  // 3. Points follow the cleaned directions. Crease points keep where step 2
  // put them, so the lines stay straight and sharp.
  for (let r = 0; r < rounds * 4; r++) {
    faces();
    for (let v = 0; v < V; v++) {
      if (fixed[v] || onCrease[v]) continue;
      const n = vfStart[v + 1] - vfStart[v];
      if (!n) continue;
      const x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2];
      let dx = 0, dy = 0, dz = 0;
      for (let i = vfStart[v]; i < vfStart[v + 1]; i++) {
        const f = vf[i];
        const mx = M[f * 3], my = M[f * 3 + 1], mz = M[f * 3 + 2];
        const d = mx * (C[f * 3] - x) + my * (C[f * 3 + 1] - y) + mz * (C[f * 3 + 2] - z);
        dx += mx * d;
        dy += my * d;
        dz += mz * d;
      }
      moveTo(v, x + dx / n, y + dy / n, z + dz / n);
    }
  }

  // Backstop: a triangle that still turned over (a neighbour moved after its
  // check) goes back to where it was.
  let folded = 0;
  for (let round = 0; round < 6; round++) {
    const back = new Set();
    for (let f = 0; f < F; f++) {
      if (!(A0[f] > 0)) continue;
      faceNormal(f, n1, 0);
      if (n1[0] * N0[f * 3] + n1[1] * N0[f * 3 + 1] + n1[2] * N0[f * 3 + 2] <= 0) for (let k = 0; k < 3; k++) back.add(T[f * 3 + k]);
    }
    if (!round) folded = back.size;
    if (!back.size) break;
    for (const v of back) for (let k = 0; k < 3; k++) P[v * 3 + k] = P0[v * 3 + k];
  }

  let most = 0, sum = 0, moved = 0;
  for (let v = 0; v < V; v++) {
    const d = Math.hypot(P[v * 3] - P0[v * 3], P[v * 3 + 1] - P0[v * 3 + 1], P[v * 3 + 2] - P0[v * 3 + 2]);
    if (d > 1e-6) moved++;
    sum += d;
    most = Math.max(most, d);
  }
  return {
    positions: P,
    indices: T,
    info: { moved, most, mean: V ? sum / V : 0, creasePoints: edges ? chain.length : 0, refused, restored: folded },
  };
}
