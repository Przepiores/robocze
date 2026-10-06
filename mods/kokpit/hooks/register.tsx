import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderSurface } from 'claude-code'

import type { KokpitActivity, KokpitCall, KokpitPlace, KokpitSession } from '../types'
import {
  DEFAULT_EVERY,
  EDIT_TOOLS,
  EMPTY_ACTIVITY,
  EMPTY_PLACE,
  MAX_CALLS,
  PANE,
  PLACE_LABELS,
  PLACE_NAME,
  classifierText,
  colorFor,
  decide,
  duration,
  isChatty,
  isOfficeAsk,
  k,
  labelFor,
  limitsFrom,
  placeOf,
  transferPrompt,
  withEdit,
} from './logic'
import type { TurnSignal } from './logic'

const activity = atom({ plugin: 'kokpit', key: 'activity' } as const, EMPTY_ACTIVITY as KokpitActivity)
const session = atom({ plugin: 'kokpit', key: 'session' } as const, null as KokpitSession | null)
const place = atom({ plugin: 'kokpit', key: 'place' } as const, EMPTY_PLACE as KokpitPlace)

const pad = (n: number) => String(n).padStart(2, '0')
const stamp = (ms: number) => {
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`
}

/** What the place advisor remembers of the session (module memory: a reload starts it over). */
type Memory = {
  typed: string | null
  current: TurnSignal | null
  turns: TurnSignal[]
  sinceCheck: number
  toastedFor: string | null
}

/** Asks the small model where this conversation belongs and folds the answer into the pane. */
async function checkPlace($: EngineInterface, mem: Memory): Promise<KokpitPlace | null> {
  if (mem.turns.length === 0) return null
  mem.sinceCheck = 0
  let label: string | undefined
  try {
    label = await $.model.classify(classifierText(mem.turns), Object.keys(PLACE_LABELS))
  } catch (err) {
    $.ui.log(`kokpit: ocena miejsca nie wyszła (${String(err)})`, { to: 'debug' })
    return null
  }
  const verdict = placeOf(label)
  if (verdict === null) return null

  const before = await read($, place)
  const after = decide(before, before.verdict, verdict)
  await update($, place, () => after)

  if (after.suggestion !== null && !after.isDismissed && mem.toastedFor !== after.suggestion) {
    mem.toastedFor = after.suggestion
    $.ui.toast(`Ta rozmowa pasuje bardziej do: ${PLACE_NAME[after.suggestion]}. Kokpit ma przycisk „Przenieś”.`, { timeoutMs: 8000 })
  }
  if (after.suggestion === null) mem.toastedFor = null
  return after
}

/** Writes a starting message for the other place and puts it on the clipboard, or in a file when that fails. */
async function transfer($: EngineInterface, to: 'cowork' | 'chat', surface: RenderSurface | undefined) {
  await update($, place, p => ({ ...p, isBusy: true, transfer: null }))
  try {
    const reply = await $.model.fork({ prompt: transferPrompt(to) })
    if (!reply.isAnswered) {
      await update($, place, p => ({ ...p, isBusy: false, transfer: `Nie udało się napisać wiadomości (${reply.reason}).` }))
      return
    }
    const copied = await $.ui.copy({ text: reply.text, surface })
    let where: string
    if (copied.isCopied) {
      where = `Wiadomość startowa jest w schowku: wklej ją w ${PLACE_NAME[to]}.`
    } else {
      const rel = `.claude/handoffs/przeniesienie-${stamp(await $.clock.now())}.md`
      const root = (await $.session.root()).replace(/[\\/]+$/, '')
      await $.fs.write(`${root}/${rel}`, reply.text)
      where = `Schowek niedostępny, wiadomość zapisana w ${rel}.`
    }
    await update($, place, p => ({ ...p, isBusy: false, transfer: where }))
    $.ui.toast(where, { timeoutMs: 8000 })
  } catch (err) {
    await update($, place, p => ({ ...p, isBusy: false, transfer: `Błąd przenoszenia: ${String(err)}` }))
  }
}

export const register: Register = (on, options) => {
  const isPlaceOn = options.placeEnabled !== false
  const every = Math.max(1, Math.round(typeof options.placeEvery === 'number' ? options.placeEvery : DEFAULT_EVERY))

  // What the place advisor remembers of the session; a reload starts it over, which only delays the next verdict.
  const mem: Memory = { typed: null, current: null, turns: [], sinceCheck: 0, toastedFor: null }

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'kokpit', description: 'Otwórz panel Kokpit' })
    if (isPlaceOn) {
      await $.command.register({ name: 'gdzie', description: 'Oceń od razu, czy ta rozmowa pasuje do Code, Coworka czy chatu' })
    }
    // Unasked, the pane seats from 144 columns and waits below that; /kokpit opens it at any width.
    void $.ui.open({ id: PANE, title: 'Kokpit' })
    return next(e)
  })

  on('command.run', { command: 'kokpit' }, async $ => {
    const opened = await $.ui.open({ id: PANE, title: 'Kokpit' })
    return { text: opened.isPlaced ? 'Kokpit otwarty.' : 'Kokpit czeka na miejsce: poszerz okno terminala.' }
  })

  on('command.run', { command: 'gdzie' }, async $ => {
    const result = await checkPlace($, mem)
    void $.ui.open({ id: PANE, title: 'Kokpit' })
    if (result === null || result.verdict === null) return { text: 'Za mało rozmowy do oceny albo klasyfikator nie odpowiedział.' }
    const tip = result.suggestion === null ? '' : ` Sugestia: przenieś do ${PLACE_NAME[result.suggestion]} (przycisk w Kokpicie).`
    return { text: `Miejsce: ${PLACE_NAME[result.verdict]}, ${result.why}.${tip}` }
  })

  on('prompt.submit', ($, e, next) => {
    mem.typed = e.origin.kind === 'composer' && !e.text.trimStart().startsWith('/') ? e.text : null
    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.start', async ($, e, next) => {
    mem.current = mem.typed === null ? null : { prompt: mem.typed, tools: 0, edits: 0 }
    mem.typed = null
    await update($, activity, a => ({ ...a, turn: a.turn + 1, isRunning: true, steps: 0, calls: [], agents: [] }))
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    if (e.agentId === undefined) await update($, activity, a => ({ ...a, steps: e.index + 1 }))
    return yield* next(e)
  })

  on('tool.call', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)

    const input = e as unknown as Readonly<Record<string, unknown>>
    const call: KokpitCall = { id: e.tool_use_id, tool: String(e.tool), label: labelFor(input), ms: null, isError: false }
    const agent = String(e.tool) === 'Agent' ? call.label || 'subagent' : null
    const file = typeof input.file_path === 'string' ? input.file_path : typeof input.notebook_path === 'string' ? input.notebook_path : null
    const isEdit = EDIT_TOOLS.has(String(e.tool))

    if (mem.current !== null) {
      mem.current.tools += 1
      if (isEdit) mem.current.edits += 1
    }
    const startedAt = await $.clock.now()
    await update($, activity, a => ({
      ...a,
      calls: [...a.calls, call].slice(-MAX_CALLS),
      agents: agent === null ? a.agents : [...a.agents, agent],
    }))

    const ran = await next(e)

    const ms = (await $.clock.now()) - startedAt
    const isError = ran.deny !== undefined || ran.isError === true
    await update($, activity, a => ({
      ...a,
      calls: a.calls.map(c => (c.id === call.id ? { ...c, ms, isError } : c)),
      agents: agent === null ? a.agents : a.agents.filter((x, i) => i !== a.agents.indexOf(agent)),
      files: isEdit && file !== null && !isError ? withEdit(a.files, file) : a.files,
    }))
    return ran
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)
    await update($, activity, a => ({ ...a, isRunning: false, agents: [] }))

    if (mem.current !== null) {
      mem.turns = [...mem.turns, mem.current].slice(-6)
      mem.sinceCheck += 1
      const { verdict, suggestion } = await read($, place)
      // A first vote for another place is confirmed on the very next turn rather than a full round later.
      const isUnconfirmed = verdict !== null && verdict !== 'code' && suggestion !== verdict
      const isDue = mem.sinceCheck >= every || isUnconfirmed || isOfficeAsk(mem.current.prompt) || (isChatty(mem.turns) && verdict !== 'chat')
      mem.current = null
      // Outside this dispatch: the turn ends now, the verdict arrives a moment later.
      if (isPlaceOn && isDue) $.clock.after(0, () => void checkPlace($, mem))
    }
    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    const now = await $.clock.now()
    const value: KokpitSession = {
      percent: e.context.percent ?? null,
      tokens: e.context.tokens ?? null,
      window: e.context.window,
      usd: e.cost?.usd ?? null,
      limits: limitsFrom(e.rateLimits, now),
    }
    await update($, session, () => value)
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: 'kokpit' }, async ($, e) => {
    const { Box, Text, Button, Link } = $.ui.resolve(e)
    const a = await read($, activity)
    const s = await read($, session)
    const p = await read($, place)

    const status = a.isRunning
      ? <Text color="yellow">● pracuje · tura {a.turn} · krok {a.steps}</Text>
      : a.turn === 0
        ? <Text dimColor>czeka na pierwszy prompt</Text>
        : <Text color="green">✓ tura {a.turn} zakończona</Text>

    const suggestion = p.suggestion
    const showMove = suggestion !== null && !p.isDismissed

    return (
      <Box flexDirection="column">
        <Text bold>TERAZ</Text>
        {status}
        {a.calls.map(c => (
          <Text key={`call:${c.id}`} wrap="truncate-end" dimColor={c.ms !== null && !c.isError} color={c.isError ? 'red' : undefined}>
            {c.ms === null ? '●' : c.isError ? '✗' : '✓'} {c.tool} {c.label}{c.ms === null ? '' : `  ${duration(c.ms)}`}
          </Text>
        ))}
        {a.agents.map((name, i) => <Text key={`agent:${i}`} wrap="truncate-end" color="cyan">↳ {name}</Text>)}
        {a.files.length > 0 && <Text dimColor>Pliki w sesji:</Text>}
        {a.files.map(f => <Text key={`file:${f.path}`} wrap="truncate-end"> {f.path} ×{f.edits}</Text>)}

        <Text> </Text>
        <Text bold>SESJA</Text>
        {s === null && <Text dimColor>dane po pierwszej odpowiedzi</Text>}
        {s !== null && s.percent !== null && (
          <Text>
            Kontekst <Text color={colorFor(s.percent)}>{s.percent}%</Text>
            <Text dimColor> ({k(s.tokens ?? 0)} / {k(s.window)})</Text>
          </Text>
        )}
        {s !== null && s.usd !== null && <Text dimColor>Koszt sesji ${s.usd.toFixed(2)}</Text>}
        {s?.limits.map(l => (
          <Text key={`limit:${l.label}`} wrap="truncate-end">
            {l.label}: <Text color={colorFor(l.percent)}>{l.percent}%</Text>
            {l.resets === null ? '' : <Text dimColor> · reset {l.resets}</Text>}
          </Text>
        ))}

        {isPlaceOn && <Text> </Text>}
        {isPlaceOn && <Text bold>MIEJSCE</Text>}
        {isPlaceOn && p.verdict === null && <Text dimColor>ocena po kilku turach (/gdzie od razu)</Text>}
        {isPlaceOn && p.verdict !== null && (
          <Text>
            Ocena: <Text bold color={p.verdict === 'code' ? 'green' : 'yellow'}>{PLACE_NAME[p.verdict]}</Text>
          </Text>
        )}
        {isPlaceOn && p.verdict !== null && <Text dimColor wrap="wrap">{p.why}</Text>}
        {isPlaceOn && showMove && <Text color="yellow">Lepiej prowadzić w: {PLACE_NAME[suggestion]}</Text>}
        {isPlaceOn && showMove && !p.isBusy && (
          <Button
            key="move"
            label={`Przenieś do ${PLACE_NAME[suggestion]}`}
            onPress={press => void $.clock.after(0, () => void transfer($, suggestion, press.surface))}
          />
        )}
        {isPlaceOn && showMove && !p.isBusy && (
          <Button key="stay" label="Zostaję w Code" onPress={() => update($, place, x => ({ ...x, isDismissed: true }))} />
        )}
        {isPlaceOn && p.isBusy && <Text color="yellow">Piszę wiadomość startową…</Text>}
        {isPlaceOn && p.transfer !== null && <Text dimColor wrap="wrap">{p.transfer}</Text>}
        {isPlaceOn && showMove && suggestion === 'chat' && <Link key="claude" href="https://claude.ai/new" label="Otwórz claude.ai" />}
        {isPlaceOn && !p.isBusy && (
          <Button key="check" label="Sprawdź teraz" plain onPress={() => void $.clock.after(0, () => void checkPlace($, mem))} />
        )}
      </Box>
    )
  })
}
