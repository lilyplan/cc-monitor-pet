#!/usr/bin/env node
/**
 * CC Monitor Pet — MCP server.
 * Exposes the signal_pet tool so any MCP-capable Claude client
 * can drive the pet's state.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { postState, readToken } from '../src/lib/pet-client.js'

const server = new Server(
  { name: 'cc-monitor-pet', version: '0.1.0' },
  { capabilities: { tools: {} } },
)

const TOOL_DESCRIPTION = [
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
].join('\n')

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'signal_pet',
      description: TOOL_DESCRIPTION,
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

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params

  if (name !== 'signal_pet') {
    return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true }
  }

  const { state, event = 'MCPSignal' } = args
  try {
    await postState({ event, state }, { token: readToken() })
    return { content: [{ type: 'text', text: `✅ 펫 상태 변경: ${state}` }] }
  } catch (err) {
    return { content: [{ type: 'text', text: `⚠️ 펫 서버 연결 실패 (앱이 실행 중인지 확인): ${err.message}` }] }
  }
})

const transport = new StdioServerTransport()
await server.connect(transport)
