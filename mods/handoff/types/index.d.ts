/** When /handoff last saved a file in this session ($.clock.now() ms), or null. */
export type SavedAt = number | null

declare module 'claude-code' {
  interface PluginState {
    handoff: {
      /** The threshold toast was shown and has not been re-armed yet. */
      warned: boolean
      savedAt: SavedAt
    }
  }
}
