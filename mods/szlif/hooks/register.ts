import { atom, read, update } from 'claude-code'
import type { EngineInterface, PromptSubmitInput, Register } from 'claude-code'

import type { SzlifAsk, SzlifDeliver, SzlifMode, SzlifPhase, SzlifStats, SzlifStatus } from '../types'
import {
  COMPOSE_SYSTEM,
  DELIVER_NAME,
  EMPTY_STATS,
  MODE_NAME,
  analyzePrompt,
  analyzeSystem,
  askOf,
  composePrompt,
  deliverFrom,
  describeStats,
  forkPrompt,
  isCandidate,
  isSameDraft,
  modeFrom,
  nextMode,
  parseAnalysis,
  parseComposed,
  parseTyped,
  statusLine,
} from './logic'
import type { Context } from './logic'

const status = atom({ plugin: 'szlif', key: 'status' } as const, {
  mode: 'wywiad',
  deliver: 'podglad',
  phase: null,
  last: null,
  stats: EMPTY_STATS,
} as SzlifStatus)

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])
const shortPath = (path: string) => path.split(/[\\/]+/).filter(Boolean).slice(-2).join('/')
/** `Podgląd`, `WYŁ` → `podglad`, `wyl`: commands typed with or without Polish letters. */
const plain = (text: string) => text.trim().toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/ł/g, 'l')

/** What one polish came to. */
type Outcome =
  | { kind: 'new'; text: string; why: string; asked: boolean }
  | { kind: 'ok'; why: string }
  | { kind: 'fail'; reason: string }

/** Module memory: a reload starts it over, which only costs the next prompt some context. */
type Memory = {
  /** The polished prompt put in the box: its submit goes through untouched. */
  armed: string | null
  /** The prompt of the running exchange, for the next prompt's context. */
  typed: string | null
  last: { prompt: string; answer: string } | null
  files: string[]
  tree: string[] | null
  lastSeq: number
}

/** Who polishes: a cheap model with light context, or the session's own over the whole conversation. */
type Engine = 'sonnet' | 'haiku' | 'fork'

async function change($: EngineInterface, fn: (s: SzlifStatus) => SzlifStatus): Promise<SzlifStatus> {
  const after = await update($, status, fn)
  $.ui.status(statusLine(after))
  return after
}

async function setPhase($: EngineInterface, phase: SzlifPhase) {
  await change($, s => ({ ...s, phase }))
}

async function setMode($: EngineInterface, mode: SzlifMode): Promise<SzlifStatus> {
  await $.store.set('mode', mode)
  return change($, s => ({ ...s, mode }))
}

async function setDeliver($: EngineInterface, deliver: SzlifDeliver): Promise<SzlifStatus> {
  await $.store.set('deliver', deliver)
  return change($, s => ({ ...s, deliver }))
}

async function count($: EngineInterface, key: keyof SzlifStats) {
  const after = await change($, s => ({ ...s, stats: { ...s.stats, [key]: s.stats[key] + 1 } }))
  await $.store.set('stats', after.stats)
}

/** Puts the typed original back in the box; its submit is not polished again. */
async function restore($: EngineInterface, mem: Memory): Promise<string> {
  const { last } = await read($, status)
  if (last === null) return 'Nie ma jeszcze promptu do przywrócenia.'
  mem.armed = last.original
  const filled = await $.prompt.fill({ text: last.original, mode: 'replace' })
  return filled.isFilled ? 'Oryginalny prompt jest z powrotem w polu: Enter wysyła go bez szlifu.' : `Pole niedostępne. Oryginał:\n${last.original}`
}

async function apply($: EngineInterface, mem: Memory, ask: SzlifAsk) {
  if (ask.action === 'mode') await setMode($, ask.value)
  else if (ask.action === 'deliver') await setDeliver($, ask.value)
  else $.ui.toast(await restore($, mem))
}

/** The light context a cheap model gets: project, its top folder, edited files, the last exchange. */
async function context($: EngineInterface, mem: Memory): Promise<Context> {
  const root = (await $.session.root()).replace(/[\\/]+$/, '')
  if (mem.tree === null) {
    try {
      mem.tree = (await $.fs.list(root))
        .filter(x => !x.name.startsWith('.') || x.name === '.claude')
        .sort((a, b) => Number(b.kind === 'dir') - Number(a.kind === 'dir') || a.name.localeCompare(b.name))
        .slice(0, 40)
        .map(x => (x.kind === 'dir' ? `${x.name}/` : x.name))
    } catch {
      mem.tree = []
    }
  }
  return { project: root.split(/[\\/]/).pop() ?? root, files: mem.files, tree: mem.tree, last: mem.last }
}

