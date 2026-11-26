// Tabs that hold the body on the chassis, next to the posts. Each tab is its
// own closed piece that overlaps the inside of the side wall (slicers merge
// overlapping pieces). Car frame: Z up, front at low X, +Y right.
//   Screw tab: a flat tab sticking inwards from the side wall at chassis
//              mount height, with a screw hole, and two ribs above it.
//   Clip tab:  a tab down the inside of the side wall with a hook at the
//              bottom: its flat top catches under the chassis edge, its
//              sloped bottom lets it snap on.
import { ShapeUtils, Vector2 } from 'three';
import { keepAllPoints } from './finish.js';
import { rayCaster } from './rays.js';

export const TAB_DEFAULTS = {
  screw: { width: 6, reach: 6, thick: 1.6, hole: 1.6, rib: 3 },
  clip: { width: 5, height: 6, hook: 0.8, hookHeight: 1.2, gap: 0.15, thick: 1.2 },
};

// How far into the wall a tab reaches, so it holds on to it.
const OVERLAP = 0.5;

// A closed prism: a 2D outline (with holes) swept from a0 to a1. put(u, v, a)
// gives the corner in the car frame. Faces point outwards.
export function prism(outline, holes, a0, a1, put) {
  const pos = [], idx = [];
  // Outline counter-clockwise, holes clockwise: then every side faces out.
  const area = (r) => r.reduce((s, [u, v], i) => s + u * r[(i + 1) % r.length][1] - r[(i + 1) % r.length][0] * v, 0);
  if (area(outline) < 0) outline = [...outline].reverse();
  holes = holes.map((h) => (area(h) > 0 ? [...h].reverse() : h));
  const rings = [outline, ...holes];
  const flat = rings.flat();
  const base = [];
  for (const a of [a0, a1]) {
    base.push(pos.length / 3);
    for (const ring of rings) for (const [u, v] of ring) pos.push(...put(u, v, a));
  }
  const n = pos.length / 6;
  const tris = keepAllPoints(
    ShapeUtils.triangulateShape(outline.map(([u, v]) => new Vector2(u, v)), holes.map((h) => h.map(([u, v]) => new Vector2(u, v)))),
    rings.map((r) => r.length),
  );
  for (let [a, b, c] of tris) {
    const [pa, pb, pc] = [flat[a], flat[b], flat[c]];
    if ((pb[0] - pa[0]) * (pc[1] - pa[1]) - (pb[1] - pa[1]) * (pc[0] - pa[0]) < 0) [b, c] = [c, b];
    // Counter-clockwise now: the far end faces +a, the near end -a.
    idx.push(a, c, b, a + n, b + n, c + n);
  }
  let off = 0;
  for (const ring of rings) {
    for (let i = 0; i < ring.length; i++) {
      const j = (i + 1) % ring.length;
      const p = off + i, q = off + j;
      idx.push(p, q, q + n, p, q + n, p + n);
    }
    off += ring.length;
  }
  // Outwards: by the sign of the volume.
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

const circle = (cu, cv, r, n = 20) => Array.from({ length: n }, (_, k) => [cu + r * Math.cos((-2 * Math.PI * k) / n), cv + r * Math.sin((-2 * Math.PI * k) / n)]);

// The inside of the side wall at (x, z) on one side: |y| where a ray from the
// centre line meets the body. Null when nothing is there (an opening).
function wallAt(cast, x, z, side) {
  const d = cast([x, 0, z], [0, side, 0]);
  return Number.isFinite(d) ? d : null;
}

// params: { tabs: [{ kind, x, side }], screw, clip, base, edge, catchZ, ground }
//   base:   height of the bottom of a screw tab (on the chassis mount)
//   edge:   the chassis edge, measured from the centre line (for clips)
//   catchZ: height of the underside of the chassis edge (for clips)
//   ground: the track (a clip must not reach it)
export function applyMounts(mesh, { tabs = [], screw = {}, clip = {}, base, edge, catchZ, ground = -Infinity }) {
  const s = { ...TAB_DEFAULTS.screw, ...screw }, k = { ...TAB_DEFAULTS.clip, ...clip };
  // The lowest point before the tabs: a clip below the body must not move the chassis.
  let bodyBottom = Infinity;
  for (let i = 2; i < mesh.positions.length; i += 3) bodyBottom = Math.min(bodyBottom, mesh.positions[i]);
  const cast = rayCaster(mesh.positions, mesh.indices);
  const pos = Array.from(mesh.positions), idx = Array.from(mesh.indices);
  const warnings = [];
  let made = 0;
  const add = (piece) => {
    const off = pos.length / 3;
    pos.push(...piece.positions);
    for (const v of piece.indices) idx.push(v + off);
    made++;
  };
  const where = (t) => `at ${t.x.toFixed(1)}, ${t.side > 0 ? 'right' : 'left'}`;

  for (const t of tabs) {
    const side = t.side > 0 ? 1 : -1;
    if (t.kind === 'screw') {
      if (!Number.isFinite(base)) throw Error('Set the height of the screw tabs.');
      // The wall at the middle of the tab's thickness, and at both ends.
      const zm = base + s.thick / 2;
      const ws = [t.x - s.width / 2, t.x, t.x + s.width / 2].map((x) => wallAt(cast, x, zm, side));
      if (ws.some((w) => w == null)) {
        warnings.push(`No side wall next to this screw tab (${where(t)})`);
        continue;
      }
      const wall = Math.min(...ws);
      const inner = wall - s.reach;
      if (inner < 0.5) warnings.push(`This screw tab reaches past the centre line (${where(t)})`);
      // Outline in (along the car, out from the centre line); the hole in the middle of the reach.
      const out = Math.max(...ws) + OVERLAP;
      const rect = [[t.x - s.width / 2, inner], [t.x + s.width / 2, inner], [t.x + s.width / 2, out], [t.x - s.width / 2, out]];
      const hole = s.hole > 0 ? [circle(t.x, inner + s.reach / 2, s.hole / 2)] : [];
      if (s.hole > 0 && s.reach / 2 - s.hole / 2 < 0.8) warnings.push(`Little material round the screw hole (${where(t)})`);
      add(prism(rect, hole, base, base + s.thick, (u, v, a) => [u, side * v, a]));
      // Two ribs above the tab, either side of the hole, up into the wall.
      if (s.rib > 0) {
        const rw = Math.min(1.2, s.width * 0.2);
        for (const x0 of [t.x - s.width / 2, t.x + s.width / 2 - rw]) {
          const top = base + s.thick + s.rib;
          const wTop = wallAt(cast, x0 + rw / 2, top, side) ?? wall;
          const tri = [[inner + s.reach * 0.55, base + s.thick - 0.01], [wall + OVERLAP, base + s.thick - 0.01], [Math.min(wTop, wall) + OVERLAP, top]];
          add(prism(tri, [], x0, x0 + rw, (u, v, a) => [a, side * u, v]));
        }
      }
    } else if (t.kind === 'clip') {
      if (!Number.isFinite(edge) || !Number.isFinite(catchZ)) throw Error('Set where the chassis edge is for the clip tabs.');
      const face = edge + k.gap; // the clip's inner face, just outside the chassis edge
      const zb = catchZ - k.hookHeight, zt = catchZ + k.height;
      if (zb < ground + 0.3) warnings.push(`This clip reaches the track (${where(t)})`);
      // The outer side follows the wall from the bottom of the hook to the top.
      const steps = 6;
      const outer = [];
      let missing = false;
      for (let i = 0; i <= steps; i++) {
        const z = zt - ((zt - zb) * i) / steps;
        const w = [t.x - k.width / 2, t.x + k.width / 2].map((x) => wallAt(cast, x, z, side));
        if (w.some((v) => v == null)) {
          missing = true;
          break;
        }
        outer.push([Math.max(...w) + OVERLAP, z]);
      }
      if (missing) {
        warnings.push(`No side wall next to this clip all the way down (${where(t)})`);
        continue;
      }
      if (Math.min(...outer.map(([y]) => y - OVERLAP)) < face + k.thick) {
        warnings.push(`The body is too close to the chassis edge here for a clip (${where(t)})`);
        continue;
      }
      // Up the inner face, then down the wall, round to the hook.
      const outline = [[face, zb], [face - k.hook, catchZ], [face, catchZ], [face, zt], ...outer];
      add(prism(outline, [], t.x - k.width / 2, t.x + k.width / 2, (u, v, a) => [a, side * u, v]));
    } else throw Error('A tab of an unknown kind. Remove it and place it again.');
  }
  return { positions: Float32Array.from(pos), indices: Uint32Array.from(idx), info: { made, warnings, bodyBottom } };
}
