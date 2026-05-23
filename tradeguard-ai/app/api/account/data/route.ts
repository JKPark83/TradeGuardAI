// DELETE /api/account/data — wipe all of the current user's TradeGuard data.
//
// Per spec FR-019 and SC-006: a single confirmed call must remove every row
// the authenticated user owns across trades, market_snapshots, analyses,
// risk_assessments, trading_sessions, tilt_checks, prop_firm_profiles,
// behavioral_profiles, broker_mapping_presets (user-defined only), and the
// CSV files stored under `csv-upload/{user_id}/`. The user_secret is rotated
// (deleted + recreated on next login) so any historical anonymization tokens
// become unrecoverable.
//
// Auth account itself (Supabase `auth.users`) is preserved — full account
// deletion is a separate Supabase dashboard action.

import { z } from 'zod';
import { randomBytes } from 'node:crypto';

import { createClient } from '@/lib/supabase/server';
import { toApiResponse, unauthenticated, validationError } from '@/lib/utils/api-error';
import { withRequestId } from '@/lib/utils/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CONFIRM_TOKEN = 'DELETE_ALL_MY_TRADEGUARD_DATA';

const bodySchema = z.object({
  confirm: z.literal(CONFIRM_TOKEN),
});

/**
 * Tables to purge, in FK-safe order (children before parents).
 * Each row is deleted via `eq('owner_id', user.id)` — RLS would already
 * scope this, but the explicit predicate guards against any future RLS
 * regression and makes the intent obvious to readers.
 */
const PURGE_TABLES = [
  'market_snapshots',
  'analyses',
  'risk_assessments',
  'tilt_checks',
  'trading_sessions',
  'prop_firm_eod_balances',
  'prop_firm_profiles',
  'behavioral_profiles',
  // csv_uploads is purged AFTER trades because `trades.source_csv_id`
  // references it (ON DELETE SET NULL, but cleaner to keep order anyway).
  'trades',
  'csv_uploads',
] as const;

interface DeletionCounts {
  trades: number;
  marketSnapshots: number;
  analyses: number;
  riskAssessments: number;
  tradingSessions: number;
  tiltChecks: number;
  propFirmProfiles: number;
  propFirmEodBalances: number;
  csvUploads: number;
  behavioralProfile: number;
  brokerMappingPresets: number;
  storageFiles: number;
}

