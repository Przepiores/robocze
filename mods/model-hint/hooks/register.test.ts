import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { LABELS, describe as summary, isCandidate, override, targetOf } from './logic'

const label = (target: 'haiku' | 'sonnet' | 'opus') => Object.keys(LABELS).find(k => LABELS[k] === target)

/** A session on Opus at `percent` context whose classifier answers `answer`. */
function world(on: On, answer: string | undefined, percent = 10, model = 'claude-opus-5-5') {
  const sent: string[] = []
  const toasts: string[] = []
  let classified = 0
  mock.store(on)
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('prompt.submit', ($, e) => ({ text: e.text }) as never)
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('session.model', () => ({ value: model }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200_000, tokens: percent * 2000, percent }, rateLimits: [] } }))
  on('model.classify', () => { classified += 1; return { value: answer } })
  on('ui.toast', ($, e) => { toasts.push(e.text); return { value: undefined } })
  on('ui.status', () => ({ value: undefined }))
  on('turn.step', async function* ($, e) {
    sent.push(e.model)
    return { turnId: e.turnId, index: e.index, answer: 'ok', toolUses: [] } as never
  })
  return { sent, toasts, classified: () => classified }
}

/** A typed prompt, then its turn's first request; returns the model the request went to. */
async function turn($: Engine, text: string, id = 't1', kind = 'composer') {
  await $.prompt.submit({ text, wait: false, origin: { kind } } as never)
  await $.turn.start({ text, turnId: id })
  const stream = $.turn.step({ turnId: id, index: 0, model: 'claude-opus-5-5', effort: 'high', messageCount: 1 } as never)
  for await (const _ of stream) { /* drain */ }
  await stream.result
  await $.turn.complete({ turnId: id } as never)
}

const SIMPLE = 'Jak w PowerShellu sprawdzić wersję Node?'

describe('logic', () => {
  test('short follow-ups and commands are not classified', () => {
    expect(isCandidate('tak, zrób to')).toBe(false)
    expect(isCandidate('/handoff compact')).toBe(false)
    expect(isCandidate('dalej, kontynuuj z następnym plikiem')).toBe(false)
    expect(isCandidate(SIMPLE)).toBe(true)
  })

  test('a !model prefix forces and is stripped', () => {
    expect(override('!sonnet napisz test')).toEqual({ force: 'sonnet', text: 'napisz test' })
    expect(override('zwykły prompt').force).toBe(null)
  })

  test('an unknown label keeps Opus', () => {
    expect(targetOf(undefined)).toBe('opus')
    expect(targetOf('cokolwiek')).toBe('opus')
    expect(targetOf(label('sonnet'))).toBe('sonnet')
  })

  test('stats read as a sentence', () => {
    expect(summary({ haiku: 1, sonnet: 1, opus: 2, kept: 3 })).toContain('(50%)')
  })
})

describe('routing', () => {
  test('a simple prompt on Opus goes to Sonnet for that turn', async ($, on) => {
    const w = world(on, label('sonnet'))
    await turn($, SIMPLE)
    expect(w.sent).toEqual(['sonnet'])
    expect(w.toasts[0]).toContain('Sonnet')
  })

  test('a trivial prompt goes to Haiku', async ($, on) => {
    const w = world(on, label('haiku'))
    await turn($, SIMPLE)
    expect(w.sent).toEqual(['haiku'])
  })

  test('a complex prompt stays on Opus without a toast', async ($, on) => {
    const w = world(on, label('opus'))
    await turn($, 'Zaprojektuj architekturę synchronizacji notcha z Claude Code przez HTTP')
    expect(w.sent).toEqual(['claude-opus-5-5'])
    expect(w.toasts.length).toBe(0)
  })

  test('a full context skips classification and stays on Opus', async ($, on) => {
    const w = world(on, label('haiku'), 60)
    await turn($, SIMPLE)
    expect(w.classified()).toBe(0)
    expect(w.sent).toEqual(['claude-opus-5-5'])
  })

  test('a session already on Sonnet is left alone', async ($, on) => {
    const w = world(on, label('haiku'), 10, 'claude-sonnet-5')
    await turn($, SIMPLE)
    expect(w.classified()).toBe(0)
  })

  test('!opus is stripped and keeps Opus; prompts from elsewhere are not routed', async ($, on) => {
    const w = world(on, label('haiku'))
    await turn($, '!opus ' + SIMPLE, 't1')
    await turn($, SIMPLE, 't2', 'scheduled-trigger')
    expect(w.classified()).toBe(0)
    expect(w.sent).toEqual(['claude-opus-5-5', 'claude-opus-5-5'])
  })

  test('/model-hint off stops routing and stats count turns', async ($, on) => {
    const w = world(on, label('sonnet'))
    await $.session.start({ cwd: '/p', surface: 'terminal', isInteractive: true })
    await turn($, SIMPLE, 't1')
    await $.command.run({ command: 'model-hint', args: 'off' } as never)
    await turn($, SIMPLE, 't2')
    expect(w.sent).toEqual(['sonnet', 'claude-opus-5-5'])
    const out = await $.command.run({ command: 'model-hint', args: 'stats' } as never)
    expect(out.text).toContain('wyłączony')
    expect(out.text).toContain('Sonnet 1')
  })

  test('a failing classifier keeps Opus', async ($, on) => {
    const w = world(on, undefined)
    await turn($, SIMPLE)
    expect(w.sent).toEqual(['claude-opus-5-5'])
  })
})
