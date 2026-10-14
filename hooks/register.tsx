import { atom, read, update } from 'claude-code'
import type {
  BoxProps,
  ButtonProps,
  ClientProps,
  ElementConstructor,
  EngineInterface,
  ImageProps,
  ImageSource,
  Register,
  RenderElement,
  SvgProps,
  TextProps,
} from 'claude-code'

import type { TimelineCall, TimelineOutcome, TimelineSpan, TimelineStep, TimelineTurn, TimelineWhy } from '../types'
import { barPicture } from './bars'
import type { HistoryProps } from './history'
import type { RowProps } from './row'
import { BAR_COLOR, SLOW_COLOR, sparkRuns, type SummaryProps } from './summary'

const PANE = 'tool-timeline'
const MAX_CALLS = 200
const MAX_TURNS = 50
// An unfolded turn lists its slowest calls only, so a long turn stays readable
const MAX_UNFOLDED_ROWS = 10
const BAR_CELLS = 10
// The terminal's bars: blocks that join without a seam, standing on a baseline where nothing ran; six eighths
// tall, their middle nearer the letters' beside them than five's, a gap left between rows that seven's closes
const BAR = '▆'
const TRACK = '▁'
const SPARKS = '▁▂▃▄▅▆▇█'
const MAX_SPARKS = 24
// An unfolded turn draws one lane per tool, and one for Claude's own requests, across this many cells
const LANE_CELLS = 30
// A lane's name is cut past this many letters; `clens_left_off` fits
const LANE_NAME_LETTERS = 14
// The pane's lanes are as wide as it leaves beside a lane's name and the longest of its turn's totals, within these
const MIN_PANE_LANE_CELLS = 12
// Under the current turn the pane lists so many earlier ones, each by the start of what was asked, so many letters
const MAX_PANE_TURNS = 10
const MAX_PROMPT_LETTERS = 20
// Claude's own lane in Claude's clay, fixed: the theme's `claude` key follows the person's theme
const CLAUDE_COLOR = '#d97757'
// The SVG is drawn as an image, so it takes fixed colors that read on a light and a dark page
const TOOL_COLOR = '#74b3d6'
// The gray the desktop draws its own folded tool rows in (`Showed current date and time ›`), measured
const FOLDED_ROW_GRAY = '#898782'
// The desktop's lane width in CSS pixels, and its name column in cells; a call row's bar on its pane, in pixels too
const LANE_WIDTH = 280
// In a narrow pane the lanes give way down to this
const MIN_LANE_WIDTH = 80
const DESKTOP_ROW_WIDTH = 80
// A pane row's branch, and its mark, each take a column this wide
const DESKTOP_MARK_CELLS = 2
const DESKTOP_LABEL_CELLS = 12
// The lane's time column fits `1m05s`; a letter of the desktop's font takes about this much of a cell
const DESKTOP_TIME_CELLS = 5
const DESKTOP_CELLS_PER_LETTER = 0.75
// A cell of the desktop's pane is about this many CSS pixels wide, measured on the app
const DESKTOP_PX_PER_CELL = 7.8
const INK_COLOR = '#8a8a8a'
// A picture bar's track in that gray, as strong as a dim glyph's on a dark terminal
const PICTURE_TRACK_ALPHA = 0.5
const MAX_STEPS = 200
// The first of these a tool's arguments carry is shown beside its name: the model's own
// one-line description before a raw command, which runs long
const DETAIL_KEYS = ['description', 'file_path', 'pattern', 'url', 'query', 'path', 'command']
const PATH_KEYS = new Set(['file_path', 'path'])
const MAX_DETAIL = 60
const MARKS: Record<TimelineOutcome, string> = { running: '…', ok: '·', error: '✗', denied: '⊘' }
// The calls' times kept between sessions, under a key per project and kind of call: its latest times, for so many
// kinds of all projects together
const DURATIONS_KEY = 'durations'
// A session's finished turns kept between runs, so a resumed one still folds its earlier turns: the latest so many
// sessions, each in so much JSON at most, as the store holds 4 MiB in all
const TURNS_KEY_PREFIX = 'turns:'
const MAX_KEPT_SESSIONS = 5
const MAX_KEPT_SESSION_CHARS = 400_000
// An answer is kept by its end, all the desktop matches a reply against
const MAX_KEPT_ANSWER = 4_000
const MAX_SAMPLES = 20
const MAX_KINDS = 1000
// A call is slow against its usual time once it took twice that and a second more, with enough times to go by
const MIN_SAMPLES = 3
const SLOW_MARGIN_MS = 1000
// The spinner fills a gauge of so many cells toward the running call's usual time; a call usually done within a
// second has nothing to fill
const PROGRESS_CELLS = 6
const MIN_PROGRESS_MS = 1000
// A row is worth asking Claude about once its call took this long, or far longer than it usually does
const MIN_WHY_MS = 5000
// What a call ran and gave back is kept from a second on, as calls like it can take that long together: the
// command's start and the output's end, so much of each
const MIN_EVIDENCE_MS = 1000
const MAX_EVIDENCE_CHARS = 1000
// A row of calls like it asks about its longest so many
const MAX_ASKED_CALLS = 3
// With the person's prompts Claude is told how long this project's slow commands usually take, those worth choosing
// a narrower one over: so many at most, the slowest first
const MIN_TOLD_MS = 10_000
const MAX_TOLD = 8
// What the model reads of a call refused at the permission prompt, from its start: by the person at the dialog, or by
// auto mode's classifier
const REFUSED_TEXTS = [
  "The user doesn't want to proceed with this tool use.",
  'Permission for this action was denied by the Claude Code auto mode classifier.',
]
// A call this long raises a notification when it ends
const LONG_CALL_MS = 30_000
// A Bash command failing this many times in a row, with no run of it going through between, says so once: Claude
// is likely trying the same thing again, a moment for the person to step in. So many commands are counted at most
const FAIL_STREAK = 3
const MAX_FAIL_STREAKS = 100
const FAIL_TOAST_MS = 8000

const calls = atom({ plugin: 'tool-timeline', key: 'calls' } as const, [])
// The current turn's model requests on the main loop, and when the turn began
const steps = atom({ plugin: 'tool-timeline', key: 'steps' } as const, [])
const turnStartedAt = atom({ plugin: 'tool-timeline', key: 'turnStartedAt' } as const, 0)
// When the turn ended, none while it runs; and when the main loop's model request under way was sent, none between
const turnEndedAt = atom({ plugin: 'tool-timeline', key: 'turnEndedAt' } as const, null)
const stepStartedAt = atom({ plugin: 'tool-timeline', key: 'stepStartedAt' } as const, null)
// The time the drawing measures running calls and the request under way against, moved once a second while either is
const now = atom({ plugin: 'tool-timeline', key: 'now' } as const, 0)
const turns = atom({ plugin: 'tool-timeline', key: 'turns' } as const, [])
// The turns whose summary line is unfolded
const expanded = atom({ plugin: 'tool-timeline', key: 'expanded' } as const, [])
// Claude's answers to why a call took that long, asked from its unfolded row
const whys = atom({ plugin: 'tool-timeline', key: 'whys' } as const, {})
const toldUsual = atom({ plugin: 'tool-timeline', key: 'toldUsual' } as const, '')
const failStreaks = atom({ plugin: 'tool-timeline', key: 'failStreaks' } as const, {})
// The start of what the current turn was asked; the earlier turns the pane has unfolded
const turnPrompt = atom({ plugin: 'tool-timeline', key: 'turnPrompt' } as const, '')
const paneOpen = atom({ plugin: 'tool-timeline', key: 'paneOpen' } as const, [])
// The calls under way the engine refused, from `tool.check` to the call's end: one dispatch of `tool.call` reads its
// state as of one moment, so it would not see a refusal written there
const refusals = new Set<string>()

// A call, or in an unfolded turn the calls of one kind repeated: their time together and how many
type Row = { call: TimelineCall; ms: number; count: number }
// A lane: Claude's requests, or one tool's calls, as stretches of the turn; Claude's with the tokens it wrote and its
// requests that missed the prompt cache
type Lane = { name: string; spans: TimelineSpan[]; count: number; unit: string; outputTokens?: number; missed?: TimelineSpan[] }
type TextElement = ElementConstructor<TextProps>
// The elements a fold draws with; `Svg` only where the surface has one
type Kit = {
  Box: ElementConstructor<BoxProps>
  Text: TextElement
  Button: ElementConstructor<ButtonProps>
  Svg: ElementConstructor<SvgProps> | undefined
  Client?: ElementConstructor<ClientProps>
  // Only where the terminal draws pictures: the bars then drawn as pictures, not glyphs
  Image?: ElementConstructor<ImageProps>
}
// What the desktop draws its lanes and pane rows with
type DesktopKit = { Box: ElementConstructor<BoxProps>; Text: TextElement; Svg: ElementConstructor<SvgProps> }
// What the pane draws a turn with: glyphs, pictures where the terminal draws them, or the desktop's columns; in so many
// columns
type PaneDraw = { Text: TextElement; pictures?: Pictures; desktop?: DesktopKit; columns: number }
// What the pane draws its earlier turns' lines with: a region for each line's words where the surface has one, a
// button elsewhere
type HistoryKit = {
  Box: ElementConstructor<BoxProps>
  Text: TextElement
  Button: ElementConstructor<ButtonProps>
  Client: ElementConstructor<ClientProps> | undefined
  draw: PaneDraw
}
// What a line draws its bar as a picture with
type Pictures = { Box: ElementConstructor<BoxProps>; Image: ElementConstructor<ImageProps> }
// Where a row's words are a region of their own, a press on them asking Claude why the call took that long
// Where a lane line starts, under the line it hangs from, and how many cells its bars take
type LaneLayout = { lead: string; cells: number }
const UNFOLDED_LANE: LaneLayout = { lead: '     ', cells: LANE_CELLS }
type Region = { Box: ElementConstructor<BoxProps>; Client: ElementConstructor<ClientProps>; key: string; turnId: string; isOpen: boolean }

