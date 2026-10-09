import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderElement, RenderInput, SessionRateLimit, SessionUsage } from 'claude-code'

import type { CacheTotals } from '../types'

const cache = atom({ plugin: 'usage-limits', key: 'cache' } as const, { read: 0, write: 0, input: 0, output: 0 } as CacheTotals)

const hitRate = (c: CacheTotals) => {
  const prompt = c.read + c.write + c.input
  return prompt > 0 ? Math.round((c.read / prompt) * 100) : undefined
}

const kTokens = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n))

/** Cache bar color, four even bands the other way: green at 75+, yellow to 50, orange to 25, red below. */
const cacheTone = (pct: number): 'success' | 'warning' | 'claude' | 'error' =>
  pct >= 75 ? 'success' : pct >= 50 ? 'warning' : pct >= 25 ? 'claude' : 'error'

const PANE = 'usage-limits'
const TITLE = 'Usage'
const TICK_MS = 60_000

/** A readable name for a rate-limit window the API reported. */
const labelOf = (kind: string) => {
  if (kind === 'five_hour') return '5-hour'
  if (kind === 'seven_day') return 'Weekly · all models'
  const perModel = kind.match(/^seven_day[_-](.+)$/)
  if (perModel?.[1]) return `Weekly · ${perModel[1][0]?.toUpperCase()}${perModel[1].slice(1)}`
  if (kind === 'spend_limit') return 'Spend limit'
  return kind.replace(/_/g, ' ')
}

const shortLabel = (kind: string) => {
  if (kind === 'five_hour') return '5h'
  if (kind === 'seven_day') return '7d'
  const perModel = kind.match(/^seven_day[_-](.+)$/)
  if (perModel?.[1]) return `7d ${perModel[1]}`
  return kind
}

const bar = (pct: number, cells: number) => {
  const filled = Math.round(Math.min(100, Math.max(0, pct)) / 100 * cells)
  return '█'.repeat(filled) + '░'.repeat(cells - filled)
}

const untilReset = (iso: string | undefined, now: number) => {
  if (!iso) return ''
  const ms = Date.parse(iso) - now
  if (!Number.isFinite(ms) || ms <= 0) return 'resets now'
  const m = Math.floor(ms / 60_000)
  const h = Math.floor(m / 60)
  const d = Math.floor(h / 24)
  if (d > 0) return `resets in ${d}d ${h % 24}h`
  if (h > 0) return `resets in ${h}h ${String(m % 60).padStart(2, '0')}m`
  return `resets in ${m}m`
}


/** Bar color by fill, four even bands: green under 25, yellow to 50, orange to 75, red past it. */
const colorOf = (pct: number): 'success' | 'warning' | 'claude' | 'error' =>
  pct >= 75 ? 'error' : pct >= 50 ? 'claude' : pct >= 25 ? 'warning' : 'success'

const fmt = (pct: number) => `${Math.round(pct)}%`

/** The compact one-liner for the band and status line. */
const summary = (usage: SessionUsage) => {
  const parts = usage.rateLimits.map(w => `${shortLabel(w.kind)} ${bar(w.percentUsed, 8)} ${fmt(w.percentUsed)}`)
  if (usage.context.percent !== undefined) parts.push(`ctx ${bar(usage.context.percent, 8)} ${fmt(usage.context.percent)}`)
  return parts.join('  ')
}

