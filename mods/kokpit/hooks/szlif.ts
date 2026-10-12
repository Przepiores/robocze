import type { KokpitSzlifDeliver, KokpitSzlifMode, KokpitSzlifView } from '../types'

/** The szlif mod's state, read by the pane; `undefined` while that mod is not loaded. */
export const SZLIF_MODES: readonly KokpitSzlifMode[] = ['off', 'szlif', 'wywiad']
export const SZLIF_DELIVERS: readonly KokpitSzlifDeliver[] = ['podglad', 'auto']
export const SZLIF_MODE_LABEL: Readonly<Record<KokpitSzlifMode, string>> = { off: 'Wył', szlif: 'Szlif', wywiad: 'Wywiad' }
export const SZLIF_DELIVER_LABEL: Readonly<Record<KokpitSzlifDeliver, string>> = { podglad: 'Podgląd', auto: 'Auto' }

export const SZLIF_HINT: Readonly<Record<KokpitSzlifMode, string>> = {
  off: 'prompty idą jak wpisane',
  szlif: 'poprawia prompt bez pytań',
  wywiad: 'dopytuje, gdy czegoś ważnego brakuje',
}

export const SZLIF_PHASE: Readonly<Record<'analizuje' | 'pyta' | 'sklada', string>> = {
  analizuje: 'czytam prompt…',
  pyta: 'czekam na Twoje odpowiedzi',
  sklada: 'składam prompt…',
}

/** szlif's status as the pane draws it; null when that mod is absent or wrote something else. */
export function szlifView(value: unknown): KokpitSzlifView | null {
  if (typeof value !== 'object' || value === null) return null
  const o = value as Record<string, unknown>
  if (!(SZLIF_MODES as readonly unknown[]).includes(o.mode) || !(SZLIF_DELIVERS as readonly unknown[]).includes(o.deliver)) return null
  const phase = o.phase === 'analizuje' || o.phase === 'pyta' || o.phase === 'sklada' ? o.phase : null
  const last = typeof o.last === 'object' && o.last !== null ? (o.last as Record<string, unknown>) : null
  const lastWhy = last === null ? null : typeof last.why === 'string' && last.why !== '' ? last.why : 'poprawiony prompt'
  return { mode: o.mode as KokpitSzlifMode, deliver: o.deliver as KokpitSzlifDeliver, phase, lastWhy }
}
