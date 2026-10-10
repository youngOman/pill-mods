export type NextSteps = { turnId: string; items: string[] }

declare module 'claude-code' {
  interface PluginState {
    'pill-steps': { steps: NextSteps | null; active: boolean }
  }
}
