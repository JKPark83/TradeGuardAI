// API request/response types — mirror contracts/*.md.
import type {
  DrawdownType,
  FirmName,
  RetrospectiveStatus,
  RiskAssessmentSignals,
  RiskAssessmentWeights,
  TiltColor,
  TradeSide,
  UUID,
  ISODateTime,
} from './db';

export interface ApiErrorBody {
  error: string;
  requestId?: string;
  issues?: { path: string; message: string }[];
  retryAfterSeconds?: number;
  [k: string]: unknown;
}

// ---- Trades

export interface CsvUploadResponse {
  uploadId: UUID;
  presetUsed: string | null;
  rowCount: number;
  accepted: number;
  rejected: number;
  rejectedRows: { row: number; reason: string; details: string }[];
  tradeIds: UUID[];
}

export interface CsvMappingRequiredResponse {
  error: 'mapping_required';
  detectedHeaders: string[];
  suggestedFields: Record<string, string>;
}

export interface TradeSummary {
  id: UUID;
  symbol: string;
  side: TradeSide;
  entryAt: ISODateTime;
  exitAt: ISODateTime | null;
  entryPrice: number;
  exitPrice: number | null;
  contracts: number;
  pnl: number | null;
  hasMarketContext: boolean;
  latestAnalysis: { id: UUID; riskScore: number | null } | null;
}

export interface TradesListResponse {
  trades: TradeSummary[];
  nextCursor: string | null;
  summary: { total: number; winRate: number; totalPnL: number };
}

// ---- Analysis

export interface BehavioralProfileResponse {
  totalTrades: number;
  avgStopDelayScore: number;
  avgRevengeTradeGapMinutes: number;
  maxLossStreak: number;
  nightTradingRatio: number;
  overconfidenceScore: number;
  lastRecomputedAt: ISODateTime;
  minimumTradesReached: boolean;
}

export interface HourlyWinRateBucket {
  hourUtc: number;
  trades: number;
  wins: number;
  winRate: number | null;
  totalPnL: number;
}

export interface AtrBucket {
  bucket: 'low' | 'normal' | 'high';
  atrRange: [number, number | null];
  trades: number;
  winRate: number;
  totalPnL: number;
}

export interface RetrospectiveResponse {
  analysisId: UUID;
  retrospectiveText: string;
  filterPassed: boolean;
  tokenUsage: { input: number; output: number; model: string };
  inputSnapshot: { tradeId?: UUID; period?: { from: string; to: string }; anonymized: true };
  status: RetrospectiveStatus;
}

// ---- Risk

export interface RiskAssessRequest {
  candidateSymbol: string;
  candidateSide: TradeSide;
  candidateContracts?: number;
  includeLLMExplanation?: boolean;
}

export interface PropFirmRoomSummary {
  profileId: UUID;
  label: string;
  dailyLossRoom: number | null;
  drawdownRoom: number;
}

export interface SimilarPastTrade {
  tradeId: UUID;
  entryAt: ISODateTime;
  pnl: number | null;
  similarity: number;
}

export interface RiskAssessResponse {
  assessmentId: UUID;
  riskScore: number;
  signalsBreakdown: RiskAssessmentSignals;
  weights: RiskAssessmentWeights;
  warningMessage: string | null;
  tiltColor: TiltColor | 'absent';
  propFirmRoom: PropFirmRoomSummary[];
  similarPastTrades: SimilarPastTrade[];
  llmExplanation: string | null;
  warningRaisedAt: ISODateTime;
}

// ---- Sessions / Tilt

export interface ActiveSessionResponse {
  activeSession: {
    id: UUID;
    startedAt: ISODateTime;
    tiltCheck: { color: TiltColor; submittedAt: ISODateTime } | null;
  } | null;
}

export interface TiltSubmitRequest {
  sleepScore: number;
  stressScore: number;
  externalEvent?: string | null;
  externalEventSerious?: boolean;
}

export interface TiltSubmitResponse {
  tiltCheckId: UUID;
  tiltColor: TiltColor;
  rawScore: number;
  recommendations: string[];
  submittedAt: ISODateTime;
}

// ---- Prop Firm

export interface PropFirmProfileCreateRequest {
  firmName: FirmName;
  firmLabel?: string;
  accountSize: number;
  dailyLossLimit?: number | null;
  drawdownType: DrawdownType;
  drawdownLimit: number;
  warnThresholdPct?: number;
}

export interface PropFirmCurrentRoom {
  dailyLossRoom: number | null;
  dailyLossUsedPct: number | null;
  drawdownRoom: number;
  drawdownFloor: number;
  currentEquity: number;
  warningActive: boolean;
}

export interface PropFirmProfileResponse {
  id: UUID;
  firmName: FirmName;
  firmLabel: string | null;
  accountSize: number;
  drawdownType: DrawdownType;
  drawdownLimit: number;
  dailyLossLimit: number | null;
  warnThresholdPct: number;
  isActive: boolean;
  currentRoom: PropFirmCurrentRoom | null;
  lastComputedAt: ISODateTime | null;
}
