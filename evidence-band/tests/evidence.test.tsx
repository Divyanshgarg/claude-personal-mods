import { expect, test } from 'claude-code/testing'

const BAND = {
  plugin: 'evidence-band',
  component: 'AbovePrompt',
  requestId: 'band',
  props: { hasSurvey: false, isCollapsed: false, isWorking: false, maxRows: 4, bodyColumns: 100, scroll: { offset: 0, bodyRows: 4 }, view: {} },
} as const

const turn = (answer: string, turnId: string) =>
  ({ answer, durationMs: 1, isAborted: false, turnId, reason: 'answer' }) as const

test('the band follows edits, checks and claims', async ($, on) => {
  let porcelain = ' M a.ts\n M b.ts\n'

  on('command.register', () => ({ value: { command: 'evidence' } }))
  on('ui.toast', () => ({ value: undefined }))
  on('process.run', (_, e) => ({
    value: {
      exitCode: e.argv[1] === 'status' ? 0 : 128,
      stdout: e.argv[1] === 'status' ? porcelain : '',
      stderr: '',
      isStdoutTruncated: false,
      isStderrTruncated: false,
    },
  }))
  on('tool.call', (_, e) =>
    e.tool === 'Bash' && e.command === 'npm test -- --fail'
      ? { result: {}, isError: true }
      : { result: {} },
  )
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>engine</Text>
  })

  const shown = async () => {
    const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
    const all = await ui.find({ type: 'Text', text: /engine|verif|check|Verified/i })
    await ui.unmount()

    return all?.text ?? ''
  }

  // Nothing edited: the mod leaves the band to the engine.
  expect(await shown()).toBe('engine')

  await $.tool.call({ tool: 'Edit', file_path: '/p/a.ts', old_string: 'a', new_string: 'b' })
  await $.tool.call({ tool: 'Bash', command: 'git status' })
  await $.turn.complete(turn('I looked into it.', 't1'))
  expect(await shown()).toBe('! Not verified yet: 1 file edited since the last passing check')

  await $.turn.complete(turn('The bug is fixed.', 't2'))
  expect(await shown()).toBe('✗ Claimed done, not verified: 1 file edited since the last passing check')

  await $.tool.call({ tool: 'Bash', command: 'npm test -- --fail' })
  await $.turn.complete(turn('Still looking.', 't3'))
  expect(await shown()).toBe('✗ The last check failed: npm test -- --fail')

  await $.tool.call({ tool: 'Bash', command: 'npm test' })
  await $.turn.complete(turn('Done, tests pass.', 't4'))
  expect(await shown()).toBe('✓ Verified: npm test passed after the last edit')

  // A later edit puts it back to unverified.
  await $.tool.call({ tool: 'Write', file_path: '/p/b.ts', content: 'x' })
  expect(await shown()).toBe('! Not verified yet: 1 file edited since the last passing check')

  porcelain = ''
})

test('hide dismisses the band until the evidence changes', async ($, on) => {
  on('tool.call', () => ({ result: {} }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>engine</Text>
  })

  await $.tool.call({ tool: 'Edit', file_path: '/p/a.ts', old_string: 'a', new_string: 'b' })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /Not verified/ })) !== undefined).toBe(true)
  await ui.press({ key: 'hide' })
  expect((await ui.find({ type: 'Text', text: /engine/ }))?.text).toBe('engine')
  await ui.unmount()

  await $.tool.call({ tool: 'Edit', file_path: '/p/c.ts', old_string: 'a', new_string: 'b' })
  const again = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await again.find({ type: 'Text', text: /Not verified/ }))?.text).toBe(
    '! Not verified yet: 2 files edited since the last passing check',
  )
  await again.unmount()
})
