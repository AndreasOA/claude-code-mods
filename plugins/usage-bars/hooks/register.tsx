import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderChildren, TurnUsage } from 'claude-code'

import type { GitInfo, Limit, ModelInfo, Sample, Totals } from '../types'

// How many readings the charts keep, one bar each
const MAX_BARS = 20

// Eight bar heights, from the shortest to the tallest
const BLOCKS = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█']

const samples = atom({ plugin: 'usage-bars', key: 'samples' } as const, [] as Sample[])
const window = atom({ plugin: 'usage-bars', key: 'window' } as const, 0)
const limits = atom({ plugin: 'usage-bars', key: 'limits' } as const, [] as Limit[])
const current = atom({ plugin: 'usage-bars', key: 'current' } as const, null as Sample | null)
const totals = atom({ plugin: 'usage-bars', key: 'totals' } as const, { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } as Totals)
const turns = atom({ plugin: 'usage-bars', key: 'turns' } as const, [] as number[])
const mark = atom({ plugin: 'usage-bars', key: 'mark' } as const, 0)
const cost = atom({ plugin: 'usage-bars', key: 'cost' } as const, null as number | null)
const hit = atom({ plugin: 'usage-bars', key: 'hit' } as const, null as number | null)
const model = atom({ plugin: 'usage-bars', key: 'model' } as const, null as ModelInfo | null)
const git = atom({ plugin: 'usage-bars', key: 'git' } as const, null as GitInfo | null)

// How the rate-limit windows are labelled on the row
const LIMIT_LABELS: Record<string, string> = { five_hour: '5h', seven_day: '7d', spend_limit: 'spend' }

// Draw each value as a bar, scaled so that `max` is the tallest bar
function bars(values: number[], max: number): string {
  if (max <= 0) return ''
  return values
    .map(v => {
      const level = Math.round((Math.min(Math.max(v, 0), max) / max) * (BLOCKS.length - 1))
      return BLOCKS[level]
    })
    .join('')
}

// 84200 -> "84.2k", 1200000 -> "1.2M"
function short(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1000) return (n / 1000).toFixed(n >= 100_000 ? 0 : 1) + 'k'
  return String(Math.round(n))
}

// Green while there is room, yellow as the window fills, red near the end
function fillColor(percent: number): string {
  if (percent >= 85) return 'red'
  if (percent >= 60) return 'yellow'
  return 'green'
}

// A fixed-width meter: 34% -> "▰▰▱▱▱"
function meter(percent: number, width = 5): string {
  const filled = Math.round((Math.min(Math.max(percent, 0), 100) / 100) * width)
  return '▰'.repeat(filled) + '▱'.repeat(width - filled)
}

// Time left until an ISO timestamp: "2h10m", "3d", "45m"
function until(iso: string | undefined): string {
  if (!iso) return ''
  const mins = Math.max(Math.round((Date.parse(iso) - Date.now()) / 60_000), 0)
  if (mins >= 48 * 60) return Math.round(mins / (24 * 60)) + 'd'
  if (mins >= 60) return Math.floor(mins / 60) + 'h' + String(mins % 60).padStart(2, '0') + 'm'
  return mins + 'm'
}

// "claude-opus-5-5[1m]" -> "opus 5.5 1M", "claude-haiku-4-5-20251001" -> "haiku 4.5"
function modelName(id: string): string {
  const long = /\[1m\]$/i.test(id) ? ' 1M' : ''
  return (
    id
      .replace(/\[.*\]$/, '')
      .replace(/^claude-/, '')
      .replace(/-\d{8}$/, '')
      .replace(/-(\d+)-(\d+)$/, ' $1.$2')
      .replace(/-(\d+)$/, ' $1') + long
  )
}

