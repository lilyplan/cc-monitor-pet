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
    if (win && !win.isDestroyed()) {
      win.webContents.send('perm:data', toolInfo)
      win.show()
      return
    }

    const { x, y } = locate()
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
      win.webContents.send('perm:data', toolInfo)
      win.show()
      win.setAlwaysOnTop(true, 'screen-saver')
      win.moveTop()
    })

    win.on('closed', () => { win = null })
  }

  function close() {
    if (win && !win.isDestroyed()) win.close()
    win = null
  }

  return { show, close }
}
