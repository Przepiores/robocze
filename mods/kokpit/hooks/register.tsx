import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderSurface } from 'claude-code'

import type { KokpitActivity, KokpitCall, KokpitNext, KokpitPlace, KokpitRecent, KokpitSession } from '../types'
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
import { NEXT_SYSTEM, nextPrompt, parseSuggestions } from './next'
import { dirOf, parseHandoff, pickSessions, projectSlug, sessionLine, sessionTitle } from './recent'

const activity = atom({ plugin: 'kokpit', key: 'activity' } as const, EMPTY_ACTIVITY as KokpitActivity)
const session = atom({ plugin: 'kokpit', key: 'session' } as const, null as KokpitSession | null)
const place = atom({ plugin: 'kokpit', key: 'place' } as const, EMPTY_PLACE as KokpitPlace)
const nextUp = atom({ plugin: 'kokpit', key: 'next' } as const, { items: [], isBusy: false } as KokpitNext)
const recent = atom({ plugin: 'kokpit', key: 'recent' } as const, { handoff: null, sessions: [], commits: [] } as KokpitRecent)

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
  /** The last answered exchange, for "Co dalej?". */
  last: { prompt: string; answer: string } | null
  /** Where this project's transcripts live, from the SessionStart envelope. */
  transcripts: string | null
}

/** Asks the small model for three next prompts after the last answer. */
async function refreshNext($: EngineInterface, mem: Memory) {
  if (mem.last === null) return
  await update($, nextUp, n => ({ ...n, isBusy: true }))
  try {
    const { handoff } = await read($, recent)
    const { files } = await read($, activity)
    const reply = await $.model.complete({
      model: 'haiku',
      system: NEXT_SYSTEM,
      prompt: nextPrompt({ ...mem.last, files: files.map(f => f.path), handoffNext: handoff?.next ?? [] }),
      maxTokens: 300,
      timeoutMs: 20_000,
    })
    const items = reply.isAnswered ? parseSuggestions(reply.text) : []
    await update($, nextUp, n => ({ items: items.length > 0 ? items : n.items, isBusy: false }))
  } catch (err) {
    $.ui.log(`kokpit: propozycje nie wyszły (${String(err)})`, { to: 'debug' })
    await update($, nextUp, n => ({ ...n, isBusy: false }))
  }
}

/** Reads the project's latest handoff, recent commits and, with `withSessions`, earlier sessions. */
async function refreshRecent($: EngineInterface, mem: Memory, withSessions: boolean) {
  const now = await $.clock.now()
  const root = (await $.session.root()).replace(/[\\/]+$/, '')
  const value: Partial<KokpitRecent> = {}

  try {
    const latest = `${root}/.claude/handoffs/LATEST.md`
    if (await $.fs.exists(latest)) {
      const { mtimeMs } = await $.fs.stat(latest)
      value.handoff = parseHandoff(await $.fs.read(latest), mtimeMs, now)
    } else {
      value.handoff = null
    }
  } catch (err) {
    $.ui.log(`kokpit: handoff nieczytelny (${String(err)})`, { to: 'debug' })
  }

  try {
    const log = await $.process.run(['git', 'log', '-3', '--format=%h %s'], { cwd: root, timeoutMs: 5000 })
    value.commits = log.exitCode === 0 ? log.stdout.split(/\r?\n/).filter(l => l.trim() !== '') : []
  } catch {
    value.commits = []
  }

  if (withSessions) {
    try {
      const dir = mem.transcripts ?? (await transcriptsDir($, root))
      if (dir !== null) {
        const id = await $.session.id()
        const picked = pickSessions(await $.fs.list(dir), id)
        const lines = []
        for (const entry of picked) {
          let title: string | null = null
          try {
            title = sessionTitle(await $.fs.read(`${dir}/${entry.name}`))
          } catch {
            // Over 4 MiB or unreadable: listed without a title.
          }
          lines.push(sessionLine(title, entry.mtimeMs, now))
        }
        value.sessions = lines
      }
    } catch (err) {
      $.ui.log(`kokpit: lista sesji nie wyszła (${String(err)})`, { to: 'debug' })
    }
  }

  await update($, recent, r => ({ ...r, ...value }))
}

/** ~/.claude/projects/<slug> when the SessionStart envelope did not say where transcripts go. */
async function transcriptsDir($: EngineInterface, root: string): Promise<string | null> {
  const config = (await $.env.get('CLAUDE_CONFIG_DIR')) ?? `${(await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? ''}/.claude`
  const dir = `${config.replace(/[\\/]+$/, '')}/projects/${projectSlug(root)}`
  return (await $.fs.exists(dir)) ? dir : null
}

