-- 0003_trades.sql
-- TradeGuard AI — entry/exit trade records.
-- Uniqueness includes nullable columns (exit_at, exit_price, pnl) so open positions
-- are still de-duplicated. We use a COALESCE-based functional UNIQUE INDEX because
-- a plain UNIQUE constraint treats NULLs as distinct.

BEGIN;

CREATE TABLE IF NOT EXISTS public.trades (
    id              UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id        UUID            NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    session_id      UUID            NULL,  -- FK added once trading_sessions exists (migration 0005)
    symbol          TEXT            NOT NULL,
    side            TEXT            NOT NULL CHECK (side IN ('long', 'short')),
    entry_price     NUMERIC(14, 5)  NOT NULL,
    exit_price      NUMERIC(14, 5)  NULL,
    entry_at        TIMESTAMPTZ     NOT NULL,
    exit_at         TIMESTAMPTZ     NULL,
    pnl             NUMERIC(14, 2)  NULL,
    contracts       NUMERIC(8, 2)   NOT NULL,
    source_csv_id   UUID            NULL,
    source_row      INT             NULL,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.trades IS 'Single entry-to-exit cycle. exit_* columns are NULL until the position closes.';

-- FR-003: prevent duplicate trades on re-upload. NULLs are coalesced to a sentinel
-- so two open positions on the same (owner, symbol, entry_at, entry_price) collide.
CREATE UNIQUE INDEX IF NOT EXISTS trades_dedup_uniq
    ON public.trades (
        owner_id,
        symbol,
        entry_at,
        COALESCE(exit_at, 'epoch'::timestamptz),
        entry_price,
        COALESCE(exit_price, -1)
    );

-- Hot paths.
CREATE INDEX IF NOT EXISTS trades_owner_entry_at_desc_idx
    ON public.trades (owner_id, entry_at DESC);

CREATE INDEX IF NOT EXISTS trades_owner_exit_at_idx
    ON public.trades (owner_id, exit_at);

CREATE INDEX IF NOT EXISTS trades_owner_symbol_entry_at_idx
    ON public.trades (owner_id, symbol, entry_at);

COMMIT;
