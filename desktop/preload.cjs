const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('rendercardDesktop', {
  setDocumentDirty: dirty => ipcRenderer.send('rendercard:document-dirty', dirty),
  saveFile: (name, bytes) =>
    ipcRenderer.invoke('rendercard:save-file', name, bytes)
});
