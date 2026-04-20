import fs   from 'fs'
import path from 'path'
import { app } from 'electron'

function getPrefsPath() {
  return path.join(app.getPath('userData'), 'settings.json')
}

export function loadPrefs() {
  const p = getPrefsPath()
  if (!fs.existsSync(p)) return {}
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'))
  } catch {
    return {}
  }
}

export function savePrefs(data) {
  const p = getPrefsPath()
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf8')
}
