export type Target = 'haiku' | 'sonnet' | 'opus'

/** Labels the classifier picks from: self-describing, since it sees nothing else. */
export const LABELS: Readonly<Record<string, Target>> = {
  'trivial: quick factual question, small talk, wording or formatting, a rename or one-line change': 'haiku',
  'standard: everyday coding task, explanation, single-file edit or a simple bug fix': 'sonnet',
  'complex: architecture or design, multi-file refactor, hard debugging, planning or research': 'opus',
}

export const DEFAULT_MAX_CONTEXT = 30

/** Under this many characters a prompt is usually a follow-up that leans on the running task. */
export const MIN_LENGTH = 25

const FOLLOW_UP = /^(tak|nie|ok(ej)?|dobra|dalej|kontynuuj|r[oó]b|zr[oó]b( to)?|jasne|go|yes|no|continue|do it)\b/i

/** Whether a typed prompt is worth classifying at all. */
export function isCandidate(text: string): boolean {
  const t = text.trim()
  if (t.length < MIN_LENGTH) return false
  if (t.startsWith('/') || t.startsWith('!')) return false
  if (FOLLOW_UP.test(t) && t.length < 60) return false
  return true
}

/** `!opus`, `!sonnet` or `!haiku` at the start forces that model for the turn; the prefix is removed. */
export function override(text: string): { force: Target | null; text: string } {
  const m = /^\s*!(opus|sonnet|haiku)\b\s*/i.exec(text)
  if (m === null) return { force: null, text }
  return { force: (m[1] ?? 'opus').toLowerCase() as Target, text: text.slice(m[0].length) }
}

export const isOpus = (model: string) => /opus/i.test(model)

/** The classifier's answer as a model; anything unexpected keeps Opus. */
export const targetOf = (label: string | undefined): Target => (label === undefined ? 'opus' : LABELS[label] ?? 'opus')

export function maxContextFrom(value: unknown): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : DEFAULT_MAX_CONTEXT
  return Math.min(100, Math.max(0, Math.round(n)))
}

/** Classifier input: long prompts are cut, the head says enough. */
export const clip = (text: string) => (text.length > 2000 ? `${text.slice(0, 2000)}…` : text)

export type Stats = Record<Target | 'kept', number>
export const EMPTY_STATS: Stats = { haiku: 0, sonnet: 0, opus: 0, kept: 0 }

export const NAME: Readonly<Record<Target, string>> = { haiku: 'Haiku', sonnet: 'Sonnet', opus: 'Opus' }

export function describe(stats: Stats): string {
  const routed = stats.haiku + stats.sonnet
  const total = routed + stats.opus
  if (total === 0) return 'Brak sklasyfikowanych promptów.'
  const pct = Math.round((routed / total) * 100)
  return `Sklasyfikowane: ${total}. Na tańszy model: ${routed} (${pct}%): Haiku ${stats.haiku}, Sonnet ${stats.sonnet}. Zostały na Opusie: ${stats.opus}. Pominięte przez duży kontekst: ${stats.kept}.`
}
