export type BoardStatus = 'running' | 'done' | 'failed' | 'stopped'

export type BoardAgent = {
  id: string
  name: string
  type: string
  model: string
  brief: string
  status: BoardStatus
  startedAt: number
  /** Milliseconds its turns ran, summed. */
  ms: number
  tools: number
  tokens: number
  result: string
}

declare module 'claude-code' {
  interface PluginState {
    'agent-board': { agents: Shaped<BoardAgent[]> }
  }
}
