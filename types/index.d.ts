export type TimelineOutcome = 'running' | 'ok' | 'error' | 'denied'

export type TimelineCall = {
  id: string
  tool: string
  detail: string
  isSubagent: boolean
  startedAt: number
  endedAt: number | null
  outcome: TimelineOutcome
  // The middle of the times calls like it took in earlier runs, when there were enough of them
  usualMs?: number
  // For a call long enough to ask about: the Bash command it ran, and the end of what it gave back, so Claude answers
  // why it took that long from them, not from a guess once the conversation holds them no more
  command?: string
  output?: string
}

// One stretch of the turn's time: a model request of the main loop, or a tool call
export type TimelineSpan = {
  startedAt: number
  endedAt: number
}

// A model request: its stretch, the tokens its response wrote, and of its prompt's tokens how many the prompt
// cache served (each absent on one kept by an earlier version)
export type TimelineStep = TimelineSpan & {
  outputTokens?: number
  promptTokens?: number
  cachedTokens?: number
}

// A finished main-loop turn, matched to its closing line by its duration
export type TimelineTurn = {
  turnId: string
  durationMs: number
  startedAt: number
  endedAt: number
  calls: TimelineCall[]
  steps: TimelineStep[]
  // The final answer's text, which finds the turn's reply on the desktop
  answer: string
  // The start of what was asked, which the pane lists the turn by; absent on one kept by an earlier version
  prompt?: string
}

// Claude's answer to why a call took as long as it did, asked from its row: while it is asked, its text, or why
// there is none; and whether it hangs under the row
export type TimelineWhy = {
  state: 'asking' | 'answered' | 'failed'
  text: string
  isShown: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'tool-timeline': {
      calls: TimelineCall[]
      steps: TimelineStep[]
      turnStartedAt: number
      // When the turn ended, none while it runs; when the model request under way was sent, none between requests
      turnEndedAt: number | null
      stepStartedAt: number | null
      now: number
      turns: TimelineTurn[]
      expanded: string[]
      // By `<turnId>:<callId>`
      whys: Record<string, TimelineWhy>
      // What Claude was last told of this project's usual times; '' before the first prompt and after a compaction
      toldUsual: string
      // How many times in a row each Bash command failed, by its kind; a command that ran through is let go
      failStreaks: Record<string, number>
      // The start of what the current turn was asked; the earlier turns the pane has unfolded, by id
      turnPrompt: string
      paneOpen: string[]
    }
  }
}