// Pictures as files the terminal reads itself: a drawing then carries their paths, not their pixels, which drawn
// again with every press and every redraw kept a press from showing for most of a second. A session's files go under
// a folder of its own; a folder left a day is let go when a session starts
const PICTURE_DIR = '/tmp/tool-timeline'
const pictureFiles = new WeakMap<ImageSource, ImageSource>()
// Pictures drawn from their pixels since the last were filed; those being filed; how often each could not be, given
// up on after so many. Names start with when this module first filed one, so a reload never reuses a name for other
// pixels, which the terminal, going by the name, would not read again
const unfiled = new Set<ImageSource>()
const filing = new Map<ImageSource, Promise<void>>()
const failures = new WeakMap<ImageSource, number>()
const MAX_FILE_TRIES = 2
let filedCount = 0
let filedRun: number | undefined
// Whether this module has let go of what a run before it left half made, cut off by a reload
let isSwept = false

// The picture as a file once it is one; until then its pixels, the picture noted to be filed
function filed(source: ImageSource): ImageSource {
  const file = pictureFiles.get(source)
  if (file !== undefined) {
    return file
  }
  if ('rgba' in source && (failures.get(source) ?? 0) < MAX_FILE_TRIES) {
    unfiled.add(source)
  }

  return source
}

// Draws a tree; when it holds pictures not yet in files, files them and draws it again, with their paths
async function drawFiled($: EngineInterface, draw: () => RenderElement | Promise<RenderElement>): Promise<RenderElement> {
  const drawn = await draw()
  if (unfiled.size === 0) {
    return drawn
  }
  const fresh = [...unfiled].filter(source => !filing.has(source) && !pictureFiles.has(source))
  unfiled.clear()
  if (fresh.length > 0) {
    const batch = fileBatch($, fresh).finally(() => fresh.forEach(source => filing.delete(source)))
    fresh.forEach(source => filing.set(source, batch))
  }
  await Promise.all(filing.values())

  return draw()
}

// The pictures' pixels written as text, then turned to bytes by one command for them all, each moved into place
// whole and named back once it is; one not named back is drawn from its pixels and tried again on a later drawing
async function fileBatch($: EngineInterface, sources: ImageSource[]) {
  const done = new Set<string>()
  const paths: string[] = []
  try {
    filedRun ??= await $.clock.now()
    const dir = `${PICTURE_DIR}/${await $.session.id()}`
    paths.push(...sources.map(() => `${dir}/${filedRun}-${filedCount++}.rgba`))
    await Promise.all(sources.map((source, i) => ('rgba' in source ? $.fs.write(`${paths[i]}.b64`, source.rgba) : undefined)))
    // The first of this module's runs also lets go of the text and part files of runs before it in the folder
    const decode =
      'd=$1; r=$2; shift 2; [ -n "$d" ] && find "$d" -maxdepth 1 \\( -name "*.b64" -o -name "*.part" \\) ! -name "$r-*" -delete 2>/dev/null; ' +
      'for p; do if base64 -d < "$p.b64" > "$p.part" && [ -s "$p.part" ] && mv "$p.part" "$p"; then echo "$p"; else rm -f "$p.part"; fi; rm -f "$p.b64"; done'
    const sweep = isSwept ? '' : dir
    isSwept = true
    const { stdout } = await $.process.run(['sh', '-c', decode, 'sh', sweep, String(filedRun), ...paths])
    stdout.split('\n').forEach(line => done.add(line))
  } catch {
    // Those not named back are drawn from their pixels
  }
  sources.forEach((source, i) => {
    const path = paths[i]
    if ('rgba' in source && path !== undefined && done.has(path)) {
      pictureFiles.set(source, { file: path, format: 'rgba', width: source.width, height: source.height })
    } else {
      failures.set(source, (failures.get(source) ?? 0) + 1)
    }
  })
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'tool-timeline',
      description: "Show this turn's tool calls and how long each took",
      immediate: true,
    })
    $.clock.every(1000, () => void tick($))
    const old = ['find', PICTURE_DIR, '-mindepth', '1', '-maxdepth', '1', '-mmin', '+1440', '-exec', 'rm', '-rf', '{}', '+']
    $.clock.after(0, () => void $.process.run(old).catch(() => undefined))
    // A reload drops the timer an answer was coming on: those rows are asked again on their next press
    await update($, whys, all => Object.fromEntries(Object.entries(all).filter(([, why]) => why.state !== 'asking')))
    // Nor does the request a reload cut off end here
    await update($, stepStartedAt, () => null)
    // A resumed session's earlier turns, as it kept them when it last ran; a hot reload still holds its own
    const kept = await keptTurnsOf($)
    if (kept.length > 0) {
      await update($, turns, all => (all.length > 0 ? all : kept))
    }

    return next(e)
  })

  on('command.run', { command: 'tool-timeline' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Tool timeline' })

    return {}
  })

  // With the person's prompt, unseen by them, how long this project's slow commands usually take, so Claude can run
  // a narrower one or a long one in the background; told again only once the times change
  on('prompt.submit', async ($, e, next) => {
    const note = await usualTimesNote($)
    if (note === '' || note === (await read($, toldUsual))) {
      return next(e)
    }
    await update($, toldUsual, () => note)

    return next({ ...e, context: [...(e.context ?? []), note] })
  })

  // A compaction may drop what Claude was told: the next prompt tells it again
  on('session.compact', async ($, e, next) => {
    const compacted = await next(e)
    await update($, toldUsual, () => '')

    return compacted
  })

  // Each prompt's turn starts a new timeline; the last one stays until then
  on('turn.start', async ($, e, next) => {
    const time = await $.clock.now()
    await update($, calls, () => [])
    await update($, steps, () => [])
    await update($, turnStartedAt, () => time)
    await update($, turnEndedAt, () => null)
    await update($, turnPrompt, () => cut(e.text.replace(/\s+/g, ' ').trim(), MAX_PROMPT_LETTERS))

    return next(e)
  })

  // Each model request of the main loop, timed from its send to the end of its response, with what the response wrote
  on('turn.step', async function* ($, e, next) {
    if (e.agentId !== undefined) {
      return yield* next(e)
    }
    const startedAt = await $.clock.now()
    await update($, stepStartedAt, () => startedAt)
    // None when no response came back, or it reported no usage
    let outputTokens = 0
    let promptTokens = 0
    let cachedTokens = 0
    try {
      const response = yield* next(e)
      const usage = response.usage
      outputTokens = usage?.output_tokens ?? 0
      if (usage !== null) {
        promptTokens = usage.input_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens
        cachedTokens = usage.cache_read_input_tokens
      }

      return response
    } finally {
      const endedAt = await $.clock.now()
      const step = { startedAt, endedAt, outputTokens, ...(promptTokens > 0 ? { promptTokens, cachedTokens } : {}) }
      await update($, steps, list => [...list, step].slice(-MAX_STEPS))
      await update($, stepStartedAt, () => null)
    }
  })

  // Keep each finished turn's timeline for the summary drawn under its closing line
  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      const time = await $.clock.now()
      await update($, turnEndedAt, () => time)
      const list = await read($, calls)
      if (list.length > 0) {
        const turn: TimelineTurn = {
          turnId: e.turnId,
          durationMs: e.durationMs,
          startedAt: await read($, turnStartedAt),
          endedAt: time,
          calls: list,
          steps: await read($, steps),
          answer: e.answer,
          prompt: await read($, turnPrompt),
        }
        await update($, turns, all => [...all, turn].slice(-MAX_TURNS))
        await keepTurns($, await read($, turns))
      }
    }

    return next(e)
  })

  // The engine's verdict before a call runs: one it refused (a rule, a hook) never ran, its error no failure of the call
  on('tool.check', async (_, e, next) => {
    const verdict = await next(e)
    if (e.tool_use_id !== undefined && verdict.decision === 'deny') {
      refusals.add(e.tool_use_id)
    }

    return verdict
  })

  on('tool.call', async ($, e, next) => {
    const id = e.tool_use_id
    const kind = kindOf(e)
    // The project its times are kept under; one the session cannot name keeps them under none
    const root = await $.session.root().catch(() => '')
    const call: TimelineCall = {
      id,
      tool: toolName(e.tool),
      detail: detailOf(e),
      isSubagent: e.agentId !== undefined,
      startedAt: await $.clock.now(),
      endedAt: null,
      outcome: 'running',
      usualMs: kind === undefined ? undefined : usualOf((await durationsOf($))[usualKey(root, kind)]),
    }
    await update($, calls, list => [...list, call].slice(-MAX_CALLS))

    let outcome: TimelineOutcome = 'error'
    let output: string | undefined
    // A command sent on to the background, by its own flag, by ctrl+b or at its timeout: the call ends, the command not
    let isBackgrounded = false
    try {
      const ran = await next(e)
      // As the model read it; a hook's own result carries no text, its result then read when it is one
      output = ran.text ?? (typeof ran.result === 'string' ? ran.result : undefined)
      isBackgrounded = typeof (ran.result as { backgroundTaskId?: unknown } | null | undefined)?.backgroundTaskId === 'string'
      // Refused by a plugin, by a rule, by the person at the dialog, or by auto mode's classifier
      const isRefused =
        ran.deny !== undefined || refusals.has(id) || (ran.isError === true && REFUSED_TEXTS.some(text => output?.startsWith(text) === true))
      outcome = isRefused ? 'denied' : ran.isError ? 'error' : 'ok'

      return ran
    } finally {
      refusals.delete(id)
      const endedAt = await $.clock.now()
      const ms = endedAt - call.startedAt
      const evidence = ms >= MIN_EVIDENCE_MS ? evidenceOf(e, output) : {}
      await update($, calls, list =>
        list.map(one => (one.id === id ? { ...one, endedAt, outcome, ...evidence } : one)),
      )
      // Only a call that ran through sets what is usual; a backgrounded one says nothing of how long its command takes
      if (kind !== undefined && outcome === 'ok' && !isBackgrounded) {
        await recordDuration($, usualKey(root, kind), ms)
      }
      // A long call's end is worth hearing from another window; a denied one ended at the person's own answer, a
      // backgrounded one's command has not finished
      if (ms >= LONG_CALL_MS && outcome !== 'denied' && !isBackgrounded) {
        const verb = outcome === 'ok' ? 'finished in' : 'failed after'
        void $.ui.notify(`${call.tool} ${verb} ${formatMs(ms)}${call.detail === '' ? '' : ` · ${call.detail}`}`).catch(() => {})
      }
      // A denied run says nothing of whether the command works
      if (kind?.startsWith('Bash:') && outcome !== 'denied') {
        const streak = await countFailure($, kind, outcome === 'error')
        if (streak === FAIL_STREAK) {
          const text = `${call.tool} failed ${FAIL_STREAK} times in a row · ${cut(kind.slice('Bash:'.length), MAX_DETAIL)}`
          $.ui.toast(text, { timeoutMs: FAIL_TOAST_MS })
          void $.ui.notify(text).catch(() => {})
        }
      }
    }
  })

  // The current turn as an unfolded one is drawn, live: its lanes so far, then its calls in the order they ran, a
  // running one with its gauge toward its usual time; under it the earlier turns, a line each, unfolded on a press
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const kit = $.ui.resolve(e)
    const { Box, Text, Button } = kit
    const list = await read($, calls)
    const at = await read($, now)
    const rows = rowsOf(list, at)
    const sent = await read($, stepStartedAt)
    // The request under way grows up to now, as a running call does
    const requests = [...(await read($, steps)), ...(sent === null ? [] : [{ startedAt: sent, endedAt: Math.max(at, sent) }])]
    const Image = e.surface === 'terminal' ? await picturesImage($, kit) : undefined
    const draw: PaneDraw = {
      Text,
      pictures: Image === undefined ? undefined : { Box, Image },
      // The desktop's font is not one of even letters: there the lines are columns, their bars SVG, as its folds are
      desktop: e.surface === 'desktop' && 'Svg' in kit ? { Box, Text, Svg: kit.Svg as ElementConstructor<SvgProps> } : undefined,
      columns: e.props.bodyColumns,
    }
    const Client = e.surface === 'terminal' && 'Client' in kit ? (kit.Client as ElementConstructor<ClientProps>) : undefined
    const startedAt = await read($, turnStartedAt)
    // Once the turn is done, as long as it took; until then, up to its latest moment known
    const ended = await read($, turnEndedAt)
    const isDone = ended !== null
    // The turns before, newest first; the current one, once done, is the one drawn above
    const time = await $.clock.now()
    const open = await read($, paneOpen)
    const earlier = (await read($, turns))
      .filter(one => !(isDone && one.startedAt === startedAt))
      .slice(-MAX_PANE_TURNS)
      .reverse()
    const history = () =>
      earlier.length > 0 && [
        <Text> </Text>,
        <Text bold>Earlier</Text>,
        ...historyLines({ Box, Text, Button, Client, draw }, earlier, open, time, turnId => togglePaneTurn($, turnId)),
      ]

    if (rows.length === 0 && requests.length === 0) {
      return drawFiled($, () => (
        <Box flexDirection="column">
          <Text dimColor>No tool calls in this turn yet.</Text>
          {history()}
        </Box>
      ))
    }
    const endedAt = ended ?? Math.max(at, ...list.map(call => call.endedAt ?? call.startedAt), ...requests.map(step => step.endedAt))
    const turn: TimelineTurn = { turnId: 'live', durationMs: endedAt - startedAt, startedAt, endedAt, calls: list, steps: requests, answer: '' }
    const running = rows.filter(row => row.call.outcome === 'running').length
    const slowest = rows.length === 0 ? undefined : slowestOf(rows)
    // While it runs its bars change every second, each a new picture: glyphs then, pictures once it is done
    const current: PaneDraw = isDone ? draw : { ...draw, pictures: undefined }

    return drawFiled($, () => (
      <Box flexDirection="column">
        <Text wrap="truncate">
          <Text bold>{isDone ? 'Last turn' : 'This turn'}</Text>
          <Text dimColor>{` · ${formatMs(turn.durationMs)}${rows.length === 0 ? '' : ` · ${countOf(rows)}`}`}</Text>
          {running > 0 && <Text color={SLOW_COLOR}>{` · ${running} running`}</Text>}
          {slowest !== undefined && <Text dimColor>{' · slowest '}</Text>}
          {slowest !== undefined && <Text color={SLOW_COLOR}>{`${slowest.call.tool} ${formatMs(slowest.ms)}`}</Text>}
        </Text>
        <Text> </Text>
        {paneTurnBody(current, turn, rows, true)}
        {history()}
      </Box>
    ))
  })

  // While a turn runs: after the spinner's word, the call running longest (its time ticking) and the count so far
  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    const rows = rowsOf(await read($, calls), await read($, now))
    if (rows.length === 0) {
      return next(e)
    }

    return next({ ...e, props: { ...e.props, suffix: `${e.props.suffix}${spinnerNote(rows)}` } })
  })

  // Under a turn's closing line (`Baked for 3s`): one folded line, a click unfolds the turn
  on('ui.render', { component: 'TurnDuration' }, async ($, e, next) => {
    // The line carries no turn id; its duration is the one turn.complete reported
    const turn = (await read($, turns)).find(one => one.durationMs === e.props.durationMs)
    if (turn === undefined) {
      return next(e)
    }

    const kit = $.ui.resolve(e)
    const engine = await next(e)
    const Image = await picturesImage($, kit)

    return drawFiled($, () => foldedTurn($, { ...kit, Svg: undefined, Image }, turn, engine))
  })

  // The desktop draws no closing line: there the fold hangs under the turn's final reply, its lanes an SVG
  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    if (e.surface !== 'desktop' || e.props.isSummary) {
      return next(e)
    }
    const turn = turnOfReply(await read($, turns), e.props.text)
    if (turn === undefined) {
      return next(e)
    }

    return foldedTurn($, $.ui.resolve(e), turn, await next(e))
  })

  // A press on a turn's folded line on the terminal, on one of its unfolded rows, or on an earlier turn's line in the
  // pane, which their regions post
  on('ui.message', async ($, e, next) => {
    const { toggle, why, open } = (e.data ?? {}) as { toggle?: unknown; why?: { turnId?: unknown; callId?: unknown }; open?: unknown }
    if (e.module === 'hooks/summary.tsx' && typeof toggle === 'string') {
      await toggleTurn($, toggle)

      return {}
    }
    if (e.module === 'hooks/history.tsx' && typeof open === 'string') {
      await togglePaneTurn($, open)

      return {}
    }
    if (e.module === 'hooks/row.tsx' && typeof why?.turnId === 'string' && typeof why.callId === 'string') {
      await askWhy($, why.turnId, why.callId)

      return {}
    }

    return next(e)
  })
}

