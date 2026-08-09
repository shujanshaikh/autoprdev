export interface KeyValueStoreUpdate<T> {
  value: T;
  ttlMs?: number;
}

/**
 * A minimal async key/value store. The server package persists login sessions
 * through this interface, so any backend (in-memory, Redis, Upstash, a
 * database, cookies) can back it by implementing these methods.
 */
export interface KeyValueStore<T> {
  get(key: string): Promise<T | undefined> | T | undefined;
  set(key: string, value: T, options?: { ttlMs?: number }): Promise<void> | void;
  delete(key: string): Promise<void> | void;
  /** Atomically derives and persists a value from the latest stored value. */
  update(
    key: string,
    updater: (current: T | undefined) => KeyValueStoreUpdate<T>,
  ): Promise<T> | T;
}

interface Entry<T> {
  value: T;
  expiresAt?: number;
}

/**
 * Process-local {@link KeyValueStore} with optional TTL. Great for development
 * and single-instance servers; use a shared store (Redis/Upstash/DB) in
 * production so sessions survive restarts and span instances.
 */
export class MemoryStore<T> implements KeyValueStore<T> {
  private readonly map = new Map<string, Entry<T>>();
  private readonly now: () => number;
  private cleanupIterator?: MapIterator<[string, Entry<T>]>;

  constructor(options: { now?: () => number } = {}) {
    this.now = options.now ?? Date.now;
  }

  get(key: string): T | undefined {
    const entry = this.map.get(key);
    if (!entry) {
      this.pruneExpired();
      return undefined;
    }
    if (this.isExpired(entry)) {
      this.map.delete(key);
      return undefined;
    }
    this.pruneExpired();
    return entry.value;
  }

  set(key: string, value: T, options: { ttlMs?: number } = {}): void {
    this.pruneExpired();
    this.map.set(key, this.entry(value, options.ttlMs));
  }

  delete(key: string): void {
    this.map.delete(key);
  }

  update(key: string, updater: (current: T | undefined) => KeyValueStoreUpdate<T>): T {
    this.pruneExpired();
    const existing = this.map.get(key);
    const current = existing && !this.isExpired(existing) ? existing.value : undefined;
    if (existing && current === undefined) this.map.delete(key);
    const next = updater(current);
    this.map.set(key, this.entry(next.value, next.ttlMs));
    return next.value;
  }

  private entry(value: T, ttlMs: number | undefined): Entry<T> {
    return {
      value,
      expiresAt: ttlMs !== undefined ? this.now() + ttlMs : undefined,
    };
  }

  private isExpired(entry: Entry<T>): boolean {
    return entry.expiresAt !== undefined && entry.expiresAt <= this.now();
  }

  /**
   * Opportunistically scans a small rotating slice so abandoned TTL keys are
   * eventually removed without making any single store operation unbounded.
   */
  private pruneExpired(limit = 16): void {
    if (this.map.size === 0) {
      this.cleanupIterator = undefined;
      return;
    }

    const iterator = this.cleanupIterator ?? this.map.entries();
    let checked = 0;
    while (checked < limit) {
      const next = iterator.next();
      if (next.done) {
        this.cleanupIterator = undefined;
        return;
      }
      const [key, entry] = next.value;
      if (this.isExpired(entry)) this.map.delete(key);
      checked += 1;
    }
    this.cleanupIterator = iterator;
  }
}
