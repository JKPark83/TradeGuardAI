// Repository for `broker_mapping_presets`.
// System seeds (owner_id IS NULL) are visible to every authenticated user via RLS.
// User custom presets are owner-scoped.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { BrokerMappingPreset, PnlSignConvention, UUID } from '@/types/db';

export interface CreatePresetDto {
  preset_name: string;
  header_signature: string[];
  column_mapping: Record<string, string>;
  time_format: string;
  pnl_sign_convention: PnlSignConvention;
}

export async function listPresets(
  supabase: SupabaseClient,
  ownerId: UUID,
): Promise<BrokerMappingPreset[]> {
  // RLS policy already allows: owner_id IS NULL (system) OR owner_id = auth.uid().
  // We re-state the OR explicitly so the query intent is obvious to readers.
  const { data, error } = await supabase
    .from('broker_mapping_presets')
    .select('*')
    .or(`owner_id.is.null,owner_id.eq.${ownerId}`)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as BrokerMappingPreset[];
}

export async function createPreset(
  supabase: SupabaseClient,
  ownerId: UUID,
  dto: CreatePresetDto,
): Promise<BrokerMappingPreset> {
  const { data, error } = await supabase
    .from('broker_mapping_presets')
    .insert({ ...dto, owner_id: ownerId })
    .select('*')
    .single<BrokerMappingPreset>();
  if (error) throw error;
  return data;
}

export async function findPresetByName(
  supabase: SupabaseClient,
  ownerId: UUID,
  presetName: string,
): Promise<BrokerMappingPreset | null> {
  const { data, error } = await supabase
    .from('broker_mapping_presets')
    .select('*')
    .or(`owner_id.is.null,owner_id.eq.${ownerId}`)
    .eq('preset_name', presetName)
    .maybeSingle<BrokerMappingPreset>();
  if (error) throw error;
  return data;
}
