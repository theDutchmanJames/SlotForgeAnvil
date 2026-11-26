// The interior: a flat tray in the cockpit, shaped to the inside of the side
// walls, with an optional driver (helmet, shoulders, torso) and steering
// wheel standing on it. Either it is joined to the walls and prints with the
// body, or it is its own print: then small ledges on the walls hold it, and
// it is set down beside the car. Car frame: front at low X, +Y right, Z up.
import { bounds } from './bounds.js';
import { prism } from './mounts.js';
import { revolve } from './posts.js';
import { rayCaster } from './rays.js';

export const INTERIOR_DEFAULTS = { thick: 1, gap: 0.3, mount: 'ledges', driver: true, side: 'left', seat: 0.55, helmet: 7, wheel: true };

// The tray's outline at height z, from x0 to x1: the inside of the side walls
// (where a ray from the centre line meets them), less the gap.
export function trayOutline(mesh, { x0, x1, z, gap = 0.3, step = 1 }, cast = rayCaster(mesh.positions, mesh.indices)) {
  if (!(x1 > x0)) throw Error('The tray needs a start in front of its end.');
  const right = [], left = [];
  let missed = 0;
  const n = Math.max(2, Math.ceil((x1 - x0) / step));
  for (let i = 0; i <= n; i++) {
    const x = x0 + ((x1 - x0) * i) / n;
    const r = cast([x, 0, z], [0, 1, 0]), l = cast([x, 0, z], [0, -1, 0]);
    if (!Number.isFinite(r) || !Number.isFinite(l) || r - gap < 1 || l - gap < 1) {
      missed++;
      continue;
    }
    right.push([x, r - gap]);
    left.push([x, -(l - gap)]);
  }
  if (right.length < 2) throw Error('No side walls at that height to fit a tray between. Move the tray up or down.');
  return { outline: [...right, ...left.reverse()], missed, walls: { right, left } };
}

// A ball (helmet) at c, radius r.
function ball(c, r) {
  const prof = [];
  for (let i = 0; i <= 10; i++) {
    const a = -Math.PI / 2 + (Math.PI * i) / 10;
    prof.push([Math.max(0, r * Math.cos(a)), c[2] + r * Math.sin(a)]);
  }
  // revolve wants the profile round; the poles are points on the axis.
  return revolve(prof.reverse(), c[0], c[1], 24);
}

// A block with rounded-off ends: centred on c, sizes s (x, y, z).
function block(c, s) {
  const [hx, hy] = [s[0] / 2, s[1] / 2];
  const cut = Math.min(hx, hy) * 0.35;
  const outline = [[-hx + cut, -hy], [hx - cut, -hy], [hx, -hy + cut], [hx, hy - cut], [hx - cut, hy], [-hx + cut, hy], [-hx, hy - cut], [-hx, -hy + cut]];
  return prism(outline, [], c[2] - s[2] / 2, c[2] + s[2] / 2, (u, v, a) => [c[0] + u, c[1] + v, a]);
}

// A steering wheel: a ring of radius R and tube t, its middle at c, facing
// back along the car and leaning back by `lean` degrees.
function ring(c, R, t, lean = 25) {
  const pos = [], idx = [];
  const N = 28, M = 8;
  const a = (lean * Math.PI) / 180;
  // Its plane: across the car (Y) and up, leaned back (towards +X).
  const ax = [Math.sin(a), 0, Math.cos(a)]; // "up" in the wheel's plane
  const ay = [0, 1, 0];
  const nrm = [Math.cos(a), 0, -Math.sin(a)]; // facing the driver
  for (let i = 0; i < N; i++) {
    const th = (2 * Math.PI * i) / N;
    const dir = ax.map((x, k) => x * Math.cos(th) + ay[k] * Math.sin(th));
    for (let j = 0; j < M; j++) {
      const ph = (2 * Math.PI * j) / M;
      for (let k = 0; k < 3; k++) pos.push(c[k] + dir[k] * (R + t * Math.cos(ph)) + nrm[k] * t * Math.sin(ph));
    }
  }
  for (let i = 0; i < N; i++)
    for (let j = 0; j < M; j++) {
      const a0 = i * M + j, a1 = i * M + ((j + 1) % M), b0 = ((i + 1) % N) * M + j, b1 = ((i + 1) % N) * M + ((j + 1) % M);
      idx.push(a0, b0, b1, a0, b1, a1);
    }
  let vol = 0;
  for (let f = 0; f < idx.length; f += 3) {
    const [p, q, r] = [idx[f] * 3, idx[f + 1] * 3, idx[f + 2] * 3];
    vol += pos[p] * (pos[q + 1] * pos[r + 2] - pos[q + 2] * pos[r + 1]) - pos[p + 1] * (pos[q] * pos[r + 2] - pos[q + 2] * pos[r]) + pos[p + 2] * (pos[q] * pos[r + 1] - pos[q + 1] * pos[r]);
  }
  if (vol < 0) for (let f = 0; f < idx.length; f += 3) [idx[f + 1], idx[f + 2]] = [idx[f + 2], idx[f + 1]];
  return { positions: pos, indices: idx };
}

