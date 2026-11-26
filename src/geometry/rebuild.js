// Rebuild: a broken or overlapping model made again as one clean, closed
// surface. Nothing of the old triangles is kept: Anvil works out what space
// the model fills on a fine grid, wraps a new surface round that, puts the new
// corners back on the old surface, and thins out the triangles.
//
// Inside or outside: rays along each of the three axes, counted from both
// ends (six guesses). Each surface crossed counts by which way it faces, so
// overlapping parts add up (they merge) and a hole only spoils the guesses
// that pass through it. A grid point is inside when most guesses say so.
import { BufferAttribute, BufferGeometry, Vector3 } from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { bounds } from './bounds.js';
import { applyReduce } from './reduce.js';
import { pairEdges, partsOf } from './topology.js';

// The grid: points o + i·h, padded so the surface never touches the edge.
export function rebuildGrid(b, h) {
  const pad = 2;
  const o = b.min.map((v) => v - pad * h);
  const n = b.size.map((s) => Math.ceil(s / h) + 2 * pad + 1);
  return { o, n, h };
}

// Grid size for a detail level: a share of the model's diagonal.
export const REBUILD_DETAIL = { coarse: 220, normal: 340, fine: 500 };
export const rebuildCell = (b, detail = 'normal') => Math.hypot(...b.size) / (REBUILD_DETAIL[detail] ?? REBUILD_DETAIL.normal);

// params: { cell } the grid size in mm (from the detail level, kept in the step).
export function applyRebuild(mesh, { cell }) {
  if (!(cell > 0)) throw Error('Choose a detail level.');
  const b = bounds(mesh.positions);
  const grid = rebuildGrid(b, cell);
  const votes = insideVotes(mesh, grid);
  const [nx, ny, nz] = grid.n;
  // Inside: most of the six guesses agree.
  const s = votes;
  let inside = 0;
  for (let i = 0; i < s.length; i++) {
    s[i] = s[i] >= 4 ? 1 : 0;
    inside += s[i];
  }
  if (!inside) throw Error('Nothing to rebuild: this model encloses no space. A single surface needs a wall first (Shell › Hollow).');
  wellComposed(s, grid.n);
  let out = surfaceNets(s, grid);
  // Each new corner back onto the old surface, if that is near.
  snapTo(out, mesh, cell);
  const before = out.indices.length / 3;
  // Thin out: the surface may move a fifth of a grid cell at most.
  out = applyReduce(out, { target: 0.02, tolerance: cell * 0.2 });
  // Specks: lone bits of grid the rays got wrong.
  const kept = dropSpecks(out);
  return { positions: kept.positions, indices: kept.indices, info: { cell, made: before, triangles: kept.indices.length / 3, specks: kept.specks } };
}

// A grid cell where the inside corners (or the outside ones) fall apart into
// more than one group along the cell's edges holds two sheets of surface
// through one point: alternating corners round a face (an edge shared by four
// triangles) or two opposite corners of the cell (a pinch). Such cells are
// filled in (the space only grows, so this ends). SPLIT[mask] says which
// corner patterns do that.
const CELL_EDGES = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
const SPLIT = (() => {
  const groups = (mask, want) => {
    const root = [0, 1, 2, 3, 4, 5, 6, 7];
    const find = (a) => (root[a] === a ? a : (root[a] = find(root[a])));
    for (const [a, b] of CELL_EDGES) if (((mask >> a) & 1) === want && ((mask >> b) & 1) === want) root[find(a)] = find(b);
    const set = new Set();
    for (let k = 0; k < 8; k++) if (((mask >> k) & 1) === want) set.add(find(k));
    return set.size;
  };
  const t = new Uint8Array(256);
  for (let m = 0; m < 256; m++) t[m] = groups(m, 1) > 1 || groups(m, 0) > 1 ? 1 : 0;
  return t;
})();

