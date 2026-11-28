// The library in the app: SQLite (sql.js) loaded only when first needed,
// and its database file kept in this computer's browser storage.
import { openLibrary } from './library-db.js';
import { pull, push } from './library-sync.js';

let sqliteLoad = null;
function sqlite() {
  // Vite embeds the browser build and its WASM in the single page.
  sqliteLoad ??= Promise.all([import('sql.js/dist/sql-wasm-browser.js'), import('sql.js/dist/sql-wasm-browser.wasm?url&inline')])
    .then(async ([module, wasm]) => {
      const wasmBinary = new Uint8Array(await (await fetch(wasm.default)).arrayBuffer());
      return module.default({ wasmBinary });
    })
    .catch((e) => {
      sqliteLoad = null;
      throw e;
    });
  return sqliteLoad;
}

const DB = 'slotforge-anvil',
  STORE = 'projects',
  KEY = 'library';
function idb(mode, fn) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction(STORE, mode);
      const r = fn(tx.objectStore(STORE));
      tx.oncomplete = () => {
        db.close();
        resolve(r?.result);
      };
      tx.onerror = tx.onabort = () => {
        db.close();
        reject(tx.error);
      };
    };
  });
}

// The desktop app can keep the library in folders on disk (Settings → Library).
const desk = globalThis.slotforgeDesktop?.library;
async function call(action, payload) {
  const r = await desk(action, payload);
  if (r?.error) throw Error(r.error);
  return r?.value;
}
const disk = desk && {
  scan: () => call('scan'),
  read: (root, rel) => call('read', { root, rel }),
  write: (root, rel, bytes, replace) => call('write', { root, rel, bytes, replace }),
  remove: (root, rel) => call('remove', { root, rel }),
  mkdir: (root, rel) => call('mkdir', { root, rel }),
  rmdir: (root, rel) => call('rmdir', { root, rel }),
};
export const libraryOnDisk = !!desk;
// The folders: { main, extra }, or null without the desktop app.
let folders = null;
export const libraryFolders = () => folders;
// How the last look at the folders went: { at, error, unreadable }.
export const diskState = { at: 0, error: null, unreadable: [] };
const store = (db) => idb('readwrite', (s) => s.put(db.export(), KEY));

let open = null;
// The open library database (created empty the first time).
export async function library() {
  if (open) return open;
  const [SQL, bytes] = await Promise.all([sqlite(), idb('readonly', (s) => s.get(KEY))]);
  open = openLibrary(SQL, bytes ? new Uint8Array(bytes) : null);
  if (desk) {
    try {
      folders = await call('get');
    } catch (e) {
      diskState.error = e.message;
    }
    await syncLibrary();
  }
  return open;
}

// Reads the folders on disk afresh and writes out what changed here. True if
// anything came in from disk.
export async function syncLibrary() {
  if (!desk || !open || !folders) return false;
  try {
    const r = await pull(open, disk, folders);
    await push(open, disk, folders);
    await store(open);
    Object.assign(diskState, { at: Date.now(), error: null, unreadable: r.unreadable });
    return r.added + r.changed + r.removed > 0;
  } catch (e) {
    diskState.error = e.message;
    return false;
  }
}

// Settings → Library: action is 'choose-main', 'choose-extra', 'inside',
// 'forget' (with root) or 'show' (with root). Resolves to the folders, or
// null when the user closed the folder picker.
export async function changeLibraryFolders(action, payload) {
  const value = await call(action, payload);
  if (action === 'show') return folders;
  if (!value) return null;
  folders = value;
  await library();
  // Into a new folder: everything in the library is written there.
  if (action === 'choose-main') for (const t of ['chassis', 'parts']) open.run(`UPDATE ${t} SET file = NULL, fstamp = NULL, dirty = 1 WHERE root = ''`);
  await syncLibrary();
  return folders;
}

// Run a change and store the database (and write it out to disk).
export async function changeLibrary(fn) {
  const db = await library();
  const out = fn(db);
  if (desk && folders)
    await push(db, disk, folders).catch((e) => {
      diskState.error = e.message;
    });
  await store(db);
  return out;
}
