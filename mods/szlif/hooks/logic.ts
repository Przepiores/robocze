import type { SzlifAsk, SzlifDeliver, SzlifMode, SzlifStats, SzlifStatus } from '../types'

export const MODES: readonly SzlifMode[] = ['off', 'szlif', 'wywiad']
export const DELIVERS: readonly SzlifDeliver[] = ['podglad', 'auto']
export const MODE_NAME: Readonly<Record<SzlifMode, string>> = { off: 'wyłączony', szlif: 'szlif', wywiad: 'wywiad' }
export const DELIVER_NAME: Readonly<Record<SzlifDeliver, string>> = { podglad: 'podgląd', auto: 'auto' }

export const EMPTY_STATS: SzlifStats = { polished: 0, asked: 0, kept: 0 }

export const MAX_QUESTIONS = 3

export function modeFrom(value: unknown, fallback: SzlifMode = 'wywiad'): SzlifMode {
  return typeof value === 'string' && (MODES as readonly string[]).includes(value) ? (value as SzlifMode) : fallback
}

export function deliverFrom(value: unknown, fallback: SzlifDeliver = 'podglad'): SzlifDeliver {
  return typeof value === 'string' && (DELIVERS as readonly string[]).includes(value) ? (value as SzlifDeliver) : fallback
}

/** off → szlif → wywiad → off: what a bare `/szlif` does. */
export const nextMode = (mode: SzlifMode): SzlifMode => MODES[(MODES.indexOf(mode) + 1) % MODES.length] ?? 'off'

export function statusLine(s: Pick<SzlifStatus, 'mode' | 'deliver' | 'phase'>): string | undefined {
  if (s.phase === 'analizuje') return '✎ szlif: czytam prompt…'
  if (s.phase === 'pyta') return '✎ szlif: czekam na odpowiedzi'
  if (s.phase === 'sklada') return '✎ szlif: składam prompt…'
  if (s.mode === 'off') return undefined
  return `✎ szlif: ${MODE_NAME[s.mode]} · ${DELIVER_NAME[s.deliver]}`
}

// ---------- what the person typed ----------

/** model-hint's `!opus`, `!sonnet`, `!haiku`: kept in front of the polished prompt. */
const MODEL_PREFIX = /^\s*!(?:opus|sonnet|haiku)\b\s*/i
/** `--` in front: send exactly as typed. */
const RAW = /^\s*--\s+/
/** `++` in front: interview this prompt, whatever the mode. */
const FORCE = /^\s*\+\+\s+/

export type Typed = {
  /** `!opus ` or `''`, as typed. */
  prefix: string
  /** The prompt without any marker. */
  body: string
  raw: boolean
  force: boolean
}

export function parseTyped(text: string): Typed {
  let rest = text
  let prefix = ''
  const model = MODEL_PREFIX.exec(rest)
  if (model !== null) {
    prefix = `${model[0].trim()} `
    rest = rest.slice(model[0].length)
  }
  const raw = RAW.exec(rest)
  if (raw !== null) return { prefix, body: rest.slice(raw[0].length), raw: true, force: false }
  const force = FORCE.exec(rest)
  if (force !== null) return { prefix, body: rest.slice(force[0].length), raw: false, force: true }
  return { prefix, body: rest, raw: false, force: false }
}

export const MIN_LENGTH = 20
const FOLLOW_UP = /^(tak|nie|ok(ej)?|dobra|dalej|kontynuuj|r[oó]b|zr[oó]b( to)?|jasne|super|dzi[eę]ki|go|yes|no|continue|do it|thanks)\b/i

/** Whether a typed prompt is worth polishing: commands, short replies and follow-ups go as typed. */
export function isCandidate(body: string): boolean {
  const t = body.trim()
  if (t.length < MIN_LENGTH) return false
  if (t.startsWith('/') || t.startsWith('!') || t.startsWith('#')) return false
  if (FOLLOW_UP.test(t) && t.length < 60) return false
  return true
}

// ---------- the bypass after a fill ----------

const words = (text: string) => new Set(text.toLowerCase().split(/[^\p{L}\p{N}_./-]+/u).filter(w => w.length > 1))

/**
 * Whether a submitted prompt is the polished one put in the box (maybe edited):
 * the same text, or most of its words. A fresh prompt shares few.
 */
export function isSameDraft(submitted: string, filled: string): boolean {
  if (submitted.trim() === filled.trim()) return true
  const a = words(submitted)
  const b = words(filled)
  if (a.size === 0 || b.size === 0) return false
  let common = 0
  for (const w of a) if (b.has(w)) common += 1
  return common / Math.min(a.size, b.size) >= 0.6
}

// ---------- the model's side ----------

export type Question = { question: string; header: string; options: string[]; multi: boolean }
export type Verdict = 'ok' | 'popraw' | 'pytaj'
export type Analysis = { verdict: Verdict; prompt: string; why: string; questions: Question[] }