/** One question to whoever polishes; null with a reason when nothing usable came back. */
async function callModel($: EngineInterface, engine: Engine, system: string, prompt: string): Promise<{ text: string } | { reason: string }> {
  if (engine === 'fork') {
    const forked = await $.model.fork({ prompt: forkPrompt(system, prompt) })
    if (forked.isAnswered) return { text: forked.text }
    if (forked.reason !== 'nothing-to-fork') return { reason: forked.reason }
    // The first prompt of a session has no conversation to fork yet.
  }
  const reply = await $.model.complete({ model: engine === 'haiku' ? 'haiku' : 'sonnet', system, prompt, maxTokens: 2000, timeoutMs: 60_000 })
  return reply.isAnswered ? { text: reply.text } : { reason: reply.reason }
}

async function polish($: EngineInterface, engine: Engine, mem: Memory, body: string, mode: 'szlif' | 'wywiad'): Promise<Outcome> {
  const ctx = engine === 'fork' ? null : await context($, mem)
  await setPhase($, 'analizuje')
  try {
    const first = await callModel($, engine, analyzeSystem(mode), analyzePrompt(body, ctx))
    if ('reason' in first) return { kind: 'fail', reason: first.reason }
    const analysis = parseAnalysis(first.text, mode, body)
    if (analysis === null) return { kind: 'fail', reason: 'nieczytelna odpowiedź' }
    if (analysis.verdict === 'ok') return { kind: 'ok', why: analysis.why }
    if (analysis.verdict === 'popraw') return { kind: 'new', text: analysis.prompt, why: analysis.why, asked: false }

    await setPhase($, 'pyta')
    const answers: { question: string; answer: string | null }[] = []
    let isSkipped = false
    for (const q of analysis.questions) {
      if (isSkipped) {
        answers.push({ question: q.question, answer: null })
        continue
      }
      try {
        const answer = await $.ui.ask(q.question, { options: q.options, header: q.header, ...(q.multi ? { multiSelect: true as const } : {}) })
        answers.push({ question: q.question, answer })
      } catch {
        // Esc on a question skips the rest of the interview; the prompt is still composed from what is known.
        isSkipped = true
        answers.push({ question: q.question, answer: null })
      }
    }

    await setPhase($, 'sklada')
    const second = await callModel($, engine, COMPOSE_SYSTEM, composePrompt(body, answers, ctx))
    if ('reason' in second) return { kind: 'fail', reason: second.reason }
    const composed = parseComposed(second.text)
    if (composed === null) return { kind: 'fail', reason: 'nieczytelna odpowiedź' }
    return { kind: 'new', text: composed.prompt, why: composed.why, asked: answers.some(a => a.answer !== null) }
  } finally {
    await setPhase($, null)
  }
}

