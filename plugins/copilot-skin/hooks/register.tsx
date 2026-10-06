import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Folder } from '../types'

// GitHub's Copilot purple, for the marks drawn as text
const PURPLE = '#8957E5'

// The terminal's own color, for the pixels around the head
const DEFAULT = 0x01000000

// One color per pixel letter of the drawing below
const PALETTE: Record<string, number> = {
  o: 0x3d1f7a, // outline
  g: 0x8957e5, // goggle frame
  l: 0x1b1f3b, // lens
  w: 0xffffff, // glint on the lens
  f: 0x6e40c9, // face
  e: 0x7ee7ff, // eye
}

// The Copilot guy, 24 by 14 pixels, two pixels to a terminal row
const HEAD = [
  '....oooooo....oooooo....',
  '...oggggggo..oggggggo...',
  '..ogllllllgoogllllllgo..',
  '..ogwlllllgoogwlllllgo..',
  '.oogllllllggggllllllgoo.',
  'offoggggggoffoggggggoffo',
  'offfooooooffffoooooofffo',
  'offffffffffffffffffffffo',
  'offffffeeffffffeeffffffo',
  'offffffeeffffffeeffffffo',
  'offffffeeffffffeeffffffo',
  '.offffffffffffffffffffo.',
  '..ooffffffffffffffffoo..',
  '....oooooooooooooooo....',
]

// The same head with its eyes half shut, for a blink
const BLINK = HEAD.map((row, y) => (y === 8 || y === 10 ? row.replaceAll('e', 'f') : row))

const HEAD_COLUMNS = HEAD[0]!.length
const HEAD_ROWS = HEAD.length / 2

// Rows the band takes with the head, and the columns it needs beside the text
const BAND_ROWS = HEAD_ROWS
const BAND_COLUMNS = 64

const BLINK_EVERY_MS = 4000
const BLINK_FOR_MS = 160

const isWelcome = atom({ plugin: 'copilot-skin', key: 'isWelcome' } as const, true)
const cwd = atom({ plugin: 'copilot-skin', key: 'cwd' } as const, '' as Folder)

// What the spinner says for each thing the turn is doing
const SPINNER_WORDS: Record<string, string> = {
  requesting: 'Thinking',
  thinking: 'Thinking',
  responding: 'Generating response',
  'tool-input': 'Preparing tool call',
  'tool-use': 'Running tool',
}

// Pack the pixel rows as Raster cells: an upper half block, its top pixel the foreground, its bottom the background
export function cells(pixels: string[]): string {
  const words = new Uint32Array(HEAD_COLUMNS * HEAD_ROWS * 3)
  for (let row = 0; row < HEAD_ROWS; row++) {
    for (let x = 0; x < HEAD_COLUMNS; x++) {
      const top = PALETTE[pixels[row * 2]![x]!] ?? DEFAULT
      const bottom = PALETTE[pixels[row * 2 + 1]![x]!] ?? DEFAULT
      const at = (row * HEAD_COLUMNS + x) * 3
      if (top === DEFAULT && bottom === DEFAULT) {
        words.set([0x20, DEFAULT, DEFAULT], at)
      } else if (top === DEFAULT) {
        words.set([0x2584, bottom, DEFAULT], at)
      } else {
        words.set([0x2580, top, bottom], at)
      }
    }
  }
  return base64(new Uint8Array(words.buffer))
}

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

// Standard padded base64, as Raster cells are carried
function base64(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0)
    out += ALPHABET[(n >> 18) & 63]! + ALPHABET[(n >> 12) & 63]!
    out += i + 1 < bytes.length ? ALPHABET[(n >> 6) & 63]! : '='
    out += i + 2 < bytes.length ? ALPHABET[n & 63]! : '='
  }
  return out
}

const OPEN = cells(HEAD)
const SHUT = cells(BLINK)

