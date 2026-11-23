'use strict';
// SlotForge Anvil desktop shell. Anvil is a single offline page
// (dist/index.html, built by Vite); this shows it in its own window.
// Based on SlotForge Foundry's shell, without the update check for now.
const { app, BrowserWindow, Menu, dialog, shell, session } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const PAGE = path.join(ROOT, 'dist', 'index.html');

app.setAppUserModelId('nl.slotforge.anvil');

// Start-up test (desktop/smoke.cjs): SLOTFORGE_DESKTOP_SMOKE names a file to
// write what the page showed to, then the app quits. --portable-data-dir keeps
// the test's data in a throwaway folder.
const SMOKE = process.env.SLOTFORGE_DESKTOP_SMOKE || '';
const dataDir = process.argv.find(a => a.startsWith('--portable-data-dir='))?.slice(20);
if (dataDir) app.setPath('userData', path.resolve(dataDir, 'app-profile'));

function smokeTest(win) {
  const errors = [];
  win.webContents.on('console-message', e => {
    if (e.level === 'error') errors.push(e.message);
  });
  const write = data => {
    fs.writeFileSync(SMOKE, JSON.stringify({ version: app.getVersion(), profile: app.getPath('userData'), errors, ...data }));
    app.exit(0);
  };
  const fail = e => write({ failed: true, message: String(e?.stack || e) });
  setTimeout(() => fail('The page did not finish loading within 60 s.'), 60_000);
  win.webContents.once('did-finish-load', () =>
    setTimeout(
      () =>
        win.webContents
          .executeJavaScript(
            `({ href: location.href, brand: document.querySelector('.brand')?.textContent, menus: document.querySelectorAll('#tools [data-act=menu]').length,
                empty: !!document.querySelector('#empty'), canvas: !!document.querySelector('#view canvas'),
                desktop: window.slotforgeDesktop?.desktop === true })`,
          )
          .then(page => write({ page }), fail),
      3000,
    ),
  );
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  let win = null;
  const pageUrl = new URL('file:' + (process.platform === 'win32' ? '///' : '//') + PAGE.replaceAll('\\', '/'));
  const sameFile = url => {
    try {
      const u = new URL(url);
      return u.protocol === 'file:' && decodeURIComponent(u.pathname) === decodeURIComponent(pageUrl.pathname);
    } catch {
      return false;
    }
  };
  const external = url => {
    try {
      if (['https:', 'http:', 'mailto:'].includes(new URL(url).protocol)) shell.openExternal(url);
    } catch {}
  };

  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });
  app.on('window-all-closed', () => app.quit());

  function openWindow() {
    session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) =>
      callback(permission === 'clipboard-sanitized-write'),
    );
    win = new BrowserWindow({
      width: 1440,
      height: 900,
      minWidth: 1000,
      minHeight: 640,
      show: false,
      title: 'SlotForge Anvil',
      backgroundColor: '#171b21',
      icon: path.join(ROOT, 'desktop', 'build', process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
      autoHideMenuBar: true,
      webPreferences: {
        preload: path.join(__dirname, 'preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        spellcheck: false,
      },
    });
    win.webContents.setWindowOpenHandler(({ url }) => {
      external(url);
      return { action: 'deny' };
    });
    win.webContents.on('will-navigate', (event, url) => {
      if (!sameFile(url)) {
        event.preventDefault();
        external(url);
      }
    });
    if (SMOKE) smokeTest(win);
    win.once('ready-to-show', () => win.show());
    win.on('closed', () => {
      win = null;
    });
    win.loadFile(PAGE);
  }

  function menu() {
    const mac = process.platform === 'darwin';
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        ...(mac ? [{ role: 'appMenu' }] : [{ label: 'File', submenu: [{ role: 'quit' }] }]),
        { role: 'editMenu' },
        {
          label: 'View',
          submenu: [
            { role: 'reload' },
            { type: 'separator' },
            { role: 'resetZoom' },
            { role: 'zoomIn' },
            { role: 'zoomOut' },
            { type: 'separator' },
            { role: 'togglefullscreen' },
            { role: 'toggleDevTools' },
          ],
        },
        { role: 'windowMenu' },
      ]),
    );
  }

  app
    .whenReady()
    .then(() => {
      if (!fs.existsSync(PAGE)) {
        dialog.showErrorBox('SlotForge Anvil is incomplete', 'The app page is missing:\n' + PAGE + '\n\nRun npm run build first.');
        return app.exit(1);
      }
      menu();
      openWindow();
    })
    .catch(e => {
      dialog.showErrorBox('SlotForge Anvil could not start', e.stack || e.message);
      app.exit(1);
    });
}
