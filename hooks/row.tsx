import type { ClientModule } from 'claude-code'

import { SLOW_COLOR } from './summary'

export type RowProps = {
  turnId: string
  callId: string
  mark: string
  isFailed: boolean
  label: string
  // The spaces after the label that line the rows' words up, drawn apart so the underline stops at the name
  pad: string
  isSlowest: boolean
  usual: string
  detail: string
  // Whether Claude's answer hangs under the row
  isOpen: boolean
  // Whether the call took long enough to ask about; a short one's words stay as they are under the pointer
  canAsk: boolean
}

// The words of an unfolded call row on the terminal, as a region of its own: under the pointer the name underlines
// and a dim hint says what a press does, which asks Claude why the call took as long as it did
const Row: ClientModule<RowProps, { isHovered: boolean }> = (props, surface) => {
  if (surface.state === undefined) {
    surface.setState({ isHovered: false })
    surface.onPointer(event => {
      if (!props.canAsk) {
        return
      }
      if (event.type === 'enter' || event.type === 'leave') {
        surface.setState({ isHovered: event.type === 'enter' })
      }
      if (event.type === 'down' && event.button === 'left') {
        surface.post({ why: { turnId: props.turnId, callId: props.callId } })
      }
    })
  }
  const { Text } = surface.elements
  const isLit = surface.state?.isHovered === true

  return (
    <Text wrap="truncate">
      {' '}
      <Text {...(props.isFailed ? { color: 'error' } : { dimColor: true })}>{props.mark}</Text>
      {' '}
      <Text bold={props.isSlowest} underline={isLit}>
        {props.label}
      </Text>
      {props.pad}
      {props.usual !== '' && <Text color={SLOW_COLOR}>{`  ${props.usual}`}</Text>}
      <Text dimColor={!isLit}>{props.detail === '' ? '' : `  ${props.detail}`}</Text>
      {isLit && <Text dimColor>{props.isOpen ? '  click to hide' : '  click to ask why'}</Text>}
    </Text>
  )
}

export default Row
