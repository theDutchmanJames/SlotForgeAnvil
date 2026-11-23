// The body panel hammer. Each blow pushes the surface in or out along its
// own facing, strongest under the middle of the head and fading to nothing
// at its edge. Planishing blows smooth instead of push. A dolly marks areas
// the hammer leaves alone. Where blows land, long edges are split first, so
// a stretched panel stays smooth instead of turning into large flat facets.
//
// blow: { at: [x,y,z], radius, depth, kind: 'in' | 'out' | 'planish' }
// dolly: { at: [x,y,z], radius }

const near = (p, q, r) => {
  const dx = p[0] - q[0], dy = p[1] - q[1], dz = p[2] - q[2];
  return dx * dx + dy * dy + dz * dz < r * r;
};

export function applyHammer(mesh, { blows = [], dollies = [] }) {
  if (!blows.length) return { positions: mesh.positions, indices: mesh.indices, info: { blows: 0 } };
  for (const b of blows)
    if (!(b.radius > 0) || !Array.isArray(b.at) || !['in', 'out', 'planish'].includes(b.kind))
      throw Error('A hammer blow is damaged. Remove the step and hammer again.');
  const { pos, tri, added } = refine(Array.from(mesh.positions), Array.from(mesh.indices), blows);
  const flipped = tidy(pos, tri, blows);
  const V = pos.length / 3;

  // Neighbours, for planishing and for the facing of the surface.
  const nb = Array.from({ length: V }, () => new Set());
  for (let f = 0; f < tri.length; f += 3)
    for (let k = 0; k < 3; k++) {
      const a = tri[f + k], b = tri[f + ((k + 1) % 3)];
      nb[a].add(b);
      nb[b].add(a);
    }
  const P = (v) => [pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]];

  // Vertices near any blow, found once through a coarse grid.
  const maxR = Math.max(...blows.map((b) => b.radius));
  const cell = maxR;
  const grid = new Map();
  const keyOf = (x, y, z) => `${Math.floor(x / cell)},${Math.floor(y / cell)},${Math.floor(z / cell)}`;
  for (let v = 0; v < V; v++) {
    const k = keyOf(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]);
    (grid.get(k) ?? grid.set(k, []).get(k)).push(v);
  }
  const around = (c, r) => {
    const out = [];
    const span = Math.ceil(r / cell);
    const gx = Math.floor(c[0] / cell), gy = Math.floor(c[1] / cell), gz = Math.floor(c[2] / cell);
    for (let i = -span; i <= span; i++)
      for (let j = -span; j <= span; j++)
        for (let k = -span; k <= span; k++)
          for (const v of grid.get(`${gx + i},${gy + j},${gz + k}`) ?? []) if (near(P(v), c, r)) out.push(v);
    return out;
  };
  // How free a point is from dollies: 1 = free, 0 = fully held.
  const free = (p) => {
    let f = 1;
    for (const d of dollies) {
      const dist = Math.hypot(p[0] - d.at[0], p[1] - d.at[1], p[2] - d.at[2]);
      if (dist >= d.radius) continue;
      const x = dist / d.radius;
      f = Math.min(f, x * x * (3 - 2 * x));
    }
    return f;
  };
  // Facing of the surface at each vertex (area-weighted), worked out once.
  const normals = new Float64Array(V * 3);
  for (let f = 0; f < tri.length; f += 3) {
    const A = P(tri[f]), B = P(tri[f + 1]), D = P(tri[f + 2]);
    const u = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], w = [D[0] - A[0], D[1] - A[1], D[2] - A[2]];
    const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    for (let k = 0; k < 3; k++) for (let c = 0; c < 3; c++) normals[tri[f + k] * 3 + c] += n[c];
  }
  const facing = (verts) => {
    const n = [0, 0, 0];
    for (const v of verts) for (let c = 0; c < 3; c++) n[c] += normals[v * 3 + c];
    const l = Math.hypot(...n) || 1;
    return n.map((x) => x / l);
  };

  // Distance along the surface from the head, out to its edge. Going
  // round the edge of a thin panel is far, so its other side stays put.
  const alongSurface = (start, r) => {
    const dist = new Map([[start, 0]]);
    const open = [[0, start]];
    while (open.length) {
      let bi = 0;
      for (let i = 1; i < open.length; i++) if (open[i][0] < open[bi][0]) bi = i;
      const [d, v] = open[bi];
      open[bi] = open[open.length - 1];
      open.pop();
      if (d > dist.get(v)) continue;
      for (const w of nb[v]) {
        const nd = d + Math.hypot(pos[v * 3] - pos[w * 3], pos[v * 3 + 1] - pos[w * 3 + 1], pos[v * 3 + 2] - pos[w * 3 + 2]);
        if (nd >= r || nd >= (dist.get(w) ?? Infinity)) continue;
        dist.set(w, nd);
        open.push([nd, w]);
      }
    }
    return dist;
  };

  for (const blow of blows) {
    const r = blow.radius;
    const candidates = around(blow.at, r);
    if (!candidates.length) continue;
    // Start from the corner nearest the middle of the head.
    let start = candidates[0], sd = Infinity;
    for (const v of candidates) {
      const p = P(v);
      const d = Math.hypot(p[0] - blow.at[0], p[1] - blow.at[1], p[2] - blow.at[2]);
      if (d < sd) [start, sd] = [v, d];
    }
    const dist = alongSurface(start, r);
    const verts = [...dist.keys()];
    const weight = (v) => {
      const g = dist.get(v) / r;
      return (1 - g * g) * (1 - g * g) * free(P(v));
    };
    if (blow.kind === 'planish') {
      for (let it = 0; it < 3; it++) {
        const next = verts.map((v) => {
          const s = [0, 0, 0];
          for (const w of nb[v]) for (let c = 0; c < 3; c++) s[c] += pos[w * 3 + c];
          const m = nb[v].size || 1;
          const k = 0.5 * weight(v) * Math.min(1, blow.depth > 0 ? blow.depth : 1);
          return [0, 1, 2].map((c) => pos[v * 3 + c] + k * (s[c] / m - pos[v * 3 + c]));
        });
        verts.forEach((v, i) => next[i].forEach((x, c) => (pos[v * 3 + c] = x)));
      }
      continue;
    }
    const n = facing(verts.filter((v) => dist.get(v) < r * 0.5));
    const sign = blow.kind === 'out' ? 1 : -1;
    for (const v of verts) {
      const w = weight(v) * blow.depth * sign;
      for (let c = 0; c < 3; c++) pos[v * 3 + c] += n[c] * w;
    }
  }

  return { positions: Float32Array.from(pos), indices: Uint32Array.from(tri), info: { blows: blows.length, added, flipped } };
}

