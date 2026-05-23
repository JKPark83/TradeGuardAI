/**
 * Unit tests for `lib/market/cache.ts`.
 *
 * Strategy: inject a fake `Clock` (instead of relying on Vitest's fake-timers
 * for setTimeout). This keeps the assertions deterministic and lets us prove
 * the limiter's wait calculation independently of the underlying timer queue.
 */

import { describe, expect, it } from 'vitest';
import { RateLimiter, TtlCache, type Clock } from '@/lib/market/cache';

interface FakeClock extends Clock {
  advance(ms: number): void;
  totalSleptMs(): number;
}

function makeFakeClock(): FakeClock {
  let now = 0;
  let slept = 0;
  return {
    now: () => now,
    sleep: async (ms: number) => {
      slept += ms;
      now += ms;
    },
    advance(ms: number) {
      now += ms;
    },
    totalSleptMs() {
      return slept;
    },
  };
}

describe('RateLimiter', () => {
  it('acquire is non-blocking when under the limit', async () => {
    const clock = makeFakeClock();
    const limiter = new RateLimiter(5, clock);

    // 5 rps starts full (capacity=5) — first 5 acquires should not sleep.
    for (let i = 0; i < 5; i += 1) {
      await limiter.acquire();
    }
    expect(clock.totalSleptMs()).toBe(0);
  });

  it('blocks ~200ms when one over the limit at 5 rps', async () => {
    const clock = makeFakeClock();
    const limiter = new RateLimiter(5, clock);

    // Drain initial bucket of 5 tokens, then a 6th acquire must wait.
    for (let i = 0; i < 5; i += 1) {
      await limiter.acquire();
    }
    expect(clock.totalSleptMs()).toBe(0);

    await limiter.acquire();
    // At 5 rps, one token refills every 200ms — ceil(1 / (5/1000)) === 200.
    expect(clock.totalSleptMs()).toBe(200);
  });

  it('does not sleep again after time advances enough to refill', async () => {
    const clock = makeFakeClock();
    const limiter = new RateLimiter(5, clock);

    for (let i = 0; i < 5; i += 1) {
      await limiter.acquire();
    }
    clock.advance(1000); // 1 second → 5 tokens regenerated, capped at 5.

    for (let i = 0; i < 5; i += 1) {
      await limiter.acquire();
    }
    expect(clock.totalSleptMs()).toBe(0);
  });
});

describe('TtlCache', () => {
  it('returns set values within ttl', () => {
    const clock = makeFakeClock();
    const cache = new TtlCache<string, number>(1000, clock);
    cache.set('a', 42);
    expect(cache.get('a')).toBe(42);
  });

  it('returns undefined after ttlMs has elapsed', () => {
    const clock = makeFakeClock();
    const cache = new TtlCache<string, number>(1000, clock);
    cache.set('a', 42);
    clock.advance(1001);
    expect(cache.get('a')).toBeUndefined();
    expect(cache.size).toBe(0); // lazy eviction
  });

  it('keeps independent expirations per key', () => {
    const clock = makeFakeClock();
    const cache = new TtlCache<string, number>(1000, clock);
    cache.set('a', 1);
    clock.advance(500);
    cache.set('b', 2);
    clock.advance(600);
    // a: 1100ms old → expired. b: 600ms old → alive.
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('b')).toBe(2);
  });

  it('clear() removes everything', () => {
    const clock = makeFakeClock();
    const cache = new TtlCache<string, number>(1000, clock);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.clear();
    expect(cache.size).toBe(0);
    expect(cache.get('a')).toBeUndefined();
  });
});
