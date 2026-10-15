/** Pluggable platform primitives so LocalBackend is unit-testable in Node. */

export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export interface ChannelLike {
  post(message: unknown): void
  onMessage(cb: (message: unknown) => void): void
  close(): void
}

export function memoryStorage(): StorageLike {
  const map = new Map<string, string>()
  return {
    getItem: (k) => (map.has(k) ? (map.get(k) as string) : null),
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k)
  }
}

export function browserStorage(): StorageLike {
  try {
    return window.localStorage
  } catch {
    return memoryStorage()
  }
}

/** BroadcastChannel adapter for cross-tab realtime in demo mode. */
export class BroadcastChannelAdapter implements ChannelLike {
  private bc: BroadcastChannel
  private cb: ((m: unknown) => void) | null = null

  private constructor(name: string) {
    this.bc = new BroadcastChannel(name)
    this.bc.onmessage = (e) => this.cb?.(e.data)
  }

  static create(name = 'avhifocus-demo'): ChannelLike | null {
    if (typeof BroadcastChannel === 'undefined') return null
    try {
      return new BroadcastChannelAdapter(name)
    } catch {
      return null
    }
  }

  post(message: unknown) {
    try {
      this.bc.postMessage(message)
    } catch {
      /* tab closing */
    }
  }
  onMessage(cb: (m: unknown) => void) {
    this.cb = cb
  }
  close() {
    this.bc.close()
  }
}

/** Deterministic paired channels for tests (two "tabs" sharing one profile). */
export class TestChannelHub {
  private channels: Array<{ deliver: (m: unknown) => void }> = []
  makeChannel(): ChannelLike {
    const hub = this
    let cb: ((m: unknown) => void) | null = null
    const entry = {
      deliver: (m: unknown) => queueMicrotask(() => cb?.(m))
    }
    hub.channels.push(entry)
    return {
      post: (m) => hub.channels.forEach((c) => c !== entry && c.deliver(m)),
      onMessage: (fn) => {
        cb = fn
      },
      close: () => {
        hub.channels = hub.channels.filter((c) => c !== entry)
      }
    }
  }
}
