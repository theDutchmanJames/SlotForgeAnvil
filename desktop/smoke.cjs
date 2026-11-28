'use strict';
// Starts the desktop app on a throwaway data folder, twice, and checks what
// the page shows: Anvil's top bar and menus, the empty "drop a model" card,
// the 3D view, the desktop bridge, no console errors, and the data folder used.
// Run after npm run build: npm run test:desktop
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const electron = require('electron');

const root = path.resolve(__dirname, '..');
if (!fs.existsSync(path.join(root, 'dist', 'index.html'))) throw Error('Run npm run build first.');
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'anvil-desktop-'));

function launch() {
  const result = path.join(data, 'smoke-' + Date.now() + '.json');
  return new Promise((resolve, reject) => {
    // SLOTFORGE_ELECTRON_ARGS adds Chromium switches, such as software WebGL on a CI machine.
    const extra = (process.env.SLOTFORGE_ELECTRON_ARGS || '').split(/\s+/).filter(Boolean);
    const child = spawn(electron, [...extra, root, '--portable-data-dir=' + data], {
      env: { ...process.env, SLOTFORGE_DESKTOP_SMOKE: result },
      stdio: 'inherit',
    });
    const timer = setTimeout(() => {
      child.kill();
      reject(Error('The desktop app did not finish within 90 s.'));
    }, 90_000);
    child.on('exit', () => {
      clearTimeout(timer);
      try {
        resolve(JSON.parse(fs.readFileSync(result, 'utf8')));
      } catch (e) {
        reject(Error('The desktop app wrote no result: ' + e.message));
      }
    });
  });
}

(async () => {
  try {
    const noWebGL = !!process.env.SLOTFORGE_NO_WEBGL_OK;
    // The second start keeps its library in a folder with a chassis file in it.
    const libDir = path.join(data, 'library');
    for (const round of ['first start', 'second start']) {
      if (round === 'second start') {
        fs.mkdirSync(path.join(libDir, 'Club'), { recursive: true });
        const chassis = { name: 'Folder chassis', frontX: 0, wheelbase: 80, clearance: 1, front: { diameter: 20, width: 8, inOut: 25 }, rear: { diameter: 20, width: 10, inOut: 25 } };
        fs.writeFileSync(path.join(libDir, 'Club', 'Folder chassis.anvilchassis'), JSON.stringify({ format: 'slotforge-anvil-chassis', version: 1, chassis, stl: null }));
        fs.writeFileSync(path.join(data, 'app-profile', 'library-folders.json'), JSON.stringify({ main: libDir, extra: [] }));
      }
      const r = await launch();
      assert.equal(r.failed, undefined, r.message);
      assert.equal(path.resolve(r.profile), path.join(data, 'app-profile'), round + ': data stays in the given folder');
      assert.equal(r.page?.brand, 'SlotForge Anvil', round + ': the top bar did not appear: ' + JSON.stringify(r.page));
      assert.equal(r.page.wordmark, 5, round + ': the app icon, wordmarks and collection marks are drawn');
      assert.equal(r.page.menus, 8, round + ': the eight tool menus are there');
      assert.ok(r.page.empty, round + ': the "drop a car model" card is there');
      assert.ok(r.page.desktop, round + ': the desktop bridge is there');
      assert.ok(r.page.updates, round + ': the update check is there');
      assert.match(r.page.href, /^file:/, round);
      // Settings → Library, and the library folders through the desktop bridge.
      assert.ok(r.page.library?.card?.includes('Kept in'), round + ': Settings shows where the library is kept: ' + JSON.stringify(r.page.library));
      if (round === 'second start') {
        assert.equal(path.resolve(r.page.library.folders.main), path.resolve(libDir), round + ': the library folder is used');
        assert.ok(r.page.library.card.includes(libDir), round + ': Settings names the library folder');
      } else assert.ok(r.page.library.card.includes('Inside Anvil'), round + ': the library starts inside Anvil');
      // SLOTFORGE_NO_WEBGL_OK: a CI machine that cannot draw 3D at all may report
      // only that; every other console error still fails.
      const errors = noWebGL ? r.errors.filter((e) => !/WebGL/i.test(String(e))) : r.errors;
      if (errors.length < r.errors.length) console.log('  (this machine cannot draw 3D; that error is allowed here)');
      else assert.ok(r.page.canvas || noWebGL, round + ': the 3D view is there');
      assert.deepEqual(errors, [], round + ': console errors');
      console.log('✓ ' + round + ': Anvil ' + r.version + ' opened from ' + r.page.href.split('/').slice(-2).join('/'));
    }
    assert.ok(fs.existsSync(path.join(data, 'app-profile')), 'the app keeps its data in the given folder');
    console.log('✓ the library and autosave are kept in the given data folder');
  } finally {
    fs.rmSync(data, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
