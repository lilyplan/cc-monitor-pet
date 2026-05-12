import http from 'http'
import fs from 'fs'
import {
  SERVER_HOST,
  SERVER_PORT,
  TOKEN_PATH,
  HOOK_TIMEOUT_MS,
} from './constants.js'

export function readToken() {
  try { return fs.readFileSync(TOKEN_PATH, 'utf8').trim() } catch { return '' }
}

export function postState(payload, { token, timeout = HOOK_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload)
    const req = http.request(
      {
        hostname: SERVER_HOST,
        port: SERVER_PORT,
        path: '/state',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          'X-Pet-Token': token ?? readToken(),
        },
        timeout,
      },
      (res) => { res.resume(); resolve() },
    )
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')) })
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}