// The pieces of the interior, where they go in the car (nothing moved yet).
// Returns { tray: [pieces], ledges: [pieces], warnings, outline }.
export function interiorPieces(mesh, params) {
  const o = { ...INTERIOR_DEFAULTS, ...params };
  if (!Number.isFinite(o.z)) throw Error('Set the height of the tray.');
  if (!(o.thick > 0)) throw Error('Enter the tray thickness.');
  const cast = rayCaster(mesh.positions, mesh.indices);
  const joined = o.mount === 'joined';
  // Joined: into the walls by half a millimetre. Clip-in: a gap off them.
  const t = trayOutline(mesh, { x0: o.x0, x1: o.x1, z: o.z, gap: joined ? -0.5 : o.gap }, cast);
  const warnings = [];
  if (t.missed) warnings.push(`No side wall at the tray's height in ${t.missed} place${t.missed === 1 ? '' : 's'} along it: the tray skips those`);
  const tray = [prism(t.outline, [], o.z, o.z + o.thick, (u, v, a) => [u, v, a])];
  const ledges = [];
  if (!joined) {
    // Two ledges a side, a fifth in from each end, under the tray's edge.
    for (const f of [0.2, 0.8]) {
      const x = o.x0 + (o.x1 - o.x0) * f;
      for (const side of [1, -1]) {
        const w = cast([x, 0, o.z - 0.6], [0, side, 0]);
        if (!Number.isFinite(w)) {
          warnings.push(`No wall for a ledge at ${x.toFixed(1)}, ${side > 0 ? 'right' : 'left'}`);
          continue;
        }
        const inner = w - o.gap - 1.5;
        const prof = [[inner, o.z - 1.2], [w + 0.5, o.z - 1.2], [w + 0.5, o.z], [inner, o.z]];
        ledges.push(prism(prof, [], x - 2, x + 2, (u, v, a) => [a, side * u, v]));
      }
    }
  }
  if (o.driver) {
    // The driver: on the tray, `seat` of the way along it, on their side.
    const h = o.helmet;
    const x = o.x0 + (o.x1 - o.x0) * o.seat;
    const sideY = (yAt) => (o.side === 'centre' ? 0 : yAt * 0.45);
    const near = t.walls.right.reduce((best, p) => (Math.abs(p[0] - x) < Math.abs(best[0] - x) ? p : best), t.walls.right[0]);
    const y = o.side === 'right' ? sideY(near[1]) : o.side === 'left' ? -sideY(near[1]) : 0;
    const top = o.z + o.thick;
    const torso = [h * 1.1, h * 1.9, h * 1.5];
    tray.push(block([x + h * 0.1, y, top + torso[2] / 2 - 0.3], torso));
    // Shoulders: a wider, lower block at the top of the torso.
    tray.push(block([x + h * 0.1, y, top + torso[2] - h * 0.15], [h * 0.9, h * 2.3, h * 0.45]));
    // Helmet: on top, a little forward.
    tray.push(ball([x - h * 0.05, y, top + torso[2] + h * 0.42], h / 2));
    // The wheel leans back, its top resting against the chest (so it holds on).
    if (o.wheel) tray.push(ring([x - h * 0.62, y, top + torso[2] * 0.62], h * 0.62, h * 0.09));
    // Check the helmet clears the roof: from the tray up to the roof's underside.
    const roof = cast([x - h * 0.05, y, top + 0.01], [0, 0, 1]);
    const helmetTop = torso[2] + h * 0.42 + h / 2;
    if (Number.isFinite(roof) && roof < helmetTop + 0.3) warnings.push('The helmet touches the roof: make it smaller or lower the tray');
  }
  return { tray, ledges, warnings, outline: t.outline, joined };
}

const join = (list) => {
  const pos = [], idx = [];
  for (const m of list) {
    const off = pos.length / 3;
    pos.push(...m.positions);
    for (const v of m.indices) idx.push(v + off);
  }
  return { positions: pos, indices: idx };
};

// params: { x0, x1, z, thick, gap, mount: 'ledges' | 'joined', driver,
// side, seat, helmet, wheel }. Clip-in: the tray (with its driver) is set
// down beside the car, to print on its own.
export function applyInterior(mesh, params) {
  const p = interiorPieces(mesh, params);
  const b = bounds(mesh.positions);
  let tray = join(p.tray);
  if (!p.joined) {
    // Beside the car: past its right side, standing on the same ground.
    const tb = bounds(Float32Array.from(tray.positions));
    const dy = b.max[1] + 8 - tb.min[1], dz = b.min[2] - tb.min[2];
    tray = { positions: tray.positions.map((v, i) => v + (i % 3 === 1 ? dy : i % 3 === 2 ? dz : 0)), indices: tray.indices };
  }
  const all = join([{ positions: mesh.positions, indices: mesh.indices }, ...p.ledges, tray]);
  return { positions: Float32Array.from(all.positions), indices: Uint32Array.from(all.indices), info: { warnings: p.warnings, ledges: p.ledges.length, joined: p.joined } };
}
