import { app, BrowserWindow, ipcMain, screen, Menu, shell } from 'electron'
import { exec } from 'child_process'
import { writeFileSync, unlinkSync } from 'fs'
import os from 'os'
import { createServer } from './server.js'
import { loadPrefs, savePrefs } from './prefs.js'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const PET_SIZE = 112   // 20% 축소 (140 → 112)

let mainWindow       = null
let permissionWindow = null
let prefs            = {}

app.whenReady().then(async () => {
  prefs = loadPrefs()
  mainWindow = createPetWindow()
  createServer(mainWindow, {
    isAlwaysAllowed:    (toolName) => (loadPrefs().alwaysAllowed ?? []).includes(toolName),
    onPermissionNeeded: showPermissionWindow,
    onPermissionResolved: closePermissionWindow,
    onAutoApprove:      () => sendTerminalKeystroke('y'),
  })
})

app.on('window-all-closed', () => {
  app.quit()
})

// ── 펫 창 ────────────────────────────────────────────────────────────────────

function createPetWindow() {
  const { width: sw, height: wah } = screen.getPrimaryDisplay().workAreaSize

  const x = prefs.windowX ?? 20
  const y = wah - PET_SIZE

  console.log(`[main] 화면: ${sw}x${wah}(workArea), 창: ${x},${y}, 크기: ${PET_SIZE}x${PET_SIZE}`)

  const win = new BrowserWindow({
    width: PET_SIZE,
    height: PET_SIZE,
    x,
    y,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    hasShadow: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: false,
    },
  })

  win.loadFile(path.join(__dirname, 'index.html'))
  win.setAlwaysOnTop(true, 'screen-saver')
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

  win.once('ready-to-show', () => { win.show() })

  win.on('moved', () => {
    const [wx] = win.getPosition()
    savePrefs({ ...loadPrefs(), windowX: wx })
  })

  return win
}

// ── Permission 팝업 창 ─────────────────────────────────────────────────────

function showPermissionWindow(toolInfo) {
  // 이미 열려 있으면 데이터만 갱신
  if (permissionWindow && !permissionWindow.isDestroyed()) {
    permissionWindow.webContents.send('perm:data', toolInfo)
    permissionWindow.show()
    return
  }

  const { width: sw, height: wah } = screen.getPrimaryDisplay().workAreaSize
  const popW = 200, popH = 62
  const petX  = (loadPrefs().windowX ?? 20)

  // 팝업 위치: 캐릭터 머리 바로 위 5px
  // 캐릭터 SVG(96px)는 창(112px) 하단 정렬 → 머리 위치 = wah - 96
  const charTop = wah - 96
  const py = Math.max(10, charTop - popH - 5)

  // X: 캐릭터 중앙 기준 팝업 중앙 정렬
  let px = Math.round(petX + PET_SIZE / 2 - popW / 2)
  px = Math.max(10, Math.min(px, sw - popW - 10))

  permissionWindow = new BrowserWindow({
    width: popW,
    height: popH,
    x: px,
    y: py,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    hasShadow: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'permission-preload.cjs'),
      contextIsolation: true,
      sandbox: false,
    },
  })

  permissionWindow.loadFile(path.join(__dirname, 'permission.html'))
  permissionWindow.setAlwaysOnTop(true, 'screen-saver')
  permissionWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

  permissionWindow.webContents.on('did-finish-load', () => {
    permissionWindow.webContents.send('perm:data', toolInfo)
    permissionWindow.show()
  })

  permissionWindow.on('closed', () => { permissionWindow = null })
}

function closePermissionWindow() {
  if (permissionWindow && !permissionWindow.isDestroyed()) {
    permissionWindow.close()
    permissionWindow = null
  }
}

// ── Permission 결정 처리 ──────────────────────────────────────────────────

ipcMain.on('perm:decide', (_, { decision, toolName }) => {
  if (decision === 'always') {
    // prefs에 항상 허용 목록 추가
    const p = loadPrefs()
    const list = p.alwaysAllowed ?? []
    if (toolName && !list.includes(toolName)) {
      savePrefs({ ...p, alwaysAllowed: [...list, toolName] })
      console.log(`[main] 항상 허용 추가: ${toolName}`)
    }
  }

  if (decision === 'allow' || decision === 'always') {
    sendTerminalKeystroke('y')
  } else if (decision === 'deny') {
    sendTerminalKeystroke('n')
  }
  // 'dismiss': 키 입력 없이 팝업만 닫기

  closePermissionWindow()
})

// ── AppleScript로 터미널에 키 입력 전송 ──────────────────────────────────

function sendTerminalKeystroke(key) {
  const script = `set termNames to {"Terminal", "iTerm2", "iTerm", "Warp", "Alacritty", "kitty", "Hyper"}
tell application "System Events"
  repeat with tName in termNames
    try
      if exists process tName then
        set frontmost of process tName to true
        delay 0.25
        keystroke "${key}"
        key code 36
        return
      end if
    end try
  end repeat
end tell`

  const tmp = path.join(os.tmpdir(), 'cc-pet-key.applescript')
  try {
    writeFileSync(tmp, script, 'utf8')
    exec(`osascript "${tmp}"`, (err) => {
      try { unlinkSync(tmp) } catch {}
      if (err) console.warn('[main] keystroke 실패 (접근성 권한 필요):', err.message)
    })
  } catch (e) {
    console.warn('[main] AppleScript 실패:', e.message)
  }
}

// ── IPC: 렌더러 → 메인 ───────────────────────────────────────────────────

ipcMain.on('pet:set-state', (_, state) => {
  mainWindow?.webContents.send('pet:state-changed', state)
})

ipcMain.on('pet:show-context-menu', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  const menu = Menu.buildFromTemplate([
    { label: '종료', click: () => app.quit() },
  ])
  menu.popup({ window: win })
})

ipcMain.on('pet:open-claude', () => {
  shell.openPath('/Applications/Claude.app').then(err => {
    if (err) shell.openExternal('https://claude.ai')
  })
})
