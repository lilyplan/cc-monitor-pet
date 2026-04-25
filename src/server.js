import http from 'http'

const PORT = 23333
const HOST = '127.0.0.1'

/**
 * 로컬 HTTP 서버: Claude Code 훅 스크립트에서 POST /state 를 수신
 * 외부 네트워크로 나가는 통신 없음 — 127.0.0.1 전용
 */
export function createServer(mainWindow, callbacks = {}) {
  const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json')

    if (req.method === 'POST' && req.url === '/state') {
      let body = ''
      req.on('data', chunk => { body += chunk })
      req.on('end', () => {
        try {
          const payload = JSON.parse(body)
          handleStateEvent(payload, mainWindow, callbacks)
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
  SessionStart:        null,
  SessionEnd:          'idle',
}

// 권한 대기 감지: PreToolUse 후 PostToolUse가 일정 시간 내에 안 오면 팝업
const PERMISSION_WAIT_MS = 2000
let permissionTimer = null
let lastToolName = null
let lastToolInput = null

function sendState(mainWindow, state, event, sessionId) {
  mainWindow?.webContents.send('pet:state-changed', { state, event, sessionId })
}

function handleStateEvent(payload, mainWindow, callbacks) {
  const { event, sessionId, cwd, toolName, toolInput, state: directState } = payload

  console.log(`[server] event=${event} session=${sessionId ?? '-'} cwd=${cwd ?? '-'}`)

  // MCP signal_pet 등 state가 직접 지정된 경우 (이벤트 매핑 우회)
  if (directState && !(event in EVENT_STATE_MAP)) {
    sendState(mainWindow, directState, event, sessionId)
    return
  }

  // 권한 대기 감지 로직
  if (event === 'PreToolUse') {
    lastToolName  = toolName  ?? null
    lastToolInput = toolInput ?? null

    clearTimeout(permissionTimer)
    permissionTimer = setTimeout(() => {
      console.log('[server] 권한 대기 중으로 판단')

      const isAlways = callbacks.isAlwaysAllowed?.(lastToolName)
      if (isAlways) {
        // 항상 허용 목록에 있으면 자동 승인
        console.log(`[server] 항상 허용 목록: ${lastToolName} → 자동 승인`)
        callbacks.onAutoApprove?.()
      } else {
        // 팝업 표시
        sendState(mainWindow, 'notification', 'PermissionWait', sessionId)
        callbacks.onPermissionNeeded?.({
          toolName:  lastToolName,
          toolInput: lastToolInput,
          sessionId,
        })
      }
    }, PERMISSION_WAIT_MS)
  }

  if (event === 'PostToolUse' || event === 'PostToolUseFailure' || event === 'Stop') {
    clearTimeout(permissionTimer)
    permissionTimer = null
    callbacks.onPermissionResolved?.()
  }

  const targetState = EVENT_STATE_MAP[event]
  if (targetState === undefined) {
    console.warn(`[server] unknown event: ${event}`)
    return
  }
  if (targetState === null) return

  sendState(mainWindow, targetState, event, sessionId)
}
