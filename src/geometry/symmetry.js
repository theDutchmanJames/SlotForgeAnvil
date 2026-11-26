// Symmetrize: keep one side of the car and mirror it over the other, so both
// sides match exactly. The model is cut on the centre line (Y = at), the side
// that goes is dropped, and the mirrored copy is joined to the kept side
// along the cut, so a closed model stays closed. Car frame: +Y right.
import { BufferAttribute, BufferGeometry, Vector3 } from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { applySlice, bounds } from './engine.js';

// keep: 'left' (Y below the line) or 'right'. at: the centre line.
export function applySymmetrize(mesh, { keep, at = 0 }) {
  if (keep !== 'left' && keep !== 'right') throw Error('Choose which side to keep.');
  if (!Number.isFinite(at)) throw Error('Set the centre line.');
  const half = applySlice(mesh, { axis: 'y', at, keep: keep === 'left' ? 'below' : 'above' });
  const P = half.positions, T = half.indices;
  const V = P.length / 3;
  // On the line: the cut, where the two halves join. Those corners are shared.
  const tol = 1e-5 * Math.max(1, Math.abs(at)) + 1e-6;
  const onLine = (v) => Math.abs(P[v * 3 + 1] - at) <= tol;
  // Corners on the line in the same place are one corner (a file may have
  // two there, which would leave a crack along the join).
  const same = new Int32Array(V);
  const seen = new Map();
  for (let v = 0; v < V; v++) {
    same[v] = v;
    if (!onLine(v)) continue;
    const key = `${P[v * 3].toFixed(5)},${P[v * 3 + 2].toFixed(5)}`;
    const first = seen.get(key);
    if (first === undefined) seen.set(key, v);
    else same[v] = first;
  }
  const map = new Int32Array(V);
  const pos = Array.from(P);
  for (let v = 0; v < V; v++) {
    if (onLine(v)) {
      map[v] = same[v];
      pos[v * 3 + 1] = at;
      continue;
    }
    map[v] = pos.length / 3;
    pos.push(P[v * 3], 2 * at - P[v * 3 + 1], P[v * 3 + 2]);
  }
  const idx = [];
  const tri = (a, b, c) => {
    // A triangle that collapsed to a line goes.
    if (a !== b && b !== c && a !== c) idx.push(a, b, c);
  };
  for (let f = 0; f < T.length; f += 3) tri(same[T[f]], same[T[f + 1]], same[T[f + 2]]);
  for (let f = 0; f < T.length; f += 3) {
    const a = T[f], b = T[f + 1], c = T[f + 2];
    // A triangle lying on the line itself is there once already.
    if (onLine(a) && onLine(b) && onLine(c)) continue;
    // Mirrored: turned round, so it still faces out.
    tri(map[a], map[c], map[b]);
  }
  return { positions: Float32Array.from(pos), indices: Uint32Array.from(idx), info: { kept: keep, at } };
}

// How well the two sides match about the line Y = at: corners of one side,
// mirrored, against the surface. Returns the typical and the largest
// difference (mm), from a spread of samples.
function mismatch(bvh, P, at, samples) {
  const p = new Vector3(), target = {};
  const d = [];
  for (const v of samples) {
    const hit = bvh.closestPointToPoint(p.set(P[v * 3], 2 * at - P[v * 3 + 1], P[v * 3 + 2]), target);
    if (hit) d.push(hit.distance);
  }
  const mean = d.reduce((s, x) => s + x, 0) / Math.max(d.length, 1);
  d.sort((a, b) => a - b);
  return { mean, typical: d[Math.floor(d.length / 2)] ?? 0, most: d[Math.floor(d.length * 0.98)] ?? 0 };
}

// The centre line where the two sides match best, near Y = 0, and how much
// the sides differ about it and about Y = 0.
export function symmetryReport(mesh, count = 1500) {
  const P = mesh.positions;
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(P, 3));
  geo.setIndex(new BufferAttribute(Uint32Array.from(mesh.indices), 1));
  const bvh = new MeshBVH(geo);
  const V = P.length / 3;
  const step = Math.max(1, Math.floor(V / count));
  const samples = [];
  for (let v = 0; v < V; v += step) samples.push(v);
  const w = bounds(P).size[1];
  // Coarse search over ±5% of the width, then finer round the best.
  // The average difference: the middle one is often 0 whatever the line, as
  // the roof and the ends mirror onto themselves.
  let best = 0, bestScore = mismatch(bvh, P, 0, samples).mean;
  for (let span = w * 0.05, round = 0; round < 3; round++, span /= 8) {
    const centre = best;
    for (let i = -8; i <= 8; i++) {
      const c = centre + (span * i) / 8;
      const s = mismatch(bvh, P, c, samples).mean;
      if (s < bestScore - 1e-9) {
        bestScore = s;
        best = c;
      }
    }
  }
  return { best, atBest: mismatch(bvh, P, best, samples), atZero: mismatch(bvh, P, 0, samples) };
}
