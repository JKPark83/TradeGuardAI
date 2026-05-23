-- 0002_broker_presets.sql
-- TradeGuard AI — broker CSV column-mapping presets.
-- owner_id IS NULL = system seed (ebest / ninjatrader / tradingview).
-- owner_id = auth.uid() = user-defined mapping.

BEGIN;

CREATE TABLE IF NOT EXISTS public.broker_mapping_presets (
    id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id             UUID        NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    preset_name          TEXT        NOT NULL,
    header_signature     TEXT[]      NOT NULL DEFAULT '{}',
    column_mapping       JSONB       NOT NULL,
    time_format          TEXT        NOT NULL,
    pnl_sign_convention  TEXT        NOT NULL DEFAULT 'broker_native'
        CHECK (pnl_sign_convention IN ('broker_native', 'computed')),
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- UNIQUE per owner — system seeds (owner_id IS NULL) form their own bucket.
CREATE UNIQUE INDEX IF NOT EXISTS broker_mapping_presets_owner_name_uniq
    ON public.broker_mapping_presets (owner_id, preset_name);

COMMENT ON TABLE public.broker_mapping_presets IS
    'CSV column mapping presets. Rows with owner_id IS NULL are system seeds, visible to all authenticated users.';

ALTER TABLE public.broker_mapping_presets ENABLE ROW LEVEL SECURITY;

-- System seeds: any authenticated user may SELECT.
CREATE POLICY "broker_presets_select_system_seeds"
    ON public.broker_mapping_presets
    FOR SELECT
    TO authenticated
    USING (owner_id IS NULL);

-- Owner: full CRUD over their own rows.
CREATE POLICY "broker_presets_owner_select"
    ON public.broker_mapping_presets
    FOR SELECT
    TO authenticated
    USING (owner_id = auth.uid());

CREATE POLICY "broker_presets_owner_insert"
    ON public.broker_mapping_presets
    FOR INSERT
    TO authenticated
    WITH CHECK (owner_id = auth.uid());

CREATE POLICY "broker_presets_owner_update"
    ON public.broker_mapping_presets
    FOR UPDATE
    TO authenticated
    USING (owner_id = auth.uid())
    WITH CHECK (owner_id = auth.uid());

CREATE POLICY "broker_presets_owner_delete"
    ON public.broker_mapping_presets
    FOR DELETE
    TO authenticated
    USING (owner_id = auth.uid());

COMMIT;
