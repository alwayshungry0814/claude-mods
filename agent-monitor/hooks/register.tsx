import { atom, read, update } from 'claude-code'
import type { AgentInfo, AgentStatus, EngineInterface, Register, RenderElement, RenderInput } from 'claude-code'

import type { AgentTiming, CacheStats, LoopInfo } from '../types'

const PANE = 'agent-monitor'
const TITLE = 'Agents'
const POLL_MS = 1500

const timing = atom({ plugin: 'agent-monitor', key: 'timing' } as const, {} as Record<string, AgentTiming>)
const lastSeen = atom({ plugin: 'agent-monitor', key: 'lastSeen' } as const, '')
const loops = atom({ plugin: 'agent-monitor', key: 'loops' } as const, {} as Record<string, LoopInfo>)

const cache = atom({ plugin: 'agent-monitor', key: 'cache' } as const, {} as Record<string, CacheStats>)
const byCall = atom({ plugin: 'agent-monitor', key: 'byCall' } as const, {} as Record<string, string>)

const MAIN = 'main'

const hitRate = (c: CacheStats | undefined) => {
  if (!c) return undefined
  const prompt = c.read + c.write + c.input
  return prompt > 0 ? Math.round((c.read / prompt) * 100) : undefined
}

const miniBar = (pct: number, cells = 5) => {
  const filled = Math.round(Math.min(100, Math.max(0, pct)) / 100 * cells)
  return '▮'.repeat(filled) + '▯'.repeat(cells - filled)
}

const cacheTone = (pct: number): 'success' | 'warning' | 'claude' | 'error' =>
  pct >= 75 ? 'success' : pct >= 50 ? 'warning' : pct >= 25 ? 'claude' : 'error'

const kTokens = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n))

/** `claude-fable-5-1` -> `fable-5-1`; a full id with a date stays readable. */
const shortModel = (model: string) => model.replace(/^claude-/, '').replace(/-\d{8}$/, '')

type Tone = 'claude' | 'planMode' | 'suggestion' | 'autoAccept' | 'remember' | 'ide' | 'text'

/** One color per model family, so a glance tells fable from haiku. */
const modelTone = (model: string): Tone => {
  const m = model.toLowerCase()
  if (m.includes('fable') || m.includes('mythos')) return 'claude'
  if (m.includes('opus')) return 'planMode'
  if (m.includes('sonnet')) return 'suggestion'
  if (m.includes('haiku')) return 'autoAccept'
  return 'remember'
}

/** Top-level agents in one color, their children in another, grandchildren a third. */
const DEPTH_TONES: Tone[] = ['text', 'ide', 'remember']
const depthTone = (depth: number): Tone => DEPTH_TONES[Math.min(depth, DEPTH_TONES.length - 1)] ?? 'text'

const loopLabel = (info: LoopInfo | undefined) =>
  info ? `${shortModel(info.model)}${info.effort ? ` · ${info.effort}` : ''}` : ''

const LIVE: ReadonlySet<AgentStatus> = new Set(['pending', 'running', 'waiting'])
const isLive = (a: AgentInfo) => LIVE.has(a.status)

const MARK: Record<AgentStatus, string> = {
  pending: '○',
  running: '●',
  waiting: '◐',
  idle: '◌',
  completed: '✓',
  failed: '✗',
  killed: '✗',
}

const COLOR: Record<AgentStatus, 'success' | 'warning' | 'error' | 'inactive' | 'claude'> = {
  pending: 'inactive',
  running: 'claude',
  waiting: 'warning',
  idle: 'inactive',
  completed: 'success',
  failed: 'error',
  killed: 'error',
}

