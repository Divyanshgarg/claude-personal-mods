import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Evidence } from '../types'

const EDITS = ['Edit', 'Write', 'NotebookEdit']
// A command that checks work: tests, a build, a lint or a type-check.
const CHECK =
  /\b(tests?|pytest|jest|vitest|mocha|rspec|phpunit|tsc|typecheck|type-check|lint|eslint|ruff|mypy|flake8|build|compile|validate|verify|clippy|vet|mvn|gradle|gradlew|make|ctest|xcodebuild)\b/i
// Words in an answer that claim the work is finished.
const CLAIM =
  /\b(done|fixed|finished|completed?|implemented|resolved|works|working|passes|passing|verified|ready|all set|successfully)\b/i
const EMPTY: Evidence = {
  edited: [],
  check: null,
  hasClaimed: false,
  dirty: -1,
  unpushed: -1,
}

const evidence = atom({ plugin: 'evidence-band', key: 'evidence' } as const, EMPTY, {
  shape: 'evidence-1',
})
const isHidden = atom({ plugin: 'evidence-band', key: 'isHidden' } as const, false)

type Verdict = { level: 'quiet' | 'ok' | 'warn' | 'bad'; text: string }

const short = (command: string): string => {
  const flat = command.replace(/\s+/g, ' ').trim()

  return flat.length > 48 ? `${flat.slice(0, 47)}…` : flat
}

const files = (n: number): string => `${n} ${n === 1 ? 'file' : 'files'}`

const judge = (state: Evidence): Verdict => {
  if (state.check !== null && !state.check.isPassing) {
    return {
      level: 'bad',
      text: `${state.hasClaimed ? 'Claimed done, but the' : 'The'} last check failed: ${short(state.check.command)}`,
    }
  }
  if (state.edited.length > 0) {
    return state.hasClaimed
      ? {
          level: 'bad',
          text: `Claimed done, not verified: ${files(state.edited.length)} edited since the last passing check`,
        }
      : {
          level: 'warn',
          text: `Not verified yet: ${files(state.edited.length)} edited since the last passing check`,
        }
  }
  if (state.check !== null) {
    return { level: 'ok', text: `Verified: ${short(state.check.command)} passed after the last edit` }
  }

  return { level: 'quiet', text: 'No edits to verify this session.' }
}

const repo = (state: Evidence): string => {
  const parts = []
  if (state.dirty > 0) {
    parts.push(`${state.dirty} uncommitted`)
  }
  if (state.unpushed > 0) {
    parts.push(`${state.unpushed} unpushed`)
  }

  return parts.join(' · ')
}

const count = async ($: EngineInterface, argv: string[]): Promise<number> => {
  try {
    const ran = await $.process.run(argv, { timeoutMs: 8000 })
    if (ran.exitCode !== 0) {
      return -1
    }

    return ran.stdout.split('\n').filter(line => line.trim() !== '').length
  } catch {
    return -1
  }
}

const MARK = { quiet: '·', ok: '✓', warn: '!', bad: '✗' } as const
const COLOR = { quiet: 'subtle', ok: 'success', warn: 'warning', bad: 'error' } as const

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'evidence',
      description: 'Show whether this session\'s edits are backed by a passing check',
    })

    return next(e)
  })

  on('command.run', { command: 'evidence' }, async $ => {
    await update($, isHidden, () => false)
    const state = await read($, evidence)
    const verdict = judge(state)
    const git = repo(state)

    return { text: `${MARK[verdict.level]} ${verdict.text}${git === '' ? '' : ` · ${git}`}` }
  })

  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny !== undefined) {
      return ran
    }
    const tool = String(e.tool)
    const input = e as unknown as Record<string, unknown>
    const path = input['file_path'] ?? input['notebook_path']
    const command = input['command']

    if (EDITS.includes(tool) && typeof path === 'string' && ran.isError !== true) {
      await update($, evidence, state => ({
        ...state,
        hasClaimed: false,
        edited: state.edited.includes(path) ? state.edited : [...state.edited, path],
      }))
      await update($, isHidden, () => false)
    } else if (tool === 'Bash' && typeof command === 'string' && CHECK.test(command)) {
      const isPassing = ran.isError !== true
      await update($, evidence, state => ({
        ...state,
        check: { command, isPassing },
        edited: isPassing ? [] : state.edited,
      }))
      await update($, isHidden, () => false)
    }

    return ran
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      const [dirty, unpushed] = await Promise.all([
        count($, ['git', 'status', '--porcelain']),
        count($, ['git', 'rev-list', '@{upstream}..HEAD']),
      ])
      const hasClaimed = CLAIM.test(e.answer)
      const before = await read($, evidence)
      const state: Evidence = { ...before, hasClaimed, dirty, unpushed }
      await update($, evidence, () => state)

      const verdict = judge(state)
      if (verdict.level === 'bad') {
        await update($, isHidden, () => false)
        $.ui.toast(verdict.text, { timeoutMs: 8000 })
      }
    }

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const state = await read($, evidence)
    const verdict = judge(state)
    const git = repo(state)
    const isQuiet =
      e.props.hasSurvey ||
      (await read($, isHidden)) ||
      (verdict.level === 'quiet' && git === '')

    if (isQuiet) {
      return next(e)
    }

    const { Box, Button, Text } = $.ui.resolve(e)

    return (
      <Box>
        <Text color={COLOR[verdict.level]} bold={verdict.level === 'bad'}>
          {MARK[verdict.level]} {verdict.level === 'quiet' ? 'No edits to verify' : verdict.text}
        </Text>
        <Text dimColor>{git === '' ? ' ' : ` · ${git} `}</Text>
        <Button key="hide" label="Hide" onPress={() => update($, isHidden, () => true)} />
      </Box>
    )
  })
}
