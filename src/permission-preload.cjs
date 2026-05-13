const { contextBridge, ipcRenderer } = require('electron')

function safe(arg) {
  if (typeof arg === 'string') return arg
  if (arg instanceof Error) return arg.stack ?? arg.message
  try { return JSON.stringify(arg) } catch { return String(arg) }
}

function forward(level, args) {
  try { ipcRenderer.send('perm:log', { level, args: args.map(safe) }) } catch {}
}

contextBridge.exposeInMainWorld('perm', {
  onData: (cb) => ipcRenderer.on('perm:data', (_, data) => cb(data)),
  decide: (payload) => ipcRenderer.send('perm:decide', payload),

  // Forward arbitrary renderer logs into the main-process log file.
  log:  (...a) => forward('log',  a),
  warn: (...a) => forward('warn', a),
  err:  (...a) => forward('error', a),
})
