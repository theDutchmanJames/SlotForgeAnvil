// Fewer triangles, same shape: quadric edge collapse (Garland & Heckbert).
// Each collapse merges two corners into one point that keeps the nearby
// surfaces as flat as they were. Open edges (openings, the underside) are
// held in place, and a collapse that would fold a triangle over is skipped.

class Heap {
  constructor() {
    this.cost = [];
    this.item = [];
  }
  get size() {
    return this.cost.length;
  }
  push(cost, item) {
    const c = this.cost, it = this.item;
    let i = c.length;
    c.push(cost);
    it.push(item);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (c[p] <= cost) break;
      c[i] = c[p];
      it[i] = it[p];
      i = p;
    }
    c[i] = cost;
    it[i] = item;
  }
  pop() {
    const c = this.cost, it = this.item;
    const top = it[0], topCost = c[0];
    const lastC = c.pop(), lastI = it.pop();
    if (c.length) {
      let i = 0;
      const n = c.length;
      for (;;) {
        let m = 2 * i + 1;
        if (m >= n) break;
        if (m + 1 < n && c[m + 1] < c[m]) m++;
        if (c[m] >= lastC) break;
        c[i] = c[m];
        it[i] = it[m];
        i = m;
      }
      c[i] = lastC;
      it[i] = lastI;
    }
    return [topCost, top];
  }
}