function wellComposed(s, [nx, ny, nz]) {
  const sx = 1, sy = nx, sz = nx * ny;
  const offs = [0, sx, sy, sx + sy, sz, sx + sz, sy + sz, sx + sy + sz];
  for (let round = 0; round < 30; round++) {
    let changed = 0;
    for (let z = 0; z + 1 < nz; z++)
      for (let y = 0; y + 1 < ny; y++)
        for (let x = 0; x + 1 < nx; x++) {
          const p = x + nx * (y + ny * z);
          let mask = 0;
          for (let k = 0; k < 8; k++) if (s[p + offs[k]]) mask |= 1 << k;
          if (!SPLIT[mask]) continue;
          for (let k = 0; k < 8; k++) s[p + offs[k]] = 1;
          changed++;
        }
    if (!changed) return;
  }
}

// One new corner in every grid cell the surface passes through, in the middle
// of where it crosses the cell's edges; four of them round every grid edge
// that goes from inside to outside make a square of the new surface.
function surfaceNets(s, { o, n: [nx, ny, nz], h }) {
  const pos = [], idx = [];
  const cx = nx - 1, cy = ny - 1;
  let prev = new Int32Array(cx * cy).fill(-1), cur = new Int32Array(cx * cy).fill(-1);
  const at = (x, y, z) => s[x + nx * (y + ny * z)];
  const EDGES = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  const corner = (k) => [k & 1, (k >> 1) & 1, (k >> 2) & 1];
  const quad = (a, b, c, d) => {
    // Split along the shorter diagonal.
    const dist = (u, v) => (pos[u * 3] - pos[v * 3]) ** 2 + (pos[u * 3 + 1] - pos[v * 3 + 1]) ** 2 + (pos[u * 3 + 2] - pos[v * 3 + 2]) ** 2;
    if (dist(a, c) <= dist(b, d)) idx.push(a, b, c, a, c, d);
    else idx.push(a, b, d, b, c, d);
  };
  for (let z = 0; z < nz - 1; z++) {
    [prev, cur] = [cur, prev];
    cur.fill(-1);
    for (let y = 0; y < ny - 1; y++)
      for (let x = 0; x < nx - 1; x++) {
        let mask = 0;
        for (let k = 0; k < 8; k++) if (at(x + (k & 1), y + ((k >> 1) & 1), z + ((k >> 2) & 1))) mask |= 1 << k;
        if (mask === 0 || mask === 255) continue;
        // The corner: the middle of the crossings on the cell's edges.
        let px = 0, py = 0, pz = 0, m = 0;
        for (const [e0, e1] of EDGES) {
          if (!((mask >> e0) & 1) === !((mask >> e1) & 1)) continue;
          const A = corner(e0), B = corner(e1);
          px += (A[0] + B[0]) / 2;
          py += (A[1] + B[1]) / 2;
          pz += (A[2] + B[2]) / 2;
          m++;
        }
        const id = pos.length / 3;
        pos.push(o[0] + (x + px / m) * h, o[1] + (y + py / m) * h, o[2] + (z + pz / m) * h);
        cur[x + cx * y] = id;
        // Squares round the three grid edges leaving this cell's lowest corner.
        const inside0 = mask & 1;
        // Along x: the edge (x,y,z)→(x+1,y,z); cells round it: here, y-1, z-1, both.
        if (y > 0 && z > 0 && inside0 !== ((mask >> 1) & 1)) {
          const a = id, b = cur[x + cx * (y - 1)], c = prev[x + cx * (y - 1)], d = prev[x + cx * y];
          inside0 ? quad(a, b, c, d) : quad(a, d, c, b);
        }
        // Along y: (x,y,z)→(x,y+1,z); cells round it: here, z-1, x-1, both.
        if (z > 0 && x > 0 && inside0 !== ((mask >> 2) & 1)) {
          const a = id, b = prev[x + cx * y], c = prev[x - 1 + cx * y], d = cur[x - 1 + cx * y];
          inside0 ? quad(a, b, c, d) : quad(a, d, c, b);
        }
        // Along z: (x,y,z)→(x,y,z+1); cells round it: here, x-1, y-1, both.
        if (x > 0 && y > 0 && inside0 !== ((mask >> 4) & 1)) {
          const a = id, b = cur[x - 1 + cx * y], c = cur[x - 1 + cx * (y - 1)], d = cur[x + cx * (y - 1)];
          inside0 ? quad(a, b, c, d) : quad(a, d, c, b);
        }
      }
  }
  const out = { positions: Float32Array.from(pos), indices: Uint32Array.from(idx) };
  // Facing: the volume must come out positive; else turn every triangle round.
  let vol = 0;
  const p = out.positions, t = out.indices;
  for (let f = 0; f < t.length; f += 3) {
    const a = t[f] * 3, b = t[f + 1] * 3, c = t[f + 2] * 3;
    vol += p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1]) - p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c]) + p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c]);
  }
  if (vol < 0) for (let f = 0; f < t.length; f += 3) [t[f + 1], t[f + 2]] = [t[f + 2], t[f + 1]];
  return out;
}

