// Cut off: remove a part (a mirror, a spoiler) with small cutting planes.
// Car frame: X along (front low), Y across (centre line 0), Z up.
//
// A cut is a rectangle: { at: [x, y, z] (its middle), normal (points to the
// side to remove), up (a direction along the rectangle), w, h }. Only
// triangles whose crossing lies inside a rectangle are cut. Then everything
// on the removed side of the cuts that is joined to them is taken away. When
// the cuts do not free the part, that would be most of the model, and the
// step stops instead. The cut is closed flat unless open is asked.
import { Vector2 } from 'three';
import { capLoops } from './finish.js';
import { boundaryLoops, pairEdges } from './topology.js';

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a) => {
  const l = Math.hypot(...a);
  return l > 0 ? a.map((x) => x / l) : null;
};

// The rectangle's frame: n (to the removed side), u along w, v along h.
export function cutFrame(cut) {
  const n = unit(cut.normal ?? []);
  if (!n || !cut.at?.every(Number.isFinite)) throw Error('Place the cutting plane on the model first.');
  if (!(cut.w > 0) || !(cut.h > 0)) throw Error('Give the cutting plane a width and a height above 0.');
  let up = cut.up ?? [0, 0, 1];
  let u = unit(sub(up, n.map((x) => x * dot(up, n))));
  if (!u) u = unit(cross(n, Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]));
  const v = cross(n, u);
  return { c: cut.at, n, u, v, hw: cut.w / 2, hh: cut.h / 2 };
}

// The same cut on the other side of the centre line (Y = 0).
export function mirrorCut(cut) {
  const f = (p) => p && [p[0], -p[1], p[2]];
  return { ...cut, at: f(cut.at), normal: f(cut.normal), up: f(cut.up) };
}

