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
import { prism } from './mounts.js';
import { glueTabs } from './gluetabs.js';
import { rayCaster } from './rays.js';
import { boundaryLoops, joinMeshes, pairEdges, partsOf } from './topology.js';

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

// One side of the split model (the faces where gone === side), compacted,
// with each corner's cut bits.
function piece(sp, gone, side) {
  const keep = [];
  for (let f = 0; f < gone.length; f++) if (gone[f] === side) keep.push(sp.indices[f * 3], sp.indices[f * 3 + 1], sp.indices[f * 3 + 2]);
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
  return { mesh: { positions: P, indices: Uint32Array.from(keep, (v) => map[v]) }, onCut };
}

// The cut's openings in a piece, laid flat in the cut's frame.
function cutLoops(pc, fr, k) {
  const P = pc.mesh.positions;
  const { twins } = pairEdges(pc.mesh.indices, P.length / 3, P);
  const loops = boundaryLoops(pc.mesh.indices, twins).filter((l) => l.every((v) => pc.onCut[v] & (1 << k)));
  const flat = (p) => {
    const r = sub(p, fr.c);
    return new Vector2(dot(r, fr.u), dot(r, fr.v));
  };
  return { loops, flat, flatten: (v) => flat([P[v * 3], P[v * 3 + 1], P[v * 3 + 2]]) };
}

export const PIN_DEFAULTS = { count: 1, diameter: 1.5, length: 3, clearance: 0.1, on: 'auto', gap: 10 };

export function applyCutoff(mesh, params) {
  const { list, frames, sp, gone, share } = plan(mesh, params);
  if (share > TOO_MUCH) throw Error(tooMuch);
  let removed = 0;
  for (let f = 0; f < gone.length; f++) removed += gone[f];
  if (!removed) throw Error('Nothing is cut off. Turn the plane round with Flip side.');
  const missed = list.filter((l, k) => l.copy && !sp.used[k]).length;
  if (params.split) return splitOff(sp, gone, frames, { ...params.split, base: params.cuts.length }, { changed: removed, ...(missed ? { missed } : {}) });
  // Keep the rest, and close the cut.
  const body = piece(sp, gone, 0);
  let mesh2 = body.mesh;
  let capped = 0;
  if (!params.open) {
    frames.forEach((fr, k) => {
      const { loops, flatten } = cutLoops({ mesh: mesh2, onCut: body.onCut }, fr, k);
      if (!loops.length) return;
      const c = capLoops(mesh2, loops, flatten);
      mesh2 = c.mesh;
      capped += c.capped;
    });
  }
  return { ...mesh2, info: { changed: removed, capped, ...(missed ? { missed } : {}) } };
}

// ------------------------------------------------------------ split off

// Where pins go on a cut face: the points furthest inside it, away from its
// edges and holes. Returns [{ p: Vector2, room }], best first.
function pinSpots(polys, count, r) {
  // polys: the face's outlines (Vector2 rings); a point is inside when inside
  // an odd number of them.
  const inside = (p) => {
    let odd = false;
    for (const ring of polys)
      for (let a = 0, b = ring.length - 1; a < ring.length; b = a++)
        if (ring[a].y > p.y !== ring[b].y > p.y && p.x < ((ring[b].x - ring[a].x) * (p.y - ring[a].y)) / (ring[b].y - ring[a].y) + ring[a].x) odd = !odd;
    return odd;
  };
  const edgeDist = (p) => {
    let d = Infinity;
    for (const ring of polys)
      for (let a = 0, b = ring.length - 1; a < ring.length; b = a++) {
        const A = ring[b], B = ring[a];
        const ex = B.x - A.x, ey = B.y - A.y;
        const t = Math.max(0, Math.min(1, ((p.x - A.x) * ex + (p.y - A.y) * ey) / (ex * ex + ey * ey || 1)));
        d = Math.min(d, Math.hypot(p.x - A.x - t * ex, p.y - A.y - t * ey));
      }
    return d;
  };
  let lo = new Vector2(Infinity, Infinity), hi = new Vector2(-Infinity, -Infinity);
  for (const ring of polys) for (const p of ring) (lo = lo.min(p)), (hi = hi.max(p));
  const n = 48;
  const cands = [];
  for (let i = 0; i <= n; i++)
    for (let j = 0; j <= n; j++) {
      const p = new Vector2(lo.x + ((hi.x - lo.x) * i) / n, lo.y + ((hi.y - lo.y) * j) / n);
      if (inside(p)) cands.push({ p, room: edgeDist(p) });
    }
  cands.sort((a, b) => b.room - a.room);
  const out = [];
  for (const c of cands) {
    if (out.length >= count) break;
    if (out.some((o) => o.p.distanceTo(c.p) < 2 * r + 2 * Math.max(0.8, r))) continue;
    out.push(c);
  }
  return out;
}

