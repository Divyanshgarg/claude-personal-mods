import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { WorklogSession } from '../types'

const FILE = 'WORKLOG.md'
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
  await $.fs.write(path, merge(existing, id, block(id, log, root)))

  return path
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'worklog',
      description: `Write this session's entry to ${FILE} now`,
    })

    return next(e)
  })

  on('command.run', { command: 'worklog' }, async $ => {
    const path = await save($)

    return {
      text:
        path === null
          ? 'Nothing to log yet: no files changed and no commands run this session.'
          : `Work log entry written to ${path}.`,
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
}
