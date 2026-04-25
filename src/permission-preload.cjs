const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('perm', {
  onData: (cb) => ipcRenderer.on('perm:data', (_, data) => cb(data)),
  decide: (payload) => ipcRenderer.send('perm:decide', payload),
})
