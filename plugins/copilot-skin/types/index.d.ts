// A folder as the welcome band shows it, the home directory folded to ~
export type Folder = string

declare module 'claude-code' {
  interface PluginState {
    'copilot-skin': {
      // Whether the welcome band with the Copilot guy shows above the prompt
      isWelcome: boolean
      // The folder the session started in, shown under the title
      cwd: Folder
    }
  }
}