export async function DELETE(req: Request): Promise<Response> {
  const requestId = crypto.randomUUID();
  const log = withRequestId(requestId);

  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return unauthenticated();

    // Parse + validate confirm token
    let raw: unknown = {};
    try {
      raw = await req.json();
    } catch {
      return validationError([{ path: 'body', message: 'invalid JSON' }]);
    }
    const parsed = bodySchema.safeParse(raw);
    if (!parsed.success) {
      return validationError([
        {
          path: 'confirm',
          message: `must equal "${CONFIRM_TOKEN}" to authorize destructive delete`,
        },
      ]);
    }

    log.warn('account_data_purge_started', { ownerId: user.id });

    // Count rows BEFORE delete so the response can quote concrete numbers.
    // Each count uses head:true to avoid pulling the rows themselves.
    const counts = await collectCounts(supabase, user.id);

    // ---- 1. Purge per-table rows ------------------------------------------
    for (const table of PURGE_TABLES) {
      const { error } = await supabase.from(table).delete().eq('owner_id', user.id);
      if (error) {
        log.error('account_data_purge_table_failed', { table, message: error.message });
        throw new Error(`purge failed on ${table}: ${error.message}`);
      }
    }

    // ---- 2. Purge user-defined broker mapping presets ---------------------
    // System seeds (owner_id IS NULL) are intentionally preserved.
    const { error: mapErr } = await supabase
      .from('broker_mapping_presets')
      .delete()
      .eq('owner_id', user.id);
    if (mapErr) {
      log.error('account_data_purge_table_failed', {
        table: 'broker_mapping_presets',
        message: mapErr.message,
      });
      throw new Error(`purge failed on broker_mapping_presets: ${mapErr.message}`);
    }

    // ---- 3. Purge Storage CSV files under {user.id}/ ----------------------
    const storageFiles = await purgeStorageFolder(supabase, user.id, log);

    // ---- 4. Rotate the PII HMAC secret ------------------------------------
    // Delete the row outright; ensureUserSecret on next login will mint a
    // fresh one. This invalidates any past anonymization tokens.
    const { error: secretErr } = await supabase
      .from('user_secrets')
      .delete()
      .eq('user_id', user.id);
    if (secretErr) {
      log.error('account_data_secret_rotation_failed', { message: secretErr.message });
      // Don't throw — the data purge already succeeded. Surface the issue
      // via response field so the user can re-trigger if needed.
    }
    const rotated = secretErr === null;

    // Insert a NEW secret immediately so subsequent server actions don't
    // race against the next login.
    if (rotated) {
      const newSecret = randomBytes(32).toString('hex');
      const { error: insertErr } = await supabase
        .from('user_secrets')
        .insert({ user_id: user.id, pii_hmac_secret: newSecret });
      if (insertErr && insertErr.code !== '23505') {
        log.error('account_data_secret_reinsert_failed', { message: insertErr.message });
      }
    }

    log.warn('account_data_purge_completed', { ownerId: user.id, counts });

    const responseBody = {
      deleted: {
        trades: counts.trades,
        marketSnapshots: counts.marketSnapshots,
        analyses: counts.analyses,
        riskAssessments: counts.riskAssessments,
        tradingSessions: counts.tradingSessions,
        tiltChecks: counts.tiltChecks,
        propFirmProfiles: counts.propFirmProfiles,
        propFirmEodBalances: counts.propFirmEodBalances,
        csvUploads: counts.csvUploads,
        behavioralProfile: counts.behavioralProfile,
        brokerMappingPresets: counts.brokerMappingPresets,
        storageFiles,
      },
      userSecretsRotated: rotated,
      completedAt: new Date().toISOString(),
    };

    return new Response(JSON.stringify(responseBody), {
      status: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  } catch (err) {
    log.error('account_data_purge_failed', {
      message: err instanceof Error ? err.message : String(err),
    });
    return toApiResponse(err, requestId);
  }
}

// ─── helpers ──────────────────────────────────────────────────────────────

type CountClient = Awaited<ReturnType<typeof createClient>>;

async function countTable(supabase: CountClient, table: string, ownerId: string): Promise<number> {
  const { count } = await supabase
    .from(table)
    .select('*', { head: true, count: 'exact' })
    .eq('owner_id', ownerId);
  return count ?? 0;
}

async function collectCounts(supabase: CountClient, ownerId: string): Promise<DeletionCounts> {
  const [
    trades,
    marketSnapshots,
    analyses,
    riskAssessments,
    tradingSessions,
    tiltChecks,
    propFirmProfiles,
    propFirmEodBalances,
    csvUploads,
    behavioralProfile,
    brokerMappingPresets,
  ] = await Promise.all([
    countTable(supabase, 'trades', ownerId),
    countTable(supabase, 'market_snapshots', ownerId),
    countTable(supabase, 'analyses', ownerId),
    countTable(supabase, 'risk_assessments', ownerId),
    countTable(supabase, 'trading_sessions', ownerId),
    countTable(supabase, 'tilt_checks', ownerId),
    countTable(supabase, 'prop_firm_profiles', ownerId),
    countTable(supabase, 'prop_firm_eod_balances', ownerId),
    countTable(supabase, 'csv_uploads', ownerId),
    countTable(supabase, 'behavioral_profiles', ownerId),
    countTable(supabase, 'broker_mapping_presets', ownerId),
  ]);

  return {
    trades,
    marketSnapshots,
    analyses,
    riskAssessments,
    tradingSessions,
    tiltChecks,
    propFirmProfiles,
    propFirmEodBalances,
    csvUploads,
    behavioralProfile,
    brokerMappingPresets,
    storageFiles: 0,
  };
}

async function purgeStorageFolder(
  supabase: CountClient,
  ownerId: string,
  log: { error: (msg: string, fields?: Record<string, unknown>) => void },
): Promise<number> {
  try {
    const { data: files, error: listErr } = await supabase.storage
      .from('csv-upload')
      .list(ownerId, { limit: 1000 });
    if (listErr) {
      log.error('account_data_storage_list_failed', { message: listErr.message });
      return 0;
    }
    if (!files || files.length === 0) return 0;

    const paths = files.map((f) => `${ownerId}/${f.name}`);
    const { error: removeErr } = await supabase.storage.from('csv-upload').remove(paths);
    if (removeErr) {
      log.error('account_data_storage_remove_failed', { message: removeErr.message });
      return 0;
    }
    return paths.length;
  } catch (err) {
    log.error('account_data_storage_unexpected', {
      message: err instanceof Error ? err.message : String(err),
    });
    return 0;
  }
}
