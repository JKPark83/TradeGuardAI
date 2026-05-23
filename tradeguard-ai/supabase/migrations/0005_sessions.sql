-- 0005_sessions.sql
-- TradeGuard AI — trading_sessions + tilt_checks.
-- A trading session is a user-bounded trading block; each session may have one tilt_check.

BEGIN;

CREATE TABLE IF NOT EXISTS public.trading_sessions (
    id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id   UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    ended_at   TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.trading_sessions IS
    'User-bounded trading block. ended_at NULL = active session (max 1 per user, enforced at app level).';

-- Fast active-session lookup.
CREATE INDEX IF NOT EXISTS trading_sessions_active_idx
    ON public.trading_sessions (owner_id, ended_at NULLS FIRST, started_at DESC);

-- Backfill the FK from trades.session_id -> trading_sessions(id) now that the table exists.
ALTER TABLE public.trades
    ADD CONSTRAINT trades_session_id_fkey
    FOREIGN KEY (session_id) REFERENCES public.trading_sessions(id) ON DELETE SET NULL;


CREATE TABLE IF NOT EXISTS public.tilt_checks (
    id                      UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id              UUID            NOT NULL UNIQUE REFERENCES public.trading_sessions(id) ON DELETE CASCADE,
    owner_id                UUID            NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    sleep_score             SMALLINT        NOT NULL CHECK (sleep_score  BETWEEN 1 AND 10),
    stress_score            SMALLINT        NOT NULL CHECK (stress_score BETWEEN 1 AND 10),
    external_event          TEXT            NULL,
    external_event_serious  BOOLEAN         NOT NULL DEFAULT false,
    tilt_color              TEXT            NOT NULL
        CHECK (tilt_color IN ('green', 'yellow', 'red')),
    raw_score               NUMERIC(5, 2)   NOT NULL,
    submitted_at            TIMESTAMPTZ     NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.tilt_checks IS
    'Pre-session mental-state check. Exactly 0 or 1 row per trading_sessions row (UNIQUE session_id).';

CREATE INDEX IF NOT EXISTS tilt_checks_owner_submitted_idx
    ON public.tilt_checks (owner_id, submitted_at DESC);

COMMIT;
