import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { EMPTY_PLACE, PLACE_LABELS, classifierText, decide, isChatty, isOfficeAsk, labelFor, limitsFrom, shortPath, withEdit } from './logic'

const label = (place: 'code' | 'cowork' | 'chat') => Object.keys(PLACE_LABELS).find(k => PLACE_LABELS[k] === place)
const usage = { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }

type World = { toasts: string[]; copied: string[]; written: Map<string, string>; classified: () => number; clock: ReturnType<typeof mock.clock> }

/** A session whose classifier answers from `answers` in turn (the last one repeats). */
function world(on: On, answers: (string | undefined)[], copy = true): World {
  const toasts: string[] = []
  const copied: string[] = []
  const written = new Map<string, string>()
  let classified = 0
  const clock = mock.clock(on, { now: Date.UTC(2026, 9, 6, 18, 0) })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.measure', ($, e) => ({ changed: e.changed }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  on('prompt.submit', ($, e) => ({ text: e.text }) as never)
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('turn.step', async function* ($, e) {
    return { turnId: e.turnId, index: e.index, answer: 'ok', toolUses: [] } as never
  })
  on('tool.call', () => ({ result: 'ok', isError: false }) as never)
  on('model.classify', () => {
    const answer = answers[Math.min(classified, answers.length - 1)]
    classified += 1
    return { value: answer }
  })
  on('model.fork', () => ({ value: { isAnswered: true, text: 'Cześć, przenoszę rozmowę o raporcie…', usage } }))
  on('ui.copy', ($, e) => {
    if (!copy) return { value: { isCopied: false, reason: 'no-clipboard' } }
    copied.push(e.text)
    return { value: { isCopied: true } }
  })
  on('session.root', () => ({ value: 'C:\\proj' }))
  on('fs.write', ($, e) => { written.set(e.path, e.text); return { value: undefined } })
  on('ui.toast', ($, e) => { toasts.push(e.text); return { value: undefined } })
  on('ui.log', () => ({ value: undefined }))
  return { toasts, copied, written, classified: () => classified, clock }
}

/** One typed prompt, a turn with the given tool calls, then its end; lets the deferred check run. */
async function turn($: Engine, w: World, text: string, tools: { tool: string; [k: string]: unknown }[] = [], id = String(Math.random())) {
  await $.prompt.submit({ text, wait: false, origin: { kind: 'composer' } } as never)
  await $.turn.start({ text, turnId: id })
  const stream = $.turn.step({ turnId: id, index: 0, model: 'opus', messageCount: 1 } as never)
  for await (const _ of stream) { /* drain */ }
  for (const [i, t] of tools.entries()) {
    await $.tool.call({ tool_use_id: `${id}-${i}`, ...t } as never)
  }
  await $.turn.complete({ turnId: id, answer: 'ok', durationMs: 1000, isAborted: false, reason: 'answer' })
  await w.clock.advance(10)
}

const PANE_PROPS = { title: 'Kokpit', isFocused: false, bodyColumns: 40, placement: 'dock', scroll: {} } as never
const mountPane = ($: Engine, surface: 'terminal' | 'desktop' = 'terminal') =>
  $.ui.mount({ plugin: 'kokpit', surface, component: 'Pane', props: PANE_PROPS, requestId: 'kokpit' })

describe('logic', () => {
  test('labels name the file, command or task, shortened', () => {
    expect(shortPath('C:\\Users\\K\\robocze\\mods\\kokpit\\hooks\\logic.ts')).toBe('hooks/logic.ts')
    expect(labelFor({ file_path: '/a/b/c.ts' })).toBe('b/c.ts')
    expect(labelFor({ command: 'npm test\nmore' })).toBe('npm test')
  })

  test('edited files move to the front with a count', () => {
    const files = withEdit(withEdit([], '/r/a.ts'), '/r/b.ts')
    expect(withEdit(files, '/r/a.ts')).toEqual([{ path: 'r/a.ts', edits: 2 }, { path: 'r/b.ts', edits: 1 }])
  })

  test('rate limits read as labels with a reset time', () => {
    const now = new Date(2026, 9, 6, 18, 0).getTime()
    const [five] = limitsFrom([{ kind: 'five_hour', percentUsed: 61.6, resetsAt: new Date(2026, 9, 6, 23, 40).toISOString() }], now)
    expect(five).toEqual({ label: 'Limit 5h', percent: 62, resets: '23:40' })
  })

  test('office asks and tool-less runs are signals', () => {
    expect(isOfficeAsk('zrób z tego raport do Worda')).toBe(true)
    expect(isOfficeAsk('popraw test w register.ts')).toBe(false)
    expect(isChatty([{ prompt: 'a', tools: 0, edits: 0 }, { prompt: 'b', tools: 0, edits: 0 }, { prompt: 'c', tools: 0, edits: 0 }])).toBe(true)
    expect(classifierText([{ prompt: 'x', tools: 0, edits: 0 }])).toContain('no tools at all')
  })

  test('a suggestion needs two verdicts in a row; Code clears it', () => {
    const once = decide(EMPTY_PLACE, null, 'cowork')
    expect(once.suggestion).toBe(null)
    const twice = decide(once, 'cowork', 'cowork')
    expect(twice.suggestion).toBe('cowork')
    expect(decide(twice, 'cowork', 'code').suggestion).toBe(null)
  })
})

