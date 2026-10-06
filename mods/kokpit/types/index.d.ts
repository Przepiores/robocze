/** One tool call of the running (or last) turn. */
export type KokpitCall = {
  id: string
  tool: string
  /** The file, command or pattern it works on, shortened. */
  label: string
  /** Milliseconds it took; null while it runs. */
  ms: number | null
  isError: boolean
}

export type KokpitActivity = {
  turn: number
  isRunning: boolean
  /** Model requests so far in this turn. */
  steps: number
  calls: KokpitCall[]
  /** Subagents running now, by description. */
  agents: string[]
  /** Files edited this session: path and edit count, most recent first. */
  files: { path: string; edits: number }[]
}

export type KokpitLimit = { label: string; percent: number; resets: string | null }

export type KokpitSession = {
  percent: number | null
  tokens: number | null
  window: number
  usd: number | null
  limits: KokpitLimit[]
}

export type KokpitPlaceName = 'code' | 'cowork' | 'chat'

export type KokpitPlace = {
  /** The latest verdict, null before the first check. */
  verdict: KokpitPlaceName | null
  /** A place other than Code, confirmed by two verdicts in a row; null when Code fits. */
  suggestion: 'cowork' | 'chat' | null
  /** The person chose to stay: the suggestion is not repeated until the verdict changes. */
  isDismissed: boolean
  /** Short reason shown under the verdict. */
  why: string
  /** A transfer is being written. */
  isBusy: boolean
  /** Where the last transfer text went. */
  transfer: string | null
}

declare module 'claude-code' {
  interface PluginState {
    kokpit: {
      activity: KokpitActivity
      session: KokpitSession | null
      place: KokpitPlace
    }
  }
}