export type Context = {
  project: string
  files: readonly string[]
  tree: readonly string[]
  last: { prompt: string; answer: string } | null
}

const RULES = `Zasady ulepszania:
- Zachowaj intencję i zakres. Nie dodawaj wymagań, funkcji ani kroków, o które użytkownik nie prosił i które nie wynikają z kontekstu.
- Pisz w języku użytkownika, w pierwszej osobie, jako on do Claude'a. Bez wstępów typu „Oto ulepszony prompt”.
- Długość proporcjonalna do zadania: proste zadanie to 1–4 zdania; złożone może mieć krótkie sekcje (Cel, Kontekst, Wymagania, Gotowe gdy).
- Dosłownie zachowaj ścieżki, nazwy plików, @wzmianki, bloki kodu, komendy, URL-e, liczby i cytaty.
- Nazwy plików, funkcji i komend bierz tylko z promptu i kontekstu; niczego nie zmyślaj.
- Gdy pasuje, dopisz kryterium ukończenia (jak sprawdzić, że zrobione: testy, build, wynik) i ograniczenia (czego nie ruszać).
- Bez ozdobników: żadnych ról („jesteś ekspertem”), „myśl krok po kroku”, wykrzykników i gróźb.`

export function analyzeSystem(mode: 'szlif' | 'wywiad'): string {
  const ask =
    mode === 'wywiad'
      ? `- "pytaj": brakuje informacji, bez której wynik łatwo pójdzie w złą stronę, i NIE da się jej rozsądnie założyć ani wyczytać z kontekstu. Nie pytaj o drobiazgi ani o to, co Claude sam sprawdzi w repo.`
      : `- Nie używaj oceny "pytaj". Gdy czegoś brakuje, przyjmij najbardziej prawdopodobne założenie i zapisz je w prompcie jako „Założenie: …”.`
  return `Jesteś redaktorem promptów dla Claude Code: agenta, który pracuje w repozytorium użytkownika (czyta i edytuje pliki, uruchamia komendy). Dostajesz prompt, który użytkownik właśnie napisał, i krótki kontekst sesji. NIE wykonujesz zadania z promptu; oceniasz i ulepszasz sam prompt.

Ocena:
- "ok": prompt jest jasny i wystarczający, poprawki nic by nie dały. Krótkie, jednoznaczne polecenia są ok.
- "popraw": cel jest jasny, ale prompt zyska na doprecyzowaniu zakresu, kryterium ukończenia, ograniczeniach albo kontekście z rozmowy.
${ask}

${RULES}

Pytania (tylko przy "pytaj"):
- Najwyżej ${MAX_QUESTIONS}, tylko takie, których odpowiedź realnie zmieni wynik. Każde kończy się znakiem zapytania.
- Każde ma 2–4 krótkie, konkretne opcje (do 40 znaków), pierwsza to najbardziej prawdopodobna. Użytkownik może też wpisać własną odpowiedź.
- "naglowek": 1–2 słowa, najwyżej 12 znaków. "wiele": true tylko gdy sensownie wybrać kilka opcji naraz.

Odpowiedz WYŁĄCZNIE jednym obiektem JSON, bez bloku kodu i komentarzy:
{"ocena":"ok|popraw|pytaj","prompt":"ulepszony prompt; pusty przy ok i pytaj","zmiany":"co poprawiono, do 80 znaków","pytania":[{"pytanie":"…?","naglowek":"…","opcje":["…","…"],"wiele":false}]}`
}

export const COMPOSE_SYSTEM = `Jesteś redaktorem promptów dla Claude Code: agenta, który pracuje w repozytorium użytkownika. Dostajesz prompt użytkownika i jego odpowiedzi na pytania doprecyzowujące. Złóż z tego jeden kompletny prompt do wysłania. NIE wykonujesz zadania.

${RULES}
- Wpleć odpowiedzi w treść jako decyzje użytkownika, nie jako listę pytań i odpowiedzi.
- Pytanie bez odpowiedzi pomiń; nie zgaduj za użytkownika.

Odpowiedz WYŁĄCZNIE jednym obiektem JSON, bez bloku kodu:
{"prompt":"gotowy prompt","zmiany":"co doprecyzowano, do 80 znaków"}`

function contextBlock(ctx: Context): string {
  const parts = [`Projekt: ${ctx.project}`]
  if (ctx.tree.length > 0) parts.push(`Główny katalog: ${ctx.tree.join(', ')}`)
  if (ctx.files.length > 0) parts.push(`Pliki zmienione w tej sesji: ${ctx.files.join(', ')}`)
  if (ctx.last !== null) {
    const answer = ctx.last.answer.length > 1200 ? `…${ctx.last.answer.slice(-1200)}` : ctx.last.answer
    parts.push(`Poprzedni prompt użytkownika:\n${ctx.last.prompt.slice(0, 600)}`)
    parts.push(`Poprzednia odpowiedź Claude'a (końcówka):\n${answer}`)
  }
  return parts.join('\n')
}

