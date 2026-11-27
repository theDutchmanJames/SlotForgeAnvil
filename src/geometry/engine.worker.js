// Geometry runs here so the window stays responsive on dense car models.
import { readSTLMesh } from './stl-mesh.js';
import { applyOrient, guessOrient, meshStats, replay, squareAngles } from './engine.js';
import { checkModel, listOpenings } from './repair.js';
import { classifySkins, volume, wallThickness } from './shell.js';
import { rayCaster } from './rays.js';
import { findArches } from './chassis.js';
import { makeBuck } from './buck.js';
import { makeLenses, makeWindowBucks, offsetOutline } from './lenses.js';
import { traceWindows } from './trace.js';
import { cutter } from './windows.js';
import { glassFor, windowOutlines, windowState } from './windows.js';
import { solidPreview } from './solid.js';
import { symmetryReport } from './symmetry.js';
import { grooves } from './detail.js';

let source = null;
let current = null; // the last built shape
let body = null; // the same before its posts
let lastSteps = null;
let cache = new Map();
const ctx = { parts: new Map() }; // added parts' files, by id
let variantCache = new Map();
let skins = null,
  solidView = null,
  symmetryView = null;
let checked = null,
  openings = null,
  walls = null;

const copy = (a) => a.slice();

const methods = {
  // A preview of steps not yet committed: replayed with a cache of its own, so
  // the current body, its checks and the exports stay as they are.
  previewSteps({ steps }) {
    if (!source) throw Error('No model is loaded.');
    const { mesh, original, results } = replay(source, steps, new Map(), ctx);
    const stats = meshStats(mesh);
    return {
      value: {
        positions: copy(mesh.positions),
        indices: copy(mesh.indices),
        twins: stats.twins,
        original: { positions: copy(original.positions), indices: copy(original.indices) },
        results,
        stats: { ...stats, twins: undefined },
      },
      transfer: (v) => [v.positions.buffer, v.indices.buffer, v.twins.buffer, v.original.positions.buffer, v.original.indices.buffer],
    };
  },
  // bytes: the STL file. Returns the guessed orientation.
  load({ bytes }) {
    source = readSTLMesh(bytes);
    cache = new Map();
    current = body = lastSteps = checked = openings = walls = skins = solidView = symmetryView = null;
    ctx.parts.clear();
    return { guess: guessOrient(source), triangles: source.indices.length / 3 };
  },
  // The turn, tilt and lean that square the car up, from the file as imported.
  straighten({ params }) {
    if (!source) throw Error('No model is loaded.');
    return squareAngles(applyOrient(source, { front: params.front, up: params.up }));
  },
  build({ steps }) {
    if (!source) throw Error('No model is loaded.');
    const { mesh, original, results } = replay(source, steps, cache, ctx);
    current = mesh;
    lastSteps = steps;
    // The body without its posts, for finding the arches: a post hanging below
    // the sills must not look like part of the body. Comes from the cache.
    const at = steps.findIndex((s) => (s.type === 'posts' || s.type === 'mounts' || s.type === 'interior') && s.enabled);
    body = at < 0 ? mesh : replay(source, steps.slice(0, at), cache, ctx).mesh;
    checked = openings = walls = skins = solidView = symmetryView = null;
    const stats = meshStats(mesh);
    // Weight needs a closed body.
    if (stats.openEdges === 0 && stats.faultyEdges === 0) stats.volume = volume(mesh);
    // Copies: the worker keeps its own for the cache and later checks.
    return {
      value: {
        positions: copy(mesh.positions),
        indices: copy(mesh.indices),
        twins: stats.twins,
        original: { positions: copy(original.positions), indices: copy(original.indices) },
        results,
        stats: { ...stats, twins: undefined },
      },
      transfer: (v) => [v.positions.buffer, v.indices.buffer, v.twins.buffer, v.original.positions.buffer, v.original.indices.buffer],
    };
  },
  // What is wrong with the shape as it stands now.
  check() {
    if (!current) throw Error('No model is built yet.');
    checked ??= checkModel(current);
    return { value: { ...checked, partOf: copy(checked.partOf) }, transfer: (v) => [v.partOf.buffer] };
  },
  // Wall thickness at every corner of the shape.
  thickness() {
    if (!current) throw Error('No model is built yet.');
    walls ??= wallThickness(current);
    return { value: copy(walls), transfer: (v) => [v.buffer] };
  },
  // Where the wheel arches are, and how wide the body is there.
  arches() {
    if (!current) throw Error('No model is built yet.');
    return findArches(body ?? current);
  },
  // The glazing buck, from the body before its windows are cut and its posts
  // added. The windows and posts of the last build go in as outlines and
  // checks. opts.mode: 'cabin' (one insert for the windows with their glass
  // inside; glass on the outside gets a buck per window) or 'each' (a buck
  // per window; lights with glass inside get theirs under Clear parts).
  buck({ opts }) {
    if (!source || !lastSteps) throw Error('No model is built yet.');
    const at = lastSteps.findIndex((s) => (s.type === 'windows' || s.type === 'posts') && s.enabled);
    const uncut = at < 0 ? current : replay(source, lastSteps.slice(0, at), cache, ctx).mesh;
    const win = lastSteps.find((s) => s.type === 'windows' && s.enabled);
    const posts = lastSteps.find((s) => s.type === 'posts' && s.enabled);
    const gp = win?.params ?? {};
    const name = (o) => `${o.window.name}${o.mirrored ? ' (mirrored)' : ''}`;
    const outside = (w) => windowState(w) === 'open' && glassFor(w, gp).kind !== 'inside';
    const each = (w) => windowState(w) === 'open' && (outside(w) || (opts.mode === 'each' && !w.lens));
    const all = win?.params.windows ?? [];
    const cabinWins = opts.mode === 'each' ? [] : all.filter((w) => !outside(w));
    let cabin = null;
    // The insert: unless every window there is has its glass on the outside
    // (with no windows at all it is made from the trim line and cabin alone).
    if (opts.mode !== 'each' && (cabinWins.some((w) => !w.lens) || !all.some((w) => outside(w) && !w.lens))) {
      const outlines = windowOutlines(cabinWins).map((o) => ({ name: name(o), points: o.points, normal: o.normal }));
      cabin = makeBuck(uncut, { ...opts, outlines, posts: posts?.params.posts ?? [] });
    }
    const own = windowOutlines(all.filter(each), 0.25).map((o) => ({ name: name(o), points: o.points, normal: o.normal, glass: glassFor(o.window, gp) }));
    const windows = own.length ? makeWindowBucks(uncut, own, opts) : null;
    if (!cabin && !windows) throw Error('No window to make a buck for: draw the windows first (Windows), and set them Open or Solid.');
    const value = {
      positions: cabin?.mesh.positions ?? new Float32Array(0),
      indices: cabin?.mesh.indices ?? new Uint32Array(0),
      info: cabin?.info ?? null,
      windows,
    };
    const bufs = (v) => [v.positions.buffer, v.indices.buffer];
    return { value, transfer: (v) => [...bufs(v), ...(v.windows ? [...bufs(v.windows.car), ...bufs(v.windows.print)] : [])] };
  },
  // Find the windows, on the body as it was before it was hollowed (Hollow
  // keeps the outside as it is, and the model's own openings are clean
  // there) and before anything is cut or fitted.
  trace({ opts }) {
    if (!source || !lastSteps) throw Error('No model is built yet.');
    const at = lastSteps.findIndex((s) => ['floor', 'hollow', 'solid', 'windows', 'posts', 'lights', 'arches', 'guidecut', 'mounts', 'interior'].includes(s.type) && s.enabled);
    const before = at < 0 ? current : replay(source, lastSteps.slice(0, at), cache, ctx).mesh;
    return traceWindows(before, opts);
  },
  // A window outline made larger by `by` along the body (glass on the
  // outside over an opening overlaps the body round it): moved out in the
  // window's plane, then put back on the outside along its facing.
  growOutline({ points, normal, by }) {
    if (!current) throw Error('No model is built yet.');
    const c = cutter(points, normal, 1);
    const cast = rayCaster(body?.positions ?? current.positions, body?.indices ?? current.indices);
    const out = offsetOutline(c.poly, by).map(([x, y]) => {
      const s = c.at(x, y);
      const p = [0, 1, 2].map((k) => x * c.u[k] + y * c.v[k] + s * c.d[k]);
      const n = normal;
      const start = p.map((q, k) => q + n[k] * 5);
      const t = cast(start, n.map((q) => -q));
      return (t < 15 ? start.map((q, k) => q - n[k] * t) : p).map((q) => Math.round(q * 1000) / 1000);
    });
    return out;
  },
  // Clear parts (printed, and bucks to vac-form the lights), from the body
  // before its windows are cut, for every open window not left out, each
  // shaped for where its glass sits.
  lenses({ opts }) {
    if (!source || !lastSteps) throw Error('No model is built yet.');
    const at = lastSteps.findIndex((s) => (s.type === 'windows' || s.type === 'posts') && s.enabled);
    const uncut = at < 0 ? current : replay(source, lastSteps.slice(0, at), cache, ctx).mesh;
    const win = lastSteps.find((s) => s.type === 'windows' && s.enabled);
    const lights = (win?.params.windows ?? []).filter((w) => !(opts.skip ?? []).includes(w.id) && windowState(w) === 'open');
    const gp = win?.params ?? {};
    const outlines = windowOutlines(lights, 0.25).map((o) => ({
      name: `${o.window.name}${o.mirrored ? ' (mirrored)' : ''}`,
      points: o.points,
      normal: o.normal,
      glass: { ...glassFor(o.window, gp), minWall: gp.minWall ?? 0.6 },
    }));
    const out = makeLenses(uncut, outlines, opts);
    const meshes = [out.car.lenses, out.car.plugs, out.print.lenses, out.print.plugs];
    return { value: out, transfer: () => meshes.flatMap((m) => [m.positions.buffer, m.indices.buffer]) };
  },
  // An added part's file, read once and kept by its id.
  setPart({ id, bytes }) {
    const m = readSTLMesh(bytes);
    ctx.parts.set(id, m);
    return { triangles: m.indices.length / 3 };
  },
  // Which triangles are the outer skin (1) and which the inner (0): for
  // Protect the outside.
  skins() {
    if (!current) throw Error('No model is built yet.');
    skins ??= classifySkins(current, rayCaster(current.positions, current.indices));
    return { value: copy(skins), transfer: (v) => [v.buffer] };
  },
  // A variant: the steps it is made of, built on their own (the model shown
  // stays as it is). Its own cache, emptied when an export run starts.
  variant({ steps, fresh }) {
    if (!source) throw Error('No model is loaded.');
    if (fresh) variantCache = new Map();
    const { mesh, results } = replay(source, steps, variantCache, ctx);
    const failed = results.filter((r) => r.state === 'error');
    return {
      value: { positions: copy(mesh.positions), indices: copy(mesh.indices), failed: failed.map((r) => r.error) },
      transfer: (v) => [v.positions.buffer, v.indices.buffer],
    };
  },
  // Panel lines found: the faces they run through, for the red preview.
  grooves({ radius, min }) {
    if (!current) throw Error('No model is built yet.');
    const g = grooves(current, { radius, min });
    const T = current.indices;
    const faces = new Uint8Array(T.length / 3);
    let count = 0;
    for (let v = 0; v < g.depth.length; v++) if (g.depth[v]) count++;
    for (let f = 0; f < faces.length; f++) if (g.depth[T[f * 3]] || g.depth[T[f * 3 + 1]] || g.depth[T[f * 3 + 2]]) faces[f] = 1;
    return { value: { faces, count }, transfer: (v) => [v.faces.buffer] };
  },
  // How well the two sides match, and where the centre line fits best.
  symmetry() {
    if (!current) throw Error('No model is built yet.');
    symmetryView ??= symmetryReport(current);
    return symmetryView;
  },
  // Make solid: which triangles would go (the inner skin), or why none.
  solid() {
    if (!current) throw Error('No model is built yet.');
    solidView ??= solidPreview(current);
    const v = solidView;
    return v.faces ? { value: { ...v, faces: copy(v.faces) }, transfer: (x) => [x.faces.buffer] } : { value: v };
  },
  openings() {
    if (!current) throw Error('No model is built yet.');
    openings ??= listOpenings(current);
    return { value: openings.map((o) => ({ ...o, points: copy(o.points) })), transfer: (v) => v.map((o) => o.points.buffer) };
  },
};

onmessage = ({ data }) => {
  const { id, method, args } = data;
  try {
    const out = methods[method](args);
    if (out && out.transfer) postMessage({ id, value: out.value }, out.transfer(out.value));
    else postMessage({ id, value: out });
  } catch (e) {
    postMessage({ id, error: e?.message ?? String(e) });
  }
};
