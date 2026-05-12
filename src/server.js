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
      console.warn(`[server] resolvePermission: pending 없음 (session=${sessionId})`)
      return
    }
    pending.delete(sessionId)
    onPermissionResolved?.()

    if (decision === 'allow' || decision === 'always') {
      console.log(`[server] permission → allow (session=${sessionId})`)
      sendState('working', 'PermissionApproved', sessionId)
      const body = { behavior: 'allow' }
      if (decision === 'always') {
        body.updatedPermissions = [suggestion ?? buildFallbackSuggestion(entry.toolName, entry.toolInput)]
      }
      entry.res.writeHead(200)
      entry.res.end(JSON.stringify(body))
    } else {
      console.log(`[server] permission → deny (session=${sessionId})`)
      entry.res.writeHead(200)
      entry.res.end(JSON.stringify({ behavior: 'deny', message: '사용자가 거부했습니다' }))
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
    pending.set(sessionId, { res, toolName, toolInput, suggestions })

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
