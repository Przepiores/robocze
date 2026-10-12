import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, Register } from 'claude-code'

import { askOf, isCandidate, isSameDraft, nextMode, parseAnalysis, parseTyped } from './logic'

const usage = { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }

const LONG = 'dodaj walidację formularza logowania w aplikacji'
const BETTER = 'Dodaj walidację formularza logowania: e-mail i hasło wymagane. Gotowe gdy testy przechodzą.'
const OK = JSON.stringify({ ocena: 'ok', prompt: '', zmiany: '', pytania: [] })
const FIX = JSON.stringify({ ocena: 'popraw', prompt: BETTER, zmiany: 'dodane kryterium ukończenia', pytania: [] })
const ASK = JSON.stringify({
  ocena: 'pytaj',
  prompt: '',
  zmiany: '',
  pytania: [
    { pytanie: 'Gdzie pokazywać błędy?', naglowek: 'Błędy', opcje: ['Pod polem', 'Toast'], wiele: false },
    { pytanie: 'Jakie reguły hasła', naglowek: 'Hasło', opcje: ['Min. 8 znaków', 'Bez reguł'] },
  ],
})
const COMPOSED = JSON.stringify({ prompt: 'Dodaj walidację z błędami pod polem i hasłem min. 8 znaków.', zmiany: 'doprecyzowane błędy i hasło' })

type World = {
  entered: string[]
  filled: string[]
  toasts: string[]
  asked: string[]
  prompts: string[]
  clock: ReturnType<typeof mock.clock>
}

/** A session whose polishing model answers `replies` in turn (the last repeats) and whose person answers `answers` (null: Esc). */
function world(on: On, replies: string[], answers: (string | null)[] = [], isAnswered = true): World {
  const w: World = { entered: [], filled: [], toasts: [], asked: [], prompts: [], clock: mock.clock(on, { now: 0 }) }
  let n = 0
  let a = 0
  mock.store(on)
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('session.root', () => ({ value: '/home/k/robocze' }))
  on('fs.list', () => ({ value: [{ name: 'mods', kind: 'dir', size: 0, mtimeMs: 0, isLink: false }, { name: 'README.md', kind: 'file', size: 1, mtimeMs: 0, isLink: false }] }) as never)
  on('model.complete', ($, e) => {
    w.prompts.push(e.prompt)
    const text = replies[Math.min(n, replies.length - 1)] ?? ''
    n += 1
    return { value: isAnswered ? { isAnswered: true, text, usage } : { isAnswered: false, reason: 'api-error', status: 529, usage } } as never
  })
  on('tool.call', ($, e) => {
    const input = e as unknown as { tool: string; questions?: { question: string }[] }
    if (input.tool !== 'AskUserQuestion') return { result: 'ok' } as never
    const question = input.questions?.[0]?.question ?? ''
    w.asked.push(question)
    const answer = answers[a]
    a += 1
    if (answer === null || answer === undefined) return { deny: 'dismissed' }
    return { result: { questions: input.questions, answers: { [question]: answer } } } as never
  })
  on('prompt.fill', ($, e) => { w.filled.push(e.text); return { isFilled: true } as never })
  on('prompt.submit', ($, e) => { w.entered.push(e.text); return { text: e.text } as never })
  on('turn.complete', () => ({ text: '' }))
  on('ui.toast', ($, e) => { w.toasts.push(e.text); return { value: undefined } })
  on('ui.status', () => ({ value: undefined }))
  on('ui.log', () => ({ value: undefined }))
  return w
}

async function start($: Engine) {
  await $.session.start({ cwd: '/home/k/robocze' } as never)
}

/** The person presses Enter on `text`; resolves what the chain answered and lets deferred work run. */
async function type($: Engine, w: World, text: string, extra: Record<string, unknown> = {}) {
  const out = await $.prompt.submit({ text, wait: false, origin: { kind: 'composer' }, ...extra } as never)
  await w.clock.advance(10)
  return out as { text?: string; drop?: string }
}

