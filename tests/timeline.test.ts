import { expect, mock, test } from 'claude-code/testing'
import type { Mounted, TestBody } from 'claude-code/testing'

const PANE = {
  plugin: 'tool-timeline',
  component: 'Pane',
  requestId: 'tool-timeline',
  props: {
    title: 'Tool timeline',
    isFocused: false,
    bodyColumns: 70,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 20 },
    view: {},
  },
} as const

test('lists each call with its duration and marks the slowest', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000 })
  // Beneath the plugin, standing for the tools: Bash takes 4s, Read 200ms
  on('tool.call', async (_, e) => {
    await clock.sleep(e.tool === 'Bash' ? 4_000 : 200)
    return { result: 'done' } as never
  })
  on('turn.start', async (_, e) => ({ turnId: e.turnId }))

  await $.turn.start({ text: 'go', turnId: 't1' })
  const bash = $.tool.call({ tool: 'Bash', command: 'npm   test' })
  const readFile = $.tool.call({ tool: 'Read', file_path: '/src/a.ts' })
  await clock.advance(200)
  await readFile
  await clock.advance(3_800)
  await bash

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /2 tool calls · slowest Bash 4\.0s/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /4\.0s ▆{10} · Bash +npm test/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /200ms ▆▁{9} · Read +\/src\/a\.ts/ })).toBeDefined()
  await ui.unmount()

  // The desktop's letters are not of one width: its lines are columns, every bar an SVG, two lanes and two rows
  const desktop = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await desktop.find({ type: 'Text', text: /2 tool calls · slowest Bash 4\.0s/ })).toBeDefined()
  const bars = await desktop.findAll({ type: 'Svg' })
  expect(bars).toHaveLength(4)
  // The rows' pills against the slowest: Bash whole, Read a twentieth, as wide as the pill's rounding at least
  expect(bars[2]?.props.source).toContain('<rect x="0" y="2" width="80.0"')
  expect(bars[3]?.props.source).toContain('<rect x="0" y="2" width="4.0"')
  expect(await desktop.find({ type: 'Text', text: /^Bash$/ })).toBeDefined()
  expect(await desktop.find({ type: 'Text', text: /^npm test$/ })).toBeDefined()
  expect(await desktop.find({ type: 'Text', text: /^\/src\/a\.ts$/ })).toBeDefined()
  // No glyph bar is left to line up by spaces
  expect(await desktop.find({ type: 'Text', text: /▆/ })).toBeUndefined()
  await desktop.unmount()

  // In a narrow pane the lanes give way, so their totals stay on one line: 40 columns less the name's 12 and the totals'
  // 15, at 7.8px a column
  const narrow = await $.ui.mount({ ...PANE, surface: 'desktop', props: { ...PANE.props, bodyColumns: 40 } })
  expect((await narrow.findAll({ type: 'Svg' })).slice(0, 2).map(svg => svg.props.width)).toEqual([101, 101])
  await narrow.unmount()
})

test("the pane draws the current turn live: its lanes so far, its calls, a running one's gauge toward its usual time", async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  // Earlier runs of `npm test` in this project took about 10s
  on('session.root', async () => ({ value: ROOT }))
  const kept: Record<string, unknown> = { durations: { [inRoot('Bash:npm test')]: [9_000, 10_000, 11_000] } }
  on('store.get', async (_, e) => ({ value: kept[e.key] }) as never)
  on('store.set', async (_, e) => {
    kept[e.key] = e.value
    return { value: undefined } as never
  })
  on('tool.call', async (_, e) => {
    await clock.sleep(e.tool === 'Bash' ? 10_000 : 1_000)
    return { result: 'done' } as never
  })
  on('turn.step', async function* (_, e) {
    await clock.sleep(2_000)
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: usageOf(1_200) } as never
  })
  on('turn.start', async (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', async (_, e) => ({ text: e.answer }))
  on('session.start', async (_, e) => e as never)
  on('command.register', async () => ({ value: undefined }) as never)
  // The terminal, which draws pictures only at the end
  let terminal: string | undefined
  on('env.get', async (_, e) => ({ value: e.name === 'TERM_PROGRAM' ? terminal : undefined }) as never)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const step = async (index: number) => {
    for await (const _ of $.turn.step({ turnId: 't1', index, model: 'm', messageCount: 1 })) {
      // drained
    }
  }
  const pane = { ...PANE, surface: 'terminal' } as const

  // 0-2s Claude, then Bash from 2s and Read 2-3s; looked at 6s, Bash running 4s of its usual 10s
  await $.turn.start({ text: 'go', turnId: 't1' })
  const first = step(0)
  // A second into the first request, before any tool: its stretch grows on Claude's lane, the time ticking
  await clock.advance(1_000)
  let ui = await $.ui.mount(pane)
  expect(await ui.find({ type: 'Text', text: /^This turn · 1\.0s$/ })).toBeDefined()
  // Its totals short yet, its bars the whole thirty cells
  expect(await ui.find({ type: 'Text', text: /^Claude +▆{30} +1\.0s · 1 request$/ })).toBeDefined()
  await ui.unmount()
  await clock.advance(1_000)
  await first
  const bash = $.tool.call({ tool: 'Bash', command: 'npm test' })
  const readFile = $.tool.call({ tool: 'Read', file_path: '/src/a.ts' })
  await clock.advance(1_000)
  await readFile
  await clock.advance(3_000)

  ui = await $.ui.mount(pane)
  expect(await ui.find({ type: 'Text', text: /^This turn · 6\.0s · 2 tool calls · 1 running · slowest Bash 4\.0s$/ })).toBeDefined()
  // As wide as the pane leaves beside the longest totals, Claude's: 70 columns, 24 cells, no lane cut at the edge
  const claude = await ui.find({ type: 'Text', text: /^Claude +[▆▁]{24} +2\.0s · 1 request · out 1\.2k$/ })
  expect(claude?.text.length).toBe(70)
  expect(await ui.find({ type: 'Text', text: /^Bash +▁{8}▆{16} +4\.0s · 1 call$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Read +▁{8}▆{4}▁{12} +1\.0s · 1 call$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^├ +4\.0s ▆{10} … Bash ▰▰▱▱▱▱  usual 10s  npm test$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^└ +1\.0s ▆{3}▁{7} · Read +\/src\/a\.ts$/ })).toBeDefined()
  await ui.unmount()

  // Done, it says so and stays as long as the turn took
  await clock.advance(6_000)
  await bash
  await $.turn.complete({ answer: 'ok', durationMs: 12_000, isAborted: false, turnId: 't1', reason: 'answer' })
  ui = await $.ui.mount(pane)
  expect(await ui.find({ type: 'Text', text: /^Last turn · 12\.0s · 2 tool calls · slowest Bash 10\.0s$/ })).toBeDefined()
  await ui.unmount()

  // Where the terminal draws pictures, every bar is one: three lanes, two rows
  terminal = 'ghostty'
  ui = await $.ui.mount(pane)
  expect(await ui.findAll({ type: 'Image' })).toHaveLength(5)
  await ui.unmount()
})

