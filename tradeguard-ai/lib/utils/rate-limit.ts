// Per-user route-level rate limiter — in-memory sliding window.
//
// Used on expensive endpoints (`/api/risk/assess`, `/api/analysis/retrospective`)
// to bound LLM-call frequency. Single-user SaaS, so Map() is fine; if we ever
// shard horizontally this needs to move to Upstash Redis or Vercel KV.
//
// Limits are per-user × per-bucket — `bucket` lets different routes share or
// segregate counters. Returning the verdict (not throwing) lets callers
// compose this with `rateLimited(...)` from api-error.ts.

type WindowMs = number;

interface BucketState {
  windowMs: WindowMs;
  limit: number;
  hits: Map<string, number[]>; // ownerId → array of timestamps (ms epoch)
}

const buckets = new Map<string, BucketState>();

function getOrCreateBucket(name: string, windowMs: number, limit: number): BucketState {
  const existing = buckets.get(name);
  if (existing) return existing;
  const created: BucketState = { windowMs, limit, hits: new Map() };
  buckets.set(name, created);
  return created;
}

export interface RateLimitVerdict {
  allowed: boolean;
  remaining: number;
  /** Seconds until the oldest hit in the window expires. */
  retryAfterSeconds?: number;
}

/**
 * Consume one slot from a named bucket for a given user.
 *
 * @example
 *   const v = checkRateLimit('risk_assess', user.id, { windowMs: 60_000, limit: 12 });
 *   if (!v.allowed) return rateLimited(v.retryAfterSeconds ?? 60);
 */
export function checkRateLimit(
  bucket: string,
  ownerId: string,
  opts: { windowMs: number; limit: number },
): RateLimitVerdict {
  const state = getOrCreateBucket(bucket, opts.windowMs, opts.limit);
  const now = Date.now();
  const cutoff = now - state.windowMs;

  const userHits = state.hits.get(ownerId) ?? [];
  // Prune everything older than the window.
  const live = userHits.filter((t) => t > cutoff);

  if (live.length >= state.limit) {
    const oldest = live[0];
    const retryAfterSeconds = Math.max(1, Math.ceil((oldest + state.windowMs - now) / 1000));
    // Persist the pruned (but still-full) array so we don't grow unboundedly.
    state.hits.set(ownerId, live);
    return { allowed: false, remaining: 0, retryAfterSeconds };
  }

  live.push(now);
  state.hits.set(ownerId, live);
  return { allowed: true, remaining: state.limit - live.length };
}

/** Default policies — tune as observability data comes in. */
export const RATE_LIMITS = {
  RISK_ASSESS: { bucket: 'risk_assess', windowMs: 60_000, limit: 12 },
  RETROSPECTIVE: { bucket: 'retrospective', windowMs: 60_000, limit: 6 },
} as const;

/** Test-only — clear all in-memory state. */
export function __resetRateLimits(): void {
  buckets.clear();
}