describe('logic', () => {
  test('markers: -- sends raw, ++ interviews, a model prefix is kept', () => {
    expect(parseTyped('-- napraw to')).toEqual({ prefix: '', body: 'napraw to', raw: true, force: false })
    expect(parseTyped('++ zrób raport')).toEqual({ prefix: '', body: 'zrób raport', raw: false, force: true })
    expect(parseTyped('!opus ++ zrób raport')).toEqual({ prefix: '!opus ', body: 'zrób raport', raw: false, force: true })
    expect(parseTyped('zwykły prompt').raw).toBe(false)
  })

  test('commands, short replies and follow-ups are not polished', () => {
    expect(isCandidate('/compact')).toBe(false)
    expect(isCandidate('tak, zrób to dalej')).toBe(false)
    expect(isCandidate('ok')).toBe(false)
    expect(isCandidate(LONG)).toBe(true)
  })

  test('a lightly edited fill counts as the same draft, a new prompt does not', () => {
    expect(isSameDraft(`${BETTER} Bez nowych zależności.`, BETTER)).toBe(true)
    expect(isSameDraft('napisz README dla moda kokpit po polsku', BETTER)).toBe(false)
  })

  test('analysis: fenced JSON reads; a question in szlif mode becomes a rewrite or nothing', () => {
    expect(parseAnalysis(`\`\`\`json\n${FIX}\n\`\`\``, 'wywiad', LONG)?.verdict).toBe('popraw')
    expect(parseAnalysis(ASK, 'wywiad', LONG)?.questions.length).toBe(2)
    expect(parseAnalysis(ASK, 'wywiad', LONG)?.questions[1]?.question).toBe('Jakie reguły hasła?')
    expect(parseAnalysis(ASK, 'szlif', LONG)?.verdict).toBe('ok')
    expect(parseAnalysis(JSON.stringify({ ocena: 'popraw', prompt: LONG }), 'szlif', LONG)?.verdict).toBe('ok')
    expect(parseAnalysis('nie wiem', 'szlif', LONG)).toBe(null)
  })

  test('the Kokpit channel accepts only well-formed asks; modes cycle', () => {
    expect(askOf({ seq: 2, action: 'mode', value: 'szlif' })).toEqual({ seq: 2, action: 'mode', value: 'szlif' })
    expect(askOf({ seq: 2, action: 'mode', value: 'turbo' })).toBe(null)
    expect(askOf({ action: 'restore' })).toBe(null)
    expect(nextMode('off')).toBe('szlif')
    expect(nextMode('wywiad')).toBe('off')
  })
})

describe('podgląd (default)', () => {
  test('the polished prompt goes back to the box; its Enter sends it untouched', async ($, on) => {
    const w = world(on, [FIX])
    await start($)
    const out = await type($, w, LONG)
    expect(out.drop).toBeDefined()
    expect(w.entered).toEqual([])
    expect(w.filled).toEqual([BETTER])
    expect(w.prompts[0]).toContain('robocze')
    expect(w.prompts[0]).toContain('mods/')

    await type($, w, BETTER)
    expect(w.entered).toEqual([BETTER])
    expect(w.prompts.length).toBe(1)
  })

  test('a good prompt goes as typed', async ($, on) => {
    const w = world(on, [OK])
    await start($)
    await type($, w, LONG)
    expect(w.entered).toEqual([LONG])
    expect(w.toasts.some(t => t.includes('dobry'))).toBe(true)
  })

  test('/szlif cofnij puts the original back and it is not polished again', async ($, on) => {
    const w = world(on, [FIX])
    await start($)
    await type($, w, LONG)
    const out = await $.command.run({ command: 'szlif', args: 'cofnij' } as never)
    expect(out.text).toContain('Oryginalny')
    expect(w.filled.at(-1)).toBe(LONG)
    await type($, w, LONG)
    expect(w.entered).toEqual([LONG])
    expect(w.prompts.length).toBe(1)
  })
})

describe('auto', () => {
  test('sends the polished prompt at once', { options: { deliver: 'auto' } }, async ($, on) => {
    const w = world(on, [FIX])
    await start($)
    await type($, w, LONG)
    expect(w.entered).toEqual([BETTER])
    expect(w.filled).toEqual([])
  })

  test('keeps a model-hint prefix in front', { options: { deliver: 'auto' } }, async ($, on) => {
    const w = world(on, [FIX])
    await start($)
    await type($, w, `!sonnet ${LONG}`)
    expect(w.entered).toEqual([`!sonnet ${BETTER}`])
  })
})

describe('wywiad', () => {
  test('asks the questions, then composes the prompt from the answers', async ($, on) => {
    const w = world(on, [ASK, COMPOSED], ['Pod polem', 'Min. 8 znaków'])
    await start($)
    await type($, w, LONG)
    expect(w.asked).toEqual(['Gdzie pokazywać błędy?', 'Jakie reguły hasła?'])
    expect(w.prompts[1]).toContain('Odpowiedź: Pod polem')
    expect(w.filled).toEqual(['Dodaj walidację z błędami pod polem i hasłem min. 8 znaków.'])
  })

  test('Esc on a question skips the rest; the prompt is still composed', async ($, on) => {
    const w = world(on, [ASK, COMPOSED], [null])
    await start($)
    await type($, w, LONG)
    expect(w.asked.length).toBe(1)
    expect(w.prompts[1]).toContain('(bez odpowiedzi)')
    expect(w.filled.length).toBe(1)
  })

  test('szlif mode never asks', { options: { mode: 'szlif' } }, async ($, on) => {
    const w = world(on, [ASK])
    await start($)
    await type($, w, LONG)
    expect(w.asked).toEqual([])
    expect(w.entered).toEqual([LONG])
  })
})