test('under the current turn the pane lists the earlier ones in columns, a press unfolding one there', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  on('tool.call', async (_, e) => {
    await clock.sleep(e.tool === 'Bash' ? 3_000 : 100)
    return { result: 'done' } as never
  })
  on('turn.start', async (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', async (_, e) => ({ text: e.answer }))
  const run = async (call: Promise<unknown>, ms: number) => {
    await clock.advance(ms)
    await call
  }

  // t0, two Reads; t1 asked at length, a Bash call of 3s; then t2, a Read running
  await $.turn.start({ text: 'zero', turnId: 't0' })
  await run(Promise.all([$.tool.call({ tool: 'Read', file_path: '/a' }), $.tool.call({ tool: 'Read', file_path: '/b' })]), 100)
  await $.turn.complete({ answer: 'ok', durationMs: 500, isAborted: false, turnId: 't0', reason: 'answer' })
  await $.turn.start({ text: 'first   prompt that is quite long and goes past forty letters', turnId: 't1' })
  await run($.tool.call({ tool: 'Bash', command: 'npm test' }), 3_000)
  await $.turn.complete({ answer: 'ok', durationMs: 3_500, isAborted: false, turnId: 't1', reason: 'answer' })
  await clock.advance(45_000)
  await $.turn.start({ text: 'second', turnId: 't2' })
  const readFile = $.tool.call({ tool: 'Read', file_path: '/src/a.ts' })
  await clock.advance(50)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /^This turn · .* · 1 tool call · 1 running/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Earlier$/ })).toBeDefined()
  // The newest first, each its time from the line's start and a bar of it against the longest, then in a region of
  // its own how long ago, how many calls, the slowest and the start of what was asked, each column as wide as its widest
  expect(await ui.find({ type: 'Text', text: /^ 3\.5s  $/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^ 500ms $/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^▆{10}$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^▆▁{9}$/ })).toBeDefined()
  const line = { in: 'history-t1' } as const
  expect(
    await ui.find({ type: 'Text', text: /^ 45s ago  1 tool call   Bash 3\.0s   first prompt that i…$/, ...line }),
  ).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^ 48s ago  2 tool calls  Read 100ms  zero$/, in: 'history-t0' })).toBeDefined()
  // Folded, its lanes are not drawn; a press unfolds them under it, and again folds them
  const lane = { type: 'Text', text: /^Bash +[▆▁]+ +3\.0s · 1 call$/ } as const
  expect(await ui.find(lane)).toBeUndefined()
  await ui.pointer({ type: 'enter', x: 8, y: 0, ...line })
  // Under the pointer its words light up, with no hint beside them
  expect((await ui.find({ type: 'Text', text: /^ 45s ago  1 tool call +$/, ...line }))?.props.dimColor).toBe(false)
  expect(await ui.find({ type: 'Text', text: /click to/, ...line })).toBeUndefined()
  await press(ui, 'history-t1')
  expect(await ui.find(lane)).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^└ +3\.0s ▆{10} · Bash +npm test$/ })).toBeDefined()
  await press(ui, 'history-t1')
  expect(await ui.find(lane)).toBeUndefined()
  await ui.unmount()

  // On the desktop, in columns, the bar an SVG, the line pressed through a button laid over it
  const desktop = await $.ui.mount({ ...PANE, surface: 'desktop' })
  for (const words of ['3.5s', '45s ago', '1 tool call', 'Bash 3.0s', 'first prompt that i…']) {
    expect(await desktop.find({ type: 'Text', text: new RegExp(`^${words.replace(/[.]/g, '\\.')}$`) })).toBeDefined()
  }
  expect(await desktop.findAll({ type: 'Button' })).toHaveLength(2)
  // Its button blank and as wide as the whole line: the time's 5 cells and a gap, the bar's 80px (10.3 cells) and a
  // gap, the age's 8, the count's 11, the slowest's 10, the prompt's 20; two blanks for each 0.75 of a cell, and 4
  expect(String((await desktop.find({ type: 'Button', key: 'history-t1' }))?.props.label)).toBe('\u00a0'.repeat(181))
  await desktop.unmount()
  await run(readFile, 50)
})

test("the pane lists ten of a turn's calls at most: the current one's latest, an earlier one's slowest", async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  // `step 3` takes 300ms; a Read 100ms
  on('tool.call', async (_, e) => {
    const command = commandOf(e)
    await clock.sleep(command === '' ? 100 : Number(command.split(' ')[1]) * 100)
    return { result: 'done' } as never
  })
  on('turn.start', async (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', async (_, e) => ({ text: e.answer }))
  const run = async (call: Promise<unknown>, ms: number) => {
    await clock.advance(ms)
    await call
  }

  on('ui.render', { component: 'TurnDuration' }, async ($, e) => {
    const { Text } = $.ui.resolve(e)
    return Text({ children: [`${e.props.word} for ${e.props.durationMs}ms`] })
  })

  // t0, eleven commands of 100ms to 1.1s; then t1, twelve Reads so far
  await $.turn.start({ text: 'zero', turnId: 't0' })
  for (let i = 1; i <= 11; i++) {
    await run($.tool.call({ tool: 'Bash', command: `step ${i}` }), i * 100)
  }
  await $.turn.complete({ answer: 'ok', durationMs: 7_800, isAborted: false, turnId: 't0', reason: 'answer' })
  await $.turn.start({ text: 'one', turnId: 't1' })
  for (let i = 1; i <= 12; i++) {
    await run($.tool.call({ tool: 'Read', file_path: `/f${i}` }), 100)
  }

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  // The current turn's latest ten in the order they ran, a line first for the ones before
  expect(await ui.find({ type: 'Text', text: /^├ … 2 earlier calls$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /· Read +\/f2$/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^├ +100ms \S+ · Read +\/f3$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^└ +100ms \S+ · Read +\/f12$/ })).toBeDefined()
  // An earlier turn unfolded: its ten slowest, slowest first, a line last for the faster one
  await press(ui, 'history-t0')
  expect(await ui.find({ type: 'Text', text: /^├ +1\.1s ▆{10} · Bash +step 11$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^├ +200ms \S+ · Bash +step 2$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /· Bash +step 1$/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^└ … 1 faster call$/ })).toBeDefined()
  await ui.unmount()

  // Its fold under the closing line counts the one left out the same way
  const fold = await $.ui.mount({ ...TURN_LINE, props: { word: 'Baked', durationMs: 7_800 } })
  await click(fold, 't0')
  expect(await fold.find({ type: 'Text', text: /^ +└ … 1 faster call$/ })).toBeDefined()
  await fold.unmount()

  // The desktop says the same, the branch in its own column; the earlier turn stays unfolded from the press above
  const desktop = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await desktop.find({ type: 'Text', text: /^… 2 earlier calls$/ })).toBeDefined()
  expect(await desktop.find({ type: 'Text', text: /^… 1 faster call$/ })).toBeDefined()
  expect(await desktop.find({ type: 'Text', text: /^\/f2$/ })).toBeUndefined()
  await desktop.unmount()
})

test('a new turn starts an empty timeline', async ($, on) => {
  mock.clock(on)
  on('tool.call', async () => ({ result: 'done' }) as never)
  on('turn.start', async (_, e) => ({ turnId: e.turnId }))

  await $.turn.start({ text: 'first', turnId: 't1' })
  await $.tool.call({ tool: 'Read', file_path: '/src/a.ts' })
  await $.turn.start({ text: 'second', turnId: 't2' })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /No tool calls in this turn yet/ })).toBeDefined()
  await ui.unmount()
})

const TURN_LINE = { plugin: 'tool-timeline', component: 'TurnDuration', surface: 'terminal' } as const

// A click on a turn's folded line, which the terminal draws as a region of its own
async function click(ui: Pick<Mounted<'terminal'>, 'pointer'>, turnId: string) {
  await press(ui, `turn-${turnId}`)
}

// A click on one of the terminal's regions, by its key
async function press(ui: Pick<Mounted<'terminal'>, 'pointer'>, key: string) {
  for (const type of ['down', 'up'] as const) {
    await ui.pointer({ type, x: 8, y: 0, button: 'left', in: key })
  }
}

// A turn's unfolded rows on the terminal, a line each: its time and gauge, then the words its own region draws
async function rowTexts(ui: Pick<Mounted<'terminal'>, 'find' | 'findAll'>, turnId: string): Promise<string> {
  const heads = await ui.findAll({ type: 'Text', text: /^ +[├└] +\S/ })
  const rows = await Promise.all(
    heads.map(async (head, i) => `${head.text}${(await ui.find({ type: 'Text', in: `row-${turnId}-${i}` }))?.text ?? ''}`),
  )

  return rows.join('\n')
}

// A Bash call's command, '' for any other tool's
function commandOf(e: object): string {
  const command = (e as { command?: unknown }).command
  return typeof command === 'string' ? command : ''
}

// The project the tests' sessions run in, and what a kind of call's times are kept under in the store there
const ROOT = '/work/app'
function inRoot(kind: string): string {
  return `${ROOT}\n${kind}`
}

// A response's usage as the API reports it, of which the timeline reads the output tokens
function usageOf(outputTokens: number) {
  return { input_tokens: 10, output_tokens: outputTokens, cache_read_input_tokens: 5_000, cache_creation_input_tokens: 0, model: 'm' }
}

