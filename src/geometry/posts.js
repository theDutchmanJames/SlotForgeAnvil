// Body posts: round posts that hang from the inside of the body down to the
// chassis, with a screw hole or a socket for a brass tube or threaded insert.
// Each post is its own closed piece overlapping the body (slicers merge
// overlapping pieces). Car frame: Z up, front at low X.
import { rayCaster } from './rays.js';

// Ready-made post types. Sizes in mm.
export const POST_TYPES = {
  screw: { name: 'M2 screw post', kind: 'screw', outer: 4.0, hole: 1.6, depth: 6, fillet: 1.2 },
  socket: { name: 'Brass tube / insert socket', kind: 'socket', outer: 4.6, hole: 3.1, depth: 0, fillet: 1.2 },
};

export function checkPostType(t) {
  if (!(t?.outer > 0) || !(t.hole >= 0) || t.hole >= t.outer) throw Error('A post needs a hole smaller than the post.');
  return t;
}
// How thick the wall of the post is round its hole.
export const postWall = (t) => (t.outer - t.hole) / 2;

// A closed solid made by turning a profile [[r, z], ...] round the Z axis
// at (cx, cy). Points with r = 0 become a single point on the axis.
export function revolve(profile, cx, cy, segments = 32) {
  const pos = [],
    idx = [];
  const ring = profile.map(([r, z]) => {
    if (r <= 1e-9) {
      pos.push(cx, cy, z);
      return { pole: pos.length / 3 - 1 };
    }
    const start = pos.length / 3;
    for (let k = 0; k < segments; k++) {
      const a = (2 * Math.PI * k) / segments;
      pos.push(cx + r * Math.cos(a), cy + r * Math.sin(a), z);
    }
    return { start };
  });
  const at = (p, k) => (p.pole !== undefined ? p.pole : p.start + (k % segments));
  for (let i = 0; i < profile.length; i++) {
    const a = ring[i], b = ring[(i + 1) % profile.length];
    if (a.pole !== undefined && b.pole !== undefined) continue; // along the axis: no surface
    for (let k = 0; k < segments; k++) {
      const a0 = at(a, k), a1 = at(a, k + 1), b0 = at(b, k), b1 = at(b, k + 1);
      if (a.pole !== undefined) idx.push(a0, b0, b1);
      else if (b.pole !== undefined) idx.push(a0, b0, a1);
      else idx.push(a0, b0, b1, a0, b1, a1);
    }
  }
  // Make sure it faces outwards.
  let vol = 0;
  for (let f = 0; f < idx.length; f += 3) {
    const [a, b, c] = [idx[f] * 3, idx[f + 1] * 3, idx[f + 2] * 3];
    vol +=
      pos[a] * (pos[b + 1] * pos[c + 2] - pos[b + 2] * pos[c + 1]) -
      pos[a + 1] * (pos[b] * pos[c + 2] - pos[b + 2] * pos[c]) +
      pos[a + 2] * (pos[b] * pos[c + 1] - pos[b + 1] * pos[c]);
  }
  if (vol < 0) for (let f = 0; f < idx.length; f += 3) [idx[f + 1], idx[f + 2]] = [idx[f + 2], idx[f + 1]];
  return { positions: pos, indices: idx };
}

// The profile of one post, bottom (zb) to top (zt). The top flares out so
// it holds on to the body. Optional V-groove at zCut marks where to cut it.
// The screw hole is measured from holeFrom (the cut mark on a fixed-length post).
export function postProfile(t, zb, zt, zCut = null, holeFrom = zb) {
  const R = t.outer / 2,
    rh = t.hole / 2;
  const f = Math.min(t.fillet ?? 0, (zt - zb) * 0.3);
  const top = zt;
  // Screw post: blind hole from the bottom. Socket: deep hole, top closed by 0.8 mm.
  const depth =
    t.kind === 'socket' || !(t.depth > 0) ? Math.max(0, zt - zb - 0.8) : Math.min(t.depth + Math.max(0, holeFrom - zb), zt - zb - 0.6);
  const p = [];
  if (rh > 0 && depth > 0) p.push([rh, zb]);
  else p.push([0, zb]);
  p.push([R, zb]);
  if (zCut != null && zCut > zb + 0.3 && zCut < top - f - 0.3) {
    const g = Math.min(0.15, R * 0.1);
    p.push([R, zCut - g], [R - g, zCut], [R, zCut + g]);
  }
  if (f > 0) p.push([R, top - f], [R + f * 0.5, top - f * 0.3], [R + f, top]);
  else p.push([R, top]);
  p.push([0, top]);
  if (rh > 0 && depth > 0) p.push([0, zb + depth], [rh, zb + depth]);
  return p;
}

