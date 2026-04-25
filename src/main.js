import { app, BrowserWindow, ipcMain, screen, Menu, shell, systemPreferences, dialog } from 'electron'
import { exec } from 'child_process'
import { writeFileSync, unlinkSync, chmodSync } from 'fs'
import crypto from 'crypto'
import os from 'os'
import { createServer } from './server.js'
import { loadPrefs, savePrefs } from './prefs.js'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const PET_SIZE   = 112
const TOKEN_PATH = path.join(os.homedir(), '.cc-monitor-pet.token')

let mainWindow       = null
let permissionWindow = null
let prefs            = {}

// ── 시작 시 랜덤 토큰 생성 (hook.js / MCP 서버가 읽어서 헤더에 포함) ──────
function generateToken() {
  const token = crypto.randomBytes(32).toString('hex')
  writeFileSync(TOKEN_PATH, token, { encoding: 'utf8', mode: 0o600 })
  try { chmodSync(TOKEN_PATH, 0o600) } catch {}   // 소유자만 읽기
  console.log('[main] 인증 토큰 생성 완료')
  return token
}

app.whenReady().then(async () => {
  const secretToken = generateToken()
  prefs = loadPrefs()
  mainWindow = createPetWindow()
  createServer(mainWindow, {
    secretToken,
    isAlwaysAllowed:      (toolName) => (loadPrefs().alwaysAllowed ?? []).includes(toolName),
    onPermissionNeeded:   showPermissionWindow,
    onPermissionResolved: closePermissionWindow,
    onAutoApprove:        () => sendTerminalKeystroke('y'),
  })
})

app.on('window-all-closed', () => {
  // 종료 시 토큰 파일 삭제
  try { unlinkSync(TOKEN_PATH) } catch {}
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
  if (permissionWindow && !permissionWindow.isDestroyed()) {
    permissionWindow.webContents.send('perm:data', toolInfo)
    permissionWindow.show()
    return
  }

  const { width: sw, height: wah } = screen.getPrimaryDisplay().workAreaSize
  const popW = 200, popH = 62
  const petX  = (loadPrefs().windowX ?? 20)

  const charTop = wah - 96
  const py = Math.max(10, charTop - popH - 5)
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
  console.log(`[main] perm:decide: ${decision} / ${toolName}`)

  if (decision === 'always') {
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

  closePermissionWindow()
})

// ── AppleScript로 터미널에 키 입력 전송 ──────────────────────────────────

function sendTerminalKeystroke(key) {
  const trusted = systemPreferences.isTrustedAccessibilityClient(false)
  console.log(`[main] Accessibility 권한: ${trusted}`)

  if (!trusted) {
    dialog.showMessageBox({
      type: 'info',
      title: 'CC Monitor Pet — 권한 필요',
      message: '터미널 자동 입력을 위해 손쉬운 사용 권한이 필요합니다.',
      detail: '시스템 설정 → 개인 정보 보호 및 보안 → 손쉬운 사용에서\n"Electron" 또는 앱을 허용한 뒤 다시 시도해주세요.',
      buttons: ['설정 열기', '닫기'],
    }).then(({ response }) => {
      if (response === 0) systemPreferences.isTrustedAccessibilityClient(true)
    })
    return
  }

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

  // 매번 랜덤 파일명으로 심볼릭링크 공격 방지
  const tmp = path.join(os.tmpdir(), `cc-pet-${crypto.randomUUID()}.applescript`)
  try {
    writeFileSync(tmp, script, { encoding: 'utf8', mode: 0o600 })
    exec(`osascript "${tmp}"`, (err) => {
      try { unlinkSync(tmp) } catch {}
      if (err) console.warn('[main] keystroke 실패:', err.message)
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
