import http from 'http'

const PORT = 23333
const HOST = '127.0.0.1'

/**
 * 로컬 HTTP 서버: Claude Code 훅 스크립트에서 POST /state 를 수신
 * 외부 네트워크로 나가는 통신 없음 — 127.0.0.1 전용
 */
export function createServer(mainWindow) {
  const server = http.createServer((req, res) => {
    // CORS 불필요 (로컬 전용), 기본 헤더만 설정
    res.setHeader('Content-Type', 'application/json')

    if (req.method === 'POST' && req.url === '/state') {
      let body = ''
      req.on('data', chunk => { body += chunk })
      req.on('end', () => {
        try {
          const payload = JSON.parse(body)
          handleStateEvent(payload, mainWindow)
          res.writeHead(200)
          res.end(JSON.stringify({ ok: true }))
        } catch {
          res.writeHead(400)
          res.end(JSON.stringify({ error: 'invalid json' }))
        }
      })
      return
    }

    if (req.method === 'GET' && req.url === '/ping') {
      res.writeHead(200)
      res.end(JSON.stringify({ ok: true, version: '0.1.0' }))
      return
    }

    res.writeHead(404)
    res.end(JSON.stringify({ error: 'not found' }))
  })

  server.listen(PORT, HOST, () => {
    console.log(`[server] listening on ${HOST}:${PORT}`)
  })

  server.on('error', err => {
    if (err.code === 'EADDRINUSE') {
      console.error(`[server] port ${PORT} already in use — another instance may be running`)
    } else {
      console.error('[server] error:', err)
    }
  })

  return server
}

/**
 * 훅 이벤트 → 상태 이름 매핑
 *
 * 우선순위 (높음 → 낮음):
 *   error(8) > notification(7) > sweeping(6) > attention(5)
 *   > juggling(4) > carrying(4) > working(3) > thinking(2)
 *   > idle(1) > sleeping(0)
 */
const EVENT_STATE_MAP = {
  UserPromptSubmit:    'working',
  PreToolUse:          'working',
  PostToolUse:         'working',
  PostToolUseFailure:  'error',
  SubagentStart:       'juggling',
  SubagentStop:        'working',
  PreCompact:          'sweeping',
  PostCompact:         'attention',
  Stop:                'notification',
  StopFailure:         'error',
  Notification:        'notification',
  SessionStart:        null,   // 세션 등록만, 상태 변경 없음
  SessionEnd:          'idle',
}

// 권한 대기 감지: PreToolUse 후 PostToolUse가 일정 시간 내에 안 오면 알림
const PERMISSION_WAIT_MS = 2000
let permissionTimer = null

function sendState(mainWindow, state, event, sessionId) {
  mainWindow?.webContents.send('pet:state-changed', { state, event, sessionId })
}

function handleStateEvent(payload, mainWindow) {
  const { event, sessionId, cwd, state: directState } = payload

  console.log(`[server] event=${event} session=${sessionId ?? '-'} cwd=${cwd ?? '-'}`)

  // MCP signal_pet 등 state가 직접 지정된 경우 (이벤트 매핑 우회)
  if (directState && !(event in EVENT_STATE_MAP)) {
    sendState(mainWindow, directState, event, sessionId)
    return
  }

  // 권한 대기 감지 로직
  if (event === 'PreToolUse') {
    clearTimeout(permissionTimer)
    permissionTimer = setTimeout(() => {
      console.log('[server] 권한 대기 중으로 판단 → notification')
      sendState(mainWindow, 'notification', 'PermissionWait', sessionId)
    }, PERMISSION_WAIT_MS)
  }

  if (event === 'PostToolUse' || event === 'PostToolUseFailure' || event === 'Stop') {
    clearTimeout(permissionTimer)
    permissionTimer = null
  }

  const targetState = EVENT_STATE_MAP[event]
  if (targetState === undefined) {
    console.warn(`[server] unknown event: ${event}`)
    return
  }
  if (targetState === null) return  // SessionStart 등 상태 변경 없는 이벤트

  sendState(mainWindow, targetState, event, sessionId)
}
