import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { WorklogEntry, WorklogSession } from '../types'

const FILE = 'WORKLOG.md'
const PANE = 'worklog'
const TITLE = 'Work log'
const SHOWN = 30
const NONE = 'none'
const HEADER = '# Work log\n\nOne entry per Claude session, kept by the worklog mod.\n'
const EDITS = ['Edit', 'Write', 'NotebookEdit']
const EMPTY: WorklogSession = {
  startedAt: 0,
  prompts: [],
  files: [],
  commands: 0,
  failed: 0,
  outcome: '',
}

const session = atom({ plugin: 'worklog', key: 'session' } as const, EMPTY, {
  shape: 'session-1',
})

const entries = atom({ plugin: 'worklog', key: 'entries' } as const, [], {
  shape: 'entries-1',
})
// The entry drawn open: a session's id, '' for this session's, NONE for none.
const expanded = atom({ plugin: 'worklog', key: 'expanded' } as const, '', {
  shape: 'expanded-1',
})

const between = (lines: string[], from: string, to: string): string[] => {
  const start = lines.findIndex(line => line.startsWith(from))
  if (start === -1) {
    return []
  }
  const rest = lines.slice(start + 1)
  const end = rest.findIndex(line => line.startsWith(to))

  return end === -1 ? rest : rest.slice(0, end)
}

// Reads back the entries `block` wrote, oldest first.
const parse = (text: string): WorklogEntry[] => {
  const found: WorklogEntry[] = []
  const pattern = /<!-- session:([^\s>]+) -->\n([\s\S]*?)\n<!-- \/session:\1 -->/g
  for (const match of text.matchAll(pattern)) {
    const lines = (match[2] ?? '').split('\n')
    const counts = /\*\*Commands:\*\* (\d+) run, (\d+) failed/.exec(match[2] ?? '')
    found.push({
      id: match[1] ?? '',
      heading: (lines.find(line => line.startsWith('## ')) ?? '## Session').slice(3),
      asked: between(lines, '**Asked**', '**Files changed**')
        .filter(line => line.startsWith('- '))
        .map(line => line.slice(2)),
      files: between(lines, '**Files changed**', '**Commands:**')
        .filter(line => line.startsWith('- `'))
        .map(line => line.slice(3, -1)),
      commands: Number(counts?.[1] ?? 0),
      failed: Number(counts?.[2] ?? 0),
      outcome: between(lines, '**Where it stands**', '<!--')
        .filter(line => line.startsWith('>'))
        .map(line => line.replace(/^> ?/, ''))
        .join('\n'),
    })
  }

  return found
}

const oneLine = (text: string, max: number): string => {
  const flat = text.replace(/\s+/g, ' ').trim()

  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

const stamp = (at: number): string => {
  const d = new Date(at)
  const two = (n: number) => String(n).padStart(2, '0')

  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}`
}

const relative = (path: string, root: string): string =>
  path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path

const hasWork = (log: WorklogSession): boolean =>
  log.files.length > 0 || log.commands > 0

const block = (id: string, log: WorklogSession, root: string): string => {
  const lines = [
    `<!-- session:${id} -->`,
    `## ${stamp(log.startedAt)} · ${oneLine(log.prompts[0] ?? 'Session', 80)}`,
    '',
    '**Asked**',
    ...log.prompts.map(text => `- ${oneLine(text, 200)}`),
    '',
    `**Files changed** (${log.files.length})`,
    ...(log.files.length === 0
      ? ['- none']
      : log.files.map(path => `- \`${relative(path, root)}\``)),
    '',
    `**Commands:** ${log.commands} run, ${log.failed} failed`,
    '',
    '**Where it stands**',
    '',
    ...(log.outcome === '' ? ['_No final answer recorded._'] : log.outcome.split('\n').map(line => `> ${line}`)),
    `<!-- /session:${id} -->`,
  ]

  return lines.join('\n')
}

const merge = (existing: string, id: string, entry: string): string => {
  const open = `<!-- session:${id} -->`
  const close = `<!-- /session:${id} -->`
  const from = existing.indexOf(open)
  const to = existing.indexOf(close)
  if (from !== -1 && to > from) {
    return existing.slice(0, from) + entry + existing.slice(to + close.length)
  }
  const base = existing.trim() === '' ? HEADER : existing.replace(/\s+$/, '\n')

  return `${base}\n${entry}\n`
}

// Writes this session's entry, replacing the one it wrote before.
const save = async ($: EngineInterface): Promise<string | null> => {
  const log = await read($, session)
  if (!hasWork(log)) {
    return null
  }
  const root = await $.session.root()
  const id = await $.session.id()
  const path = `${root}/${FILE}`
  const existing = (await $.fs.exists(path)) ? await $.fs.read(path) : ''
  const text = merge(existing, id, block(id, log, root))
  await $.fs.write(path, text)
  await update($, entries, () => parse(text))

  return path
}