const elapsed = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  return m < 60 ? `${m}m${String(s % 60).padStart(2, '0')}s` : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}m`
}

/** Parents first, children indented beneath them, in list order. */
const tree = (list: AgentInfo[]): Array<{ agent: AgentInfo; depth: number }> => {
  const byParent = new Map<string | undefined, AgentInfo[]>()
  const ids = new Set(list.map(a => a.id))
  for (const a of list) {
    const parent = a.parentId && ids.has(a.parentId) ? a.parentId : undefined
    byParent.set(parent, [...(byParent.get(parent) ?? []), a])
  }
  const out: Array<{ agent: AgentInfo; depth: number }> = []
  const walk = (parent: string | undefined, depth: number) => {
    for (const a of byParent.get(parent) ?? []) {
      out.push({ agent: a, depth })
      walk(a.id, depth + 1)
    }
  }
  walk(undefined, 0)
  return out
}

const fingerprint = (list: AgentInfo[]) => list.map(a => `${a.id}:${a.status}`).join('|')

type Row = { agent: AgentInfo; depth: number }

/** The subtree under one agent (itself included), in tree order. */
const subtreeOf = (rows: Row[], rootId: string): Row[] => {
  const start = rows.findIndex(r => r.agent.id === rootId)
  if (start < 0) return []
  const base = rows[start]!.depth
  const out: Row[] = [rows[start]!]
  for (let i = start + 1; i < rows.length && rows[i]!.depth > base; i++) out.push(rows[i]!)
  return out.map(r => ({ agent: r.agent, depth: r.depth - base }))
}

/** One line per agent: mark, name, model, cache, status, elapsed. */
async function drawAgentRows(
  $: EngineInterface,
  e: RenderInput,
  rows: Row[],
  width: number,
) {
  const { Box, Text } = $.ui.resolve(e)
  const times = await read($, timing)
  const info = await read($, loops)
  const cached = await read($, cache)
  const now = await $.clock.now()
  return rows.map(({ agent, depth }) => {
    const t = times[agent.id]
    const dur = t ? elapsed((t.endedAt ?? now) - t.startedAt) : ''
    const label = agent.name ? `${agent.name} ` : ''
    const indent = '  '.repeat(depth)
    const done = !isLive(agent)
    return (
      <Box key={agent.id} flexDirection="row">
        <Text color={COLOR[agent.status]}>{indent}{MARK[agent.status]} </Text>
        <Text dimColor={done} color={depthTone(depth)} wrap="truncate-end">
          {depth > 0 ? '└ ' : ''}
          {label}
          <Text bold={!done}>{agent.type}</Text>
          {' '}
          {agent.description.slice(0, Math.max(10, width - 44 - indent.length))}
        </Text>
        {info[agent.id] && <Text bold color={modelTone(info[agent.id]!.model)}> {loopLabel(info[agent.id])}</Text>}
        {hitRate(cached[agent.id]) !== undefined && (
          <Text color={cacheTone(hitRate(cached[agent.id])!)}> {miniBar(hitRate(cached[agent.id])!)} {hitRate(cached[agent.id])}%</Text>
        )}
        <Text color={COLOR[agent.status]}> {agent.status}</Text>
        <Text dimColor>{dur ? ` ${dur}` : ''}</Text>
      </Box>
    )
  })
}

/** The pane: header, every agent, legend. */
async function drawPane($: EngineInterface, e: RenderInput<'Pane'>, room: number) {
  const { Box, Text } = $.ui.resolve(e)
  const list = await $.agent.list()
  const info = await read($, loops)
  const cached = await read($, cache)
  const all = tree(list)
  const live = list.filter(isLive).length
  const width = e.props.bodyColumns ?? 80
  const rows = await drawAgentRows($, e, all.slice(-room), width)
  return (
    <Box flexDirection="column">
      <Box flexDirection="row">
        <Text bold>
          Agents: {live === 0 ? 'none running' : `${live} running`}{list.length - live > 0 ? ` · ${list.length - live} finished` : ''}
        </Text>
        {info[MAIN] && (
          <Text>
            <Text dimColor>   main: </Text>
            <Text bold color={modelTone(info[MAIN]!.model)}>{loopLabel(info[MAIN])}</Text>
          </Text>
        )}
        {hitRate(cached[MAIN]) !== undefined && (
          <Text>
            <Text dimColor>   cache </Text>
            <Text color={cacheTone(hitRate(cached[MAIN])!)}>{miniBar(hitRate(cached[MAIN])!)} {hitRate(cached[MAIN])}%</Text>
            <Text dimColor> ({kTokens(cached[MAIN]!.read)} read · {kTokens(cached[MAIN]!.write)} written)</Text>
          </Text>
        )}
      </Box>
      {all.length === 0 && <Text dimColor>No agents have been spawned this session.</Text>}
      {rows}
      <Box flexDirection="row">
        <Text dimColor>legend: </Text>
        <Text color="claude">● running </Text>
        <Text color="warning">◐ waiting </Text>
        <Text color="success">✓ done </Text>
        <Text color="error">✗ failed </Text>
        <Text dimColor>· depth: </Text>
        <Text color="text">top </Text>
        <Text color="ide">└ child </Text>
        <Text color="remember">└ grandchild </Text>
        <Text dimColor>· model: </Text>
        <Text color="claude">fable </Text>
        <Text color="planMode">opus </Text>
        <Text color="suggestion">sonnet </Text>
        <Text color="autoAccept">haiku </Text>
        <Text dimColor>· ▮▮▮▮▯ cache hit rate</Text>
      </Box>
    </Box>
  )
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    $.ui.status(undefined)
    await $.command.register({
      name: 'agents',
      description: 'Show the agents and subagents running in this session',
    })

    // Poll the roster. While anything runs: redraw every tick (so timers
    // move) and keep a live toast up, reissued each tick so it refreshes in
    // place. When the last one finishes: one closing toast.
    let wasLive = false
    $.clock.every(POLL_MS, async () => {
      const list = await $.agent.list()
      const now = await $.clock.now()
      const seen = fingerprint(list)
      const live = list.filter(isLive)
      const changed = seen !== (await read($, lastSeen))
      if (changed) {
        await update($, timing, t => {
          const merged = { ...t }
          for (const a of list) {
            const row = merged[a.id] ?? { startedAt: now }
            if (!isLive(a) && row.endedAt === undefined) row.endedAt = now
            merged[a.id] = row
          }
          return merged
        })
        await update($, lastSeen, () => seen)
      }
      if (live.length > 0) {
        wasLive = true
        $.ui.invalidate('ui.render')
      } else if (wasLive) {
        wasLive = false
        $.ui.invalidate('ui.render')
        const longest = Math.max(0, ...Object.values(await read($, timing)).map(t => (t.endedAt ?? now) - t.startedAt))
        $.ui.toast(`✓ all agents done · ${elapsed(longest)}`, { timeoutMs: 6000 })
      } else if (changed) {
        $.ui.invalidate('ui.render')
      }
    })

    return next(e)
  })

  on('command.run', { command: 'agents' }, async $ => {
    const opened = await $.ui.open({ id: PANE, title: TITLE, focus: true })
    const list = await $.agent.list()
    const live = list.filter(isLive).length
    return {
      text: opened.isPlaced
        ? `Agents pane opened. ${live} running, ${list.length - live} finished.`
        : `Agents pane could not be placed: ${opened.reason}. ${live} running, ${list.length - live} finished.`,
    }
  })

  // Record the start the moment a spawn is answered, so elapsed time is exact.
  on('agent.spawn', async ($, e, next) => {
    const result = await next(e)
    if ('agentId' in result && result.agentId) {
      const now = await $.clock.now()
      const id = result.agentId
      await update($, timing, t => ({ ...t, [id]: t[id] ?? { startedAt: now } }))
      const call = e.tool_use_id
      await update($, byCall, m => ({ ...m, [call]: id }))
      $.ui.invalidate('ui.render')
    }
    return result
  }).catch(($, e, next) => (next.called ? next(e) : next(e)))

  // Every model request says which model and effort its loop runs on.
  on('turn.step', async function* ($, e, next) {
    const key = e.agentId ?? MAIN
    const effort = e.effort === undefined ? undefined : String(e.effort)
    const prev = (await read($, loops))[key]
    if (!prev || prev.model !== e.model || prev.effort !== effort) {
      await update($, loops, all => ({ ...all, [key]: { model: e.model, effort } }))
      $.ui.invalidate('ui.render')
    }
    const result = yield* next(e)
    const u = result.usage
    if (u) {
      const prompt = u.cache_read_input_tokens + u.cache_creation_input_tokens + u.input_tokens
      const lastHit = prompt > 0 ? Math.round((u.cache_read_input_tokens / prompt) * 100) : 0
      await update($, cache, all => {
        const c = all[key] ?? { read: 0, write: 0, input: 0, output: 0, lastHit: 0 }
        return {
          ...all,
          [key]: {
            read: c.read + u.cache_read_input_tokens,
            write: c.write + u.cache_creation_input_tokens,
            input: c.input + u.input_tokens,
            output: c.output + u.output_tokens,
            lastHit,
          },
        }
      })
      $.ui.invalidate('ui.render')
    }
    return result
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId) {
      const now = await $.clock.now()
      const id = e.agentId
      await update($, timing, t => ({ ...t, [id]: { ...(t[id] ?? { startedAt: now }), endedAt: now } }))
      $.ui.invalidate('ui.render')
    }
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const room = Math.max(1, (e.viewport?.rows ?? 24) - 3)
    return drawPane($, e, room)
  })

  // The band above the prompt: pinned there, never scrolls away. Drawn only
  // while agents run; the usage-limits band composes beneath it.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const list = await $.agent.list()
    const rows = tree(list).filter(r => isLive(r.agent))
    let below: RenderElement | undefined
    try {
      below = await next(e)
    } catch {
      below = undefined
    }
    const { Box, Text } = $.ui.resolve(e)
    const width = e.props.bodyColumns ?? 100
    const room = Math.max(1, e.props.maxRows - 2)
    const done = list.length - rows.length
    const info = await read($, loops)
    const main = info[MAIN]
    const lines = rows.length > 0 ? await drawAgentRows($, e, rows.slice(0, room), width) : []
    const own = (
      <Box flexDirection="column">
        <Box flexDirection="row">
          <Text bold={rows.length > 0} dimColor={rows.length === 0}>
            Agents: {rows.length === 0 ? 'none running' : `${rows.length} running`}{done ? ` · ${done} done` : ''}
          </Text>
          {main && (
            <Text>
              <Text dimColor>  · main </Text>
              <Text color={modelTone(main.model)}>{loopLabel(main)}</Text>
            </Text>
          )}
        </Box>
        {lines}
      </Box>
    )
    if (!below) return own
    return (
      <Box flexDirection="column">
        {own}
        {below}
      </Box>
    )
  })

  // The band above the prompt: always on, like the usage band. One header
  // line when idle (main model, effort, cache), plus a row per live agent.
}
