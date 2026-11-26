// Fine detail that survives printing. Both tools move the surface itself
// (no pieces added or cut out), so a closed body stays closed:
//   Panel lines: narrow grooves found on the outside are made deeper, as
//                shallow ones vanish in a 0.4 mm nozzle or a resin layer.
//   Text:        numbers and letters raised out of the surface or cut into
//                it, following its curve. The body's triangles are made fine
//                under the text first, finest where the outline runs.

// ------------------------------------------------------------ shared

function normals(P, T) {
  const V = P.length / 3;
  const N = new Float64Array(V * 3);
  for (let f = 0; f < T.length; f += 3) {
    const a = T[f] * 3, b = T[f + 1] * 3, c = T[f + 2] * 3;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
    const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const i of [a, b, c]) (N[i] += nx), (N[i + 1] += ny), (N[i + 2] += nz);
  }
  for (let v = 0; v < V; v++) {
    const l = Math.hypot(N[v * 3], N[v * 3 + 1], N[v * 3 + 2]) || 1;
    for (let k = 0; k < 3; k++) N[v * 3 + k] /= l;
  }
  return N;
}

// Split edges in halves while split(a, b, n) says so (a, b: corner points; n:
// the facing of a triangle on that edge), up to `rounds` times. An edge is
// split when any triangle on it asks; neighbours share the new corners.
export function refine(mesh, split, rounds = 12) {
  let pos = Array.from(mesh.positions), tri = Array.from(mesh.indices);
  const P = (v) => [pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]];
  for (let r = 0; r < rounds; r++) {
    const mid = new Map();
    const key = (a, b) => (a < b ? a * 4194304 + b : b * 4194304 + a);
    let any = false;
    for (let i = 0; i < tri.length; i += 3) {
      const A = P(tri[i]), B = P(tri[i + 1]), C = P(tri[i + 2]);
      const n = unit(cross(sub(B, A), sub(C, A))) ?? [0, 0, 0];
      for (let k = 0; k < 3; k++) {
        const a = tri[i + k], b = tri[i + ((k + 1) % 3)];
        const kk = key(a, b);
        if (mid.get(kk) >= 0) continue;
        if (split(P(a), P(b), n)) {
          mid.set(kk, pos.length / 3);
          const pa = P(a), pb = P(b);
          pos.push((pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2, (pa[2] + pb[2]) / 2);
          any = true;
        } else if (!mid.has(kk)) mid.set(kk, -1);
      }
    }
    if (!any) break;
    const out = [];
    for (let i = 0; i < tri.length; i += 3) {
      const v = [tri[i], tri[i + 1], tri[i + 2]];
      const m = [0, 1, 2].map((k) => mid.get(key(v[k], v[(k + 1) % 3])));
      const n = m.filter((x) => x >= 0).length;
      if (!n) out.push(...v);
      else if (n === 3) out.push(v[0], m[0], m[2], m[0], v[1], m[1], m[2], m[1], v[2], m[0], m[1], m[2]);
      else if (n === 1) {
        const k = m.findIndex((x) => x >= 0);
        out.push(v[k], m[k], v[(k + 2) % 3], m[k], v[(k + 1) % 3], v[(k + 2) % 3]);
      } else {
        const k = m.findIndex((x) => x < 0); // the whole edge v[k]→v[k+1]
        const a = v[k], b = v[(k + 1) % 3], c = v[(k + 2) % 3];
        const mb = m[(k + 1) % 3], mc = m[(k + 2) % 3];
        out.push(c, mc, mb, a, b, mb, a, mb, mc);
      }
    }
    tri = out;
  }
  return { positions: Float32Array.from(pos), indices: Uint32Array.from(tri) };
}

// ------------------------------------------------------------ panel lines

