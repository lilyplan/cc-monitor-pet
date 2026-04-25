#!/usr/bin/env node
/**
 * CC Desk Pet — 훅 설치기
 *
 * 실행: node hooks/install.js
 *
 * ~/.claude/settings.json 의 hooks 오브젝트에
 * Claude Code 이벤트별 훅을 등록.
 * 이미 등록된 항목은 중복 추가하지 않음.
 *
 * Claude Code hooks 포맷:
 * {
 *   "hooks": {
 *     "EventName": [{ "hooks": [{ "type": "command", "command": "..." }] }]
 *   }
 * }
 */

import fs   from 'fs'
import path from 'path'
import os   from 'os'
import { fileURLToPath } from 'url'

const __dirname   = path.dirname(fileURLToPath(import.meta.url))
const HOOK_SCRIPT = path.resolve(__dirname, 'hook.js')
const SETTINGS    = path.join(os.homedir(), '.claude', 'settings.json')

// 훅을 등록할 이벤트 목록
const HOOK_EVENTS = [
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'SubagentStart',
  'SubagentStop',
  'PreCompact',
  'PostCompact',
  'Stop',
  'StopFailure',
  'Notification',
  'SessionStart',
  'SessionEnd',
]

function run() {
  // settings.json 읽기 (없으면 빈 구조 생성)
  let settings = {}
  if (fs.existsSync(SETTINGS)) {
    try {
      settings = JSON.parse(fs.readFileSync(SETTINGS, 'utf8'))
    } catch {
      console.error(`[install] settings.json 파싱 실패: ${SETTINGS}`)
      process.exit(1)
    }
  }

  // hooks 필드는 오브젝트 (이벤트명 → 배열)
  if (!settings.hooks || typeof settings.hooks !== 'object' || Array.isArray(settings.hooks)) {
    settings.hooks = {}
  }

  const nodeBin  = process.execPath          // 현재 실행 중인 Node.js 절대 경로
  const hookCmd = `"${nodeBin}" "${HOOK_SCRIPT}"`
  let addedCount = 0

  for (const event of HOOK_EVENTS) {
    if (!Array.isArray(settings.hooks[event])) {
      settings.hooks[event] = []
    }

    // 구버전 'node hook.js' 형태 항목을 새 절대 경로로 교체
    let upgraded = false
    for (const entry of settings.hooks[event]) {
      if (!Array.isArray(entry.hooks)) continue
      for (const h of entry.hooks) {
        if (h.type === 'command' && h.command !== hookCmd &&
            h.command.includes('cc-monitor-pet') && h.command.includes('hook.js')) {
          h.command = hookCmd
          upgraded = true
          addedCount++
        }
      }
    }
    if (upgraded) continue

    // 이미 동일 커맨드가 등록되어 있으면 스킵
    const alreadyRegistered = settings.hooks[event].some(entry =>
      Array.isArray(entry.hooks) &&
      entry.hooks.some(h => h.type === 'command' && h.command === hookCmd)
    )
    if (alreadyRegistered) continue

    settings.hooks[event].push({
      hooks: [{ type: 'command', command: hookCmd }],
    })
    addedCount++
  }

  if (addedCount === 0) {
    console.log('[install] 이미 모든 훅이 등록되어 있습니다.')
    return
  }

  // 백업 후 저장
  if (fs.existsSync(SETTINGS)) {
    fs.copyFileSync(SETTINGS, `${SETTINGS}.bak`)
    console.log(`[install] 기존 settings.json 백업: ${SETTINGS}.bak`)
  } else {
    fs.mkdirSync(path.dirname(SETTINGS), { recursive: true })
  }

  fs.writeFileSync(SETTINGS, JSON.stringify(settings, null, 2), 'utf8')
  console.log(`[install] ${addedCount}개 이벤트 훅 등록 완료: ${SETTINGS}`)
  console.log(`[install] Node.js 경로: ${nodeBin}`)
  console.log(`[install] 훅 스크립트 경로: ${HOOK_SCRIPT}`)
}

run()
