// One tool call a subagent made: running, answered, or failed
export type Step = { id: string; tool: string; summary: string; state: 'run' | 'ok' | 'err' }

// One subagent as the pane shows it
export type AgentView = {
  id: string
  type: string
  description: string
  status: 'running' | 'done' | 'failed'
  startedAt: number
  endedAt: number | null
  tools: number
  // The newest tool calls, oldest first
  steps: Step[]
  // The tail of what the agent last wrote
  text: string
}

declare module 'claude-code' {
  interface PluginState {
    'agent-watch': {
      // The agents of this session, oldest first
      agents: AgentView[]
      // Bumped every second while one runs, so elapsed times redraw
      tick: number
    }
  }
}
