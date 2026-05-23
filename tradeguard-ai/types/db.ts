// Database entity types — mirror `specs/001-tradeguard-ai/data-model.md`.
// Numbers come back from PostgREST as JS numbers for safe-range; decimals as strings.
// We standardize to `string` for NUMERIC columns to preserve precision and convert at boundaries.

export type UUID = string;
export type ISODateTime = string;

export type TradeSide = 'long' | 'short';
export type DrawdownType = 'static' | 'eod_trailing' | 'intraday_trailing';
export type TiltColor = 'green' | 'yellow' | 'red';
export type RetrospectiveStatus = 'pending' | 'generated' | 'failed' | 'filtered_out';
export type FirmName = 'topstep' | 'apex' | 'ftmo' | 'fundednext' | 'other';
export type EventType = 'cpi' | 'fomc' | 'nfp' | 'cbproductivity' | 'normal';
export type MarketDataSource = 'yahoo' | 'finnhub' | 'mixed';
export type PnlSignConvention = 'broker_native' | 'computed';

export interface UserSecret {
  user_id: UUID;
  pii_hmac_secret: string;
  created_at: ISODateTime;
}

export interface PropFirmProfile {
  id: UUID;
  owner_id: UUID;
  firm_name: FirmName;
  firm_label: string | null;
  account_size: string;
  daily_loss_limit: string | null;
  drawdown_type: DrawdownType;
  drawdown_limit: string;
  warn_threshold_pct: string;
  is_active: boolean;
  created_at: ISODateTime;
}

export interface BrokerMappingPreset {
  id: UUID;
  owner_id: UUID | null;
  preset_name: string;
  header_signature: string[];
  column_mapping: Record<string, string>;
  time_format: string;
  pnl_sign_convention: PnlSignConvention;
  created_at: ISODateTime;
}

export interface TradingSession {
  id: UUID;
  owner_id: UUID;
  started_at: ISODateTime;
  ended_at: ISODateTime | null;
  created_at: ISODateTime;
}

export interface TiltCheck {
  id: UUID;
  session_id: UUID;
  owner_id: UUID;
  sleep_score: number;
  stress_score: number;
  external_event: string | null;
  external_event_serious: boolean;
  tilt_color: TiltColor;
  raw_score: string;
  submitted_at: ISODateTime;
}

export interface Trade {
  id: UUID;
  owner_id: UUID;
  session_id: UUID | null;
  symbol: string;
  side: TradeSide;
  entry_price: string;
  exit_price: string | null;
  entry_at: ISODateTime;
  exit_at: ISODateTime | null;
  pnl: string | null;
  contracts: string;
  source_csv_id: UUID | null;
  source_row: number | null;
  created_at: ISODateTime;
}

export interface MarketSnapshot {
  trade_id: UUID;
  owner_id: UUID;
  symbol: string;
  snapshot_at: ISODateTime;
  vix: string | null;
  dxy: string | null;
  volume: string | null;
  atr_14: string | null;
  event_type: EventType | null;
  event_offset_minutes: number | null;
  data_source: MarketDataSource;
  created_at: ISODateTime;
}

export interface Analysis {
  id: UUID;
  trade_id: UUID;
  owner_id: UUID;
  stop_delay_score: number | null;
  revenge_score: number | null;
  overconfidence_score: number | null;
  risk_score: number | null;
  retrospective_text: string | null;
  retrospective_status: RetrospectiveStatus;
  llm_input_snapshot: Record<string, unknown> | null;
  llm_token_usage: { input: number; output: number; model: string } | null;
  created_at: ISODateTime;
}

/**
 * Risk assessment signal breakdown (JSONB body of `risk_assessments.signals_breakdown`).
 *
 * CANONICAL CASING: camelCase. The writer (lib/services/risk-assessment.ts)
 * MUST persist keys exactly as defined here. PostgREST returns JSONB as-stored,
 * so any drift will surface as `undefined` at runtime — there is no codegen guard.
 */
export interface RiskAssessmentSignals {
  recentPnlStreak: number;
  marketContext: number;
  similarHistoryLossRate: number;
  tilt: number | null;
  propFirmRoom: number | null;
}

export interface RiskAssessmentWeights {
  recentPnlStreak: number;
  marketContext: number;
  similarHistoryLossRate: number;
  tilt: number;
  propFirmRoom: number;
}

export interface RiskAssessment {
  id: UUID;
  owner_id: UUID;
  session_id: UUID | null;
  requested_at: ISODateTime;
  candidate_symbol: string;
  candidate_side: TradeSide;
  candidate_contracts: string | null;
  risk_score: number;
  signals_breakdown: RiskAssessmentSignals;
  warning_message: string | null;
  tilt_check_id: UUID | null;
  market_snapshot: Record<string, unknown> | null;
  prop_firm_room_snapshot: Record<string, unknown> | null;
  llm_explanation: string | null;
  llm_input_snapshot: Record<string, unknown> | null;
}

export interface BehavioralProfile {
  owner_id: UUID;
  // All aggregate fields are NULL until first recompute job runs (see migration 0009 trigger).
  avg_stop_delay_score: string | null;
  avg_revenge_trade_gap_minutes: string | null;
  max_loss_streak: number;
  night_trading_ratio: string | null;
  overconfidence_score: string | null;
  total_trades: number;
  last_recomputed_at: ISODateTime | null;
}

export interface CsvUpload {
  id: UUID;
  owner_id: UUID;
  storage_path: string;
  preset_used: string | null;
  row_count: number;
  accepted_count: number;
  rejected_count: number;
  uploaded_at: ISODateTime;
}
