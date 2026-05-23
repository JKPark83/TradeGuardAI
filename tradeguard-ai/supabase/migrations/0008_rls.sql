-- 0008_rls.sql
-- TradeGuard AI — bulk RLS enable + owner_only policy for every user-data table.
--
-- Excluded:
--   * user_secrets          — has its own auth.uid() = user_id policy (0001)
--   * broker_mapping_presets — has owner + system-seed policies (0002)

BEGIN;

-- trades ---------------------------------------------------------------------
ALTER TABLE public.trades ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner_only" ON public.trades
    FOR ALL TO authenticated
    USING      (owner_id = auth.uid())
    WITH CHECK (owner_id = auth.uid());

-- market_snapshots -----------------------------------------------------------
ALTER TABLE public.market_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner_only" ON public.market_snapshots
    FOR ALL TO authenticated
    USING      (owner_id = auth.uid())
    WITH CHECK (owner_id = auth.uid());

-- trading_sessions -----------------------------------------------------------
ALTER TABLE public.trading_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner_only" ON public.trading_sessions
    FOR ALL TO authenticated
    USING      (owner_id = auth.uid())
    WITH CHECK (owner_id = auth.uid());

-- tilt_checks ----------------------------------------------------------------
ALTER TABLE public.tilt_checks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner_only" ON public.tilt_checks
    FOR ALL TO authenticated
    USING      (owner_id = auth.uid())
    WITH CHECK (owner_id = auth.uid());

-- prop_firm_profiles ---------------------------------------------------------
ALTER TABLE public.prop_firm_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner_only" ON public.prop_firm_profiles
    FOR ALL TO authenticated
    USING      (owner_id = auth.uid())
    WITH CHECK (owner_id = auth.uid());

-- analyses -------------------------------------------------------------------
ALTER TABLE public.analyses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner_only" ON public.analyses
    FOR ALL TO authenticated
    USING      (owner_id = auth.uid())
    WITH CHECK (owner_id = auth.uid());

-- risk_assessments -----------------------------------------------------------
ALTER TABLE public.risk_assessments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner_only" ON public.risk_assessments
    FOR ALL TO authenticated
    USING      (owner_id = auth.uid())
    WITH CHECK (owner_id = auth.uid());

-- behavioral_profiles --------------------------------------------------------
ALTER TABLE public.behavioral_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner_only" ON public.behavioral_profiles
    FOR ALL TO authenticated
    USING      (owner_id = auth.uid())
    WITH CHECK (owner_id = auth.uid());

-- csv_uploads ----------------------------------------------------------------
ALTER TABLE public.csv_uploads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner_only" ON public.csv_uploads
    FOR ALL TO authenticated
    USING      (owner_id = auth.uid())
    WITH CHECK (owner_id = auth.uid());

COMMIT;
