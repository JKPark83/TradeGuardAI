// CSV upload pipeline. Parses → maps via preset (auto-detect or explicit) →
// validates each row → inserts accepted trades → records audit row. Best-effort
// stores the raw CSV in Supabase Storage but does NOT fail the upload if that
// store fails (auditability is a stretch goal; correctness of data is critical).

import type { SupabaseClient } from '@supabase/supabase-js';
import type { PnlSignConvention, TradeSide, UUID } from '@/types/db';
import type { CsvMappingRequiredResponse, CsvUploadResponse } from '@/types/api';
import { parseCsv } from '@/lib/csv/parser';
import {
  applyPreset,
  detectPreset,
  type BrokerPreset,
  type NormalizedTradeRow,
  type PresetField,
} from '@/lib/csv/presets';
import { validateNormalizedRow } from '@/lib/csv/validate';
import { insertTrades, type NewTrade } from '@/lib/repositories/trades';
import { findPresetByName } from '@/lib/repositories/mapping-presets';
import { logger } from '@/lib/utils/logger';

const STORAGE_BUCKET = 'csv-upload';

const DEFAULT_SIDE_VALUE_MAP: Record<string, TradeSide> = {
  long: 'long',
  Long: 'long',
  LONG: 'long',
  buy: 'long',
  Buy: 'long',
  BUY: 'long',
  short: 'short',
  Short: 'short',
  SHORT: 'short',
  sell: 'short',
  Sell: 'short',
  SELL: 'short',
};

export interface CsvUploadParams {
  supabase: SupabaseClient;
  ownerId: UUID;
  fileText: string;
  presetName?: string;
  mappingOverride?: Record<string, string>;
}

export async function handleCsvUpload(
  params: CsvUploadParams,
): Promise<CsvUploadResponse | CsvMappingRequiredResponse> {
  const { supabase, ownerId, fileText, presetName, mappingOverride } = params;

  const parsed = parseCsv(fileText);

  // 1) Resolve mapping: explicit name > explicit override > auto-detect.
  let preset: BrokerPreset | null = null;
  if (presetName) {
    const stored = await findPresetByName(supabase, ownerId, presetName);
    if (stored) {
      preset = toBrokerPreset({
        preset_name: stored.preset_name,
        header_signature: stored.header_signature,
        column_mapping: stored.column_mapping,
        time_format: stored.time_format,
        pnl_sign_convention: stored.pnl_sign_convention,
      });
    }
  }
  if (!preset && mappingOverride) {
    preset = {
      name: 'custom-override',
      headerSignature: parsed.headers,
      columnMapping: mappingOverride as Record<PresetField, string>,
      timeFormat: 'iso',
      pnlSignConvention: 'broker_native',
      sideValueMap: DEFAULT_SIDE_VALUE_MAP,
    };
  }
  if (!preset) {
    const match = detectPreset(parsed.headers);
    preset = match?.preset ?? null;
  }

  if (!preset) {
    return {
      error: 'mapping_required',
      detectedHeaders: parsed.headers,
      suggestedFields: {},
    };
  }

  // 2) Apply preset → normalized rows. applyPreset may throw on unknown side.
  let normalized: NormalizedTradeRow[];
  try {
    normalized = applyPreset(parsed.rows, preset);
  } catch (err) {
    logger.warn('csv_apply_preset_failed', {
      message: err instanceof Error ? err.message : String(err),
    });
    return {
      error: 'mapping_required',
      detectedHeaders: parsed.headers,
      suggestedFields: {},
    };
  }

  // 3) Validate each normalized row; split accepted/rejected.
  const accepted: NormalizedTradeRow[] = [];
  const rejected: { row: number; reason: string; details: string }[] = [];
  for (const row of normalized) {
    const result = validateNormalizedRow(row);
    if (result.ok) {
      accepted.push(row);
    } else {
      rejected.push({
        // `source_row` from applyPreset is 1-based with the header as row 0,
        // so the value already equals the CSV line number minus 1. To get the
        // actual CSV line (1-based) we'd add 1, but users typically refer to
        // data rows starting from 1 = "first data row" — match that.
        row: row.source_row,
        reason: result.reason,
        details: result.details,
      });
    }
  }

  // 4) Insert accepted trades.
  const tradesToInsert: NewTrade[] = accepted.map<NewTrade>((r) => ({
    symbol: r.symbol,
    side: r.side,
    entry_price: r.entry_price,
    exit_price: r.exit_price,
    entry_at: r.entry_at,
    exit_at: r.exit_at,
    pnl: r.pnl,
    contracts: r.contracts,
    source_row: r.source_row,
  }));
  const { inserted, duplicates } = await insertTrades(supabase, ownerId, tradesToInsert);

  // 5) Audit row + best-effort raw CSV upload.
  const { data: uploadRow, error: uErr } = await supabase
    .from('csv_uploads')
    .insert({
      owner_id: ownerId,
      storage_path: '',
      preset_used: preset.name,
      row_count: normalized.length,
      accepted_count: inserted.length,
      rejected_count: rejected.length + duplicates,
    })
    .select('id')
    .single<{ id: UUID }>();
  if (uErr) throw uErr;
  const uploadId = uploadRow.id;

  const storagePath = `${ownerId}/${uploadId}.csv`;
  try {
    const blob = new Blob([fileText], { type: 'text/csv' });
    const { error: stErr } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(storagePath, blob, { upsert: false, contentType: 'text/csv' });
    if (stErr) {
      logger.warn('csv_storage_upload_failed', { uploadId, message: stErr.message });
    } else {
      await supabase.from('csv_uploads').update({ storage_path: storagePath }).eq('id', uploadId);
    }
  } catch (err) {
    logger.warn('csv_storage_upload_threw', {
      uploadId,
      message: err instanceof Error ? err.message : String(err),
    });
  }

  return {
    uploadId,
    presetUsed: preset.name,
    rowCount: normalized.length,
    accepted: inserted.length,
    rejected: rejected.length + duplicates,
    rejectedRows: rejected,
    tradeIds: inserted.map((t) => t.id),
  };
}

function toBrokerPreset(stored: {
  preset_name: string;
  header_signature: string[];
  column_mapping: Record<string, string>;
  time_format: string;
  pnl_sign_convention: PnlSignConvention;
}): BrokerPreset {
  return {
    name: stored.preset_name,
    headerSignature: stored.header_signature,
    columnMapping: stored.column_mapping as Record<PresetField, string>,
    timeFormat: stored.time_format,
    pnlSignConvention: stored.pnl_sign_convention,
    sideValueMap: DEFAULT_SIDE_VALUE_MAP,
  };
}
