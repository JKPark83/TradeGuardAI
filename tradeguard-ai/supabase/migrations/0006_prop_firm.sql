-- 0006_prop_firm.sql
-- TradeGuard AI — funded-account rulesets registered by the user.

BEGIN;

CREATE TABLE IF NOT EXISTS public.prop_firm_profiles (
    id                  UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id            UUID            NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    firm_name           TEXT            NOT NULL
        CHECK (firm_name IN ('topstep', 'apex', 'ftmo', 'fundednext', 'other')),
    firm_label          TEXT            NULL,
    account_size        NUMERIC(14, 2)  NOT NULL,
    daily_loss_limit    NUMERIC(14, 2)  NULL,
    drawdown_type       TEXT            NOT NULL
        CHECK (drawdown_type IN ('static', 'eod_trailing', 'intraday_trailing')),
    drawdown_limit      NUMERIC(14, 2)  NOT NULL,
    warn_threshold_pct  NUMERIC(4, 2)   NOT NULL DEFAULT 0.80,
    is_active           BOOLEAN         NOT NULL DEFAULT true,
    created_at          TIMESTAMPTZ     NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.prop_firm_profiles IS
    'Funded-account ruleset. Soft-delete via is_active=false; hard delete only on explicit user request.';

CREATE INDEX IF NOT EXISTS prop_firm_profiles_owner_active_idx
    ON public.prop_firm_profiles (owner_id, is_active);

COMMIT;
