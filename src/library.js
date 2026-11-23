// The library in the app: SQLite (sql.js) loaded only when first needed,
// and its database file kept in this computer's browser storage.
import { openLibrary } from './library-db.js';

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

let open = null;
// The open library database (created empty the first time).
export async function library() {
  if (open) return open;
  const [SQL, bytes] = await Promise.all([sqlite(), idb('readonly', (s) => s.get(KEY))]);
  open = openLibrary(SQL, bytes ? new Uint8Array(bytes) : null);
  return open;
}

// Run a change and store the database.
export async function changeLibrary(fn) {
  const db = await library();
  const out = fn(db);
  const bytes = db.export();
  await idb('readwrite', (s) => s.put(bytes, KEY));
  return out;
}