// Read branch, changes and ahead/behind from `git status --porcelain=v2 --branch`
async function readGit($: EngineInterface) {
  const run = await $.process.run(['git', 'status', '--porcelain=v2', '--branch'], { timeoutMs: 5000 }).catch(() => null)
  if (!run || run.exitCode !== 0) return update($, git, () => null)
  const info: GitInfo = { branch: '', changes: 0, ahead: 0, behind: 0 }
  for (const line of run.stdout.split('\n')) {
    if (line.startsWith('# branch.head ')) info.branch = line.slice('# branch.head '.length)
    else if (line.startsWith('# branch.ab ')) {
      const [, ahead, behind] = /\+(\d+) -(\d+)/.exec(line) ?? []
      info.ahead = Number(ahead ?? 0)
      info.behind = Number(behind ?? 0)
    } else if (line && !line.startsWith('#')) info.changes++
  }
  return update($, git, () => info)
}

// Refresh the live reading and the rate-limit windows
async function measure($: EngineInterface) {
  const { context, rateLimits, cost: spent } = await $.session.usage()
  await update($, cost, () => spent?.usd ?? null)
  await update($, limits, () => rateLimits.map(({ kind, percentUsed, resetsAt }) => ({ kind, percentUsed, resetsAt })))
  if (context.tokens === undefined) return
  const sample: Sample = { tokens: context.tokens, percent: context.percent ?? 0 }
  await update($, window, () => context.window)
  await update($, current, () => sample)
}

// Every input token the model read, from the cache or not
function inputs(t: { input: number; cacheRead: number; cacheWrite: number }): number {
  return t.input + t.cacheRead + t.cacheWrite
}

// Add one model request's usage to the session's totals
async function count($: EngineInterface, u: TurnUsage) {
  await update($, totals, t => ({
    input: t.input + u.input_tokens,
    output: t.output + u.output_tokens,
    cacheRead: t.cacheRead + u.cache_read_input_tokens,
    cacheWrite: t.cacheWrite + u.cache_creation_input_tokens,
  }))
  const read = inputs({ input: u.input_tokens, cacheRead: u.cache_read_input_tokens, cacheWrite: u.cache_creation_input_tokens })
  if (read > 0) await update($, hit, () => u.cache_read_input_tokens / read)
}

// Close a turn: keep its reading as one bar, the newest MAX_BARS of them
async function record($: EngineInterface) {
  await measure($)
  const sample = await read($, current)
  if (sample) await update($, samples, list => [...list, sample].slice(-MAX_BARS))
}

// The classic hook events carry the effort level in force, after any downgrade; turn.step leaves the session's default out
async function recordEffort($: EngineInterface, e: { agent_id?: string; effort?: { level: string } }) {
  if (e.agent_id !== undefined || !e.effort) return
  const level = e.effort.level
  await update($, model, m => (m ? { ...m, effort: level } : m))
}