test("a turn's closing line folds its calls into one line and unfolds on a press", async ($, on) => {
  const clock = mock.clock(on, { now: 1_000 })
  on('tool.call', async (_, e) => {
    await clock.sleep(e.tool === 'Bash' ? 3_000 : 100)
    return { result: 'done' } as never
  })
  on('turn.start', async (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', async (_, e) => ({ text: e.answer }))
  // Beneath the plugin, standing for the engine's own closing line
  on('ui.render', { component: 'TurnDuration' }, async ($, e) => {
    const { Text } = $.ui.resolve(e)
    return Text({ children: [`${e.props.word} for ${e.props.durationMs}ms`] })
  })

  await $.turn.start({ text: 'go', turnId: 't1' })
  const bash = $.tool.call({ tool: 'Bash', command: 'npm test' })
  const readFile = $.tool.call({ tool: 'Read', file_path: '/src/a.ts' })
  await clock.advance(3_000)
  await Promise.all([bash, readFile])
  await $.turn.complete({ answer: 'ok', durationMs: 4_321, isAborted: false, turnId: 't1', reason: 'answer' })

  const ui = await $.ui.mount({ ...TURN_LINE, props: { word: 'Baked', durationMs: 4_321 } })
  expect(await ui.find({ type: 'Text', text: 'Baked for 4321ms' })).toBeDefined()
  // The folded line is a region of its own, its words found in it
  const line = { in: 'turn-t1' } as const
  expect((await ui.find({ type: 'Text', text: /^2 tool calls$/, ...line }))?.props.dimColor).toBe(true)
  // The slowest in a soft violet, not the theme's `warning`, which can be a loud yellow
  expect((await ui.find({ type: 'Text', text: /^Bash 3\.0s$/, ...line }))?.props.color).toBe('#b48ead')
  // The small bars in a pale sky, not the theme's `suggestion`, which can be a loud cyan; their floor dim
  expect((await ui.find({ type: 'Text', text: /^█$/, ...line }))?.props).toMatchObject({ color: '#86bbd8' })
  expect((await ui.find({ type: 'Text', text: /^▁$/, ...line }))?.props).toMatchObject({ color: '#86bbd8', dimColor: true })
  expect((await ui.find({ type: 'Text', text: /^\(click to expand\)$/, ...line }))?.props.dimColor).toBe(true)
  // One line cut at the edge, where the transcript is narrow, not each part wrapped apart
  expect(await ui.drawn(line)).toMatchObject({ type: 'Text', props: { wrap: 'truncate' } })
  expect(await rowTexts(ui, 't1')).toBe('')
  // Under the pointer its dim words light up, as the engine's own folded rows do
  await ui.pointer({ type: 'enter', x: 8, y: 0, ...line })
  expect((await ui.find({ type: 'Text', text: /^\(click to expand\)$/, ...line }))?.props.dimColor).toBe(false)
  expect((await ui.find({ type: 'Text', text: /^2 tool calls$/, ...line }))?.props.dimColor).toBe(false)

  await click(ui, 't1')
  expect(await ui.find({ type: 'Text', text: /^\(click to fold\)$/, ...line })).toBeDefined()
  const rows = await rowTexts(ui, 't1')
  expect(rows).toMatch(/├ +3\.0s ▆{10} · Bash +npm test/)
  expect(rows).toMatch(/└ +100ms ▆▁{9} · Read +\/src\/a\.ts/)
  // Every bar in the same sky, the slowest's too: violet is for its letters alone
  const bars = await ui.findAll({ type: 'Text', text: /^▆+$/ })
  expect(bars.length).toBeGreaterThan(0)
  expect(bars.map(bar => bar.props.color)).toEqual(bars.map(() => '#86bbd8'))

  await click(ui, 't1')
  expect(await rowTexts(ui, 't1')).toBe('')
  await ui.unmount()

  // A closing line of a turn it has no record of is left as the engine draws it
  const other = await $.ui.mount({ ...TURN_LINE, props: { word: 'Baked', durationMs: 999 } })
  expect(await other.find({ type: 'Client' })).toBeUndefined()
  expect(await other.find({ type: 'Text', text: 'Baked for 999ms' })).toBeDefined()
  await other.unmount()
})

test('a press on an unfolded row asks Claude why the call took that long, the answer hung under the row', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  // The suite's output runs long, its own time at the end
  const output = `${'ok\n'.repeat(600)}Ran 19 tests across 1 file. [4.71s]`
  on('tool.call', async (_, e) => {
    await clock.sleep(e.tool === 'Bash' ? 6_000 : 100)
    return { result: e.tool === 'Bash' ? output : 'done' } as never
  })
  on('turn.start', async (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', async (_, e) => ({ text: e.answer }))
  on('ui.render', { component: 'TurnDuration' }, async ($, e) => {
    const { Text } = $.ui.resolve(e)
    return Text({ children: [`${e.props.word} for ${e.props.durationMs}ms`] })
  })
  // Beneath the plugin, standing for the fork over the session's own transcript
  const prompts: string[] = []
  on('model.fork', async (_, e) => {
    prompts.push(e.prompt)
    return { value: { isAnswered: true, text: ' The whole suite ran; run one file instead. ', usage: usageOf(40) } } as never
  })

  await $.turn.start({ text: 'go', turnId: 't1' })
  const bash = $.tool.call({ tool: 'Bash', command: 'npm test' })
  const readFile = $.tool.call({ tool: 'Read', file_path: '/src/a.ts' })
  await clock.advance(6_000)
  await Promise.all([bash, readFile])
  await $.turn.complete({ answer: 'ok', durationMs: 6_100, isAborted: false, turnId: 't1', reason: 'answer' })

  const ui = await $.ui.mount({ ...TURN_LINE, props: { word: 'Baked', durationMs: 6_100 } })
  await click(ui, 't1')
  // A call that short is not worth asking about: its words stay as they are, and a press does nothing
  const short = { in: 'row-t1-1' } as const
  await ui.pointer({ type: 'enter', x: 8, y: 0, ...short })
  expect((await ui.find({ type: 'Text', text: /^Read$/, ...short }))?.props.underline).toBe(false)
  expect(await ui.find({ type: 'Text', text: /click to ask why/, ...short })).toBeUndefined()
  await press(ui, 'row-t1-1')
  expect(await ui.find({ type: 'Text', text: /^↳ / })).toBeUndefined()
  // Under the pointer the row's name underlines and a dim hint says what a press does
  const row = { in: 'row-t1-0' } as const
  expect(await ui.find({ type: 'Text', text: /click to ask why/, ...row })).toBeUndefined()
  await ui.pointer({ type: 'enter', x: 8, y: 0, ...row })
  expect((await ui.find({ type: 'Text', text: /^Bash$/, ...row }))?.props.underline).toBe(true)
  expect((await ui.find({ type: 'Text', text: /^ +click to ask why$/, ...row }))?.props.dimColor).toBe(true)

  // A press asks, and the answer comes in on the clock's next turn
  const answer = { type: 'Text', text: '↳ The whole suite ran; run one file instead.' } as const
  await press(ui, 'row-t1-0')
  expect(await ui.find({ type: 'Text', text: '↳ asking Claude why it took that long…' })).toBeDefined()
  await clock.advance(0)
  expect(await ui.find(answer)).toBeDefined()
  // Down the branch the next row hangs from
  expect(await ui.find({ type: 'Text', text: '     │   ' })).toBeDefined()
  expect(prompts).toHaveLength(1)
  expect(prompts[0]).toMatch(/the Bash call on "npm test" \(tool_use_id .+\) took 6\.0s\./)
  // What it ran and the end of what it gave back, kept as it ran, so the answer stands on them, not on a guess
  expect(prompts[0]).toContain('<call took="6.0s">\n<command>npm test</command>\n<output_end>…')
  expect(prompts[0]).toContain('Ran 19 tests across 1 file. [4.71s]</output_end>\n</call>')
  expect(prompts[0]?.match(/<output_end>([^]*)<\/output_end>/)?.[1]).toHaveLength(1001)
  expect(prompts[0]).toContain('where they do not show where the time went, say plainly that they do not rather than guess')

  // A press again hides it; once more shows it, not asked again
  await press(ui, 'row-t1-0')
  expect(await ui.find(answer)).toBeUndefined()
  await press(ui, 'row-t1-0')
  expect(await ui.find(answer)).toBeDefined()
  expect(prompts).toHaveLength(1)
  await ui.unmount()
})

test('a row shows the description over a raw command, and a long path by its last two parts', async ($, on) => {
  mock.clock(on)
  on('tool.call', async () => ({ result: 'done' }) as never)
  on('turn.start', async (_, e) => ({ turnId: e.turnId }))

  await $.turn.start({ text: 'go', turnId: 't1' })
  await $.tool.call({ tool: 'Bash', command: 'D=/a/very/long/dir; python3 -I - "$D/x"', description: 'Rerun the tests' })
  await $.tool.call({ tool: 'Read', file_path: '/Users/someone/.claude/dev-mods/session/tool-timeline/hooks/register.tsx' })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /Bash +Rerun the tests$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Read +…\/hooks\/register\.tsx$/ })).toBeDefined()
  await ui.unmount()
})

test('the spinner shows the call running longest, its time ticking, then the count between calls', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000 })
  on('tool.call', async (_, e) => {
    await clock.sleep(e.tool === 'Bash' ? 5_000 : 100)
    return { result: 'done' } as never
  })
  on('turn.start', async (_, e) => ({ turnId: e.turnId }))
  // Beneath the plugin, standing for the engine's spinner: its word, then the suffix
  on('ui.render', { component: 'Spinner' }, async ($, e) => {
    const { Text } = $.ui.resolve(e)
    return Text({ children: [`${e.props.word}${e.props.suffix}`] })
  })
  // The session's start, so the plugin starts its once-a-second tick
  on('session.start', async (_, e) => e as never)
  on('command.register', async () => ({ value: undefined }) as never)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const spinner = { plugin: 'tool-timeline', component: 'Spinner', surface: 'terminal' } as const
  const props = { word: 'Crunching', message: null, suffix: '…', mode: 'tool-use' } as const

  await $.turn.start({ text: 'go', turnId: 't1' })
  const idle = await $.ui.mount({ ...spinner, props })
  expect(await idle.find({ type: 'Text', text: 'Crunching…' })).toBeDefined()
  await idle.unmount()

  const bash = $.tool.call({ tool: 'Bash', command: 'npm test' })
  const readFile = $.tool.call({ tool: 'Read', file_path: '/src/a.ts' })
  await clock.advance(2_000)
  const live = await $.ui.mount({ ...spinner, props })
  expect(await live.find({ type: 'Text', text: 'Crunching… · Bash 2s · 2 tool calls' })).toBeDefined()
  await live.unmount()

  await clock.advance(3_000)
  await Promise.all([bash, readFile])
  const after = await $.ui.mount({ ...spinner, props })
  expect(await after.find({ type: 'Text', text: 'Crunching… · 2 tool calls · slowest Bash 5.0s' })).toBeDefined()
  await after.unmount()
})

