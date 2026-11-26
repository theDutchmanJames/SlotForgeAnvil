// Body shaping: taper or widen a stretch of the car, and raise or lower it
// above a chosen height. In the car's frame (X along, Y across, Z up), the
// points move but the triangles stay the same, so the mesh keeps its
// connectivity. Both ends of the region fade smoothly to no change.

export function checkBodyShape(p) {
  for (const k of ['from', 'to', 'blend', 'base', 'front', 'rear', 'height'])
    if (!Number.isFinite(p?.[k])) throw Error('Enter a number in every body shaping field.');
  if (p.to - p.from < 0.1) throw Error('The shaping region must be at least 0.1 mm long, and end after it starts.');
  if (p.blend < 0.05 || p.blend > (p.to - p.from) / 2) throw Error('The blend must be at least 0.05 mm and no more than half the region.');
  if (['front', 'rear', 'height'].some((k) => p[k] < -75 || p[k] > 100)) throw Error('Width and height changes must be between -75% and +100%.');
  return p;
}

const smooth = (t) => {
  t = Math.max(0, Math.min(1, t));
  return t * t * (3 - 2 * t);
};

// params: { from, to, blend, base } in mm; { front, rear, height } in percent.
export function applyBodyShape(mesh, params) {
  const p = checkBodyShape(params),
    out = mesh.positions.slice();
  let moved = 0;
  for (let i = 0; i < out.length; i += 3) {
    const x = out[i],
      y = out[i + 1],
      z = out[i + 2];
    const weight = smooth((x - p.from) / p.blend) * smooth((p.to - x) / p.blend);
    if (!weight) continue;
    const t = (x - p.from) / (p.to - p.from);
    // Width: symmetric about the centre line, from the front's change to the rear's.
    out[i + 1] = y * (1 + (weight * (p.front * (1 - t) + p.rear * t)) / 100);
    // Height: only what is above the base moves.
    if (z > p.base) out[i + 2] = p.base + (z - p.base) * (1 + (weight * p.height) / 100);
    if (out[i + 1] !== y || out[i + 2] !== z) moved++;
  }
  return { positions: out, indices: mesh.indices, info: { moved } };
}
