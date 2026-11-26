// Does the body clear the chassis? Every corner of the body is checked
// against the tyres, the room the guide swings in, and the chassis itself
// (its STL when there is one, else the deck from its numbers). A corner
// closer than the gap to keep counts as a hit. Car frame: front at low X,
// Y across (+Y right), Z up.
import { BufferAttribute, BufferGeometry, Triangle, Vector3 } from 'three';
import { MeshBVH } from 'three-mesh-bvh';

// The room the guide needs: a round zone round the guide post, from the
// track up to the top of the guide (braid plates and nut).
export function guideZone(c, ground) {
  const D = c.front.diameter;
  return {
    x: c.frontX - c.guideAhead,
    y: 0,
    r: c.guideRadius ?? Math.round(D * 0.4 * 10) / 10,
    top: ground + (c.guideHeight ?? Math.round(Math.max(c.deck, D * 0.5) * 10) / 10),
  };
}

// Where the parts of the chassis are, for the check and for the ghost.
export function chassisZones(c, ground, withDeck = true) {
  const tyres = [];
  for (const [key, x] of [['front', c.frontX], ['rear', c.frontX + c.wheelbase]]) {
    const t = c[key];
    for (const side of [-1, 1])
      tyres.push({ key: `${key}-${side < 0 ? 'left' : 'right'}`, pair: key, label: `${key === 'front' ? 'Front' : 'Rear'} ${side < 0 ? 'left' : 'right'} tyre`, x, y: side * t.inOut, z: ground + t.diameter / 2, r: t.diameter / 2, half: t.width / 2 });
  }
  let deck = null;
  if (withDeck) {
    const inner = Math.min(c.front.inOut - c.front.width / 2, c.rear.inOut - c.rear.width / 2) * 2 * 0.9;
    const thick = Math.max(c.deck * 0.15, 0.5);
    deck = {
      x0: c.frontX - c.front.diameter * 0.3,
      x1: c.frontX + c.wheelbase + c.rear.diameter * 0.3,
      half: Math.max(inner, 1) / 2,
      top: ground + c.deck + thick / 2,
    };
  }
  return { tyres, guide: guideZone(c, ground), deck };
}