describe('passing through', () => {
  test('-- sends as typed without a model call', async ($, on) => {
    const w = world(on, [FIX])
    await start($)
    await type($, w, `-- ${LONG}`)
    expect(w.entered).toEqual([LONG])
    expect(w.prompts.length).toBe(0)
  })

  test('off sends as typed; ++ still interviews that one prompt', { options: { mode: 'off' } }, async ($, on) => {
    const w = world(on, [ASK, COMPOSED], ['Toast', 'Bez reguł'])
    await start($)
    await type($, w, LONG)
    expect(w.entered).toEqual([LONG])
    await type($, w, `++ ${LONG}`)
    expect(w.asked.length).toBe(2)
    expect(w.filled.length).toBe(1)
  })

  test('short replies, prompts typed over a running turn and plugin prompts go as typed', async ($, on) => {
    const w = world(on, [FIX])
    await start($)
    await type($, w, 'tak')
    await type($, w, LONG, { turnId: 't1' })
    await $.prompt.submit({ text: LONG } as never)
    expect(w.entered.length).toBe(3)
    expect(w.prompts.length).toBe(0)
  })

  test('a failed model call sends the prompt as typed', async ($, on) => {
    const w = world(on, [FIX], [], false)
    await start($)
    await type($, w, LONG)
    expect(w.entered).toEqual([LONG])
    expect(w.toasts.some(t => t.includes('nie wyszedł'))).toBe(true)
  })
})

describe('/szlif', () => {
  test('cycles the mode, sets delivery and remembers it', async ($, on) => {
    world(on, [OK])
    await start($)
    expect((await $.command.run({ command: 'szlif' } as never)).text).toContain('wyłączony')
    expect((await $.command.run({ command: 'szlif' } as never)).text).toContain('szlif, podgląd')
    expect((await $.command.run({ command: 'szlif', args: 'Auto' } as never)).text).toContain('auto')
    expect((await $.command.run({ command: 'szlif', args: 'status' } as never)).text).toContain('Szlif: szlif, auto. Jeszcze nic')
  })
})

/**
 * Kokpit's side of the channel, as small as it gets: the pane writes its own
 * `kokpit.szlifAsk` (here through a command the test runs) and szlif acts on it.
 */
const fakeKokpit: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'kokpit-ask', description: 'test' })
    return next(e)
  })
  on('command.run', { command: 'kokpit-ask' }, async ($, e) => {
    await $.state.set({ plugin: 'kokpit', key: 'szlifAsk' } as never, JSON.parse(e.args) as never)
    return { text: 'ok' }
  })
}

const WITH_KOKPIT = { plugins: [{ name: 'kokpit', register: fakeKokpit }] }
const ask = ($: Engine, value: unknown) => $.command.run({ command: 'kokpit-ask', args: JSON.stringify(value) } as never)
const state = async ($: Engine) => (await $.command.run({ command: 'szlif', args: 'status' } as never)).text ?? ''

describe('Kokpit channel', () => {
  test('a write of kokpit.szlifAsk switches the mode and delivery', WITH_KOKPIT, async ($, on) => {
    const w = world(on, [FIX])
    await start($)
    await ask($, { seq: 1, action: 'mode', value: 'off' })
    await w.clock.advance(10)
    expect(await state($)).toContain('wyłączony')
    await ask($, { seq: 2, action: 'deliver', value: 'auto' })
    await ask($, { seq: 3, action: 'mode', value: 'szlif' })
    await w.clock.advance(10)
    expect(await state($)).toContain('szlif, auto')
  })

  test('a malformed ask changes nothing; restore puts the original back', WITH_KOKPIT, async ($, on) => {
    const w = world(on, [FIX])
    await start($)
    await ask($, { seq: 1, action: 'mode', value: 'turbo' })
    await w.clock.advance(10)
    expect(await state($)).toContain('wywiad, podgląd')
    await type($, w, LONG)
    await ask($, { seq: 2, action: 'restore' })
    await w.clock.advance(10)
    expect(w.filled).toEqual([BETTER, LONG])
  })
})
