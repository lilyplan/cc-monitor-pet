#!/usr/bin/env node
/**
 * CC Monitor Pet — MCP 서버
 *
 * Claude Code / Claude Desktop / co-works 등 MCP를 지원하는
 * 모든 Claude 환경에서 펫에 신호를 보낼 수 있도록 합니다.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import http from 'http'
import fs   from 'fs'
import path from 'path'
import os   from 'os'

const PET_HOST   = '127.0.0.1'
const PET_PORT   = 23333
const TOKEN_PATH = path.join(os.homedir(), '.cc-monitor-pet.token')

// 인증 토큰 읽기 (앱 미실행 시 빈 문자열)
let secretToken = ''
try { secretToken = fs.readFileSync(TOKEN_PATH, 'utf8').trim() } catch {}

// ── MCP 서버 초기화 ──────────────────────────────────────────

const server = new Server(
  { name: 'cc-monitor-pet', version: '0.1.0' },
  { capabilities: { tools: {} } }
)

// ── 도구 목록 ─────────────────────────────────────────────────

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'signal_pet',
      description: [
        'CC Monitor Pet 캐릭터의 상태를 변경합니다.',
        '작업을 시작할 때, 완료할 때, 오류가 발생할 때 호출하세요.',
        '',
        '상태 목록:',
        '- working   : 작업 중 (타이핑 애니메이션)',
        '- thinking  : 생각 중',
        '- juggling  : 병렬 작업 중',
        '- error     : 오류 발생 (3초 후 자동 복귀)',
        '- notification : 완료 또는 주의 필요 (점프 후 자동 복귀)',
        '- idle      : 대기 상태로 복귀',
      ].join('\n'),
      inputSchema: {
        type: 'object',
        properties: {
          state: {
            type: 'string',
            enum: ['working', 'thinking', 'juggling', 'error', 'notification', 'idle'],
            description: '전환할 상태',
          },
          event: {
            type: 'string',
            description: '이벤트 이름 (선택, 로깅용)',
          },
        },
        required: ['state'],
      },
    },
  ],
}))

// ── 도구 실행 ─────────────────────────────────────────────────

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params

  if (name !== 'signal_pet') {
    return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true }
  }

  // 토큰이 갱신될 수 있으므로 매 요청마다 재읽기
  try { secretToken = fs.readFileSync(TOKEN_PATH, 'utf8').trim() } catch {}

  const { state, event = 'MCPSignal' } = args

  try {
    await postToPet({ event, state })
    return {
      content: [{ type: 'text', text: `✅ 펫 상태 변경: ${state}` }],
    }
  } catch (err) {
    return {
      content: [{ type: 'text', text: `⚠️ 펫 서버 연결 실패 (앱이 실행 중인지 확인): ${err.message}` }],
    }
  }
})

// ── 펫 서버로 POST 전송 ───────────────────────────────────────

function postToPet(payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload)
    const req = http.request(
      {
        hostname: PET_HOST,
        port:     PET_PORT,
        path:     '/state',
        method:   'POST',
        headers:  {
          'Content-Type':   'application/json',
          'Content-Length': Buffer.byteLength(body),
          'X-Pet-Token':    secretToken,
        },
        timeout: 1000,
      },
      (res) => {
        res.resume()
        resolve()
      }
    )
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')) })
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

// ── 시작 ─────────────────────────────────────────────────────

const transport = new StdioServerTransport()
await server.connect(transport)