/** Loads the latest handoff into the conversation: through /handoff load when that mod is here, else as a prompt to send. */
async function loadHandoff($: EngineInterface) {
  const commands = await $.command.list()
  if (commands.some(c => c.name === 'handoff')) {
    const out = await $.command.run({ command: 'handoff', args: 'load' })
    $.ui.toast(out.text ?? 'Handoff wczytany.')
  } else {
    await $.prompt.fill({ text: 'Przeczytaj .claude/handoffs/LATEST.md i kontynuuj od „Następnych kroków”.', mode: 'replace' })
  }
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
  const mem: Memory = { typed: null, current: null, turns: [], sinceCheck: 0, toastedFor: null, last: null, transcripts: null }
  const isNextOn = options.nextEnabled !== false

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'kokpit', description: 'Otwórz panel Kokpit' })
    if (isPlaceOn) {
      await $.command.register({ name: 'gdzie', description: 'Oceń od razu, czy ta rozmowa pasuje do Code, Coworka czy chatu' })
    }
    // Unasked, the pane seats from 144 columns and waits below that; /kokpit opens it at any width.
    void $.ui.open({ id: PANE, title: 'Kokpit' })
    $.clock.after(0, () => void refreshRecent($, mem, true))
    return next(e)
  })

  // The settings hooks' SessionStart envelope says where this session's transcript lives: its folder holds the project's sessions.
  on('classic.SessionStart', ($, e, next) => {
    if (typeof e.transcript_path === 'string' && e.transcript_path !== '' && mem.transcripts === null) {
      mem.transcripts = dirOf(e.transcript_path)
      $.clock.after(0, () => void refreshRecent($, mem, true))
    }
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

    if (mem.current !== null && !e.isAborted && e.answer.trim() !== '') {
      mem.last = { prompt: mem.current.prompt, answer: e.answer }
      if (isNextOn) $.clock.after(0, () => void refreshNext($, mem))
    }
    $.clock.after(0, () => void refreshRecent($, mem, false))

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
    const n = await read($, nextUp)
    const r = await read($, recent)
    const hasRecent = r.handoff !== null || r.sessions.length > 0 || r.commits.length > 0

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

        {isNextOn && <Text> </Text>}
        {isNextOn && <Text bold>CO DALEJ?</Text>}
        {isNextOn && n.isBusy && <Text dimColor>układam propozycje…</Text>}
        {isNextOn && !n.isBusy && n.items.length === 0 && <Text dimColor>propozycje po pierwszej odpowiedzi</Text>}
        {isNextOn && n.items.map((item, i) => (
          <Button key={`next:${i}`} label={item} onPress={() => $.prompt.fill({ text: item, mode: 'replace' })} />
        ))}
        {isNextOn && n.items.length > 0 && !n.isBusy && (
          <Button key="next:refresh" label="Inne propozycje" plain onPress={() => void $.clock.after(0, () => void refreshNext($, mem))} />
        )}

        <Text> </Text>
        <Text bold>OSTATNIO W PROJEKCIE</Text>
        {!hasRecent && <Text dimColor>brak handoffu, poprzednich sesji i commitów</Text>}
        {r.handoff !== null && <Text>Handoff z {r.handoff.when}</Text>}
        {r.handoff?.goal != null && <Text dimColor wrap="truncate-end"> Cel: {r.handoff.goal}</Text>}
        {r.handoff !== null && r.handoff.next[0] !== undefined && <Text wrap="truncate-end"> Dalej: {r.handoff.next[0]}</Text>}
        {r.handoff?.open != null && <Text color="yellow" wrap="truncate-end"> Otwarte: {r.handoff.open}</Text>}
        {r.handoff !== null && <Button key="handoff:load" label="Wczytaj handoff" onPress={() => void $.clock.after(0, () => void loadHandoff($))} />}
        {r.sessions.length > 0 && <Text dimColor>Poprzednie sesje:</Text>}
        {r.sessions.map((x, i) => <Text key={`session:${i}`} wrap="truncate-end"> {x.when} · {x.title}</Text>)}
        {r.sessions.length > 0 && <Button key="resume" label="Wróć do sesji (/resume)" plain onPress={() => $.prompt.fill({ text: '/resume', mode: 'replace' })} />}
        {r.commits.length > 0 && <Text dimColor>Ostatnie commity:</Text>}
        {r.commits.map((c, i) => <Text key={`commit:${i}`} wrap="truncate-end"> {c}</Text>)}

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
