/**
 * Mirror main-process console output to a file on disk.
 *
 * Built .apps have no terminal stdout, so console.log lines we add for
 * debugging would otherwise be invisible. After enableFileLogging(),
 * every console.log/warn/error is appended (with timestamp + level) to
 *   ~/Library/Logs/cc-monitor-pet/debug.log
 *
 * Renderer-side logs do not flow through this — they need to be forwarded
 * via IPC and re-logged in main (see permission-preload.cjs `perm:log`).
 */

import fs from 'fs'
import path from 'path'
import os from 'os'

const LOG_DIR = path.join(os.homedir(), 'Library', 'Logs', 'cc-monitor-pet')
const LOG_FILE = path.join(LOG_DIR, 'debug.log')

let initialized = false

function format(arg) {
  if (typeof arg === 'string') return arg
  if (arg instanceof Error) return arg.stack ?? arg.message
  try { return JSON.stringify(arg) } catch { return String(arg) }
}

function write(level, parts) {
  const line = `[${new Date().toISOString()}] [${level}] ${parts.join(' ')}\n`
  try { fs.appendFileSync(LOG_FILE, line) } catch { /* best-effort */ }
}

export function enableFileLogging() {
  if (initialized) return
  initialized = true
  try { fs.mkdirSync(LOG_DIR, { recursive: true }) } catch {}
  // Truncate any log from the previous session so the file never grows
  // unbounded over days/weeks. The latest session is always the only one
  // present — which is the only useful state when debugging anyway.
  try { fs.writeFileSync(LOG_FILE, '') } catch {}
  const orig = {
    log: console.log.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
  }
  console.log   = (...a) => { orig.log(...a);   write('log',   a.map(format)) }
  console.warn  = (...a) => { orig.warn(...a);  write('warn',  a.map(format)) }
  console.error = (...a) => { orig.error(...a); write('error', a.map(format)) }
  write('init', [`logger started — pid=${process.pid}`])
}

export function logPath() { return LOG_FILE }
