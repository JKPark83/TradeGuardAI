-- 0013_llm_telemetry.sql
-- Per-call LLM telemetry. Lightweight observability so cost-guard and
-- performance tuning have real numbers to work from. Rows are non-sensitive
-- (no prompts, no responses — only meta), but RLS is still applied so users
-- only see their own usage.

BEGIN;

CREATE TABLE IF NOT EXISTS public.llm_calls (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    provider      TEXT NOT NULL CHECK (provider IN ('anthropic', 'openai')),
    model         TEXT NOT NULL,
    purpose       TEXT NOT NULL CHECK (purpose IN ('retrospective', 'risk_explanation', 'other')),
    input_tokens  INT NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
    output_tokens INT NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
    -- Estimated USD cost as of the call moment. Computed by the telemetry
    -- helper using a per-provider rate table — see lib/llm/telemetry.ts.
    cost_usd      NUMERIC(10,6) NOT NULL DEFAULT 0,
    latency_ms    INT NOT NULL DEFAULT 0 CHECK (latency_ms >= 0),
    ok            BOOLEAN NOT NULL DEFAULT TRUE,
    -- Truncated error code/class only — NO message bodies.
    error_code    TEXT,
    called_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS llm_calls_owner_called_at_idx
    ON public.llm_calls (owner_id, called_at DESC);

CREATE INDEX IF NOT EXISTS llm_calls_owner_purpose_called_at_idx
    ON public.llm_calls (owner_id, purpose, called_at DESC);

-- Aggregate view for the cost-guard fast path. Materialized to keep the
-- per-request check sub-millisecond — refreshed by an Edge Function or
-- on-demand from the cost-guard middleware.
CREATE OR REPLACE VIEW public.llm_daily_spend AS
SELECT
    owner_id,
    date_trunc('day', called_at AT TIME ZONE 'UTC') AS spend_date,
    COUNT(*)                                       AS call_count,
    SUM(input_tokens)                              AS total_input_tokens,
    SUM(output_tokens)                             AS total_output_tokens,
    SUM(cost_usd)                                  AS total_cost_usd
FROM public.llm_calls
GROUP BY owner_id, date_trunc('day', called_at AT TIME ZONE 'UTC');

-- RLS — same owner_only pattern as the rest.
ALTER TABLE public.llm_calls ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "owner_only" ON public.llm_calls;
CREATE POLICY "owner_only"
    ON public.llm_calls
    FOR ALL
    TO authenticated
    USING (owner_id = auth.uid())
    WITH CHECK (owner_id = auth.uid());

COMMIT;