// A press on a row: asks Claude why the call took that long, once; a press again hides the answer or shows it, and
// asks again after a failure
async function askWhy($: EngineInterface, turnId: string, callId: string) {
  const key = `${turnId}:${callId}`
  const known = (await read($, whys))[key]
  if (known?.state === 'asking') {
    return
  }
  if (known?.state === 'answered') {
    await update($, whys, all => ({ ...all, [key]: { ...known, isShown: !known.isShown } }))
    return
  }
  const turn = (await read($, turns)).find(one => one.turnId === turnId)
  if (turn === undefined) {
    return
  }
  const rows = rowsOf(turn.calls, 0)
  const row = groupedRows(rows).find(one => one.call.id === callId)
  if (row === undefined || !canAskWhy(row)) {
    return
  }
  // The row's calls, the longest first
  const members = rows
    .filter(one => groupKeyOf(one.call) === groupKeyOf(row.call))
    .sort((a, b) => b.ms - a.ms)
  const asking: TimelineWhy = { state: 'asking', text: '', isShown: true }
  await update($, whys, all => ({ ...all, [key]: asking }))
  // The answer takes a model request: on a timer, it outlives the press that asked for it
  $.clock.after(0, () => void forkWhy($, key, row, members))
}

// The question over the session's own transcript, so its cached prefix serves it and the conversation keeps nothing
async function forkWhy($: EngineInterface, key: string, row: Row, members: Row[]) {
  let why: TimelineWhy
  try {
    const reply = await $.model.fork({ prompt: whyPrompt(row, members) })
    why = reply.isAnswered
      ? { state: 'answered', text: reply.text.trim(), isShown: true }
      : { state: 'failed', text: `no answer (${reply.reason === 'api-error' ? `${reply.reason} ${reply.status ?? reply.error}` : reply.reason}); click to ask again`, isShown: true }
  } catch (error) {
    why = { state: 'failed', text: `no answer (${String(error)}); click to ask again`, isShown: true }
  }
  await update($, whys, all => ({ ...all, [key]: why }))
}

function canAskWhy(row: Row): boolean {
  return row.ms >= MIN_WHY_MS || usualNote(row) !== ''
}

