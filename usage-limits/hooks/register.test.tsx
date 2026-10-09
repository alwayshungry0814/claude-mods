import { test, expect, mock } from 'claude-code/testing'
import type { SessionUsage } from 'claude-code'

const usage: SessionUsage = {
  startedAt: 0,
  context: { window: 1_000_000, tokens: 190_000, percent: 19 },
  rateLimits: [
    { kind: 'five_hour', percentUsed: 21, resetsAt: '2026-10-09T18:59:59Z' },
    { kind: 'seven_day', percentUsed: 43, resetsAt: '2026-10-09T20:59:59Z' },
    { kind: 'seven_day_fable', percentUsed: 32, resetsAt: '2026-10-09T20:59:59Z' },
  ],
}

const PANE = {
  component: 'Pane',
  requestId: 'usage-limits',
  props: { title: 'Usage', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 20 }, view: {} },
} as const

const BAND = {
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 100, scroll: { offset: 0, bodyRows: 9 }, view: {} },
} as const

test('pane shows every window with its percent and a reset time', async ($, on) => {
  mock.clock(on, { now: Date.parse('2026-10-09T17:17:00Z') })
  on('session.usage', () => ({ value: usage }))
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'usage-limits', surface, ...PANE })
    expect(await ui.find({ type: 'Text', text: /5-hour/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Weekly · all models/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Weekly · Fable/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /43%/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /resets in 1h 42m/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Context window/ })).toBeDefined()
    await ui.unmount()
  }
})

test('band shows the compact line', async ($, on) => {
  mock.clock(on)
  on('session.usage', () => ({ value: usage }))
  const ui = await $.ui.mount({ plugin: 'usage-limits', surface: 'desktop', ...BAND })
  expect(await ui.find({ type: 'Text', text: /7d fable/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /32%/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /near limit/ })).toBeUndefined()
  await ui.unmount()
})

test('band warns at 90 percent', async ($, on) => {
  mock.clock(on)
  on('session.usage', () => ({ value: { ...usage, rateLimits: [{ kind: 'five_hour', percentUsed: 93 }] } }))
  const ui = await $.ui.mount({ plugin: 'usage-limits', surface: 'terminal', ...BAND })
  expect(await ui.find({ type: 'Text', text: /near limit/ })).toBeDefined()
  await ui.unmount()
})

test('/limits opens the pane and reports the line', async ($, on) => {
  mock.clock(on)
  on('session.usage', () => ({ value: usage }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  const out = await $.command.run({ command: 'limits', args: '', origin: { kind: 'sdk' }, presentation: { isFullscreen: true, columns: 120 } })
  expect(out.text).toMatch(/5h ██░░░░░░ 21%  7d ███░░░░░ 43%  7d fable ███░░░░░ 32%  ctx ██░░░░░░ 19%/)
})

test('pane and band show the prompt-cache hit rate after a model request', async ($, on) => {
  mock.clock(on)
  on('session.usage', () => ({ value: usage }))
  on('turn.step', async function* (_$, e) {
    const u = { model: e.model, input_tokens: 2000, output_tokens: 100, cache_read_input_tokens: 8000, cache_creation_input_tokens: 0 }
    return { turnId: e.turnId, index: e.index, answer: 'ok', toolUses: [], stopReason: 'end_turn', usage: u } as never
  })
  const stream = $.turn.step({ turnId: 't1', index: 0, model: 'claude-fable-5-1', messageCount: 1 } as never)
  for await (const _chunk of stream) { /* drain */ }
  await stream.result
  const pane = await $.ui.mount({ plugin: 'usage-limits', surface: 'desktop', ...PANE })
  expect(await pane.find({ type: 'Text', text: /Prompt cache hit rate/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /80%/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /8k read/ })).toBeDefined()
  await pane.unmount()
  const band = await $.ui.mount({ plugin: 'usage-limits', surface: 'terminal', ...BAND })
  expect(await band.find({ type: 'Text', text: /cache/ })).toBeDefined()
  expect(await band.find({ type: 'Text', text: /80%/ })).toBeDefined()
  await band.unmount()
})

test('band keeps the tree from beneath and adds its own line under it', async ($, on) => {
  mock.clock(on)
  on('session.usage', () => ({ value: usage }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>tree from beneath</Text>
  })
  const ui = await $.ui.mount({ plugin: 'usage-limits', surface: 'desktop', ...BAND })
  expect(await ui.find({ type: 'Text', text: /tree from beneath/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Usage $/ })).toBeDefined()
  await ui.unmount()
})
