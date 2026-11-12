import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { LedgerEntry, LedgerStatus } from '../types'

const PANE = 'session-ledger'
const TITLE = 'Session ledger'
const KEEP = 500

const entries = atom(
  { plugin: 'session-ledger', key: 'entries' } as const,
  [],
  { shape: 'entries-1' },
)

const FIELDS = [
  'command',
  'file_path',
  'notebook_path',
  'description',
  'pattern',
  'url',
  'query',
  'skill',
  'path',
]

const describe = (input: unknown): string => {
  const fields = input as Record<string, unknown>
  for (const name of FIELDS) {
    const value = fields[name]
    if (typeof value === 'string' && value.length > 0) {
      return value.replace(/\s+/g, ' ').slice(0, 120)
    }
  }

  return ''
}

const clock = (at: number): string => {
  const d = new Date(at)
  const two = (n: number) => String(n).padStart(2, '0')

  return `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`
}

const MARK: Record<LedgerStatus, string> = {
  runs: '…',
  ok: '✓',
  fail: '✗',
  denied: '⊘',
}

const isEdit = (tool: string) =>
  tool === 'Edit' || tool === 'Write' || tool === 'NotebookEdit'

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'ledger',
      description: 'Open the session ledger: every tool call, timed, with pass/fail',
    })
    void $.ui.open({ id: PANE, title: TITLE })

    return next(e)
  })

  on('command.run', { command: 'ledger' }, async $ => {
    await $.ui.open({ id: PANE, title: TITLE })
    const list = await read($, entries)
    const failed = list.filter(one => one.status === 'fail').length

    return {
      text: `Session ledger opened: ${list.length} calls logged, ${failed} failed.`,
    }
  })

  on('tool.call', async ($, e, next) => {
    const at = await $.clock.now()
    const entry: LedgerEntry = {
      id: e.tool_use_id,
      at,
      tool: String(e.tool),
      detail: describe(e),
      status: 'runs',
      ms: 0,
    }
    await update($, entries, list => [...list, entry].slice(-KEEP))

    const ran = await next(e)

    const status: LedgerStatus =
      ran.deny !== undefined ? 'denied' : ran.isError === true ? 'fail' : 'ok'
    const ms = (await $.clock.now()) - at
    await update($, entries, list =>
      list.map(one => (one.id === entry.id ? { ...one, status, ms } : one)),
    )

    return ran
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const list = await read($, entries)
    const room = Math.max(1, (e.viewport?.rows ?? 30) - 6)

    const edits = new Set(
      list.filter(one => isEdit(one.tool)).map(one => one.detail),
    ).size
    const commands = list.filter(one => one.tool === 'Bash').length
    const agents = list.filter(one => one.tool === 'Agent').length
    const failed = list.filter(one => one.status === 'fail').length
    const denied = list.filter(one => one.status === 'denied').length

    return (
      <Box flexDirection="column">
        <Box>
          <Text bold>
            {list.length} calls · {edits} files edited · {commands} commands ·{' '}
            {agents} agents ·{' '}
          </Text>
          <Text bold color={failed > 0 ? 'red' : undefined}>
            {failed} failed
          </Text>
          <Text bold>{denied > 0 ? ` · ${denied} denied` : ''} </Text>
          <Button
            key="clear"
            label="Clear"
            onPress={() => update($, entries, () => [])}
          />
        </Box>
        {list.length === 0 && <Text dimColor>No tool calls yet.</Text>}
        {list.slice(-room).map(one => (
          <Box>
            <Text dimColor>{clock(one.at)} </Text>
            <Text
              color={
                one.status === 'fail' || one.status === 'denied'
                  ? 'red'
                  : one.status === 'ok'
                    ? 'green'
                    : undefined
              }
            >
              {MARK[one.status]}{' '}
            </Text>
            <Text bold>{one.tool} </Text>
            <Text wrap="truncate-end">{one.detail}</Text>
            <Text dimColor>
              {one.status === 'runs' ? '' : ` ${(one.ms / 1000).toFixed(1)}s`}
            </Text>
          </Box>
        ))}
      </Box>
    )
  })
}
