#!/usr/bin/env node
/**
 * CC Monitor Pet — Claude Code 훅 스크립트
 *
 * PreToolUse: /permission 엔드포인트로 long-poll → 사용자 결정(allow/block) 대기
 * 그 외: /state 엔드포인트로 fire-and-forget
 */

import http from 'http'
import fs   from 'fs'
import path from 'path'
import os   from 'os'

const SERVER_HOST     = '127.0.0.1'
const SERVER_PORT     = 23333
const TIMEOUT_MS      = 1000
const PERM_TIMEOUT_MS = 60000   // 사용자 응답 대기 최대 60초
const MAX_INPUT       = 65536
const TOKEN_PATH      = path.join(os.homedir(), '.cc-monitor-pet.token')

let secretToken = ''
try { secretToken = fs.readFileSync(TOKEN_PATH, 'utf8').trim() } catch {}

let raw = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', chunk => {
  raw += chunk
  if (raw.length > MAX_INPUT) {
    process.stderr.write('[cc-pet] stdin 크기 초과, 무시\n')
    process.exit(0)
  }
})
process.stdin.on('end', () => {
  let payload
  try { payload = JSON.parse(raw) } catch { process.exit(0) }
  sendToServer(payload)
})

// 그 외 이벤트: fire-and-forget
function sendToServer(payload) {
  const body = JSON.stringify({
    event:     payload.hook_event_name ?? payload.event,
    sessionId: payload.session_id,
    cwd:       payload.cwd,
    toolName:  payload.tool_name,
    toolInput: payload.tool_input,
    error:     payload.error,
  })

  const req = http.request({
    hostname: SERVER_HOST,
    port:     SERVER_PORT,
    path:     '/state',
    method:   'POST',
    headers: {
      'Content-Type':   'application/json',
      'Content-Length': Buffer.byteLength(body),
      'X-Pet-Token':    secretToken,
    },
    timeout: TIMEOUT_MS,
  }, res => { res.resume(); process.exit(0) })

  req.on('timeout', () => { req.destroy(); process.exit(0) })
  req.on('error',   () => process.exit(0))
  req.write(body)
  req.end()
}