export const register: Register = (on, options) => {
  const defaultMode = modeFrom(options.mode)
  const defaultDeliver = deliverFrom(options.deliver)
  const engine: Engine = options.model === 'haiku' || options.model === 'fork' ? options.model : 'sonnet'
  const mem: Memory = { armed: null, typed: null, last: null, files: [], tree: null, lastSeq: -1 }

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'szlif',
      description: 'Szlif promptów: bez argumentu przełącza tryb (wył → szlif → wywiad); też podglad, auto, cofnij, status',
      argumentHint: '[off|szlif|wywiad|podglad|auto|cofnij|status]',
    })
    const mode = modeFrom(await $.store.get('mode'), defaultMode)
    const deliver = deliverFrom(await $.store.get('deliver'), defaultDeliver)
    const stats = { ...EMPTY_STATS, ...((await $.store.get('stats')) as Partial<SzlifStats> | undefined) }
    await change($, s => ({ ...s, mode, deliver, phase: null, stats }))
    return next(e)
  })

  on('command.run', { command: 'szlif' }, async ($, e) => {
    const arg = plain(e.args ?? '')
    const now = await read($, status)
    let s: SzlifStatus
    if (arg === '') s = await setMode($, nextMode(now.mode))
    else if (arg === 'off' || arg === 'wyl' || arg === 'wylacz') s = await setMode($, 'off')
    else if (arg === 'on' || arg === 'wlacz') s = await setMode($, defaultMode === 'off' ? 'wywiad' : defaultMode)
    else if (arg === 'szlif' || arg === 'wywiad') s = await setMode($, arg)
    else if (arg === 'podglad' || arg === 'auto') s = await setDeliver($, arg)
    else if (arg === 'cofnij' || arg === 'oryginal') return { text: await restore($, mem) }
    else if (arg === 'status' || arg === 'stats') {
      const last = now.last === null ? '' : `\nOstatnio: ${now.last.why || 'poprawiony prompt'}`
      return { text: `Szlif: ${MODE_NAME[now.mode]}, ${DELIVER_NAME[now.deliver]}. ${describeStats(now.stats)}${last}` }
    } else {
      return { text: 'Użycie: /szlif [off|szlif|wywiad|podglad|auto|cofnij|status]. Bez argumentu przełącza tryb.' }
    }
    return { text: `Szlif: ${MODE_NAME[s.mode]}, ${DELIVER_NAME[s.deliver]}. Na jeden prompt: „-- ” na początku wysyła bez szlifu, „++ ” robi wywiad.` }
  })

  on('prompt.submit', async ($, e, next) => {
    if (e.origin.kind !== 'composer') return next(e)
    const send = (input: PromptSubmitInput) => {
      mem.typed = input.text
      return next(input)
    }

    const armed = mem.armed
    mem.armed = null
    if (armed !== null && isSameDraft(e.text, armed)) return send(e)

    const typed = parseTyped(e.text)
    const stripped = typed.raw || typed.force ? { ...e, text: `${typed.prefix}${typed.body}` } : e
    if (typed.raw) return send(stripped)

    const now = await read($, status)
    const mode = typed.force ? 'wywiad' : now.mode
    // Off, typed over a running turn (steering it), or a command or short reply: as typed.
    if (mode === 'off' || e.turnId !== undefined || (!typed.force && !isCandidate(typed.body))) return send(stripped)
    if ((e.attachments?.length ?? 0) > 0 && now.deliver === 'podglad') {
      $.ui.toast('Szlif pominięty: prompt ma załączniki, których nie da się wstawić z powrotem do pola.')
      return send(stripped)
    }

    const outcome = await polish($, engine, mem, typed.body, mode)
    if (outcome.kind === 'fail') {
      $.ui.log(`szlif: ${outcome.reason}`, { to: 'debug' })
      $.ui.toast(`Szlif nie wyszedł (${outcome.reason}): prompt idzie jak wpisany.`)
      return send(stripped)
    }
    if (outcome.kind === 'ok') {
      await count($, 'kept')
      $.ui.toast('Szlif: prompt jest dobry, idzie bez zmian.')
      return send(stripped)
    }

    const text = `${typed.prefix}${outcome.text}`
    await change($, s => ({ ...s, last: { original: e.text, improved: text, why: outcome.why } }))
    await count($, outcome.asked ? 'asked' : 'polished')
    const why = outcome.why === '' ? '' : ` (${outcome.why})`

    if (now.deliver === 'auto') {
      $.ui.toast(`Szlif: wysłano poprawiony prompt${why}. /szlif cofnij wstawi oryginał.`)
      return send({ ...stripped, text })
    }

    mem.armed = text
    $.clock.after(0, async () => {
      const filled = await $.prompt.fill({ text, mode: 'replace' })
      if (filled.isFilled) {
        $.ui.toast(`Szlif${why}: popraw w polu albo wyślij Enterem. /szlif cofnij przywraca oryginał.`, { timeoutMs: 8000 })
      } else {
        $.ui.log(`Szlif: poprawiony prompt (pole niedostępne, skopiuj go stąd):\n\n${text}`)
      }
    })
    return { drop: 'Szlif: poprawiony prompt czeka w polu, Enter wysyła.' }
  }).catch(($, e, next) => next(e))

  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    const input = e as unknown as Readonly<Record<string, unknown>>
    const file = typeof input.file_path === 'string' ? input.file_path : typeof input.notebook_path === 'string' ? input.notebook_path : null
    if (e.agentId === undefined && EDIT_TOOLS.has(String(e.tool)) && file !== null && ran.deny === undefined && ran.isError !== true) {
      const short = shortPath(file)
      mem.files = [short, ...mem.files.filter(f => f !== short)].slice(0, 8)
    }
    return ran
  }).catch(($, e, next) => next(e))

  on('turn.complete', ($, e, next) => {
    if (e.agentId === undefined && mem.typed !== null && !e.isAborted && e.answer.trim() !== '') {
      mem.last = { prompt: mem.typed, answer: e.answer }
    }
    if (e.agentId === undefined) mem.typed = null
    return next(e)
  })

  // The Kokpit pane asks by writing `kokpit.szlifAsk`, a value only it may write: szlif watches the write and acts.
  // The matcher names a value szlif's own contract does not declare, hence the cast.
  on('state.set', { plugin: 'kokpit', key: 'szlifAsk' } as never, async ($, e, next) => {
    const result = await next(e)
    const ask = askOf((e as { value?: unknown }).value)
    if (result.value?.isSet === true && ask !== null && ask.seq !== mem.lastSeq) {
      mem.lastSeq = ask.seq
      $.clock.after(0, () => void apply($, mem, ask))
    }
    return result
  }).catch(($, e, next) => next(e))
}
