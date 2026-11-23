// Checking an imported model and the light fix. The light fix never moves
// the visible surface: it removes broken and doubled triangles, untangles
// surfaces that touch, turns inside-out triangles round, drops specks and
// closes small holes.
import { bounds } from './bounds.js';
import { fillLoop } from './fill.js';
import { faceFrame, rayCaster, sampleFaces } from './rays.js';
import {
  applyFlips,
  boundaryLoops,
  cleanFaces,
  consistentFlips,
  detachCrowded,
  loopLength,
  pairEdges,
  partsOf,
  splitTouching,
} from './topology.js';

const diagonal = (positions) => Math.hypot(...bounds(positions).size);

// A speck: a part smaller than 1.5% of the car's diagonal.
const SPECK = 0.015;
// A small hole: shorter around than 4% of the car's diagonal.
export const SMALL_HOLE = 0.04;

function partBoxes(positions, indices, part, count) {
  const box = Array.from({ length: count }, () => [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]);
  for (let f = 0; f < part.length; f++) {
    const b = box[part[f]];
    for (let k = 0; k < 3; k++) {
      const v = indices[f * 3 + k] * 3;
      for (let c = 0; c < 3; c++) {
        const x = positions[v + c];
        if (x < b[c]) b[c] = x;
        if (x > b[c + 3]) b[c + 3] = x;
      }
    }
  }
  return box.map((b) => [b[3] - b[0], b[4] - b[1], b[5] - b[2]]);
}

function signedVolume(positions, indices, faces) {
  let v = 0;
  for (const f of faces) {
    const a = indices[f * 3] * 3, b = indices[f * 3 + 1] * 3, c = indices[f * 3 + 2] * 3;
    v +=
      positions[a] * (positions[b + 1] * positions[c + 2] - positions[b + 2] * positions[c + 1]) -
      positions[a + 1] * (positions[b] * positions[c + 2] - positions[b + 2] * positions[c]) +
      positions[a + 2] * (positions[b] * positions[c + 1] - positions[b + 1] * positions[c]);
  }
  return v / 6;
}

// Does this part face the wrong way? Closed parts: by volume. Open parts:
// from inside a surface the nearest other surface lies behind it, so the ray
// backwards should hit sooner than the ray forwards.
function insideOut(positions, indices, faces, closed, cast, eps) {
  if (closed) return signedVolume(positions, indices, faces) < 0;
  let right = 0, wrong = 0;
  for (const f of sampleFaces(faces, 160)) {
    const { centre, normal } = faceFrame(positions, indices, f);
    if (!normal) continue;
    const ahead = cast(centre.map((x, k) => x + normal[k] * eps), normal);
    const behind = cast(centre.map((x, k) => x - normal[k] * eps), normal.map((x) => -x));
    if (ahead === behind) continue;
    if (behind < ahead) right++;
    else wrong++;
  }
  return wrong > right;
}

function partList(mesh, twins) {
  const { positions, indices } = mesh;
  const { part, sizes } = partsOf(indices.length / 3, twins);
  const boxes = partBoxes(positions, indices, part, sizes.length);
  const open = new Uint32Array(sizes.length);
  for (let e = 0; e < twins.length; e++) if (twins[e] < 0) open[part[Math.floor(e / 3)]]++;
  return { part, parts: sizes.map((n, i) => ({ id: i, triangles: n, size: boxes[i], open: open[i] })) };
}

// ------------------------------------------------------------ the check

