'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('player', {
  getState: () => ipcRenderer.invoke('player:get-state'),
  onState: (cb) => {
    ipcRenderer.on('player:state', (_e, patch) => cb(patch));
  },
  send: (cmd) => ipcRenderer.send('player:cmd', cmd)
});
