#!/usr/bin/env node
/**
 * CC Desk Pet — Claude Code 훅 스크립트
 *
 * ~/.claude/settings.json 의 hooks 배열에 등록되어
 * Claude Code 이벤트 발생 시 자동 실행됨.
 *
 * 동작: stdin에서 이벤트 JSON을 읽어 로컬 HTTP 서버(127.0.0.1:23333)로 전달.
 * 외부 네트워크 통신 없음.
 */

import http from 'http'
import fs   from 'fs'
import path from 'path'
import os   from 'os'

const SERVER_HOST  = '127.0.0.1'
const SERVER_PORT  = 23333
const TIMEOUT_MS   = 1000
const MAX_INPUT    = 65536   // 64KB stdin 제한
const TOKEN_PATH   = path.join(os.homedir(), '.cc-monitor-pet.token')

// 인증 토큰 읽기 (앱 미실행 시 빈 문자열)
let secretToken = ''
try { secretToken = fs.readFileSync(TOKEN_PATH, 'utf8').trim() } catch {}

// stdin에서 이벤트 JSON 읽기
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
  try {
    payload = JSON.parse(raw)
  } catch {
    process.exit(0)
  }

  sendToServer(payload)
})

function sendToServer(payload) {
  const body = JSON.stringify({
    event:     payload.hook_event_name ?? payload.event,
    sessionId: payload.session_id,
    cwd:       payload.cwd,
    toolName:  payload.tool_name,
    toolInput: payload.tool_input,
    error:     payload.error,
  })

  const req = http.request(
    {
      hostname: SERVER_HOST,
      port:     SERVER_PORT,
      path:     '/state',
      method:   'POST',
      headers:  {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(body),
        'X-Pet-Token':    secretToken,
      },
      timeout: TIMEOUT_MS,
    },
    res => {
      res.resume()
      process.exit(0)
    }
  )

  req.on('timeout', () => { req.destroy(); process.exit(0) })
  req.on('error',   () => { process.exit(0) })
  req.write(body)
  req.end()
}