export function checkModel(mesh) {
  const { positions, indices } = mesh;
  const vcount = positions.length / 3;
  const diag = diagonal(positions);
  const { collapsed, doubled } = cleanFaces(indices);
  const { twins, crowded } = pairEdges(indices, vcount, positions);
  const { flip } = consistentFlips(indices, twins);
  let flipped = 0;
  for (const f of flip) flipped += f;
  const { part, parts } = partList(mesh, twins);
  const byPart = parts.map(() => []);
  for (let f = 0; f < part.length; f++) byPart[part[f]].push(f);

  const cast = rayCaster(positions, indices);
  const eps = diag * 1e-5;
  const total = indices.length / 3;
  let insideOutParts = 0;
  for (const p of parts) {
    p.speck = Math.hypot(...p.size) < diag * SPECK;
    p.closed = p.open === 0;
    if (p.triangles > total * 0.002 && !p.speck)
      p.insideOut = insideOut(positions, indices, byPart[p.id], p.closed, cast, eps);
    if (p.insideOut) insideOutParts++;
  }
  parts.sort((a, b) => b.triangles - a.triangles);

  // Wall: from the outside of the biggest part, how far to the next surface inwards.
  const main = parts[0];
  const walls = [];
  for (const f of sampleFaces(byPart[main.id], 400)) {
    const { centre, normal } = faceFrame(positions, indices, f);
    if (!normal) continue;
    const sign = main.insideOut ? -1 : 1;
    const ahead = cast(centre.map((x, k) => x + sign * normal[k] * eps), normal.map((x) => sign * x));
    if (ahead !== Infinity) continue; // only faces that look out into the open
    const d = cast(centre.map((x, k) => x - sign * normal[k] * eps), normal.map((x) => -sign * x));
    if (d !== Infinity) walls.push(d + eps);
  }
  walls.sort((a, b) => a - b);
  const wall = walls.length ? walls[Math.floor(walls.length / 2)] : null;

  const loops = boundaryLoops(indices, twins).map((loop, i) => ({
    id: i,
    length: loopLength(positions, loop),
    edges: loop.length,
    crack: loopArea(positions, loop) <= diag * diag * 1e-9,
  }));
  // The same holes the light fix closes: small, with some area.
  const smallHoles = loops.filter((l) => l.length < diag * SMALL_HOLE && !l.crack).length;
  const specks = parts.filter((p) => p.speck);
  const height = bounds(positions).size[2];

  // What kind of model is this?
  const big = parts.filter((p) => p.triangles > total * 0.02 && !p.speck);
  let kind;
  if (big.length >= 3) kind = 'many';
  else if (wall != null && wall < height * 0.2) kind = 'shell';
  else if (main.closed) kind = 'solid';
  else kind = 'skin';

  return {
    triangles: total,
    kind,
    wall,
    collapsed,
    doubled,
    crowded,
    flipped,
    insideOutParts,
    parts: parts.map(({ id, triangles, size, closed, speck, insideOut }) => ({ id, triangles, size, closed, speck, insideOut: !!insideOut })),
    partOf: part,
    specks: specks.length,
    speckTriangles: specks.reduce((s, p) => s + p.triangles, 0),
    loops,
    smallHoles,
    openEdges: twins.reduce((s, t) => s + (t < 0 ? 1 : 0), 0),
  };
}

// ------------------------------------------------------------ the light fix

export function applyRepair(mesh, opts) {
  const o = { clean: true, untangle: true, winding: true, specks: true, holes: true, ...opts };
  let positions = mesh.positions;
  let indices = mesh.indices;
  const diag = diagonal(positions);
  const info = { collapsed: 0, doubled: 0, flipped: 0, split: 0, specks: 0, holes: 0 };

  if (o.clean) {
    const c = cleanFaces(indices);
    indices = c.indices;
    info.collapsed = c.collapsed;
    info.doubled = c.doubled;
  }
  if (o.winding) {
    const { twins } = pairEdges(indices, positions.length / 3, positions);
    const { flip, changed } = consistentFlips(indices, twins);
    indices = applyFlips(indices, flip);
    info.flipped += changed;
    // Whole parts facing inwards.
    const t2 = pairEdges(indices, positions.length / 3, positions).twins;
    const { part, parts } = partList({ positions, indices }, t2);
    const byPart = parts.map(() => []);
    for (let f = 0; f < part.length; f++) byPart[part[f]].push(f);
    const cast = rayCaster(positions, indices);
    const flipPart = new Uint8Array(indices.length / 3);
    let any = false;
    for (const p of parts) {
      if (Math.hypot(...p.size) < diag * SPECK) continue;
      if (insideOut(positions, indices, byPart[p.id], p.open === 0, cast, diag * 1e-5)) {
        for (const f of byPart[p.id]) flipPart[f] = 1;
        info.flipped += byPart[p.id].length;
        any = true;
      }
    }
    if (any) indices = applyFlips(indices, flipPart);
  }
  let { twins } = pairEdges(indices, positions.length / 3, positions);
  if (o.untangle) {
    const s = splitTouching(positions, indices, twins);
    const d = detachCrowded(s.positions, s.indices);
    positions = d.positions;
    indices = d.indices;
    info.split = s.split + d.detached;
    twins = pairEdges(indices, positions.length / 3, positions).twins;
  }
  if (o.specks) {
    const { part, parts } = partList({ positions, indices }, twins);
    const drop = new Set(parts.filter((p) => Math.hypot(...p.size) < diag * SPECK).map((p) => p.id));
    if (drop.size && drop.size < parts.length) {
      const keep = [], keepTwinsFrom = [];
      for (let f = 0; f < part.length; f++)
        if (!drop.has(part[f])) {
          keep.push(indices[f * 3], indices[f * 3 + 1], indices[f * 3 + 2]);
          keepTwinsFrom.push(f);
        }
      info.specks = drop.size;
      indices = Uint32Array.from(keep);
      twins = pairEdges(indices, positions.length / 3, positions).twins;
    }
  }
  if (o.holes) {
    // Small, and with some area: a crack along a detached edge stays as it is.
    const loops = boundaryLoops(indices, twins).filter(
      (l) => loopLength(positions, l) < diag * SMALL_HOLE && loopArea(positions, l) > diag * diag * 1e-9,
    );
    if (loops.length) {
      const pos = Array.from(positions);
      const add = [];
      for (const loop of loops) for (const f of fillLoop(pos, loop, loop.length > 8 ? 'smooth' : 'flat')) add.push(...f);
      positions = Float32Array.from(pos);
      indices = Uint32Array.from([...indices, ...add]);
      info.holes = loops.length;
      // A patch must never put a third triangle on an edge.
      if (o.untangle) indices = detachCrowded(positions, indices).indices;
    }
  }
  return { ...compactMesh(positions, indices), info };
}

