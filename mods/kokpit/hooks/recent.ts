import type { KokpitHandoff, KokpitSessionLine } from '../types'

const pad = (n: number) => String(n).padStart(2, '0')

/** `22:13` today, `wczoraj 22:13`, else `05.10 22:13`. */
export function when(ms: number, now: number): string {
  const at = new Date(ms)
  const time = `${pad(at.getHours())}:${pad(at.getMinutes())}`
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const diff = Math.round((day(new Date(now)) - day(at)) / 86_400_000)
  if (diff === 0) return time
  if (diff === 1) return `wczoraj ${time}`
  return `${pad(at.getDate())}.${pad(at.getMonth() + 1)} ${time}`
}

/** The text under one `## Heading` of a handoff note, without empty lines. */
function section(md: string, heading: RegExp): string[] {
  const lines = md.split(/\r?\n/)
  const start = lines.findIndex(l => /^##\s/.test(l) && heading.test(l))
  if (start === -1) return []
  const out: string[] = []
  for (const line of lines.slice(start + 1)) {
    if (/^##?\s/.test(line)) break
    const text = line.replace(/^\s*(?:[-*]|\d+[.)])\s+/, '').trim()
    if (text !== '' && text.toLowerCase() !== 'brak') out.push(text)
  }
  return out
}

/** Reads a note written by the handoff mod (LATEST.md): its time, goal, next steps and open problems. */
export function parseHandoff(md: string, mtimeMs: number, now: number): KokpitHandoff {
  const first = (h: RegExp) => section(md, h)[0] ?? null
  return {
    when: when(mtimeMs, now),
    goal: first(/cel/i),
    next: section(md, /następne kroki|next steps/i).slice(0, 3),
    open: first(/otwarte|problem/i),
  }
}

type Line = { type?: string; summary?: string; isMeta?: boolean; message?: { role?: string; content?: unknown } }

const NOISE = /^\s*(<command-|<local-command|<system-reminder|Caveat:|\[Request interrupted)/

function textOf(content: unknown): string | null {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    for (const block of content) {
      if (block !== null && typeof block === 'object' && (block as { type?: string }).type === 'text') {
        const t = (block as { text?: unknown }).text
        if (typeof t === 'string') return t
      }
    }
  }
  return null
}

/** A session's title from its transcript (JSONL): the stored summary, else its first real prompt. */
export function sessionTitle(jsonl: string): string | null {
  let prompt: string | null = null
  for (const raw of jsonl.split('\n')) {
    if (raw.trim() === '') continue
    let line: Line
    try {
      line = JSON.parse(raw) as Line
    } catch {
      continue
    }
    if (line.type === 'summary' && typeof line.summary === 'string' && line.summary.trim() !== '') return clean(line.summary)
    if (prompt === null && line.type === 'user' && line.isMeta !== true && line.message?.role === 'user') {
      const text = textOf(line.message.content)
      if (text !== null && text.trim() !== '' && !NOISE.test(text)) prompt = clean(text)
    }
  }
  return prompt
}

const clean = (text: string) => {
  const line = text.replace(/\s+/g, ' ').trim()
  return line.length > 70 ? `${line.slice(0, 69)}…` : line
}

/** Claude Code's folder name for a project path: every character but letters and digits becomes `-`. */
export const projectSlug = (path: string) => path.replace(/[^a-zA-Z0-9]/g, '-')

/** The folder of a file path, either separator. */
export const dirOf = (path: string) => path.replace(/[\\/][^\\/]*$/, '')

/** The newest transcripts first, the running session left out. */
export function pickSessions(
  entries: readonly { name: string; kind: string; mtimeMs: number }[],
  currentId: string | null,
  count = 3,
): { name: string; mtimeMs: number }[] {
  return entries
    .filter(e => e.kind === 'file' && e.name.endsWith('.jsonl') && e.name !== `${currentId}.jsonl`)
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, count)
}

export function sessionLine(title: string | null, mtimeMs: number, now: number): KokpitSessionLine {
  return { when: when(mtimeMs, now), title: title ?? '(bez podglądu)' }
}
