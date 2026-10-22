export type Rendered = {
  /** Absolute path of the PNG; null when rendering failed. */
  file: string | null
  size: { width: number; height: number } | null
  error?: string
}