// The question names the call and hands over what its calls ran and gave back, as kept when they ran, and holds the
// answer to what those show: where they do not show where the time went, it is to say so rather than guess
function whyPrompt(row: Row, members: Row[]): string {
  const { call, ms, count } = row
  const what = `${count > 1 ? `the ${count} ${call.tool} calls` : `the ${call.tool} call`}${call.detail === '' ? '' : ` on "${call.detail}"`} (tool_use_id ${call.id})`
  const usual = call.usualMs === undefined ? '' : `, where calls like it usually take ${formatMs(call.usualMs)}`
  const inside = call.isSubagent ? ' It ran inside a subagent, whose own steps are not in this conversation.' : ''
  const records = members.slice(0, MAX_ASKED_CALLS).map(recordOf).filter(record => record !== '')
  const kept =
    records.length === 0
      ? 'Nothing of what it ran or gave back was recorded.'
      : `Recorded as it ran, ${count > 1 ? 'the longest of them, each' : 'its'} command and the end of its output:\n${records.join('\n')}`

  return (
    `In this conversation, ${what} took ${formatMs(ms)}${count > 1 ? ' together' : ''}${usual}.${inside}\n${kept}\n` +
    'Answer only from what this record and this conversation show: where they do not show where the time went, ' +
    'say plainly that they do not rather than guess, and suggest a change only where they point to one. ' +
    'In at most three short sentences of plain text, without markdown: why did it take that long, and what would ' +
    'make it faster next time? Answer in the language the user writes in, and call no tools.'
  )
}

function recordOf({ call, ms }: Row): string {
  if (call.command === undefined && call.output === undefined) {
    return ''
  }

  return [
    `<call took="${formatMs(ms)}"${call.outcome === 'ok' ? '' : ` outcome="${call.outcome}"`}>`,
    ...(call.command === undefined ? [] : [`<command>${call.command}</command>`]),
    ...(call.output === undefined ? [] : [`<output_end>${call.output}</output_end>`]),
    '</call>',
  ].join('\n')
}

// What a call ran, when it is a Bash command, by its start, and what it gave back by its end
function evidenceOf(e: { tool: string }, output: string | undefined): Pick<TimelineCall, 'command' | 'output'> {
  const command = bashCommandOf(e)

  return {
    ...(command === undefined ? {} : { command: command.slice(0, MAX_EVIDENCE_CHARS) }),
    ...(output === undefined ? {} : { output: output.length > MAX_EVIDENCE_CHARS ? `…${output.slice(-MAX_EVIDENCE_CHARS)}` : output }),
  }
}

function toggleTurn($: EngineInterface, turnId: string) {
  return update($, expanded, ids => (ids.includes(turnId) ? ids.filter(id => id !== turnId) : [...ids, turnId]))
}

// The pane unfolds its earlier turns apart from the transcript's folds
function togglePaneTurn($: EngineInterface, turnId: string) {
  return update($, paneOpen, ids => (ids.includes(turnId) ? ids.filter(id => id !== turnId) : [...ids, turnId]))
}

// Ghostty (cmux, built on it, says so too) and kitty draw pictures; any other terminal keeps the glyphs, as does a
// host that cannot read the environment, where the drawing would otherwise not draw at all, and a session over ssh,
// whose picture files are on a machine the terminal cannot read
async function picturesImage($: EngineInterface, kit: object): Promise<ElementConstructor<ImageProps> | undefined> {
  const env = async (read: Promise<string | undefined>) => read.catch(() => undefined)
  const drawsPictures =
    ((await env($.env.get('TERM_PROGRAM'))) === 'ghostty' || (await env($.env.get('TERM'))) === 'xterm-kitty') &&
    !(await env($.env.get('SSH_CONNECTION')))

  return drawsPictures && 'Image' in kit ? (kit.Image as ElementConstructor<ImageProps>) : undefined
}

// The engine's own drawing, then the folded summary line and, unfolded, the lanes and the slowest calls
async function foldedTurn($: EngineInterface, kit: Kit, turn: TimelineTurn, engine: RenderElement) {
  const { Box, Text, Button, Svg, Client, Image } = kit
  const pictures = Image === undefined ? undefined : { Box, Image }
  const isOpen = (await read($, expanded)).includes(turn.turnId)
  const rows = rowsOf(turn.calls, 0)
  const slowest = slowestOf(rows)
  // Unfolded, repeated calls share a row, and the rows longest together come first
  const shown = groupedRows(rows)
    .sort((a, b) => b.ms - a.ms)
    .slice(0, MAX_UNFOLDED_ROWS)
  const top = shown[0] ?? slowest
  const hidden = rows.length - shown.reduce((sum, row) => sum + row.count, 0)
  const hasMore = hidden > 0
  const nameWidth = nameWidthOf(shown)
  const lanes = lanesOf(turn)
  const toggle = () => toggleTurn($, turn.turnId)
  const asked = await read($, whys)

  // The desktop: the folded summary in the gray of the app's own folded tool rows, so the reply stays the main
  // thing; unfolded, the lanes' bars as SVG and the words dim
  if (Svg !== undefined) {
    const summary = `${countOf(rows)} · slowest ${slowest.call.tool} ${formatMs(slowest.ms)} · ${formatMs(turn.durationMs)} turn`

    return (
      <Box flexDirection="column">
        {engine}
        {/* Half a cell in, where the reply's own text starts */}
        <Box flexDirection="column" marginTop={1} paddingLeft={0.5}>
          {/* Drawn as the app's own folded tool rows are: light gray while folded, a step darker unfolded, an icon
              chevron after. A desktop Button draws no lighter than dim, so the words are a Text in that gray and the
              press lands on a Button of blank label laid over the line */}
          <Box flexDirection="row" alignItems="center">
            <Text {...(isOpen ? { dimColor: true } : { color: FOLDED_ROW_GRAY })}>{summary}</Text>
            <Svg source={chevronSvg(isOpen)} width={14} height={10} alt={isOpen ? 'unfolded' : 'folded'} />
            <Box position="absolute" top={0} left={0}>
              {/* No-break spaces: a label of plain spaces is trimmed to nothing, and with it the place to press */}
              <Button key={`turn-${turn.turnId}`} plain label={'\u00a0'.repeat(summary.length * 2 + 4)} onPress={toggle} />
            </Box>
          </Box>
          {isOpen && lanes.length > 0 && (
            // Unfolded content sits further in than the summary it hangs from
            <Box flexDirection="column" marginTop={1} paddingLeft={2}>
              {desktopLaneLines({ Box, Text, Svg }, lanes, turn)}
            </Box>
          )}
          {isOpen && (
            <Box flexDirection="column" marginTop={1} paddingLeft={2}>
              {shown.map(row => (
                <Text dimColor wrap="truncate">
                  {callLine(row)}
                </Text>
              ))}
              {hasMore && <Text dimColor>{`• … ${leftOut(hidden, 'faster')}`}</Text>}
            </Box>
          )}
        </Box>
      </Box>
    )
  }

  return (
    <Box flexDirection="column">
      {engine}
      {Client !== undefined ? (
        // The whole line pressed, its dim words lit under the pointer (summary.tsx)
        <Client
          key={`turn-${turn.turnId}`}
          module="./summary.tsx"
          props={{
            turnId: turn.turnId,
            count: countOf(rows),
            slowest: `${slowest.call.tool} ${formatMs(slowest.ms)}`,
            sparkline: sparkline(rows),
            isOpen,
          } satisfies SummaryProps}
        />
      ) : (
        // Where no region draws: the summary in its colors, then the toggle as dim words, as a Button inverts under
        // the pointer and only these words should
        <Box flexDirection="row">
          <Text dimColor>{'  ⎿  '}</Text>
          <Text bold>{countOf(rows)}</Text>
          <Text dimColor>{' · slowest '}</Text>
          <Text color={SLOW_COLOR}>{`${slowest.call.tool} ${formatMs(slowest.ms)}`}</Text>
          <Text>{'  '}</Text>
          {sparkRuns(Text, sparkline(rows))}
          <Text>{'  '}</Text>
          <Button key={`turn-${turn.turnId}`} plain dimColor label={isOpen ? '(click to fold)' : '(click to expand)'} onPress={toggle} />
        </Box>
      )}
      {isOpen && lanes.map(lane => laneLine(Text, lane, turn, pictures))}
      {isOpen && lanes.length > 0 && <Text> </Text>}
      {isOpen &&
        shown.map((row, i) => {
          const isLast = i === shown.length - 1 && !hasMore
          const why = asked[`${turn.turnId}:${row.call.id}`]
          const isShown = why?.isShown === true
          const region = Client === undefined ? undefined : { Box, Client, key: `row-${turn.turnId}-${i}`, turnId: turn.turnId, isOpen: isShown }

          return [
            rowLine(Text, row, top, nameWidth, `     ${isLast ? '└ ' : '├ '}`, pictures, region),
            isShown && whyLine(Box, Text, why, isLast ? '         ' : '     │   '),
          ]
        })}
      {isOpen && hasMore && <Text dimColor>{`     └ … ${leftOut(hidden, 'faster')}`}</Text>}
    </Box>
  )
}