test('the spinner fills a gauge toward the running call\'s usual time, and says how far past it a slow one is', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  // Earlier runs of `npm test` in this project took about 10s
  on('session.root', async () => ({ value: ROOT }))
  const kept: Record<string, unknown> = { durations: { [inRoot('Bash:npm test')]: [9_000, 10_000, 11_000] } }
  on('store.get', async (_, e) => ({ value: kept[e.key] }) as never)
  on('store.set', async (_, e) => {
    kept[e.key] = e.value
    return { value: undefined } as never
  })
  on('tool.call', async () => {
    await clock.sleep(25_000)
    return { result: 'done' } as never
  })
  on('turn.start', async (_, e) => ({ turnId: e.turnId }))
  on('ui.render', { component: 'Spinner' }, async ($, e) => {
    const { Text } = $.ui.resolve(e)
    return Text({ children: [`${e.props.word}${e.props.suffix}`] })
  })
  on('session.start', async (_, e) => e as never)
  on('command.register', async () => ({ value: undefined }) as never)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const spinner = { plugin: 'tool-timeline', component: 'Spinner', surface: 'terminal' } as const
  const props = { word: 'Crunching', message: null, suffix: '…', mode: 'tool-use' } as const
  const spinnerAt = async (ms: number, text: string) => {
    await clock.advance(ms)
    const ui = await $.ui.mount({ ...spinner, props })
    expect(await ui.find({ type: 'Text', text })).toBeDefined()
    await ui.unmount()
  }

  await $.turn.start({ text: 'go', turnId: 't1' })
  const bash = $.tool.call({ tool: 'Bash', command: 'npm test' })
  await spinnerAt(4_000, 'Crunching… · Bash 4s ▰▰▱▱▱▱  usual 10s · 1 tool call')
  // Past its usual time the gauge is full; far past it, it says by how much
  await spinnerAt(8_000, 'Crunching… · Bash 12s ▰▰▰▰▰▰  usual 10s · 1 tool call')
  await spinnerAt(11_000, 'Crunching… · Bash 23s ▰▰▰▰▰▰  2.3× usual · 1 tool call')
  await clock.advance(2_000)
  await bash
})

test("an unfolded turn draws a lane for Claude's requests and one per tool, busiest first", async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  on('tool.call', async (_, e) => {
    await clock.sleep(e.tool === 'Bash' ? 3_000 : 1_000)
    return { result: 'done' } as never
  })
  // The two requests write 1,200 and 1,900 tokens
  on('turn.step', async function* (_, e) {
    await clock.sleep(2_000)
    const usage = usageOf(e.index === 0 ? 1_200 : 1_900)
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage } as never
  })
  on('turn.start', async (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', async (_, e) => ({ text: e.answer }))
  on('ui.render', { component: 'TurnDuration' }, async ($, e) => {
    const { Text } = $.ui.resolve(e)
    return Text({ children: [`${e.props.word} for ${e.props.durationMs}ms`] })
  })
  const step = async (index: number) => {
    for await (const _ of $.turn.step({ turnId: 't1', index, model: 'm', messageCount: 1 })) {
      // drained
    }
  }

  // 0-2s Claude, 2-5s Bash, 5-6s Read, 6-8s Claude, 8-10s nothing
  await $.turn.start({ text: 'go', turnId: 't1' })
  let running: Promise<unknown> = step(0)
  await clock.advance(2_000)
  await running
  running = $.tool.call({ tool: 'Bash', command: 'npm test' })
  await clock.advance(3_000)
  await running
  running = $.tool.call({ tool: 'Read', file_path: '/src/a.ts' })
  await clock.advance(1_000)
  await running
  running = step(1)
  await clock.advance(2_000)
  await running
  await clock.advance(2_000)
  await $.turn.complete({ answer: 'ok', durationMs: 10_000, isAborted: false, turnId: 't1', reason: 'answer' })

  const ui = await $.ui.mount({ ...TURN_LINE, props: { word: 'Baked', durationMs: 10_000 } })
  await click(ui, 't1')
  // Thirty cells over ten seconds: three cells a second
  expect(await ui.find({ type: 'Text', text: /Claude +▆{6}▁{12}▆{6}▁{6} +4\.0s · 2 requests · out 3\.1k$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Bash +▁{6}▆{9}▁{15} +3\.0s · 1 call$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Read +▁{15}▆{3}▁{12} +1\.0s · 1 call/ })).toBeDefined()
  // A tool's bars in the pale sky of the folded line's
  expect((await ui.find({ type: 'Text', text: /^▆{9}$/ }))?.props.color).toBe('#86bbd8')
  // Claude's idle stretches in its clay too, the tools' dim
  const clay = (await ui.findAll({ type: 'Text', text: /^▁+$/ })).filter(run => run.props.color === '#d97757')
  expect(clay.map(run => run.text.length)).toEqual([12, 6])
  // Whole lane lines only, not the name piece inside each
  const lanes = await ui.findAll({ type: 'Text', text: /^ +(Claude|Bash|Read) .* · \d/ })
  expect(lanes.map(lane => lane.text.trim().split(' ')[0])).toEqual(['Claude', 'Bash', 'Read'])
  await ui.unmount()
})

test('on the desktop the fold hangs under the final reply, its lanes drawn as an SVG', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  on('tool.call', async () => {
    await clock.sleep(1_000)
    return { result: 'done' } as never
  })
  on('turn.step', async function* (_, e) {
    await clock.sleep(1_000)
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'tool_use', usage: usageOf(820) } as never
  })
  on('turn.start', async (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', async (_, e) => ({ text: e.answer }))
  // Beneath the plugin, standing for the engine's own reply block
  on('ui.render', { component: 'AssistantMessage' }, async ($, e) => {
    const { Text } = $.ui.resolve(e)
    return Text({ children: [e.props.text] })
  })

  // 0-1s Claude, 1-2s Bash
  await $.turn.start({ text: 'go', turnId: 't1' })
  const step = (async () => {
    for await (const _ of $.turn.step({ turnId: 't1', index: 0, model: 'm', messageCount: 1 })) {
      // drained
    }
  })()
  await clock.advance(1_000)
  await step
  const bash = $.tool.call({ tool: 'Bash', command: 'npm test' })
  await clock.advance(1_000)
  await bash
  await $.turn.complete({ answer: 'Tests pass.\n\nAll done here.', durationMs: 2_000, isAborted: false, turnId: 't1', reason: 'answer' })

  const reply = { plugin: 'tool-timeline', component: 'AssistantMessage' } as const
  const desktop = await $.ui.mount({ ...reply, surface: 'desktop', props: { text: 'All done here.', isFirstOfReply: true } })
  expect(await desktop.find({ type: 'Text', text: '1 tool call · slowest Bash 1.0s · 2.0s turn' })).toBeDefined()
  // Folded, the only picture is the chevron
  expect(await desktop.findAll({ type: 'Svg' })).toHaveLength(1)
  await desktop.press({ key: 'turn-t1' })
  // Unfolded, the chevron and a lane each for Claude and Bash
  expect(await desktop.findAll({ type: 'Svg' })).toHaveLength(3)
  // Claude's lane in its clay, its idle track too; a tool's bars in a soft blue
  const [, claudeLane, bashLane] = await desktop.findAll({ type: 'Svg' })
  expect(String(claudeLane?.props.source)).toContain('stroke="#d97757"')
  expect(String(bashLane?.props.source)).toContain('fill="#74b3d6"')
  // Each lane's totals in three columns: time, count, tokens
  expect(await desktop.findAll({ type: 'Text', text: /^1\.0s$/ })).toHaveLength(2)
  expect(await desktop.find({ type: 'Text', text: '· 1 request' })).toBeDefined()
  expect(await desktop.find({ type: 'Text', text: '· out 820' })).toBeDefined()
  expect(await desktop.find({ type: 'Text', text: '· 1 call' })).toBeDefined()
  expect(await desktop.find({ type: 'Text', text: '• 1.0s  Bash — npm test' })).toBeDefined()
  await desktop.unmount()

  // An earlier block of the same reply, and any reply on the terminal, are left as the engine draws them
  const earlier = await $.ui.mount({ ...reply, surface: 'desktop', props: { text: 'Tests pass.', isFirstOfReply: true } })
  expect(await earlier.find({ type: 'Button' })).toBeUndefined()
  await earlier.unmount()
  const terminal = await $.ui.mount({ ...reply, surface: 'terminal', props: { text: 'All done here.', isFirstOfReply: true } })
  expect(await terminal.find({ type: 'Button' })).toBeUndefined()
  await terminal.unmount()
})

