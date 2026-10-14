import type { ClientModule } from 'claude-code'

export type EarlierProps = {
  // `… 6 earlier calls`
  words: string
}

// The current turn's line in the pane for its calls before its latest ten, as a region of its own: under the pointer
// its words light up, and a press lists those calls under it or leaves them out again
const Earlier: ClientModule<EarlierProps, { isHovered: boolean }> = (props, surface) => {
  if (surface.state === undefined) {
    surface.setState({ isHovered: false })
    surface.onPointer(event => {
      if (event.type === 'enter' || event.type === 'leave') {
        surface.setState({ isHovered: event.type === 'enter' })
      }
      if (event.type === 'down' && event.button === 'left') {
        surface.post({ earlier: true })
      }
    })
  }
  const { Text } = surface.elements

  return (
    <Text dimColor={surface.state?.isHovered !== true} wrap="truncate">
      {props.words}
    </Text>
  )
}

export default Earlier
