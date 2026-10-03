// One reading of the live context window, taken after a turn
export type Sample = { tokens: number; percent: number }

// One rate-limit window: five_hour, seven_day, or a gateway's spend_limit
export type Limit = { kind: string; percentUsed: number; resetsAt?: string }

// The model the main loop last asked, and how hard it asked it to think
export type ModelInfo = { name: string; effort: string | null }

// The working tree's branch, its uncommitted changes and its distance from upstream
export type GitInfo = { branch: string; changes: number; ahead: number; behind: number }

// Tokens summed over every model call of the session, subagents included
export type Totals = { input: number; output: number; cacheRead: number; cacheWrite: number }

declare module 'claude-code' {
  interface PluginState {
    'usage-bars': {
      // One reading per finished turn, oldest first
      samples: Sample[]
      // The live reading, refreshed whenever the window's fill moves
      current: Sample | null
      // The model's context window in tokens
      window: number
      // Token totals so far, and the US dollars each main turn cost
      totals: Totals
      turns: number[]
      // The session cost when the last main turn closed
      mark: number
      // US dollars spent this session as the engine prices it, null until priced
      cost: number | null
      // Share of the latest request's input the prompt cache served, 0 to 1
      hit: number | null
      // The account's rate-limit windows, as last measured
      limits: Limit[]
      // The session's model and effort, null until known
      model: ModelInfo | null
      // The git state of the working directory, null outside a repository
      git: GitInfo | null
    }
  }
}
