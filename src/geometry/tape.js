// Masking tape: spots on the body (a point and a radius) that the tools after
// the Tape step leave alone. A tool that cuts keeps whatever lies inside a
// taped spot; a tool that moves the surface holds the taped corners still.
// The spots are kept in space, not as triangles, so they stay where they
// were put however earlier steps change the mesh.

// The signed distance to the tape: below 0 inside a taped spot. Null without tape.
export function tapeField(tape) {
  if (!tape?.length) return null;
  const big = Math.max(...tape.map((s) => s.r));
  const cell = Math.max(big, 1e-3);
  const grid = new Map();
  const at = (x, y, z) => `${Math.floor(x / cell)},${Math.floor(y / cell)},${Math.floor(z / cell)}`;
  for (const s of tape) {
    const k = at(...s.at);
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(s);
  }
  return (p) => {
    const i = Math.floor(p[0] / cell), j = Math.floor(p[1] / cell), k = Math.floor(p[2] / cell);
    let best = cell;
    for (let a = i - 1; a <= i + 1; a++)
      for (let b = j - 1; b <= j + 1; b++)
        for (let c = k - 1; c <= k + 1; c++) {
          const list = grid.get(`${a},${b},${c}`);
          if (!list) continue;
          for (const s of list) {
            const d = Math.hypot(p[0] - s.at[0], p[1] - s.at[1], p[2] - s.at[2]) - s.r;
            if (d < best) best = d;
          }
        }
    return best;
  };
}

// A cut's field (keep where f <= 0, as clip takes it) with the tape kept too.
export function keepTaped(f, tape) {
  const t = tapeField(tape);
  return t ? (p) => Math.min(f(p), t(p)) : f;
}

// Which corners of a mesh lie under the tape: a Uint8Array, one per corner.
export function tapedCorners(positions, tape) {
  const t = tapeField(tape);
  const out = new Uint8Array(positions.length / 3);
  if (!t) return out;
  const p = [0, 0, 0];
  for (let v = 0; v < out.length; v++) {
    p[0] = positions[v * 3];
    p[1] = positions[v * 3 + 1];
    p[2] = positions[v * 3 + 2];
    if (t(p) <= 0) out[v] = 1;
  }
  return out;
}

// A step that only moved corners (the same mesh, moved): the taped ones go
// back where they were. Returns the mesh and how many corners were held.
export function holdTaped(before, after, tape) {
  if (!tape?.length || after.positions.length !== before.positions.length || after.indices.length !== before.indices.length) return { mesh: after, held: 0 };
  const under = tapedCorners(before.positions, tape);
  let held = 0;
  let pos = null;
  for (let v = 0; v < under.length; v++) {
    if (!under[v]) continue;
    const o = v * 3;
    if (after.positions[o] === before.positions[o] && after.positions[o + 1] === before.positions[o + 1] && after.positions[o + 2] === before.positions[o + 2]) continue;
    pos ??= Float32Array.from(after.positions);
    pos[o] = before.positions[o];
    pos[o + 1] = before.positions[o + 1];
    pos[o + 2] = before.positions[o + 2];
    held++;
  }
  return { mesh: pos ? { ...after, positions: pos } : after, held };
}

// Faces wholly under the tape, as a Set of face numbers.
export function tapedFaces({ positions, indices }, tape) {
  const under = tapedCorners(positions, tape);
  const out = new Set();
  for (let f = 0; f < indices.length / 3; f++) if (under[indices[f * 3]] && under[indices[f * 3 + 1]] && under[indices[f * 3 + 2]]) out.add(f);
  return out;
}
