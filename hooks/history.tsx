import type { ClientModule } from 'claude-code'

import { SLOW_COLOR } from './summary'

// Each column padded to the list's widest, so the lines' columns stand under one another
export type HistoryProps = {
  turnId: string
  // How long ago it ended and with how many calls: `3m ago`, `7 tool calls`
  age: string
  count: string
  slowest: string
  // The start of what was asked, '' for a turn started without a typed prompt or kept by an earlier version
  prompt: string
}

// An earlier turn's words in the pane, after its time and bar, as a region of its own: under the pointer they light
// up, and a press unfolds the turn there or folds it again
const History: ClientModule<HistoryProps, { isHovered: boolean }> = (props, surface) => {
  if (surface.state === undefined) {
    surface.setState({ isHovered: false })
    surface.onPointer(event => {
      if (event.type === 'enter' || event.type === 'leave') {
        surface.setState({ isHovered: event.type === 'enter' })
      }
      if (event.type === 'down' && event.button === 'left') {
        surface.post({ open: props.turnId })
      }
    })
  }
  const { Text } = surface.elements
  const isLit = surface.state?.isHovered === true

  return (
    <Text wrap="truncate">
      <Text dimColor={!isLit}>{` ${props.age}  ${props.count}  `}</Text>
      <Text color={SLOW_COLOR}>{props.slowest}</Text>
      {props.prompt !== '' && <Text dimColor={!isLit}>{`  ${props.prompt}`}</Text>}
    </Text>
  )
}

export default History