// Split the triangles the rectangles cross. Each triangle keeps the number of
// the model face it came from, and a flag: 1 on the removed side of a cut,
// 2 on the kept side. onCut[v] has bit k set when corner v lies on cut k.
function split(mesh, frames) {
  const pos = Array.from(mesh.positions);
  let tris = Array.from(mesh.indices);
  let parent = Array.from({ length: tris.length / 3 }, (_, f) => f);
  let flag = new Array(parent.length).fill(0);
  const onCut = new Map();
  const used = frames.map(() => false);
  frames.forEach((fr, k) => {
    const V = pos.length / 3;
    const d = new Float64Array(V);
    for (let i = 0; i < V; i++) d[i] = dot(sub([pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]], fr.c), fr.n);
    const point = (i) => [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]];
    const mark = (i) => onCut.set(i, (onCut.get(i) ?? 0) | (1 << k));
    const made = new Map();
    const crossing = (a, b) => {
      if (d[a] === 0) return mark(a), a;
      if (d[b] === 0) return mark(b), b;
      const key = a < b ? a * V + b : b * V + a;
      let id = made.get(key);
      if (id === undefined) {
        const t = d[a] / (d[a] - d[b]);
        const pa = point(a), pb = point(b);
        id = pos.length / 3;
        for (let c = 0; c < 3; c++) pos.push(pa[c] + t * (pb[c] - pa[c]));
        made.set(key, id);
        mark(id);
      }
      return id;
    };
    const nt = [], np = [], nf = [];
    const clip = (tri, keep) => {
      const poly = [];
      const add = (x) => poly.at(-1) !== x && poly.push(x);
      for (let i = 0; i < 3; i++) {
        const a = tri[i], b = tri[(i + 1) % 3];
        if (keep(a)) add(a);
        if (keep(a) !== keep(b)) add(crossing(a, b));
      }
      if (poly.length > 1 && poly[0] === poly.at(-1)) poly.pop();
      const out = [];
      for (let i = 1; i + 1 < poly.length; i++) out.push([poly[0], poly[i], poly[i + 1]]);
      return out;
    };
    // The triangles the plane crosses, joined into the lines it draws on the
    // model. A line is cut only when all of it lies inside the rectangle, so
    // a cut never stops halfway along a surface.
    const F = parent.length;
    const crosses = new Uint8Array(F);
    const fits = new Uint8Array(F);
    const root = new Int32Array(F).map((_, f) => f);
    const find = (f) => {
      while (root[f] !== f) f = root[f] = root[root[f]];
      return f;
    };
    const join = new Map();
    const meet = (key, f) => {
      const g = join.get(key);
      if (g === undefined) join.set(key, f);
      else root[find(f)] = find(g);
    };
    for (let f = 0; f < F; f++) {
      const tri = [tris[f * 3], tris[f * 3 + 1], tris[f * 3 + 2]];
      const ds = tri.map((i) => d[i]);
      if (!(ds.some((x) => x > 0) && ds.some((x) => x < 0))) continue;
      crosses[f] = 1;
      let ok = true;
      for (let i = 0; i < 3; i++) {
        const a = tri[i], b = tri[(i + 1) % 3];
        let p = null;
        if (d[a] === 0) {
          p = point(a);
          meet(-1 - a, f);
        } else if ((d[a] > 0 && d[b] < 0) || (d[a] < 0 && d[b] > 0)) {
          const t = d[a] / (d[a] - d[b]), pa = point(a), pb = point(b);
          p = pa.map((x, c) => x + t * (pb[c] - x));
          meet(a < b ? a * V + b : b * V + a, f);
        }
        if (p) {
          const r = sub(p, fr.c);
          if (Math.abs(dot(r, fr.u)) > fr.hw || Math.abs(dot(r, fr.v)) > fr.hh) ok = false;
        }
      }
      fits[f] = ok ? 1 : 0;
    }
    const lineFits = new Map();
    for (let f = 0; f < F; f++) if (crosses[f]) lineFits.set(find(f), (lineFits.get(find(f)) ?? true) && !!fits[f]);
    for (let f = 0; f < parent.length; f++) {
      const tri = [tris[f * 3], tris[f * 3 + 1], tris[f * 3 + 2]];
      const inside = crosses[f] && lineFits.get(find(f));
      if (!inside) {
        nt.push(...tri);
        np.push(parent[f]);
        nf.push(flag[f]);
        continue;
      }
      used[k] = true;
      for (const t of clip(tri, (i) => d[i] >= 0)) nt.push(...t), np.push(parent[f]), nf.push(flag[f] | 1);
      for (const t of clip(tri, (i) => d[i] <= 0)) nt.push(...t), np.push(parent[f]), nf.push(flag[f] | 2);
    }
    tris = nt;
    parent = np;
    flag = nf;
  });
  return { positions: Float32Array.from(pos), indices: Uint32Array.from(tris), parent, flag, onCut, used };
}

// Which triangles of the split model go: those on the removed side of a cut,
// and all that joins them without crossing back over a cut.
function removedFaces(sp) {
  const F = sp.parent.length;
  const { twins } = pairEdges(sp.indices, sp.positions.length / 3, sp.positions);
  const gone = new Uint8Array(F);
  const stack = [];
  for (let f = 0; f < F; f++) if (sp.flag[f] & 1 && !(sp.flag[f] & 2)) (gone[f] = 1), stack.push(f);
  while (stack.length) {
    const f = stack.pop();
    for (let e = f * 3; e < f * 3 + 3; e++) {
      const t = twins[e];
      if (t < 0) continue;
      const g = Math.floor(t / 3);
      if (gone[g] || sp.flag[g] & 2) continue;
      gone[g] = 1;
      stack.push(g);
    }
  }
  return gone;
}

const area = (P, T, f) => {
  const a = [P[T[f * 3] * 3], P[T[f * 3] * 3 + 1], P[T[f * 3] * 3 + 2]];
  const b = [P[T[f * 3 + 1] * 3], P[T[f * 3 + 1] * 3 + 1], P[T[f * 3 + 1] * 3 + 2]];
  const c = [P[T[f * 3 + 2] * 3], P[T[f * 3 + 2] * 3 + 1], P[T[f * 3 + 2] * 3 + 2]];
  return Math.hypot(...cross(sub(b, a), sub(c, a))) / 2;
};

