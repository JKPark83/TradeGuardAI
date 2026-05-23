// Supabase Edge Function (Deno runtime).
//
// For each ACTIVE prop_firm_profile, compute today's EOD balance + dailyPnL
// from realized trades and UPSERT a row into `prop_firm_eod_balances`. The
// timeline + EOD-trailing-drawdown calculator read from this table, so this
// function is the authoritative writer.
//
// Schedule (UTC midnight v1):
//   supabase functions deploy prop-firm-eod --project-ref <ref>
//   supabase functions schedule create prop-firm-eod --cron "0 0 * * *"
//
// LIMITATION (v1): cron fires at UTC midnight, not the user's local broker
// session close. Topstep / Apex / FTMO settle on US/Central daily reset;
// matching that precisely requires per-user tz storage + per-tz cron fan-out.
// Tracked separately; v1 ships with UTC and documents the discrepancy.
//
// Idempotency: the (profile_id, eod_date) unique constraint (migration 0011)
// means a re-run on the same calendar day overwrites the prior row. We use
// `upsert(..., { onConflict: 'profile_id,eod_date' })` to express this.

// @ts-nocheck — Deno globals; this file is excluded from the Next.js tsconfig.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in Edge Function env.');
}

interface ProfileRow {
  id: string;
  owner_id: string;
  account_size: string;
}

interface TradeRow {
  pnl: string | null;
  exit_at: string | null;
}

const client = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function utcDateString(d: Date): string {
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function startOfUtcDayIso(d: Date): string {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString();
}

function endOfUtcDayIso(d: Date): string {
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59, 999),
  ).toISOString();
}

async function computeForProfile(
  profile: ProfileRow,
  day: Date,
): Promise<{
  eodBalance: number;
  dailyPnl: number;
}> {
  // Cumulative PnL up to end-of-day inclusive (drives eodBalance).
  const { data: allTrades, error: e1 } = await client
    .from('trades')
    .select('pnl, exit_at')
    .eq('owner_id', profile.owner_id)
    .not('pnl', 'is', null)
    .lte('exit_at', endOfUtcDayIso(day));
  if (e1) throw e1;

  let cumulative = 0;
  let dailyPnl = 0;
  const dayStart = startOfUtcDayIso(day);
  for (const t of (allTrades ?? []) as TradeRow[]) {
    if (t.pnl === null || t.exit_at === null) continue;
    const v = Number(t.pnl);
    cumulative += v;
    if (t.exit_at >= dayStart) dailyPnl += v;
  }

  const accountSize = Number(profile.account_size);
  return { eodBalance: accountSize + cumulative, dailyPnl };
}

Deno.serve(async () => {
  const startedAt = Date.now();
  const now = new Date();
  const eodDate = utcDateString(now);

  const { data: profiles, error: pErr } = await client
    .from('prop_firm_profiles')
    .select('id, owner_id, account_size')
    .eq('is_active', true);
  if (pErr) {
    return new Response(JSON.stringify({ error: pErr.message }), { status: 500 });
  }

  let written = 0;
  let failed = 0;
  for (const profile of (profiles ?? []) as ProfileRow[]) {
    try {
      const { eodBalance, dailyPnl } = await computeForProfile(profile, now);
      const { error: upErr } = await client.from('prop_firm_eod_balances').upsert(
        {
          owner_id: profile.owner_id,
          profile_id: profile.id,
          eod_date: eodDate,
          eod_balance: eodBalance.toFixed(2),
          daily_pnl: dailyPnl.toFixed(2),
        },
        { onConflict: 'profile_id,eod_date' },
      );
      if (upErr) {
        failed++;
        continue;
      }
      written++;
    } catch {
      failed++;
    }
  }

  const body = {
    scanned: (profiles ?? []).length,
    written,
    failed,
    eodDate,
    elapsedMs: Date.now() - startedAt,
  };
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
});