// How far each corner lies below the surface round it. The surface round it
// is a ring of nearby corners (between r/2 and r away); it must be smooth (a
// groove in a panel, not a corner between two panels). Returns per corner the
// depth below that surface (0 when not a groove) and the surface's normal.
export function grooves(mesh, { radius = 1, min = 0.04 } = {}) {
  const P = mesh.positions, T = mesh.indices;
  const V = P.length / 3;
  const N = normals(P, T);
  const nb = Array.from({ length: V }, () => []);
  for (let f = 0; f < T.length; f += 3)
    for (let k = 0; k < 3; k++) {
      const a = T[f + k], b = T[f + ((k + 1) % 3)];
      nb[a].push(b);
      nb[b].push(a);
    }
  const depth = new Float32Array(V);
  const up = new Float32Array(V * 3);
  const seen = new Int32Array(V).fill(-1);
  const r2 = radius * radius;
  for (let v = 0; v < V; v++) {
    const p = [P[v * 3], P[v * 3 + 1], P[v * 3 + 2]];
    // Corners within the radius, over the surface.
    const ring = [];
    const stack = [v];
    seen[v] = v;
    let count = 0;
    while (stack.length && count < 400) {
      const w = stack.pop();
      count++;
      for (const x of nb[w]) {
        if (seen[x] === v) continue;
        seen[x] = v;
        const d2 = (P[x * 3] - p[0]) ** 2 + (P[x * 3 + 1] - p[1]) ** 2 + (P[x * 3 + 2] - p[2]) ** 2;
        if (d2 > r2) continue;
        stack.push(x);
        if (d2 >= r2 * 0.25) ring.push(x);
      }
    }
    if (ring.length < 4) continue;
    const c = [0, 0, 0], n = [0, 0, 0];
    for (const x of ring) for (let k = 0; k < 3; k++) (c[k] += P[x * 3 + k]), (n[k] += N[x * 3 + k]);
    const nl = Math.hypot(...n);
    if (nl < ring.length * 0.85) continue; // the ring bends: a corner, not a panel
    for (let k = 0; k < 3; k++) (c[k] /= ring.length), (n[k] /= nl);
    // The surface's height: the upper part of the ring (the groove itself,
    // running through the ring, would pull an average down).
    const hs = ring.map((x) => (P[x * 3] - p[0]) * n[0] + (P[x * 3 + 1] - p[1]) * n[1] + (P[x * 3 + 2] - p[2]) * n[2]).sort((a, b) => a - b);
    const d = hs[Math.floor(hs.length * 0.7)];
    if (d < min) continue;
    // The ring itself flat (one panel), to well within the groove's depth.
    let res = 0;
    for (const x of ring) res += ((P[x * 3] - c[0]) * n[0] + (P[x * 3 + 1] - c[1]) * n[1] + (P[x * 3 + 2] - c[2]) * n[2]) ** 2;
    // (The groove itself runs through the ring, so allow up to its own depth.)
    if (Math.sqrt(res / ring.length) > d) continue;
    depth[v] = d;
    up.set(n, v * 3);
  }
  return { depth, up };
}

// Make the grooves `depth` deep (measured from the surface round them).
// faces (optional): only grooves in these faces (a selection).
export function applyPanelLines(mesh, { depth = 0.4, radius = 1, min = 0.04, faces = null }) {
  if (!(depth > 0)) throw Error('Enter how deep the panel lines should be.');
  const g = grooves(mesh, { radius, min });
  const P = Float32Array.from(mesh.positions);
  let only = null;
  if (faces) {
    only = new Uint8Array(P.length / 3);
    for (let i = 0; i < faces.length; i += 2) for (let f = faces[i]; f < faces[i] + faces[i + 1]; f++) for (let k = 0; k < 3; k++) only[mesh.indices[f * 3 + k]] = 1;
  }
  let moved = 0;
  for (let v = 0; v < g.depth.length; v++) {
    const d = g.depth[v];
    if (!d || (only && !only[v])) continue;
    const push = depth - d;
    if (push <= 0) continue;
    for (let k = 0; k < 3; k++) P[v * 3 + k] -= g.up[v * 3 + k] * push;
    moved++;
  }
  if (!moved) throw Error('No panel lines found to deepen. Try a wider search or a smaller minimum depth.');
  return { positions: P, indices: mesh.indices, info: { moved } };
}

// ------------------------------------------------------------ text

// A text's frame on the body: middle `at`, facing out along `normal`, its
// letters upright along `up`, turned by `angle` degrees.
export function textFrame(t) {
  const n = unit(t.normal);
  let up = t.up ?? [0, 0, 1];
  let v = unit(sub(up, scale(n, dot(up, n))));
  if (!v) v = unit(sub([1, 0, 0], scale(n, n[0])));
  let u = cross(v, n);
  const a = ((t.angle ?? 0) * Math.PI) / 180;
  if (a) {
    const ca = Math.cos(a), sa = Math.sin(a);
    const u2 = add(scale(u, ca), scale(v, sa)), v2 = add(scale(v, ca), scale(u, -sa));
    u = u2;
    v = v2;
  }
  return { o: t.at, n, u, v };
}
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a) => {
  const l = Math.hypot(...a);
  return l > 1e-12 ? a.map((x) => x / l) : null;
};

