import { test, expect } from 'claude-code/testing'
import type { On, SessionMeasureInput } from 'claude-code'

const HINT = { plugin: 'usage-bars', component: 'PromptHint', props: { isDraft: false, isWorking: false, hint: '? for shortcuts' } } as const

// Stand in for the engine: a fixed usage reading and its own hint line
function engine(on: On, readings: number[]) {
  let i = 0
  on('session.usage', async () => {
    const tokens = readings[Math.min(i++, readings.length - 1)]!
    const resetsAt = new Date(Date.now() + 130 * 60_000).toISOString()
    return { value: { startedAt: 0, rateLimits: [{ kind: 'five_hour', percentUsed: 34, resetsAt }, { kind: 'seven_day', percentUsed: 12 }], context: { tokens, window: 200_000, percent: Math.round((tokens / 200_000) * 100) } } }
  })
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('session.model', async () => ({ value: 'claude-opus-5-5[1m]' }))
  on('process.run', async () => ({
    value: {
      exitCode: 0,
      stdout: '# branch.oid abc\n# branch.head frontend-rework\n# branch.ab +2 -0\n1 .M N... 100644 100644 100644 a b app.ts\n? resp.json\n',
      stderr: '',
      isStdoutTruncated: false,
      isStderrTruncated: false,
    },
  }))
  on('session.measure', async (_$, e) => ({ changed: e.changed }))
  on('turn.complete', async (_$, e) => ({ text: e.answer }))
  on('ui.render', { component: 'PromptHint' }, async ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{e.props.hint}</Text>
  })
}

const usage = { model: 'claude-opus-5-5', input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 40_000, cache_creation_input_tokens: 2000 }
const turn = { answer: '', durationMs: 1000, isAborted: false, turnId: 't', reason: 'answer', usage } as never
const measure: SessionMeasureInput = { rateLimits: [], context: { window: 200_000 }, changed: ['context'] }

test('draws the ctx and per-turn rows from the readings', async ($, on) => {
  engine(on, [20_000, 50_000, 130_000])
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.turn.complete(turn)
  await $.turn.complete(turn)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...HINT, surface })
    expect(await ui.find({ type: 'Text', text: /\? for shortcuts/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /65%/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /130k\/200k/ })).toBeDefined()
    // Two turns of 1k in, 500 out, 40k cache read, 2k cache write: 80000 / 86000 served from cache
    expect(await ui.find({ type: 'Text', text: /^tok$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /in 2\.0k\s+out 1\.0k\s+cache 80\.0k 93%/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^5h$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /34%/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /↻2h(09|10)m/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^7d$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /\$/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /^frontend-rework$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /●2/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /↑2/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^opus 5\.5 1M$/ })).toBeDefined()
    await ui.unmount()
  }
})

test('leaves the engine line alone before any reading', async ($, on) => {
  engine(on, [])
  const ui = await $.ui.mount({ ...HINT, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /\? for shortcuts/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /ctx/ })).toBeUndefined()
  await ui.unmount()
})

test('shows the effort level the classic events carry', async ($, on) => {
  engine(on, [20_000])
  on('classic.Stop', async () => ({}))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.classic.Stop({ stop_hook_active: false, effort: { level: 'medium' } })
  const ui = await $.ui.mount({ ...HINT, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /^opus 5\.5 1M$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^medium$/ })).toBeDefined()
  await ui.unmount()
})

test('a usage change inside a turn moves the live figure but closes no turn', async ($, on) => {
  engine(on, [20_000, 50_000, 130_000])
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.session.measure(measure)
  await $.session.measure(measure)
  const ui = await $.ui.mount({ ...HINT, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /65%/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^tok$/ })).toBeUndefined()
  await ui.unmount()
})
