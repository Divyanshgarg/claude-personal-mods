export type LedgerStatus = 'runs' | 'ok' | 'fail' | 'denied'

export type LedgerEntry = {
  id: string
  at: number
  tool: string
  detail: string
  status: LedgerStatus
  ms: number
}

declare module 'claude-code' {
  interface PluginState {
    'session-ledger': { entries: Shaped<LedgerEntry[]> }
  }
}
