import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { judge, note, stamp, thresholdFrom, withIgnore } from './logic'

const usage = { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }

type Fork = { isAnswered: true; text: string; usage: typeof usage } | { isAnswered: false; reason: 'nothing-to-fork' }
type Summary = { role: 'user'; text: string; toolUses: [] }

/** A fake project at /proj: files in memory, a git repo when /proj/.git exists, an answering fork. */
function world(on: On, files: Map<string, string>, fork: Fork = { isAnswered: true, text: '## Cel\nZrobić handoff', usage }, summary: Summary[] = [{ role: 'user', text: 'Podsumowanie', toolUses: [] }]) {
  const toasts: string[] = []
  const statuses: (string | undefined)[] = []
  const compactions: (string | undefined)[] = []
  const clock = mock.clock(on, { now: Date.UTC(2026, 9, 6, 12, 32) })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.measure', ($, e) => ({ changed: e.changed }))
  on('session.compact', ($, e) => { compactions.push(e.instructions); return { messages: summary } })
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('session.root', () => ({ value: '/proj' }))
  on('session.model', () => ({ value: 'opus' }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200_000, tokens: 144_000, percent: 72 }, rateLimits: [] } }))
  on('fs.exists', ($, e) => ({ value: files.has(e.path) }))
  on('fs.read', ($, e) => ({ value: files.get(e.path) ?? '' }))
  on('fs.write', ($, e) => { files.set(e.path, e.text); return { value: undefined } })
  on('fs.stat', () => ({ value: { kind: 'file', size: 1, mtimeMs: Date.UTC(2026, 9, 6, 9, 0), isLink: false } }) as never)
  on('model.fork', () => ({ value: fork }))
  on('ui.toast', ($, e) => { toasts.push(e.text); return { value: undefined } })
  on('ui.status', ($, e) => { statuses.push(e.text); return { value: undefined } })
  on('ui.log', () => ({ value: undefined }))
  return { toasts, statuses, compactions, clock }
}

/** Runs /handoff as the person would type it. */
const run = ($: Engine, args = '') => $.command.run({ command: 'handoff', args } as never)

const measure = ($: Engine, percent: number) =>
  $.session.measure({ context: { window: 200_000, tokens: percent * 2000, percent }, rateLimits: [], changed: ['context'] })

describe('logic', () => {
  test('warns once past the threshold and re-arms 10 points below it', () => {
    expect(judge(69, 70, false)).toBe('none')
    expect(judge(70, 70, false)).toBe('warn')
    expect(judge(90, 70, true)).toBe('none')
    expect(judge(61, 70, true)).toBe('none')
    expect(judge(59, 70, true)).toBe('rearm')
  })

  test('threshold falls back to 70 and is clamped', () => {
    expect(thresholdFrom(undefined)).toBe(70)
    expect(thresholdFrom(5)).toBe(10)
    expect(thresholdFrom(99)).toBe(95)
  })

  test('file stamp sorts by time', () => {
    expect(stamp(new Date(2026, 9, 6, 14, 32).getTime())).toBe('2026-10-06-1432')
  })

  test('.gitignore gains the line once, keeping what was there', () => {
    expect(withIgnore(null)).toBe('.claude/handoffs/\n')
    expect(withIgnore('node_modules')).toBe('node_modules\n.claude/handoffs/\n')
    expect(withIgnore('dist/\r\n.claude/handoffs/\r\n')).toBe(null)
    expect(withIgnore('.claude/\n')).toBe(null)
  })

  test('the note carries a header with model and fill', () => {
    expect(note('## Cel\nx\n', 0, 72, 'opus')).toContain('_Model: opus, kontekst 72%_')
  })
})

describe('threshold toast', () => {
  test('fires once at 70%, not again at 80%, and again after dropping and climbing', async ($, on) => {
    const { toasts } = world(on, new Map())
    await measure($, 50)
    expect(toasts.length).toBe(0)
    await measure($, 72)
    await measure($, 80)
    expect(toasts.length).toBe(1)
    expect(toasts[0]).toContain('/handoff')
    await measure($, 30)
    await measure($, 71)
    expect(toasts.length).toBe(2)
  })

  test('honours a configured threshold', { options: { threshold: 50 } }, async ($, on) => {
    const { toasts } = world(on, new Map())
    await measure($, 55)
    expect(toasts.length).toBe(1)
  })
})

describe('/handoff', () => {
  test('saves a dated note, LATEST.md and ignores the folder in git', async ($, on) => {
    const files = new Map([['/proj/.git', ''], ['/proj/.gitignore', 'node_modules\n']])
    world(on, files)
    await $.session.start({ cwd: '/proj', surface: 'terminal', isInteractive: true })
    const out = await run($)

    expect(out.text).toContain('Handoff zapisany')
    const saved = [...files.keys()].filter(k => k.startsWith('/proj/.claude/handoffs/'))
    expect(saved.length).toBe(2)
    expect(files.get('/proj/.claude/handoffs/LATEST.md')).toContain('## Cel')
    expect(files.get('/proj/.gitignore')).toBe('node_modules\n.claude/handoffs/\n')
  })

  test('leaves .gitignore alone outside a git repo', async ($, on) => {
    const files = new Map<string, string>()
    world(on, files)
    await $.session.start({ cwd: '/proj', surface: 'terminal', isInteractive: true })
    await run($)
    expect(files.has('/proj/.gitignore')).toBe(false)
  })

  test('compact saves first, then compacts pointing at the file', async ($, on) => {
    const { compactions, clock } = world(on, new Map())
    await $.session.start({ cwd: '/proj', surface: 'terminal', isInteractive: true })
    const out = await run($, 'compact')
    expect(out.text).toContain('Kompaktuję')
    expect(compactions.length).toBe(0)
    await clock.advance(500)
    expect(compactions[0]).toContain('.claude/handoffs/')
  })

  test('load hands the latest note to the model', async ($, on) => {
    const files = new Map([['/proj/.claude/handoffs/LATEST.md', '# Handoff\n## Cel\nX']])
    const { toasts } = world(on, files)
    await $.session.start({ cwd: '/proj', surface: 'terminal', isInteractive: true })
    expect(toasts[0]).toContain('/handoff load')
    const out = await run($, 'load')
    expect(out.context?.[0]).toContain('## Cel')
  })

  test('says why when there is nothing to fork yet', async ($, on) => {
    world(on, new Map(), { isAnswered: false, reason: 'nothing-to-fork' })
    await $.session.start({ cwd: '/proj', surface: 'terminal', isInteractive: true })
    const out = await run($)
    expect(out.text).toContain('nie ma jeszcze')
  })
})

describe('auto-compact safety net', () => {
  test('saves the compaction summary when no handoff was made', async ($, on) => {
    const files = new Map<string, string>()
    world(on, files, undefined, [{ role: 'user', text: 'Podsumowanie: robiliśmy X', toolUses: [] }])
    await $.session.compact({ trigger: 'auto', messages: [{ role: 'user', text: 'stara rozmowa', toolUses: [] }] } as never)
    const auto = [...files.keys()].find(k => k.includes('/auto-'))
    expect(auto).toBeDefined()
    expect(files.get(auto ?? '')).toContain('robiliśmy X')
  })
})
