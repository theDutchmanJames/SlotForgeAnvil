// The surface curve tool's curve: a closed smooth curve through the points
// the user clicked on the body. A point marked as a corner gets a sharp
// corner; the others are passed smoothly (Catmull-Rom).

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

// points: [[x, y, z], ...], corners: [bool, ...]. step: wanted spacing in mm.
// Returns the closed curve as a list of points (the first is not repeated).
export function sampleClosedCurve(points, corners = [], step = 0.5) {
  const n = points.length;
  if (n < 3) return points.map((p) => p.slice());
  const P = (i) => points[((i % n) + n) % n];
  const isCorner = (i) => !!corners[((i % n) + n) % n];
  const out = [];
  for (let i = 0; i < n; i++) {
    const p1 = P(i), p2 = P(i + 1);
    // At a corner the curve leaves along the straight line to the next point.
    const p0 = isCorner(i) ? sub(p1, sub(p2, p1)) : P(i - 1);
    const p3 = isCorner(i + 1) ? sub(p2, sub(p1, p2)) : P(i + 2);
    const count = Math.max(2, Math.ceil(dist(p1, p2) / step));
    for (let k = 0; k < count; k++) {
      const t = k / count, t2 = t * t, t3 = t2 * t;
      out.push(
        [0, 1, 2].map(
          (c) => 0.5 * (2 * p1[c] + (-p0[c] + p2[c]) * t + (2 * p0[c] - 5 * p1[c] + 4 * p2[c] - p3[c]) * t2 + (-p0[c] + 3 * p1[c] - 3 * p2[c] + p3[c]) * t3),
        ),
      );
    }
  }
  return out;
}

export const mirrorPoint = (p) => [p[0], -p[1], p[2]];
