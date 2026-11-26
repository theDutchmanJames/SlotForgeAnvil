// Variants: other versions of the same project, exported in one go. A
// variant can leave steps out (the wing, the interior) and can be a different
// scale (1:32 → 1:24). A different scale grows or shrinks the model right
// after it is oriented and scaled, and every step's positions with it, while
// what is a real size stays: the wall, posts, tabs, pins, holes, LED sockets,
// panel line depth and the height of text.

const P = (p, f) => (Array.isArray(p) ? p.map((x) => x * f) : p);
const L = (v, f) => (Number.isFinite(v) ? v * f : v);

// Each step type: what in its params is a place or a size of the car.
const SCALE = {
  // The region and the base move with the scale; the percentages stay.
  bodyshape: (p, f) => ({ ...p, from: L(p.from, f), to: L(p.to, f), blend: L(p.blend, f), base: L(p.base, f) }),
  slice: (p, f) => ({ ...p, at: L(p.at, f), pivot: L(p.pivot, f) }),
  cutoff: (p, f) => ({ ...p, cuts: p.cuts.map((c) => ({ ...c, at: P(c.at, f), w: L(c.w, f), h: L(c.h, f) })) }),
  floor: (p, f) => ({ ...p, at: L(p.at, f), blend: L(p.blend, f) }),
  hollow: (p, f) => ({ ...p, strokes: (p.strokes ?? []).map((s) => ({ ...s, at: P(s.at, f), radius: L(s.radius, f) })) }),
  hammer: (p, f) => ({
    ...p,
    blows: (p.blows ?? []).map((b) => ({ ...b, at: P(b.at, f), radius: L(b.radius, f), depth: L(b.depth, f) })),
    dollies: (p.dollies ?? []).map((d) => ({ ...d, at: P(d.at, f), radius: L(d.radius, f) })),
  }),
  stretch: (p, f) => ({ ...p, amount: L(p.amount, f), from: L(p.from, f), to: L(p.to, f) }),
  arches: (p, f) => ({ ...p, cuts: (p.cuts ?? []).map((c) => ({ ...c, x: L(c.x, f), z: L(c.z, f), r: L(c.r, f) })) }),
  guidecut: (p, f) => ({ ...p, x: L(p.x, f), y: L(p.y, f), r: L(p.r, f), top: L(p.top, f) }),
  posts: (p, f) => ({
    ...p,
    base: L(p.base, f),
    length: L(p.length, f),
    posts: (p.posts ?? []).map((q) => ({ ...q, x: L(q.x, f), y: L(q.y, f), base: L(q.base, f), length: L(q.length, f) })),
  }),
  mounts: (p, f) => ({ ...p, base: L(p.base, f), edge: L(p.edge, f), catchZ: L(p.catchZ, f), ground: L(p.ground, f), tabs: (p.tabs ?? []).map((t) => ({ ...t, x: L(t.x, f) })) }),
  windows: (p, f) => ({ ...p, windows: (p.windows ?? []).map((w) => ({ ...w, points: (w.points ?? []).map((q) => P(q, f)) })) }),
  smooth: (p, f) => ({ ...p, strokes: (p.strokes ?? []).map((s) => ({ ...s, at: P(s.at, f), radius: L(s.radius, f) })) }),
  addpart: (p, f) => ({ ...p, place: { ...p.place, x: L(p.place?.x ?? 0, f), y: L(p.place?.y ?? 0, f), z: L(p.place?.z ?? 0, f), scale: L(p.place?.scale ?? 1, f) } }),
  rebuild: (p, f) => ({ ...p, cell: L(p.cell, f) }),
  symmetrize: (p, f) => ({ ...p, at: L(p.at, f) }),
  solid: (p, f) => ({ ...p, bottom: L(p.bottom, f) }),
  interior: (p, f) => ({ ...p, x0: L(p.x0, f), x1: L(p.x1, f), z: L(p.z, f), helmet: L(p.helmet, f) }),
  lights: (p, f) => ({ ...p, lights: (p.lights ?? []).map((l) => ({ ...l, at: P(l.at, f) })) }),
  text: (p, f) => ({ ...p, texts: (p.texts ?? []).map((t) => ({ ...t, at: P(t.at, f) })) }),
};

// The steps of a variant: those it leaves out gone, and its scale put in.
export function variantSteps(steps, variant) {
  const off = new Set(variant.off ?? []);
  let list = steps.filter((s) => !off.has(s.id));
  const f = variantFactor(variant);
  if (f === 1) return list;
  // The scale goes in after the first steps that set the model up.
  let at = 0;
  while (at < list.length && (list[at].type === 'orient' || list[at].type === 'scale')) at++;
  list = list.map((s, i) => (i < at || !SCALE[s.type] ? s : { ...s, params: SCALE[s.type](s.params, f) }));
  list.splice(at, 0, { id: `variant-scale-${variant.id ?? 'x'}`, type: 'scale', enabled: true, params: { factor: f } });
  return list;
}

// How much bigger: from 1:32 to 1:24 is 32 / 24.
export function variantFactor(v) {
  if (!v.from || !v.to || v.from === v.to) return 1;
  if (!(v.from > 0) || !(v.to > 0)) throw Error('A variant needs a scale like 1:24.');
  return v.from / v.to;
}

// The chassis, grown or shrunk with the body (a real chassis at the other
// scale will differ: check its numbers).
export function variantChassis(c, f) {
  if (!c || f === 1) return c;
  const pair = (t) => ({ ...t, diameter: t.diameter * f, width: t.width * f, inOut: t.inOut * f });
  return {
    ...c,
    frontX: c.frontX * f,
    wheelbase: c.wheelbase * f,
    wheelbaseMin: L(c.wheelbaseMin, f),
    wheelbaseMax: L(c.wheelbaseMax, f),
    clearance: c.clearance * f,
    deck: c.deck * f,
    guideAhead: c.guideAhead * f,
    front: pair(c.front),
    rear: pair(c.rear),
  };
}

// The steps a variant can leave out: the ones that add or take away a part.
export const OPTIONAL_STEPS = ['addpart', 'cutoff', 'text', 'interior', 'lights', 'mounts', 'posts', 'windows', 'panellines', 'slice', 'guidecut'];
