/**
 * Render build/icon.svg to build/icon.png with proper alpha transparency.
 *
 * Why not qlmanage: it rasterises SVGs with an opaque white background,
 * which fills the area outside the squircle and makes the icon look like
 * a white square in the Dock. Electron's transparent BrowserWindow + capturePage
 * preserves the alpha channel.
 *
 * Run: npx electron build/render-icon.cjs
 */
const { app, BrowserWindow } = require('electron')
const path = require('path')
const fs = require('fs')

const SIZE = 1024
const SVG_PATH = path.join(__dirname, 'icon.svg')
const OUT_PATH = path.join(__dirname, 'icon.png')

const HTML = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
  html, body { margin: 0; padding: 0; background: transparent; }
  body { width: ${SIZE}px; height: ${SIZE}px; }
  svg { display: block; width: ${SIZE}px; height: ${SIZE}px; }
</style></head><body>
${fs.readFileSync(SVG_PATH, 'utf8')}
</body></html>`

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: SIZE,
    height: SIZE,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    useContentSize: true,
    webPreferences: { offscreen: false, backgroundThrottling: false },
  })

  // Load via data URL so we don't have to create a temp html file
  const dataUrl = 'data:text/html;charset=utf-8;base64,' + Buffer.from(HTML).toString('base64')
  await win.loadURL(dataUrl)

  // Wait for SVG to settle (filters/gradients fully render)
  await new Promise(r => setTimeout(r, 400))

  const image = await win.webContents.capturePage()
  fs.writeFileSync(OUT_PATH, image.toPNG())
  console.log(`✅ icon.png 생성 (${image.getSize().width}x${image.getSize().height}, 알파 보존)`)

  app.quit()
})

app.on('window-all-closed', () => app.quit())