test('an unfolded turn shares a row among repeated calls, and marks a call far slower than it usually is', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  // The store, kept here to read back: earlier runs of `npm test` in this project took about a second, of `ls` none
  // are kept
  on('session.root', async () => ({ value: ROOT }))
  const kept: Record<string, unknown> = { durations: { [inRoot('Bash:npm test')]: [900, 1_000, 1_100] } }
  on('store.get', async (_, e) => ({ value: kept[e.key] }) as never)
  on('store.set', async (_, e) => {
    kept[e.key] = e.value
    return { value: undefined } as never
  })
  on('tool.call', async (_, e) => {
    await clock.sleep(commandOf(e).startsWith('npm') ? 4_000 : 500)
    return { result: 'done', isError: commandOf(e) === 'false' } as never
  })
  on('turn.start', async (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', async (_, e) => ({ text: e.answer }))
  on('ui.render', { component: 'TurnDuration' }, async ($, e) => {
    const { Text } = $.ui.resolve(e)
    return Text({ children: [`${e.props.word} for ${e.props.durationMs}ms`] })
  })
  on('ui.render', { component: 'AssistantMessage' }, async ($, e) => {
    const { Text } = $.ui.resolve(e)
    return Text({ children: [e.props.text] })
  })

  await $.turn.start({ text: 'go', turnId: 't1' })
  for (const command of ['ls', 'ls', 'ls', 'npm   test', 'false']) {
    const run = $.tool.call({ tool: 'Bash', command })
    await clock.advance(command === 'npm   test' ? 4_000 : 500)
    await run
  }
  await $.turn.complete({ answer: 'ok', durationMs: 6_000, isAborted: false, turnId: 't1', reason: 'answer' })

  const ui = await $.ui.mount({ ...TURN_LINE, props: { word: 'Baked', durationMs: 6_000 } })
  await click(ui, 't1')
  const rows = await rowTexts(ui, 't1')
  expect(rows).toMatch(/├ +4\.0s ▆{10} · Bash +usual 1\.0s +npm test$/m)
  expect(rows).toMatch(/├ +1\.5s ▆{4}▁{6} · Bash ×3 +ls$/m)
  expect(rows).toMatch(/└ +500ms ▆▁{9} ✗ Bash +false$/m)
  // Short as it is, a call far slower than it usually is is worth asking about
  await ui.pointer({ type: 'enter', x: 8, y: 0, in: 'row-t1-0' })
  expect(await ui.find({ type: 'Text', text: /click to ask why/, in: 'row-t1-0' })).toBeDefined()
  await ui.unmount()

  // The desktop's lines say the same; the turn stays unfolded from the press above
  const reply = { plugin: 'tool-timeline', component: 'AssistantMessage', surface: 'desktop' } as const
  const desktop = await $.ui.mount({ ...reply, props: { text: 'ok', isFirstOfReply: true } })
  expect(await desktop.find({ type: 'Text', text: '• 4.0s  Bash (usual 1.0s) — npm test' })).toBeDefined()
  expect(await desktop.find({ type: 'Text', text: '• 1.5s  Bash ×3 — ls' })).toBeDefined()
  await desktop.unmount()

  // Each command's times as it ran through, the failed one left out; another tool's are kept by its name
  expect(kept.durations).toEqual({ [inRoot('Bash:npm test')]: [900, 1_000, 1_100, 4_000], [inRoot('Bash:ls')]: [500, 500, 500] })
})

test('a subagent\'s calls get lanes of their own, right under the Agent lane', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  on('tool.call', async (_, e) => {
    await clock.sleep(e.tool === 'Agent' ? 5_000 : e.tool === 'Bash' ? 2_000 : 1_000)
    return { result: 'done' } as never
  })
  on('turn.start', async (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', async (_, e) => ({ text: e.answer }))
  on('ui.render', { component: 'TurnDuration' }, async ($, e) => {
    const { Text } = $.ui.resolve(e)
    return Text({ children: [`${e.props.word} for ${e.props.durationMs}ms`] })
  })

  // 0-5s Agent; inside it 1-3s Bash, 3-4s Read; then 5-6s Read on the main loop
  await $.turn.start({ text: 'go', turnId: 't1' })
  const agent = $.tool.call({ tool: 'Agent', description: 'Look around', prompt: 'look' })
  await clock.advance(1_000)
  // Calls in the subagent's loop, as its events carry its id
  const bash = $.tool.call({ tool: 'Bash', command: 'ls', agentId: 'a1' } as never)
  await clock.advance(2_000)
  await bash
  const inner = $.tool.call({ tool: 'Read', file_path: '/a', agentId: 'a1' } as never)
  await clock.advance(1_000)
  await inner
  await clock.advance(1_000)
  await agent
  const outer = $.tool.call({ tool: 'Read', file_path: '/b' })
  await clock.advance(1_000)
  await outer
  await $.turn.complete({ answer: 'ok', durationMs: 6_000, isAborted: false, turnId: 't1', reason: 'answer' })

  const ui = await $.ui.mount({ ...TURN_LINE, props: { word: 'Baked', durationMs: 6_000 } })
  await click(ui, 't1')
  const lanes = await ui.findAll({ type: 'Text', text: /^ +\S.* +[▁▆]+ +\d.* · \d+ calls?$/ })
  expect(lanes.map(lane => /^ +(.+?) +[▁▆]/.exec(lane.text)?.[1])).toEqual(['Agent', '↳ Bash', '↳ Read', 'Read'])
  // Five cells a second: Bash ran inside the Agent call, from its first second to its third
  expect(await ui.find({ type: 'Text', text: /↳ Bash +▁{5}▆{10}▁{15} +2\.0s · 1 call$/ })).toBeDefined()
  // Listed by time, a subagent's call names the Agent it ran inside
  expect(await rowTexts(ui, 't1')).toMatch(/2\.0s ▆+▁* · Agent › Bash +ls$/m)
  await ui.unmount()
})

test('a call that runs half a minute or more raises a notification when it ends', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  const sent: string[] = []
  on('ui.notify', async (_, e) => {
    sent.push(e.text)
    return { value: { isSent: true, channel: 'iterm2' } } as never
  })
  on('tool.call', async (_, e) => {
    const ms = commandOf(e) === 'npm run build' ? 31_000 : commandOf(e) === 'make' ? 40_000 : 2_000
    await clock.sleep(ms)
    return { result: 'done', isError: commandOf(e) === 'make' } as never
  })
  on('turn.start', async (_, e) => ({ turnId: e.turnId }))

  await $.turn.start({ text: 'go', turnId: 't1' })
  for (const [command, ms] of [['ls', 2_000], ['npm run build', 31_000], ['make', 40_000]] as const) {
    const run = $.tool.call({ tool: 'Bash', command })
    await clock.advance(ms)
    await run
  }
  await clock.advance(0)

  expect(sent).toEqual(['Bash finished in 31.0s · npm run build', 'Bash failed after 40.0s · make'])
})

test('a Bash command failing three times in a row says so once, again only after a run of it went through', async ($, on) => {
  mock.clock(on, { now: 0 })
  const toasts: string[] = []
  const sent: string[] = []
  on('ui.toast', async (_, e) => {
    toasts.push(`${e.text} (${e.timeoutMs}ms)`)
    return { value: undefined } as never
  })
  on('ui.notify', async (_, e) => {
    sent.push(e.text)
    return { value: { isSent: true, channel: 'iterm2' } } as never
  })
  // Beneath the plugin: each command fails or runs through as the run below says
  let fails = true
  on('tool.call', async () => ({ result: 'done', isError: fails }) as never)
  on('turn.start', async (_, e) => ({ turnId: e.turnId }))
  const run = async (command: string, isFailed: boolean) => {
    fails = isFailed
    await $.tool.call({ tool: 'Bash', command })
  }

  await $.turn.start({ text: 'go', turnId: 't1' })
  // Other commands between, one of them failing too, keep the count; only the third failure says so
  await run('npm test', true)
  await run('ls', false)
  await run('make', true)
  await run('npm   test', true)
  expect(toasts).toEqual([])
  await run('npm test', true)
  const said = 'Bash failed 3 times in a row · npm test'
  expect(toasts).toEqual([`${said} (8000ms)`])
  // A fourth says nothing more; once it runs through, three more failures say so again
  await run('npm test', true)
  await run('npm test', false)
  await run('npm test', true)
  await run('npm test', true)
  expect(toasts).toHaveLength(1)
  await run('npm test', true)
  expect(toasts).toEqual([`${said} (8000ms)`, `${said} (8000ms)`])
  await Promise.resolve()
  expect(sent).toEqual([said, said])
})

test('a call refused, by a rule, by the person at the dialog or by the classifier, is marked so and is no failure', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  // Earlier runs of `npm test` in this project took about a second
  on('session.root', async () => ({ value: ROOT }))
  const kept: Record<string, unknown> = { durations: { [inRoot('Bash:npm test')]: [900, 1_000, 1_100] } }
  on('store.get', async (_, e) => ({ value: kept[e.key] }) as never)
  on('store.set', async (_, e) => {
    kept[e.key] = e.value
    return { value: undefined } as never
  })
  const toasts: string[] = []
  on('ui.toast', async (_, e) => {
    toasts.push(e.text)
    return { value: undefined } as never
  })
  // Beneath the plugin, standing for the engine: its verdict first, then the run. `curl` is refused by a rule; the
  // others are put to the person, who takes a while to allow `npm test` and refuses `rm` at the dialog, or to auto
  // mode's classifier, which refuses `git push`
  const refused = "The user doesn't want to proceed with this tool use. The tool use was rejected."
  const classified = 'Permission for this action was denied by the Claude Code auto mode classifier. Reason: [Git Destructive].'
  on('tool.check', async (_, e) => ({ decision: commandOf(e.input as object) === 'curl x' ? 'deny' : 'ask' }) as never)
  on('tool.call', async (_, e) => {
    const command = commandOf(e)
    const { decision } = await $.tool.check({ tool: e.tool, input: { command }, tool_use_id: e.tool_use_id })
    if (decision === 'deny') {
      return { result: 'blocked by rule', isError: true } as never
    }
    if (command.startsWith('rm')) {
      return { result: refused, isError: true } as never
    }
    if (command.startsWith('git')) {
      return { result: classified, isError: true } as never
    }
    await clock.sleep(20_000)
    return { result: 'done' } as never
  })
  on('turn.start', async (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', async (_, e) => ({ text: e.answer }))
  on('ui.render', { component: 'TurnDuration' }, async ($, e) => {
    const { Text } = $.ui.resolve(e)
    return Text({ children: [`${e.props.word} for ${e.props.durationMs}ms`] })
  })

  await $.turn.start({ text: 'go', turnId: 't1' })
  const run = $.tool.call({ tool: 'Bash', command: 'npm test' })
  await clock.advance(20_000)
  await run
  for (const command of ['rm -rf build', 'rm -rf build', 'rm -rf build', 'curl x', 'git push origin --delete main']) {
    await $.tool.call({ tool: 'Bash', command })
  }
  await $.turn.complete({ answer: 'ok', durationMs: 21_000, isAborted: false, turnId: 't1', reason: 'answer' })

  // The wait for the person's answer is in the call's time, and so in what is usual for it
  const ui = await $.ui.mount({ ...TURN_LINE, props: { word: 'Baked', durationMs: 21_000 } })
  await click(ui, 't1')
  const rows = await rowTexts(ui, 't1')
  expect(rows).toMatch(/├ +20\.0s ▆{10} · Bash +usual 1\.0s +npm test$/m)
  expect(rows).toMatch(/⊘ Bash ×3 +rm -rf build$/m)
  expect(rows).toMatch(/⊘ Bash +curl x$/m)
  expect(rows).toMatch(/⊘ Bash +git push origin --delete main$/m)
  await ui.unmount()
  expect(kept.durations).toEqual({ [inRoot('Bash:npm test')]: [900, 1_000, 1_100, 20_000] })
  // A refused run says nothing of whether the command works
  expect(toasts).toEqual([])
})

test("an MCP tool goes by its own name, without the server's prefix every tool of it starts with", async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  on('tool.call', async () => {
    await clock.sleep(1_000)
    return { result: 'done' } as never
  })
  on('turn.start', async (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', async (_, e) => ({ text: e.answer }))
  on('ui.render', { component: 'TurnDuration' }, async ($, e) => {
    const { Text } = $.ui.resolve(e)
    return Text({ children: [`${e.props.word} for ${e.props.durationMs}ms`] })
  })
  on('ui.render', { component: 'AssistantMessage' }, async ($, e) => {
    const { Text } = $.ui.resolve(e)
    return Text({ children: [e.props.text] })
  })

  // 0-1s one tool of the server, 1-2s another
  await $.turn.start({ text: 'go', turnId: 't1' })
  let running = $.tool.call({ tool: 'mcp__plugin_clens_clens__clens_search', query: 'cache' } as never)
  await clock.advance(1_000)
  await running
  running = $.tool.call({ tool: 'mcp__plugin_clens_clens__clens_left_off' } as never)
  await clock.advance(1_000)
  await running
  await $.turn.complete({ answer: 'ok', durationMs: 2_000, isAborted: false, turnId: 't1', reason: 'answer' })

  const ui = await $.ui.mount({ ...TURN_LINE, props: { word: 'Baked', durationMs: 2_000 } })
  await click(ui, 't1')
  const lanes = await ui.findAll({ type: 'Text', text: /^ +\S.* +[▁▆]+ +\d.* · \d+ calls?$/ })
  expect(lanes.map(lane => /^ +(.+?) +[▁▆]/.exec(lane.text)?.[1])).toEqual(['clens_search', 'clens_left_off'])
  expect(await rowTexts(ui, 't1')).toMatch(/1\.0s ▆+▁* · clens_search +cache$/m)
  await ui.unmount()

  const desktop = await $.ui.mount({
    plugin: 'tool-timeline',
    component: 'AssistantMessage',
    surface: 'desktop',
    props: { text: 'ok', isFirstOfReply: true },
  })
  // Unfolded already: the terminal's press holds for the desktop too
  expect(await desktop.find({ type: 'Text', text: 'clens_left_off' })).toBeDefined()
  expect(await desktop.find({ type: 'Text', text: /clens_search — cache$/ })).toBeDefined()
  await desktop.unmount()
})

test('where the terminal draws pictures, the bars are capsules in the middle of the line, the glyphs their alt', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  mock.env(on, { TERM_PROGRAM: 'ghostty' })
  on('tool.call', async (_, e) => {
    await clock.sleep(e.tool === 'Bash' ? 2_000 : 1_000)
    return { result: 'done' } as never
  })
  on('turn.start', async (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', async (_, e) => ({ text: e.answer }))
  on('ui.render', { component: 'TurnDuration' }, async ($, e) => {
    const { Text } = $.ui.resolve(e)
    return Text({ children: [`${e.props.word} for ${e.props.durationMs}ms`] })
  })

  // 0-2s Bash, 2-3s Read
  await $.turn.start({ text: 'go', turnId: 't1' })
  let running: Promise<unknown> = $.tool.call({ tool: 'Bash', command: 'npm test' })
  await clock.advance(2_000)
  await running
  running = $.tool.call({ tool: 'Read', file_path: '/src/a.ts' })
  await clock.advance(1_000)
  await running
  await $.turn.complete({ answer: 'ok', durationMs: 3_000, isAborted: false, turnId: 't1', reason: 'answer' })

  const ui = await $.ui.mount({ ...TURN_LINE, props: { word: 'Baked', durationMs: 3_000 } })
  await click(ui, 't1')
  const images = await ui.findAll({ type: 'Image' })
  // A lane each for Bash and Read, then a row each
  expect(images.map(image => [image.props.columns, image.props.alt])).toEqual([
    [30, `${'▆'.repeat(20)}${'▁'.repeat(10)}`],
    [30, `${'▁'.repeat(20)}${'▆'.repeat(10)}`],
    [10, '▆'.repeat(10)],
    [10, `▆▆▆▆▆${'▁'.repeat(5)}`],
  ])
  // The slowest row's bar fills its width in the sky, in the line's middle, with room above and below it
  const { rgba, width, height } = images[2]!.props.source as { rgba: string; width: number; height: number }
  const pixels = Uint8Array.from(atob(rgba), char => char.charCodeAt(0))
  const at = (x: number, y: number) => Array.from(pixels.subarray((y * width + x) * 4, (y * width + x) * 4 + 4))
  expect(at(width / 2, height / 2)).toEqual([0x86, 0xbb, 0xd8, 255])
  expect(at(width / 2, 1)[3]).toBe(0)
  expect(at(width / 2, height - 2)[3]).toBe(0)
  // The words beside it stay words
  expect(await ui.find({ type: 'Text', text: /· Bash +npm test$/, in: 'row-t1-0' })).toBeDefined()
  // On a transcript narrower than a line, its start (a lane's name, a row's time) keeps its letters and the line is cut
  // at the edge, as a line of glyphs is: two lanes, two rows
  const boxes = await ui.findAll({ type: 'Box' })
  expect(boxes.filter(box => box.props.overflow === 'hidden')).toHaveLength(4)
  expect(boxes.filter(box => box.props.flexShrink === 0)).toHaveLength(4)
  await ui.unmount()
})

test('over ssh the bars stay glyphs, the terminal unable to read the picture files on the other machine', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  mock.env(on, { TERM: 'xterm-kitty', SSH_CONNECTION: '10.0.0.2 52000 10.0.0.1 22' })
  on('tool.call', async () => {
    await clock.sleep(2_000)
    return { result: 'done' } as never
  })
  on('turn.start', async (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', async (_, e) => ({ text: e.answer }))
  on('ui.render', { component: 'TurnDuration' }, async ($, e) => {
    const { Text } = $.ui.resolve(e)
    return Text({ children: [`${e.props.word} for ${e.props.durationMs}ms`] })
  })

  await $.turn.start({ text: 'go', turnId: 't1' })
  const running = $.tool.call({ tool: 'Bash', command: 'npm test' })
  await clock.advance(2_000)
  await running
  await $.turn.complete({ answer: 'ok', durationMs: 2_000, isAborted: false, turnId: 't1', reason: 'answer' })

  const ui = await $.ui.mount({ ...TURN_LINE, props: { word: 'Baked', durationMs: 2_000 } })
  await click(ui, 't1')
  expect(await ui.findAll({ type: 'Image' })).toHaveLength(0)
  expect(await rowTexts(ui, 't1')).toMatch(/└ +2\.0s ▆{10} · Bash +npm test$/m)
  await ui.unmount()
})

test('where the terminal draws pictures, they are put in files first, so a drawing carries their paths', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  mock.env(on, { TERM_PROGRAM: 'ghostty' })
  on('tool.call', async (_, e) => {
    await clock.sleep(e.tool === 'Bash' ? 2_000 : 1_000)
    return { result: 'done' } as never
  })
  on('turn.start', async (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', async (_, e) => ({ text: e.answer }))
  on('ui.render', { component: 'TurnDuration' }, async ($, e) => {
    const { Text } = $.ui.resolve(e)
    return Text({ children: [`${e.props.word} for ${e.props.durationMs}ms`] })
  })
  on('session.id', async () => ({ value: 's1' }) as never)
  // Beneath the plugin, standing for the file system and the command that turns the text to bytes
  const written = new Map<string, string>()
  on('fs.write', async (_, e) => {
    written.set(e.path, e.text)
    return { value: undefined } as never
  })
  // It names back each file it made, as the real one does; this one makes them all
  const runs: string[][] = []
  on('process.run', async (_, e) => {
    runs.push([...e.argv])
    return { value: { exitCode: 0, stdout: `${e.argv.slice(6).join('\n')}\n`, stderr: '' } } as never
  })

  await $.turn.start({ text: 'go', turnId: 't1' })
  let running: Promise<unknown> = $.tool.call({ tool: 'Bash', command: 'npm test' })
  await clock.advance(2_000)
  await running
  running = $.tool.call({ tool: 'Read', file_path: '/src/a.ts' })
  await clock.advance(1_000)
  await running
  await $.turn.complete({ answer: 'ok', durationMs: 3_000, isAborted: false, turnId: 't1', reason: 'answer' })

  const ui = await $.ui.mount({ ...TURN_LINE, props: { word: 'Baked', durationMs: 3_000 } })
  await click(ui, 't1')
  // Two lanes and two rows, each a file under the session's folder, of its raw pixels
  const sources = (await ui.findAll({ type: 'Image' })).map(image => image.props.source as Record<string, unknown>)
  expect(sources).toHaveLength(4)
  for (const source of sources) {
    expect(source).toMatchObject({ format: 'rgba', file: expect.stringMatching(/^\/tmp\/tool-timeline\/s1\/\d+-\d+\.rgba$/) })
    const text = written.get(`${source.file as string}.b64`)
    expect(atob(text ?? '')).toHaveLength((source.width as number) * (source.height as number) * 4)
  }
  // One command turned them all to bytes
  expect(runs).toHaveLength(1)
  expect(runs[0]?.slice(0, 2)).toEqual(['sh', '-c'])
  // The first also lets go of what runs before it left half made in the session's folder
  expect(runs[0]?.[4]).toBe('/tmp/tool-timeline/s1')
  expect(runs[0]?.slice(6)).toEqual(sources.map(source => source.file))
  // Folded and unfolded again, the same pictures are the same files, nothing written again
  await click(ui, 't1')
  await click(ui, 't1')
  expect((await ui.findAll({ type: 'Image' })).map(image => (image.props.source as { file?: string }).file)).toEqual(
    sources.map(source => source.file),
  )
  expect(runs).toHaveLength(1)
  await ui.unmount()
})

test('a picture the command did not make is drawn from its pixels, and put in a file again on a later drawing', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  mock.env(on, { TERM_PROGRAM: 'ghostty' })
  on('tool.call', async () => {
    await clock.sleep(1_000)
    return { result: 'done' } as never
  })
  on('turn.start', async (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', async (_, e) => ({ text: e.answer }))
  on('ui.render', { component: 'TurnDuration' }, async ($, e) => {
    const { Text } = $.ui.resolve(e)
    return Text({ children: [`${e.props.word} for ${e.props.durationMs}ms`] })
  })
  on('session.id', async () => ({ value: 's1' }) as never)
  on('fs.write', async () => ({ value: undefined }) as never)
  // The first run makes none, as one cut off by a reload; the next makes them all
  let runs = 0
  const sweeps: string[] = []
  on('process.run', async (_, e) => {
    runs += 1
    sweeps.push(e.argv[4] ?? '')
    return { value: { exitCode: 0, stdout: runs === 1 ? '' : e.argv.slice(6).join('\n'), stderr: '' } } as never
  })

  await $.turn.start({ text: 'go', turnId: 't1' })
  const bash = $.tool.call({ tool: 'Bash', command: 'npm test' })
  await clock.advance(1_000)
  await bash
  await $.turn.complete({ answer: 'ok', durationMs: 1_000, isAborted: false, turnId: 't1', reason: 'answer' })

  const ui = await $.ui.mount({ ...TURN_LINE, props: { word: 'Baked', durationMs: 1_000 } })
  await click(ui, 't1')
  const kinds = async () => (await ui.findAll({ type: 'Image' })).map(image => ('file' in (image.props.source as object) ? 'file' : 'pixels'))
  expect(await kinds()).toEqual(['pixels', 'pixels'])
  await click(ui, 't1')
  await click(ui, 't1')
  expect(await kinds()).toEqual(['file', 'file'])
  expect(runs).toBe(2)
  // Only the first run of the module sweeps
  expect(sweeps).toEqual(['/tmp/tool-timeline/s1', ''])
  await ui.unmount()
})

test('a resumed session still folds the turns it kept when it last ran, under a reply longer than it kept too', async ($, on) => {
  // Beneath the plugin, standing for the transcript the session resumed
  const id = 'resumed-session'
  on('session.id', async () => ({ value: id }))
  const call = { id: 'c1', tool: 'Bash', detail: 'npm test', isSubagent: false, startedAt: 0, endedAt: 2_000, outcome: 'ok' }
  // Its answer by its last letters alone, as a long one is kept
  const answer = `${'A long answer. '.repeat(400)}All done.`
  const turn = { turnId: 't1', durationMs: 2_500, startedAt: 0, endedAt: 2_500, calls: [call], steps: [], answer: answer.slice(-4_000) }
  mock.store(on, { [`turns:${id}`]: [turn] })
  mock.clock(on, { now: 10_000 })
  on('session.start', async (_, e) => e as never)
  on('command.register', async () => ({ value: undefined }) as never)
  on('ui.render', { component: 'TurnDuration' }, async ($, e) => {
    const { Text } = $.ui.resolve(e)
    return Text({ children: [`${e.props.word} for ${e.props.durationMs}ms`] })
  })
  on('ui.render', { component: 'AssistantMessage' }, async ($, e) => {
    const { Text } = $.ui.resolve(e)
    return Text({ children: [e.props.text] })
  })

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...TURN_LINE, props: { word: 'Baked', durationMs: 2_500 } })
  expect(await ui.find({ type: 'Text', text: 'Bash 2.0s', in: 'turn-t1' })).toBeDefined()
  await ui.unmount()

  // On the desktop the fold hangs under the whole reply, though only its end was kept
  const reply = { plugin: 'tool-timeline', component: 'AssistantMessage', surface: 'desktop' } as const
  const desktop = await $.ui.mount({ ...reply, props: { text: answer, isFirstOfReply: true } })
  expect(await desktop.find({ type: 'Text', text: '1 tool call · slowest Bash 2.0s · 2.5s turn' })).toBeDefined()
  await desktop.unmount()
})

test("a finished turn is kept in the store under its session, the sessions least lately run let go", async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  // Beneath the plugin, a store holding five earlier sessions' turns, the first the least lately run
  const store = new Map<string, unknown>(['s1', 's2', 's3', 's4', 's5'].map(id => [`turns:${id}`, []]))
  on('store.get', async (_, e) => ({ value: store.get(e.key) }))
  on('store.set', async (_, e) => {
    store.set(e.key, e.value)
    return { value: undefined }
  })
  on('store.delete', async (_, e) => {
    store.delete(e.key)
    return { value: undefined }
  })
  on('store.keys', async () => ({ value: [...store.keys()] }))
  on('session.id', async () => ({ value: 'now' }))
  on('tool.call', async () => {
    await clock.sleep(1_000)
    return { result: 'done' } as never
  })
  on('turn.start', async (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', async (_, e) => ({ text: e.answer }))

  await $.turn.start({ text: 'go', turnId: 't1' })
  const bash = $.tool.call({ tool: 'Bash', command: 'npm test' })
  await clock.advance(1_000)
  await bash
  await $.turn.complete({ answer: `${'x'.repeat(5_000)}end`, durationMs: 1_000, isAborted: false, turnId: 't1', reason: 'answer' })

  const kept = store.get('turns:now') as Array<{ turnId: string; answer: string }>
  expect(kept.map(turn => turn.turnId)).toEqual(['t1'])
  // The answer kept by its end alone
  expect(kept[0]!.answer).toHaveLength(4_000)
  expect(kept[0]!.answer.endsWith('end')).toBe(true)
  // Five sessions kept: the one least lately run let go for this one
  expect([...store.keys()].filter(key => key.startsWith('turns:'))).toEqual([
    'turns:s2',
    'turns:s3',
    'turns:s4',
    'turns:s5',
    'turns:now',
  ])
})

test("with a prompt, Claude is told how long this project's slow commands usually take, again once that changes", async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  // Beneath the plugin, standing for the session's project and the store
  on('session.root', async () => ({ value: ROOT }))
  const durations: Record<string, number[]> = {
    [inRoot('Bash:npm test')]: [40_000, 48_000, 50_000],
    [inRoot('Bash:make')]: [12_000, 12_000, 12_000],
    [inRoot('Bash:ls')]: [100, 100, 100],
    [inRoot('Read')]: [20_000, 20_000, 20_000],
    '/work/other\nBash:gradle build': [90_000, 90_000, 90_000],
    '/work/other\nBash:npm test': [5_000, 5_000, 5_000],
  }
  const kept: Record<string, unknown> = { durations }
  on('store.get', async (_, e) => ({ value: kept[e.key] }) as never)
  on('store.set', async (_, e) => {
    kept[e.key] = e.value
    return { value: undefined } as never
  })
  on('tool.call', async () => {
    await clock.sleep(60_000)
    return { result: 'done' } as never
  })
  // What each prompt carried in beside its text
  const carried: Array<readonly string[] | undefined> = []
  on('prompt.submit', async (_, e) => {
    carried.push(e.context)
    return { text: e.text } as never
  })
  const submit = (text: string) => $.prompt.submit({ text, wait: false, origin: { kind: 'composer' } })

  // This project's slow commands, the slowest first; another project's, a quick one and another tool's left out
  await submit('first')
  expect(carried[0]).toEqual([
    [
      'How long these commands usually take in this project (tool-timeline: the middle of their latest runs):',
      '- `npm test`: 48s',
      '- `make`: 12s',
      'Where a narrower command does the job, prefer it; run a long one in the background when nothing waits on it.',
    ].join('\n'),
  ])
  // Told once, not with every prompt
  await submit('second')
  expect(carried[1]).toBeUndefined()

  // A run is kept as this project's, the other's left as it was; once its usual time moves, Claude is told again
  durations[inRoot('Bash:npm test')] = [40_000, 50_000, 60_000, 60_000]
  const run = $.tool.call({ tool: 'Bash', command: 'npm   test' })
  await clock.advance(60_000)
  await run
  const after = kept.durations as Record<string, number[]>
  expect(after[inRoot('Bash:npm test')]).toEqual([40_000, 50_000, 60_000, 60_000, 60_000])
  expect(after['/work/other\nBash:npm test']).toEqual([5_000, 5_000, 5_000])
  await submit('third')
  expect(carried[2]?.[0]).toMatch(/^- `npm test`: 1m00s$/m)
})

// A turn whose first request missed the prompt cache: 0-2s Claude writing its prompt afresh, 2-5s Bash, 5-7s Claude
// served from the cache, 7-10s nothing
async function turnWithMiss(...[$, on]: Parameters<TestBody>) {
  const clock = mock.clock(on, { now: 0 })
  on('tool.call', async () => {
    await clock.sleep(3_000)
    return { result: 'done' } as never
  })
  on('turn.step', async function* (_, e) {
    await clock.sleep(2_000)
    const usage = e.index === 0 ? { ...usageOf(1_200), cache_read_input_tokens: 0, cache_creation_input_tokens: 20_000 } : usageOf(1_900)
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage } as never
  })
  on('turn.start', async (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', async (_, e) => ({ text: e.answer }))
  on('ui.render', { component: 'TurnDuration' }, async ($, e) => {
    const { Text } = $.ui.resolve(e)
    return Text({ children: [`${e.props.word} for ${e.props.durationMs}ms`] })
  })
  on('ui.render', { component: 'AssistantMessage' }, async ($, e) => {
    const { Text } = $.ui.resolve(e)
    return Text({ children: [e.props.text] })
  })
  const step = async (index: number) => {
    for await (const _ of $.turn.step({ turnId: 't1', index, model: 'm', messageCount: 1 })) {
      // drained
    }
  }

  await $.turn.start({ text: 'go', turnId: 't1' })
  let running: Promise<unknown> = step(0)
  await clock.advance(2_000)
  await running
  running = $.tool.call({ tool: 'Bash', command: 'npm test' })
  await clock.advance(3_000)
  await running
  running = step(1)
  await clock.advance(2_000)
  await running
  await clock.advance(3_000)
  await $.turn.complete({ answer: 'ok', durationMs: 10_000, isAborted: false, turnId: 't1', reason: 'answer' })
}

test("a request that missed the prompt cache is drawn in the slow violet in Claude's lane, and counted", async ($, on) => {
  await turnWithMiss($, on)

  const ui = await $.ui.mount({ ...TURN_LINE, props: { word: 'Baked', durationMs: 10_000 } })
  await click(ui, 't1')
  expect(await ui.find({ type: 'Text', text: /Claude +▆{6}▁{9}▆{6}▁{9} +4\.0s · 2 requests · out 3\.1k · 1 cache miss$/ })).toBeDefined()
  const bars = await ui.findAll({ type: 'Text', text: /^▆+$/ })
  expect(bars.filter(bar => bar.props.color === '#b48ead').map(bar => bar.text.length)).toEqual([6])
  expect(bars.filter(bar => bar.props.color === '#d97757').map(bar => bar.text.length)).toEqual([6])
  expect((await ui.find({ type: 'Text', text: /^ · 1 cache miss$/ }))?.props.color).toBe('#b48ead')
  await ui.unmount()

  // The desktop's lane says the same; the turn stays unfolded from the press above
  const reply = { plugin: 'tool-timeline', component: 'AssistantMessage', surface: 'desktop' } as const
  const desktop = await $.ui.mount({ ...reply, props: { text: 'ok', isFirstOfReply: true } })
  const claude = String((await desktop.findAll({ type: 'Svg' })).find(svg => String(svg.props.alt).startsWith('Claude'))?.props.source)
  expect(claude).toContain('fill="#b48ead"')
  expect(claude).toContain('fill="#d97757"')
  expect((await desktop.find({ type: 'Text', text: /^ · 1 cache miss$/ }))?.props.color).toBe('#b48ead')
  await desktop.unmount()
})

test("where the terminal draws pictures, a request that missed the cache is a violet capsule in Claude's lane", async ($, on) => {
  mock.env(on, { TERM_PROGRAM: 'ghostty' })
  await turnWithMiss($, on)

  const ui = await $.ui.mount({ ...TURN_LINE, props: { word: 'Baked', durationMs: 10_000 } })
  await click(ui, 't1')
  const { rgba, width, height } = (await ui.findAll({ type: 'Image' }))[0]!.props.source as { rgba: string; width: number; height: number }
  const pixels = Uint8Array.from(atob(rgba), char => char.charCodeAt(0))
  const at = (x: number) => Array.from(pixels.subarray((height / 2 * width + x) * 4, (height / 2 * width + x) * 4 + 4))
  // The middle of each request's capsule: the first violet, the second clay
  expect(at(Math.round(width * 0.1))).toEqual([0xb4, 0x8e, 0xad, 255])
  expect(at(Math.round(width * 0.6))).toEqual([0xd9, 0x77, 0x57, 255])
  await ui.unmount()
})
