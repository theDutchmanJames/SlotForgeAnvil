'use strict';
// Runs in the sandboxed page before Anvil's own code. It offers the update
// check (Settings → Updates and the update window) and the library folders
// (Settings → Library): chassis and STL files inside folders the user picked,
// nothing else. Other files are opened and saved through the browser's own
// file handling.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld(
  'slotforgeDesktop',
  Object.freeze({
    desktop: true,
    platform: process.platform,
    // Update check; resolves to { ok, value } or { error }.
    updateCheck: (action, payload) => ipcRenderer.invoke('update:action', String(action), payload),
    onUpdateChange: callback => ipcRenderer.on('update:changed', () => callback()),
    // Library folders; resolves to { ok, value } or { error }.
    library: (action, payload) => ipcRenderer.invoke('library:action', String(action), payload),
  }),
);
