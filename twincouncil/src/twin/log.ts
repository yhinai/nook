/** Recent progress lines, kept in memory so GET /twin/status can show what a run is doing. */
export const recent: string[] = []

const listeners = new Set<(line: string) => void>()

export function log(message: string): void {
  const line = `${new Date().toISOString().slice(11, 19)}Z ${message}`
  recent.push(line)
  if (recent.length > 200) recent.shift()
  for (const listener of listeners) listener(line)
  console.log(`[twin] ${message}`)
}

/** Subscribe to progress lines. Returns the function that unsubscribes. */
export function onLog(listener: (line: string) => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
