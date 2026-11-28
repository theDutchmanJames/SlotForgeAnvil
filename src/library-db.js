// Anvil's library: one SQLite database. It holds chassis and your own post
// types; tyres, presets and rule sets join it later. These functions take an open
// sql.js database, so the same code runs in the app and in Node tests.

export const LIBRARY_VERSION = 1;
export const CHASSIS_FORMAT = 'slotforge-anvil-chassis';

const SCHEMA = [
  'CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL)',
  // data: the chassis numbers as JSON. stl: the chassis's own file, if it has one.
  'CREATE TABLE IF NOT EXISTS chassis (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, data TEXT NOT NULL, stl BLOB, stl_name TEXT, updated INTEGER NOT NULL)',
  // Your own post types (the post editor). data: the sizes as JSON.
  'CREATE TABLE IF NOT EXISTS post_types (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, data TEXT NOT NULL, updated INTEGER NOT NULL)',
  // Add-on parts (wings, scoops, drivers): their STL and how they were last placed.
  'CREATE TABLE IF NOT EXISTS parts (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, stl BLOB NOT NULL, stl_name TEXT NOT NULL, data TEXT NOT NULL, updated INTEGER NOT NULL)',
  // Folders, also empty ones. root: '' for the library itself (inside Anvil,
  // or the folder on disk it is kept in), or an extra folder on disk.
  'CREATE TABLE IF NOT EXISTS folders (root TEXT NOT NULL, path TEXT NOT NULL, PRIMARY KEY (root, path))',
  // Files and folders on disk to take away at the next write (removed or moved).
  'CREATE TABLE IF NOT EXISTS gone (root TEXT NOT NULL, rel TEXT NOT NULL, dir INTEGER NOT NULL, PRIMARY KEY (root, rel))',
];

// Where each chassis and part is: root and folder (see folders); file: its
// file on disk ("root" + newline + path), fstamp: that file's time when last
// read or written; dirty: changed since it was last written to disk.
const PLACE_COLUMNS = [
  ['root', "TEXT NOT NULL DEFAULT ''"],
  ['folder', "TEXT NOT NULL DEFAULT ''"],
  ['file', 'TEXT'],
  ['fstamp', 'REAL'],
  ['dirty', 'INTEGER NOT NULL DEFAULT 1'],
];
export const ITEM_TABLES = { chassis: 'chassis', parts: 'parts' };

