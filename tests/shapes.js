// Test shapes shared by several test files.
import { applyFloor, applyHollow } from '../src/geometry/shell.js';

export function box(sx, sy, sz, n = 8) {
  const pos = [], idx = [], key = new Map();
  const vert = (x, y, z) => {
    const k = `${x},${y},${z}`;
    if (!key.has(k)) {
      key.set(k, pos.length / 3);
      pos.push(x, y, z);
    }
    return key.get(k);
  };
  const face = (o, u, v) => {
    for (let j = 0; j < n; j++)
      for (let i = 0; i < n; i++) {
        const p = (a, b) => vert(...o.map((x, k) => x + (u[k] * a) / n + (v[k] * b) / n));
        const a = p(i, j), b = p(i + 1, j), c = p(i + 1, j + 1), d = p(i, j + 1);
        idx.push(a, b, c, a, c, d);
      }
  };
  face([0, 0, 0], [0, sy, 0], [sx, 0, 0]);
  face([0, 0, sz], [sx, 0, 0], [0, sy, 0]);
  face([0, 0, 0], [sx, 0, 0], [0, 0, sz]);
  face([0, sy, 0], [0, 0, sz], [sx, 0, 0]);
  face([0, 0, 0], [0, 0, sz], [0, sy, 0]);
  face([sx, 0, 0], [0, sy, 0], [0, 0, sz]);
  return { positions: Float32Array.from(pos), indices: Uint32Array.from(idx) };
}
// A 100 × 40 × 30 shell, 1 mm wall, open underneath, centred on Y = 0.
export const shell = () => {
  const b = box(100, 40, 30, 16);
  for (let i = 1; i < b.positions.length; i += 3) b.positions[i] -= 20;
  return applyHollow(applyFloor(b, { mode: 'cut', at: 0.5 }), { wall: 1 });
};
