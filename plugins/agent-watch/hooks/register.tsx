import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { AgentView, Step } from '../types'

const PANE = 'agent-watch'
// How wide the docked pane asks to be
const COLUMNS = 56
// How many tool calls each agent keeps
const MAX_STEPS = 12
// How long the pane stays after the last agent finished
const LINGER_MS = 20_000
// Spinner frames for a running agent, one per tick
const SPIN = ['◐', '◓', '◑', '◒']

const agents = atom({ plugin: 'agent-watch', key: 'agents' } as const, [] as AgentView[])
const tick = atom({ plugin: 'agent-watch', key: 'tick' } as const, 0)

// The ticker and the pending close; the module's own, so a reload starts them over
let ticker: { cancel: () => void } | null = null
let closer: { cancel: () => void } | null = null

// The argument worth showing for a tool call: the command, the path, the pattern
function summarize(input: Record<string, unknown>): string {
  for (const key of ['command', 'file_path', 'path', 'pattern', 'url', 'query', 'description', 'prompt']) {
    const value = input[key]
    if (typeof value === 'string' && value) return value.replace(/\s+/g, ' ').replace(/^\/Users\/[^/]+/, '~')
  }
  return ''
}

// 72000 -> "1m12s"
function elapsed(ms: number): string {
  const s = Math.max(Math.round(ms / 1000), 0)
  return s >= 60 ? `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s` : `${s}s`
}

// Change one agent's view in place
function patch($: EngineInterface, id: string, change: (a: AgentView) => AgentView) {
  return update($, agents, list => list.map(a => (a.id === id ? change(a) : a)))
}

// Know the agent the first time its loop shows up; false for a loop the list never names (compaction, memory)
async function track($: EngineInterface, id: string): Promise<boolean> {
  if ((await read($, agents)).some(a => a.id === id)) return true
  const info = (await $.agent.list()).find(a => a.id === id)
  if (!info) return false
  const now = await $.clock.now()
  const view: AgentView = {
    id,
    type: info.type,
    description: info.description,
    status: 'running',
    startedAt: now,
    endedAt: null,
    tools: 0,
    steps: [],
    text: '',
  }
  await update($, agents, list => (list.some(a => a.id === id) ? list : [...list, view]))
  closer?.cancel()
  closer = null
  if (!ticker) ticker = $.clock.every(1000, () => update($, tick, n => n + 1))
  await $.ui.open({ id: PANE, title: 'Agents', columns: COLUMNS })
  return true
}

// An agent ended: stop the ticker once none runs, and close the pane a while later
async function finish($: EngineInterface, id: string, failed: boolean) {
  const now = await $.clock.now()
  await patch($, id, a => ({ ...a, status: failed ? 'failed' : 'done', endedAt: now }))
  if ((await read($, agents)).some(a => a.status === 'running')) return
  ticker?.cancel()
  ticker = null
  closer?.cancel()
  closer = $.clock.after(LINGER_MS, async () => {
    if ((await read($, agents)).some(a => a.status === 'running')) return
    await update($, agents, () => [])
    await $.ui.close({ id: PANE })
  })
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'agents-pane', description: 'Show the subagents of this session in a pane' })
    return next(e)
  })

  on('command.run', { command: 'agents-pane' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Agents', columns: COLUMNS })
    return { text: 'Agents pane opened.' }
  })

  // A subagent's tool call: a step that runs, then turns ✓ or ✗
  on('tool.call', async ($, e, next) => {
    if (e.agentId === undefined || !(await track($, e.agentId))) return next(e)
    const id = e.agentId
    const step: Step = { id: e.tool_use_id, tool: e.tool, summary: summarize(e as unknown as Record<string, unknown>), state: 'run' }
    await patch($, id, a => ({ ...a, tools: a.tools + 1, steps: [...a.steps, step].slice(-MAX_STEPS) }))
    const ran = await next(e)
    const state = ran.deny !== undefined || ran.isError ? 'err' : 'ok'
    await patch($, id, a => ({ ...a, steps: a.steps.map(s => (s.id === step.id ? { ...s, state } : s)) }))
    return ran
  })

  // A subagent's model output: keep the tail of its text, written at most twice a second
  on('turn.step', async function* ($, e, next) {
    const id = e.agentId
    const stream = next(e)
    if (id === undefined || !(await track($, id))) return yield* stream
    let text = ''
    let written = 0
    for (let r = await stream.next(); ; r = await stream.next()) {
      if (r.done) {
        if (text.trim()) await patch($, id, a => ({ ...a, text: text.trim().replace(/\s+/g, ' ').slice(-240) }))
        return r.value
      }
      if (r.value.kind === 'text') {
        text += r.value.text
        const now = Date.now()
        if (now - written > 500) {
          written = now
          await patch($, id, a => ({ ...a, text: text.trim().replace(/\s+/g, ' ').slice(-240) }))
        }
      }
      yield r.value
    }
  })

  // A subagent's run ended
  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId !== undefined && (await read($, agents)).some(a => a.id === e.agentId)) {
      await finish($, e.agentId, e.reason === 'error' || e.reason === 'aborted')
    }
    return done
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const list = await read($, agents)
    const n = await read($, tick)
    const now = await $.clock.now()
    if (list.length === 0) return <Text dimColor>No subagents running.</Text>

    // Running agents first, newest first; finished ones after them
    const shown = [...list].sort((a, b) => (a.status === 'running') === (b.status === 'running') ? b.startedAt - a.startedAt : a.status === 'running' ? -1 : 1)
    const rows = e.viewport?.rows ?? 40
    const perAgent = Math.max(2, Math.floor((rows - 2) / shown.length) - 4)

    return (
      <Box flexDirection="column" rowGap={1}>
        {shown.map(a => {
          const running = a.status === 'running'
          const glyph = running ? SPIN[n % SPIN.length] : a.status === 'done' ? '✓' : '✗'
          const color = running ? 'cyan' : a.status === 'done' ? 'green' : 'red'
          return (
            <Box key={a.id} flexDirection="column">
              <Text wrap="truncate-end">
                <Text color={color}>{glyph} </Text>
                <Text bold dimColor={!running}>{a.type}</Text>
                <Text dimColor>  {elapsed((a.endedAt ?? now) - a.startedAt)} · {a.tools} tools</Text>
              </Text>
              <Text dimColor wrap="truncate-end">  {a.description}</Text>
              {(running ? a.steps.slice(-perAgent) : a.steps.slice(-1)).map(s => (
                <Text key={s.id} wrap="truncate-end">
                  {'  '}
                  <Text color={s.state === 'run' ? 'yellow' : s.state === 'ok' ? 'green' : 'red'}>{s.state === 'run' ? '›' : s.state === 'ok' ? '✓' : '✗'}</Text>
                  <Text dimColor={!running}> {s.tool} </Text>
                  <Text dimColor>{s.summary}</Text>
                </Text>
              ))}
              {running && a.text && (
                <Text dimColor italic wrap="truncate-start">
                  {'  '}“{a.text}”
                </Text>
              )}
            </Box>
          )
        })}
      </Box>
    )
  })
}