export const register: Register = on => {
  // Start the charts with the current reading, so they aren't empty at launch
  on('session.start', async ($, e, next) => {
    await record($)
    await readGit($)
    const name = await $.session.model()
    await update($, model, m => ({ name, effort: m?.effort ?? null }))
    return next(e)
  })

  // Whenever the window's fill or the limits move: the live figures only
  on('session.measure', async ($, e, next) => {
    if (e.changed.length > 0) await measure($)
    await readGit($)
    return next(e)
  })

  // Every model request, a subagent's included, adds its usage as soon as it answers;
  // the main loop's also carry the model and effort actually sent
  on('turn.step', async function* ($, e, next) {
    if (e.agentId === undefined) {
      const effort = e.effort === undefined ? null : String(e.effort)
      // A request names the bare id; keep the session's own spelling (its [1m] suffix) while it is the same model
      await update($, model, m => ({ name: m && m.name.replace(/\[.*\]$/, '') === e.model ? m.name : e.model, effort: effort ?? m?.effort ?? null }))
    }
    // Pass every chunk on; the usage rides the stop chunk or the step's result
    const stream = next(e)
    let u: TurnUsage | null = null
    for (let r = await stream.next(); ; r = await stream.next()) {
      if (r.done) {
        const result = r.value ?? (await stream.result)
        u = result?.usage ?? u
        if (u) await count($, u)
        return result
      }
      if (r.value.kind === 'stop' && r.value.usage) u = r.value.usage
      yield r.value
    }
  })

  // A main-loop turn ended: one bar for it, what it cost since the last one (its subagents' included)
  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId === undefined) {
      await record($)
      const now = (await read($, cost)) ?? 0
      const spent = now - Math.min(await read($, mark), now)
      await update($, mark, () => now)
      await update($, turns, list => [...list, spent].slice(-MAX_BARS))
    }
    return done
  })

  on('classic.PostToolUse', async ($, e, next) => {
    await recordEffort($, e)
    return next(e)
  })
  on('classic.Stop', async ($, e, next) => {
    await recordEffort($, e)
    return next(e)
  })

  // The hint line under the prompt: keep the engine's own line, add a row below it
  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    const list = await read($, samples)
    const windows = await read($, limits)
    const live = await read($, current)
    const active = await read($, model)
    const repo = await read($, git)
    // Nothing measured yet, so leave the line as it is
    if (list.length === 0 && !live && windows.length === 0 && !active && !repo) return next(e)

    const { Box, Text } = $.ui.resolve(e)
    const size = await read($, window)
    const latest = live ?? list[list.length - 1]

    const sum = await read($, totals)
    const perTurn = await read($, turns)
    const spent = await read($, cost)
    // The latest request's cache hit, rounded down so it never claims 100 % early; a cold cache shows in colour
    const last = await read($, hit)
    const hitPct = last === null ? null : Math.floor(last * 1000) / 10
    const hitColor = hitPct === null || hitPct >= 90 ? undefined : hitPct >= 50 ? 'yellow' : 'red'

    const engineLine = await next(e)

    // One group per figure: a dim label, its chart, then its numbers
    const group = (key: string, label: string, chart: RenderChildren, value: RenderChildren) => (
      <Box key={key} flexDirection="row" columnGap={1}>
        <Text dimColor>{label}</Text>
        <Box flexDirection="row" columnGap={2}>
          {chart}
          {value}
        </Box>
      </Box>
    )
    const groups = [
      repo &&
        group(
          'git',
          '⎇',
          <Text color="magenta">{repo.branch}</Text>,
          <Text>
            {repo.changes > 0 && <Text color="yellow">●{repo.changes} </Text>}
            {repo.ahead > 0 && <Text color="green">↑{repo.ahead} </Text>}
            {repo.behind > 0 && <Text color="red">↓{repo.behind}</Text>}
            {repo.changes === 0 && repo.ahead === 0 && repo.behind === 0 && <Text dimColor>✓</Text>}
          </Text>,
        ),
      active &&
        group(
          'model',
          '◆',
          <Text color="blue">{modelName(active.name)}</Text>,
          active.effort ? <Text dimColor>{active.effort}</Text> : null,
        ),
      latest &&
        group(
          'ctx',
          'ctx',
          <Text color={fillColor(latest.percent)}>{bars(list.map(s => s.percent), 100)}</Text>,
          <Text>
            {latest.percent}% <Text dimColor>{short(latest.tokens)}/{short(size)}</Text>
          </Text>,
        ),
      inputs(sum) + sum.output > 0 &&
        group(
          'tok',
          'tok',
          <Text color="cyan">{bars(perTurn, Math.max(...perTurn, 0.000001))}</Text>,
          <Text>
            <Text dimColor>in </Text>
            {short(inputs(sum))}
            <Text dimColor>  out </Text>
            {short(sum.output)}
            {hitPct !== null && <Text dimColor>  hit </Text>}
            {hitPct !== null && <Text color={hitColor}>{hitPct.toFixed(1)}%</Text>}
            {spent !== null && <Text>  ${spent.toFixed(2)}</Text>}
          </Text>,
        ),
      ...windows.map(w =>
        group(
          w.kind,
          LIMIT_LABELS[w.kind] ?? w.kind,
          <Text color={fillColor(w.percentUsed)}>{meter(w.percentUsed)}</Text>,
          <Text>
            {w.percentUsed}%{w.resetsAt && <Text dimColor> ↻{until(w.resetsAt)}</Text>}
          </Text>,
        ),
      ),
    ].filter(Boolean)

    return (
      <Box flexDirection="column">
        {engineLine}
        <Box flexDirection="row" flexWrap="wrap" columnGap={2} marginTop={1}>
          {groups.flatMap((g, i) => (i === 0 ? [g] : [<Text key={'sep' + i} dimColor>│</Text>, g]))}
        </Box>
      </Box>
    )
  })
}
