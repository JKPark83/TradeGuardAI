// Repository for `prop_firm_profiles`. Owner-scoped CRUD; soft-delete via
// `is_active = false`. Like other repos in this codebase, the caller passes
// `ownerId` explicitly so authorization stays at the route boundary.
//
// NUMERIC columns are persisted as strings (PostgREST round-trip semantics);
// input from the API is numeric, so we toFixed at the write boundary.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { DrawdownType, FirmName, PropFirmProfile, UUID } from '@/types/db';

const DEFAULT_WARN_THRESHOLD = 0.8;

export interface NewPropFirmProfileInput {
  firmName: FirmName;
  firmLabel?: string | null;
  accountSize: number;
  dailyLossLimit?: number | null;
  drawdownType: DrawdownType;
  drawdownLimit: number;
  warnThresholdPct?: number;
}

export interface UpdatePropFirmProfileInput {
  firmName?: FirmName;
  firmLabel?: string | null;
  accountSize?: number;
  dailyLossLimit?: number | null;
  drawdownType?: DrawdownType;
  drawdownLimit?: number;
  warnThresholdPct?: number;
  isActive?: boolean;
}

function toRow(input: NewPropFirmProfileInput, ownerId: UUID): Record<string, unknown> {
  return {
    owner_id: ownerId,
    firm_name: input.firmName,
    firm_label: input.firmLabel ?? null,
    account_size: input.accountSize.toFixed(2),
    daily_loss_limit:
      input.dailyLossLimit === null || input.dailyLossLimit === undefined
        ? null
        : input.dailyLossLimit.toFixed(2),
    drawdown_type: input.drawdownType,
    drawdown_limit: input.drawdownLimit.toFixed(2),
    warn_threshold_pct: (input.warnThresholdPct ?? DEFAULT_WARN_THRESHOLD).toFixed(2),
    is_active: true,
  };
}

function toPatch(input: UpdatePropFirmProfileInput): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  if (input.firmName !== undefined) patch.firm_name = input.firmName;
  if (input.firmLabel !== undefined) patch.firm_label = input.firmLabel;
  if (input.accountSize !== undefined) patch.account_size = input.accountSize.toFixed(2);
  if (input.dailyLossLimit !== undefined) {
    patch.daily_loss_limit = input.dailyLossLimit === null ? null : input.dailyLossLimit.toFixed(2);
  }
  if (input.drawdownType !== undefined) patch.drawdown_type = input.drawdownType;
  if (input.drawdownLimit !== undefined) patch.drawdown_limit = input.drawdownLimit.toFixed(2);
  if (input.warnThresholdPct !== undefined) {
    patch.warn_threshold_pct = input.warnThresholdPct.toFixed(2);
  }
  if (input.isActive !== undefined) patch.is_active = input.isActive;
  return patch;
}

export async function createProfile(
  supabase: SupabaseClient,
  ownerId: UUID,
  input: NewPropFirmProfileInput,
): Promise<PropFirmProfile> {
  const { data, error } = await supabase
    .from('prop_firm_profiles')
    .insert(toRow(input, ownerId))
    .select('*')
    .single<PropFirmProfile>();
  if (error) throw error;
  return data;
}

export async function listProfiles(
  supabase: SupabaseClient,
  ownerId: UUID,
  includeInactive = false,
): Promise<PropFirmProfile[]> {
  let q = supabase
    .from('prop_firm_profiles')
    .select('*')
    .eq('owner_id', ownerId)
    .order('created_at', { ascending: false });
  if (!includeInactive) q = q.eq('is_active', true);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as PropFirmProfile[];
}

export async function getProfile(
  supabase: SupabaseClient,
  ownerId: UUID,
  profileId: UUID,
): Promise<PropFirmProfile | null> {
  const { data, error } = await supabase
    .from('prop_firm_profiles')
    .select('*')
    .eq('owner_id', ownerId)
    .eq('id', profileId)
    .maybeSingle<PropFirmProfile>();
  if (error) throw error;
  return data;
}

export async function updateProfile(
  supabase: SupabaseClient,
  ownerId: UUID,
  profileId: UUID,
  patch: UpdatePropFirmProfileInput,
): Promise<PropFirmProfile> {
  const body = toPatch(patch);
  const { data, error } = await supabase
    .from('prop_firm_profiles')
    .update(body)
    .eq('owner_id', ownerId)
    .eq('id', profileId)
    .select('*')
    .single<PropFirmProfile>();
  if (error) throw error;
  return data;
}

/** Soft-delete: flips is_active=false. Hard-delete is reserved for the
 *  account-wipe flow (FR-019). */
export async function deactivateProfile(
  supabase: SupabaseClient,
  ownerId: UUID,
  profileId: UUID,
): Promise<void> {
  const { error } = await supabase
    .from('prop_firm_profiles')
    .update({ is_active: false })
    .eq('owner_id', ownerId)
    .eq('id', profileId);
  if (error) throw error;
}
