/** off: prompts go as typed; szlif: rewritten without questions; wywiad: questions first when something important is missing. */
export type SzlifMode = 'off' | 'szlif' | 'wywiad'

/** podglad: the polished prompt goes back to the prompt box; auto: it is sent at once. */
export type SzlifDeliver = 'podglad' | 'auto'

/** What the mod is doing with the prompt now; null when idle. */
export type SzlifPhase = 'analizuje' | 'pyta' | 'sklada' | null

/** The last prompt it polished: what was typed, what came out, and what changed. */
export type SzlifLast = {
  original: string
  improved: string
  why: string
}

export type SzlifStats = {
  /** Rewritten without questions. */
  polished: number
  /** Rewritten after questions. */
  asked: number
  /** Judged good enough and sent as typed. */
  kept: number
}

export type SzlifStatus = {
  mode: SzlifMode
  deliver: SzlifDeliver
  phase: SzlifPhase
  last: SzlifLast | null
  stats: SzlifStats
}

/**
 * What another mod (the Kokpit pane) asks szlif to do, by writing it under its own
 * name: `kokpit.szlifAsk`. szlif watches that write and acts on each new `seq`.
 */
export type SzlifAsk =
  | { seq: number; action: 'mode'; value: SzlifMode }
  | { seq: number; action: 'deliver'; value: SzlifDeliver }
  | { seq: number; action: 'restore' }

declare module 'claude-code' {
  interface PluginState {
    szlif: {
      status: SzlifStatus
    }
  }
}
