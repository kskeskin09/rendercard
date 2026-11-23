const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('rendercardDesktop', {
  setDocumentDirty: dirty => ipcRenderer.send('rendercard:document-dirty', dirty),
  openProject: () => ipcRenderer.invoke('rendercard:open-project'),
  saveProject: (handle, bytes, saveAs) => ipcRenderer.invoke('rendercard:save-project', handle, bytes, saveAs),
  saveFile: (name, bytes) =>
    ipcRenderer.invoke('rendercard:save-file', name, bytes)
});
