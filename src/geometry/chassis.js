// Fitting the body to a chassis. The chassis is not geometry: it is a ghost
// drawn inside the body, from dimensions typed in (later: from the library
// or a chassis STL). Car frame: front at low X, Z up, centre line Y = 0.
import { bounds } from './bounds.js';

// Wheel arches seen from the side: along the car, the body's lowest point
// near its sides rises where there is an arch. Returns the two arches
// (front first) with their middle, width and how high their top is.
export function findArches(mesh) {
  const { positions: p } = mesh;
  const b = bounds(p);
  const L = b.size[0], W = b.size[1], H = b.size[2];
  const bins = 240;
  const low = new Float64Array(bins).fill(Infinity);
  for (let i = 0; i < p.length; i += 3) {
    if (Math.abs(p[i + 1]) < W * 0.3) continue; // only the sides of the body
    const k = Math.min(bins - 1, Math.floor(((p[i] - b.min[0]) / L) * bins));
    if (p[i + 2] < low[k]) low[k] = p[i + 2];
  }
  // Empty bins (no side there): treat as open.
  const z0 = b.min[2];
  const rise = Array.from(low, (z) => (Number.isFinite(z) ? z - z0 : H));
  const runs = [];
  let start = -1;
  for (let k = 0; k <= bins; k++) {
    const open = k < bins && rise[k] > H * 0.12;
    if (open && start < 0) start = k;
    if (!open && start >= 0) {
      if (k - start >= bins * 0.05) runs.push([start, k - 1]);
      start = -1;
    }
  }
  // The two widest openings that are not the very ends of the car.
  const inner = runs.filter(([s, e]) => s > 0 && e < bins - 1);
  inner.sort((x, y) => y[1] - y[0] - (x[1] - x[0]));
  const arches = inner
    .slice(0, 2)
    .map(([s, e]) => {
      const x0 = b.min[0] + (s / bins) * L, x1 = b.min[0] + ((e + 1) / bins) * L;
      let top = 0;
      for (let k = s; k <= e; k++) top = Math.max(top, rise[k]);
      return { x: (x0 + x1) / 2, width: x1 - x0, top: z0 + top };
    })
    .sort((a, b2) => a.x - b2.x);
  // Body width at each arch (outside of the bodywork there).
  for (const a of arches) {
    let w = 0;
    for (let i = 0; i < p.length; i += 3) if (Math.abs(p[i] - a.x) < a.width * 0.6) w = Math.max(w, Math.abs(p[i + 1]));
    a.halfWidth = w;
  }
  return { arches, bounds: b };
}

// A first guess at a chassis that fits this body.
export function suggestChassis({ arches, bounds: b }) {
  const L = b.size[0], W = b.size[1];
  const front = arches[0], rear = arches[1];
  const fx = front ? front.x : b.min[0] + L * 0.18;
  const rx = rear ? rear.x : b.min[0] + L * 0.78;
  const clearance = round(L * 0.006, 1);
  const ground = b.min[2] - clearance;
  // A tyre that fills the arch, with a small gap above it and in front and behind.
  const gap = Math.max(0.3, L * 0.006);
  const tyre = (a) => (a ? round(Math.max(L * 0.06, Math.min(a.top - ground - gap, a.width - 2 * gap)), 1) : round(L * 0.13, 1));
  const width = (d) => round(d * 0.45, 1);
  const halfAt = (a) => (a ? a.halfWidth : W / 2);
  const pair = (a) => {
    const d = tyre(a), w = width(d);
    return { diameter: d, width: w, inOut: round(halfAt(a) - w / 2 - L * 0.005, 1) };
  };
  return {
    name: 'My chassis',
    frontX: round(fx, 2),
    wheelbase: round(rx - fx, 1),
    wheelbaseMin: null,
    wheelbaseMax: null,
    clearance,
    deck: round(L * 0.04, 1),
    guideAhead: round(L * 0.12, 1),
    front: pair(front),
    rear: pair(rear),
  };
}

const round = (v, d = 2) => Number(Number(v).toFixed(d));

// How well do chassis and body fit? Distances in mm.
export function fitReport(chassis, { arches, bounds: b }) {
  const out = { problems: [] };
  if (arches.length === 2) {
    out.bodyWheelbase = arches[1].x - arches[0].x;
    out.wheelbaseOff = out.bodyWheelbase - chassis.wheelbase;
    if (Math.abs(out.wheelbaseOff) > 0.5) out.problems.push('wheelbase');
    out.frontOff = arches[0].x - chassis.frontX;
  }
  const ground = b.min[2] - chassis.clearance;
  for (const [key, i] of [['front', 0], ['rear', 1]]) {
    const t = chassis[key];
    const outer = t.inOut + t.width / 2;
    const a = arches[i];
    const half = a ? a.halfWidth : b.size[1] / 2;
    const stickOut = outer - half;
    out[key] = { outer, stickOut, top: ground + t.diameter };
    if (stickOut > 0.05) out.problems.push(`${key}-wide`);
    if (a && ground + t.diameter > a.top - 0.3) out.problems.push(`${key}-tall`);
  }
  return out;
}
