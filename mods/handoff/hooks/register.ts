import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { SavedAt } from '../types'
import { DIR, HANDOFF_PROMPT, human, join, judge, note, stamp, thresholdFrom, withIgnore } from './logic'

const warned = atom({ plugin: 'handoff', key: 'warned' } as const, false)
const savedAt = atom({ plugin: 'handoff', key: 'savedAt' } as const, null as SavedAt)

const DAY = 24 * 60 * 60 * 1000

type Saved = { path: string; at: number }

/** Writes the handoff, LATEST.md beside it, and makes sure git ignores the folder. */
async function save($: EngineInterface, body: string, prefix = ''): Promise<Saved> {
  const root = await $.session.root()
  const at = await $.clock.now()
  const { context } = await $.session.usage()
  const text = note(body, at, context.percent, await $.session.model())
  const rel = `${DIR}/${prefix}${stamp(at)}.md`

  await $.fs.write(join(root, rel), text)
  await $.fs.write(join(root, `${DIR}/LATEST.md`), text)

  if (await $.fs.exists(join(root, '.git'))) {
    const path = join(root, '.gitignore')
    const current = (await $.fs.exists(path)) ? await $.fs.read(path) : null
    const next = withIgnore(current)
    if (next !== null) await $.fs.write(path, next)
  }

  await update($, savedAt, () => at)
  $.ui.status(undefined)
  return { path: rel, at }
}

export const register: Register = (on, options) => {
  const threshold = thresholdFrom(options.threshold)

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'handoff',
      description: 'Zapisz stan pracy do .claude/handoffs/ (compact: potem kompaktuj, load: wczytaj ostatni)',
      argumentHint: '[compact|load]',
    })

    try {
      const latest = join(e.cwd, `${DIR}/LATEST.md`)
      if (await $.fs.exists(latest)) {
        const { mtimeMs } = await $.fs.stat(latest)
        if ((await $.clock.now()) - mtimeMs < DAY) {
          $.ui.toast(`Jest handoff z ${human(mtimeMs)}. /handoff load wczyta go do rozmowy.`, { timeoutMs: 8000 })
        }
      }
    } catch (err) {
      $.ui.log(`handoff: nie sprawdzono LATEST.md (${String(err)})`, { to: 'debug' })
    }

    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    const { percent } = e.context
    if (e.changed.includes('context') && percent !== undefined) {
      const verdict = judge(percent, threshold, await read($, warned))
      if (verdict === 'warn') {
        await update($, warned, () => true)
        $.ui.toast(`Kontekst ${percent}%. Zapisz stan pracy: /handoff (albo /handoff compact)`, { timeoutMs: 10000 })
        $.ui.status(`Kontekst ${percent}%: /handoff`)
      } else if (verdict === 'rearm') {
        await update($, warned, () => false)
        $.ui.status(undefined)
      }
    }
    return next(e)
  })

  on('command.run', { command: 'handoff' }, async ($, e) => {
    const mode = (e.args ?? '').trim().toLowerCase()

    if (mode === 'load') {
      const latest = join(await $.session.root(), `${DIR}/LATEST.md`)
      if (!(await $.fs.exists(latest))) return { text: 'Brak handoffu w tym projekcie.' }
      const text = await $.fs.read(latest)
      return {
        text: `Wczytano ${DIR}/LATEST.md do rozmowy.`,
        context: [`Handoff z poprzedniej sesji (${DIR}/LATEST.md). Traktuj go jako punkt startowy pracy:\n\n${text}`],
      }
    }

    if (mode !== '' && mode !== 'compact') {
      return { text: `Nieznany argument "${mode}". Użyj: /handoff, /handoff compact albo /handoff load.` }
    }

    $.ui.status('Piszę handoff...')
    const reply = await $.model.fork({ prompt: HANDOFF_PROMPT })
    if (!reply.isAnswered) {
      $.ui.status(undefined)
      const why = reply.reason === 'nothing-to-fork' ? 'w tej rozmowie nie ma jeszcze żadnej odpowiedzi' : reply.reason
      return { text: `Nie udało się napisać handoffu: ${why}.` }
    }

    const saved = await save($, reply.text)

    if (mode === 'compact') {
      // A command.run hook cannot compact under itself: do it a moment later, once the session is idle.
      $.clock.after(300, async () => {
        try {
          const done = await $.session.compact({
            instructions: `Pełny stan pracy jest zapisany w ${saved.path}. Zachowaj cel, następne kroki i otwarte problemy.`,
          })
          if (done.skip !== undefined) {
            $.ui.toast(`Kompaktowanie pominięte: ${done.skip}`)
          } else {
            await update($, warned, () => false)
          }
        } catch (err) {
          $.ui.toast(`Kompaktowanie się nie udało, uruchom /compact ręcznie (${String(err)})`)
        }
      })
      return { text: `Handoff zapisany: ${saved.path}. Kompaktuję rozmowę...` }
    }

    return { text: `Handoff zapisany: ${saved.path} (oraz ${DIR}/LATEST.md).` }
  })

  // Safety net: an automatic compaction past the threshold without a fresh handoff
  // saves the compaction's own summary, so nothing is lost even if /handoff was skipped.
  on('session.compact', { trigger: 'auto' }, async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)

    const result = await next(e)
    if (result.skip !== undefined) return result

    try {
      const last = await read($, savedAt)
      const isFresh = last !== null && (await $.clock.now()) - last < 10 * 60 * 1000
      const summary = result.messages[0]?.text ?? ''
      if (!isFresh && summary.trim() !== '') {
        const saved = await save($, `> Zapisane automatycznie z podsumowania auto-kompaktowania.\n\n${summary}`, 'auto-')
        $.ui.toast(`Auto-kompaktowanie: podsumowanie zapisane w ${saved.path}`)
      }
    } catch (err) {
      $.ui.log(`handoff: nie zapisano podsumowania auto-kompaktowania (${String(err)})`, { to: 'debug' })
    }
    await update($, warned, () => false)
    return result
  }).catch(($, e, next) => next(e))
}
