'use strict';
// Runs in the sandboxed page before Anvil's own code. No file access:
// the page opens and saves files through the browser's own file handling.
const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld(
  'slotforgeDesktop',
  Object.freeze({ desktop: true, platform: process.platform }),
);
