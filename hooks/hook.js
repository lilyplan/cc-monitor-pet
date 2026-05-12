#!/usr/bin/env node
/**
 * CC Monitor Pet — Claude Code hook script.
 * Receives a hook event payload on stdin and forwards it to the
 * local pet server as a fire-and-forget POST /state.
 */

import { postState, readToken } from '../src/lib/pet-client.js'

const MAX_INPUT = 65536

let raw = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', chunk => {
  raw += chunk
  if (raw.length > MAX_INPUT) {
    process.stderr.write('[cc-pet] stdin 크기 초과, 무시\n')
    process.exit(0)
  }
})
process.stdin.on('end', async () => {
  let payload
  try { payload = JSON.parse(raw) } catch { process.exit(0) }

  try {
    await postState(
      {
        event: payload.hook_event_name ?? payload.event,
        sessionId: payload.session_id,
        cwd: payload.cwd,
        toolName: payload.tool_name,
        toolInput: payload.tool_input,
        error: payload.error,
      },
      { token: readToken() },
    )
  } catch { /* fire-and-forget */ }
  process.exit(0)
})