function splitOff(sp, gone, frames, opts, info) {
  const o = { ...PIN_DEFAULTS, ...opts };
  const r = o.diameter / 2, rh = r + o.clearance;
  const warnings = [];
  const pieces = [piece(sp, gone, 0), piece(sp, gone, 1)]; // body, part
  const extra = [[], []]; // pins and glue tabs, as their own closed pieces, per side
  let pins = 0,
    glued = 0;
  frames.forEach((fr, k) => {
    const cl = [cutLoops(pieces[0], fr, k), cutLoops(pieces[1], fr, k)];
    if (!cl[0].loops.length && !cl[1].loops.length) return;
    // Glue tabs, on the open cut of their piece.
    const g = cutTabs(sp, pieces, fr, k, o.glue, o.base);
    if (g) {
      extra[g.side].push(...g.pieces);
      glued += g.placed.length;
      warnings.push(...g.warnings);
    }
    const to3 = (q, a = 0) => fr.c.map((c, i) => c + q.x * fr.u[i] + q.y * fr.v[i] + a * fr.n[i]);
    // Pins: on the body's face (both faces are the same outline).
    const polys = cl[0].loops.map((l) => l.map(cl[0].flatten));
    const spots = o.count > 0 && polys.length ? pinSpots(polys, o.count, rh) : [];
    const holes = [[], []];
    for (const s of spots) {
      if (s.room < rh + 0.6) {
        warnings.push(`No room for a ${o.diameter} mm pin on cut ${k + 1}: the cut face is only ${(2 * s.room).toFixed(1)} mm across there`);
        continue;
      }
      // Room behind each face for a hole: the body lies against the arrow, the part along it.
      const room = [0, 1].map((side) => {
        const cast = rayCaster(pieces[side].mesh.positions, pieces[side].mesh.indices);
        const dir = side ? fr.n : fr.n.map((x) => -x);
        const start = to3(s.p).map((c, i) => c + dir[i] * 1e-3);
        return cast(start, dir);
      });
      let holeSide = o.on === 'body' ? 0 : o.on === 'part' ? 1 : room[0] >= room[1] ? 0 : 1;
      let length = o.length;
      if (room[holeSide] < length + 0.8) {
        const fits = room[holeSide] - 0.8;
        if (fits >= o.diameter) {
          warnings.push(`Pin on cut ${k + 1} shortened to ${fits.toFixed(1)} mm: no more room behind the hole`);
          length = fits;
        } else {
          warnings.push(`No room for a pin hole on cut ${k + 1}: the ${holeSide ? 'part' : 'body'} is only ${room[holeSide].toFixed(1)} mm deep there`);
          continue;
        }
      }
      holes[holeSide].push({ p: s.p, depth: length + 0.3 });
      // The pin on the other side, standing out of its face into the hole.
      const pinSide = 1 - holeSide;
      const out = pinSide ? -1 : 1; // the part's pin points against the arrow
      const ring = Array.from({ length: 24 }, (_, i) => [s.p.x + r * Math.cos((2 * Math.PI * i) / 24), s.p.y + r * Math.sin((2 * Math.PI * i) / 24)]);
      extra[pinSide].push(prism(ring, [], -0.5 * out, length * out, (u, v, a) => to3(new Vector2(u, v), a)));
      pins++;
    }
    // Close both faces, the holes left open in them, then the bores.
    for (const side of [0, 1]) {
      const pc = pieces[side];
      const { loops, flatten } = cutLoops(pc, fr, k);
      if (!loops.length) continue;
      const pos = Array.from(pc.mesh.positions);
      const rings = [];
      for (const h of holes[side]) {
        const ring = [];
        for (let i = 0; i < 24; i++) {
          ring.push(pos.length / 3);
          pos.push(...to3(new Vector2(h.p.x + rh * Math.cos((2 * Math.PI * i) / 24), h.p.y + rh * Math.sin((2 * Math.PI * i) / 24))));
        }
        rings.push({ ring, h });
      }
      const P = Float32Array.from(pos);
      const flat2 = (v) => {
        const r2 = sub([P[v * 3], P[v * 3 + 1], P[v * 3 + 2]], fr.c);
        return new Vector2(dot(r2, fr.u), dot(r2, fr.v));
      };
      const c = capLoops({ positions: P, indices: pc.mesh.indices }, [...loops, ...rings.map((x) => x.ring)], flat2);
      const idx = Array.from(c.mesh.indices);
      const cap = new Set();
      for (let f = pc.mesh.indices.length; f < idx.length; f += 3)
        for (let e = 0; e < 3; e++) cap.add(`${idx[f + e]}>${idx[f + ((e + 1) % 3)]}`);
      const into = side ? 1 : -1; // into the piece's material
      for (const { ring, h } of rings) {
        // Bottom of the bore, and its wall, running against the face round the hole.
        const bottom = ring.map((v) => {
          const id = pos.length / 3;
          pos.push(P[v * 3] + fr.n[0] * into * h.depth, P[v * 3 + 1] + fr.n[1] * into * h.depth, P[v * 3 + 2] + fr.n[2] * into * h.depth);
          return id;
        });
        const mid = pos.length / 3;
        pos.push(...to3(h.p, into * h.depth));
        const forward = cap.has(`${ring[0]}>${ring[1]}`);
        for (let i = 0; i < ring.length; i++) {
          const j = (i + 1) % ring.length;
          let [p, q, pb, qb] = [ring[i], ring[j], bottom[i], bottom[j]];
          if (!forward) [p, q, pb, qb] = [q, p, qb, pb];
          idx.push(q, p, pb, q, pb, qb, mid, qb, pb);
        }
      }
      pieces[side] = { mesh: { positions: Float32Array.from(pos), indices: Uint32Array.from(idx) }, onCut: pc.onCut };
    }
  });
  // Move the part away from the body along its cuts, a piece at a time.
  const part = pieces[1].mesh;
  const { twins } = pairEdges(part.indices, part.positions.length / 3, part.positions);
  const { part: comp, sizes } = partsOf(part.indices.length / 3, twins);
  const dirs = sizes.map(() => [0, 0, 0]);
  const onCut1 = pieces[1].onCut;
  for (let f = 0; f < comp.length; f++)
    for (let e = 0; e < 3; e++) {
      const v = part.indices[f * 3 + e];
      const bits = v < onCut1.length ? onCut1[v] : 0;
      frames.forEach((fr, k) => {
        if (bits & (1 << k)) for (let i = 0; i < 3; i++) dirs[comp[f]][i] += fr.n[i];
      });
    }
  const off = dirs.map((d) => (unit(d) ?? [0, 0, 0]).map((x) => x * o.gap));
  const P1 = Float32Array.from(part.positions);
  const moved = new Uint8Array(P1.length / 3);
  for (let f = 0; f < comp.length; f++)
    for (let e = 0; e < 3; e++) {
      const v = part.indices[f * 3 + e];
      if (moved[v]) continue;
      moved[v] = 1;
      for (let i = 0; i < 3; i++) P1[v * 3 + i] += off[comp[f]][i];
    }
  // The part's pins go with the piece nearest them.
  const partPins = extra[1].map((pin) => {
    const c = [0, 1, 2].map((i) => pin.positions.filter((_, n) => n % 3 === i).reduce((s, x) => s + x, 0) / (pin.positions.length / 3));
    let best = 0, bd = Infinity;
    for (let f = 0; f < comp.length; f++) {
      const v = part.indices[f * 3];
      const d = Math.hypot(part.positions[v * 3] - c[0], part.positions[v * 3 + 1] - c[1], part.positions[v * 3 + 2] - c[2]);
      if (d < bd) (bd = d), (best = comp[f]);
    }
    return { positions: pin.positions.map((x, n) => x + off[best][n % 3]), indices: pin.indices };
  });
  // All together: the body, its pins, the part and its pins.
  const all = joinMeshes([pieces[0].mesh, ...extra[0], { positions: P1, indices: part.indices }, ...partPins]);
  return { ...all, info: { ...info, split: true, pins, glue: glued, warnings } };
}

