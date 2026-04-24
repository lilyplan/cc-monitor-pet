import { app, BrowserWindow, ipcMain, screen, Menu, shell } from 'electron'
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
  const { width: sw } = screen.getPrimaryDisplay().workAreaSize
  const { height: fh } = screen.getPrimaryDisplay().bounds  // 독 포함 전체 화면 높이

  // X만 저장 위치 사용, Y는 항상 현재 화면 최하단에 고정
  const x = prefs.windowX ?? 20
  const y = fh - 130

  console.log(`[main] 화면 크기: ${sw}x${fh}, 창 위치: ${x},${y}`)

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
    show: false,   // 렌더 완료 후 표시 (흰 배경 방지)
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: false,
    },
  })

  win.loadFile(path.join(__dirname, 'index.html'))
  win.setAlwaysOnTop(true, 'screen-saver')
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

  // 렌더링 완료 후 투명하게 표시
  win.once('ready-to-show', () => {
    win.show()
  })

  // X 위치만 저장 (Y는 항상 화면 최하단 고정)
  win.on('moved', () => {
    const [wx] = win.getPosition()
    savePrefs({ ...loadPrefs(), windowX: wx })
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

// 좌클릭 → Claude 앱 또는 claude.ai 열기
ipcMain.on('pet:open-claude', () => {
  shell.openPath('/Applications/Claude.app').then(err => {
    if (err) shell.openExternal('https://claude.ai')
  })
})
