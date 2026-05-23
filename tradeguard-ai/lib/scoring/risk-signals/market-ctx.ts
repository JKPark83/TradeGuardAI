// Market-context risk signal — research.md §R-07.5 row "시장 컨텍스트 위험".
//
// Pure, deterministic mapping from a (VIX, upcoming-event) snapshot to a
// 0..100 risk signal. Rules (highest specificity wins):
//
//   1. eventType ∈ {cpi, fomc, nfp} and |offset| ≤ 60 min → 80
//   2. VIX > 30                                          → 60
//   3. VIX > 25                                          → 40
//   4. otherwise                                         → 0
//
// Why these thresholds: CPI/FOMC/NFP have empirically the largest tail-risk
// among free Finnhub categories; VIX > 30 is the canonical "vol regime
// shift" marker, 25–30 is elevated. Threshold drift here must update
// research.md AND the golden tests in lockstep.

export interface MarketContextSnapshot {
  vix: number | null;
  eventType: string | null;
  /** Minutes from now to the next high-impact event. Can be negative if recently past. */
  eventOffsetMinutes: number | null;
}

const HIGH_IMPACT_EVENTS: ReadonlySet<string> = new Set(['cpi', 'fomc', 'nfp']);
const EVENT_PROXIMITY_MIN = 60;

const SIGNAL_EVENT_NEAR = 80;
const SIGNAL_VIX_VERY_HIGH = 60;
const SIGNAL_VIX_ELEVATED = 40;

export function computeMarketContextSignal(snapshot: MarketContextSnapshot): number {
  const { vix, eventType, eventOffsetMinutes } = snapshot;

  if (
    eventType !== null &&
    HIGH_IMPACT_EVENTS.has(eventType.toLowerCase()) &&
    eventOffsetMinutes !== null &&
    Math.abs(eventOffsetMinutes) <= EVENT_PROXIMITY_MIN
  ) {
    return SIGNAL_EVENT_NEAR;
  }

  if (vix !== null && Number.isFinite(vix)) {
    if (vix > 30) return SIGNAL_VIX_VERY_HIGH;
    if (vix > 25) return SIGNAL_VIX_ELEVATED;
  }

  return 0;
}
