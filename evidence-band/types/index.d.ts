export type EvidenceCheck = { command: string; isPassing: boolean }

export type Evidence = {
  /** Files edited since the last passing check. */
  edited: string[]
  /** The last check command (tests, build, lint, type-check) and how it ended. */
  check: EvidenceCheck | null
  /** Whether the last answer claimed the work was done. */
  hasClaimed: boolean
  /** Uncommitted files and unpushed commits; -1 when unknown (no repo, no upstream). */
  dirty: number
  unpushed: number
}

declare module 'claude-code' {
  interface PluginState {
    'evidence-band': { evidence: Shaped<Evidence>; isHidden: boolean }
  }
}
