// Warning linker — risk-assessment ↔ trade matcher used at CSV upload time.
//
// Spec: contracts/risk-api.md "위험도 → 사후 회고 연결 (SC-005)":
//   When a real trade is uploaded whose (symbol, side, entry_at) matches a
//   prior risk_assessments row with risk_score >= 70 within ±5 minutes, the
//   later retrospective MUST include `priorWarningPresent: true`.
//
// This module only answers the boolean lookup. The behavioral-analysis
// pipeline owns the actual integration (out of scope for this file).

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Trade, UUID } from '@/types/db';
import { findByCandidateNearTime } from '@/lib/repositories/risk-assessments';

const MATCH_WINDOW_MINUTES = 5;
const WARNING_THRESHOLD = 70;

/**
 * Returns true iff the user issued at least one risk assessment with score
 * ≥ 70 for the same (symbol, side) within ±5 minutes of `trade.entry_at`.
 *
 * Safe to call on every uploaded trade — single owner-scoped SELECT, indexed
 * on (owner_id, requested_at DESC).
 */
export async function linkPriorWarningToTrade(
  supabase: SupabaseClient,
  ownerId: UUID,
  trade: Trade,
): Promise<boolean> {
  if (!trade.entry_at) return false;
  const matches = await findByCandidateNearTime(supabase, ownerId, {
    candidateSymbol: trade.symbol,
    candidateSide: trade.side,
    entryAtIso: trade.entry_at,
    windowMinutes: MATCH_WINDOW_MINUTES,
    minScore: WARNING_THRESHOLD,
  });
  return matches.length > 0;
}
