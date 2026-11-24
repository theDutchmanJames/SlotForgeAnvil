// A project is the imported file plus the list of steps taken on it.
// Everything else (the shape you see) is rebuilt from these.

export const FORMAT = 'slotforge-anvil-project';
export const VERSION = 1;

let counter = 0;
export const newId = () => `s${Date.now().toString(36)}${(counter++).toString(36)}`;

export function newProject(fileName, bytes, guess) {
  return {
    name: fileName.replace(/\.stl$/i, '') || 'New body',
    units: 'mm',
    mirror: true,
    protect: true, // Protect the outside
    print: { ...DEFAULT_PRINT },
    chassis: null,
    chassisMesh: null, // { fileName, bytes }: a chassis STL shown as the ghost
    parts: {}, // added parts' files: { [id]: { fileName, bytes } }
    buck: null, // buck settings (the buck itself is made on request, never stored)
    source: { fileName, bytes },
    steps: [{ id: newId(), type: 'orient', enabled: true, params: { front: guess.front, up: guess.up, turn: guess.turn ?? 0 } }],
  };
}

// How the body will be printed: sets default walls and the weight estimate.
export const DEFAULT_PRINT = { process: 'resin', material: 'resin', nozzle: 0.4 };
export const MATERIALS = {
  resin: { name: 'Resin (standard)', density: 1.15, process: 'resin' },
  tough: { name: 'Resin (tough / ABS-like)', density: 1.12, process: 'resin' },
  pla: { name: 'PLA', density: 1.24, process: 'fdm' },
  petg: { name: 'PETG', density: 1.27, process: 'fdm' },
  abs: { name: 'ABS / ASA', density: 1.05, process: 'fdm' },
};
export const PRINT_WALLS = {
  resin: { wall: 1.0, top: 0.7, min: 0.6 },
  fdm: { wall: 1.2, top: 0.8, min: 0.8 },
};

export const STEP_NAMES = {
  orient: 'Orient',
  scale: 'Scale',
  slice: 'Slice',
  cutoff: 'Cut off',
  delete: 'Delete selection',
  floor: 'Floor line',
  hollow: 'Hollow',
  hammer: 'Hammer',
  stretch: 'Stretch',
  arches: 'Wheel arches',
  posts: 'Posts',
  windows: 'Windows',
  smooth: 'Smooth',
  addpart: 'Add part',
  repair: 'Light fix',
  fill: 'Close openings',
  reduce: 'Reduce',
};

// ------------------------------------------------------------ units

export function fmtLen(mm, units, digits) {
  if (!Number.isFinite(mm)) return '–';
  if (units === 'in') return `${(mm / 25.4).toFixed(digits ?? 3)} in`;
  return `${mm.toFixed(digits ?? (Math.abs(mm) >= 100 ? 1 : 2))} mm`;
}
export const toUnits = (mm, units) => (units === 'in' ? mm / 25.4 : mm);
export const fromUnits = (v, units) => (units === 'in' ? v * 25.4 : v);

// ------------------------------------------------------------ undo / redo

export function createHistory(limit = 60) {
  const past = [],
    future = [];
  return {
    push(state) {
      past.push(state);
      if (past.length > limit) past.shift();
      future.length = 0;
    },
    undo(current) {
      if (!past.length) return null;
      future.push(current);
      return past.pop();
    },
    redo(current) {
      if (!future.length) return null;
      past.push(current);
      return future.pop();
    },
    clear() {
      past.length = future.length = 0;
    },
    get canUndo() {
      return past.length > 0;
    },
    get canRedo() {
      return future.length > 0;
    },
  };
}

// What undo restores: everything except the imported file.
export const snapshot = (p) =>
  JSON.stringify({ name: p.name, units: p.units, mirror: p.mirror, protect: p.protect !== false, print: p.print, chassis: p.chassis ?? null, buck: p.buck ?? null, steps: p.steps });
export function restore(project, snap) {
  const s = JSON.parse(snap);
  return { ...project, name: s.name, units: s.units, mirror: s.mirror, protect: s.protect !== false, print: s.print ?? { ...DEFAULT_PRINT }, chassis: s.chassis ?? null, buck: s.buck ?? null, steps: s.steps };
}

// ------------------------------------------------------------ project files

function toBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000)
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function fromBase64(text) {
  const s = atob(text);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export function encodeProjectFile(p) {
  return JSON.stringify({
    format: FORMAT,
    version: VERSION,
    name: p.name,
    units: p.units,
    mirror: p.mirror,
    protect: p.protect !== false,
    print: p.print,
    chassis: p.chassis ?? null,
    buck: p.buck ?? null,
    parts: Object.fromEntries(Object.entries(p.parts ?? {}).map(([id, f]) => [id, { fileName: f.fileName, stl: toBase64(new Uint8Array(f.bytes)) }])),
    chassisMesh: p.chassisMesh ? { fileName: p.chassisMesh.fileName, stl: toBase64(new Uint8Array(p.chassisMesh.bytes)) } : null,
    source: { fileName: p.source.fileName, stl: toBase64(new Uint8Array(p.source.bytes)) },
    steps: p.steps,
  });
}

export function decodeProjectFile(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw Error('This is not an Anvil project file.');
  }
  if (data?.format !== FORMAT) throw Error('This is not an Anvil project file.');
  if (!(data.version <= VERSION)) throw Error('This project was made by a newer Anvil. Update Anvil to open it.');
  if (!Array.isArray(data.steps) || typeof data.source?.stl !== 'string')
    throw Error('This project file is damaged.');
  return {
    name: String(data.name || 'Body'),
    units: data.units === 'in' ? 'in' : 'mm',
    mirror: data.mirror !== false,
    protect: data.protect !== false,
    print: { ...DEFAULT_PRINT, ...(data.print ?? {}) },
    chassis: data.chassis ?? null,
    buck: data.buck ?? null,
    parts: Object.fromEntries(Object.entries(data.parts ?? {}).map(([id, f]) => [id, { fileName: String(f.fileName || 'part.stl'), bytes: fromBase64(f.stl).buffer }])),
    chassisMesh: data.chassisMesh?.stl ? { fileName: String(data.chassisMesh.fileName || 'chassis.stl'), bytes: fromBase64(data.chassisMesh.stl).buffer } : null,
    source: { fileName: String(data.source.fileName || 'model.stl'), bytes: fromBase64(data.source.stl).buffer },
    steps: data.steps,
  };
}

// ------------------------------------------------------------ autosave (this device)

const DB = 'slotforge-anvil',
  STORE = 'projects',
  KEY = 'current';
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function run(mode, fn) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => {
      db.close();
      resolve(req?.result);
    };
    tx.onerror = tx.onabort = () => {
      db.close();
      reject(tx.error);
    };
  });
}
export const saveLocal = (p) =>
  run('readwrite', (s) =>
    s.put(
      { name: p.name, units: p.units, mirror: p.mirror, protect: p.protect !== false, print: p.print, chassis: p.chassis ?? null, chassisMesh: p.chassisMesh ?? null, buck: p.buck ?? null, parts: p.parts ?? {}, source: p.source, steps: p.steps, saved: Date.now() },
      KEY,
    ),
  );
export const loadLocal = () => run('readonly', (s) => s.get(KEY));
export const clearLocal = () => run('readwrite', (s) => s.delete(KEY));
