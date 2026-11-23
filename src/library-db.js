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
];

export function openLibrary(SQL, bytes) {
  const db = bytes ? new SQL.Database(bytes) : new SQL.Database();
  for (const s of SCHEMA) db.run(s);
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
  const { stl, ...rest } = c;
  return { ...rest, stl: stl ? { fileName: stl.fileName, flip: !!stl.flip } : undefined };
}

export function listChassis(db) {
  const rows = db.exec('SELECT id, name, data, stl_name, updated FROM chassis ORDER BY name COLLATE NOCASE')[0];
  return (rows?.values ?? []).map(([id, name, data, stlName, updated]) => ({
    id,
    name,
    data: JSON.parse(data),
    stlName: stlName ?? null,
    updated,
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
  db.run('INSERT OR REPLACE INTO chassis (id, name, data, stl, stl_name, updated) VALUES (?, ?, ?, ?, ?, ?)', [
    key,
    name,
    JSON.stringify({ ...data, name }),
    stlBytes ? new Uint8Array(stlBytes) : null,
    stlBytes ? (chassis.stl?.fileName ?? 'chassis.stl') : null,
    Date.now(),
  ]);
  return key;
}

export function renameChassis(db, id, name) {
  const row = listChassis(db).find((c) => c.id === id);
  if (!row) return;
  db.run('UPDATE chassis SET name = ?, data = ?, updated = ? WHERE id = ?', [name, JSON.stringify({ ...row.data, name }), Date.now(), id]);
}

export function deleteChassis(db, id) {
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
  const rows = db.exec('SELECT id, name, stl_name, data FROM parts ORDER BY name COLLATE NOCASE')[0];
  return (rows?.values ?? []).map(([id, name, stlName, data]) => ({ id, name, stlName, data: JSON.parse(data) }));
}
export function readPartStl(db, id) {
  return db.exec('SELECT stl FROM parts WHERE id = ?', [id])[0]?.values[0]?.[0] ?? null;
}
export function savePart(db, { name, fileName, bytes, place = {} }) {
  const id = `a${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  db.run('INSERT INTO parts (id, name, stl, stl_name, data, updated) VALUES (?, ?, ?, ?, ?, ?)', [
    id,
    String(name || 'Part').trim() || 'Part',
    new Uint8Array(bytes),
    fileName || 'part.stl',
    JSON.stringify({ place }),
    Date.now(),
  ]);
  return id;
}
export function deletePart(db, id) {
  db.run('DELETE FROM parts WHERE id = ?', [id]);
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
