import { BrowserWindow, screen } from 'electron'
import path from 'path'
import { fileURLToPath } from 'url'
import { PET_SIZE } from './lib/constants.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const POPUP_WIDTH = 280
const POPUP_HEIGHT = 62
const PET_VISIBLE_HEIGHT = 96
const POPUP_GAP = 5
const SCREEN_MARGIN = 10

// TEMP: open DevTools alongside every permission popup so we can watch the
// renderer console while diagnosing the IPC chain. Flip to false once fixed.
const DEBUG_DEVTOOLS = true

/**
 * Manages the floating permission bubble window. Owns its own state
 * (one window at a time, recreated when needed).
 */
export function createPermissionWindowController({ getPetPosition }) {
  let win = null

  function locate() {
    const [petX, petY] = getPetPosition()
    const display = screen.getDisplayNearestPoint({ x: petX, y: petY })
    const { x: dx, y: dy, width: dw, height: dh } = display.workArea
    const charTop = dy + dh - PET_VISIBLE_HEIGHT
    const py = Math.max(dy + SCREEN_MARGIN, charTop - POPUP_HEIGHT - POPUP_GAP)
    let px = Math.round(petX + PET_SIZE / 2 - POPUP_WIDTH / 2)
    px = Math.max(dx + SCREEN_MARGIN, Math.min(px, dx + dw - POPUP_WIDTH - SCREEN_MARGIN))
    return { x: px, y: py }
  }

  function show(toolInfo) {
    console.log(`[perm-window] show — tool=${toolInfo.toolName} session=${toolInfo.sessionId}`)
    if (win && !win.isDestroyed()) {
      console.log('[perm-window] 기존 창 재사용')
      win.webContents.send('perm:data', toolInfo)
      win.show()
      return
    }

    const { x, y } = locate()
    console.log(`[perm-window] 새 창 생성 — pos=(${x},${y})`)
    win = new BrowserWindow({
      width: POPUP_WIDTH,
      height: POPUP_HEIGHT,
      x, y,
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

    win.loadFile(path.join(__dirname, 'permission.html'))
    win.setAlwaysOnTop(true, 'screen-saver')
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

    win.once('ready-to-show', () => {
      if (!win || win.isDestroyed()) return
      console.log('[perm-window] ready-to-show')
      win.webContents.send('perm:data', toolInfo)
      win.show()
      win.setAlwaysOnTop(true, 'screen-saver')
      win.moveTop()
      if (DEBUG_DEVTOOLS) {
        try { win.webContents.openDevTools({ mode: 'detach' }) } catch (e) {
          console.error('[perm-window] openDevTools 실패', e)
        }
      }
    })

    win.webContents.on('did-finish-load', () => {
      console.log('[perm-window] did-finish-load')
    })
    win.webContents.on('render-process-gone', (_, details) => {
      console.error('[perm-window] render-process-gone', details)
    })
    win.webContents.on('preload-error', (_, preloadPath, error) => {
      console.error('[perm-window] preload-error', preloadPath, error?.message)
    })

    win.on('closed', () => {
      console.log('[perm-window] window closed')
      win = null
    })
  }

  function close() {
    if (win && !win.isDestroyed()) win.close()
    win = null
  }

  return { show, close }
}
