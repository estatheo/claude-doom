# claude-doom

Doom in a Claude Code pane. `/doom` opens a pane that plays Freedoom, drawn in
the terminal as half-block cells, so it works in tmux with no image protocol.
Click the bar under the screen to give it the keyboard; Esc gives it back.

| Key | Does |
| --- | --- |
| arrows, W/S | move and turn |
| A / D | strafe |
| F or J | fire |
| Space or E | use (doors, switches) |
| 1–7 | weapons |
| Tab | map |
| M or Q | menu (Esc belongs to the pane) |
| Return, Y, N | menu choices |

## How it works

- `engine/doom_claude.c` is a [doomgeneric](https://github.com/ozkl/doomgeneric)
  backend. Every frame it writes `/tmp/claude-doom/frame.bin`, already laid out
  as a Raster's cells (one upper half block per cell, top pixel as foreground,
  bottom as background), at the size the pane asks for in `/tmp/claude-doom/size`.
- `hooks/register.tsx` starts the engine, reads the frame file 30 times a second
  and blits it into the pane's Raster. Keys go to `/tmp/claude-doom/keys` as
  numbered lines the engine polls. A terminal reports only key presses, so the
  engine holds a key down until it stops repeating.
- `hooks/keys.tsx` is the clickable bar that captures the keys.

## Setup

```sh
make -C engine          # builds bin/doom
./fetch-wad.sh          # Freedoom 0.13.0 into wad/
claude --plugin-dir .   # or link this folder into a mods folder
```

doomgeneric is GPL-2.0 (see LICENSE); Freedoom is BSD-licensed
(wad/FREEDOOM-COPYING.txt).