// Split long edges near where blows land, until the surface there is fine
// enough to bend smoothly. Always the longest edge of a triangle (longest-
// edge bisection), so triangles stay well shaped instead of turning into
// slivers.
function refine(pos, tri, blows) {
  let added = 0;
  const len2 = (a, b) => (pos[a * 3] - pos[b * 3]) ** 2 + (pos[a * 3 + 1] - pos[b * 3 + 1]) ** 2 + (pos[a * 3 + 2] - pos[b * 3 + 2]) ** 2;
  const reach = Math.max(...blows.map((b) => b.radius)) * 1.3;
  for (let pass = 0; pass < 12; pass++) {
    const F = tri.length / 3;
    const V0 = pos.length / 3;
    const edges = new Map(); // key → faces
    const key = (a, b) => (a < b ? a * V0 + b : b * V0 + a);
    for (let f = 0; f < F; f++)
      for (let k = 0; k < 3; k++) {
        const kk = key(tri[f * 3 + k], tri[f * 3 + ((k + 1) % 3)]);
        (edges.get(kk) ?? edges.set(kk, []).get(kk)).push(f);
      }
    const used = new Uint8Array(F);
    let splits = 0;
    for (let f = 0; f < F; f++) {
      if (used[f]) continue;
      const t3 = [tri[f * 3], tri[f * 3 + 1], tri[f * 3 + 2]];
      // Longest edge of this triangle.
      let best = 0, bl = -1;
      for (let k = 0; k < 3; k++) {
        const l = len2(t3[k], t3[(k + 1) % 3]);
        if (l > bl) [best, bl] = [k, l];
      }
      const a = t3[best], b = t3[(best + 1) % 3];
      const len = Math.sqrt(bl);
      const M = [0, 1, 2].map((c) => (pos[a * 3 + c] + pos[b * 3 + c]) / 2);
      if (!blows.some((bw) => len > bw.radius / 3 && near(M, bw.at, Math.min(reach, bw.radius * 1.15 + len / 2)))) continue;
      const faces = edges.get(key(a, b));
      if (faces.length > 2 || faces.some((g) => used[g])) continue;
      const m = pos.length / 3;
      pos.push(...M);
      for (const g of faces) {
        used[g] = 1;
        const s = [tri[g * 3], tri[g * 3 + 1], tri[g * 3 + 2]];
        let i = 0;
        while (!((s[i] === a && s[(i + 1) % 3] === b) || (s[i] === b && s[(i + 1) % 3] === a))) i++;
        const x = s[i], y = s[(i + 1) % 3], z = s[(i + 2) % 3];
        tri[g * 3] = x;
        tri[g * 3 + 1] = m;
        tri[g * 3 + 2] = z;
        tri.push(m, y, z);
      }
      splits++;
    }
    added += splits;
    if (!splits) break;
  }
  return { pos, tri, added };
}

