// Geometry runs here so the window stays responsive on dense car models.
import { readSTLMesh } from './stl-mesh.js';
import { applyOrient, guessOrient, meshStats, replay, straightenAngle } from './engine.js';
import { checkModel, listOpenings } from './repair.js';
import { classifySkins, volume, wallThickness } from './shell.js';
import { rayCaster } from './rays.js';
import { findArches } from './chassis.js';
import { makeBuck } from './buck.js';
import { windowOutlines } from './windows.js';
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
  // bytes: the STL file. Returns the guessed orientation.
  load({ bytes }) {
    source = readSTLMesh(bytes);
    cache = new Map();
    current = body = lastSteps = checked = openings = walls = skins = solidView = symmetryView = null;
    ctx.parts.clear();
    return { guess: guessOrient(source), triangles: source.indices.length / 3 };
  },
  // The turn that straightens the car, from the file as imported.
  straighten({ params }) {
    if (!source) throw Error('No model is loaded.');
    const base = applyOrient(source, { ...params, turn: 0 });
    return { turn: straightenAngle(base.positions) };
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
  // The window buck, from the body before its windows are cut and its posts
  // added. The windows and posts of the last build go in as outlines and checks.
  buck({ opts }) {
    if (!source || !lastSteps) throw Error('No model is built yet.');
    const at = lastSteps.findIndex((s) => (s.type === 'windows' || s.type === 'posts') && s.enabled);
    const uncut = at < 0 ? current : replay(source, lastSteps.slice(0, at), cache, ctx).mesh;
    const win = lastSteps.find((s) => s.type === 'windows' && s.enabled);
    const posts = lastSteps.find((s) => s.type === 'posts' && s.enabled);
    const outlines = windowOutlines(win?.params.windows ?? []).map((o) => ({
      name: `${o.window.name}${o.mirrored ? ' (mirrored)' : ''}`,
      points: o.points,
      normal: o.normal,
    }));
    const { mesh, info } = makeBuck(uncut, { ...opts, outlines, posts: posts?.params.posts ?? [] });
    return { value: { positions: mesh.positions, indices: mesh.indices, info }, transfer: (v) => [v.positions.buffer, v.indices.buffer] };
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
