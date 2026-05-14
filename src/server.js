import http from 'http'
import { SERVER_HOST, SERVER_PORT, MAX_BODY_BYTES } from './lib/constants.js'

/**
 * Local HTTP server: receives hook events on POST /state and
 * native CC permission requests on POST /permission.
 *
 * Never speaks to anything outside 127.0.0.1.
 *
 * Permission handling uses CC's native PermissionRequest HTTP hook:
 *   - CC POSTs tool_name / session_id / permission_suggestions
 *   - We hold the response open until the user decides
 *   - "Always allow" includes updatedPermissions; CC persists it to
 *     ~/.claude/settings.json — we never manage permission rules here.
 */
export function createServer(mainWindow, {
  secretToken,
  onPermissionNeeded,
  onPermissionResolved,
} = {}) {
  const pending = new Map()   // sessionId -> { res, toolName, toolInput, suggestions }

  function sendState(state, event, sessionId) {
    mainWindow?.webContents.send('pet:state-changed', { state, event, sessionId })
  }

  function resolvePermission(sessionId, decision, suggestion = null) {
    const entry = pending.get(sessionId)
    if (!entry) {
      console.warn(`[server] resolvePermission: pending 없음 (session=${sessionId}) — 이미 응답됐거나 timeout`)
      return
    }
    pending.delete(sessionId)
    onPermissionResolved?.()

    const heldMs = Date.now() - entry.receivedAt
    console.log(`[server] resolvePermission (session=${sessionId}, decision=${decision}, held=${heldMs}ms)`)

    // CC 2.1+의 PermissionRequest HTTP hook 응답 스키마:
    //   { hookEventName: "PermissionRequest",
    //     decision: { behavior: "allow"|"deny", updatedPermissions?, message?, ... } }
    // 이전에는 { behavior:"allow" } 단일 키만 보내서 CC가 인식하지 못하고
    // 같은 sessionId로 요청을 반복 송신하던 문제 발생.
    const inner = decision === 'allow' || decision === 'always'
      ? { behavior: 'allow' }
      : { behavior: 'deny', message: '사용자가 거부했습니다' }
    if (decision === 'always') {
      inner.updatedPermissions = [suggestion ?? buildFallbackSuggestion(entry.toolName, entry.toolInput)]
    }
    const body = { hookEventName: 'PermissionRequest', decision: inner }
    if (decision === 'allow' || decision === 'always') {
      sendState('working', 'PermissionApproved', sessionId)
    }

    const json = JSON.stringify(body)
    const res = entry.res
    const sock = res.socket
    console.log(`[server] 응답 전 상태:`, JSON.stringify({
      headersSent: res.headersSent,
      writableEnded: res.writableEnded,
      destroyed: res.destroyed,
      socket: sock ? {
        destroyed: sock.destroyed,
        writable: sock.writable,
        readable: sock.readable,
        bytesWritten: sock.bytesWritten,
      } : null,
    }))
    console.log(`[server] 응답 본문 (${Buffer.byteLength(json)}B):`, json)

    if (res.headersSent || res.writableEnded || res.destroyed) {
      console.error(`[server] 응답 송신 불가 — res 이미 종료/소멸 (session=${sessionId})`)
      return
    }
    if (sock && (sock.destroyed || !sock.writable)) {
      console.error(`[server] 응답 송신 불가 — socket already dead (session=${sessionId})`)
      return
    }

    try {
      res.writeHead(200, {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(json),
        'Connection':     'close',
      })
      res.end(json, () => {
        console.log(`[server] res.end callback — 응답 flush 완료 (session=${sessionId})`)
      })
      const after = res.socket
      console.log(`[server] 응답 송신 직후 상태:`, JSON.stringify({
        writableEnded: res.writableEnded,
        bytesWritten: after?.bytesWritten ?? null,
      }))
      console.log(`[server] permission → ${body.behavior} (session=${sessionId}, decision=${decision})`)
    } catch (err) {
      console.error(`[server] 응답 송신 실패 (session=${sessionId}):`, err.message, err.stack)
    }
  }

  const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json')

    if (req.method === 'POST' && req.url === '/permission') {
      readJsonBody(req, res).then(payload => {
        if (!payload) return
        handlePermissionRequest(payload, res)
      })
      return
    }

    if (secretToken && req.headers['x-pet-token'] !== secretToken) {
      console.warn(`[server] 인증 실패 — 토큰 불일치 (${req.method} ${req.url})`)
      res.writeHead(403); res.end(JSON.stringify({ error: 'forbidden' }))
      return
    }

    if (req.method === 'POST' && req.url === '/state') {
      readJsonBody(req, res).then(payload => {
        if (!payload) return
        handleStateEvent(payload)
        res.writeHead(200); res.end(JSON.stringify({ ok: true }))
      })
      return
    }

    if (req.method === 'GET' && req.url === '/ping') {
      res.writeHead(200); res.end(JSON.stringify({ ok: true, version: '0.1.0' }))
      return
    }

    res.writeHead(404); res.end(JSON.stringify({ error: 'not found' }))
  })

  function handlePermissionRequest(payload, res) {
    // CC native format uses snake_case
    const toolName  = payload.tool_name  ?? payload.toolName  ?? 'unknown'
    const sessionId = payload.session_id ?? payload.sessionId ?? 'default'
    const toolInput = payload.tool_input ?? payload.toolInput ?? {}
    const suggestions = Array.isArray(payload.permission_suggestions)
      ? payload.permission_suggestions : []

    console.log(`[server] /permission — tool=${toolName} session=${sessionId} suggestions=${suggestions.length}`)

    sendState('notification', 'PermissionWait', sessionId)
    onPermissionNeeded?.({ toolName, toolInput, sessionId, suggestions })
    pending.set(sessionId, { res, toolName, toolInput, suggestions, receivedAt: Date.now() })

    // If CC drops the connection before we answer, clean up.
    res.req.on('close', () => {
      if (pending.has(sessionId)) {
        console.log(`[server] hook 연결 끊김 — cleanup (session=${sessionId})`)
        pending.delete(sessionId)
        onPermissionResolved?.()
      }
    })
  }

  function handleStateEvent(payload) {
    const { event, sessionId, cwd, state: directState } = payload
    console.log(`[server] event=${event} session=${sessionId ?? '-'} cwd=${cwd ?? '-'}`)

    // UserPromptSubmit fans out: sustained thinking + one-shot cheering
    if (event === 'UserPromptSubmit') {
      sendState('thinking', event, sessionId)
      sendState('cheering', event, sessionId)
      return
    }

    // Direct state from MCP signal_pet
    if (directState && !(event in EVENT_STATE_MAP)) {
      sendState(directState, event, sessionId)
      return
    }

    const target = EVENT_STATE_MAP[event]
    if (target === undefined) {
      console.warn(`[server] unknown event: ${event}`)
      return
    }
    if (target === null) return
    sendState(target, event, sessionId)
  }

  server.listen(SERVER_PORT, SERVER_HOST, () => {
    console.log(`[server] listening on ${SERVER_HOST}:${SERVER_PORT}`)
  })
  server.on('error', err => {
    if (err.code === 'EADDRINUSE') {
      console.error(`[server] port ${SERVER_PORT} already in use — another instance may be running`)
    } else {
      console.error('[server] error:', err)
    }
  })

  return { server, resolvePermission }
}

// ── helpers ───────────────────────────────────────────────────

const EVENT_STATE_MAP = {
  UserPromptSubmit:   null,        // handled inline (thinking + cheering)
  PreToolUse:         'working',
  PostToolUse:        'working',
  PostToolUseFailure: 'error',
  SubagentStart:      'juggling',
  SubagentStop:       'working',
  PreCompact:         'sweeping',
  PostCompact:        null,
  Stop:               'done',
  StopFailure:        'error',
  Notification:       null,        // ignored
  SessionStart:       null,
  SessionEnd:         'idle',
}

function readJsonBody(req, res) {
  return new Promise(resolve => {
    let body = ''
    let aborted = false
    req.on('data', chunk => {
      body += chunk
      if (body.length > MAX_BODY_BYTES) {
        aborted = true
        req.destroy()
        try {
          res.writeHead(413)
          res.end(JSON.stringify({ error: 'payload too large' }))
        } catch { /* socket already gone */ }
        resolve(null)
      }
    })
    req.on('end', () => {
      if (aborted) return
      try { resolve(JSON.parse(body)) }
      catch {
        res.writeHead(400)
        res.end(JSON.stringify({ error: 'invalid json' }))
        resolve(null)
      }
    })
  })
}

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
