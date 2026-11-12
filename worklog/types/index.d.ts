export type WorklogSession = {
  startedAt: number
  prompts: string[]
  files: string[]
  commands: number
  failed: number
  outcome: string
}

declare module 'claude-code' {
  interface PluginState {
    worklog: { session: Shaped<WorklogSession> }
  }
}
