export type AgentTiming = { startedAt: number; endedAt?: number }
export type LoopInfo = { model: string; effort?: string }
/** Prompt-cache tokens a loop has used, summed over its model requests, plus the last request's hit rate. */
export type CacheStats = { read: number; write: number; input: number; output: number; lastHit: number }

declare module 'claude-code' {
  interface PluginState {
    'agent-monitor': {
      timing: Record<string, AgentTiming>
      lastSeen: string
      /** Model and effort per loop, keyed by agent id; `main` for the session's own loop. */
      loops: Record<string, LoopInfo>
      /** Cache stats per loop, keyed like `loops`. */
      cache: Record<string, CacheStats>
      /** Which agent each Agent tool call started, keyed by tool_use_id. */
      byCall: Record<string, string>
    }
  }
}