// Where blows land, flip the shared edge of two nearly flat neighbours when
// that gives better-shaped triangles (sum of the opposite angles over 180°).
// Slivers fold over at the slightest push; this removes them without
// changing the shape, because only nearly flat pairs are touched.
function tidy(pos, tri, blows) {
  const P = (v) => [pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const angle = (o, a, b) => {
    const u = sub(P(a), P(o)), w = sub(P(b), P(o));
    const l = Math.hypot(...u) * Math.hypot(...w);
    return l ? Math.acos(Math.max(-1, Math.min(1, dot(u, w) / l))) : Math.PI;
  };
  const reach = Math.max(...blows.map((b) => b.radius)) * 1.3;
  const inZone = (f) => {
    const c = [0, 1, 2].map((k) => (pos[tri[f * 3] * 3 + k] + pos[tri[f * 3 + 1] * 3 + k] + pos[tri[f * 3 + 2] * 3 + k]) / 3);
    return blows.some((b) => near(c, b.at, Math.min(reach, b.radius * 1.3)));
  };
  let total = 0;
  for (let pass = 0; pass < 6; pass++) {
    const F = tri.length / 3, V = pos.length / 3;
    const zone = new Uint8Array(F);
    for (let f = 0; f < F; f++) zone[f] = inZone(f) ? 1 : 0;
    const edges = new Map();
    const key = (a, b) => (a < b ? a * V + b : b * V + a);
    for (let f = 0; f < F; f++) {
      if (!zone[f]) continue;
      for (let k = 0; k < 3; k++) {
        const kk = key(tri[f * 3 + k], tri[f * 3 + ((k + 1) % 3)]);
        (edges.get(kk) ?? edges.set(kk, []).get(kk)).push([f, k]);
      }
    }
    // Every edge that already exists anywhere, so a flip never doubles one.
    const exists = new Set();
    for (let f = 0; f < F; f++) for (let k = 0; k < 3; k++) exists.add(key(tri[f * 3 + k], tri[f * 3 + ((k + 1) % 3)]));
    const used = new Uint8Array(F);
    let flips = 0;
    for (const list of edges.values()) {
      if (list.length !== 2) continue;
      const [[f, kf], [g, kg]] = list;
      if (used[f] || used[g]) continue;
      const a = tri[f * 3 + kf], b = tri[f * 3 + ((kf + 1) % 3)], c = tri[f * 3 + ((kf + 2) % 3)];
      if (tri[g * 3 + kg] !== b || tri[g * 3 + ((kg + 1) % 3)] !== a) continue;
      const d = tri[g * 3 + ((kg + 2) % 3)];
      if (c === d || exists.has(key(c, d))) continue;
      const n1 = cross(sub(P(b), P(a)), sub(P(c), P(a))), n2 = cross(sub(P(a), P(b)), sub(P(d), P(b)));
      const l1 = Math.hypot(...n1), l2 = Math.hypot(...n2);
      // Nearly flat together, or one of them is a sliver: a sliver has next
      // to no area, so flipping it does not change the shape, crease or not.
      const ab = Math.hypot(...sub(P(b), P(a)));
      const sliver = Math.min(l1, l2) / Math.max(ab, 1e-12) < ab * 0.04;
      const flat = !l1 || !l2 || sliver || dot(n1, n2) > 0.995 * l1 * l2;
      if (!flat) continue;
      if (angle(c, a, b) + angle(d, b, a) <= Math.PI + 1e-6) continue;
      // The new pair must face the same way as the old one.
      // Normals of the new triangles (c, a, d) and (d, b, c).
      const m1 = cross(sub(P(a), P(c)), sub(P(d), P(c))), m2 = cross(sub(P(b), P(d)), sub(P(c), P(d)));
      const ref = l1 >= l2 ? n1 : n2;
      if (dot(m1, ref) <= 0 || dot(m2, ref) <= 0) continue;
      tri[f * 3] = c; tri[f * 3 + 1] = a; tri[f * 3 + 2] = d;
      tri[g * 3] = d; tri[g * 3 + 1] = b; tri[g * 3 + 2] = c;
      used[f] = used[g] = 1;
      exists.delete(key(a, b));
      exists.add(key(c, d));
      flips++;
    }
    total += flips;
    if (!flips) break;
  }
  return total;
}