describe('pane', () => {
  test('shows the running turn, its tools and edited files', async ($, on) => {
    const w = world(on, [label('code')])
    await $.session.measure({ context: { window: 200_000, tokens: 68_000, percent: 34 }, rateLimits: [{ kind: 'five_hour', percentUsed: 62 }], cost: { usd: 1.2 }, changed: ['context'] } as never)
    await turn($, w, 'popraw test w hooks/register.ts i uruchom testy', [
      { tool: 'Read', file_path: '/r/hooks/logic.ts' },
      { tool: 'Edit', file_path: '/r/hooks/register.ts', old_string: 'a', new_string: 'b' },
    ])
    const ui = await mountPane($)
    expect(await ui.find({ text: /tura 1 zakończona/ })).toBeDefined()
    expect(await ui.find({ text: /Edit hooks\/register\.ts/ })).toBeDefined()
    expect(await ui.find({ text: /register\.ts ×1/ })).toBeDefined()
    expect(await ui.find({ text: /Limit 5h/ })).toBeDefined()
    expect(await ui.find({ text: /\$1\.20/ })).toBeDefined()
  })
})

describe('surfaces', () => {
  for (const surface of ['terminal', 'desktop'] as const) {
    test(`the chat suggestion with its link draws on ${surface}`, async ($, on) => {
      const w = world(on, [label('chat')])
      for (const p of ['wytłumacz mi transformatę Laplace’a prosto', 'a jak to się ma do Fouriera?', 'daj przykład z obwodem RC', 'a co z biegunami transmitancji?']) await turn($, w, p)
      const ui = await mountPane($, surface)
      expect(await ui.find({ key: 'move' })).toBeDefined()
      expect(await ui.find({ type: 'Link', text: /claude\.ai/ })).toBeDefined()
    })
  }
})

describe('place advisor', () => {
  test('checks every third turn and stays quiet while Code fits', async ($, on) => {
    const w = world(on, [label('code')])
    await turn($, w, 'dopisz obsługę błędów w module handoff', [{ tool: 'Edit', file_path: '/r/a.ts' }])
    await turn($, w, 'teraz uruchom testy i popraw co padnie', [{ tool: 'Bash', command: 'npm test' }])
    expect(w.classified()).toBe(0)
    await turn($, w, 'zrób commit tych zmian w konwencji', [{ tool: 'Bash', command: 'git commit' }])
    expect(w.classified()).toBe(1)
    expect(w.toasts.length).toBe(0)
  })

  test('an office ask is checked at once; two Cowork verdicts suggest moving, once', async ($, on) => {
    const w = world(on, [label('cowork')])
    await turn($, w, 'zrób z tych wyników raport do Worda z wykresami')
    await turn($, w, 'dodaj jeszcze arkusz Excel z danymi źródłowymi')
    expect(w.classified()).toBe(2)
    expect(w.toasts.length).toBe(1)
    expect(w.toasts[0]).toContain('Cowork')
    const ui = await mountPane($)
    expect(await ui.find({ key: 'move' })).toBeDefined()
  })

  test('“Przenieś” writes a starting message and copies it', async ($, on) => {
    const w = world(on, [label('chat')])
    for (const p of ['wytłumacz mi transformatę Laplace’a prosto', 'a jak to się ma do Fouriera?', 'daj przykład z obwodem RC', 'a co z biegunami transmitancji?']) await turn($, w, p)
    const ui = await mountPane($)
    await ui.press({ key: 'move' })
    await w.clock.advance(10)
    expect(w.copied[0]).toContain('przenoszę')
    expect(await ui.find({ text: /w schowku/ })).toBeDefined()
  })

  test('without a clipboard the message lands in a file', async ($, on) => {
    const w = world(on, [label('chat')], false)
    for (const p of ['wytłumacz mi transformatę Laplace’a prosto', 'a jak to się ma do Fouriera?', 'daj przykład z obwodem RC', 'a co z biegunami transmitancji?']) await turn($, w, p)
    const ui = await mountPane($)
    await ui.press({ key: 'move' })
    await w.clock.advance(10)
    expect([...w.written.keys()][0]).toContain('C:\\proj/.claude/handoffs/przeniesienie-')
  })

  test('“Zostaję w Code” hides the suggestion', async ($, on) => {
    const w = world(on, [label('cowork')])
    await turn($, w, 'zrób z tych wyników raport do Worda z wykresami')
    await turn($, w, 'dodaj jeszcze arkusz Excel z danymi źródłowymi')
    const ui = await mountPane($)
    await ui.press({ key: 'stay' })
    expect(await ui.find({ key: 'move' })).toBeUndefined()
  })

  test('/gdzie answers at once', async ($, on) => {
    const w = world(on, [label('code')])
    await $.session.start({ cwd: '/p', surface: 'terminal', isInteractive: true })
    await turn($, w, 'dopisz obsługę błędów w module handoff', [{ tool: 'Edit', file_path: '/r/a.ts' }])
    const out = await $.command.run({ command: 'gdzie', args: '' } as never)
    expect(out.text).toContain('Miejsce: Code')
  })

  test('can be switched off', { options: { placeEnabled: false } }, async ($, on) => {
    const w = world(on, [label('cowork')])
    await turn($, w, 'zrób z tych wyników raport do Worda z wykresami')
    expect(w.classified()).toBe(0)
  })
})
