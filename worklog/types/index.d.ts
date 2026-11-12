export type WorklogSession = {
  startedAt: number
  prompts: string[]
  files: string[]
  commands: number
  failed: number
  outcome: string
}

/** One session's entry as read back from WORKLOG.md. */
export type WorklogEntry = {
  id: string
  heading: string
  asked: string[]
  files: string[]
  commands: number
  failed: number
  outcome: string
}

declare module 'claude-code' {
  interface PluginState {
    worklog: {
      session: Shaped<WorklogSession>
      entries: Shaped<WorklogEntry[]>
      expanded: Shaped<string>
    }
  }
}
