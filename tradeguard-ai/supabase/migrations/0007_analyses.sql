-- 0007_analyses.sql
-- TradeGuard AI — post-trade analyses, real-time risk assessments,
-- per-user behavioral profile aggregate, and CSV upload audit log.

BEGIN;

-- ---------------------------------------------------------------------------
-- analyses: per-trade quant scores + AI retrospective. Multiple rows per trade
-- are allowed so we can keep history if a retro is regenerated.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.analyses (
    id                    UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    trade_id              UUID         NOT NULL REFERENCES public.trades(id) ON DELETE CASCADE,
    owner_id              UUID         NOT NULL REFERENCES auth.users(id)   ON DELETE CASCADE,
    stop_delay_score      SMALLINT     NULL CHECK (stop_delay_score     BETWEEN 0 AND 100),
    revenge_score         SMALLINT     NULL CHECK (revenge_score        BETWEEN 0 AND 100),
    overconfidence_score  SMALLINT     NULL CHECK (overconfidence_score BETWEEN 0 AND 100),
    risk_score            SMALLINT     NULL CHECK (risk_score           BETWEEN 0 AND 100),
    retrospective_text    TEXT         NULL,
    retrospective_status  TEXT         NOT NULL
        CHECK (retrospective_status IN ('pending', 'generated', 'failed', 'filtered_out')),
    llm_input_snapshot    JSONB        NULL,
    llm_token_usage       JSONB        NULL,
    created_at            TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS analyses_trade_created_idx
    ON public.analyses (trade_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- risk_assessments: real-time pre-entry risk score.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.risk_assessments (
    id                       UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id                 UUID           NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    session_id               UUID           NULL REFERENCES public.trading_sessions(id) ON DELETE SET NULL,
    requested_at             TIMESTAMPTZ    NOT NULL DEFAULT now(),
    candidate_symbol         TEXT           NOT NULL,
    candidate_side           TEXT           NOT NULL CHECK (candidate_side IN ('long', 'short')),
    candidate_contracts      NUMERIC(8, 2)  NULL,
    risk_score               SMALLINT       NOT NULL CHECK (risk_score BETWEEN 0 AND 100),
    signals_breakdown        JSONB          NOT NULL,
    warning_message          TEXT           NULL,
    tilt_check_id            UUID           NULL REFERENCES public.tilt_checks(id) ON DELETE SET NULL,
    market_snapshot          JSONB          NULL,
    prop_firm_room_snapshot  JSONB          NULL,
    llm_explanation          TEXT           NULL,
    llm_input_snapshot       JSONB          NULL
);

CREATE INDEX IF NOT EXISTS risk_assessments_owner_requested_idx
    ON public.risk_assessments (owner_id, requested_at DESC);

-- ---------------------------------------------------------------------------
-- behavioral_profiles: 1:1 user aggregate (owner_id is PK).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.behavioral_profiles (
    owner_id                       UUID          PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    avg_stop_delay_score           NUMERIC(5, 2) NULL,
    avg_revenge_trade_gap_minutes  NUMERIC(8, 2) NULL,
    max_loss_streak                INT           NULL,
    night_trading_ratio            NUMERIC(4, 3) NULL,
    overconfidence_score           NUMERIC(5, 2) NULL,
    total_trades                   INT           NOT NULL DEFAULT 0,
    last_recomputed_at             TIMESTAMPTZ   NULL
);

COMMENT ON TABLE public.behavioral_profiles IS
    'Per-user aggregate. last_recomputed_at = NULL means a recompute is queued (sentinel).';

-- ---------------------------------------------------------------------------
-- csv_uploads: audit trail for original broker CSVs.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.csv_uploads (
    id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id        UUID         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    storage_path    TEXT         NOT NULL,
    preset_used     TEXT         NULL,
    row_count       INT          NOT NULL,
    accepted_count  INT          NOT NULL,
    rejected_count  INT          NOT NULL,
    uploaded_at     TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS csv_uploads_owner_uploaded_idx
    ON public.csv_uploads (owner_id, uploaded_at DESC);

COMMIT;
