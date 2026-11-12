import type { EngineInterface, Register } from 'claude-code'

const EVERY_MS = 60_000
const SHARE = '/Volumes/FM'
const CWD = 'case "$PWD" in "$HOME"*) echo "~${PWD#"$HOME"}";; *) echo "$PWD";; esac'
const TOUCHES_ENV = /\b(cd|git\s+(checkout|switch|worktree)|mount|umount)\b/

type Engine = EngineInterface

const run = async (
  $: Engine,
  argv: string[],
): Promise<{ ok: boolean; out: string }> => {
  try {
    const ran = await $.process.run(argv, { timeoutMs: 8000 })

    return { ok: ran.exitCode === 0, out: ran.stdout.trim() }
  } catch {
    return { ok: false, out: '' }
  }
}

const check = async ($: Engine): Promise<string> => {
  const [cwd, share, branch] = await Promise.all([
    run($, ['sh', '-c', CWD]),
    run($, ['test', '-d', SHARE]),
    run($, ['git', 'rev-parse', '--abbrev-ref', 'HEAD']),
  ])

  const parts = [
    cwd.ok && cwd.out ? cwd.out : 'cwd ?',
    `FM ${share.ok ? '✓' : '✗'}`,
  ]
  if (branch.ok && branch.out) {
    parts.push(`⎇ ${branch.out}`)
  }

  return parts.join(' · ')
}

let last = 'env: checking…'
let isBusy = false

const refresh = async ($: Engine): Promise<string> => {
  if (isBusy) {
    return last
  }
  isBusy = true
  try {
    last = await check($)
    $.ui.status(last)
  } finally {
    isBusy = false
  }

  return last
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'env',
      description: 'Re-check working directory, FM share and branch',
    })
    $.ui.status(last)
    void refresh($)
    $.clock.every(EVERY_MS, () => void refresh($))

    return next(e)
  })

  on('command.run', { command: 'env' }, async $ => ({ text: await refresh($) }))

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const ran = await next(e)
    if (TOUCHES_ENV.test(e.command)) {
      void refresh($)
    }

    return ran
  })
}
