import type { KokpitActivity, KokpitLimit, KokpitPlace, KokpitPlaceName } from '../types'

export const PANE = 'kokpit'
export const MAX_CALLS = 8
export const MAX_FILES = 6
export const DEFAULT_EVERY = 3

export const EMPTY_ACTIVITY: KokpitActivity = { turn: 0, isRunning: false, steps: 0, calls: [], agents: [], files: [] }
export const EMPTY_PLACE: KokpitPlace = { verdict: null, suggestion: null, isDismissed: false, why: '', isBusy: false, transfer: null }

// ---------- activity ----------

/** The last two path segments, so a label fits a narrow pane. */
export function shortPath(path: string): string {
  const parts = path.split(/[\\/]+/).filter(Boolean)
  return parts.slice(-2).join('/')
}

/** What a tool call works on, read from its input: a file, a command, a pattern, a task. */
export function labelFor(input: Readonly<Record<string, unknown>>): string {
  const pick = (key: string) => (typeof input[key] === 'string' ? (input[key] as string) : undefined)
  const file = pick('file_path') ?? pick('notebook_path') ?? pick('path')
  if (file !== undefined) return shortPath(file)
  const text = pick('command') ?? pick('pattern') ?? pick('description') ?? pick('url') ?? pick('query') ?? pick('prompt') ?? ''
  const line = text.split('\n')[0] ?? ''
  return line.length > 40 ? `${line.slice(0, 39)}…` : line
}

export const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])

/** Records an edit: the file moves to the front with its count raised. */
export function withEdit(files: KokpitActivity['files'], path: string): KokpitActivity['files'] {
  const short = shortPath(path)
  const found = files.find(f => f.path === short)
  const rest = files.filter(f => f.path !== short)
  return [{ path: short, edits: (found?.edits ?? 0) + 1 }, ...rest].slice(0, MAX_FILES)
}

