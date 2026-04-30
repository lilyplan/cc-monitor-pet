import { app, BrowserWindow, ipcMain, screen, Menu, shell } from 'electron'
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
let isDragging        = false
let dragBase          = null   // { winX, winY, screenX, screenY }
let resolvePermission = null   // server.js에서 주입

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
  const result = createServer(mainWindow, {
    secretToken,
    onPermissionNeeded:   showPermissionWindow,
    onPermissionResolved: closePermissionWindow,
  })
  resolvePermission = result.resolvePermission
})

app.on('window-all-closed', () => {
  // 종료 시 토큰 파일 삭제
  try { unlinkSync(TOKEN_PATH) } catch {}
  app.quit()
})

// ── 펫 창 ────────────────────────────────────────────────────────────────────

function snapToBottom(display) {
  return display.workArea.y + display.workArea.height - PET_SIZE
}

function createPetWindow() {
  const x = prefs.windowX ?? 20
  const display = screen.getDisplayNearestPoint({ x, y: 0 })
  const y = snapToBottom(display)

  console.log(`[main] 화면: ${display.bounds.width}x${display.workArea.height}(workArea), 창: ${x},${y}, 크기: ${PET_SIZE}x${PET_SIZE}`)

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
  win.setAlwaysOnTop(true, 'floating')
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

  win.once('ready-to-show', () => {
    win.setBackgroundColor('#00000000')
    win.show()

  })

  // moved 이벤트는 외부(OS)에서 창이 이동됐을 때만 스냅
  win.on('moved', () => {
    if (isDragging) return
    const [wx, wy] = win.getPosition()
    const display = screen.getDisplayNearestPoint({ x: wx, y: wy })
    win.setPosition(wx, snapToBottom(display))
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

  const popW = 200, popH = 62
  const petX = (loadPrefs().windowX ?? 20)

  // 펫이 있는 모니터 기준으로 팝업 위치 계산
  const petWinPos = mainWindow?.getPosition() ?? [petX, 0]
  const display   = screen.getDisplayNearestPoint({ x: petWinPos[0], y: petWinPos[1] })
  const { x: dx, y: dy, width: dw, height: dh } = display.workArea

  const charTop = dy + dh - 96
  const py = Math.max(dy + 10, charTop - popH - 5)
  let px = Math.round(petWinPos[0] + PET_SIZE / 2 - popW / 2)
  px = Math.max(dx + 10, Math.min(px, dx + dw - popW - 10))

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

  permissionWindow.once('ready-to-show', () => {
    if (permissionWindow && !permissionWindow.isDestroyed()) {
      permissionWindow.webContents.send('perm:data', toolInfo)
      permissionWindow.showInactive()
      permissionWindow.setAlwaysOnTop(true, 'screen-saver')
      permissionWindow.moveTop()
    }
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

ipcMain.on('perm:decide', (_, { decision, toolName, sessionId, suggestion }) => {
  console.log(`[main] perm:decide: ${decision} / ${toolName} / session=${sessionId}`)
  // suggestion: "항상 허용" 클릭 시 popup에서 전달, server.js → CC의 updatedPermissions로 전달
  // → CC가 직접 ~/.claude/settings.json에 기록 (우리 앱에서 별도 관리 불필요)
  resolvePermission?.(sessionId, decision, suggestion ?? null)
  closePermissionWindow()
})

// ── IPC: 렌더러 → 메인 ───────────────────────────────────────────────────

ipcMain.on('pet:set-state', (_, state) => {
  mainWindow?.webContents.send('pet:state-changed', state)
})

ipcMain.on('pet:show-context-menu', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  const menu = Menu.buildFromTemplate([
    { label: '개발자 도구', click: () => win.webContents.openDevTools({ mode: 'detach' }) },
    { type: 'separator' },
    { label: '종료', click: () => app.quit() },
  ])
  menu.popup({ window: win })
})

// ── 드래그 IPC ───────────────────────────────────────────────────────────────

ipcMain.on('pet:drag-start', (_, { sx, sy }) => {
  isDragging = true
  const [wx, wy] = mainWindow.getPosition()
  dragBase = { winX: wx, winY: wy, screenX: sx, screenY: sy }
})

ipcMain.on('pet:drag-move', (_, { sx, sy }) => {
  if (!dragBase) return
  const nx = dragBase.winX + (sx - dragBase.screenX)
  const ny = dragBase.winY + (sy - dragBase.screenY)
  mainWindow.setPosition(Math.round(nx), Math.round(ny))
})

ipcMain.on('pet:drag-end', () => {
  isDragging = false
  dragBase = null
  const [wx, wy] = mainWindow.getPosition()
  const display = screen.getDisplayNearestPoint({ x: wx, y: wy })
  const snapY = snapToBottom(display)
  mainWindow.setPosition(wx, snapY)
  savePrefs({ ...loadPrefs(), windowX: wx })
})

ipcMain.on('pet:open-claude', () => {
  shell.openPath('/Applications/Claude.app').then(err => {
    if (err) shell.openExternal('https://claude.ai')
  })
})