async function drawPane($: EngineInterface, e: RenderInput<'Pane'>) {
  const { Box, Text } = $.ui.resolve(e)
  const usage = await $.session.usage()
  const now = await $.clock.now()
  const width = e.props.bodyColumns ?? 60
  const cells = Math.max(8, Math.min(24, width - 40))
  const windows: SessionRateLimit[] = usage.rateLimits
  const totals = await read($, cache)
  const hit = hitRate(totals)
  return (
    <Box flexDirection="column">
      {windows.length === 0 && <Text dimColor>No plan limits reported yet (first API response fills this in).</Text>}
      {windows.map(w => (
        <Box key={w.kind} flexDirection="column">
          <Box flexDirection="row">
            <Text bold wrap="truncate-end">{labelOf(w.kind)}</Text>
            <Text dimColor>  {untilReset(w.resetsAt, now)}</Text>
          </Box>
          <Box flexDirection="row">
            <Text color={colorOf(w.percentUsed)}>{bar(w.percentUsed, cells)}</Text>
            <Text bold color={colorOf(w.percentUsed)}> {fmt(w.percentUsed)}</Text>
          </Box>
        </Box>
      ))}
      {usage.context.percent !== undefined && (
        <Box flexDirection="column">
          <Text bold>Context window</Text>
          <Box flexDirection="row">
            <Text color={colorOf(usage.context.percent)}>{bar(usage.context.percent, cells)}</Text>
            <Text bold color={colorOf(usage.context.percent)}> {fmt(usage.context.percent)}</Text>
            <Text dimColor> of {Math.round(usage.context.window / 1000)}k</Text>
          </Box>
        </Box>
      )}
      {hit !== undefined && (
        <Box flexDirection="column">
          <Box flexDirection="row">
            <Text bold>Prompt cache hit rate</Text>
            <Text dimColor>  {kTokens(totals.read)} read · {kTokens(totals.write)} written · {kTokens(totals.input)} uncached</Text>
          </Box>
          <Box flexDirection="row">
            <Text color={cacheTone(hit)}>{bar(hit, cells)}</Text>
            <Text bold color={cacheTone(hit)}> {hit}%</Text>
          </Box>
        </Box>
      )}
    </Box>
  )
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    $.ui.status(undefined) // nothing of ours on the status row; the band has it
    await $.command.register({ name: 'limits', description: 'Show plan usage limits (5-hour, weekly, per-model) in a pane' })
    const refresh = () => $.ui.invalidate('ui.render')
    $.clock.every(TICK_MS, refresh)
    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    if (e.changed.includes('rateLimits') || e.changed.includes('context')) {
      $.ui.invalidate('ui.render')
    }
    return next(e)
  })

  on('command.run', { command: 'limits' }, async $ => {
    const opened = await $.ui.open({ id: PANE, title: TITLE, focus: true })
    const usage = await $.session.usage()
    const line = usage.rateLimits.length ? summary(usage) : 'no plan limits reported yet'
    return { text: opened.isPlaced ? `Usage pane opened. ${line}` : `Usage pane could not be placed: ${opened.reason}. ${line}` }
  }).catch(($, e, next) => (next.called ? next(e) : { text: 'Usage pane: could not read usage.' }))

  // Every model request's usage adds to the session-wide cache totals.
  on('turn.step', async function* ($, e, next) {
    const result = yield* next(e)
    const u = result.usage
    if (u) {
      await update($, cache, c => ({
        read: c.read + u.cache_read_input_tokens,
        write: c.write + u.cache_creation_input_tokens,
        input: c.input + u.input_tokens,
        output: c.output + u.output_tokens,
      }))
      $.ui.invalidate('ui.render')
    }
    return result
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, ($, e) => drawPane($, e))

  // One compact line above the prompt, always on, so no clicking is needed.
  // The band is one slot shared by every plugin: this hook draws whatever is
  // beneath it first and its own line last, so usage always sits at the bottom.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    let below: RenderElement | undefined
    try {
      below = await next(e)
    } catch {
      below = undefined
    }
    const usage = await $.session.usage()
    if (usage.rateLimits.length === 0) return below ?? next(e)
    const { Box, Text } = $.ui.resolve(e)
    const worst = Math.max(...usage.rateLimits.map(w => w.percentUsed))
    const hit = hitRate(await read($, cache))
    const slots = usage.rateLimits.length + (usage.context.percent !== undefined ? 1 : 0) + (hit !== undefined ? 1 : 0)
    const barCells = Math.max(4, Math.min(12, Math.floor(((e.props.bodyColumns ?? 80) - 16 * slots - 8) / slots)))
    const own = (
      <Box flexDirection="row">
        <Text dimColor>Usage </Text>
        {usage.rateLimits.map((w, i) => (
          <Text key={w.kind}>
            {i > 0 ? <Text dimColor> · </Text> : null}
            <Text dimColor>{shortLabel(w.kind)} </Text>
            <Text color={colorOf(w.percentUsed)}>{bar(w.percentUsed, barCells)} </Text>
            <Text bold color={colorOf(w.percentUsed)}>{fmt(w.percentUsed)}</Text>
          </Text>
        ))}
        {usage.context.percent !== undefined && (
          <Text>
            <Text dimColor> · ctx </Text>
            <Text color={colorOf(usage.context.percent)}>{bar(usage.context.percent, barCells)} </Text>
            <Text bold color={colorOf(usage.context.percent)}>{fmt(usage.context.percent)}</Text>
          </Text>
        )}
        {hit !== undefined && (
          <Text>
            <Text dimColor> · cache </Text>
            <Text color={cacheTone(hit)}>{bar(hit, barCells)} </Text>
            <Text bold color={cacheTone(hit)}>{hit}%</Text>
          </Text>
        )}
        {worst >= 90 && <Text color="error" bold>  ⚠ near limit</Text>}
      </Box>
    )
    if (!below) return own
    return (
      <Box flexDirection="column">
        {below}
        {own}
      </Box>
    )
  })
}
