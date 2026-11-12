import { expect, test } from 'claude-code/testing'

test('a session with work writes one entry and updates it in place', async ($, on) => {
  const files: Record<string, string> = {}
  let clock = Date.UTC(2026, 10, 12, 9, 30)

  on('command.register', () => ({ value: { command: 'worklog' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.root', () => ({ value: '/proj' }))
  on('session.id', () => ({ value: 'abc' }))
  on('clock.now', () => ({ value: clock }))
  on('fs.exists', (_, e) => ({ value: e.path in files }))
  on('fs.read', (_, e) => ({ value: files[e.path] ?? '' }))
  on('fs.write', (_, e) => {
    files[e.path] = e.text

    return { value: undefined }
  })
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('tool.call', (_, e) =>
    e.tool === 'Bash' && e.command === 'false'
      ? { result: {}, isError: true }
      : { result: {} },
  )
  on('turn.complete', (_, e) => ({ text: e.answer }))

  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })

  await $.prompt.submit({ text: 'Fix the login bug' } as Parameters<typeof $.prompt.submit>[0])
  await $.turn.complete({ answer: 'Just an answer.', durationMs: 1, isAborted: false, turnId: 't0', reason: 'answer' })
  expect(files['/proj/WORKLOG.md']).toBe(undefined)

  await $.tool.call({ tool: 'Edit', file_path: '/proj/src/login.ts', old_string: 'a', new_string: 'b' })
  await $.tool.call({ tool: 'Bash', command: 'npm test' })
  await $.tool.call({ tool: 'Bash', command: 'false' })
  await $.turn.complete({ answer: 'Fixed the bug.\nTests not run yet.', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })

  const first = files['/proj/WORKLOG.md'] ?? ''
  expect(first.includes('# Work log')).toBe(true)
  expect(first.includes('· Fix the login bug')).toBe(true)
  expect(first.includes('- `src/login.ts`')).toBe(true)
  expect(first.includes('**Commands:** 2 run, 1 failed')).toBe(true)
  expect(first.includes('> Tests not run yet.')).toBe(true)

  await $.prompt.submit({ text: 'Now run the tests' } as Parameters<typeof $.prompt.submit>[0])
  await $.tool.call({ tool: 'Bash', command: 'npm test' })
  await $.turn.complete({ answer: 'All tests pass.', durationMs: 1, isAborted: false, turnId: 't2', reason: 'answer' })

  const second = files['/proj/WORKLOG.md'] ?? ''
  expect(second.split('<!-- session:abc -->').length).toBe(2)
  expect(second.includes('- Now run the tests')).toBe(true)
  expect(second.includes('**Commands:** 3 run, 1 failed')).toBe(true)
  expect(second.includes('> All tests pass.')).toBe(true)
  expect(second.includes('Tests not run yet.')).toBe(false)
})

test('entries of other sessions are kept', async ($, on) => {
  const old = '# Work log\n\n<!-- session:old -->\n## earlier\n<!-- /session:old -->\n'
  const files: Record<string, string> = { '/proj/WORKLOG.md': old }

  on('command.register', () => ({ value: { command: 'worklog' } }))
  on('session.root', () => ({ value: '/proj' }))
  on('session.id', () => ({ value: 'new' }))
  on('clock.now', () => ({ value: 0 }))
  on('fs.exists', (_, e) => ({ value: e.path in files }))
  on('fs.read', (_, e) => ({ value: files[e.path] ?? '' }))
  on('fs.write', (_, e) => {
    files[e.path] = e.text

    return { value: undefined }
  })
  on('tool.call', () => ({ result: {} }))
  on('turn.complete', (_, e) => ({ text: e.answer }))

  await $.tool.call({ tool: 'Bash', command: 'ls' })
  await $.turn.complete({ answer: 'Done.', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })

  const text = files['/proj/WORKLOG.md'] ?? ''
  expect(text.startsWith(old.trimEnd())).toBe(true)
  expect(text.includes('<!-- session:new -->')).toBe(true)
})