// 3400 -> "3s", 64000 -> "1m 4s"
export function duration(ms: number): string {
  const seconds = Math.max(Math.round(ms / 1000), 0)
  if (seconds < 60) return seconds + 's'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

// "/Users/ao/Documents/a-o.dev" -> "~/Documents/a-o.dev"
function home(path: string): string {
  return path.replace(/^\/(Users|home)\/[^/]+/, '~')
}

export const register: Register = on => {
  // The band's site while it shows, so a blink repaints the head alone
  let site: string | null = null
  let blinking: { cancel: () => void } | null = null

  on('session.start', async ($, e, next) => {
    await update($, cwd, () => e.cwd)
    await $.command
      .register({ name: 'copilot', description: 'Show the GitHub Copilot welcome again' })
      .catch(() => {})

    blinking?.cancel()
    blinking = $.clock.every(BLINK_EVERY_MS, () => {
      if (site === null) return
      const requestId = site
      void $.ui.blit({ requestId, key: 'copilot', cells: SHUT })
      $.clock.after(BLINK_FOR_MS, () => void $.ui.blit({ requestId, key: 'copilot', cells: OPEN }))
    })

    return next(e)
  })

  on('command.run', { command: 'copilot' }, async $ => {
    await update($, isWelcome, () => true)

    return { text: 'GitHub Copilot is ready.' }
  })

  // The welcome steps aside once the person asks for something
  on('prompt.submit', async ($, e, next) => {
    if (e.origin.kind === 'composer') await update($, isWelcome, () => false).catch(() => {})

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const isShown = await read($, isWelcome)
    if (!isShown || e.props.hasSurvey || e.props.view.agentId !== undefined) {
      site = null
      return next(e)
    }

    const table = $.ui.resolve(e)
    const { Box, Text } = table
    const folder = home(await read($, cwd))

    // Too little room for the head, or no pixel grid on this surface: one line in its place
    if (e.props.maxRows < BAND_ROWS || e.props.bodyColumns < BAND_COLUMNS || !('Raster' in table)) {
      site = null
      return (
        <Box>
          <Text color={PURPLE} bold>
            GitHub Copilot
          </Text>
          <Text dimColor> · {folder}</Text>
        </Box>
      )
    }

    const { Raster } = table
    site = e.requestId
    return (
      <Box flexDirection="row">
        <Box flexShrink={0} marginRight={3}>
          <Raster key="copilot" columns={HEAD_COLUMNS} rows={HEAD_ROWS} cells={OPEN} />
        </Box>
        <Box flexDirection="column" justifyContent="center">
          <Text color={PURPLE} bold>
            GitHub Copilot
          </Text>
          <Text dimColor>Your AI pair programmer, in the terminal</Text>
          <Text> </Text>
          <Text dimColor wrap="truncate-start">
            {folder}
          </Text>
          <Text dimColor>Describe a task to get started · /copilot shows this again</Text>
        </Box>
      </Box>
    )
  })

  on('ui.render', { component: 'Spinner' }, ($, e, next) => {
    if (e.props.message !== null) return next(e)
    const word = SPINNER_WORDS[e.props.mode] ?? 'Working'

    return next({ ...e, props: { ...e.props, word } })
  })

  on('ui.render', { component: 'TurnDuration' }, ($, e) => {
    const { Box, Text } = $.ui.resolve(e)

    return (
      <Box>
        <Text color={PURPLE}>◆ </Text>
        <Text dimColor>Copilot worked for {duration(e.props.durationMs)}</Text>
      </Box>
    )
  })

  // Each reply opens with Copilot's purple mark instead of the engine's bullet
  on('ui.render', { component: 'AssistantMessage' }, ($, e, next) => {
    if (e.props.isSummary) return next(e)
    const { Box, Text, Markdown } = $.ui.resolve(e)

    return (
      <Box flexDirection="row">
        <Box width={2} flexShrink={0}>
          {e.props.isFirstOfReply ? <Text color={PURPLE}>●</Text> : <Text> </Text>}
        </Box>
        <Box flexGrow={1} flexShrink={1}>
          <Markdown text={e.props.text} />
        </Box>
      </Box>
    )
  })

  on('ui.render', { component: 'PromptHint' }, ($, e, next) => {
    if (e.props.isDraft || e.props.isWorking) return next(e)

    return next({ ...e, props: { ...e.props, tail: ' · GitHub Copilot' } })
  })

  on('ui.render', { component: 'InfoNotice' }, ($, e, next) => {
    const text = e.props.text.replaceAll('Claude Code', 'GitHub Copilot').replaceAll('Claude', 'Copilot')

    return next({ ...e, props: { ...e.props, text } })
  })
}
