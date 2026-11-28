'use strict';
// The library kept in folders on disk (Settings → Library). The page names
// a folder only by its full path, and only folders the user picked are used:
// every path the page sends is checked to lie inside one of them. Only
// chassis files (.anvilchassis) and STL files are read, written or removed.
const fs = require('node:fs/promises');
const path = require('node:path');

const KINDS = ['.anvilchassis', '.stl'];
const MAX_FILES = 5000;

class LibraryFolders {
  constructor(profile) {
    this.file = path.join(profile, 'library-folders.json');
    this.config = { main: null, extra: [] };
  }

  async load() {
    try {
      const c = JSON.parse(await fs.readFile(this.file, 'utf8'));
      this.config = {
        main: typeof c.main === 'string' ? c.main : null,
        extra: Array.isArray(c.extra) ? c.extra.filter((p) => typeof p === 'string') : [],
      };
    } catch {}
    return this.config;
  }

  async save() {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    await fs.writeFile(this.file, JSON.stringify(this.config, null, 2));
    return this.config;
  }

  get() {
    return this.config;
  }

  async setMain(dir) {
    this.config.main = dir ? path.resolve(dir) : null;
    this.config.extra = this.config.extra.filter((p) => p !== this.config.main);
    return this.save();
  }

  async addExtra(dir) {
    const d = path.resolve(dir);
    if (d !== this.config.main && !this.config.extra.includes(d)) this.config.extra.push(d);
    return this.save();
  }

  async forget(dir) {
    this.config.extra = this.config.extra.filter((p) => p !== dir);
    return this.save();
  }

  roots() {
    return [this.config.main, ...this.config.extra].filter(Boolean);
  }

  // The full path of rel inside root, or an error: root must be a folder the
  // user picked, and rel must stay inside it.
  inside(root, rel, file = true) {
    if (!this.roots().includes(root)) throw Error('That folder is not one of the library folders.');
    if (typeof rel !== 'string' || rel.includes('\0') || path.isAbsolute(rel) || /^[a-z]:/i.test(rel)) throw Error('Not a path in the library.');
    const full = path.resolve(root, rel);
    const back = path.relative(root, full);
    if (!back || back.startsWith('..') || path.isAbsolute(back)) throw Error('Not a path in the library.');
    if (file && !KINDS.includes(path.extname(full).toLowerCase())) throw Error('Only chassis and STL files are kept in the library.');
    return full;
  }

  // Every chassis and STL file in the folders, and every folder, with paths
  // relative to their library folder ("/" between folders).
  async scan() {
    const files = [], dirs = [], missing = [];
    for (const root of this.roots()) {
      try {
        await fs.access(root);
      } catch {
        missing.push(root);
        continue;
      }
      const walk = async (dir, rel, depth) => {
        if (depth > 8 || files.length > MAX_FILES) return;
        let list;
        try {
          list = await fs.readdir(dir, { withFileTypes: true });
        } catch {
          return;
        }
        for (const e of list) {
          if (e.name.startsWith('.')) continue;
          const r = rel ? `${rel}/${e.name}` : e.name;
          const full = path.join(dir, e.name);
          if (e.isDirectory()) {
            dirs.push({ root, rel: r });
            await walk(full, r, depth + 1);
          } else if (e.isFile() && KINDS.includes(path.extname(e.name).toLowerCase())) {
            try {
              files.push({ root, rel: r, mtime: (await fs.stat(full)).mtimeMs });
            } catch {}
          }
        }
      };
      await walk(root, '', 0);
    }
    return { files, dirs, missing };
  }

  async read(root, rel) {
    return new Uint8Array(await fs.readFile(this.inside(root, rel)));
  }

  // Writes a file; unless it replaces its own earlier file, a name already
  // taken gets " (2)" and so on. Returns where it went and its time.
  async write(root, rel, bytes, replace = false) {
    let full = this.inside(root, rel);
    await fs.mkdir(path.dirname(full), { recursive: true });
    if (!replace) {
      const ext = path.extname(full), base = full.slice(0, -ext.length);
      for (let n = 2; n < 1000; n++) {
        try {
          await fs.access(full);
        } catch {
          break;
        }
        full = `${base} (${n})${ext}`;
      }
    }
    const temp = `${full}.${process.pid}.part`;
    await fs.writeFile(temp, bytes);
    await fs.rename(temp, full);
    return { rel: path.relative(root, full).split(path.sep).join('/'), mtime: (await fs.stat(full)).mtimeMs };
  }

  async remove(root, rel) {
    try {
      await fs.unlink(this.inside(root, rel));
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
  }

  async mkdir(root, rel) {
    await fs.mkdir(this.inside(root, rel, false), { recursive: true });
  }

  // A folder goes only when nothing is left in it but empty folders.
  async removeDir(root, rel) {
    const full = this.inside(root, rel, false);
    const empty = async (dir) => {
      let list;
      try {
        list = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        return false;
      }
      for (const e of list) if (!e.isDirectory() || !(await empty(path.join(dir, e.name)))) return false;
      await fs.rmdir(dir);
      return true;
    };
    return empty(full);
  }
}

module.exports = { LibraryFolders };
