export type Rendered = {
  /** Absolute path of the PNG; null while rendering or when it failed. */
  file: string | null
  size: { width: number; height: number } | null
  error?: string
}

declare module 'claude-code' {
  interface PluginState {
    'mermaid-pane': { done: Record<string, Rendered> }
  }
}