// Reads the project's WORKLOG.md into the pane's list.
const load = async ($: EngineInterface): Promise<void> => {
  const path = `${await $.session.root()}/${FILE}`
  const text = (await $.fs.exists(path)) ? await $.fs.read(path) : ''
  await update($, entries, () => parse(text))
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'worklog',
      description: `Open the work log pane and write this session's entry to ${FILE}`,
    })
    try {
      await load($)
    } catch {
      // An unreadable file leaves the list empty.
    }

    return next(e)
  })

  on('command.run', { command: 'worklog' }, async $ => {
    const path = await save($)
    if (path === null) {
      await load($)
    }
    await $.ui.open({ id: PANE, title: TITLE })

    return {
      text:
        path === null
          ? 'Work log pane opened. Nothing to log yet for this session: no files changed and no commands run.'
          : `Work log pane opened; entry written to ${path}.`,
    }
  })

  on('prompt.submit', async ($, e, next) => {
    if (e.isMeta !== true && e.command === undefined && e.text.trim() !== '') {
      const at = await $.clock.now()
      await update($, session, log => ({
        ...log,
        startedAt: log.startedAt === 0 ? at : log.startedAt,
        prompts: [...log.prompts, e.text].slice(-30),
      }))
    }

    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    const tool = String(e.tool)
    const input = e as unknown as Record<string, unknown>
    const path = input['file_path'] ?? input['notebook_path']
    const hasRun = ran.deny === undefined
    const isEdit =
      hasRun &&
      ran.isError !== true &&
      EDITS.includes(tool) &&
      typeof path === 'string' &&
      !path.endsWith(`/${FILE}`)

    if (isEdit || (hasRun && tool === 'Bash')) {
      const at = await $.clock.now()
      await update($, session, log => ({
        ...log,
        startedAt: log.startedAt === 0 ? at : log.startedAt,
        files:
          isEdit && !log.files.includes(path as string)
            ? [...log.files, path as string]
            : log.files,
        commands: log.commands + (tool === 'Bash' ? 1 : 0),
        failed: log.failed + (tool === 'Bash' && ran.isError === true ? 1 : 0),
      }))
    }

    return ran
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      try {
        if (e.answer.trim() !== '') {
          await update($, session, log => ({
            ...log,
            outcome: e.answer.trim().slice(0, 2000),
          }))
        }
        await save($)
      } catch {
        $.ui.toast(`worklog: could not write ${FILE}`)
      }
    }

    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button, Markdown } = $.ui.resolve(e)
    const all = await read($, entries)
    const open = await read($, expanded)
    const current = await $.session.id()
    const list = [...all].reverse().slice(0, SHOWN)

    return (
      <Box flexDirection="column" gap={1}>
        <Box justifyContent="space-between">
          <Text bold>
            {all.length} {all.length === 1 ? 'session' : 'sessions'} in {FILE}
          </Text>
          <Button key="refresh" label="Refresh" onPress={() => load($)} />
        </Box>
        {all.length === 0 && (
          <Text dimColor>
            No entries yet. One is written after the first turn that edits a
            file or runs a command.
          </Text>
        )}
        {list.map(entry => {
          const isCurrent = entry.id === current
          const isOpen = open === entry.id || (open === '' && isCurrent)

          return (
            <Box
              flexDirection="column"
              borderStyle="round"
              borderColor={isCurrent ? 'claude' : 'subtle'}
              paddingX={1}
            >
              <Box justifyContent="space-between">
                <Text bold wrap="truncate-end">
                  {entry.heading}
                </Text>
                <Button
                  key={`toggle-${entry.id}`}
                  label={isOpen ? 'Hide' : 'Show'}
                  onPress={() => update($, expanded, () => (isOpen ? NONE : entry.id))}
                />
              </Box>
              <Box>
                <Text dimColor>
                  {isCurrent ? 'this session · ' : ''}
                  {entry.files.length} {entry.files.length === 1 ? 'file' : 'files'} ·{' '}
                  {entry.commands} {entry.commands === 1 ? 'command' : 'commands'}
                </Text>
                {entry.failed > 0 && <Text color="error"> · {entry.failed} failed</Text>}
              </Box>
              {isOpen && (
                <Box flexDirection="column" marginTop={1}>
                  <Text bold>Asked</Text>
                  {entry.asked.map(text => (
                    <Text>• {text}</Text>
                  ))}
                  <Box marginTop={1}>
                    <Text bold>Files changed</Text>
                  </Box>
                  {entry.files.length === 0 && <Text dimColor>none</Text>}
                  {entry.files.map(path => (
                    <Text mono wrap="truncate-start">
                      {path}
                    </Text>
                  ))}
                  <Box marginTop={1}>
                    <Text bold>Where it stands</Text>
                  </Box>
                  {entry.outcome === '' ? (
                    <Text dimColor>No final answer recorded.</Text>
                  ) : (
                    <Markdown text={entry.outcome} />
                  )}
                </Box>
              )}
            </Box>
          )
        })}
        {all.length > SHOWN && (
          <Text dimColor>
            Showing the newest {SHOWN}; the rest are in {FILE}.
          </Text>
        )}
      </Box>
    )
  })
}
