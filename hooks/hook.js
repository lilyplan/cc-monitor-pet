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

const SERVER_HOST = '127.0.0.1'
const SERVER_PORT = 23333
const TIMEOUT_MS  = 1000   // 서버 미실행 시 빠르게 포기

// stdin에서 이벤트 JSON 읽기
let raw = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', chunk => { raw += chunk })
process.stdin.on('end', () => {
  let payload
  try {
    payload = JSON.parse(raw)
  } catch {
    process.exit(0)  // 파싱 실패 시 Claude Code 흐름 방해하지 않고 종료
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
      headers:  { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      timeout:  TIMEOUT_MS,
    },
    res => {
      res.resume()  // 응답 바디 소비 (메모리 누수 방지)
      process.exit(0)
    }
  )

  req.on('timeout', () => { req.destroy(); process.exit(0) })
  req.on('error',   () => { process.exit(0) })  // 서버 미실행 시 조용히 종료
  req.write(body)
  req.end()
}
