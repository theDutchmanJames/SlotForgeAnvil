// Closing an opening. Flat: triangulate the outline as it is. Smooth: also
// add points inside and relax them, so the patch bends with its rim instead
// of being a set of large flat triangles.

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);

// pos: plain array of coordinates (grows when points are added).
// loop: vertex ids in the order the patch must run. Returns patch triangles.
export function fillLoop(pos, loop, mode = 'flat') {
  const P = (v) => [pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]];
  const pts = loop.map(P);
  // Newell normal of the outline: the patch's facing.
  let n = [0, 0, 0];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    n[0] += (a[1] - b[1]) * (a[2] + b[2]);
    n[1] += (a[2] - b[2]) * (a[0] + b[0]);
    n[2] += (a[0] - b[0]) * (a[1] + b[1]);
  }
  const nl = len(n);
  let tris = null;
  if (nl > 1e-12) {
    n = n.map((x) => x / nl);
    const u0 = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    const u = cross(n, u0), ul = len(u);
    const U = u.map((x) => x / ul), V = cross(n, U);
    tris = earClip(pts.map((p) => [dot(p, U), dot(p, V)]));
  }
  let faces;
  if (tris) faces = tris.map(([a, b, c]) => [loop[a], loop[b], loop[c]]);
  else {
    // Outline folds over itself seen from any side: fan from its middle.
    const c = pts.reduce((s, p) => [s[0] + p[0], s[1] + p[1], s[2] + p[2]], [0, 0, 0]).map((x) => x / pts.length);
    const id = pos.length / 3;
    pos.push(...c);
    faces = loop.map((v, i) => [id, v, loop[(i + 1) % loop.length]]);
  }
  if (mode === 'smooth') faces = refine(pos, loop, faces);
  return faces;
}

// Ear clipping of a simple polygon given counter-clockwise or clockwise.
function earClip(poly) {
  const n = poly.length;
  if (n < 3) return null;
  let area = 0;
  for (let i = 0; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n];
    area += a[0] * b[1] - b[0] * a[1];
  }
  const ccw = area > 0;
  const idx = [...Array(n).keys()];
  const out = [];
  const cr = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const inTri = (p, a, b, c) => {
    const d1 = cr(a, b, p), d2 = cr(b, c, p), d3 = cr(c, a, p);
    return ccw ? d1 > 0 && d2 > 0 && d3 > 0 : d1 < 0 && d2 < 0 && d3 < 0;
  };
  let guard = 0;
  while (idx.length > 3 && guard++ < n * n + 10) {
    let clipped = false;
    for (let i = 0; i < idx.length; i++) {
      const ia = idx[(i + idx.length - 1) % idx.length], ib = idx[i], ic = idx[(i + 1) % idx.length];
      const a = poly[ia], b = poly[ib], c = poly[ic];
      const turn = cr(a, b, c);
      if (ccw ? turn <= 1e-14 : turn >= -1e-14) continue;
      let blocked = false;
      for (const j of idx) {
        if (j === ia || j === ib || j === ic) continue;
        if (inTri(poly[j], a, b, c)) {
          blocked = true;
          break;
        }
      }
      if (blocked) continue;
      out.push([ia, ib, ic]);
      idx.splice(i, 1);
      clipped = true;
      break;
    }
    if (!clipped) return null;
  }
  if (idx.length === 3) out.push([idx[0], idx[1], idx[2]]);
  return out;
}

// Split large patch triangles, even out their shapes by flipping edges, and
// relax the new points towards the average of their neighbours.
function refine(pos, loop, faces) {
  const P = (v) => [pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]];
  let edgeSum = 0;
  for (let i = 0; i < loop.length; i++) edgeSum += len(sub(P(loop[i]), P(loop[(i + 1) % loop.length])));
  const target = edgeSum / loop.length;
  const maxArea = 0.433 * target * target * 2;
  const rim = new Set(loop);
  const fresh = new Set();
  const area = ([a, b, c]) => len(cross(sub(P(b), P(a)), sub(P(c), P(a)))) / 2;
  for (let round = 0; round < 10; round++) {
    let split = false;
    const nextFaces = [];
    for (const f of faces) {
      if (area(f) <= maxArea) {
        nextFaces.push(f);
        continue;
      }
      const [a, b, c] = f;
      const m = [0, 1, 2].map((k) => (pos[a * 3 + k] + pos[b * 3 + k] + pos[c * 3 + k]) / 3);
      const id = pos.length / 3;
      pos.push(...m);
      fresh.add(id);
      nextFaces.push([a, b, id], [b, c, id], [c, a, id]);
      split = true;
    }
    faces = nextFaces;
    flipEdges(pos, faces, rim);
    if (!split) break;
  }
  // Relax: each new point moves to the middle of its neighbours.
  const nb = new Map();
  for (const f of faces)
    for (let i = 0; i < 3; i++) {
      const v = f[i];
      if (!fresh.has(v)) continue;
      const s = nb.get(v) ?? new Set();
      s.add(f[(i + 1) % 3]);
      s.add(f[(i + 2) % 3]);
      nb.set(v, s);
    }
  for (let it = 0; it < 60; it++)
    for (const [v, s] of nb) {
      const m = [0, 0, 0];
      for (const w of s) for (let k = 0; k < 3; k++) m[k] += pos[w * 3 + k];
      for (let k = 0; k < 3; k++) pos[v * 3 + k] = m[k] / s.size;
    }
  return faces;
}

// Flip inner edges where the two opposite angles add up to more than 180°.
function flipEdges(pos, faces, rim) {
  const P = (v) => [pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]];
  const angle = (o, a, b) => {
    const u = sub(P(a), P(o)), w = sub(P(b), P(o));
    return Math.acos(Math.max(-1, Math.min(1, dot(u, w) / (len(u) * len(w) || 1))));
  };
  for (let pass = 0; pass < 4; pass++) {
    const edges = new Map();
    faces.forEach((f, i) => {
      for (let k = 0; k < 3; k++) {
        const a = f[k], b = f[(k + 1) % 3];
        const key = a < b ? `${a},${b}` : `${b},${a}`;
        (edges.get(key) ?? edges.set(key, []).get(key)).push([i, k]);
      }
    });
    let flipped = 0;
    const dirty = new Set(); // triangles already changed in this pass
    for (const list of edges.values()) {
      if (list.length !== 2) continue;
      const [[i, ki], [j, kj]] = list;
      if (dirty.has(i) || dirty.has(j)) continue;
      const fi = faces[i], fj = faces[j];
      const a = fi[ki], b = fi[(ki + 1) % 3], c = fi[(ki + 2) % 3];
      const d = fj[(kj + 2) % 3];
      if (fj[kj] !== b || fj[(kj + 1) % 3] !== a) continue;
      if (rim.has(a) && rim.has(b) && rim.has(c) && rim.has(d)) continue;
      if (angle(c, a, b) + angle(d, a, b) <= Math.PI + 1e-9) continue;
      // Keep the new triangles facing the same way as the old ones.
      const n0 = cross(sub(P(b), P(a)), sub(P(c), P(a)));
      // Normals of the new triangles (c, a, d) and (d, b, c).
      const n1 = cross(sub(P(a), P(c)), sub(P(d), P(c)));
      const n2 = cross(sub(P(b), P(d)), sub(P(c), P(d)));
      if (dot(n0, n1) <= 0 || dot(n0, n2) <= 0) continue;
      faces[i] = [c, a, d];
      faces[j] = [d, b, c];
      flipped++;
      dirty.add(i);
      dirty.add(j);
    }
    if (!flipped) break;
  }
}
