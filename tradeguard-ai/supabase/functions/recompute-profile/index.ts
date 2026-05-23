// Supabase Edge Function (Deno runtime).
//
// Scans `behavioral_profiles` for rows with `last_recomputed_at IS NULL`
// (sentinel value meaning "recompute queued by trigger"), recomputes the
// aggregate, and writes back. Intended to be invoked on a schedule
// (cron via supabase.toml) — typically every 30s as per data-model.md.
//
// Deploy:
//   supabase functions deploy recompute-profile --project-ref <ref>
//   supabase functions schedule create recompute-profile --cron "*/1 * * * *"
//
// Local invoke:
//   supabase functions serve recompute-profile --env-file .env.local
//   curl -X POST http://localhost:54321/functions/v1/recompute-profile \
//     -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY"
//
// Why a separate function and not a route: this runs with the SERVICE ROLE
// key (RLS bypass) so it can recompute on behalf of all users in one pass.
// Never expose this endpoint publicly — Supabase Functions guard it with the
// anon/service JWT by default; we also assert in code.

// @ts-nocheck — Deno globals; this file is excluded from the Next.js tsconfig.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in Edge Function env.');
}

interface ProfileRow {
  owner_id: string;
  last_recomputed_at: string | null;
}

interface TradeRow {
  id: string;
  side: 'long' | 'short';
  entry_at: string;
  exit_at: string | null;
  pnl: string | null;
  contracts: string;
}

interface AnalysisRow {
  trade_id: string;
  stop_delay_score: number | null;
  revenge_score: number | null;
  overconfidence_score: number | null;
  created_at: string;
}

// Re-implements the night-trading + streak + averages logic from
// lib/scoring/behavioral-aggregates.ts so the Edge Function has zero
// dependency on app-side modules (different runtime, different import map).

function computeAggregate(trades: TradeRow[], analyses: AnalysisRow[]) {
  const total = trades.length;
  const closed = trades.filter((t) => t.pnl !== null);

  // Sort by entry_at to match app-side lib/scoring/behavioral-aggregates.ts.
  // SC-002 requires byte-identical results — both paths MUST sort identically.
  let maxStreak = 0;
  let cur = 0;
  const sortedByEntry = [...closed].sort((a, b) => {
    if (a.entry_at === b.entry_at) {
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    }
    return a.entry_at < b.entry_at ? -1 : 1;
  });
  for (const t of sortedByEntry) {
    if (Number(t.pnl) < 0) {
      cur++;
      if (cur > maxStreak) maxStreak = cur;
    } else {
      cur = 0;
    }
  }

  let night = 0;
  for (const t of trades) {
    const h = new Date(t.entry_at).getUTCHours();
    if (h >= 22 || h < 6) night++;
  }
  const nightRatio = total > 0 ? night / total : null;

  const latestByTrade = new Map<string, AnalysisRow>();
  for (const a of analyses) {
    if (!latestByTrade.has(a.trade_id)) latestByTrade.set(a.trade_id, a);
  }
  const stopScores: number[] = [];
  const revScores: number[] = [];
  const confScores: number[] = [];
  for (const a of latestByTrade.values()) {
    if (a.stop_delay_score !== null) stopScores.push(a.stop_delay_score);
    if (a.revenge_score !== null) revScores.push(a.revenge_score);
    if (a.overconfidence_score !== null) confScores.push(a.overconfidence_score);
  }
  const mean = (xs: number[]) =>
    xs.length === 0 ? null : xs.reduce((s, x) => s + x, 0) / xs.length;

  const sortedByEntry = [...closed].sort((a, b) => a.entry_at.localeCompare(b.entry_at));
  const gaps: number[] = [];
  for (let i = 1; i < sortedByEntry.length; i++) {
    const prev = sortedByEntry[i - 1];
    if (prev.pnl !== null && Number(prev.pnl) < 0) {
      const gapMin =
        (new Date(sortedByEntry[i].entry_at).getTime() -
          new Date(prev.exit_at ?? prev.entry_at).getTime()) /
        60_000;
      if (gapMin >= 0) gaps.push(gapMin);
    }
  }

  return {
    total_trades: total,
    max_loss_streak: maxStreak,
    night_trading_ratio: nightRatio === null ? null : nightRatio.toFixed(3),
    avg_stop_delay_score: mean(stopScores)?.toFixed(2) ?? null,
    avg_revenge_trade_gap_minutes: mean(gaps)?.toFixed(2) ?? null,
    overconfidence_score: mean(confScores)?.toFixed(2) ?? null,
  };
}

const client = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

Deno.serve(async () => {
  const startedAt = Date.now();
  const { data: queued, error: qErr } = await client
    .from('behavioral_profiles')
    .select('owner_id, last_recomputed_at')
    .is('last_recomputed_at', null);
  if (qErr) {
    return new Response(JSON.stringify({ error: qErr.message }), { status: 500 });
  }
  const rows = (queued ?? []) as ProfileRow[];
  let updated = 0;
  for (const row of rows) {
    const ownerId = row.owner_id;
    const [{ data: trades, error: tErr }, { data: analyses, error: aErr }] = await Promise.all([
      client
        .from('trades')
        .select('id, side, entry_at, exit_at, pnl, contracts')
        .eq('owner_id', ownerId),
      client
        .from('analyses')
        .select('trade_id, stop_delay_score, revenge_score, overconfidence_score, created_at')
        .eq('owner_id', ownerId)
        .order('created_at', { ascending: false }),
    ]);
    if (tErr || aErr) continue;
    const aggregate = computeAggregate(
      (trades ?? []) as TradeRow[],
      (analyses ?? []) as AnalysisRow[],
    );
    const { error: upErr } = await client
      .from('behavioral_profiles')
      .update({ ...aggregate, last_recomputed_at: new Date().toISOString() })
      .eq('owner_id', ownerId);
    if (!upErr) updated++;
  }
  const body = { scanned: rows.length, updated, elapsedMs: Date.now() - startedAt };
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
});