export function duration(ms: number): string {
  if (ms < 1000) return `${ms} ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`
  const s = Math.round(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

// ---------- session ----------

const LIMIT_NAMES: Readonly<Record<string, string>> = {
  five_hour: 'Limit 5h',
  seven_day: 'Limit 7 dni',
  seven_day_opus: 'Limit 7 dni (Opus)',
  seven_day_sonnet: 'Limit 7 dni (Sonnet)',
}

const pad = (n: number) => String(n).padStart(2, '0')

/** `23:40` today, `07.10 09:00` on another day; null when unreadable. */
export function resetLabel(iso: string | undefined, now: number): string | null {
  if (iso === undefined) return null
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return null
  const today = new Date(now)
  const time = `${pad(at.getHours())}:${pad(at.getMinutes())}`
  const isSameDay = at.getFullYear() === today.getFullYear() && at.getMonth() === today.getMonth() && at.getDate() === today.getDate()
  return isSameDay ? time : `${pad(at.getDate())}.${pad(at.getMonth() + 1)} ${time}`
}

export function limitsFrom(rateLimits: readonly { kind: string; percentUsed: number; resetsAt?: string }[], now: number): KokpitLimit[] {
  return rateLimits.map(r => ({
    label: LIMIT_NAMES[r.kind] ?? r.kind,
    percent: Math.round(r.percentUsed),
    resets: resetLabel(r.resetsAt, now),
  }))
}

export function colorFor(percent: number): 'green' | 'yellow' | 'red' {
  if (percent >= 85) return 'red'
  if (percent >= 60) return 'yellow'
  return 'green'
}

export const k = (n: number) => `${Math.round(n / 1000)}k`

// ---------- place: Code, Cowork or Chat ----------

/** Labels the classifier picks from; it sees nothing but these and the text. */
export const PLACE_LABELS: Readonly<Record<string, KokpitPlaceName>> = {
  'code: work inside a code repository: editing source files, running tests or builds, git, debugging, Claude Code plugins and mods': 'code',
  'cowork: office and desktop work: Word, Excel or PowerPoint documents, research reports, organizing files on disk, email, calendar, Google Drive, recurring tasks, dashboards': 'cowork',
  'chat: conversation without files or tools: questions and explanations, learning or studying, brainstorming, opinions, short texts': 'chat',
}

export const PLACE_NAME: Readonly<Record<KokpitPlaceName, string>> = { code: 'Code', cowork: 'Cowork', chat: 'Chat' }

export const placeOf = (label: string | undefined): KokpitPlaceName | null =>
  label === undefined ? null : PLACE_LABELS[label] ?? null

/** One finished turn, as the place advisor remembers it. */
export type TurnSignal = { prompt: string; tools: number; edits: number }

const OFFICE = /\b(docx?|xlsx?|pptx?|word|excel|powerpoint|prezentacj\w*|arkusz\w*|raport\w*|maila?|e-?mail\w*|kalendarz\w*|gmail|drive|dysku?)\b/i

/** A prompt that asks for office work: checked at once, without waiting for the next round. */
export const isOfficeAsk = (prompt: string) => OFFICE.test(prompt)

/** Three answered turns in a row without a single tool: a conversation, not work in the repo. */
export function isChatty(turns: readonly TurnSignal[]): boolean {
  const last = turns.slice(-3)
  return last.length === 3 && last.every(t => t.tools === 0)
}

/** What the classifier reads: the last prompts and how much the turns used tools. */
export function classifierText(turns: readonly TurnSignal[]): string {
  const last = turns.slice(-4)
  const prompts = last.map(t => `- ${t.prompt.slice(0, 300)}`).join('\n')
  const tools = last.reduce((n, t) => n + t.tools, 0)
  const edits = last.reduce((n, t) => n + t.edits, 0)
  const usage = tools === 0 ? 'no tools at all' : `${tools} tool calls, ${edits} of them file edits`
  return `Recent user prompts in a Claude Code session:\n${prompts}\n\nIn these turns the assistant used ${usage}.`
}

/** Folds a new verdict into the place: a suggestion needs two verdicts in a row for the same other place. */
export function decide(place: KokpitPlace, previous: KokpitPlaceName | null, verdict: KokpitPlaceName): KokpitPlace {
  const why = WHY[verdict]
  if (verdict === 'code') return { ...place, verdict, suggestion: null, isDismissed: false, why }
  const isConfirmed = previous === verdict
  const suggestion = isConfirmed ? verdict : place.suggestion === verdict ? verdict : null
  const isDismissed = place.isDismissed && place.suggestion === suggestion
  return { ...place, verdict, suggestion, isDismissed, why }
}

const WHY: Readonly<Record<KokpitPlaceName, string>> = {
  code: 'praca w repo: kod, testy, git',
  cowork: 'dokumenty, research, pliki, poczta: Cowork zrobi z tego plik lub dokument',
  chat: 'rozmowa bez plików i narzędzi: w chacie taniej i wygodniej',
}

/** What the model is asked for when the person moves the conversation. */
export function transferPrompt(to: 'cowork' | 'chat'): string {
  const where = to === 'cowork' ? 'Claude Cowork (aplikacja desktopowa, praca na plikach, dokumentach i połączonych aplikacjach)' : 'zwykłym czacie claude.ai'
  return `Przenoszę tę rozmowę do ${where}. Napisz wiadomość startową, którą wkleję tam jako pierwszy prompt, tak żeby nowa rozmowa ruszyła bez czytania tej.

Zasady:
- Po polsku, w pierwszej osobie, jako ja (użytkownik) piszący do Claude'a. Bez wstępu od siebie, tylko gotowy tekst wiadomości.
- Zawrzyj: cel, co już ustaliliśmy lub zrobiliśmy, potrzebny kontekst (nazwy plików, ścieżki, liczby, decyzje) i czego konkretnie chcę teraz.
- ${to === 'cowork' ? 'Wymień pliki, które warto podłączyć lub dołączyć w Coworku.' : 'Pomiń szczegóły narzędzi i repo, które w czacie nie będą potrzebne.'}
- Maksymalnie około 250 słów.`
}
