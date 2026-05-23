-- 0011_prop_firm_eod.sql
-- TradeGuard AI — daily EOD balance snapshots per prop-firm profile.
--
-- Fed by `supabase/functions/prop-firm-eod` running on a daily cron. The
-- timeline endpoint reads from this table; the live `currentRoom` calculator
-- also reads it as the source of truth for the EOD-trailing drawdown peak.

BEGIN;

CREATE TABLE IF NOT EXISTS public.prop_firm_eod_balances (
    id           UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id     UUID            NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    profile_id   UUID            NOT NULL REFERENCES public.prop_firm_profiles(id) ON DELETE CASCADE,
    eod_date     DATE            NOT NULL,
    eod_balance  NUMERIC(14, 2)  NOT NULL,
    daily_pnl    NUMERIC(14, 2)  NOT NULL,
    created_at   TIMESTAMPTZ     NOT NULL DEFAULT now(),
    UNIQUE (profile_id, eod_date)
);

COMMENT ON TABLE public.prop_firm_eod_balances IS
    'Daily EOD snapshot per prop-firm profile. Fed by the prop-firm-eod edge function.';

CREATE INDEX IF NOT EXISTS prop_firm_eod_balances_owner_profile_date_idx
    ON public.prop_firm_eod_balances (owner_id, profile_id, eod_date DESC);

-- RLS: owner-only.
ALTER TABLE public.prop_firm_eod_balances ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner_only" ON public.prop_firm_eod_balances
    FOR ALL TO authenticated
    USING      (owner_id = auth.uid())
    WITH CHECK (owner_id = auth.uid());

COMMIT;
