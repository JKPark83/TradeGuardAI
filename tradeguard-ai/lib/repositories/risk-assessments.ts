// Repository for `risk_assessments`. Owner-scoped reads and writes.
//
// Every risk assessment is persisted (FR-018) for reproducibility — even
// when the LLM explanation call fails. signals_breakdown is stored as JSONB
// with the exact RiskAssessmentSignals shape; the API surface mirrors it 1:1.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { RiskAssessment, RiskAssessmentSignals, TradeSide, UUID } from '@/types/db';

const PG_TABLE = 'risk_assessments';
const DEFAULT_LIST_LIMIT = 20;
const MAX_LIST_LIMIT = 100;

export interface InsertAssessmentInput {
  session_id: UUID | null;
  candidate_symbol: string;
  candidate_side: TradeSide;
  candidate_contracts: number | null;
  risk_score: number;
  signals_breakdown: RiskAssessmentSignals;
  warning_message: string | null;
  tilt_check_id: UUID | null;
  market_snapshot: Record<string, unknown> | null;
  prop_firm_room_snapshot: Record<string, unknown> | null;
  llm_explanation: string | null;
  llm_input_snapshot: Record<string, unknown> | null;
}

export async function insertAssessment(
  supabase: SupabaseClient,
  ownerId: UUID,
  dto: InsertAssessmentInput,
): Promise<RiskAssessment> {
  const row = {
    owner_id: ownerId,
    session_id: dto.session_id,
    candidate_symbol: dto.candidate_symbol,
    candidate_side: dto.candidate_side,
    candidate_contracts:
      dto.candidate_contracts === null ? null : dto.candidate_contracts.toFixed(2),
    risk_score: dto.risk_score,
    signals_breakdown: dto.signals_breakdown,
    warning_message: dto.warning_message,
    tilt_check_id: dto.tilt_check_id,
    market_snapshot: dto.market_snapshot,
    prop_firm_room_snapshot: dto.prop_firm_room_snapshot,
    llm_explanation: dto.llm_explanation,
    llm_input_snapshot: dto.llm_input_snapshot,
  };
  const { data, error } = await supabase
    .from(PG_TABLE)
    .insert(row)
    .select('*')
    .single<RiskAssessment>();
  if (error) throw error;
  return data;
}

export async function listRecent(
  supabase: SupabaseClient,
  ownerId: UUID,
  limit?: number,
): Promise<RiskAssessment[]> {
  const effectiveLimit =
    limit === undefined || limit <= 0 ? DEFAULT_LIST_LIMIT : Math.min(limit, MAX_LIST_LIMIT);
  const { data, error } = await supabase
    .from(PG_TABLE)
    .select('*')
    .eq('owner_id', ownerId)
    .order('requested_at', { ascending: false })
    .limit(effectiveLimit);
  if (error) throw error;
  return (data ?? []) as RiskAssessment[];
}

export interface FindNearTimeParams {
  candidateSymbol: string;
  candidateSide: TradeSide;
  /** Trade entry time (ISO 8601). The lookup window is centered on this. */
  entryAtIso: string;
  /** Half-window size in minutes. e.g. 5 means [entry - 5min, entry + 5min]. */
  windowMinutes: number;
  /** Minimum risk_score considered "raised a warning" — defaults to 70. */
  minScore?: number;
}

/**
 * Find risk assessments for the same (symbol, side) within ±windowMinutes
 * of `entryAtIso` whose risk_score is at or above `minScore`. Used by the
 * warning-linker to set `priorWarningPresent` on retrospective inputs.
 */
export async function findByCandidateNearTime(
  supabase: SupabaseClient,
  ownerId: UUID,
  params: FindNearTimeParams,
): Promise<RiskAssessment[]> {
  const { candidateSymbol, candidateSide, entryAtIso, windowMinutes } = params;
  const minScore = params.minScore ?? 70;
  const entryMs = new Date(entryAtIso).getTime();
  if (!Number.isFinite(entryMs)) return [];
  const fromIso = new Date(entryMs - windowMinutes * 60_000).toISOString();
  const toIso = new Date(entryMs + windowMinutes * 60_000).toISOString();

  const { data, error } = await supabase
    .from(PG_TABLE)
    .select('*')
    .eq('owner_id', ownerId)
    .eq('candidate_symbol', candidateSymbol)
    .eq('candidate_side', candidateSide)
    .gte('requested_at', fromIso)
    .lte('requested_at', toIso)
    .gte('risk_score', minScore)
    .order('requested_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as RiskAssessment[];
}
