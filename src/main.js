import { app, BrowserWindow, ipcMain, screen, Menu, shell } from 'electron'
import { writeFileSync, unlinkSync, chmodSync } from 'fs'
import crypto from 'crypto'
import path from 'path'
import { fileURLToPath } from 'url'
import { createServer } from './server.js'
import { loadPrefs, savePrefs } from './prefs.js'
import { createPermissionWindowController } from './permission-window.js'
import { PET_SIZE, TOKEN_PATH } from './lib/constants.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

let petWindow = null
let permissionController = null
let resolvePermission = null
const drag = { active: false, base: null }    // base: { winX, winY, screenX, screenY }

function generateToken() {
  const token = crypto.randomBytes(32).toString('hex')
  writeFileSync(TOKEN_PATH, token, { encoding: 'utf8', mode: 0o600 })
  try { chmodSync(TOKEN_PATH, 0o600) } catch { /* best effort */ }
  console.log('[main] 인증 토큰 생성 완료')
  return token
}

function snapToBottom(display) {
  return display.workArea.y + display.workArea.height - PET_SIZE
}

function createPetWindow() {
  const prefs = loadPrefs()
  const x = prefs.windowX ?? 20
  const display = screen.getDisplayNearestPoint({ x, y: 0 })
  const y = snapToBottom(display)

  console.log(`[main] 화면: ${display.bounds.width}x${display.workArea.height}(workArea), 창: ${x},${y}, 크기: ${PET_SIZE}x${PET_SIZE}`)

  const win = new BrowserWindow({
    width: PET_SIZE, height: PET_SIZE, x, y,
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

  // OS-initiated moves (e.g. workspace change) should re-snap to bottom.
  win.on('moved', () => {
    if (drag.active) return
    const [wx, wy] = win.getPosition()
    const d = screen.getDisplayNearestPoint({ x: wx, y: wy })
    win.setPosition(wx, snapToBottom(d))
    savePrefs({ ...loadPrefs(), windowX: wx })
  })

  return win
}

app.whenReady().then(() => {
  const secretToken = generateToken()
  petWindow = createPetWindow()
  permissionController = createPermissionWindowController({
    getPetPosition: () => petWindow?.getPosition() ?? [loadPrefs().windowX ?? 20, 0],
  })

  ;({ resolvePermission } = createServer(petWindow, {
    secretToken,
    onPermissionNeeded:   info => permissionController.show(info),
    onPermissionResolved: () => permissionController.close(),
  }))
})

app.on('window-all-closed', () => {
  try { unlinkSync(TOKEN_PATH) } catch { /* may not exist */ }
  app.quit()
})

// ── IPC: permission decision ─────────────────────────────────
ipcMain.on('perm:decide', (_, payload) => {
  const { decision, toolName, sessionId, suggestion } = payload ?? {}
  console.log(`[main] perm:decide: ${decision} / ${toolName} / session=${sessionId}`)
  if (!resolvePermission) {
    console.error('[main] perm:decide 수신했지만 resolvePermission 미설정 — 서버 초기화 실패?')
    permissionController?.close()
    return
  }
  resolvePermission(sessionId, decision, suggestion ?? null)
  permissionController?.close()
})

// ── IPC: renderer → main ─────────────────────────────────────
ipcMain.on('pet:set-state', (_, state) => {
  petWindow?.webContents.send('pet:state-changed', state)
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

// ── IPC: drag ────────────────────────────────────────────────
ipcMain.on('pet:drag-start', (_, { sx, sy }) => {
  drag.active = true
  const [wx, wy] = petWindow.getPosition()
  drag.base = { winX: wx, winY: wy, screenX: sx, screenY: sy }
})

ipcMain.on('pet:drag-move', (_, { sx, sy }) => {
  if (!drag.base) return
  const nx = drag.base.winX + (sx - drag.base.screenX)
  const ny = drag.base.winY + (sy - drag.base.screenY)
  petWindow.setPosition(Math.round(nx), Math.round(ny))
})

ipcMain.on('pet:drag-end', () => {
  drag.active = false
  drag.base = null
  const [wx, wy] = petWindow.getPosition()
  const d = screen.getDisplayNearestPoint({ x: wx, y: wy })
  petWindow.setPosition(wx, snapToBottom(d))
  savePrefs({ ...loadPrefs(), windowX: wx })
})

ipcMain.on('pet:open-claude', () => {
  shell.openPath('/Applications/Claude.app').then(err => {
    if (err) shell.openExternal('https://claude.ai')
  })
})
