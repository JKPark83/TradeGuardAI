/**
 * In-memory primitives for market-data adapters: a TTL cache and a token-bucket
 * rate limiter. Both are process-local — appropriate for the single-user SaaS
 * runtime (R-01, R-02). When the deployment becomes multi-instance, swap to a
 * Redis-backed implementation at the same interface.
 *
 * `RateLimiter` is a classic token bucket:
 *   - Refills at `rps` tokens per second up to a `capacity` cap (=== rps for
 *     burst smoothing).
 *   - `acquire()` resolves immediately when a token is available; otherwise it
 *     sleeps just long enough for the next token, then deducts.
 *   - Sleeping uses an injectable clock so tests can run under fake timers
 *     (see `tests/unit/market/cache.test.ts`).
 *
 * `TtlCache` is a Map with a per-key absolute-expiry timestamp. Reads that
 * land past expiry return `undefined` and lazily evict the entry — no
 * background sweeper, no setTimeout footguns under Vitest's fake-timer mode.
 */

export interface Clock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

const defaultClock: Clock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

export class RateLimiter {
  private readonly capacity: number;
  private readonly refillPerMs: number;
  private tokens: number;
  private lastRefillAt: number;
  private readonly clock: Clock;

  constructor(rps: number, clock: Clock = defaultClock) {
    if (rps <= 0) {
      throw new Error('RateLimiter: rps must be > 0');
    }
    this.capacity = rps;
    this.refillPerMs = rps / 1000;
    this.tokens = rps;
    this.clock = clock;
    this.lastRefillAt = clock.now();
  }

  private refill(): void {
    const now = this.clock.now();
    const elapsed = now - this.lastRefillAt;
    if (elapsed <= 0) return;
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillPerMs);
    this.lastRefillAt = now;
  }

  /**
   * Reserve one token. Resolves immediately if a token is available; otherwise
   * sleeps until exactly one token will have refilled, then deducts.
   */
  async acquire(): Promise<void> {
    this.refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return;
    }
    const deficit = 1 - this.tokens;
    const waitMs = Math.ceil(deficit / this.refillPerMs);
    await this.clock.sleep(waitMs);
    this.refill();
    // After the sleep we should have at least one token; deduct unconditionally
    // (we may go slightly negative if the clock skipped, but the next refill
    // will heal it without a busy-loop).
    this.tokens -= 1;
  }
}

interface CacheEntry<V> {
  value: V;
  expiresAt: number;
}

export class TtlCache<K, V> {
  private readonly ttlMs: number;
  private readonly store: Map<K, CacheEntry<V>>;
  private readonly clock: Clock;

  constructor(ttlMs: number, clock: Clock = defaultClock) {
    if (ttlMs <= 0) {
      throw new Error('TtlCache: ttlMs must be > 0');
    }
    this.ttlMs = ttlMs;
    this.store = new Map();
    this.clock = clock;
  }

  get(key: K): V | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.clock.now()) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: K, value: V): void {
    this.store.set(key, { value, expiresAt: this.clock.now() + this.ttlMs });
  }

  delete(key: K): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }

  get size(): number {
    return this.store.size;
  }
}

/** Shared limiters for the market adapters. Free-tier safe defaults. */
export const yahooLimiter = new RateLimiter(5);
export const finnhubLimiter = new RateLimiter(1);
