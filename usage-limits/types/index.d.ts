export type CacheTotals = { read: number; write: number; input: number; output: number }

declare module 'claude-code' {
  interface PluginState {
    'usage-limits': {
      /** Prompt-cache tokens summed over every model request of the session, all loops. */
      cache: CacheTotals
    }
  }
}
