// LED pockets behind headlights and taillights. At the light, a bore the
// size of the LED goes into the body: through the wall (open, to fill with
// clear glue or a lens) or up to a thin skin left on the outside (a window,
// for clear or light resin). The wall is closed round the bore. Behind it, on
// the inside of a hollow body, a socket tube holds the LED straight and keeps
// its light out of the cabin. On a solid body the pocket is a blind hole.
import { Vector2 } from 'three';
import { clip } from './arches.js';
import { capLoops } from './finish.js';
import { rayCaster } from './rays.js';
import { boundaryLoops, pairEdges } from './topology.js';
import { keepTaped } from './tape.js';

export const LED_SIZES = {
  led18: { name: '1.8 mm round', d: 1.8, length: 3.5 },
  led3: { name: '3 mm round', d: 3, length: 5.5 },
  led5: { name: '5 mm round', d: 5, length: 8.5 },
};
export const LIGHT_DEFAULTS = { d: 3, length: 5.5, clearance: 0.1, tube: 1, mode: 'open', skin: 0.4 };

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a) => {
  const l = Math.hypot(...a);
  return a.map((x) => x / l);
};

// The pocket's frame: c on the outside, a pointing into the body, u and v across.
function frame(l) {
  const a = unit(l.normal.map((x) => -x));
  const u = unit(cross(a, Math.abs(a[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0]));
  return { c: l.at, a, u, v: cross(a, u) };
}

// A tube along the frame's axis: radii r0 (inside) and r1, from depth t0 to t1.
function tube(fr, r0, r1, t0, t1, n = 28) {
  const pos = [], idx = [];
  const ring = (r, t) => {
    const s = pos.length / 3;
    for (let i = 0; i < n; i++) {
      const th = (2 * Math.PI * i) / n;
      for (let k = 0; k < 3; k++) pos.push(fr.c[k] + fr.a[k] * t + (fr.u[k] * Math.cos(th) + fr.v[k] * Math.sin(th)) * r);
    }
    return s;
  };
  const a = ring(r1, t0), b = ring(r1, t1), c = ring(r0, t1), d = ring(r0, t0);
  const band = (p, q) => {
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      idx.push(p + i, q + i, q + j, p + i, q + j, p + j);
    }
  };
  band(a, b);
  band(b, c);
  band(c, d);
  band(d, a);
  let vol = 0;
  for (let f = 0; f < idx.length; f += 3) {
    const [p, q, r] = [idx[f] * 3, idx[f + 1] * 3, idx[f + 2] * 3];
    vol += pos[p] * (pos[q + 1] * pos[r + 2] - pos[q + 2] * pos[r + 1]) - pos[p + 1] * (pos[q] * pos[r + 2] - pos[q + 2] * pos[r]) + pos[p + 2] * (pos[q] * pos[r + 1] - pos[q + 1] * pos[r]);
  }
  if (vol < 0) for (let f = 0; f < idx.length; f += 3) [idx[f + 1], idx[f + 2]] = [idx[f + 2], idx[f + 1]];
  return { positions: pos, indices: idx };
}

// lights: [{ at, normal, d, length, clearance, tube, mode, skin }].
export function applyLights(mesh, { lights = [] }, { tape } = {}) {
  let m = mesh;
  const tubes = [];
  const warnings = [];
  lights.forEach((l0, i) => {
    const l = { ...LIGHT_DEFAULTS, ...l0 };
    if (!(l.d > 0)) throw Error('Enter the LED size.');
    const fr = frame(l);
    const r = l.d / 2 + l.clearance;
    // The wall here: from the outside in to the next surface (the inside of the wall).
    const cast = rayCaster(m.positions, m.indices);
    const outside = fr.c.map((x, k) => x - fr.a[k] * 0.5);
    const toOuter = cast(outside, fr.a);
    if (!Number.isFinite(toOuter) || toOuter > 1.5) {
      warnings.push(`Light ${i + 1} is not on the body: place it again.`);
      return;
    }
    const skinAt = toOuter - 0.5; // the outside, measured from c along a
    const behind = cast(fr.c.map((x, k) => x + fr.a[k] * (skinAt + 0.01)), fr.a);
    const hollow = Number.isFinite(behind) && behind < Math.max(4, l.length);
    const wall = hollow ? behind + 0.01 : null;
    if (!hollow && l.mode === 'window') {
      warnings.push(`Light ${i + 1}: a thin window needs a hollow body. Made open instead.`);
      l.mode = 'open';
    }
    if (l.mode === 'window' && wall <= l.skin + 0.2) {
      warnings.push(`Light ${i + 1}: the wall is too thin to leave a window skin. Made open instead.`);
      l.mode = 'open';
    }
    const t1 = hollow ? skinAt + wall + 0.3 : skinAt + l.length; // through the wall, or a blind hole the LED's length
    const local = (p) => {
      const d = [p[0] - fr.c[0], p[1] - fr.c[1], p[2] - fr.c[2]];
      return [dot(d, fr.u), dot(d, fr.v), dot(d, fr.a)];
    };
    // Where the bore starts: past the outside when open, under the skin for a window.
    const tStart = l.mode === 'window' ? skinAt + l.skin : skinAt - 1;
    const out = clip(
      m,
      keepTaped((p) => {
        const q = local(p);
        return Math.min(r - Math.hypot(q[0], q[1]), q[2] - tStart, t1 - q[2]);
      }, tape),
    );
    if (!out.removed) {
      warnings.push(`Light ${i + 1}: nothing to cut there.`);
      return;
    }
    m = closeBore(out, fr, r, tStart, t1, hollow);
    // The socket: from inside the wall to the LED's length behind it.
    if (hollow) tubes.push(tube(fr, r, r + l.tube, skinAt + wall - 0.4, skinAt + wall + Math.max(1, l.length - wall)));
  });
  const pos = Array.from(m.positions), idx = Array.from(m.indices);
  for (const t of tubes) {
    const off = pos.length / 3;
    pos.push(...t.positions);
    for (const v of t.indices) idx.push(v + off);
  }
  return { positions: Float32Array.from(pos), indices: Uint32Array.from(idx), info: { lights: lights.length - warnings.filter((w) => /not on the body|nothing to cut/.test(w)).length, warnings } };
}