// A turn as the pane draws it: its lanes, then its calls in the order they ran
// At most ten of its calls under the lanes: the current turn's latest, in the order they ran, so the running one stays
// in sight; an earlier one's slowest, repeated calls sharing a row, as its fold lists them; a line counts the rest
function paneTurnBody(draw: PaneDraw, turn: TimelineTurn, rows: Row[], isCurrent: boolean) {
  const { Text, pictures, desktop, columns } = draw
  const lanes = lanesOf(turn)
  // As wide as the pane leaves beside a lane's name and the longest totals, so no lane's are cut
  const tail = Math.max(0, ...lanes.map(lane => laneTail(lane).join('').length))
  const cells = Math.max(MIN_PANE_LANE_CELLS, Math.min(LANE_CELLS, columns - LANE_NAME_LETTERS - 1 - tail))
  const laneLines = desktop !== undefined ? desktopLaneLines(desktop, lanes, turn, columns) : lanes.map(lane => laneLine(Text, lane, turn, pictures, { lead: '', cells }))
  if (rows.length === 0) {
    return laneLines
  }
  const shown = isCurrent ? rows.slice(-MAX_UNFOLDED_ROWS) : groupedRows(rows).sort((a, b) => b.ms - a.ms).slice(0, MAX_UNFOLDED_ROWS)
  const hidden = rows.length - shown.reduce((sum, row) => sum + row.count, 0)
  // The bars against the slowest call; an earlier turn's against its first row, which may hold several
  const slowest = isCurrent ? slowestOf(rows) : (shown[0] ?? slowestOf(rows))
  const nameWidth = nameWidthOf(shown)
  // Wide enough for the longest name, as the lanes' count column is, and a gap before what it ran on
  const nameCells = Math.ceil(nameWidth * DESKTOP_CELLS_PER_LETTER) + 3
  // The branch in its column on the desktop, as the rows' is
  const note = (lead: string, words: string) =>
    desktop !== undefined ? (
      <desktop.Box flexDirection="row">
        <desktop.Box width={DESKTOP_MARK_CELLS}>
          <Text dimColor>{lead}</Text>
        </desktop.Box>
        <Text dimColor>{`… ${words}`}</Text>
      </desktop.Box>
    ) : (
      <Text dimColor>{`${lead} … ${words}`}</Text>
    )

  return [
    ...laneLines,
    <Text> </Text>,
    isCurrent && hidden > 0 && note('├', leftOut(hidden, 'earlier')),
    ...shown.map((row, i) => {
      const lead = i === shown.length - 1 && (isCurrent || hidden === 0) ? '└ ' : '├ '

      return desktop !== undefined
        ? desktopRowLine(desktop, row, slowest, nameCells, lead.trim())
        : rowLine(Text, row, slowest, nameWidth, lead, pictures)
    }),
    !isCurrent && hidden > 0 && note('└', leftOut(hidden, 'faster')),
  ]
}

// The pane's earlier turns, a line each in columns: how long it took, a bar of that against the longest of them, how
// long ago, how many calls, the slowest, the start of what was asked; unfolded under its line once pressed
function historyLines(kit: HistoryKit, earlier: TimelineTurn[], open: string[], time: number, toggle: (turnId: string) => unknown) {
  const { Box, Text, Button, Client, draw } = kit
  const { pictures, desktop } = draw
  const lines = earlier.map(turn => {
    const rows = rowsOf(turn.calls, 0)
    const slowest = slowestOf(rows)

    return {
      turn,
      rows,
      took: formatMs(turn.durationMs),
      age: agoOf(time - turn.endedAt),
      count: countOf(rows),
      slowest: `${slowest.call.tool} ${formatMs(slowest.ms)}`,
    }
  })
  const longest = Math.max(...earlier.map(turn => turn.durationMs))
  const widest = (pick: (line: (typeof lines)[number]) => string) => Math.max(...lines.map(line => pick(line).length))
  // Every column as wide as its widest and its words from its start, the time's too, so each line starts where the
  // heading does
  const [tookWidth, ageWidth, countWidth, slowestWidth] = [
    widest(line => line.took),
    widest(line => line.age),
    widest(line => line.count),
    widest(line => line.slowest),
  ]

  return lines.map(({ turn, rows, took, age, count, slowest }) => {
    const isOpen = open.includes(turn.turnId)
    const prompt = cut(turn.prompt ?? '', MAX_PROMPT_LETTERS)
    const unfolded = isOpen && (
      <Box flexDirection="column" paddingLeft={2}>
        {paneTurnBody({ ...draw, columns: draw.columns - 2 }, turn, rows, false)}
      </Box>
    )
    // The desktop: columns, the bar an SVG, the line a button of blank label laid over it, as its folded line is
    if (desktop !== undefined) {
      const { Svg } = desktop
      const cellsOf = (letters: number) => Math.ceil(letters * DESKTOP_CELLS_PER_LETTER) + 2
      const [tookCells, ageCells, countCells, slowestCells] = [cellsOf(tookWidth), cellsOf(ageWidth), cellsOf(countWidth), cellsOf(slowestWidth)]
      // The button as wide as the whole line: its columns and its bar in cells, the prompt a cell a letter, as its wide
      // letters may take; two no-break spaces a letter, as the folded line's
      const lineCells = tookCells + DESKTOP_ROW_WIDTH / DESKTOP_PX_PER_CELL + 1 + ageCells + countCells + slowestCells + prompt.length
      const blanks = Math.ceil((lineCells / DESKTOP_CELLS_PER_LETTER) * 2) + 4

      return [
        <Box flexDirection="row" alignItems="center">
          <Box width={tookCells}>
            <Text dimColor>{took}</Text>
          </Box>
          <Box>
            <Svg source={rowSvg(turn.durationMs, longest)} width={DESKTOP_ROW_WIDTH} height={12} alt={took} />
          </Box>
          <Box marginLeft={1} width={ageCells}>
            <Text dimColor>{age}</Text>
          </Box>
          <Box width={countCells}>
            <Text dimColor>{count}</Text>
          </Box>
          <Box width={slowestCells}>
            <Text color={SLOW_COLOR}>{slowest}</Text>
          </Box>
          <Text dimColor wrap="truncate">
            {prompt}
          </Text>
          <Box position="absolute" top={0} left={0}>
            <Button key={`history-${turn.turnId}`} plain label={'\u00a0'.repeat(blanks)} onPress={() => toggle(turn.turnId)} />
          </Box>
        </Box>,
        unfolded,
      ]
    }
    const props: HistoryProps = {
      turnId: turn.turnId,
      age: age.padEnd(ageWidth),
      count: count.padEnd(countWidth),
      slowest: slowest.padEnd(slowestWidth),
      prompt,
    }
    // A space in from the heading, so the lines do not crowd its edge
    const head = <Text dimColor>{` ${took.padEnd(tookWidth)} `}</Text>
    const fraction = longest > 0 ? turn.durationMs / longest : 0
    const { filled, track } = gauge(turn.durationMs, longest)
    const bar =
      pictures !== undefined ? (
        <pictures.Image
          source={filed(barPicture(BAR_CELLS, [{ from: 0, to: fraction }], BAR_COLOR, { color: INK_COLOR, alpha: PICTURE_TRACK_ALPHA }))}
          columns={BAR_CELLS}
          rows={1}
          alt={took}
        />
      ) : (
        <Text>
          <Text color={BAR_COLOR}>{filled}</Text>
          <Text dimColor>{track}</Text>
        </Text>
      )
    const words =
      Client !== undefined ? (
        <Client key={`history-${turn.turnId}`} module="./history.tsx" props={props} />
      ) : (
        <Button
          key={`history-${turn.turnId}`}
          plain
          dimColor
          label={` ${props.age}  ${props.count}  ${props.slowest}${prompt === '' ? '' : `  ${prompt}`}`}
          onPress={() => toggle(turn.turnId)}
        />
      )

    return [
      <Box flexDirection="row" overflow="hidden">
        <Box flexShrink={0}>
          {head}
          {bar}
        </Box>
        {words}
      </Box>,
      unfolded,
    ]
  })
}