// The cuts this step makes: its own, and their mirror copies when asked.
function cutList({ cuts = [], mirror = false }) {
  if (!cuts.length) throw Error('Place a cutting plane on the model first.');
  const list = cuts.map((c) => ({ cut: c, copy: false }));
  if (mirror) for (const c of cuts) list.push({ cut: mirrorCut(c), copy: true });
  return list;
}

function plan(mesh, params) {
  const list = cutList(params);
  const frames = list.map((l) => cutFrame(l.cut));
  const sp = split(mesh, frames);
  list.forEach((l, k) => {
    if (!sp.used[k] && !l.copy) throw Error(`Cutting plane ${k + 1} does not cut through the model. Move it onto the part.`);
  });
  const gone = removedFaces(sp);
  let all = 0, cut = 0;
  for (let f = 0; f < gone.length; f++) {
    const a = area(sp.positions, sp.indices, f);
    all += a;
    if (gone[f]) cut += a;
  }
  return { list, frames, sp, gone, share: all > 0 ? cut / all : 0 };
}

const TOO_MUCH = 0.5;
const tooMuch = 'This would remove most of the model: the plane does not cut the part off all round. Make the plane bigger or move it, or add a cut for each leg.';

// For the view: which faces of the model would go (a face cut in two counts),
// and how much of the model that is. Never throws: a problem is in error.
export function cutoffPreview(mesh, params) {
  try {
    const { sp, gone, share } = plan(mesh, params);
    const faces = new Uint8Array(mesh.indices.length / 3);
    for (let f = 0; f < gone.length; f++) if (gone[f]) faces[sp.parent[f]] = 1;
    return { faces, share, error: share > TOO_MUCH ? tooMuch : null };
  } catch (e) {
    return { faces: null, share: 0, error: e.message };
  }
}

export function applyCutoff(mesh, params) {
  const { list, frames, sp, gone, share } = plan(mesh, params);
  if (share > TOO_MUCH) throw Error(tooMuch);
  // Keep the rest, and drop corners nothing uses.
  const keep = [];
  let removed = 0;
  for (let f = 0; f < gone.length; f++)
    if (gone[f]) removed++;
    else keep.push(sp.indices[f * 3], sp.indices[f * 3 + 1], sp.indices[f * 3 + 2]);
  if (!removed) throw Error('Nothing is cut off. Turn the plane round with Flip side.');
  const map = new Int32Array(sp.positions.length / 3).fill(-1);
  let n = 0;
  for (const v of keep) if (map[v] < 0) map[v] = n++;
  const P = new Float32Array(n * 3);
  const onCut = new Int32Array(n);
  for (let v = 0; v < map.length; v++)
    if (map[v] >= 0) {
      P.set(sp.positions.subarray(v * 3, v * 3 + 3), map[v] * 3);
      onCut[map[v]] = sp.onCut.get(v) ?? 0;
    }
  let mesh2 = { positions: P, indices: Uint32Array.from(keep, (v) => map[v]) };
  let capped = 0;
  if (!params.open) {
    const { twins } = pairEdges(mesh2.indices, n, P);
    const loops = boundaryLoops(mesh2.indices, twins);
    frames.forEach((fr, k) => {
      const mine = loops.filter((l) => l.every((v) => onCut[v] & (1 << k)));
      if (!mine.length) return;
      const flatten = (v) => {
        const r = sub([P[v * 3], P[v * 3 + 1], P[v * 3 + 2]], fr.c);
        return new Vector2(dot(r, fr.u), dot(r, fr.v));
      };
      const c = capLoops(mesh2, mine, flatten);
      mesh2 = c.mesh;
      capped += c.capped;
    });
  }
  const missed = list.filter((l, k) => l.copy && !sp.used[k]).length;
  return { ...mesh2, info: { changed: removed, capped, ...(missed ? { missed } : {}) } };
}