// Does the segment a–b (2D) cross any outline?
function crossesOutline(polys, a, b) {
  const minx = Math.min(a[0], b[0]), maxx = Math.max(a[0], b[0]), miny = Math.min(a[1], b[1]), maxy = Math.max(a[1], b[1]);
  const side = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  for (const ring of polys)
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const c = ring[j], d = ring[i];
      if (Math.max(c[0], d[0]) < minx || Math.min(c[0], d[0]) > maxx || Math.max(c[1], d[1]) < miny || Math.min(c[1], d[1]) > maxy) continue;
      const s1 = side(a, b, c), s2 = side(a, b, d), s3 = side(c, d, a), s4 = side(c, d, b);
      if (s1 * s2 <= 0 && s3 * s4 <= 0) return true;
    }
  return false;
}

// Inside the letters: an odd number of outlines round the point.
function insideText(polys, x, y) {
  let odd = false;
  for (const ring of polys)
    for (let a = 0, b = ring.length - 1; a < ring.length; b = a++)
      if (ring[a][1] > y !== ring[b][1] > y && x < ((ring[b][0] - ring[a][0]) * (y - ring[a][1])) / (ring[b][1] - ring[a][1]) + ring[a][0]) odd = !odd;
  return odd;
}

// texts: [{ at, normal, up, angle, flip, polys (outlines in mm round the
// middle), mode: 'raise' | 'cut', depth }]. Each text moves the outside of
// the body under it out (raise) or in (cut) by its depth.
export function applyText(mesh, { texts = [], grain = 0.3, edge = 0.05 }) {
  let m = mesh;
  const warnings = [];
  let moved = 0;
  for (const [i, t] of texts.entries()) {
    if (!t.polys?.length) throw Error('A text has no letters. Type it again.');
    if (!(t.depth > 0)) throw Error('Enter how far the text stands out or goes in.');
    const fr = textFrame(t);
    const polys = t.flip ? t.polys.map((r) => r.map(([x, y]) => [-x, y])) : t.polys;
    let lo = [Infinity, Infinity], hi = [-Infinity, -Infinity];
    for (const r of polys) for (const [x, y] of r) (lo = [Math.min(lo[0], x), Math.min(lo[1], y)]), (hi = [Math.max(hi[0], x), Math.max(hi[1], y)]);
    const pad = grain * 2;
    const reach = Math.max(hi[0] - lo[0], hi[1] - lo[1]) * 0.6 + 3; // how far round the frame's middle the body counts
    const local = (p) => {
      const r = sub(p, fr.o);
      return [dot(r, fr.u), dot(r, fr.v), dot(r, fr.n)];
    };
    const near = (q) => q[0] >= lo[0] - pad && q[0] <= hi[0] + pad && q[1] >= lo[1] - pad && q[1] <= hi[1] + pad && Math.abs(q[2]) < reach;
    // Does the edge pass over the text's box (a long edge can, with both ends far off)?
    const over = (qa, qb) =>
      Math.max(qa[0], qb[0]) >= lo[0] - pad && Math.min(qa[0], qb[0]) <= hi[0] + pad && Math.max(qa[1], qb[1]) >= lo[1] - pad && Math.min(qa[1], qb[1]) <= hi[1] + pad && Math.min(Math.abs(qa[2]), Math.abs(qb[2])) < reach;
    // Fine under the text, finest where the outline crosses an edge.
    m = refine(m, (a, b, fn) => {
      // Only the outside facing the text.
      if (fn[0] * fr.n[0] + fn[1] * fr.n[1] + fn[2] * fr.n[2] < 0.2) return false;
      const qa = local(a), qb = local(b);
      if (!over(qa, qb)) return false;
      const len = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
      if (len > grain) return true;
      return len > edge && crossesOutline(polys, qa, qb);
    });
    const P = Float32Array.from(m.positions);
    const N = normals(P, m.indices);
    const sign = t.mode === 'cut' ? -1 : 1;
    let count = 0;
    for (let v = 0; v < P.length / 3; v++) {
      const p = [P[v * 3], P[v * 3 + 1], P[v * 3 + 2]];
      const q = local(p);
      if (!near(q)) continue;
      // Only the outside facing the text (not the inside of the wall, nor the far side).
      if (N[v * 3] * fr.n[0] + N[v * 3 + 1] * fr.n[1] + N[v * 3 + 2] * fr.n[2] < 0.3) continue;
      if (!insideText(polys, q[0], q[1])) continue;
      for (let k = 0; k < 3; k++) P[v * 3 + k] += fr.n[k] * sign * t.depth;
      count++;
    }
    if (!count) warnings.push(`Text ${i + 1} is not on the body: place it again.`);
    moved += count;
    m = { positions: P, indices: m.indices };
  }
  return { positions: m.positions, indices: m.indices, info: { moved, warnings } };
}
