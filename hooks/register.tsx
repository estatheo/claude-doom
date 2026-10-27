import type { EngineInterface as Dollar, Register, Timer } from 'claude-code'

declare global {
  // The environment has it (ES2026); TypeScript's lib may not yet.
  interface Uint8Array {
    toBase64(): string
  }
}

// Doom in a pane. bin/doom (doomgeneric with engine/doom_claude.c) writes each
// frame as a file of Raster cells; a timer here reads it and blits. Keys typed
// into the bar under the screen reach the engine through a file it polls.

const PANE = 'doom'
const RUN = '/tmp/claude-doom'
const FRAME = `${RUN}/frame.bin`
const KEYS = `${RUN}/keys`
const SIZE = `${RUN}/size`

// Doom's own key codes (doomkeys.h) for what the terminal reports.
const KEYMAP: Record<string, number> = {
  up: 0xad, down: 0xaf, left: 0xac, right: 0xae,
  w: 0xad, s: 0xaf, a: 0xa0, d: 0xa1,
  f: 0xa3, j: 0xa3, ' ': 0xa2, e: 0xa2,
  return: 13, tab: 9, backspace: 0x7f,
  // Escape gives the focus back, so the menu sits on m and q.
  m: 27, q: 27,
  y: 121, n: 110, '-': 45, '=': 61,
  '1': 49, '2': 50, '3': 51, '4': 52, '5': 53, '6': 54, '7': 55,
}
const QUIT = -1

type Size = { columns: number; rows: number }

let size: Size | undefined
let frame: string | undefined
let frames: Timer | undefined
let running = false
let lines: string[] = []
let engineSeq = 0
let clientSeq = 0

// Doom is 4:3 on screen and a half-block pixel is about square, so the
// screen is 8 columns for every 3 rows.
function fit(columns: number, rows: number): Size {
  let c = Math.min(columns - 2, 320)
  let r = Math.floor((c * 3) / 8)
  if (r > rows) {
    r = rows
    c = Math.floor((r * 8) / 3)
  }
  return { columns: Math.max(16, c), rows: Math.max(6, r) }
}

function blank({ columns, rows }: Size): string {
  const words = new Uint32Array(columns * rows * 3)
  for (let i = 0; i < words.length; i += 3) {
    words[i] = 0x20
    words[i + 1] = 0x01000000
    words[i + 2] = 0
  }
  return new Uint8Array(words.buffer).toBase64()
}

function encodedLength({ columns, rows }: Size): number {
  return Math.ceil((columns * rows * 12) / 3) * 4
}

async function send($: Dollar, codes: number[]) {
  for (const code of codes) lines.push(`${engineSeq++} ${code}`)
  lines = lines.slice(-64)
  await $.fs.write(KEYS, lines.join('\n') + '\n')
}

async function start($: Dollar) {
  if (running) return
  running = true
  lines = []
  await $.fs.write(KEYS, '')
  if (size) await $.fs.write(SIZE, `${size.columns} ${size.rows}\n`)

  void (async () => {
    try {
      const child = $.process.spawn({
        argv: [`${$.plugin.root}/bin/doom`, '-iwad', `${$.plugin.root}/wad/freedoom1.wad`],
        cwd: RUN,
        env: { DOOM_FRAME: FRAME, DOOM_KEYS: KEYS, DOOM_SIZE: SIZE },
      })
      for await (const _ of child) {
        // Doom's startup chatter; nothing to do with it.
      }
    } catch (error) {
      $.ui.toast(`doom did not start: ${String(error)}`)
    } finally {
      running = false
    }
  })()

  frames?.cancel()
  frames = $.clock.every(33, async () => {
    if (!size) return
    const want = encodedLength(size)
    let read: { base64: string }
    try {
      read = await $.fs.read(FRAME, { as: 'bytes' })
    } catch {
      return
    }
    // A frame drawn for the old size, before the engine read the new one.
    if (read.base64.length !== want) return
    frame = read.base64
    await $.ui.blit({ requestId: PANE, key: 'screen', cells: frame })
  })
}

async function stop($: Dollar) {
  frames?.cancel()
  frames = undefined
  if (running) await send($, [QUIT])
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'doom', description: 'Play Freedoom in a pane' })
    return next(e)
  })

  on('command.run', { command: 'doom' }, async $ => {
    await $.fs.write(`${RUN}/.keep`, '')
    await start($)
    const opened = await $.ui.open({ id: PANE, title: 'DOOM', focus: true })
    return {
      text: opened.isPlaced
        ? 'DOOM is open. Click the bar under the screen, then play; Esc gives the keys back.'
        : 'DOOM is waiting for a wider terminal.',
    }
  })

  on('ui.close', async ($, e, next) => {
    if (e.id === PANE) await stop($)
    return next(e)
  })

  on('ui.message', async ($, e, next) => {
    if (e.requestId !== PANE) return next(e)
    const data = e.data as { keys?: [number, string][] }
    const keys = data.keys ?? []
    const newest = keys.at(-1)?.[0] ?? 0
    // A remounted bar counts from 1 again.
    if (newest < clientSeq) clientSeq = 0
    const codes: number[] = []
    for (const [seq, key] of keys) {
      if (seq <= clientSeq) continue
      clientSeq = seq
      const code = KEYMAP[key.toLowerCase()] ?? KEYMAP[key]
      if (code !== undefined) codes.push(code)
    }
    if (codes.length) await send($, codes)
    return {}
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const ui = $.ui.resolve(e)
    const { Box, Text } = ui
    if (e.surface !== 'terminal' || !('Raster' in ui)) {
      return <Text dimColor>DOOM draws in the terminal only.</Text>
    }
    const { Raster, Client } = ui
    // One row under the screen is the key bar.
    const next = fit(e.props.bodyColumns + 2, e.props.scroll.bodyRows - 1)
    if (!size || next.columns !== size.columns || next.rows !== size.rows) {
      size = next
      frame = undefined
      await $.fs.write(SIZE, `${size.columns} ${size.rows}\n`)
    }

    return (
      <Box flexDirection="column" alignItems="center">
        <Raster key="screen" columns={size.columns} rows={size.rows} cells={frame ?? blank(size)} />
        <Client key="keys" module="./keys.tsx" height={1} />
      </Box>
    )
  })
}
