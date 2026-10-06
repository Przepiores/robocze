/** Default threshold (%) when userConfig has none. */
export const DEFAULT_THRESHOLD = 70

/** The warning re-arms once the fill drops this many points below the threshold (after /compact or /clear). */
export const REARM_GAP = 10

export const DIR = '.claude/handoffs'
export const GITIGNORE_LINE = '.claude/handoffs/'

export type Warning = 'warn' | 'rearm' | 'none'

/** What the fill means for the threshold toast, given whether it already fired. */
export function judge(percent: number, threshold: number, warned: boolean): Warning {
  if (!warned && percent >= threshold) return 'warn'
  if (warned && percent < threshold - REARM_GAP) return 'rearm'
  return 'none'
}

/** A threshold from userConfig, clamped to something sensible. */
export function thresholdFrom(value: unknown): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : DEFAULT_THRESHOLD
  return Math.min(95, Math.max(10, Math.round(n)))
}

const pad = (n: number) => String(n).padStart(2, '0')

/** `2026-10-06-1432` for a file name. */
export function stamp(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`
}

/** `2026-10-06 14:32` for a header. */
export function human(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** Joins a root (Windows or POSIX) and a relative path with forward slashes. */
export function join(root: string, rel: string): string {
  return `${root.replace(/[\\/]+$/, '')}/${rel}`
}

export const HANDOFF_PROMPT = `Zatrzymaj się na chwilę i napisz HANDOFF tej sesji: notatkę, z której ktoś (albo Ty po /clear lub kompaktowaniu) podejmie pracę bez czytania tej rozmowy.

Zasady:
- Pisz po polsku, zwięźle i konkretnie, w Markdownie. Bez wstępu i bez zakończenia, tylko notatka.
- Nazwy plików, ścieżki, komendy, kod i identyfikatory zostaw w oryginale.
- Pusta sekcja: napisz „brak”. Nie zgaduj; jeśli czegoś nie wiesz, napisz to wprost.

Użyj dokładnie tych nagłówków:
## Cel
## Zrobione
## W toku
## Następne kroki
(numerowana lista w kolejności wykonania)
## Zmienione pliki
(ścieżka i jedno zdanie: co i po co)
## Decyzje i ustalenia
(z krótkim uzasadnieniem)
## Otwarte problemy i pułapki`

/** The note saved to disk: a header, then the model's handoff. */
export function note(body: string, savedAt: number, percent: number | undefined, model: string): string {
  const fill = percent === undefined ? '' : `, kontekst ${percent}%`
  return `# Handoff ${human(savedAt)}\n\n_Model: ${model}${fill}_\n\n${body.trim()}\n`
}

/** .gitignore text with the handoffs line added, or null when it is already ignored. */
export function withIgnore(current: string | null): string | null {
  const text = current ?? ''
  const lines = text.split(/\r?\n/).map(l => l.trim())
  if (lines.some(l => l === GITIGNORE_LINE || l === '.claude/handoffs' || l === '/.claude/handoffs/' || l === '.claude/' || l === '.claude')) {
    return null
  }
  const sep = text === '' || text.endsWith('\n') ? '' : '\n'
  return `${text}${sep}${GITIGNORE_LINE}\n`
}
