// Mesh bookkeeping for repair: which triangles meet along which edge, which
// loose parts there are, where the openings run. Half-edge e is the edge of
// triangle floor(e / 3) from corner e to the next corner, as in mesh-topology.js.

export const next = (e) => (e % 3 === 2 ? e - 2 : e + 1);
export const faceOf = (e) => Math.floor(e / 3);

// Pair every half-edge with the one on the neighbouring triangle.
// Two triangles on an edge are always paired, even if one is turned the wrong
// way (that is fixed by orientParts). Where more than two meet, opposite
// directions are paired first; what is left counts as open.
// twins[e] = partner half-edge, or -1.
export function pairEdges(indices, vertexCount, positions = null) {
  const twins = new Int32Array(indices.length).fill(-1);
  const groups = new Map();
  for (let e = 0; e < indices.length; e++) {
    const a = indices[e],
      b = indices[next(e)];
    const key = a < b ? a * vertexCount + b : b * vertexCount + a;
    const g = groups.get(key);
    if (g === undefined) groups.set(key, e);
    else if (typeof g === 'number') groups.set(key, [g, e]);
    else g.push(e);
  }
  let crowded = 0;
  for (const g of groups.values()) {
    if (typeof g === 'number') continue;
    if (g.length === 2) {
      twins[g[0]] = g[1];
      twins[g[1]] = g[0];
      continue;
    }
    crowded++;
    const pairs = positions ? pairAround(g, indices, positions) : null;
    if (pairs) {
      for (const [x, y] of pairs) {
        twins[x] = y;
        twins[y] = x;
      }
      continue;
    }
    const fwd = g.filter((e) => indices[e] < indices[next(e)]),
      back = g.filter((e) => indices[e] > indices[next(e)]);
    for (let i = 0; i < Math.min(fwd.length, back.length); i++) {
      twins[fwd[i]] = back[i];
      twins[back[i]] = fwd[i];
    }
  }
  return { twins, crowded };
}

