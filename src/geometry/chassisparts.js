// Parts screwed to a chassis: body posts, a motor bracket. A part is fitted
// by its screw holes: it is turned in quarter turns and moved until its holes
// sit over the chassis's holes, resting on the chassis there. Both meshes
// come in turned the same way, Z up.
import { bounds } from './bounds.js';

// Round holes straight down through a mesh, seen from above: the spots no
// ray from above hits, closed in all round by the mesh. Each comes back
// with its middle and its width. cell: the size of the grid looked through.
export function roundHoles({ positions: p, indices: I }, { cell = 0.1, min = 1, max = 8 } = {}) {
  const b = bounds(p);
  const W = Math.ceil(b.size[0] / cell) + 2, H = Math.ceil(b.size[1] / cell) + 2;
  if (W * H > 4e7) return [];
  const x0 = b.min[0] - cell, y0 = b.min[1] - cell;
  const solid = new Uint8Array(W * H);
  for (let f = 0; f < I.length; f += 3) {
    const a = I[f] * 3, c = I[f + 1] * 3, d = I[f + 2] * 3;
    const ax = p[a], ay = p[a + 1], bx = p[c], by = p[c + 1], cx = p[d], cy = p[d + 1];
    const det = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay);
    if (Math.abs(det) < 1e-12) continue;
    const i0 = Math.max(0, Math.floor((Math.min(ax, bx, cx) - x0) / cell)), i1 = Math.min(W - 1, Math.ceil((Math.max(ax, bx, cx) - x0) / cell));
    const j0 = Math.max(0, Math.floor((Math.min(ay, by, cy) - y0) / cell)), j1 = Math.min(H - 1, Math.ceil((Math.max(ay, by, cy) - y0) / cell));
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        const u = x0 + (i + 0.5) * cell, v = y0 + (j + 0.5) * cell;
        const s = ((u - ax) * (cy - ay) - (cx - ax) * (v - ay)) / det, t = ((bx - ax) * (v - ay) - (u - ax) * (by - ay)) / det;
        if (s >= 0 && t >= 0 && s + t <= 1) solid[i + j * W] = 1;
      }
  }
  // 0 open, 1 solid, 2 outside (reached from the edge), 3 looked at.
  const stack = [];
  for (let i = 0; i < W; i++) stack.push(i, i + (H - 1) * W);
  for (let j = 0; j < H; j++) stack.push(j * W, W - 1 + j * W);
  while (stack.length) {
    const k = stack.pop();
    if (solid[k]) continue;
    solid[k] = 2;
    const i = k % W;
    if (i > 0) stack.push(k - 1);
    if (i < W - 1) stack.push(k + 1);
    if (k >= W) stack.push(k - W);
    if (k < W * (H - 1)) stack.push(k + W);
  }
  const holes = [];
  for (let k0 = 0; k0 < W * H; k0++) {
    if (solid[k0]) continue;
    let sx = 0, sy = 0, n = 0, i0 = W, i1 = 0, j0 = H, j1 = 0;
    stack.push(k0);
    while (stack.length) {
      const k = stack.pop();
      if (solid[k]) continue;
      solid[k] = 3;
      const i = k % W, j = (k - i) / W;
      sx += i;
      sy += j;
      n++;
      if (i < i0) i0 = i;
      if (i > i1) i1 = i;
      if (j < j0) j0 = j;
      if (j > j1) j1 = j;
      stack.push(k - 1, k + 1, k - W, k + W);
    }
    const w = (i1 - i0 + 1) * cell, h = (j1 - j0 + 1) * cell, d = 2 * Math.sqrt((n * cell * cell) / Math.PI);
    // Round: as wide as it is long, and its area that of a circle that wide.
    if (Math.abs(w - h) > 0.15 * Math.max(w, h) || Math.abs(d - w) > 0.15 * w || d < min || d > max) continue;
    holes.push({ x: x0 + (sx / n + 0.5) * cell, y: y0 + (sy / n + 0.5) * cell, d });
  }
  return holes;
}

// The highest (or lowest) surface straight above points round (x, y), r out.
function ring({ positions: p, indices: I }, x, y, r, top) {
  let best = top ? -Infinity : Infinity;
  const pts = Array.from({ length: 8 }, (_, k) => [x + r * Math.cos((k * Math.PI) / 4), y + r * Math.sin((k * Math.PI) / 4)]);
  for (let f = 0; f < I.length; f += 3) {
    const a = I[f] * 3, b = I[f + 1] * 3, c = I[f + 2] * 3;
    const ax = p[a], ay = p[a + 1], bx = p[b], by = p[b + 1], cx = p[c], cy = p[c + 1];
    if (Math.max(ax, bx, cx) < x - r - 1e-6 || Math.min(ax, bx, cx) > x + r + 1e-6 || Math.max(ay, by, cy) < y - r - 1e-6 || Math.min(ay, by, cy) > y + r + 1e-6) continue;
    const det = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay);
    if (Math.abs(det) < 1e-12) continue;
    for (const [u, v] of pts) {
      const s = ((u - ax) * (cy - ay) - (cx - ax) * (v - ay)) / det, t = ((bx - ax) * (v - ay) - (u - ax) * (by - ay)) / det;
      if (s < 0 || t < 0 || s + t > 1) continue;
      const z = p[a + 2] + s * (p[b + 2] - p[a + 2]) + t * (p[c + 2] - p[a + 2]);
      best = top ? Math.max(best, z) : Math.min(best, z);
    }
  }
  return best;
}