// params: { posts: [{ x, y, base?, length? }], type, base, length }
//   base:   height of the posts' bottom (chassis deck + float gap)
//   length: fixed length (hangs from the body; cut to fit), else automatic
// A post's own base / length win over the shared ones.
export function applyPosts(mesh, { posts: list = [], type, base = 0, length = 0, segments = 32 }) {
  const t = checkPostType(type);
  const posts = list.map((p) => ({ ...p, base: p.base ?? base, length: p.length ?? length }));
  const zs = mesh.positions.filter((_, i) => i % 3 === 2);
  const bodyBottom = zs.length ? zs.reduce((a, b) => Math.min(a, b), Infinity) : 0;
  const cast = rayCaster(mesh.positions, mesh.indices);
  const pos = Array.from(mesh.positions),
    idx = Array.from(mesh.indices);
  const warnings = [];
  const reach = t.outer / 2 + (t.fillet ?? 0);
  const up = [0, 0, 1];
  let made = 0;
  for (const post of posts) {
    // The underside of the body across the whole (flared) top of the post.
    // The flat top goes as far into the wall as it can everywhere while
    // leaving at least 40% of the wall untouched, so it never shows outside.
    const ring = (r, n) => Array.from({ length: n }, (_, k) => [r * Math.cos((2 * k * Math.PI) / n), r * Math.sin((2 * k * Math.PI) / n)]);
    const samples = [[0, 0], ...ring(reach * 0.5, 6), ...ring(reach, 12)];
    let low = Infinity,
      top = Infinity,
      hits = 0;
    for (const [dx, dy] of samples) {
      const o = [post.x + dx, post.y + dy, post.base];
      const d = cast(o, up);
      if (d === Infinity) continue;
      hits++;
      const under = post.base + d;
      const w = cast([o[0], o[1], under + 0.005], up) + 0.005;
      const wall = Number.isFinite(w) ? Math.min(w, 3) : 0.6;
      low = Math.min(low, under);
      top = Math.min(top, under + wall * 0.6);
    }
    if (!hits || !samples.slice(0, 7).some(([dx, dy]) => cast([post.x + dx, post.y + dy, post.base], up) !== Infinity)) {
      warnings.push({ post, text: 'No body above this post' });
      continue;
    }
    top = Math.max(top, low + 0.05);
    const auto = top - post.base;
    if (auto < t.outer * 0.5) warnings.push({ post, text: 'Very short: the body is almost on the chassis here' });
    const fixed = post.length > 0;
    if (fixed && post.length < auto) warnings.push({ post, text: `Fixed length is ${(auto - post.length).toFixed(1)} mm too short to reach the chassis` });
    const zb = fixed ? top - Math.max(post.length, 1) : post.base;
    const cutAt = fixed && post.cutMark !== false ? post.base : null;
    const m = revolve(postProfile(t, zb, top, cutAt, fixed ? Math.max(zb, post.base) : zb), post.x, post.y, segments);
    const off = pos.length / 3;
    pos.push(...m.positions);
    for (const v of m.indices) idx.push(v + off);
    made++;
  }
  if (postWall(t) < 0.8) warnings.push({ text: `The post wall round the hole is only ${postWall(t).toFixed(2)} mm` });
  return {
    positions: Float32Array.from(pos),
    indices: Uint32Array.from(idx),
    // bodyBottom: the lowest point before the posts, so the chassis does not
    // drop when a long fixed-length post hangs below the body.
    info: { made, bodyBottom, warnings: warnings.map((w) => (w.post ? `${w.text} (at ${w.post.x.toFixed(1)}, ${w.post.y.toFixed(1)})` : w.text)) },
  };
}

// A single loose post, standing on Z = 0, to print separately.
export function loosePost(type, length) {
  const t = checkPostType(type);
  const m = revolve(postProfile({ ...t, fillet: 0 }, 0, length), 0, 0, 48);
  return { positions: Float32Array.from(m.positions), indices: Uint32Array.from(m.indices) };
}

// A fit test piece: one post hanging under a small square of wall. Printed
// upside down it needs no supports.
export function fitTestPiece(type, wall = 1, length = 8) {
  const t = checkPostType(type);
  const s = Math.max(t.outer * 3, 12) / 2;
  const box = {
    positions: [-s, -s, 0, s, -s, 0, s, s, 0, -s, s, 0, -s, -s, wall, s, -s, wall, s, s, wall, -s, s, wall],
    indices: [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7],
  };
  const post = revolve(postProfile(t, -length, wall * 0.5), 0, 0, 48);
  const off = box.positions.length / 3;
  return {
    positions: Float32Array.from([...box.positions, ...post.positions]),
    indices: Uint32Array.from([...box.indices, ...post.indices.map((v) => v + off)]),
  };
}
