const { contextBridge, ipcRenderer } = require('electron')
const fs   = require('fs')
const path = require('path')

// 스프라이트 디렉터리 (preload 기준 __dirname = src/)
const SPRITE_DIR = path.join(__dirname, '..', 'assets', 'themes', 'cc', 'sprites')

contextBridge.exposeInMainWorld('pet', {
  onStateChanged: (callback) => {
    ipcRenderer.on('pet:state-changed', (_, payload) => callback(payload))
  },
  showContextMenu: () => {
    ipcRenderer.send('pet:show-context-menu')
  },

  // SVG 파일을 문자열로 반환 (fetch 대신 Node.js fs 사용)
  readSprite: (name) => {
    const p = path.join(SPRITE_DIR, `${name}.svg`)
    try { return fs.readFileSync(p, 'utf8') } catch { return null }
  },

  // <object> 태그용 절대 경로 반환
  getSpriteDir: () => SPRITE_DIR,
})