// Each new corner moves to the nearest point of the old surface, when that is
// within a grid cell: the detail comes back, the grid steps go.
function snapTo(out, mesh, h) {
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(mesh.positions, 3));
  geo.setIndex(new BufferAttribute(Uint32Array.from(mesh.indices), 1));
  const bvh = new MeshBVH(geo);
  const p = new Vector3(), target = {};
  const P = out.positions;
  for (let v = 0; v < P.length; v += 3) {
    const hit = bvh.closestPointToPoint(p.set(P[v], P[v + 1], P[v + 2]), target, 0, h * 1.2);
    if (!hit) continue;
    P[v] = hit.point.x;
    P[v + 1] = hit.point.y;
    P[v + 2] = hit.point.z;
  }
}

function dropSpecks(mesh) {
  const { twins } = pairEdges(mesh.indices, mesh.positions.length / 3, mesh.positions);
  const { part, sizes } = partsOf(mesh.indices.length / 3, twins);
  const big = Math.max(...sizes);
  const keepPart = sizes.map((n) => n >= Math.max(24, big * 0.002));
  const specks = keepPart.filter((k) => !k).length;
  if (!specks) return { ...mesh, specks };
  const keep = [];
  for (let f = 0; f < part.length; f++) if (keepPart[part[f]]) keep.push(mesh.indices[f * 3], mesh.indices[f * 3 + 1], mesh.indices[f * 3 + 2]);
  // Corners no triangle uses any more go too.
  const map = new Int32Array(mesh.positions.length / 3).fill(-1);
  let m = 0;
  for (const v of keep) if (map[v] < 0) map[v] = m++;
  const positions = new Float32Array(m * 3);
  for (let v = 0; v < map.length; v++) if (map[v] >= 0) positions.set(mesh.positions.subarray(v * 3, v * 3 + 3), map[v] * 3);
  return { positions, indices: Uint32Array.from(keep, (v) => map[v]), specks };
}