// Close the wall round the bore. The bore's surface is a round side and, for
// a window or a blind hole, a flat end. Laid flat like a squashed cup: the end
// stays as it is, the side folds out round it (further from the end = further out).
function closeBore(mesh, fr, r, tStart, t1, hollow) {
  const P = mesh.positions;
  const { twins } = pairEdges(mesh.indices, P.length / 3, P);
  const tol = r * 1e-4 + 1e-4;
  const local = (v) => {
    const d = [P[v * 3] - fr.c[0], P[v * 3 + 1] - fr.c[1], P[v * 3 + 2] - fr.c[2]];
    return [dot(d, fr.u), dot(d, fr.v), dot(d, fr.a)];
  };
  // The flat end: the window's skin (at tStart), or a blind hole's bottom (at t1).
  const endAt = hollow ? tStart : t1;
  const onCut = (v) => {
    const q = local(v);
    const rho = Math.hypot(q[0], q[1]);
    return (Math.abs(rho - r) < tol && q[2] >= tStart - tol && q[2] <= t1 + tol) || ((Math.abs(q[2] - tStart) < tol || Math.abs(q[2] - t1) < tol) && rho <= r + tol);
  };
  const loops = boundaryLoops(mesh.indices, twins).filter((l) => l.every(onCut));
  if (!loops.length) return mesh;
  // One edge round the hole (a blind hole, or a window cut from the inside):
  // the bore is built, a tube from that edge to a flat end.
  if (loops.length === 1) return boreTo(mesh, loops[0], fr, local, hollow ? tStart : t1);
  const flatten = (v) => {
    const q = local(v);
    if (Math.abs(q[2] - endAt) < tol) return new Vector2(q[0], q[1]);
    const rho = Math.hypot(q[0], q[1]) || 1;
    const out = r + Math.abs(q[2] - endAt);
    return new Vector2((q[0] / rho) * out, (q[1] / rho) * out);
  };
  return capLoops(mesh, loops, flatten, true).mesh;
}

// A bore from the edge round a hole (each corner straight along the axis) to
// a flat end at depth tEnd, joined to the surface the hole is in.
function boreTo(mesh, loop, fr, local, tEnd) {
  const pos = Array.from(mesh.positions), idx = Array.from(mesh.indices);
  // Which way the surface runs round the hole: the bore must run the other way.
  const used = new Set();
  for (let f = 0; f < idx.length; f += 3) for (let e = 0; e < 3; e++) used.add(`${idx[f + e]}>${idx[f + ((e + 1) % 3)]}`);
  const forward = used.has(`${loop[0]}>${loop[1]}`);
  const end = loop.map((v) => {
    const q = local(v);
    const id = pos.length / 3;
    for (let k = 0; k < 3; k++) pos.push(fr.c[k] + fr.u[k] * q[0] + fr.v[k] * q[1] + fr.a[k] * tEnd);
    return id;
  });
  const mid = pos.length / 3;
  for (let k = 0; k < 3; k++) pos.push(fr.c[k] + fr.a[k] * tEnd);
  for (let i = 0; i < loop.length; i++) {
    const j = (i + 1) % loop.length;
    let [p, q, pb, qb] = [loop[i], loop[j], end[i], end[j]];
    if (!forward) [p, q, pb, qb] = [q, p, qb, pb];
    idx.push(q, p, pb, q, pb, qb, mid, qb, pb);
  }
  return { positions: Float32Array.from(pos), indices: Uint32Array.from(idx) };
}
