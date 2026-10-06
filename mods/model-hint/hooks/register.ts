import type { EngineInterface, Register } from 'claude-code'

import { EMPTY_STATS, LABELS, NAME, clip, describe, isCandidate, isOpus, maxContextFrom, override, targetOf } from './logic'
import type { Stats, Target } from './logic'

/** What the last typed prompt asked for, picked up by the turn it starts. */
type Pending = { force: Target } | { text: string }

async function bump($: EngineInterface, key: keyof Stats) {
  const stats = { ...EMPTY_STATS, ...((await $.store.get('stats')) as Partial<Stats> | undefined) }
  stats[key] += 1
  await $.store.set('stats', stats)
}

async function isOn($: EngineInterface, configured: boolean): Promise<boolean> {
  const toggled = await $.store.get('enabled')
  return typeof toggled === 'boolean' ? toggled : configured
}

export const register: Register = (on, options) => {
  const configured = options.enabled !== false
  const maxContext = maxContextFrom(options.maxContext)

  let pending: Pending | null = null
  /** Each routed turn's model, settled before its first request goes out. */
  const routes = new Map<string, { target: Promise<Target>; isForced: boolean }>()

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'model-hint',
      description: 'Automatyczne przełączanie prostych promptów na Sonnet/Haiku: on, off albo stats',
      argumentHint: '[on|off|stats]',
    })
    return next(e)
  })

  on('command.run', { command: 'model-hint' }, async ($, e) => {
    const arg = (e.args ?? '').trim().toLowerCase()
    if (arg === 'on' || arg === 'off') {
      await $.store.set('enabled', arg === 'on')
      return { text: arg === 'on' ? 'model-hint włączony.' : 'model-hint wyłączony: każda tura idzie na model sesji.' }
    }
    const stats = { ...EMPTY_STATS, ...((await $.store.get('stats')) as Partial<Stats> | undefined) }
    const state = (await isOn($, configured)) ? 'włączony' : 'wyłączony'
    return { text: `model-hint ${state}. ${describe(stats)}\nWymuszenie na jedną turę: !opus, !sonnet albo !haiku na początku promptu.` }
  })

  on('prompt.submit', ($, e, next) => {
    pending = null
    if (e.origin.kind !== 'composer') return next(e)

    const { force, text } = override(e.text)
    if (force !== null) {
      pending = { force }
      return next({ ...e, text })
    }
    if (isCandidate(e.text)) pending = { text: e.text }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.start', async ($, e, next) => {
    const asked = pending
    pending = null
    // A turn without typed text (a continuation) never inherits a prompt's route.
    if (asked === null || e.text.trim() === '') return next(e)

    if ('force' in asked) {
      routes.set(e.turnId, { target: Promise.resolve(asked.force), isForced: true })
      return next(e)
    }

    if (!(await isOn($, configured)) || !isOpus(await $.session.model())) return next(e)

    const { context } = await $.session.usage()
    if ((context.percent ?? 0) > maxContext) {
      await bump($, 'kept')
      return next(e)
    }

    // Started now, awaited by the turn's first request: classification overlaps the engine's own setup.
    const target = $.model
      .classify(clip(asked.text), Object.keys(LABELS))
      .then(targetOf)
      .catch(() => 'opus' as const)
    routes.set(e.turnId, { target, isForced: false })
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    const route = e.agentId === undefined ? routes.get(e.turnId) : undefined
    if (route === undefined) return yield* next(e)

    const target = await route.target
    if (e.index === 0 && !route.isForced) await bump($, target)

    // A classified turn only ever moves away from Opus; a forced one goes wherever it was told.
    const isThere = target === 'opus' ? isOpus(e.model) : e.model.toLowerCase().includes(target)
    if (isThere || (!route.isForced && !isOpus(e.model))) return yield* next(e)

    if (e.index === 0) {
      $.ui.toast(
        route.isForced
          ? `Ta tura idzie na ${NAME[target]} (wymuszone)`
          : `Prosty prompt: ta tura idzie na ${NAME[target]} (!opus wymusza Opusa)`,
      )
      $.ui.status(`Ta tura: ${NAME[target]}`)
    }
    return yield* next({ ...e, model: target, effort: target === 'haiku' ? undefined : e.effort })
  })

  on('turn.complete', ($, e, next) => {
    if (routes.delete(e.turnId)) $.ui.status(undefined)
    return next(e)
  })
}