// target: fraction of triangles to keep (0..1). tolerance: largest allowed
// distance from the original surface, in mm (estimated from the quadrics).
export function applyReduce(mesh, { target = 0.5, tolerance = 0.05 }) {
  if (!(target > 0 && target <= 1)) throw Error('Choose how many triangles to keep.');
  if (!(tolerance > 0)) throw Error('Enter how far the shape may move.');
  const V = mesh.positions.length / 3,
    F = mesh.indices.length / 3;
  const pos = Float64Array.from(mesh.positions);
  const tri = Int32Array.from(mesh.indices);
  const alive = new Uint8Array(F).fill(1);
  const Q = new Float64Array(V * 10);
  const vf = Array.from({ length: V }, () => []);
  for (let f = 0; f < F; f++) for (let k = 0; k < 3; k++) vf[tri[f * 3 + k]].push(f);

  const addPlane = (v, a, b, c, d, w) => {
    const q = v * 10;
    Q[q] += w * a * a; Q[q + 1] += w * a * b; Q[q + 2] += w * a * c; Q[q + 3] += w * a * d;
    Q[q + 4] += w * b * b; Q[q + 5] += w * b * c; Q[q + 6] += w * b * d;
    Q[q + 7] += w * c * c; Q[q + 8] += w * c * d; Q[q + 9] += w * d * d;
  };
  const normalOf = (f, out) => {
    const a = tri[f * 3] * 3, b = tri[f * 3 + 1] * 3, c = tri[f * 3 + 2] * 3;
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    out[0] = uy * vz - uz * vy;
    out[1] = uz * vx - ux * vz;
    out[2] = ux * vy - uy * vx;
    return out;
  };
  const n = [0, 0, 0];
  for (let f = 0; f < F; f++) {
    normalOf(f, n);
    const l = Math.hypot(n[0], n[1], n[2]);
    if (!l) continue;
    const a = n[0] / l, b = n[1] / l, c = n[2] / l;
    const p = tri[f * 3] * 3;
    const d = -(a * pos[p] + b * pos[p + 1] + c * pos[p + 2]);
    for (let k = 0; k < 3; k++) addPlane(tri[f * 3 + k], a, b, c, d, 1);
  }
  // Open edges: a steep plane along each one keeps the outline where it is.
  const edgeFaces = new Map();
  const ekey = (a, b) => (a < b ? a * V + b : b * V + a);
  for (let f = 0; f < F; f++)
    for (let k = 0; k < 3; k++) {
      const key = ekey(tri[f * 3 + k], tri[f * 3 + ((k + 1) % 3)]);
      edgeFaces.set(key, (edgeFaces.get(key) ?? 0) + 1);
    }
  const border = new Uint8Array(V);
  for (let f = 0; f < F; f++)
    for (let k = 0; k < 3; k++) {
      const a = tri[f * 3 + k], b = tri[f * 3 + ((k + 1) % 3)];
      if (edgeFaces.get(ekey(a, b)) !== 1) continue;
      border[a] = border[b] = 1;
      normalOf(f, n);
      const ex = pos[b * 3] - pos[a * 3], ey = pos[b * 3 + 1] - pos[a * 3 + 1], ez = pos[b * 3 + 2] - pos[a * 3 + 2];
      let px = ey * n[2] - ez * n[1], py = ez * n[0] - ex * n[2], pz = ex * n[1] - ey * n[0];
      const l = Math.hypot(px, py, pz);
      if (!l) continue;
      px /= l; py /= l; pz /= l;
      const d = -(px * pos[a * 3] + py * pos[a * 3 + 1] + pz * pos[a * 3 + 2]);
      addPlane(a, px, py, pz, d, 1000);
      addPlane(b, px, py, pz, d, 1000);
    }

  const qs = new Float64Array(10);
  // Best point for merging a and b, and its cost.
  function plan(a, b) {
    for (let i = 0; i < 10; i++) qs[i] = Q[a * 10 + i] + Q[b * 10 + i];
    const [q0, q1, q2, q3, q4, q5, q6, q7, q8] = qs;
    const det = q0 * (q4 * q7 - q5 * q5) - q1 * (q1 * q7 - q5 * q2) + q2 * (q1 * q5 - q4 * q2);
    const candidates = [];
    if (Math.abs(det) > 1e-12) {
      const x = -(q3 * (q4 * q7 - q5 * q5) - q1 * (q6 * q7 - q5 * q8) + q2 * (q6 * q5 - q4 * q8)) / det;
      const y = -(q0 * (q6 * q7 - q8 * q5) - q3 * (q1 * q7 - q5 * q2) + q2 * (q1 * q8 - q6 * q2)) / det;
      const z = -(q0 * (q4 * q8 - q5 * q6) - q1 * (q1 * q8 - q6 * q2) + q3 * (q1 * q5 - q4 * q2)) / det;
      if (Number.isFinite(x + y + z)) candidates.push([x, y, z]);
    }
    const A = [pos[a * 3], pos[a * 3 + 1], pos[a * 3 + 2]], B = [pos[b * 3], pos[b * 3 + 1], pos[b * 3 + 2]];
    candidates.push(A, B, [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2, (A[2] + B[2]) / 2]);
    let best = null, bestCost = Infinity;
    for (const p of candidates) {
      // Errors use the summed quadric, held in qs.
      const c =
        qs[0] * p[0] * p[0] + 2 * qs[1] * p[0] * p[1] + 2 * qs[2] * p[0] * p[2] + 2 * qs[3] * p[0] +
        qs[4] * p[1] * p[1] + 2 * qs[5] * p[1] * p[2] + 2 * qs[6] * p[1] +
        qs[7] * p[2] * p[2] + 2 * qs[8] * p[2] + qs[9];
      if (c < bestCost) [best, bestCost] = [p, c];
    }
    // A long thin collapse is never worth it if the points are far apart.
    const d = Math.hypot(A[0] - B[0], A[1] - B[1], A[2] - B[2]);
    return { p: best, cost: Math.max(0, bestCost) + 1e-9 * d };
  }

  const stamp = new Uint32Array(V);
  const heap = new Heap();
  const pushEdge = (a, b) => {
    const { cost } = plan(a, b);
    heap.push(cost, [a, b, stamp[a], stamp[b]]);
  };
  for (const key of edgeFaces.keys()) {
    const a = Math.floor(key / V), b = key % V;
    pushEdge(a, b);
  }

  const goal = Math.max(4, Math.floor(F * target));
  const limit = tolerance * tolerance;
  let faces = F;
  const ring = (v) => {
    const s = new Set();
    for (const f of vf[v]) if (alive[f]) for (let k = 0; k < 3; k++) s.add(tri[f * 3 + k]);
    s.delete(v);
    return s;
  };
  const before = [0, 0, 0], after = [0, 0, 0];
  let worst = 0;
  while (faces > goal && heap.size) {
    const [cost, [a, b, sa, sb]] = heap.pop();
    if (stamp[a] !== sa || stamp[b] !== sb) continue;
    if (cost > limit) break;
    // Both corners must still be connected by a live triangle.
    const shared = vf[a].filter((f) => alive[f] && (tri[f * 3] === b || tri[f * 3 + 1] === b || tri[f * 3 + 2] === b));
    if (!shared.length) continue;
    // Keep the surface a surface: the two rings may only share the triangles' third corners.
    const ra = ring(a), rb = ring(b);
    let common = 0;
    for (const v of ra) if (rb.has(v)) common++;
    if (common !== shared.length) continue;
    if (border[a] && border[b] && shared.length !== 1) continue;
    const { p } = plan(a, b);
    // No triangle may turn over or collapse.
    let ok = true;
    for (const v of [a, b])
      for (const f of vf[v]) {
        if (!alive[f] || shared.includes(f)) continue;
        normalOf(f, before);
        const saved = [];
        for (let k = 0; k < 3; k++) {
          const w = tri[f * 3 + k];
          if (w === a || w === b) {
            saved.push([w, pos[w * 3], pos[w * 3 + 1], pos[w * 3 + 2]]);
            pos[w * 3] = p[0];
            pos[w * 3 + 1] = p[1];
            pos[w * 3 + 2] = p[2];
          }
        }
        normalOf(f, after);
        for (const [w, x, y, z] of saved) {
          pos[w * 3] = x;
          pos[w * 3 + 1] = y;
          pos[w * 3 + 2] = z;
        }
        const lb = Math.hypot(...before), la = Math.hypot(...after);
        if (la < lb * 1e-3 || before[0] * after[0] + before[1] * after[1] + before[2] * after[2] < 0.3 * lb * la) {
          ok = false;
          break;
        }
      }
    if (!ok) continue;
    // Merge b into a.
    pos[a * 3] = p[0];
    pos[a * 3 + 1] = p[1];
    pos[a * 3 + 2] = p[2];
    for (const f of shared) {
      alive[f] = 0;
      faces--;
    }
    for (const f of vf[b]) {
      if (!alive[f]) continue;
      for (let k = 0; k < 3; k++) if (tri[f * 3 + k] === b) tri[f * 3 + k] = a;
      vf[a].push(f);
    }
    vf[b] = [];
    vf[a] = vf[a].filter((f) => alive[f]);
    for (let i = 0; i < 10; i++) Q[a * 10 + i] += Q[b * 10 + i];
    border[a] = border[a] | border[b];
    worst = Math.max(worst, cost);
    stamp[a]++;
    stamp[b]++;
    for (const v of ring(a)) pushEdge(a, v);
  }

  const out = [];
  for (let f = 0; f < F; f++) if (alive[f]) out.push(tri[f * 3], tri[f * 3 + 1], tri[f * 3 + 2]);
  const map = new Int32Array(V).fill(-1);
  let m = 0;
  for (const v of out) if (map[v] < 0) map[v] = m++;
  const positions = new Float32Array(m * 3);
  for (let v = 0; v < V; v++) if (map[v] >= 0) positions.set([pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]], map[v] * 3);
  return {
    positions,
    indices: Uint32Array.from(out, (v) => map[v]),
    info: { before: F, after: out.length / 3, moved: Math.sqrt(worst) },
  };
}