// body: { positions, indices }. c: the chassis. ground: track height.
// opts.gap: room to keep. opts.mesh: the chassis STL, placed. opts.skip(p):
// corners to leave out (where the posts meet the chassis).
// Returns { faces: Uint8Array (1 = hits), parts: [...] }, each part with
// { key, label, kind, corners, depth (how far into the gap or the part), at, radius }.
export function checkClearance(body, c, ground, { gap = 0.5, mesh = null, skip = null } = {}) {
  const P = body.positions, T = body.indices;
  const V = P.length / 3;
  const zones = chassisZones(c, ground, !mesh);
  const hit = new Int16Array(V).fill(-1); // part index per corner
  const depth = new Float32Array(V);
  const parts = [];
  // Closer than this is right on the edge of the gap (a cut made to it): fine.
  const EDGE = 0.01;
  const mark = (v, part, d) => {
    if (d < EDGE) return;
    if (d <= depth[v] && hit[v] >= 0) return;
    hit[v] = part;
    depth[v] = d;
  };
  const left = (v) => skip && skip(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]);

  for (const t of zones.tyres) {
    const id = parts.push({ key: t.key, pair: t.pair, label: t.label, kind: 'tyre' }) - 1;
    for (let v = 0; v < V; v++) {
      const dy = Math.abs(P[v * 3 + 1] - t.y);
      if (dy >= t.half + gap) continue;
      const rho = Math.hypot(P[v * 3] - t.x, P[v * 3 + 2] - t.z);
      if (rho >= t.r + gap || left(v)) continue;
      mark(v, id, Math.min(t.r + gap - rho, t.half + gap - dy));
    }
  }
  {
    const g = zones.guide;
    const id = parts.push({ key: 'guide', label: 'Guide', kind: 'guide' }) - 1;
    for (let v = 0; v < V; v++) {
      const z = P[v * 3 + 2];
      if (z >= g.top + gap) continue;
      const d = Math.hypot(P[v * 3] - g.x, P[v * 3 + 1] - g.y);
      if (d >= g.r + gap || left(v)) continue;
      mark(v, id, Math.min(g.r + gap - d, g.top + gap - z));
    }
  }
  if (zones.deck) {
    const k = zones.deck;
    const id = parts.push({ key: 'deck', label: 'Chassis deck', kind: 'chassis' }) - 1;
    for (let v = 0; v < V; v++) {
      const x = P[v * 3], y = Math.abs(P[v * 3 + 1]), z = P[v * 3 + 2];
      if (x <= k.x0 || x >= k.x1 || y >= k.half || z >= k.top + gap || left(v)) continue;
      mark(v, id, k.top + gap - z);
    }
  }
  if (mesh) {
    // The chassis's own file: closer than the gap, or inside it.
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(mesh.positions, 3));
    geo.setIndex(new BufferAttribute(Uint32Array.from(mesh.indices), 1));
    const bvh = new MeshBVH(geo);
    const box = { lo: [Infinity, Infinity, Infinity], hi: [-Infinity, -Infinity, -Infinity] };
    for (let i = 0; i < mesh.positions.length; i++) {
      box.lo[i % 3] = Math.min(box.lo[i % 3], mesh.positions[i]);
      box.hi[i % 3] = Math.max(box.hi[i % 3], mesh.positions[i]);
    }
    const id = parts.push({ key: 'chassis', label: 'Chassis', kind: 'chassis' }) - 1;
    const p = new Vector3(), n = new Vector3(), tri = new Triangle();
    const pa = new Vector3(), pb = new Vector3(), pc = new Vector3();
    const cp = geo.index.array, pos = geo.attributes.position;
    for (let v = 0; v < V; v++) {
      const x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2];
      if (x < box.lo[0] - gap || x > box.hi[0] + gap || y < box.lo[1] - gap || y > box.hi[1] + gap || z < box.lo[2] - gap || z > box.hi[2] + gap) continue;
      if (left(v)) continue;
      const res = bvh.closestPointToPoint(p.set(x, y, z));
      if (!res) continue;
      const f = res.faceIndex;
      pa.fromBufferAttribute(pos, cp[f * 3]);
      pb.fromBufferAttribute(pos, cp[f * 3 + 1]);
      pc.fromBufferAttribute(pos, cp[f * 3 + 2]);
      tri.set(pa, pb, pc).getNormal(n);
      const inside = n.dot(p.clone().sub(res.point)) < 0;
      const d = res.distance;
      if (!inside && d >= gap) continue;
      mark(v, id, inside ? gap + d : gap - d);
    }
  }

  // Faces: any corner that hits. Each part: how many corners, how deep, and
  // where (middle and reach of its corners).
  const faces = new Uint8Array(T.length / 3);
  for (let f = 0; f < faces.length; f++) if (hit[T[f * 3]] >= 0 || hit[T[f * 3 + 1]] >= 0 || hit[T[f * 3 + 2]] >= 0) faces[f] = 1;
  const sum = parts.map(() => ({ n: 0, d: 0, c: [0, 0, 0] }));
  for (let v = 0; v < V; v++) {
    if (hit[v] < 0) continue;
    const s = sum[hit[v]];
    s.n++;
    s.d = Math.max(s.d, depth[v]);
    for (let k = 0; k < 3; k++) s.c[k] += P[v * 3 + k];
  }
  const out = [];
  parts.forEach((part, i) => {
    const s = sum[i];
    if (!s.n) return;
    const at = s.c.map((x) => x / s.n);
    let radius = 0;
    for (let v = 0; v < V; v++) if (hit[v] === i) radius = Math.max(radius, Math.hypot(P[v * 3] - at[0], P[v * 3 + 1] - at[1], P[v * 3 + 2] - at[2]));
    out.push({ ...part, corners: s.n, depth: s.d, at, radius });
  });
  // Chassis hits in more than one place (motor, magnet): one entry each.
  return { faces, parts: splitChassis(out, P, T, hit, depth, parts) };
}

// Split the chassis part's corners into the separate spots they form on the body.
function splitChassis(out, P, T, hit, depth, parts) {
  const id = parts.findIndex((p) => p.key === 'chassis');
  const entry = out.find((p) => p.key === 'chassis');
  if (id < 0 || !entry) return out;
  const V = P.length / 3;
  const root = new Int32Array(V).map((_, i) => i);
  const find = (a) => {
    while (root[a] !== a) a = root[a] = root[root[a]];
    return a;
  };
  for (let f = 0; f < T.length; f += 3)
    for (let k = 0; k < 3; k++) {
      const a = T[f + k], b = T[f + ((k + 1) % 3)];
      if (hit[a] === id && hit[b] === id) root[find(a)] = find(b);
    }
  const groups = new Map();
  for (let v = 0; v < V; v++) {
    if (hit[v] !== id) continue;
    const r = find(v);
    const g = groups.get(r) ?? groups.set(r, { n: 0, d: 0, c: [0, 0, 0], vs: [] }).get(r);
    g.n++;
    g.d = Math.max(g.d, depth[v]);
    g.vs.push(v);
    for (let k = 0; k < 3; k++) g.c[k] += P[v * 3 + k];
  }
  const spots = [...groups.values()]
    .filter((g) => g.n >= 2)
    .sort((a, b) => b.n - a.n)
    .slice(0, 8)
    .map((g, i) => {
      const at = g.c.map((x) => x / g.n);
      let radius = 0;
      for (const v of g.vs) radius = Math.max(radius, Math.hypot(P[v * 3] - at[0], P[v * 3 + 1] - at[1], P[v * 3 + 2] - at[2]));
      return { ...entry, key: `chassis-${i}`, label: i ? `Chassis, spot ${i + 1}` : 'Chassis', corners: g.n, depth: g.d, at, radius };
    });
  return [...out.filter((p) => p.key !== 'chassis'), ...spots];
}
