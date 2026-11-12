import { expect, test } from 'claude-code/testing'

const PANE = {
  plugin: 'agent-board',
  component: 'Pane',
  requestId: 'agent-board',
  props: {
    title: 'Agent board',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

test('the board follows an agent from spawn to result', async ($, on) => {
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('clock.now', () => ({ value: 0 }))
  on('agent.spawn', () => ({ model: 'haiku', agentId: 'a1' }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('tool.call', () => ({ result: {} }))
  on('turn.complete', (_, e) => ({ text: e.answer }))

  await $.agent.spawn({ prompt: 'Find every caller of login()', description: 'Find login callers', subagentType: 'Explore' } as Parameters<typeof $.agent.spawn>[0])
  await $.turn.start({ text: 'Find every caller of login()', turnId: 't1', agentId: 'a1' })
  await $.tool.call({ tool: 'Bash', command: 'grep -r login', agentId: 'a1' } as Parameters<typeof $.tool.call>[0])
  await $.tool.call({ tool: 'Bash', command: 'ls' })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Text', text: /running ·/ }))?.text).toBe('1 agent · 1 running · 0 tokens')
    expect((await ui.find({ type: 'Text', text: /Find login callers/ }))?.text).toBe('Find login callers')
    expect((await ui.find({ type: 'Text', text: /tool call/ }))?.text.startsWith('Explore · haiku · 1 tool call · 0 tokens · started')).toBe(true)
    await ui.unmount()
  }

  await $.turn.complete({
    answer: 'Three callers:\nauth.ts, api.ts, cli.ts',
    durationMs: 75000,
    isAborted: false,
    turnId: 't1',
    agentId: 'a1',
    reason: 'answer',
    usage: { input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 10000, cache_creation_input_tokens: 1000, model: 'claude-haiku-5-5' },
  })

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /running ·/ }))?.text).toBe('1 agent · 0 running · 12.5k tokens')
  expect((await ui.find({ type: 'Text', text: /tool call/ }))?.text).toBe('Explore · haiku · 1 tool call · 12.5k tokens · 1m 15s')
  expect((await ui.find({ type: 'Text', text: /Result:/ }))?.text).toBe('Result: Three callers: auth.ts, api.ts, cli.ts')
  await ui.press({ key: 'clear' })
  expect((await ui.find({ type: 'Text', text: /No agents/ })) !== undefined).toBe(true)
  await ui.unmount()
})

test('an agent first heard at its end still gets a row, and a failure is marked', async ($, on) => {
  on('clock.now', () => ({ value: 0 }))
  on('turn.complete', (_, e) => ({ text: e.answer }))

  await $.turn.complete({ answer: '', durationMs: 2000, isAborted: false, turnId: 't9', agentId: 'zz', reason: 'error' })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /failed/ }))?.text).toBe(' · 1 failed')
  await ui.unmount()
})
