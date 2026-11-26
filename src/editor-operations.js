// Pure operations for the editor tools: feature layout, body shaping steps and
// step names. They return new step lists, so a caller commits once and only
// after everything checked out: a failed layout changes nothing.
import { newId, STEP_NAMES } from './project.js';
import { checkBodyShape } from './geometry/bodyshape.js';

// ------------------------------------------------------------ step names

export const stepName = (s) => String(s.editor?.name || STEP_NAMES[s.type] || s.type);
export const matchesStep = (s, query) => {
  const q = String(query ?? '').toLowerCase().trim();
  return !q || [stepName(s), STEP_NAMES[s.type] ?? '', s.type, s.editor?.notes || ''].join(' ').toLowerCase().includes(q);
};
export function stepMetadata(name, notes) {
  return { name: String(name ?? '').trim().slice(0, 80), notes: String(notes ?? '').trim().slice(0, 1200) };
}

// ------------------------------------------------------------ feature layout

// Where each placement step keeps its items (an added part is one item).
export const LAYOUT_KEYS = { posts: 'posts', lights: 'lights', windows: 'windows', text: 'texts', addpart: null };
export const supportsLayout = (s) => Object.hasOwn(LAYOUT_KEYS, s.type);
export const layoutItems = (s) => (s.type === 'addpart' ? [s.params.place ?? {}] : (s.params[LAYOUT_KEYS[s.type]] ?? []));

function translate(item, type, delta) {
  const q = structuredClone(item);
  if (type === 'posts' || type === 'addpart') {
    ['x', 'y', 'z'].forEach((k, i) => {
      if (type === 'posts' && k === 'z') return;
      q[k] = (q[k] ?? 0) + delta[i];
    });
  } else if (type === 'windows') q.points = q.points.map((point) => point.map((v, i) => v + delta[i]));
  else q.at = q.at.map((v, i) => v + delta[i]);
  const points = type === 'windows' ? q.points : q.at ? [q.at] : [[q.x, q.y, q.z ?? 0]];
  if (!points.length || points.some((p) => p.length !== 3 || p.some((v) => !Number.isFinite(v) || Math.abs(v) > 10000)))
    throw Error('Feature positions must stay within ±10000 mm.');
  return q;
}

// Lights and text keep their other side as an item of its own: the same
// place with Y turned round. Returns, per item, the index of its twin or -1.
function twinsOf(items, type) {
  if (type !== 'lights' && type !== 'text') return items.map(() => -1);
  const near = (a, b) => Math.abs(a[0] - b[0]) < 1e-3 && Math.abs(a[1] + b[1]) < 1e-3 && Math.abs(a[2] - b[2]) < 1e-3;
  return items.map((a, i) => (Math.abs(a.at?.[1] ?? 0) < 1e-3 ? -1 : items.findIndex((b, j) => j !== i && b.at && near(a.at, b.at))));
}

// opts: item ('all' or an index), mode ('move' or 'copy'), count (copies),
// delta (mm, the spacing between copies), mirror (keep left and right mirrored:
// a light or text and its other side move as a pair, the other side the other
// way across).
export function arrangeFeatures(steps, id, { item = 'all', mode = 'copy', count = 1, delta = [0, 0, 0], mirror = false } = {}) {
  const source = steps.find((s) => s.id === id);
  if (!source || !supportsLayout(source)) throw Error('Choose a placement step.');
  if (!['move', 'copy'].includes(mode)) throw Error('Choose Move or Repeat.');
  if (mode === 'copy' && (!Number.isInteger(count) || count < 1 || count > 20)) throw Error('Choose 1 to 20 copies.');
  if (delta.length !== 3 || delta.some((v) => !Number.isFinite(v) || Math.abs(v) > 1000)) throw Error('Offsets must be numbers within ±1000 mm.');
  if (source.type === 'posts' && delta[2]) throw Error('Post height follows the body. Use X and Y offsets.');
  if (!delta.some((v) => v !== 0)) throw Error(mode === 'copy' ? 'Enter a spacing, or the copies sit on top of each other.' : 'Enter an offset to move by.');
  const items = layoutItems(source);
  let indices = item === 'all' ? items.map((_, i) => i) : [Number(item)];
  if (!indices.length || indices.some((i) => !Number.isInteger(i) || i < 0 || i >= items.length)) throw Error('Choose an existing feature.');
  const twins = mirror ? twinsOf(items, source.type) : items.map(() => -1);
  indices = [...new Set(indices.flatMap((i) => (twins[i] >= 0 ? [i, twins[i]] : [i])))].sort((a, b) => a - b);
  if (mode === 'copy' && (items.length + indices.length * count > 200 || steps.length + count > 300)) throw Error('This layout would make more than 200 features or 300 steps.');
  // The other side of a pair moves the other way across.
  const deltaOf = (i, n) => {
    const d = delta.map((v) => v * n);
    if (twins[i] >= 0 && items[i].at[1] < 0) d[1] = -d[1];
    return d;
  };
  const next = structuredClone(steps),
    step = next.find((s) => s.id === id);
  if (source.type === 'addpart') {
    if (mode === 'move') step.params.place = translate(items[0], source.type, delta);
    else {
      const copies = Array.from({ length: count }, (_, i) => {
        const copy = structuredClone(source);
        copy.id = newId();
        copy.editor = { ...copy.editor, name: `${stepName(source)} copy ${i + 1}`.slice(0, 80) };
        copy.params.place = translate(items[0], source.type, delta.map((v) => v * (i + 1)));
        return copy;
      });
      next.splice(next.indexOf(step) + 1, 0, ...copies);
    }
  } else {
    const key = LAYOUT_KEYS[source.type];
    if (mode === 'move') for (const i of indices) step.params[key][i] = translate(items[i], source.type, deltaOf(i, 1));
    else
      for (let n = 1; n <= count; n++)
        for (const i of indices) {
          const copy = translate(items[i], source.type, deltaOf(i, n));
          if (Object.hasOwn(copy, 'id')) copy.id = newId();
          if (copy.name) copy.name += ` copy ${n}`;
          step.params[key].push(copy);
        }
  }
  return next;
}

// ------------------------------------------------------------ body shaping

// Steps a new shaping step goes before: the shell and everything fitted to it,
// so walls, arches, openings and details are made on the shaped body.
const AFTER_SHAPING = new Set(['floor', 'hollow', 'hammer', 'arches', 'guidecut', 'windows', 'posts', 'mounts', 'lights', 'panellines', 'text', 'interior', 'addpart']);

// A new step list with the shaping added, or the edited step changed in place.
export function shapeSteps(steps, params, editingId = null) {
  checkBodyShape(params);
  const next = structuredClone(steps),
    existing = next.find((s) => s.id === editingId && s.type === 'bodyshape');
  if (existing) {
    existing.params = { ...params };
    return next;
  }
  const step = { id: newId(), type: 'bodyshape', enabled: true, params: { ...params } };
  const at = next.findIndex((s) => AFTER_SHAPING.has(s.type));
  next.splice(at < 0 ? next.length : at, 0, step);
  return next;
}
