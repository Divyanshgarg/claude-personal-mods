import { expect, test } from 'claude-code/testing'

const ASKS: [string, string][] = [
  ['rm -rf build/', 'Destructive command (recursive delete): rm -rf build/'],
  ['cd /tmp && rm -fr ./x && ls', 'Destructive command (recursive delete): rm -fr ./x'],
  ['sudo rm -v -r /var/data', 'Destructive command (recursive delete): sudo rm -v -r /var/data'],
  ['git push --force origin main', 'Destructive command (force push): git push --force origin main'],
  ['git push -f', 'Destructive command (force push): git push -f'],
  ['git push --force-with-lease', 'Destructive command (force push): git push --force-with-lease'],
  ['git reset --hard HEAD~3', 'Destructive command (discards local git changes): git reset --hard HEAD~3'],
  ['git clean -fd', 'Destructive command (discards local git changes): git clean -fd'],
  ['git branch -D feature', 'Destructive command (deletes a git branch or tag): git branch -D feature'],
  ['docker context use winbox', 'Destructive command (switches the docker context): docker context use winbox'],
  ['docker compose -f a.yml down -v', 'Destructive command (removes docker data): docker compose -f a.yml down -v'],
  ['docker system prune -af', 'Destructive command (removes docker data): docker system prune -af'],
  [
    'docker exec oracle impdp system/x@XE schemas=FM directory=DP dumpfile=a.dmp',
    'Destructive command (Oracle import (overwrites schema data)): docker exec oracle impdp system/x@XE schemas=FM directory=DP dumpfile=a.dmp',
  ],
  ['echo "DROP USER fm CASCADE;" | sqlplus / as sysdba', 'Destructive command (drops or empties database objects): echo "DROP USER fm CASCADE'],
  ['sqlplus -s u/p <<< "truncate table trades;"', 'Destructive command (drops or empties database objects): sqlplus -s u/p <<< "truncate table trades'],
  ['psql -c "delete from trades;"', 'Destructive command (deletes every row (no WHERE)): psql -c "delete from trades'],
  ['terraform destroy -auto-approve', 'Destructive command (destroys infrastructure): terraform destroy -auto-approve'],
]

const PASSES = [
  'ls -la',
  'rm notes.txt',
  'git push origin main',
  'git push -u origin feature',
  'git status',
  'docker context show',
  'docker context ls',
  'docker ps -a',
  'docker compose down',
  'npm run import',
  'psql -c "delete from trades where id = 4"',
  'grep -r "format" src',
]

type Asked = { questions: { question: string }[] }

// Stands for the engine beneath the mod: answers the guard's question with
// `reply()` (null dismisses it) and records the shell commands that ran.
const engine = (reply: () => string | null, asked: string[], ran: string[]) =>
  (_: unknown, e: { tool: string }) => {
    if (e.tool === 'AskUserQuestion') {
      const { questions } = e as unknown as Asked
      const question = questions[0]?.question ?? ''
      asked.push(question)
      const answer = reply()

      return answer === null
        ? { deny: 'dismissed' }
        : { result: { questions, answers: { [question]: answer } } }
    }
    if (e.tool === 'Bash') {
      ran.push((e as unknown as { command: string }).command)
    }

    return { result: {} }
  }

test('a destructive command runs only on "Run it", and the question names it', async ($, on) => {
  const asked: string[] = []
  const ran: string[] = []
  let answer = 'Run it'
  on('tool.call', engine(() => answer, asked, ran))

  for (const [command, reason] of ASKS) {
    asked.length = 0
    ran.length = 0
    answer = 'Run it'
    const allowed = await $.tool.call({ tool: 'Bash', command })
    expect(asked[0]).toBe(`${reason}\n\nRun this command?`)
    expect(allowed.deny).toBe(undefined)
    expect(ran.length).toBe(1)

    answer = 'Block it'
    const blocked = await $.tool.call({ tool: 'Bash', command })
    expect(typeof blocked.deny).toBe('string')
    expect(ran.length).toBe(1)
  }
})

test('ordinary commands run with no question', async ($, on) => {
  const asked: string[] = []
  const ran: string[] = []
  on('tool.call', engine(() => 'Block it', asked, ran))

  for (const command of PASSES) {
    const result = await $.tool.call({ tool: 'Bash', command })
    expect(`${command}: ${result.deny}`).toBe(`${command}: undefined`)
  }
  expect(asked.length).toBe(0)
  expect(ran.length).toBe(PASSES.length)
})

test('a dismissed question blocks the command, and other tools are left alone', async ($, on) => {
  const asked: string[] = []
  const ran: string[] = []
  on('tool.call', engine(() => null, asked, ran))

  const blocked = await $.tool.call({ tool: 'Bash', command: 'rm -rf /' })
  expect(typeof blocked.deny).toBe('string')
  expect(asked.length).toBe(1)
  expect(ran.length).toBe(0)

  const write = await $.tool.call({ tool: 'Write', file_path: '/x', content: 'rm -rf /' })
  expect(write.deny).toBe(undefined)
  expect(asked.length).toBe(1)
})
