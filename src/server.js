import http from 'http'

const PORT     = 23333
const HOST     = '127.0.0.1'
const MAX_BODY = 65536

/**
 * 로컬 HTTP 서버: Claude Code 훅 스크립트에서 POST /state, /permission 수신
 * 외부 네트워크로 나가는 통신 없음 — 127.0.0.1 전용
 */
export function createServer(mainWindow, callbacks = {}) {
  const { secretToken } = callbacks

  // 세션별 pending 권한 요청 — hook.js가 응답을 기다리는 동안 보관
  const pendingPermissions = new Map()  // sessionId → { res, toolName }

  function resolvePermission(sessionId, decision) {
    const pending = pendingPermissions.get(sessionId)
    if (!pending) {
      console.warn(`[server] resolvePermission: pending 없음 (session=${sessionId})`)
      return
    }
    pendingPermissions.delete(sessionId)
    callbacks.onPermissionResolved?.()

    if (decision === 'allow' || decision === 'always') {
      console.log(`[server] permission → allow (session=${sessionId})`)
      pending.res.writeHead(200)
      pending.res.end(JSON.stringify({ decision: 'allow' }))
    } else {
      console.log(`[server] permission → block (session=${sessionId})`)
      pending.res.writeHead(200)
      pending.res.end(JSON.stringify({ decision: 'block', reason: '사용자가 거부했습니다' }))
    }
  }

  const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json')

    // ── 토큰 인증 ──────────────────────────────────────────────
    if (secretToken) {
      const clientToken = req.headers['x-pet-token']
      if (clientToken !== secretToken) {
        console.warn(`[server] 인증 실패 — 토큰 불일치 (${req.method} ${req.url})`)
        res.writeHead(403)
        res.end(JSON.stringify({ error: 'forbidden' }))
        return
      }
    }

    // ── /permission: PreToolUse long-poll ────────────────────
    if (req.method === 'POST' && req.url === '/permission') {
      let body = ''
      req.on('data', chunk => {
        body += chunk
        if (body.length > MAX_BODY) { req.destroy(); return }
      })
      req.on('end', () => {
        let payload
        try { payload = JSON.parse(body) } catch {
          res.writeHead(400)
          res.end(JSON.stringify({ error: 'invalid json' }))
          return
        }

        const { sessionId, toolName, toolInput } = payload
        console.log(`[server] /permission 요청 — tool=${toolName} session=${sessionId}`)

        // 항상 허용 목록 체크 → 즉시 응답
        const isAlways = callbacks.isAlwaysAllowed?.(toolName)
        if (isAlways) {
          console.log(`[server] 항상 허용: ${toolName} → 즉시 allow`)
          sendState(mainWindow, 'working', 'PreToolUse', sessionId)
          res.writeHead(200)
          res.end(JSON.stringify({ decision: 'allow' }))
          return
        }

        // 팝업 표시 + HTTP 응답 보류
        sendState(mainWindow, 'notification', 'PermissionWait', sessionId)
        callbacks.onPermissionNeeded?.({ toolName, toolInput, sessionId })
        pendingPermissions.set(sessionId, { res, toolName })

        // 클라이언트(hook)가 연결을 끊으면 cleanup + 상태 복귀
        req.on('close', () => {
          if (pendingPermissions.has(sessionId)) {
            console.log(`[server] hook 연결 끊김 — cleanup (session=${sessionId})`)
            pendingPermissions.delete(sessionId)
            callbacks.onPermissionResolved?.()
          }
        })
      })
      return
    }

    // ── /state: 일반 이벤트 ──────────────────────────────────
    if (req.method === 'POST' && req.url === '/state') {
      let body = ''
      req.on('data', chunk => {
        body += chunk
        if (body.length > MAX_BODY) {
          req.destroy()
          res.writeHead(413)
          res.end(JSON.stringify({ error: 'payload too large' }))
        }
      })
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

  return { server, resolvePermission }
}

// ── 훅 이벤트 → 상태 매핑 ───────────────────────────────────────────────────

const EVENT_STATE_MAP = {
  UserPromptSubmit:    'cheering',    // 프롬프트 전송 환호 (ONE_SHOT 3초)
  PreToolUse:          'working',     // 도구 실행 전
  PostToolUse:         'working',     // 도구 실행 후
  PostToolUseFailure:  'error',       // 도구 실패
  SubagentStart:       'juggling',    // 서브에이전트 시작
  SubagentStop:        'working',     // 서브에이전트 종료 후 복귀
  PreCompact:          'sweeping',    // 컨텍스트 압축 시작
  PostCompact:         'attention',   // 압축 완료 알림
  Stop:                'done',        // 응답 완료 (체크마크)
  StopFailure:         'error',       // 응답 실패
  Notification:        null,           // 무시 (권한 요청은 /permission 엔드포인트가 별도 처리)
  SessionStart:        null,          // 무시
  SessionEnd:          'idle',        // 세션 종료 → idle
}

function sendState(mainWindow, state, event, sessionId) {
  mainWindow?.webContents.send('pet:state-changed', { state, event, sessionId })
}

function handleStateEvent(payload, mainWindow, callbacks) {
  const { event, sessionId, cwd, state: directState } = payload

  console.log(`[server] event=${event} session=${sessionId ?? '-'} cwd=${cwd ?? '-'}`)

  // MCP signal_pet 등 state가 직접 지정된 경우
  if (directState && !(event in EVENT_STATE_MAP)) {
    sendState(mainWindow, directState, event, sessionId)
    return
  }

  const targetState = EVENT_STATE_MAP[event]
  if (targetState === undefined) {
    console.warn(`[server] unknown event: ${event}`)
    return
  }
  if (targetState === null) return

  sendState(mainWindow, targetState, event, sessionId)
}
