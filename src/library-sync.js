// The library kept in folders on disk (desktop app, Settings → Library).
// The library database stays the working copy; this keeps it and the files
// in step. Each chassis is a .anvilchassis file and each add-on part an STL,
// in sub-folders matching the library's folders.
//   pull: what changed on disk comes in (new, changed and removed files).
//   push: what changed in the library goes out (written, moved, removed).
// disk: { scan, read, write, remove, mkdir, rmdir } (see desktop/library-folders.cjs).
// config: { main: folder or null, extra: [folders] }. A chassis or part with
// root '' is in the library itself: in config.main when that is set.
import { decodeChassisFile, encodeChassisFile, ITEM_TABLES } from './library-db.js';

const EXT = { chassis: '.anvilchassis', parts: '.stl' };
const kindOf = (rel) => (rel.toLowerCase().endsWith('.anvilchassis') ? 'chassis' : rel.toLowerCase().endsWith('.stl') ? 'parts' : null);
const dirOf = (rel) => (rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '');
const baseName = (rel) => rel.slice(rel.lastIndexOf('/') + 1).replace(/\.[^.]+$/, '');
const fileKey = (abs, rel) => `${abs}\n${rel}`;
const safeName = (name) => String(name).replace(/[\\/:*?"<>|]+/g, '-').replace(/^[. ]+|[. ]+$/g, '').slice(0, 100) || 'Untitled';
const newId = (k) => `${k === 'chassis' ? 'c' : 'a'}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
const rows = (db, sql, args = []) => db.exec(sql, args)[0]?.values ?? [];

// The folder on disk for a library root ('' → config.main), or null.
export function rootPath(config, root) {
  if (root === '') return config.main ?? null;
  return config.extra.includes(root) ? root : null;
}
// The library root for a folder on disk.
const libRoot = (config, abs) => (abs === config.main ? '' : abs);

function readItem(kind, rel, bytes) {
  if (kind === 'chassis') {
    const { chassis, stl } = decodeChassisFile(new TextDecoder().decode(bytes));
    const name = String(chassis.name || baseName(rel)).trim() || baseName(rel);
    return { name, data: JSON.stringify({ ...chassis, name }), stl: stl ?? null, stlName: stl ? (chassis.stl?.fileName ?? 'chassis.stl') : null };
  }
  return { name: baseName(rel), data: JSON.stringify({ place: {} }), stl: bytes, stlName: rel.slice(rel.lastIndexOf('/') + 1) };
}

// What changed on disk comes into the library. Returns what it did.
export async function pull(db, disk, config) {
  const done = { added: 0, changed: 0, removed: 0, unreadable: [] };
  const roots = [config.main, ...config.extra].filter(Boolean);
  // Back inside Anvil: things stay, without their files; extra folders no
  // longer in the list go, with what came from them.
  for (const table of Object.values(ITEM_TABLES)) {
    if (!config.main) db.run(`UPDATE ${table} SET file = NULL, fstamp = NULL, dirty = 1 WHERE root = '' AND file IS NOT NULL`);
    for (const [id, root] of rows(db, `SELECT id, root FROM ${table} WHERE root != ''`)) if (!config.extra.includes(root)) db.run(`DELETE FROM ${table} WHERE id = ?`, [id]);
  }
  for (const [root] of rows(db, "SELECT DISTINCT root FROM folders WHERE root != ''")) if (!config.extra.includes(root)) db.run('DELETE FROM folders WHERE root = ?', [root]);
  if (!roots.length) return done;

  const { files, dirs, missing = [] } = await disk.scan();
  const seen = new Set(files.map((f) => fileKey(f.root, f.rel)));
  // Files that went: so do their chassis and parts (unless changed here since).
  for (const table of Object.values(ITEM_TABLES))
    for (const [id, file, dirty] of rows(db, `SELECT id, file, dirty FROM ${table} WHERE file IS NOT NULL`)) {
      const abs = file.slice(0, file.indexOf('\n'));
      if (seen.has(file) || missing.includes(abs) || !roots.includes(abs)) continue;
      if (dirty) db.run(`UPDATE ${table} SET file = NULL, fstamp = NULL WHERE id = ?`, [id]);
      else {
        db.run(`DELETE FROM ${table} WHERE id = ?`, [id]);
        done.removed++;
      }
    }
  for (const f of files) {
    const kind = kindOf(f.rel);
    if (!kind) continue;
    const table = ITEM_TABLES[kind], key = fileKey(f.root, f.rel);
    const [hit] = rows(db, `SELECT id, fstamp, dirty FROM ${table} WHERE file = ?`, [key]);
    if (hit && (hit[1] === f.mtime || hit[2])) continue;
    let item;
    try {
      item = readItem(kind, f.rel, await disk.read(f.root, f.rel));
    } catch {
      done.unreadable.push(f.rel);
      continue;
    }
    const root = libRoot(config, f.root), folder = dirOf(f.rel);
    if (hit) {
      db.run(`UPDATE ${table} SET name = ?, data = ?, stl = ?, stl_name = ?, folder = ?, fstamp = ?, updated = ? WHERE id = ?`, [item.name, item.data, item.stl, item.stlName, folder, f.mtime, Date.now(), hit[0]]);
      done.changed++;
    } else {
      db.run(`INSERT INTO ${table} (id, name, data, stl, stl_name, updated, root, folder, file, fstamp, dirty) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`, [
        newId(kind), item.name, item.data, item.stl ?? (kind === 'parts' ? new Uint8Array() : null), item.stlName ?? (kind === 'parts' ? 'part.stl' : null), Date.now(), root, folder, key, f.mtime,
      ]);
      done.added++;
    }
  }
  // Folders on disk are folders in the library; ones gone from disk go.
  const onDisk = new Set(dirs.map((d) => `${libRoot(config, d.root)}\n${d.rel}`));
  for (const [root, path] of rows(db, 'SELECT root, path FROM folders')) {
    const abs = rootPath(config, root);
    if (abs && !missing.includes(abs) && !onDisk.has(`${root}\n${path}`)) db.run('DELETE FROM folders WHERE root = ? AND path = ?', [root, path]);
  }
  for (const d of dirs) db.run('INSERT OR IGNORE INTO folders (root, path) VALUES (?, ?)', [libRoot(config, d.root), d.rel]);
  return done;
}

// What changed in the library goes out to disk.
export async function push(db, disk, config) {
  // Removed and moved: their old files now, emptied folders at the end.
  const gone = async (dir) => {
    for (const [root, rel] of rows(db, 'SELECT root, rel FROM gone WHERE dir = ? ORDER BY length(rel) DESC', [dir])) {
      const abs = root.includes('/') || root.includes('\\') ? root : rootPath(config, root);
      try {
        if (abs && [config.main, ...config.extra].includes(abs)) await (dir ? disk.rmdir(abs, rel) : disk.remove(abs, rel));
      } catch {}
      db.run('DELETE FROM gone WHERE root = ? AND rel = ?', [root, rel]);
    }
  };
  await gone(0);
  for (const [root, path] of rows(db, 'SELECT root, path FROM folders')) {
    const abs = rootPath(config, root);
    if (abs) await disk.mkdir(abs, path);
  }
  for (const [kind, table] of Object.entries(ITEM_TABLES)) {
    const todo = rows(db, `SELECT id, name, data, stl, root, folder, file FROM ${table} WHERE dirty = 1 OR file IS NULL`);
    for (const [id, name, data, stl, root, folder, file] of todo) {
      const abs = rootPath(config, root);
      if (!abs) continue;
      const rel = (folder ? `${folder}/` : '') + safeName(name) + EXT[kind];
      const old = file ? { abs: file.slice(0, file.indexOf('\n')), rel: file.slice(file.indexOf('\n') + 1) } : null;
      const same = old && old.abs === abs && old.rel.toLowerCase() === rel.toLowerCase();
      const bytes = kind === 'chassis' ? new TextEncoder().encode(encodeChassisFile(JSON.parse(data), stl)) : stl;
      const out = await disk.write(abs, same ? old.rel : rel, bytes, !!same);
      // Moved or renamed in the same folder on disk: the old file goes.
      if (old && !same && old.abs === abs) await disk.remove(abs, old.rel).catch(() => {});
      db.run(`UPDATE ${table} SET file = ?, fstamp = ?, dirty = 0 WHERE id = ?`, [fileKey(abs, out.rel), out.mtime, id]);
    }
  }
  await gone(1);
}