export function openLibrary(SQL, bytes) {
  const db = bytes ? new SQL.Database(bytes) : new SQL.Database();
  for (const s of SCHEMA) db.run(s);
  // Libraries from before folders: their chassis and parts get the columns.
  for (const table of Object.values(ITEM_TABLES)) {
    const have = new Set((db.exec(`PRAGMA table_info(${table})`)[0]?.values ?? []).map((r) => r[1]));
    for (const [name, type] of PLACE_COLUMNS) if (!have.has(name)) db.run(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`);
  }
  const v = db.exec("SELECT value FROM meta WHERE key = 'version'")[0]?.values[0]?.[0];
  if (v && Number(v) > LIBRARY_VERSION) {
    db.close();
    throw Error('This library was made by a newer Anvil. Update Anvil to use it.');
  }
  db.run("INSERT OR REPLACE INTO meta (key, value) VALUES ('version', ?)", [String(LIBRARY_VERSION)]);
  return db;
}

const newId = () => `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

// The numbers of a chassis, without where it sits in one particular body.
export function chassisData(c) {
  const { stl, libId, libRoot, libFolder, ...rest } = c;
  return { ...rest, stl: stl ? { fileName: stl.fileName, flip: !!stl.flip } : undefined };
}

export function listChassis(db) {
  const rows = db.exec('SELECT id, name, data, stl_name, updated, root, folder FROM chassis ORDER BY name COLLATE NOCASE')[0];
  return (rows?.values ?? []).map(([id, name, data, stlName, updated, root, folder]) => ({
    id,
    name,
    data: JSON.parse(data),
    stlName: stlName ?? null,
    updated,
    root,
    folder,
  }));
}

export function readChassisStl(db, id) {
  const r = db.exec('SELECT stl FROM chassis WHERE id = ?', [id])[0];
  return r?.values[0]?.[0] ?? null;
}

// Saves a new chassis, or replaces the one with this id.
export function saveChassis(db, chassis, stlBytes = null, id = null) {
  const data = chassisData(chassis);
  const name = String(chassis.name || 'My chassis').trim() || 'My chassis';
  const key = id ?? newId();
  // A chassis saved again stays where it is.
  const [root, folder, file, fstamp] = (id && db.exec('SELECT root, folder, file, fstamp FROM chassis WHERE id = ?', [id])[0]?.values[0]) || [chassis.libRoot ?? '', chassis.libFolder ?? '', null, null];
  db.run('INSERT OR REPLACE INTO chassis (id, name, data, stl, stl_name, updated, root, folder, file, fstamp, dirty) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)', [
    key,
    name,
    JSON.stringify({ ...data, name }),
    stlBytes ? new Uint8Array(stlBytes) : null,
    stlBytes ? (chassis.stl?.fileName ?? 'chassis.stl') : null,
    Date.now(),
    root,
    folder,
    file,
    fstamp,
  ]);
  return key;
}

export function renameChassis(db, id, name) {
  const row = listChassis(db).find((c) => c.id === id);
  if (!row) return;
  db.run('UPDATE chassis SET name = ?, data = ?, updated = ?, dirty = 1 WHERE id = ?', [name, JSON.stringify({ ...row.data, name }), Date.now(), id]);
}

export function deleteChassis(db, id) {
  forget(db, 'chassis', id);
  db.run('DELETE FROM chassis WHERE id = ?', [id]);
}

// ------------------------------------------------------------ post types

const POST_FIELDS = ['kind', 'outer', 'hole', 'depth', 'fillet'];
export function listPostTypes(db) {
  const rows = db.exec('SELECT id, name, data FROM post_types ORDER BY name COLLATE NOCASE')[0];
  return (rows?.values ?? []).map(([id, name, data]) => ({ id, ...JSON.parse(data), name }));
}
export function savePostType(db, t, id = null) {
  const name = String(t.name || 'My post').trim() || 'My post';
  const data = Object.fromEntries(POST_FIELDS.map((k) => [k, t[k]]));
  const key = id ?? `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  db.run('INSERT OR REPLACE INTO post_types (id, name, data, updated) VALUES (?, ?, ?, ?)', [key, name, JSON.stringify(data), Date.now()]);
  return key;
}
export function deletePostType(db, id) {
  db.run('DELETE FROM post_types WHERE id = ?', [id]);
}

// ------------------------------------------------------------ add-on parts

export function listParts(db) {
  const rows = db.exec('SELECT id, name, stl_name, data, root, folder FROM parts ORDER BY name COLLATE NOCASE')[0];
  return (rows?.values ?? []).map(([id, name, stlName, data, root, folder]) => ({ id, name, stlName, data: JSON.parse(data), root, folder }));
}
export function readPartStl(db, id) {
  return db.exec('SELECT stl FROM parts WHERE id = ?', [id])[0]?.values[0]?.[0] ?? null;
}
export function savePart(db, { name, fileName, bytes, place = {}, root = '', folder = '' }) {
  const id = `a${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  db.run('INSERT INTO parts (id, name, stl, stl_name, data, updated, root, folder, dirty) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)', [
    id,
    String(name || 'Part').trim() || 'Part',
    new Uint8Array(bytes),
    fileName || 'part.stl',
    JSON.stringify({ place }),
    Date.now(),
    root,
    folder,
  ]);
  return id;
}
export function deletePart(db, id) {
  forget(db, 'parts', id);
  db.run('DELETE FROM parts WHERE id = ?', [id]);
}

// ------------------------------------------------------------ folders

// A file kept on disk goes from there too, at the next write.
function forget(db, kind, id) {
  const file = db.exec(`SELECT file FROM ${ITEM_TABLES[kind]} WHERE id = ?`, [id])[0]?.values[0]?.[0];
  if (file) {
    const [root, rel] = file.split('\n');
    db.run('INSERT OR REPLACE INTO gone (root, rel, dir) VALUES (?, ?, 0)', [root, rel]);
  }
}

// A folder's name as typed: one level, no characters a file system refuses.
export function folderName(name) {
  const n = String(name ?? '').trim().replace(/\s+/g, ' ');
  if (!n) throw Error('Give the folder a name.');
  if (/[\\/:*?"<>|]/.test(n) || n === '.' || n === '..' || /^[. ]|[. ]$/.test(n)) throw Error('A folder name cannot have \\ / : * ? " < > | in it, or start or end with a dot.');
  if (n.length > 80) throw Error('That folder name is too long.');
  return n;
}
const joinPath = (a, b) => (a ? `${a}/${b}` : b);
const parentOf = (p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');

// Every folder: the empty ones and those things are in, with the folders round them.
export function listFolders(db) {
  const seen = new Map();
  const add = (root, path) => {
    for (let p = path; p; p = parentOf(p)) seen.set(`${root}\n${p}`, { root, path: p });
  };
  for (const [root, path] of db.exec('SELECT root, path FROM folders')[0]?.values ?? []) add(root, path);
  for (const table of Object.values(ITEM_TABLES)) for (const [root, folder] of db.exec(`SELECT DISTINCT root, folder FROM ${table}`)[0]?.values ?? []) add(root, folder);
  return [...seen.values()].sort((a, b) => a.root.localeCompare(b.root) || a.path.localeCompare(b.path, undefined, { sensitivity: 'base' }));
}

export function addFolder(db, root, parent, name) {
  const path = joinPath(parent, folderName(name));
  db.run('INSERT OR IGNORE INTO folders (root, path) VALUES (?, ?)', [root, path]);
  return path;
}

export function moveToFolder(db, kind, id, folder) {
  db.run(`UPDATE ${ITEM_TABLES[kind]} SET folder = ?, dirty = 1 WHERE id = ?`, [folder, id]);
}

// Everything in folder `from` and below it moves to `to` (merging with what
// is there). Its folder on disk is taken away once empty.
function moveFolder(db, root, from, to) {
  const under = `folder = ? OR substr(folder, 1, ?) = ?`;
  const args = [from, from.length + 1, `${from}/`];
  const re = (p) => to + p.slice(from.length);
  for (const table of Object.values(ITEM_TABLES)) {
    const rows = db.exec(`SELECT id, folder FROM ${table} WHERE root = ? AND (${under})`, [root, ...args])[0]?.values ?? [];
    for (const [id, folder] of rows) db.run(`UPDATE ${table} SET folder = ?, dirty = 1 WHERE id = ?`, [re(folder).replace(/^\//, ''), id]);
  }
  const dirs = db.exec(`SELECT path FROM folders WHERE root = ? AND (path = ? OR substr(path, 1, ?) = ?)`, [root, ...args])[0]?.values.map((r) => r[0]) ?? [];
  for (const d of dirs) {
    db.run('DELETE FROM folders WHERE root = ? AND path = ?', [root, d]);
    const n = re(d).replace(/^\//, '');
    if (n) db.run('INSERT OR IGNORE INTO folders (root, path) VALUES (?, ?)', [root, n]);
  }
  db.run('INSERT OR REPLACE INTO gone (root, rel, dir) VALUES (?, ?, 1)', [root, from]);
}

export function renameFolder(db, root, path, name) {
  const to = joinPath(parentOf(path), folderName(name));
  if (to !== path) moveFolder(db, root, path, to);
  return to;
}

// Removing a folder keeps what is in it: that moves up one level.
export function removeFolder(db, root, path) {
  moveFolder(db, root, path, parentOf(path));
}

// ------------------------------------------------------------ sharing one chassis as a file

const toBase64 = (bytes) => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
const fromBase64 = (text) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

export function encodeChassisFile(chassis, stlBytes = null) {
  return JSON.stringify({
    format: CHASSIS_FORMAT,
    version: 1,
    chassis: chassisData(chassis),
    stl: stlBytes ? toBase64(new Uint8Array(stlBytes)) : null,
  });
}

export function decodeChassisFile(text) {
  let d;
  try {
    d = JSON.parse(text);
  } catch {
    throw Error('This is not an Anvil chassis file.');
  }
  if (d?.format !== CHASSIS_FORMAT || typeof d.chassis !== 'object') throw Error('This is not an Anvil chassis file.');
  if (!(d.version <= 1)) throw Error('This chassis was made by a newer Anvil. Update Anvil to open it.');
  const c = d.chassis;
  for (const k of ['wheelbase', 'clearance']) if (!Number.isFinite(c[k])) throw Error('This chassis file is damaged.');
  for (const k of ['front', 'rear'])
    if (!['diameter', 'width', 'inOut'].every((f) => Number.isFinite(c[k]?.[f]))) throw Error('This chassis file is damaged.');
  return { chassis: c, stl: d.stl ? fromBase64(d.stl) : null };
}
