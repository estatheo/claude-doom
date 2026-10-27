import type { ClientModule } from 'claude-code'

// The bar under the screen: once clicked it has the keyboard, and each key
// goes to the hooks module. Posts in one frame replace each other, so every
// post carries the recent keys with their numbers and the hooks module takes
// the ones it has not seen.

type State = { focused: boolean }

const Keys: ClientModule<null, State> = (_props, surface) => {
  const { Text } = surface.elements

  if (surface.state === undefined) {
    let seq = 0
    let recent: [number, string][] = []
    surface.onKey(event => {
      seq += 1
      recent = [...recent, [seq, event.key] as [number, string]].slice(-32)
      surface.post({ keys: recent })
      if (!surface.state?.focused) surface.setState({ focused: true })
    })
    surface.onPointer(() => surface.setState({ focused: true }))
    surface.setState({ focused: false })
  }

  return surface.state?.focused ? (
    <Text color="green">▶ playing · arrows/WASD move · F fire · Space use · M menu · Esc to leave</Text>
  ) : (
    <Text dimColor>▶ click here to play · arrows/WASD move · F fire · Space use · M menu</Text>
  )
}

export default Keys