// ------------------------------------------------------------ closing chosen openings

export function applyFill(mesh, { loops: chosen, mode = 'smooth', count }) {
  const { twins } = pairEdges(mesh.indices, mesh.positions.length / 3, mesh.positions);
  const loops = boundaryLoops(mesh.indices, twins);
  if (count != null && loops.length !== count)
    throw Error('This step no longer matches the model, because an earlier step changed it.');
  const pos = Array.from(mesh.positions);
  const add = [];
  for (const i of chosen) {
    if (!loops[i]) throw Error('This step no longer matches the model, because an earlier step changed it.');
    for (const f of fillLoop(pos, loops[i], mode)) add.push(...f);
  }
  return {
    positions: Float32Array.from(pos),
    indices: Uint32Array.from([...mesh.indices, ...add]),
    info: { closed: chosen.length },
  };
}

// Openings with their outline points, for the list and for drawing.
export function listOpenings(mesh) {
  const { positions, indices } = mesh;
  const { twins } = pairEdges(indices, positions.length / 3, positions);
  const diag = diagonal(positions);
  const out = [];
  boundaryLoops(indices, twins).forEach((loop, id) => {
    // A crack along a detached edge has no area: nothing to close.
    if (loopArea(positions, loop) <= diag * diag * 1e-9) return;
    const points = new Float32Array(loop.length * 3);
    loop.forEach((v, i) => points.set(positions.subarray(v * 3, v * 3 + 3), i * 3));
    const length = loopLength(positions, loop);
    out.push({ id, edges: loop.length, length, small: length < diag * SMALL_HOLE, points });
  });
  return out;
}

function loopArea(p, loop) {
  const n = [0, 0, 0];
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i] * 3, b = loop[(i + 1) % loop.length] * 3;
    n[0] += (p[a + 1] - p[b + 1]) * (p[a + 2] + p[b + 2]);
    n[1] += (p[a + 2] - p[b + 2]) * (p[a] + p[b]);
    n[2] += (p[a] - p[b]) * (p[a + 1] + p[b + 1]);
  }
  return Math.hypot(...n) / 2;
}

function compactMesh(positions, indices) {
  const map = new Int32Array(positions.length / 3).fill(-1);
  let n = 0;
  for (const v of indices) if (map[v] < 0) map[v] = n++;
  const out = new Float32Array(n * 3);
  for (let v = 0; v < map.length; v++) if (map[v] >= 0) out.set(positions.subarray(v * 3, v * 3 + 3), map[v] * 3);
  return { positions: out, indices: indices.map((v) => map[v]) };
}