// Where more than two triangles meet on an edge, pair them the way they sit
// around it: each triangle with its neighbour across the material behind it.
// Then neighbouring edges along a seam always agree. null if it does not work out.
function pairAround(group, indices, p) {
  const e0 = group[0];
  const a = indices[e0], b = indices[next(e0)];
  const A = [p[a * 3], p[a * 3 + 1], p[a * 3 + 2]];
  let d = [p[b * 3] - A[0], p[b * 3 + 1] - A[1], p[b * 3 + 2] - A[2]];
  const dl = Math.hypot(...d);
  if (!dl) return null;
  d = d.map((x) => x / dl);
  const pick = Math.abs(d[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const cr = (x, y) => [x[1] * y[2] - x[2] * y[1], x[2] * y[0] - x[0] * y[2], x[0] * y[1] - x[1] * y[0]];
  const dt = (x, y) => x[0] * y[0] + x[1] * y[1] + x[2] * y[2];
  const u = cr(d, pick), ul = Math.hypot(...u);
  const U = u.map((x) => x / ul), W = cr(d, U);
  const wings = group.map((e) => {
    const c = indices[next(next(e))];
    const w = [p[c * 3] - A[0], p[c * 3 + 1] - A[1], p[c * 3 + 2] - A[2]];
    const f = Math.floor(e / 3);
    const i0 = indices[f * 3] * 3, i1 = indices[f * 3 + 1] * 3, i2 = indices[f * 3 + 2] * 3;
    const n = cr(
      [p[i1] - p[i0], p[i1 + 1] - p[i0 + 1], p[i1 + 2] - p[i0 + 2]],
      [p[i2] - p[i0], p[i2 + 1] - p[i0 + 1], p[i2 + 2] - p[i0 + 2]],
    );
    const ww = [dt(w, U), dt(w, W)];
    // Turning further round the edge from this wing: into the material (behind the face)?
    const sweep = cr(d, w);
    return { e, angle: Math.atan2(ww[1], ww[0]), intoMaterial: dt(sweep, n) < 0 };
  });
  wings.sort((x, y) => x.angle - y.angle);
  const n = wings.length;
  if (n % 2) return null;
  const offset = wings[0].intoMaterial ? 0 : 1;
  const pairs = [];
  for (let i = 0; i < n; i += 2) {
    const x = wings[(i + offset) % n].e, y = wings[(i + offset + 1) % n].e;
    // A pair must run along the edge in opposite directions.
    if (indices[x] === indices[y]) return null;
    pairs.push([x, y]);
  }
  return pairs;
}

// Loose parts: triangles connected through paired edges.
export function partsOf(faceCount, twins) {
  const part = new Int32Array(faceCount).fill(-1);
  const sizes = [];
  const stack = [];
  for (let f = 0; f < faceCount; f++) {
    if (part[f] >= 0) continue;
    const id = sizes.length;
    let n = 0;
    part[f] = id;
    stack.push(f);
    while (stack.length) {
      const g = stack.pop();
      n++;
      for (let e = g * 3; e < g * 3 + 3; e++) {
        const t = twins[e];
        if (t < 0) continue;
        const h = faceOf(t);
        if (part[h] < 0) {
          part[h] = id;
          stack.push(h);
        }
      }
    }
    sizes.push(n);
  }
  return { part, sizes };
}

// Triangles with a repeated corner, and triangles that exist twice.
// Same-way doubles keep one copy; opposite doubles cancel out.
export function cleanFaces(indices) {
  const keep = new Uint8Array(indices.length / 3).fill(1);
  let collapsed = 0,
    doubled = 0;
  const seen = new Map();
  for (let f = 0; f < keep.length; f++) {
    const a = indices[f * 3], b = indices[f * 3 + 1], c = indices[f * 3 + 2];
    if (a === b || b === c || a === c) {
      keep[f] = 0;
      collapsed++;
      continue;
    }
    const s = [a, b, c].sort((x, y) => x - y);
    const key = `${s[0]},${s[1]},${s[2]}`;
    const other = seen.get(key);
    if (other === undefined) {
      seen.set(key, f);
      continue;
    }
    // Same turning direction if b follows a in the other triangle too.
    const o = [indices[other * 3], indices[other * 3 + 1], indices[other * 3 + 2]];
    const i = o.indexOf(a);
    const same = o[(i + 1) % 3] === b;
    keep[f] = 0;
    doubled++;
    if (!same && keep[other]) {
      keep[other] = 0;
      doubled++;
    }
  }
  const out = [];
  for (let f = 0; f < keep.length; f++) if (keep[f]) out.push(indices[f * 3], indices[f * 3 + 1], indices[f * 3 + 2]);
  return { indices: Uint32Array.from(out), collapsed, doubled };
}

// Turn every triangle of a part the same way as its neighbours.
// Returns a flip flag per triangle (1 = reverse it).
export function consistentFlips(indices, twins) {
  const n = indices.length / 3;
  const flip = new Uint8Array(n),
    seen = new Uint8Array(n);
  let changed = 0;
  const stack = [];
  for (let root = 0; root < n; root++) {
    if (seen[root]) continue;
    seen[root] = 1;
    stack.push(root);
    const members = [];
    while (stack.length) {
      const f = stack.pop();
      members.push(f);
      for (let e = f * 3; e < f * 3 + 3; e++) {
        const t = twins[e];
        if (t < 0) continue;
        const g = faceOf(t);
        // Consistent neighbours run along the shared edge in opposite directions.
        const sameDir = indices[e] === indices[t];
        const want = flip[f] ^ (sameDir ? 1 : 0);
        if (!seen[g]) {
          seen[g] = 1;
          flip[g] = want;
          stack.push(g);
        }
      }
    }
    // Keep the majority as they are.
    const flipped = members.reduce((s, f) => s + flip[f], 0);
    if (flipped * 2 > members.length) for (const f of members) flip[f] ^= 1;
    for (const f of members) changed += flip[f];
  }
  return { flip, changed };
}

export function applyFlips(indices, flip) {
  const out = Uint32Array.from(indices);
  for (let f = 0; f < flip.length; f++)
    if (flip[f]) [out[f * 3 + 1], out[f * 3 + 2]] = [out[f * 3 + 2], out[f * 3 + 1]];
  return out;
}

// Where surfaces only touch along an edge or at a point, give each surface
// its own copy of the shared corners. Nothing moves; the triangles just stop
// sharing what they should not share. Needs twins from pairEdges.
export function splitTouching(positions, indices, twins) {
  const corners = indices.length;
  const root = new Int32Array(corners);
  for (let c = 0; c < corners; c++) root[c] = c;
  const find = (c) => {
    while (root[c] !== c) c = root[c] = root[root[c]];
    return c;
  };
  const union = (a, b) => {
    a = find(a);
    b = find(b);
    if (a !== b) root[a] = b;
  };
  for (let e = 0; e < corners; e++) {
    const t = twins[e];
    if (t < e) continue;
    if (indices[e] === indices[next(t)]) {
      // Opposite directions: e = a→b, t = b→a.
      union(e, next(t));
      union(next(e), t);
    } else {
      // Same direction (left for orientParts): e = a→b, t = a→b.
      union(e, t);
      union(next(e), next(t));
    }
  }
  const vertexOf = new Map(); // fan root → new vertex id
  const used = new Uint8Array(positions.length / 3);
  const extra = [];
  let vertexCount = positions.length / 3;
  const out = new Uint32Array(corners);
  for (let c = 0; c < corners; c++) {
    const r = find(c),
      v = indices[c];
    let id = vertexOf.get(r);
    if (id === undefined) {
      if (!used[v]) {
        used[v] = 1;
        id = v;
      } else {
        id = vertexCount++;
        extra.push(v);
      }
      vertexOf.set(r, id);
    }
    out[c] = id;
  }
  const pos = new Float32Array(vertexCount * 3);
  pos.set(positions);
  extra.forEach((v, i) => pos.set(positions.subarray(v * 3, v * 3 + 3), (positions.length / 3 + i) * 3));
  // extra[i]: the corner that new corner number (old count + i) copies.
  return { positions: pos, indices: out, split: extra.length, extra };
}

// Last resort for edges that still carry more than two triangles: keep one
// opposite pair and remove the others. They lie over other triangles at
// that edge, so the surface does not change.
export function detachCrowded(positions, indices) {
  const V = positions.length / 3;
  const groups = new Map();
  for (let e = 0; e < indices.length; e++) {
    const a = indices[e], b = indices[next(e)];
    const key = a < b ? a * V + b : b * V + a;
    (groups.get(key) ?? groups.set(key, []).get(key)).push(e);
  }
  const drop = new Set();
  for (const g of groups.values()) {
    if (g.length <= 2) continue;
    const live = g.filter((e) => !drop.has(faceOf(e)));
    const first = live[0];
    const partner = live.find((e) => indices[e] !== indices[first]);
    for (const e of live) if (e !== first && e !== partner) drop.add(faceOf(e));
  }
  if (!drop.size) return { positions, indices, detached: 0 };
  const out = [];
  for (let f = 0; f < indices.length / 3; f++) if (!drop.has(f)) out.push(indices[f * 3], indices[f * 3 + 1], indices[f * 3 + 2]);
  return { positions, indices: Uint32Array.from(out), detached: drop.size };
}

// Openings: closed chains of open half-edges, as vertex lists that run the
// way a patch should run to fit its neighbours. Deterministic order.
export function boundaryLoops(indices, twins) {
  const start = new Map(); // vertex → open half-edges leaving it (reversed direction)
  for (let e = 0; e < indices.length; e++) {
    if (twins[e] >= 0) continue;
    // The patch runs b→a along the open edge a→b.
    const a = indices[e], b = indices[next(e)];
    const list = start.get(b);
    if (list) list.push(a);
    else start.set(b, [a]);
  }
  const loops = [];
  const used = new Set();
  const keys = [...start.keys()].sort((x, y) => x - y);
  for (const v0 of keys) {
    for (const first of start.get(v0)) {
      const k0 = `${v0}>${first}`;
      if (used.has(k0)) continue;
      const loop = [v0];
      used.add(k0);
      let v = first,
        ok = true;
      while (v !== v0) {
        loop.push(v);
        const options = (start.get(v) ?? []).filter((w) => !used.has(`${v}>${w}`));
        if (!options.length || loop.length > indices.length) {
          ok = false;
          break;
        }
        const w = options[0];
        used.add(`${v}>${w}`);
        v = w;
      }
      if (ok && loop.length >= 3) loops.push(loop);
    }
  }
  return loops;
}

export function loopLength(positions, loop) {
  let s = 0;
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i] * 3,
      b = loop[(i + 1) % loop.length] * 3;
    s += Math.hypot(positions[a] - positions[b], positions[a + 1] - positions[b + 1], positions[a + 2] - positions[b + 2]);
  }
  return s;
}
