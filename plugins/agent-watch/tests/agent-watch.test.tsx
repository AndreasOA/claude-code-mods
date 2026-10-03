import { test, expect, mock } from 'claude-code/testing'

const PANE = { plugin: 'agent-watch', component: 'Pane', requestId: 'agent-watch', props: { title: 'Agents', bodyColumns: 56 } } as const

test('follows a subagent from its first tool call to its end', async ($, on) => {
  const opened: string[] = []
  const clock = mock.clock(on, { now: 1_000_000 })
  on('agent.list', async () => ({ value: [{ id: 'a1', type: 'Explore', description: 'Find the auth routes', status: 'running' }] }))
  on('ui.open', async (_$, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true } }
  })
  const closed: string[] = []
  on('ui.close', async (_$, e) => {
    closed.push(e.id)
    return { value: undefined }
  })
  on('tool.call', async () => ({ result: { stdout: 'ok', stderr: '', interrupted: false } }))
  on('turn.complete', async (_$, e) => ({ text: e.answer }))

  await $.tool.call({ tool: 'Bash', command: 'grep -r "router" app/', agentId: 'a1' } as never)
  expect(opened).toEqual(['agent-watch'])

  let ui = await $.ui.mount({ ...PANE, surface: 'terminal' } as never)
  expect(await ui.find({ type: 'Text', text: /^Explore$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Find the auth routes/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /grep -r "router" app\// })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /1 tools/ })).toBeDefined()
  await ui.unmount()

  await clock.advance(72_000)
  await $.turn.complete({ answer: 'done', durationMs: 1000, isAborted: false, turnId: 't', agentId: 'a1', reason: 'answer' } as never)
  ui = await $.ui.mount({ ...PANE, surface: 'terminal' } as never)
  expect(await ui.find({ type: 'Text', text: /^✓ $/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /1m12s/ })).toBeDefined()
  await ui.unmount()

  // The pane stays a while, then closes itself
  await clock.advance(19_000)
  expect(closed).toEqual([])
  await clock.advance(2_000)
  expect(closed).toEqual(['agent-watch'])
})

test('ignores loops no agent list names, such as compaction', async ($, on) => {
  const opened: string[] = []
  const clock = mock.clock(on, { now: 1_000_000 })
  on('agent.list', async () => ({ value: [] }))
  on('ui.open', async (_$, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('tool.call', async () => ({ result: { stdout: '', stderr: '', interrupted: false } }))
  await $.tool.call({ tool: 'Bash', command: 'ls', agentId: 'compact-1' } as never)
  expect(opened).toEqual([])
})
