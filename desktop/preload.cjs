const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('rendercardDesktop', {
  saveFile: (name, bytes) =>
    ipcRenderer.invoke('rendercard:save-file', name, bytes)
});