// `just now`, `40s ago`, `3m ago`, `2h ago`, `5d ago`: how long ago an earlier turn ended
function agoOf(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000))
  if (seconds < 10) return 'just now'
  if (seconds < 60) return `${seconds}s ago`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`

  return `${Math.floor(seconds / 86_400)}d ago`
}

// The desktop's lanes, a line each: its name, its bars as an SVG, then its totals in columns, each lane's under the
// one above: the time to the right of its own, then the count, then the tokens; in a pane of so many columns, the bars
// as wide as it leaves beside the name and the longest totals, so none of those wraps
function desktopLaneLines(kit: DesktopKit, lanes: Lane[], turn: TimelineTurn, columns?: number) {
  const { Box, Text, Svg } = kit
  // Wide enough for the longest count; a cell is wider than the desktop font's average letter
  const countCells = Math.ceil(Math.max(0, ...lanes.map(lane => countOfLane(lane).length + 2)) * DESKTOP_CELLS_PER_LETTER) + 1
  const restOf = (lane: Lane) => {
    const tokens = tokensOfLane(lane)
    const misses = missesOfLane(lane)

    return `${tokens === '' ? '' : `· ${tokens}`}${misses === '' ? '' : ` · ${misses}`}`
  }
  const tailCells = 1 + DESKTOP_TIME_CELLS + 1 + countCells + Math.ceil(Math.max(0, ...lanes.map(lane => restOf(lane).length)) * DESKTOP_CELLS_PER_LETTER) + 1
  const width =
    columns === undefined
      ? LANE_WIDTH
      : Math.round(Math.max(MIN_LANE_WIDTH, Math.min(LANE_WIDTH, (columns - DESKTOP_LABEL_CELLS - tailCells) * DESKTOP_PX_PER_CELL)))

  return lanes.map(lane => {
    const tokens = tokensOfLane(lane)
    const misses = missesOfLane(lane)

    return (
      <Box key={`lane-${lane.name}`} flexDirection="row" alignItems="center">
        <Box width={DESKTOP_LABEL_CELLS}>
          <Text dimColor>{shortName(lane.name)}</Text>
        </Box>
        <Svg source={laneSvg(lane, turn, width)} width={width} height={12} alt={`${lane.name} ${laneTotal(lane)}`} />
        <Box marginLeft={1} width={DESKTOP_TIME_CELLS} justifyContent="flex-end">
          <Text dimColor>{formatMs(busyMs(lane.spans))}</Text>
        </Box>
        <Box marginLeft={1} width={countCells}>
          <Text dimColor>{`· ${countOfLane(lane)}`}</Text>
        </Box>
        {tokens !== '' && (
          <Text dimColor wrap="truncate">
            {`· ${tokens}`}
          </Text>
        )}
        {misses !== '' && (
          <Text color={SLOW_COLOR} wrap="truncate">
            {` · ${misses}`}
          </Text>
        )}
      </Box>
    )
  })
}

// One call on the desktop's pane, in columns as its lanes are: its time, a pill against the slowest call's, its mark
// and name, then what it ran on
function desktopRowLine(kit: DesktopKit, row: Row, slowest: Row, nameCells: number, lead: string) {
  const { Box, Text, Svg } = kit
  const { call, ms } = row
  const isSlowest = row === slowest
  const tone = isSlowest || call.outcome === 'running' ? { color: SLOW_COLOR } : ms >= 1000 ? {} : { dimColor: true }
  const usual = usualNote(row)
  const progress = call.outcome === 'running' ? progressNote(row).trim() : ''

  return (
    <Box flexDirection="row" alignItems="center">
      {/* The branch and the mark each in a column of its own: `└` is wider than `├`, `✗` than `·` */}
      <Box width={DESKTOP_MARK_CELLS}>
        <Text dimColor>{lead}</Text>
      </Box>
      <Box width={DESKTOP_TIME_CELLS} justifyContent="flex-end">
        <Text {...tone} {...(isSlowest ? { bold: true } : {})}>
          {formatMs(ms)}
        </Text>
      </Box>
      <Box marginLeft={1}>
        <Svg source={rowSvg(ms, slowest.ms)} width={DESKTOP_ROW_WIDTH} height={12} alt={formatMs(ms)} />
      </Box>
      <Box marginLeft={1} width={DESKTOP_MARK_CELLS}>
        <Text {...(call.outcome === 'error' || call.outcome === 'denied' ? { color: 'error' } : { dimColor: true })}>
          {MARKS[call.outcome]}
        </Text>
      </Box>
      <Box width={nameCells}>
        <Text bold={isSlowest} wrap="truncate">
          {labelOf(row)}
        </Text>
      </Box>
      {usual !== '' && <Text color={SLOW_COLOR}>{`${usual}  `}</Text>}
      {progress !== '' && <Text color={SLOW_COLOR}>{`${progress}  `}</Text>}
      <Text dimColor wrap="truncate">
        {call.detail}
      </Text>
    </Box>
  )
}

// A desktop row's bar: one pill from the start, as long against the slowest call's as its time, on a faint track
function rowSvg(ms: number, longest: number): string {
  const width = longest > 0 ? Math.max(4, (ms / longest) * DESKTOP_ROW_WIDTH) : 0
  const pill = ms > 0 ? `<rect x="0" y="2" width="${width.toFixed(1)}" height="8" rx="4" fill="${TOOL_COLOR}"/>` : ''

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${DESKTOP_ROW_WIDTH}" height="12" viewBox="0 0 ${DESKTOP_ROW_WIDTH} 12"><line x1="0" x2="${DESKTOP_ROW_WIDTH}" y1="6" y2="6" stroke="${INK_COLOR}" stroke-opacity="0.3"/>${pill}</svg>`
}

// The latest turn whose final answer ends with this reply block
function turnOfReply(all: TimelineTurn[], text: string): TimelineTurn | undefined {
  const block = text.trim()
  if (block === '') {
    return undefined
  }

  return [...all].reverse().find(turn => typeof turn.answer === 'string' && isAnswerOf(turn.answer, block))
}

// Whether a turn's answer ends with this block; one kept from an earlier run is its last letters alone, and a block
// longer than those ends with all of them
function isAnswerOf(answer: string, block: string): boolean {
  const kept = answer.trim()

  return kept.endsWith(block) || (answer.length >= MAX_KEPT_ANSWER && block.endsWith(kept))
}

// Claude first, then each tool by the time it kept busy; the subagents' own calls, a lane per tool (`↳ Bash`),
// right under the Agent lane they ran inside
function lanesOf(turn: TimelineTurn): Lane[] {
  // A turn kept by an earlier version of this mod has no request record to draw lanes from
  if (!Array.isArray(turn.steps)) {
    return []
  }
  const tools: Lane[] = []
  const inside: Lane[] = []
  for (const call of turn.calls) {
    // Right under the Agent lane, an arrow says enough
    const name = call.isSubagent ? `↳ ${call.tool}` : call.tool
    const group = call.isSubagent ? inside : tools
    let lane = group.find(one => one.name === name)
    if (lane === undefined) {
      lane = { name, spans: [], count: 0, unit: 'call' }
      group.push(lane)
    }
    lane.spans.push({ startedAt: call.startedAt, endedAt: call.endedAt ?? turn.endedAt })
    lane.count += 1
  }
  tools.sort((a, b) => busyMs(b.spans) - busyMs(a.spans))
  inside.sort((a, b) => busyMs(b.spans) - busyMs(a.spans))
  const agent = tools.findIndex(lane => lane.name === 'Agent')
  // An agent no Agent call of this turn spawned (one a mod started) has its calls' lanes last
  tools.splice(agent === -1 ? tools.length : agent + 1, 0, ...inside)
  const claude: Lane = {
    name: 'Claude',
    spans: turn.steps,
    count: turn.steps.length,
    unit: 'request',
    outputTokens: turn.steps.reduce((sum, step) => sum + (step.outputTokens ?? 0), 0),
    missed: turn.steps.filter(missedCache),
  }

  return claude.count > 0 ? [claude, ...tools] : tools
}

// `Claude ▆▆▆▁▁▆▁▁▁▁ 8.2s · 4 requests`: a cell is drawn as a bar while the lane was busy in its slice of the turn,
// in the slow violet where a request missed the prompt cache
function laneLine(Text: TextElement, lane: Lane, turn: TimelineTurn, pictures?: Pictures, layout: LaneLayout = UNFOLDED_LANE) {
  const total = Math.max(turn.endedAt - turn.startedAt, 1)
  const width = layout.cells
  let cells = ''
  let misses = ''
  for (let i = 0; i < width; i++) {
    const from = turn.startedAt + (total * i) / width
    const to = turn.startedAt + (total * (i + 1)) / width
    // A call too short to measure still marks the cell it fell in
    const falls = (span: TimelineSpan) => span.startedAt < to && Math.max(span.endedAt, span.startedAt + 1) > from
    cells += lane.spans.some(falls) ? BAR : TRACK
    misses += (lane.missed ?? []).some(falls) ? 'm' : ' '
  }
  // Runs of one glyph and one color: a bar's cells split where a request that missed the cache begins or ends
  const runs: Array<{ glyphs: string; isMissed: boolean }> = []
  for (let i = 0; i < width; i++) {
    const glyph = cells.charAt(i)
    const isMissed = glyph === BAR && misses.charAt(i) === 'm'
    const last = runs[runs.length - 1]
    if (last !== undefined && last.glyphs.startsWith(glyph) && last.isMissed === isMissed) {
      last.glyphs += glyph
    } else {
      runs.push({ glyphs: glyph, isMissed })
    }
  }
  const name = shortName(lane.name)
  const [time, words, missed] = laneTail(lane)
  const head = <Text>{`${layout.lead}${name.padEnd(LANE_NAME_LETTERS)} `}</Text>
  const tail = [<Text>{time}</Text>, <Text dimColor>{words}</Text>, missed !== '' && <Text color={SLOW_COLOR}>{missed}</Text>]
  if (pictures !== undefined) {
    const { Box, Image } = pictures
    const isClaude = lane.name === 'Claude'
    const stretches = lane.spans.map(span => ({
      from: (span.startedAt - turn.startedAt) / total,
      to: (span.endedAt - turn.startedAt) / total,
      ...(lane.missed?.includes(span) ? { color: SLOW_COLOR } : {}),
    }))
    const track = isClaude ? { color: CLAUDE_COLOR, alpha: 1 } : { color: INK_COLOR, alpha: PICTURE_TRACK_ALPHA }
    const source = filed(barPicture(width, stretches, isClaude ? CLAUDE_COLOR : BAR_COLOR, track))

    // Where the line is wider than the transcript (a pane docked beside it), its name keeps its letters and the line
    // is cut at the edge, as a line of glyphs is
    return (
      <Box flexDirection="row" overflow="hidden">
        <Box flexShrink={0}>{head}</Box>
        <Image source={source} columns={width} rows={1} alt={cells} />
        <Text wrap="truncate">{tail}</Text>
      </Box>
    )
  }

  return (
    <Text wrap="truncate">
      {head}
      {runs.map(({ glyphs, isMissed }) =>
        isMissed ? (
          <Text color={SLOW_COLOR}>{glyphs}</Text>
        ) : glyphs.startsWith(BAR) ? (
          <Text color={lane.name === 'Claude' ? CLAUDE_COLOR : BAR_COLOR}>{glyphs}</Text>
        ) : lane.name === 'Claude' ? (
          // Claude's lane in its clay through and through, its idle stretches too
          <Text color={CLAUDE_COLOR}>{glyphs}</Text>
        ) : (
          <Text dimColor>{glyphs}</Text>
        ),
      )}
      {tail}
    </Text>
  )
}

// What follows a lane's bars on the terminal: its busy time, its count and tokens, its cache misses ('' for none)
function laneTail(lane: Lane): [string, string, string] {
  const tokens = tokensOfLane(lane)
  const missedNote = missesOfLane(lane)

  return [
    `  ${formatMs(busyMs(lane.spans)).padStart(6)}`,
    ` · ${countOfLane(lane)}${tokens === '' ? '' : ` · ${tokens}`}`,
    missedNote === '' ? '' : ` · ${missedNote}`,
  ]
}

function shortName(name: string): string {
  return cut(name, LANE_NAME_LETTERS)
}

// The calls a list leaves out: `2 faster calls`, `1 earlier call`
function leftOut(count: number, kind: string): string {
  return `${count} ${kind} call${count === 1 ? '' : 's'}`
}

function countOfLane(lane: Lane): string {
  return `${lane.count} ${lane.unit}${lane.count === 1 ? '' : 's'}`
}

