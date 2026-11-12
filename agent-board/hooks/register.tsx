import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { BoardAgent, BoardStatus } from '../types'

const PANE = 'agent-board'
const TITLE = 'Agent board'
const KEEP = 100

const agents = atom({ plugin: 'agent-board', key: 'agents' } as const, [], {
  shape: 'agents-1',
})

const oneLine = (text: string, max: number): string => {
  const flat = text.replace(/\s+/g, ' ').trim()

  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

const blank = (id: string, at: number): BoardAgent => ({
  id,
  name: 'Agent',
  type: '',
  model: '',
  brief: '',
  status: 'running',
  startedAt: at,
  ms: 0,
  tools: 0,
  tokens: 0,
  result: '',
})

// Changes one agent's row, adding the row when the board has none for it.
const upsert = async (
  $: EngineInterface,
  id: string,
  change: (row: BoardAgent) => BoardAgent,
): Promise<void> => {
  const at = await $.clock.now()
  await update($, agents, list =>
    list.some(row => row.id === id)
      ? list.map(row => (row.id === id ? change(row) : row))
      : [...list, change(blank(id, at))].slice(-KEEP),
  )
}

const tokens = (n: number): string =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)

const span = (ms: number): string => {
  const seconds = Math.round(ms / 1000)

  return seconds >= 60 ? `${Math.floor(seconds / 60)}m ${seconds % 60}s` : `${seconds}s`
}

const clock = (at: number): string => {
  const d = new Date(at)
  const two = (n: number) => String(n).padStart(2, '0')

  return `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`
}

const MARK: Record<BoardStatus, string> = { running: '…', done: '✓', failed: '✗', stopped: '⊘' }
const COLOR: Record<BoardStatus, string> = {
  running: 'warning',
  done: 'success',
  failed: 'error',
  stopped: 'subtle',
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'board',
      description: 'Open the agent board: every subagent with its brief, status and token spend',
    })

    return next(e)
  })

  on('command.run', { command: 'board' }, async $ => {
    await $.ui.open({ id: PANE, title: TITLE })
    const list = await read($, agents)
    const running = list.filter(row => row.status === 'running').length

    return { text: `Agent board opened: ${list.length} agents, ${running} running.` }
  })

  on('agent.spawn', async ($, e, next) => {
    const started = await next(e)
    if (started.deny === undefined && started.agentId !== undefined) {
      await upsert($, started.agentId, row => ({
        ...row,
        name: oneLine(e.description, 80) || row.name,
        type: e.subagentType,
        model: started.model,
        brief: oneLine(e.prompt, 400),
      }))
      void $.ui.open({ id: PANE, title: TITLE })
    }

    return started
  })

  on('turn.start', async ($, e, next) => {
    if (e.agentId !== undefined) {
      const brief = oneLine(e.text, 400)
      await upsert($, e.agentId, row => ({
        ...row,
        status: 'running',
        brief: row.brief === '' ? brief : row.brief,
      }))
    }

    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const agentId = (e as unknown as Record<string, unknown>)['agentId']
    if (typeof agentId === 'string') {
      await upsert($, agentId, row => ({ ...row, tools: row.tools + 1 }))
    }

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId !== undefined) {
      const used =
        e.usage === undefined
          ? 0
          : e.usage.input_tokens +
            e.usage.output_tokens +
            e.usage.cache_read_input_tokens +
            e.usage.cache_creation_input_tokens
      const status: BoardStatus =
        e.reason === 'aborted' ? 'stopped' : e.reason === 'answer' ? 'done' : 'failed'
      const model = e.usage?.model
      await upsert($, e.agentId, row => ({
        ...row,
        status,
        ms: row.ms + e.durationMs,
        tokens: row.tokens + used,
        model: row.model === '' && model !== undefined ? model : row.model,
        result: oneLine(e.answer, 300),
      }))
    }

    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const list = await read($, agents)
    const running = list.filter(row => row.status === 'running').length
    const failed = list.filter(row => row.status === 'failed').length
    const spent = list.reduce((sum, row) => sum + row.tokens, 0)

    return (
      <Box flexDirection="column" gap={1}>
        <Box justifyContent="space-between">
          <Box>
            <Text bold>
              {list.length} {list.length === 1 ? 'agent' : 'agents'} · {running} running ·{' '}
              {tokens(spent)} tokens
            </Text>
            {failed > 0 && <Text color="error"> · {failed} failed</Text>}
          </Box>
          <Button key="clear" label="Clear finished" onPress={() =>
            update($, agents, rows => rows.filter(row => row.status === 'running'))
          } />
        </Box>
        {list.length === 0 && <Text dimColor>No agents dispatched yet.</Text>}
        {[...list].reverse().map(row => (
          <Box
            flexDirection="column"
            borderStyle="round"
            borderColor={row.status === 'running' ? 'claude' : 'subtle'}
            paddingX={1}
          >
            <Box>
              <Text color={COLOR[row.status]}>{MARK[row.status]} </Text>
              <Text bold wrap="truncate-end">
                {row.name}
              </Text>
            </Box>
            <Text dimColor>
              {[
                row.type,
                row.model,
                `${row.tools} ${row.tools === 1 ? 'tool call' : 'tool calls'}`,
                `${tokens(row.tokens)} tokens`,
                row.status === 'running' ? `started ${clock(row.startedAt)}` : span(row.ms),
              ]
                .filter(part => part !== '')
                .join(' · ')}
            </Text>
            {row.brief !== '' && <Text dimColor>Brief: {row.brief}</Text>}
            {row.result !== '' && <Text>Result: {row.result}</Text>}
          </Box>
        ))}
      </Box>
    )
  })
}
