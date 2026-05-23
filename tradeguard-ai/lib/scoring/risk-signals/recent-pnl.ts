// Recent PnL streak signal — research.md §R-07.5 row "직전 N=2시간 손익 흐름".
//
// Counts consecutive *most recent* losing trades inside a rolling window and
// maps the streak length to a 0..100 signal. Pure, deterministic, no I/O.
//
// Mapping (per task brief / R-07.5):
//   0 losses → 0
//   1 loss   → 30
//   2 losses → 60
//   3+ losses → 90
//
// "Streak" means consecutive trailing losses ending at the most recent
// closed trade in the window. A profitable trade breaks the streak — older
// losses before that profit are NOT counted.

export interface RecentPnlStreakArgs {
  /** Recent trades; only `pnl` and `exit_at` are inspected. Order-agnostic. */
  recentTrades: { pnl: number | null; exit_at: string | null }[];
  /** "Now" as an ISO 8601 UTC timestamp (callers pass `new Date().toISOString()`). */
  nowUtcIso: string;
  /** Sliding window in hours (e.g. 2 per R-07.5). */
  windowHours: number;
}

const LEVEL_AT: ReadonlyArray<{ losses: number; signal: number }> = [
  { losses: 0, signal: 0 },
  { losses: 1, signal: 30 },
  { losses: 2, signal: 60 },
  { losses: 3, signal: 90 },
];

function streakToSignal(streak: number): number {
  if (streak <= 0) return 0;
  for (let i = LEVEL_AT.length - 1; i >= 0; i -= 1) {
    if (streak >= LEVEL_AT[i].losses) return LEVEL_AT[i].signal;
  }
  return 0;
}

/**
 * Compute the recent-PnL-streak signal.
 *
 * Algorithm:
 *   1. Filter trades to those with `exit_at` inside (now - windowHours, now].
 *   2. Sort by exit_at descending (most recent first).
 *   3. Walk the list; count trailing losses (pnl < 0) until a non-loss breaks
 *      the streak.
 *   4. Map the count via the level table.
 */
export function computeRecentPnlStreakSignal(args: RecentPnlStreakArgs): number {
  const { recentTrades, nowUtcIso, windowHours } = args;
  if (windowHours <= 0) return 0;
  if (!recentTrades || recentTrades.length === 0) return 0;

  const nowMs = new Date(nowUtcIso).getTime();
  if (!Number.isFinite(nowMs)) return 0;
  const cutoffMs = nowMs - windowHours * 60 * 60 * 1000;

  const inWindow: { pnl: number; exitMs: number }[] = [];
  for (const t of recentTrades) {
    if (t.exit_at === null || t.pnl === null) continue;
    const ms = new Date(t.exit_at).getTime();
    if (!Number.isFinite(ms)) continue;
    if (ms <= cutoffMs || ms > nowMs) continue;
    inWindow.push({ pnl: t.pnl, exitMs: ms });
  }
  if (inWindow.length === 0) return 0;

  inWindow.sort((a, b) => b.exitMs - a.exitMs);

  let streak = 0;
  for (const t of inWindow) {
    if (t.pnl < 0) {
      streak += 1;
    } else {
      break;
    }
  }
  return streakToSignal(streak);
}