// `out 3.1k`: the output tokens alone, since each request resends the whole conversation as input; '' for none
function tokensOfLane(lane: Lane): string {
  const tokens = lane.outputTokens ?? 0
  if (tokens === 0) {
    return ''
  }

  return `out ${tokens < 1000 ? tokens : `${(tokens / 1000).toFixed(1)}k`}`
}

// `2 cache misses`: Claude's requests that read less than half their prompt from the cache, writing the rest afresh,
// slower and dearer than the others; '' for none
function missesOfLane(lane: Lane): string {
  const count = lane.missed?.length ?? 0
  if (count === 0) {
    return ''
  }

  return `${count} cache miss${count === 1 ? '' : 'es'}`
}

function missedCache(step: TimelineStep): boolean {
  return step.promptTokens !== undefined && step.promptTokens > 0 && (step.cachedTokens ?? 0) < step.promptTokens / 2
}

// `8.2s · 4 requests · out 3.1k · 1 cache miss`
function laneTotal(lane: Lane): string {
  return [formatMs(busyMs(lane.spans)), countOfLane(lane), tokensOfLane(lane), missesOfLane(lane)]
    .filter(part => part !== '')
    .join(' · ')
}

// The desktop's chevron, as the app draws its own folded rows': a thin stroke pointing right, or down unfolded,
// set off from the words by its own left margin
function chevronSvg(isOpen: boolean): string {
  const [color, path] = isOpen ? ['#53524f', 'M5 3 L9 7 L13 3'] : ['#898782', 'M7 1 L11 5 L7 9']

  return `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="10" viewBox="0 0 14 10"><path d="${path}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`
}

// One desktop lane's bars, so many pixels wide: a pill for each stretch at its place in the turn, on a faint track
function laneSvg(lane: Lane, turn: TimelineTurn, width = LANE_WIDTH): string {
  const total = Math.max(turn.endedAt - turn.startedAt, 1)
  const color = lane.name === 'Claude' ? CLAUDE_COLOR : TOOL_COLOR
  const bars = lane.spans.map(span => {
    const x = ((span.startedAt - turn.startedAt) / total) * width
    const w = Math.max(4, ((span.endedAt - span.startedAt) / total) * width)
    const fill = lane.missed?.includes(span) ? SLOW_COLOR : color
    return `<rect x="${x.toFixed(1)}" y="2" width="${w.toFixed(1)}" height="8" rx="4" fill="${fill}"/>`
  })
  // Claude's lane in its clay through and through, its idle stretches too
  const track =
    lane.name === 'Claude'
      ? `<line x1="0" x2="${width}" y1="6" y2="6" stroke="${CLAUDE_COLOR}"/>`
      : `<line x1="0" x2="${width}" y1="6" y2="6" stroke="${INK_COLOR}" stroke-opacity="0.3"/>`

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="12" viewBox="0 0 ${width} 12">${track}${bars.join('')}</svg>`
}

// The time a lane was busy: overlapping stretches count once
function busyMs(spans: TimelineSpan[]): number {
  let total = 0
  let reached = -Infinity
  for (const span of [...spans].sort((a, b) => a.startedAt - b.startedAt)) {
    const from = Math.max(span.startedAt, reached)
    if (span.endedAt > from) {
      total += span.endedAt - from
    }
    reached = Math.max(reached, span.endedAt)
  }

  return total
}

async function tick($: EngineInterface) {
  const list = await read($, calls)
  if (!list.some(call => call.outcome === 'running') && (await read($, stepStartedAt)) === null) {
    return
  }
  const time = await $.clock.now()
  await update($, now, () => time)
}

// A call still running is measured up to `at`
function rowsOf(list: TimelineCall[], at: number): Row[] {
  return list.map(call => ({ call, ms: (call.endedAt ?? Math.max(at, call.startedAt)) - call.startedAt, count: 1 }))
}

// The calls of one kind in a turn (the same tool on the same thing, in the same loop) as one row of their time
// together; a failed or denied one among them marks the row
function groupedRows(rows: Row[]): Row[] {
  const groups = new Map<string, Row>()
  for (const row of rows) {
    const key = groupKeyOf(row.call)
    const group = groups.get(key)
    if (group === undefined) {
      groups.set(key, row)
    } else {
      const call = group.call.outcome === 'ok' && row.call.outcome !== 'ok' ? { ...group.call, outcome: row.call.outcome } : group.call
      groups.set(key, { call, ms: group.ms + row.ms, count: group.count + 1 })
    }
  }

  return [...groups.values()]
}

function groupKeyOf(call: TimelineCall): string {
  return `${call.isSubagent}|${call.tool}|${call.detail}`
}

function slowestOf(rows: Row[]): Row {
  return rows.reduce((top, row) => (row.ms > top.ms ? row : top))
}

// ` · Bash 4s · 3 tool calls` while calls run (a call's time shows from its first second),
// ` · 3 tool calls · slowest Bash 1.9s` between them
function spinnerNote(rows: Row[]): string {
  const running = rows.filter(row => row.call.outcome === 'running')
  if (running.length === 0) {
    const slowest = slowestOf(rows)

    return ` · ${countOf(rows)} · slowest ${slowest.call.tool} ${formatMs(slowest.ms)}`
  }
  const longest = slowestOf(running)
  // Whole seconds, as the spinner counts its own: the tick does not land on the call's start
  const time = longest.ms >= 1000 ? ` ${Math.floor(longest.ms / 1000)}s` : ''

  return ` · ${longest.call.tool}${time}${progressNote(longest)} · ${countOf(rows)}`
}

// ` ▰▰▱▱▱▱  usual 40s` toward a running call's usual time, full past it; ` ▰▰▰▰▰▰  2.3× usual` once it is far slower.
// The spinner draws its suffix as plain text, so the gauge and the words say it where a color cannot. Two spaces
// after the gauge: a terminal that draws its glyphs from a fallback font spills them over the first
function progressNote(row: Row): string {
  const usual = row.call.usualMs
  if (usual === undefined || usual < MIN_PROGRESS_MS) {
    return ''
  }
  const filled = Math.min(PROGRESS_CELLS, Math.floor((row.ms / usual) * PROGRESS_CELLS))
  const gauge = `${'▰'.repeat(filled)}${'▱'.repeat(PROGRESS_CELLS - filled)}`
  if (isFarSlower(row.ms, usual)) {
    return ` ${gauge}  ${(row.ms / usual).toFixed(1)}× usual`
  }

  return ` ${gauge}  usual ${roughMs(usual)}`
}

// Whole seconds under a minute, as the spinner counts its own: `40s`, `1m05s`
function roughMs(ms: number): string {
  return ms < 60_000 ? `${Math.round(ms / 1000)}s` : formatMs(ms)
}

function countOf(rows: Row[]): string {
  return `${rows.length} tool call${rows.length === 1 ? '' : 's'}`
}

// Each call's time in the order the calls ran, one cell each (the busiest of a few once there are many)
function sparkline(rows: Row[]): string {
  const size = Math.ceil(rows.length / MAX_SPARKS)
  const cells: number[] = []
  for (let i = 0; i < rows.length; i += size) {
    cells.push(Math.max(...rows.slice(i, i + size).map(row => row.ms)))
  }
  const top = Math.max(...cells, 1)

  return cells.map(ms => SPARKS.charAt(Math.round((ms / top) * (SPARKS.length - 1)))).join('')
}

// One desktop call line: `• 1.9s  Bash — Show current date and time`, `• 8.0s  Bash (usual 1.2s) — Run tests`
function callLine(row: Row): string {
  const mark = row.call.outcome === 'error' || row.call.outcome === 'denied' ? `${MARKS[row.call.outcome]} ` : ''
  const usual = usualNote(row)
  const detail = row.call.detail === '' ? '' : ` — ${row.call.detail}`

  return `• ${formatMs(row.ms)}  ${mark}${labelOf(row)}${usual === '' ? '' : ` (${usual})`}${detail}`
}

// One call: its time, a gauge against the slowest, its tool and what it ran on; in a region, those words pressed
function rowLine(Text: TextElement, row: Row, slowest: Row, nameWidth: number, lead: string, pictures?: Pictures, region?: Region) {
  const { call, ms } = row
  const isSlowest = row === slowest
  const { filled, track } = gauge(ms, slowest.ms)
  const tone = isSlowest || call.outcome === 'running' ? { color: SLOW_COLOR } : ms >= 1000 ? {} : { dimColor: true }
  const mark = MARKS[call.outcome]
  const usual = usualNote(row)
  const progress = call.outcome === 'running' ? progressNote(row) : ''
  const words =
    region === undefined ? undefined : (
      <region.Client
        key={region.key}
        module="./row.tsx"
        props={{
          turnId: region.turnId,
          callId: call.id,
          mark,
          isFailed: call.outcome === 'error' || call.outcome === 'denied',
          label: labelOf(row),
          pad: ' '.repeat(Math.max(0, nameWidth - labelOf(row).length)),
          isSlowest,
          usual,
          detail: call.detail,
          isOpen: region.isOpen,
          canAsk: canAskWhy(row),
        } satisfies RowProps}
      />
    )

  const head = [
    <Text dimColor>{lead}</Text>,
    <Text {...tone} {...(isSlowest ? { bold: true } : {})}>
      {formatMs(ms).padStart(6)}
    </Text>,
    ' ',
  ]
  const tail = [
    ' ',
    <Text {...(call.outcome === 'error' || call.outcome === 'denied' ? { color: 'error' } : { dimColor: true })}>
      {mark}
    </Text>,
    ' ',
    <Text {...(isSlowest ? { bold: true } : {})}>{labelOf(row).padEnd(nameWidth)}</Text>,
    usual !== '' && <Text color={SLOW_COLOR}>{`  ${usual}`}</Text>,
    progress !== '' && <Text color={SLOW_COLOR}>{progress}</Text>,
    <Text dimColor>{call.detail === '' ? '' : `  ${call.detail}`}</Text>,
  ]
  // Every bar in the same sky: the slowest is told by its violet time and bold name, a block of violet would read
  // as another color than those letters
  if (pictures !== undefined) {
    const { Box, Image } = pictures
    const stretches = ms > 0 ? [{ from: 0, to: slowest.ms > 0 ? ms / slowest.ms : 1 }] : []
    const source = filed(barPicture(BAR_CELLS, stretches, BAR_COLOR, { color: INK_COLOR, alpha: PICTURE_TRACK_ALPHA }))

    // Its branch and time keep their letters on a narrow transcript, the line cut at the edge
    return (
      <Box flexDirection="row" overflow="hidden">
        <Box flexShrink={0}>
          <Text>{head}</Text>
        </Box>
        <Image source={source} columns={BAR_CELLS} rows={1} alt={`${filled}${track}`} />
        {words ?? <Text wrap="truncate">{tail}</Text>}
      </Box>
    )
  }
  const bar = [<Text color={BAR_COLOR}>{filled}</Text>, <Text dimColor>{track}</Text>]
  if (region !== undefined) {
    const { Box } = region

    return (
      <Box flexDirection="row" overflow="hidden">
        <Box flexShrink={0}>
          <Text>
            {head}
            {bar}
          </Text>
        </Box>
        {words}
      </Box>
    )
  }

  return (
    <Text wrap="truncate">
      {head}
      {bar}
      {tail}
    </Text>
  )
}

// Claude's answer under the row it was asked from, its lines in after the branch the rows hang from
function whyLine(Box: ElementConstructor<BoxProps>, Text: TextElement, why: TimelineWhy, branch: string) {
  return (
    <Box flexDirection="row">
      <Text dimColor>{branch}</Text>
      <Text dimColor wrap="wrap">{`↳ ${why.state === 'asking' ? 'asking Claude why it took that long…' : why.text}`}</Text>
    </Box>
  )
}

// An MCP tool by its own name, without the `mcp__<server>__` every tool of its server starts with
function toolName(tool: string): string {
  return tool.startsWith('mcp__') ? tool.slice(tool.lastIndexOf('__') + 2) : tool
}

// A subagent's call names the Agent it ran inside: listed by time, it may sit under any other row
function nameOf(call: TimelineCall): string {
  return `${call.isSubagent ? 'Agent › ' : ''}${call.tool}`
}

// `Bash`, or `Bash ×3` for a row of repeated calls
function labelOf(row: Row): string {
  return `${nameOf(row.call)}${row.count > 1 ? ` ×${row.count}` : ''}`
}

// Names line up up to this width; a longer one just runs on
function nameWidthOf(rows: Row[]): number {
  return Math.min(16, Math.max(...rows.map(row => labelOf(row).length)))
}

function detailOf(e: object): string {
  const args = e as Record<string, unknown>
  for (const key of DETAIL_KEYS) {
    const value = args[key]
    if (typeof value === 'string' && value !== '') {
      const text = PATH_KEYS.has(key) ? shortPath(value) : value.replace(/\s+/g, ' ')

      return cut(text, MAX_DETAIL)
    }
  }

  return ''
}

// What a call's usual time is kept under: a Bash command by its own text, any other tool by its name; none for an
// Agent call, whose time is its task's
function kindOf(e: { tool: string }): string | undefined {
  if (e.tool === 'Agent') {
    return undefined
  }
  const command = bashCommandOf(e)
  if (command !== undefined) {
    return `Bash:${command.replace(/\s+/g, ' ').trim().slice(0, 200)}`
  }

  return e.tool
}

// A Bash call's command; none for any other tool's call
function bashCommandOf(e: { tool: string }): string | undefined {
  const command = (e as Record<string, unknown>).command

  return e.tool === 'Bash' && typeof command === 'string' ? command : undefined
}

// The turns this session kept in the store when it last ran; none when the store has nothing usable or cannot be read
async function keptTurnsOf($: EngineInterface): Promise<TimelineTurn[]> {
  try {
    const value = await $.store.get(`${TURNS_KEY_PREFIX}${await $.session.id()}`)
    return Array.isArray(value) ? (value as TimelineTurn[]) : []
  } catch {
    return []
  }
}

// The session's turns into the store, the newest within its share, and the sessions least lately run let go
async function keepTurns($: EngineInterface, all: TimelineTurn[]) {
  try {
    const key = `${TURNS_KEY_PREFIX}${await $.session.id()}`
    let kept = all.map(turn => ({ ...turn, answer: typeof turn.answer === 'string' ? turn.answer.slice(-MAX_KEPT_ANSWER) : '' }))
    while (kept.length > 0 && JSON.stringify(kept).length > MAX_KEPT_SESSION_CHARS) {
      kept = kept.slice(1)
    }
    // Deleted first, so the set moves the key to the newest in the store's order
    await $.store.delete(key)
    await $.store.set(key, kept)
    const sessions = (await $.store.keys()).filter(one => one.startsWith(TURNS_KEY_PREFIX))
    for (const old of sessions.slice(0, -MAX_KEPT_SESSIONS)) {
      await $.store.delete(old)
    }
  } catch {
    // A store that cannot take them keeps them for this run alone
  }
}

// The kept times by kind; none when the store has nothing usable or cannot be read
function durationsOf($: EngineInterface): Promise<Record<string, number[]>> {
  return storedRecord($, DURATIONS_KEY)
}

// What a kind of call's times are kept under, in its project
function usualKey(root: string, kind: string): string {
  return `${root}\n${kind}`
}

// What Claude is told of this project's slow commands; '' when it has none, or the store or root cannot be read
async function usualTimesNote($: EngineInterface): Promise<string> {
  try {
    const commands = usualKey(await $.session.root(), 'Bash:')
    const slow = Object.entries(await durationsOf($))
      .filter(([key]) => key.startsWith(commands))
      .map(([key, samples]) => ({ command: key.slice(commands.length), usual: usualOf(samples) ?? 0 }))
      .filter(one => one.usual >= MIN_TOLD_MS)
      .sort((a, b) => b.usual - a.usual)
      .slice(0, MAX_TOLD)
    if (slow.length === 0) {
      return ''
    }

    return [
      'How long these commands usually take in this project (tool-timeline: the middle of their latest runs):',
      ...slow.map(one => `- \`${one.command}\`: ${roughMs(one.usual)}`),
      'Where a narrower command does the job, prefer it; run a long one in the background when nothing waits on it.',
    ].join('\n')
  } catch {
    return ''
  }
}