// Glue tabs on cut k: on the body (side 0) or the part (side 1), with the
// cut's normal turned to point from that piece to the other.
function cutTabs(sp, pieces, fr, k, glue, base = Infinity) {
  let tabs = (glue?.tabs ?? []).filter((t) => (t.k ?? 0) === k);
  // A mirrored copy of a cut gets the tabs of its own cut (mirroring runs the edge the other way).
  if (!tabs.length && k >= base) tabs = (glue?.tabs ?? []).filter((t) => (t.k ?? 0) === k - base).map((t) => ({ ...t, s: 1 - t.s }));
  if (!tabs.length) return null;
  const side = glue.on === 'part' ? 1 : 0;
  const n = side ? fr.n.map((x) => -x) : fr.n;
  const g = glueTabs(pieces[side].mesh, { positions: sp.positions, indices: sp.indices }, { c: fr.c, n, u: fr.u, v: fr.v }, tabs, glue);
  return { side, ...g, warnings: g.warnings.map((w) => (k > 0 ? `Cut ${k + 1}: ${w}` : w)) };
}

// For the view: where the glue tabs of a split go (blocks to draw), before it is made.
export function splitTabPreview(mesh, params) {
  try {
    const { frames, sp, gone } = plan(mesh, params);
    const pieces = [piece(sp, gone, 0), piece(sp, gone, 1)];
    const out = { pieces: [], placed: [], warnings: [] };
    frames.forEach((fr, k) => {
      const g = cutTabs(sp, pieces, fr, k, params.split?.glue, params.cuts.length);
      if (!g) return;
      out.pieces.push(...g.pieces);
      out.placed.push(...g.placed.map((p) => ({ ...p, k })));
      out.warnings.push(...g.warnings);
    });
    return out;
  } catch (e) {
    return { pieces: [], placed: [], warnings: [e.message] };
  }
}
