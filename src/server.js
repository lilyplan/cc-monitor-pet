import http from 'http'

const PORT     = 23333
const HOST     = '127.0.0.1'
const MAX_BODY = 65536

/**
 * 로컬 HTTP 서버: Claude Code 훅 스크립트에서 POST /state, /permission 수신
 * 외부 네트워크로 나가는 통신 없음 — 127.0.0.1 전용
 *
 * 권한 시스템: CC native PermissionRequest HTTP hook 방식
 * - CC가 직접 /permission 엔드포인트에 POST (tool_name, session_id, permission_suggestions 포함)
 * - "항상 허용" 시 updatedPermissions를 응답에 포함 → CC가 ~/.claude/settings.json에 직접 기록
 * - sessionAllowed / alwaysAllowed / isSafeBashCommand 없음 — CC 자체 설정이 담당
 */
export function createServer(mainWindow, callbacks = {}) {
  const { secretToken } = callbacks

  // sessionId → { res, toolName, toolInput, suggestions }
  const pendingPermissions = new Map()

  // "항상 허용" 응답에 포함할 updatedPermissions 구조 생성
  // CC가 permission_suggestions를 보내지 않는 경우 폴백으로 단순 규칙 생성
  function buildFallbackSuggestion(toolName, toolInput) {
    if (toolName === 'Bash') {
      const cmd = (toolInput?.command ?? '').trim()
      const first = cmd.split(/\s+/)[0]
      return {
        type: 'addRules',
        rules: [{ toolName: 'Bash', ruleContent: first ? `Bash(${first}:*)` : 'Bash(*)' }],
        destination: 'localSettings',
        behavior: 'allow',
      }
    }
    return {
      type: 'addRules',
      rules: [{ toolName, ruleContent: `${toolName}(*)` }],
      destination: 'localSettings',
      behavior: 'allow',
    }
  }

  function resolvePermission(sessionId, decision, suggestion = null) {
    const pending = pendingPermissions.get(sessionId)
    if (!pending) {
      console.warn(`[server] resolvePermission: pending 없음 (session=${sessionId})`)
      return
    }
    pendingPermissions.delete(sessionId)
    callbacks.onPermissionResolved?.()

    if (decision === 'allow' || decision === 'always') {
      console.log(`[server] permission → allow (session=${sessionId})`)
      sendState(mainWindow, 'working', 'PermissionApproved', sessionId)

      const body = { behavior: 'allow' }
      if (decision === 'always') {
        // 사용자가 선택한 suggestion이 있으면 사용, 없으면 폴백 생성
        body.updatedPermissions = [suggestion ?? buildFallbackSuggestion(pending.toolName, pending.toolInput)]
      }
      pending.res.writeHead(200)
      pending.res.end(JSON.stringify(body))
    } else {
      console.log(`[server] permission → deny (session=${sessionId})`)
      pending.res.writeHead(200)
      pending.res.end(JSON.stringify({ behavior: 'deny', message: '사용자가 거부했습니다' }))
    }
  }

  const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json')

    // ── /permission: CC PermissionRequest HTTP hook ──────────
    // CC native HTTP hook은 X-Pet-Token 헤더를 포함하지 않으므로 토큰 인증 생략
    // (127.0.0.1 바인딩으로 로컬 보안 유지)
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

        // CC native format: snake_case (tool_name, session_id, permission_suggestions)
        const toolName   = payload.tool_name   ?? payload.toolName   ?? 'unknown'
        const sessionId  = payload.session_id  ?? payload.sessionId  ?? 'default'
        const toolInput  = payload.tool_input  ?? payload.toolInput  ?? {}
        const rawSuggestions = Array.isArray(payload.permission_suggestions)
          ? payload.permission_suggestions : []

        console.log(`[server] /permission — tool=${toolName} session=${sessionId} suggestions=${rawSuggestions.length}`)

        // 팝업 표시 + HTTP 응답 보류
        sendState(mainWindow, 'notification', 'PermissionWait', sessionId)
        callbacks.onPermissionNeeded?.({ toolName, toolInput, sessionId, suggestions: rawSuggestions })
        pendingPermissions.set(sessionId, { res, toolName, toolInput, suggestions: rawSuggestions })

        // CC(hook)가 연결을 끊으면 cleanup
        req.on('close', () => {
          if (pendingPermissions.has(sessionId)) {
            console.log(`[server] hook 연결 끊김 — cleanup (session=${sessionId})`)
            pendingPermissions.delete(sessionId)
          }
        })
      })
      return
    }

    // ── 토큰 인증 (/state 및 그 외 엔드포인트) ────────────────
    if (secretToken) {
      const clientToken = req.headers['x-pet-token']
      if (clientToken !== secretToken) {
        console.warn(`[server] 인증 실패 — 토큰 불일치 (${req.method} ${req.url})`)
        res.writeHead(403)
        res.end(JSON.stringify({ error: 'forbidden' }))
        return
      }
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
  UserPromptSubmit:    null,         // 아래 handleStateEvent에서 thinking + cheering 동시 전송
  PreToolUse:          'working',
  PostToolUse:         'working',
  PostToolUseFailure:  'error',
  SubagentStart:       'juggling',
  SubagentStop:        'working',
  PreCompact:          'sweeping',
  PostCompact:         null,
  Stop:                'done',
  StopFailure:         'error',
  Notification:        null,         // 무시
  SessionStart:        null,
  SessionEnd:          'idle',
}

function sendState(mainWindow, state, event, sessionId) {
  mainWindow?.webContents.send('pet:state-changed', { state, event, sessionId })
}

function handleStateEvent(payload, mainWindow, callbacks) {
  const { event, sessionId, cwd, state: directState } = payload

  console.log(`[server] event=${event} session=${sessionId ?? '-'} cwd=${cwd ?? '-'}`)

  // UserPromptSubmit: thinking(지속) + cheering(3초 일회성) 동시 등록
  if (event === 'UserPromptSubmit') {
    sendState(mainWindow, 'thinking', event, sessionId)
    sendState(mainWindow, 'cheering', event, sessionId)
    return
  }

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