// A record the store keeps under a key; none when it has nothing usable there or cannot be read
async function storedRecord<T>($: EngineInterface, key: string): Promise<Record<string, T>> {
  try {
    const value = await $.store.get(key)
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, T>) : {}
  } catch {
    return {}
  }
}

// A command's failures in a row so far, this run counted: one more on a failure, none once it runs through; the
// commands least lately failed go past the cap
async function countFailure($: EngineInterface, kind: string, isFailed: boolean): Promise<number> {
  let streak = 0
  await update($, failStreaks, ({ [kind]: before = 0, ...others }) => {
    streak = isFailed ? before + 1 : 0
    return Object.fromEntries(Object.entries(streak > 0 ? { ...others, [kind]: streak } : others).slice(-MAX_FAIL_STREAKS))
  })

  return streak
}

// A text past so many letters cut to them, the last an ellipsis
function cut(text: string, letters: number): string {
  return text.length > letters ? `${text.slice(0, letters - 1)}…` : text
}

// The middle of a kind's kept times, once there are enough of them
function usualOf(samples: number[] | undefined): number | undefined {
  if (!Array.isArray(samples) || samples.length < MIN_SAMPLES) {
    return undefined
  }
  const sorted = [...samples].sort((a, b) => a - b)

  return sorted[Math.floor(sorted.length / 2)]
}

// Adds a time to its kind's, the kind moved to the newest; the kinds least lately seen go past the cap
async function recordDuration($: EngineInterface, kind: string, ms: number) {
  const { [kind]: samples = [], ...others } = await durationsOf($)
  const kept = Object.entries({ ...others, [kind]: [...samples, Math.round(ms)].slice(-MAX_SAMPLES) }).slice(-MAX_KINDS)
  try {
    await $.store.set(DURATIONS_KEY, Object.fromEntries(kept))
  } catch {
    // A store that refuses (full, or gone) keeps what it had; the timeline does not need it
  }
}

// `usual 1.2s` for a call that took far longer than calls like it usually do; '' otherwise
function usualNote(row: Row): string {
  const usual = row.call.usualMs
  if (row.count > 1 || usual === undefined || !isFarSlower(row.ms, usual)) {
    return ''
  }

  return `usual ${formatMs(usual)}`
}

function isFarSlower(ms: number, usual: number): boolean {
  return ms >= usual * 2 && ms - usual >= SLOW_MARGIN_MS
}

// A long path keeps its last two parts: `…/hooks/register.tsx`
function shortPath(path: string): string {
  const parts = path.split('/')

  return path.length > 40 && parts.length > 3 ? `…/${parts.slice(-2).join('/')}` : path
}

function gauge(ms: number, longest: number): { filled: string; track: string } {
  const cells = longest > 0 ? Math.round((ms / longest) * BAR_CELLS) : 0
  // Any call that took time keeps one cell, so a fast one still shows
  const filled = ms > 0 ? Math.max(1, cells) : 0

  return { filled: BAR.repeat(filled), track: TRACK.repeat(BAR_CELLS - filled) }
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  const seconds = Math.round(ms / 1000)

  return `${Math.floor(seconds / 60)}m${String(seconds % 60).padStart(2, '0')}s`
}
