-- 0009_triggers.sql
-- TradeGuard AI — enqueue behavioral_profiles recompute when trades change.
--
-- Strategy: an AFTER INSERT/UPDATE trigger on `trades` flags the affected user's
-- behavioral_profiles row by setting last_recomputed_at = NULL. A background
-- worker / Edge Function (added later) polls for rows where last_recomputed_at
-- IS NULL and performs the actual recompute with a 30s debounce.
--
-- If the user has no behavioral_profiles row yet, we UPSERT one with zeroes so
-- the worker can still find it.

BEGIN;

CREATE OR REPLACE FUNCTION public.enqueue_behavioral_recompute()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_owner UUID;
BEGIN
    -- NEW is populated for INSERT and UPDATE; for DELETE we would use OLD,
    -- but this trigger does not fire on DELETE.
    v_owner := NEW.owner_id;

    INSERT INTO public.behavioral_profiles (owner_id, total_trades, last_recomputed_at)
    VALUES (v_owner, 0, NULL)
    ON CONFLICT (owner_id) DO UPDATE
        SET last_recomputed_at = NULL;

    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.enqueue_behavioral_recompute() IS
    'Sentinel: sets behavioral_profiles.last_recomputed_at = NULL so a background job picks the user up for recompute.';

DROP TRIGGER IF EXISTS trades_recompute_trigger ON public.trades;

CREATE TRIGGER trades_recompute_trigger
    AFTER INSERT OR UPDATE ON public.trades
    FOR EACH ROW
    EXECUTE FUNCTION public.enqueue_behavioral_recompute();

COMMIT;
