import type { ClientModule, ElementConstructor, RenderElement, TextProps } from 'claude-code'

// The terminal's tool bars, fixed: a pale sky, where a theme's `suggestion` can be a loud cyan; the floor under
// them dim, so the tall ones are what the eye finds
export const BAR_COLOR = '#86bbd8'
// The slowest call, and one still running, in a soft violet beside them, where a theme's `warning` is a loud yellow
export const SLOW_COLOR = '#b48ead'

export type SummaryProps = { turnId: string; count: string; slowest: string; sparkline: string; isOpen: boolean }

// A turn's folded line on the terminal, as a region of its own: a Button inverts under the pointer, where this only
// lights its dim words, as the engine's own folded rows do, and a press anywhere on the line folds or unfolds the turn
const Summary: ClientModule<SummaryProps, { isHovered: boolean }> = (props, surface) => {
  if (surface.state === undefined) {
    surface.setState({ isHovered: false })
    surface.onPointer(event => {
      if (event.type === 'enter' || event.type === 'leave') {
        surface.setState({ isHovered: event.type === 'enter' })
      }
      if (event.type === 'down' && event.button === 'left') {
        surface.post({ toggle: props.turnId })
      }
    })
  }
  const { Text } = surface.elements
  const isLit = surface.state?.isHovered === true

  // One line, cut at the edge where the transcript is narrow (a pane docked beside it), not each part wrapped apart
  return (
    <Text wrap="truncate">
      <Text dimColor>{'  ⎿  '}</Text>
      <Text bold dimColor={!isLit}>{props.count}</Text>
      <Text dimColor={!isLit}>{' · slowest '}</Text>
      <Text color={SLOW_COLOR}>{props.slowest}</Text>
      {'  '}
      {sparkRuns(Text, props.sparkline)}
      {'  '}
      <Text dimColor={!isLit}>{props.isOpen ? '(click to fold)' : '(click to expand)'}</Text>
    </Text>
  )
}

// `▁▁█▁▅`: the floor's runs dim, the bars above it in full
export function sparkRuns(Text: ElementConstructor<TextProps>, sparkline: string): RenderElement[] {
  return (sparkline.match(/▁+|[^▁]+/g) ?? []).map(run =>
    Text({ color: BAR_COLOR, ...(run.startsWith('▁') ? { dimColor: true } : {}), children: [run] }),
  )
}

export default Summary
