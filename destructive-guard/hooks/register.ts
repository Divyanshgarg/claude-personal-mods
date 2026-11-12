import type { Register } from 'claude-code'

type Rule = { what: string; pattern: RegExp }

// Each rule names what the command does and matches it anywhere in the line.
const RULES: Rule[] = [
  { what: 'recursive delete', pattern: /\brm\s+(?:-\w+\s+)*(?:-\w*[rR]\w*|--recursive)\b/ },
  { what: 'force push', pattern: /\bgit\s+push\b[^;&|\n]*(?:\s--force(?:-with-lease)?\b|\s-\w*f\w*\b)/ },
  { what: 'discards local git changes', pattern: /\bgit\s+(?:reset\s+--hard|clean\s+-\w*f|checkout\s+--\s|restore\s+(?:--staged\s+)?\.|stash\s+(?:drop|clear))/ },
  { what: 'deletes a git branch or tag', pattern: /\bgit\s+(?:branch\s+-\w*D|push\s+\S+\s+(?:--delete|:\S+)|tag\s+-d)/ },
  { what: 'switches the docker context', pattern: /\bdocker\s+context\s+(?:use|rm|remove)\b/ },
  { what: 'removes docker data', pattern: /\bdocker\s+(?:system\s+prune|volume\s+(?:rm|prune)|image\s+prune|container\s+prune|rm\s+-\w*f|compose\s+[^;&|\n]*\bdown\b[^;&|\n]*\s(?:-v|--volumes)\b)/ },
  { what: 'Oracle import (overwrites schema data)', pattern: /\b(?:impdp|imp)\b(?=\s|$)/ },
  { what: 'drops or empties database objects', pattern: /\b(?:drop\s+(?:user|schema|table|database|tablespace|index|view|sequence)|truncate\s+table)\b/i },
  { what: 'deletes every row (no WHERE)', pattern: /\bdelete\s+from\s+[\w."]+\s*(?:;|"|'|$)/i },
  { what: 'overwrites or erases a disk', pattern: /\b(?:mkfs(?:\.\w+)?|diskutil\s+(?:erase\w*|partitionDisk)|dd\b[^;&|\n]*\bof=)/ },
  { what: 'destroys infrastructure', pattern: /\b(?:terraform\s+destroy|kubectl\s+delete|helm\s+uninstall)\b/ },
]

// The part of the line the rule matched in: one command of a chain.
const segment = (command: string, at: number): string => {
  const before = command.slice(0, at)
  const start = Math.max(
    before.lastIndexOf('&&'),
    before.lastIndexOf(';'),
    before.lastIndexOf('|'),
    before.lastIndexOf('\n'),
  )
  const rest = command.slice(at)
  const stop = rest.search(/&&|;|\||\n/)
  const piece = command
    .slice(start === -1 ? 0 : start + 1, stop === -1 ? command.length : at + stop)
    .replace(/^[&|;\s]+/, '')
    .replace(/\s+/g, ' ')
    .trim()

  return piece.length > 240 ? `${piece.slice(0, 239)}…` : piece
}

const RUN = 'Run it'
const BLOCK = 'Block it'

const judge = (command: string): string | null => {
  for (const rule of RULES) {
    const match = rule.pattern.exec(command)
    if (match !== null) {
      return `Destructive command (${rule.what}): ${segment(command, match.index)}`
    }
  }

  return null
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'guard',
      description: 'List the kinds of shell command the destructive guard asks about',
    })

    return next(e)
  })

  on('command.run', { command: 'guard' }, () => ({
    text: `Asks before a shell command that: ${RULES.map(rule => rule.what).join('; ')}.`,
  }))

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const reason = judge(e.command)
    if (reason === null) {
      return next(e)
    }
    let answer = BLOCK
    try {
      answer = await $.ui.ask(`${reason}\n\nRun this command?`, {
        header: 'Guard',
        options: [RUN, BLOCK],
      })
    } catch {
      // Dismissed, or nobody to ask: the command does not run.
    }

    return answer === RUN
      ? next(e)
      : { deny: `destructive-guard: the user did not approve this command, so it was not run. ${reason}` }
  }).catch(($, e, next) =>
    next.called
      ? next(e)
      : { deny: 'destructive-guard: the guard failed to judge this command, so it was not run.' },
  )
}