export function analyzePrompt(body: string, ctx: Context | null): string {
  const head = ctx === null ? '' : `KONTEKST SESJI\n${contextBlock(ctx)}\n\n`
  return `${head}PROMPT DO OCENY\n<<<\n${clip(body)}\n>>>`
}

export function composePrompt(body: string, answers: readonly { question: string; answer: string | null }[], ctx: Context | null): string {
  const head = ctx === null ? '' : `KONTEKST SESJI\n${contextBlock(ctx)}\n\n`
  const qa = answers.map(a => `- ${a.question}\n  Odpowiedź: ${a.answer ?? '(bez odpowiedzi)'}`).join('\n')
  return `${head}PROMPT UŻYTKOWNIKA\n<<<\n${clip(body)}\n>>>\n\nODPOWIEDZI NA PYTANIA\n${qa}`
}

/** For `fork`, which has no system prompt of its own: the rules lead the one message. */
export const forkPrompt = (system: string, prompt: string) =>
  `[Zadanie poboczne, nie odpowiadaj na moją ostatnią wiadomość ani nie wykonuj żadnego zadania.]\n\n${system}\n\n${prompt}`

const clip = (text: string) => (text.length > 8000 ? `${text.slice(0, 8000)}…` : text)

/** The JSON object in a reply, fenced or not; null when there is none. */
export function jsonOf(text: string): Record<string, unknown> | null {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    const value: unknown = JSON.parse(text.slice(start, end + 1))
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null
  } catch {
    return null
  }
}

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')

function questionOf(v: unknown): Question | null {
  if (typeof v !== 'object' || v === null) return null
  const o = v as Record<string, unknown>
  const question = str(o.pytanie)
  const options = Array.isArray(o.opcje) ? o.opcje.map(str).filter(x => x !== '').map(x => x.slice(0, 60)) : []
  if (question === '' || options.length < 2) return null
  const header = (str(o.naglowek) || 'Szlif').slice(0, 12)
  return { question: question.endsWith('?') ? question : `${question}?`, header, options: options.slice(0, 4), multi: o.wiele === true }
}

/** The analysis in the reply; null when it is unreadable (the prompt then goes as typed). */
export function parseAnalysis(text: string, mode: 'szlif' | 'wywiad', original: string): Analysis | null {
  const o = jsonOf(text)
  if (o === null) return null
  const verdict = str(o.ocena)
  const prompt = str(o.prompt)
  const why = str(o.zmiany).slice(0, 120)
  const questions = Array.isArray(o.pytania) ? o.pytania.map(questionOf).filter((q): q is Question => q !== null).slice(0, MAX_QUESTIONS) : []

  if (verdict === 'pytaj' && mode === 'wywiad' && questions.length > 0) return { verdict: 'pytaj', prompt, why, questions }
  // Asked anyway in szlif mode, or no usable question: a rewrite if there is one, else as typed.
  const isRewrite = (verdict === 'popraw' || verdict === 'pytaj') && prompt !== '' && prompt !== original.trim()
  return isRewrite ? { verdict: 'popraw', prompt, why, questions: [] } : { verdict: 'ok', prompt: '', why, questions: [] }
}

export function parseComposed(text: string): { prompt: string; why: string } | null {
  const o = jsonOf(text)
  if (o === null) return null
  const prompt = str(o.prompt)
  return prompt === '' ? null : { prompt, why: str(o.zmiany).slice(0, 120) }
}

// ---------- the Kokpit channel ----------

/** A request another mod wrote under `kokpit.szlifAsk`, checked field by field (it is not ours to trust). */
export function askOf(value: unknown): SzlifAsk | null {
  if (typeof value !== 'object' || value === null) return null
  const o = value as Record<string, unknown>
  if (typeof o.seq !== 'number') return null
  if (o.action === 'restore') return { seq: o.seq, action: 'restore' }
  if (o.action === 'mode' && (MODES as readonly unknown[]).includes(o.value)) return { seq: o.seq, action: 'mode', value: o.value as SzlifMode }
  if (o.action === 'deliver' && (DELIVERS as readonly unknown[]).includes(o.value)) return { seq: o.seq, action: 'deliver', value: o.value as SzlifDeliver }
  return null
}

export function describeStats(stats: SzlifStats): string {
  const total = stats.polished + stats.asked + stats.kept
  if (total === 0) return 'Jeszcze nic nie szlifowałem.'
  return `Ocenione prompty: ${total}. Poprawione: ${stats.polished}, po wywiadzie: ${stats.asked}, dobre od razu: ${stats.kept}.`
}