// How many of the six guesses say inside, per grid point (0..6).
export function insideVotes(mesh, grid) {
  const { o, n, h } = grid;
  const P = mesh.positions, T = mesh.indices;
  const total = n[0] * n[1] * n[2];
  if (total > 120e6) throw Error('This detail needs too fine a grid for this model. Choose a coarser detail.');
  const votes = new Uint8Array(total);
  const stride = [1, n[0], n[0] * n[1]];
  // A tiny shift of the rays, so none runs exactly along an edge or through a corner.
  const shift = [h * 1.37e-4, h * 2.11e-4, h * 3.03e-4];
  for (let a = 0; a < 3; a++) {
    const b = (a + 1) % 3, c = (a + 2) % 3;
    const nb = n[b], nc = n[c];
    const lines = nb * nc;
    const count = new Int32Array(lines + 1);
    // Two passes over the triangles: count the hits per ray, then store them.
    const visit = (store, at, sign) => {
      for (let f = 0; f < T.length; f += 3) {
        const i0 = T[f] * 3, i1 = T[f + 1] * 3, i2 = T[f + 2] * 3;
        const ab = P[i0 + b], ac = P[i0 + c], bb = P[i1 + b], bc = P[i1 + c], cb = P[i2 + b], cc = P[i2 + c];
        // Facing along the ray: the sign of the normal's a-part.
        const na = (bb - ab) * (cc - ac) - (bc - ac) * (cb - ab);
        if (na === 0) continue;
        const j0 = Math.max(0, Math.ceil((Math.min(ab, bb, cb) - o[b] - shift[b]) / h));
        const j1 = Math.min(nb - 1, Math.floor((Math.max(ab, bb, cb) - o[b] - shift[b]) / h));
        const k0 = Math.max(0, Math.ceil((Math.min(ac, bc, cc) - o[c] - shift[c]) / h));
        const k1 = Math.min(nc - 1, Math.floor((Math.max(ac, bc, cc) - o[c] - shift[c]) / h));
        if (j0 > j1 || k0 > k1) continue;
        for (let k = k0; k <= k1; k++) {
          const pc = o[c] + k * h + shift[c];
          for (let j = j0; j <= j1; j++) {
            const pb = o[b] + j * h + shift[b];
            // Barycentric weights in the (b, c) plane.
            const w0 = (bb - pb) * (cc - pc) - (bc - pc) * (cb - pb);
            const w1 = (cb - pb) * (ac - pc) - (cc - pc) * (ab - pb);
            const w2 = (ab - pb) * (bc - pc) - (ac - pc) * (bb - pb);
            if (na > 0 ? w0 < 0 || w1 < 0 || w2 < 0 : w0 > 0 || w1 > 0 || w2 > 0) continue;
            const line = j + nb * k;
            if (!store) count[line + 1]++;
            else {
              const slot = fill[line]++;
              at[slot] = (w0 * P[i0 + a] + w1 * P[i1 + a] + w2 * P[i2 + a]) / na;
              // Walking along +a: a face looking back (-a) is a way in.
              sign[slot] = na > 0 ? 1 : -1;
            }
          }
        }
      }
    };
    // In the (b, c) plane, b × c = a: the normal's a-part is na from above.
    visit(false);
    for (let l = 0; l < lines; l++) count[l + 1] += count[l];
    const at = new Float64Array(count[lines]);
    const sign = new Int8Array(count[lines]);
    const fill = count.slice(0, lines);
    visit(true, at, sign);
    // Walk each ray: the winding before each grid point (from -a), and after it (from +a).
    const order = [];
    for (let l = 0; l < lines; l++) {
      const s = count[l], e = count[l + 1];
      const j = l % nb, k = (l - j) / nb;
      const base = j * stride[b] + k * stride[c];
      if (s === e) continue; // nothing crossed: outside both ways
      order.length = 0;
      for (let i = s; i < e; i++) order.push(i);
      order.sort((x, y) => at[x] - at[y]);
      // sign: which way each crossed face looks along +a. Walking along +a, a
      // face looking back (-1) is a way in. From the far end it is the other
      // way round. So the winding from the start is minus the signs passed,
      // and from the far end the sum of the signs still ahead.
      let all = 0;
      for (const i of order) all += sign[i];
      let passed = 0, next = 0;
      for (let i = 0; i < n[a]; i++) {
        const p = o[a] + i * h + shift[a];
        while (next < order.length && at[order[next]] < p) passed += sign[order[next++]];
        const fromStart = -passed, fromEnd = all - passed;
        const v = (fromStart > 0 ? 1 : 0) + (fromEnd > 0 ? 1 : 0);
        if (v) votes[base + i * stride[a]] += v;
      }
    }
  }
  return votes;
}
