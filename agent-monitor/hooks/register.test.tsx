import { test, expect, mock } from 'claude-code/testing'
import type { AgentInfo } from 'claude-code'

const PANE = {
  component: 'Pane',
  requestId: 'agent-monitor',
  props: {
    title: 'Agents',
    isFocused: false,
    bodyColumns: 100,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 20 },
    view: {},
  },
} as const

const roster: AgentInfo[] = [
  { id: 'a1', description: 'Review changed files', type: 'Explore', status: 'running' },
  { id: 'a2', description: 'Verify finding', type: 'executor', status: 'completed', parentId: 'a1' },
]

test('pane lists each agent with its status, children under parents', async ($, on) => {
  mock.clock(on)
  on('agent.list', () => ({ value: roster }))
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'agent-monitor', surface, ...PANE })
    expect(await ui.find({ type: 'Text', text: /1 running · 1 finished/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Explore/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /executor/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /running/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /completed/ })).toBeDefined()
    await ui.unmount()
  }
})

test('pane says so when nothing has been spawned', async ($, on) => {
  mock.clock(on)
  on('agent.list', () => ({ value: [] }))
  const ui = await $.ui.mount({ plugin: 'agent-monitor', surface: 'terminal', ...PANE })
  expect(await ui.find({ type: 'Text', text: /No agents/ })).toBeDefined()
  await ui.unmount()
})

test('/agents command opens the pane and reports counts', async ($, on) => {
  mock.clock(on)
  on('agent.list', () => ({ value: roster }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  const out = await $.command.run({
    command: 'agents',
    args: '',
    origin: { kind: 'sdk' },
    presentation: { isFullscreen: true, columns: 120 },
  })
  expect(out.text).toMatch(/1 running, 1 finished/)
})

const BAND = {
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: true,
    maxRows: 10,
    bodyColumns: 100,
    scroll: { offset: 0, bodyRows: 9 },
    view: {},
  },
} as const

test('band shows live agents above whatever is beneath, and an idle line when none run', async ($, on) => {
  mock.clock(on)
  const list: AgentInfo[] = [...roster]
  on('agent.list', () => ({ value: list }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>usage line beneath</Text>
  })
  const ui = await $.ui.mount({ plugin: 'agent-monitor', surface: 'desktop', ...BAND })
  expect(await ui.find({ type: 'Text', text: /Agents: 1 running · 1 done/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Explore/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /executor/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /usage line beneath/ })).toBeDefined()
  await ui.unmount()
  list[0] = { ...list[0]!, status: 'completed' }
  const idle = await $.ui.mount({ plugin: 'agent-monitor', surface: 'terminal', ...BAND })
  expect(await idle.find({ type: 'Text', text: /Agents: none running/ })).toBeDefined()
  expect(await idle.find({ type: 'Text', text: /Explore/ })).toBeUndefined()
  expect(await idle.find({ type: 'Text', text: /usage line beneath/ })).toBeDefined()
  await idle.unmount()
})

test('pane shows each loop model and effort after a model request', async ($, on) => {
  mock.clock(on)
  on('agent.list', () => ({ value: roster }))
  on('turn.step', async function* (_$, e) {
    const usage = { model: e.model, input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 9000, cache_creation_input_tokens: 0 }
    return { turnId: e.turnId, index: e.index, answer: 'ok', toolUses: [], stopReason: 'end_turn', usage } as never
  })
  const step = async (model: string, effort: string, agentId?: string) => {
    const stream = $.turn.step({ turnId: 't1', index: 0, model, effort: effort as never, messageCount: 1, agentId } as never)
    for await (const _chunk of stream) { /* drain */ }
    await stream.result
  }
  await step('claude-fable-5-1', 'high')
  await step('claude-haiku-5-5', 'low', 'a1')
  const ui = await $.ui.mount({ plugin: 'agent-monitor', surface: 'desktop', ...PANE })
  expect(await ui.find({ type: 'Text', text: /main: fable-5-1 · high/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /haiku-5-5 · low/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /▮+▯* 90%/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /9k read/ })).toBeDefined()
  await ui.unmount()
})
