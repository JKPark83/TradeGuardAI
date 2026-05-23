// Repository for `tilt_checks`.
//
// Domain rule: exactly 0 or 1 tilt check per trading_session — enforced by
// UNIQUE (session_id) at the DB level. We catch the resulting 23505 unique
// violation and re-throw as `TiltAlreadySubmittedError` so the route handler
// can map it to HTTP 409 per contracts/sessions-api.md.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { TiltCheck, TiltColor, UUID } from '@/types/db';

const PG_UNIQUE_VIOLATION = '23505';

/**
 * Thrown by `insertTiltCheck` when the session already has a tilt check.
 * Carries the offending session id so the route handler can return
 * `409 { error: 'tilt_already_submitted', existing: { ... } }`.
 */
export class TiltAlreadySubmittedError extends Error {
  readonly sessionId: UUID;

  constructor(sessionId: UUID) {
    super(`tilt_already_submitted: session ${sessionId} already has a tilt check`);
    this.name = 'TiltAlreadySubmittedError';
    this.sessionId = sessionId;
  }
}

export interface InsertTiltCheckInput {
  sleepScore: number;
  stressScore: number;
  externalEvent?: string | null;
  externalEventSerious: boolean;
  tiltColor: TiltColor;
  rawScore: number;
}

/** Look up the tilt check (if any) attached to a given session. */
export async function findTiltCheckBySession(
  supabase: SupabaseClient,
  sessionId: UUID,
): Promise<TiltCheck | null> {
  const { data, error } = await supabase
    .from('tilt_checks')
    .select('*')
    .eq('session_id', sessionId)
    .maybeSingle<TiltCheck>();
  if (error) throw error;
  return data;
}

/**
 * Insert a tilt check for a session.
 *
 * The DB stores `raw_score` as NUMERIC(5,2) — we serialize through `toFixed(2)`
 * to keep the decimal representation explicit and round-trip-stable.
 *
 * @throws {TiltAlreadySubmittedError} if a tilt check for the session already
 *   exists (Postgres unique violation 23505).
 */
export async function insertTiltCheck(
  supabase: SupabaseClient,
  ownerId: UUID,
  sessionId: UUID,
  input: InsertTiltCheckInput,
): Promise<TiltCheck> {
  const row = {
    owner_id: ownerId,
    session_id: sessionId,
    sleep_score: input.sleepScore,
    stress_score: input.stressScore,
    external_event: input.externalEvent ?? null,
    external_event_serious: input.externalEventSerious,
    tilt_color: input.tiltColor,
    raw_score: input.rawScore.toFixed(2),
  };
  const { data, error } = await supabase
    .from('tilt_checks')
    .insert(row)
    .select('*')
    .single<TiltCheck>();
  if (error) {
    if (error.code === PG_UNIQUE_VIOLATION) {
      throw new TiltAlreadySubmittedError(sessionId);
    }
    throw error;
  }
  return data;
}

export interface ListTiltChecksParams {
  from?: string;
  to?: string;
  limit?: number;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;

/** List the owner's tilt checks, newest first. Used by analytics + history. */
export async function listTiltChecksByOwner(
  supabase: SupabaseClient,
  ownerId: UUID,
  params: ListTiltChecksParams,
): Promise<TiltCheck[]> {
  const limit =
    params.limit === undefined || params.limit <= 0
      ? DEFAULT_LIMIT
      : Math.min(params.limit, MAX_LIMIT);

  let query = supabase
    .from('tilt_checks')
    .select('*')
    .eq('owner_id', ownerId)
    .order('submitted_at', { ascending: false })
    .limit(limit);
  if (params.from) query = query.gte('submitted_at', params.from);
  if (params.to) query = query.lte('submitted_at', params.to);

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as TiltCheck[];
}
