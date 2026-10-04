import { ApiError } from './errors.js'
export class Jobs {
  constructor(private readonly onFailure: (error: unknown) => void = () => {}) {}
  private active = new Map<string, AbortController>()
  private promises = new Set<Promise<void>>()
  launch(key: string, task: (signal: AbortSignal) => Promise<void>, fail: () => void): void {
    if (this.active.has(key)) {
      throw new ApiError(409, 'already_running', 'A job is already running for this user.')
    }
    if (this.active.size >= 4) {
      throw new ApiError(429, 'busy', 'The backend is at capacity. Try again shortly.')
    }
    const controller = new AbortController()
    this.active.set(key, controller)
    const timer = setTimeout(() => controller.abort(), 120000)
    const promise = Promise.resolve()
      .then(() => task(controller.signal))
      .catch((error) => {
        controller.abort()
        fail()
        this.onFailure(error)
      })
      .finally(() => {
        clearTimeout(timer)
        this.active.delete(key)
        this.promises.delete(promise)
      })
    this.promises.add(promise)
  }
  requireAvailable(key: string) {
    if (this.active.has(key)) {
      throw new ApiError(409, 'already_running', 'A job is already running for this user.')
    }
    if (this.active.size >= 4) {
      throw new ApiError(429, 'busy', 'The backend is at capacity. Try again shortly.')
    }
  }
  async settle() {
    await Promise.all(this.promises)
  }
  async stop() {
    for (const controller of this.active.values()) {
      controller.abort()
    }
    await this.settle()
  }
}