// A quarter turn about Z, q times.
const turnXY = (x, y, q) => [[x, y], [-y, x], [-x, -y], [y, -x]][((q % 4) + 4) % 4];

// The part moved by a fit: { turn (quarter turns), x, y, z }.
export function placePart({ positions: p, indices }, fit) {
  const out = new Float32Array(p.length);
  for (let i = 0; i < p.length; i += 3) {
    const [x, y] = turnXY(p[i], p[i + 1], fit.turn);
    out[i] = x + fit.x;
    out[i + 1] = y + fit.y;
    out[i + 2] = p[i + 2] + fit.z;
  }
  return { positions: out, indices };
}

// The ways the part's holes can sit over the chassis's holes, best first:
// the most holes matched, then the part turned as it is in its file (a
// chassis and its parts usually come drawn the same way round), then
// sitting highest (on the raised bosses meant for it, not the deck).
// Each: { turn, x, y, z, matched, of }.
export function fitPart(chassis, part, { tol = 0.4 } = {}) {
  const ch = roundHoles(chassis), ph = roundHoles(part);
  if (!ph.length || !ch.length) return { fits: [], holes: ph.length, chassisHoles: ch.length };
  const found = new Map();
  for (let q = 0; q < 4; q++) {
    const turned = ph.map((h) => ({ ...h, at: turnXY(h.x, h.y, q) }));
    const [first] = turned;
    for (const c of ch) {
      if (Math.abs(c.d - first.d) > 0.5) continue;
      const dx = c.x - first.at[0], dy = c.y - first.at[1];
      const pairs = [];
      for (const h of turned) {
        const m = ch.find((o) => Math.hypot(o.x - h.at[0] - dx, o.y - h.at[1] - dy) < tol && Math.abs(o.d - h.d) < 0.5);
        if (m) pairs.push([h, m]);
      }
      if (pairs.length < Math.min(2, ph.length)) continue;
      const key = `${q},${Math.round(dx / tol)},${Math.round(dy / tol)}`;
      if (found.has(key)) continue;
      // Resting on the chassis: the part's underside at its holes on the
      // chassis's top at the matching holes, wherever that is highest.
      let z = -Infinity;
      for (const [h, m] of pairs) {
        const r = Math.max(h.d, m.d) / 2 + 0.6;
        const seat = ring(chassis, m.x, m.y, r, true), under = ring(part, h.x, h.y, r, false);
        if (Number.isFinite(seat) && Number.isFinite(under)) z = Math.max(z, seat - under);
      }
      if (!Number.isFinite(z)) continue;
      const seat = Math.max(...pairs.map(([, m]) => ring(chassis, m.x, m.y, Math.max(m.d / 2 + 0.6, 1), true)));
      found.set(key, { turn: q, x: dx, y: dy, z, matched: pairs.length, of: ph.length, seat });
    }
  }
  const most = Math.max(0, ...[...found.values()].map((f) => f.matched));
  const fits = [...found.values()].filter((f) => f.matched === most).sort((a, b) => b.matched - a.matched || (b.turn === 0) - (a.turn === 0) || b.seat - a.seat || a.turn - b.turn);
  // Rounded: the numbers are kept in the chassis file.
  const r3 = (v) => Math.round(v * 1000) / 1000;
  return { fits: fits.map(({ seat, ...f }) => ({ ...f, x: r3(f.x), y: r3(f.y), z: r3(f.z) })), holes: ph.length, chassisHoles: ch.length };
}

// The chassis and its parts laid out to print, as they come in their files
// (each drawn the way it prints): the parts in rows along the chassis's long
// side, each standing on the same plate, gap apart.
export function printLayout(chassis, parts, gap = 4) {
  const cb = bounds(chassis.positions);
  // L: along the chassis's length, S: across it, where the rows go.
  const L = cb.size[0] >= cb.size[1] ? 0 : 1, S = 1 - L;
  const pieces = [{ positions: Float32Array.from(chassis.positions), indices: chassis.indices }];
  let along = cb.min[L], across = cb.max[S] + gap, row = 0;
  for (const part of parts) {
    const b = bounds(part.positions);
    if (along > cb.min[L] && along + b.size[L] > cb.max[L]) {
      along = cb.min[L];
      across += row + gap;
      row = 0;
    }
    const d = [0, 0, cb.min[2] - b.min[2]];
    d[L] = along - b.min[L];
    d[S] = across - b.min[S];
    const pos = Float32Array.from(part.positions);
    for (let i = 0; i < pos.length; i += 3) for (let k = 0; k < 3; k++) pos[i + k] += d[k];
    pieces.push({ positions: pos, indices: part.indices });
    along += b.size[L] + gap;
    row = Math.max(row, b.size[S]);
  }
  return pieces;
}
