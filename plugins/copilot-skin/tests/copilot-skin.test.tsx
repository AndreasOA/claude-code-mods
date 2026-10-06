import { test, expect } from 'claude-code/testing'
import type { On } from 'claude-code'

import { cells, duration } from '../hooks/register'

const BAND = {
  plugin: 'copilot-skin',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 100, scroll: { offset: 0, bodyRows: 19 }, view: {} },
} as const

// Stand in for the engine: its own band and spinner, and a prompt that runs no turn
function engine(on: On) {
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('prompt.submit', async (_$, e) => ({ text: e.text }))
  on('command.register', async (_$, e) => ({ value: { command: e.name } }))
  on('ui.render', { component: 'AbovePrompt' }, async ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine band</Text>
  })
  on('ui.render', { component: 'Spinner' }, async ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{e.props.word}</Text>
  })
}

test('welcomes with the Copilot guy, and steps aside once asked for something', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/Users/ao/code/app', surface: 'terminal', isInteractive: true })

  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await band.find({ type: 'Raster' })).toBeDefined()
  expect(await band.find({ type: 'Text', text: /GitHub Copilot/ })).toBeDefined()
  expect(await band.find({ type: 'Text', text: /~\/code\/app/ })).toBeDefined()

  await $.prompt.submit({ text: 'fix the build', wait: false, origin: { kind: 'composer' } })
  const after = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await after.find({ type: 'Text', text: /engine band/ })).toBeDefined()
  expect(await after.find({ type: 'Raster' })).toBeUndefined()
})

test('a narrow band gets one line instead of the head', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  for (const surface of ['terminal', 'desktop'] as const) {
    const band = await $.ui.mount({ ...BAND, surface, props: { ...BAND.props, bodyColumns: 40 } })
    expect(await band.find({ type: 'Raster' })).toBeUndefined()
    expect(await band.find({ type: 'Text', text: /GitHub Copilot/ })).toBeDefined()
  }
})

test('the spinner speaks Copilot', async ($, on) => {
  engine(on)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({
      plugin: 'copilot-skin',
      surface,
      component: 'Spinner',
      props: { word: 'Sauteing', message: null, suffix: '…', mode: 'responding' },
    })
    expect(await ui.find({ type: 'Text', text: /^Generating response$/ })).toBeDefined()
  }
})

test('the turn closes with how long Copilot worked', async ($, on) => {
  engine(on)
  const ui = await $.ui.mount({
    plugin: 'copilot-skin',
    surface: 'terminal',
    component: 'TurnDuration',
    props: { word: 'Baked', durationMs: 64_000 },
  })
  expect(await ui.find({ type: 'Text', text: /Copilot worked for 1m 4s/ })).toBeDefined()
})

test('the head packs into whole cells', () => {
  // 24 columns by 7 rows, three u32 words of four bytes each
  expect(cells(Array(14).fill('.'.repeat(24))).length).toBe(Math.ceil((24 * 7 * 12) / 3) * 4)
  expect(duration(3400)).toBe('3s')
})
