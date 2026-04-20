import { app, BrowserWindow, ipcMain, screen, Menu } from 'electron'
import { createServer } from './server.js'
import { loadPrefs, savePrefs } from './prefs.js'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

let mainWindow = null
let prefs = {}

app.whenReady().then(async () => {
  prefs = loadPrefs()
  mainWindow = createPetWindow()
  createServer(mainWindow)
})

app.on('window-all-closed', () => {
  app.quit()
})

function createPetWindow() {
  const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize

  // 저장된 위치 사용, 없으면 우측 하단 기본값
  const x = prefs.windowX ?? sw - 160
  const y = prefs.windowY ?? sh - 160

  const win = new BrowserWindow({
    width: 140,
    height: 140,
    x,
    y,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: false,
    },
  })

  win.loadFile(path.join(__dirname, 'index.html'))
  win.setAlwaysOnTop(true, 'screen-saver')
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

  // 창 이동 시 위치 저장
  win.on('moved', () => {
    const [wx, wy] = win.getPosition()
    savePrefs({ ...loadPrefs(), windowX: wx, windowY: wy })
  })

  return win
}

// 렌더러 → 메인: 상태 변경 이벤트 (서버에서 받아서 렌더러로 전달)
ipcMain.on('pet:set-state', (_, state) => {
  mainWindow?.webContents.send('pet:state-changed', state)
})

// 우클릭 컨텍스트 메뉴
ipcMain.on('pet:show-context-menu', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  const menu = Menu.buildFromTemplate([
    { label: '종료', click: () => app.quit() },
  ])
  menu.popup({ window: win })
})
