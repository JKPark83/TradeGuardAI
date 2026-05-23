-- 0004_market_snapshots.sql
-- TradeGuard AI — market context at trade entry. 1:0..1 with trades, keyed by trade_id.

BEGIN;

CREATE TABLE IF NOT EXISTS public.market_snapshots (
    trade_id              UUID            PRIMARY KEY REFERENCES public.trades(id) ON DELETE CASCADE,
    owner_id              UUID            NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    symbol                TEXT            NOT NULL,
    snapshot_at           TIMESTAMPTZ     NOT NULL,
    vix                   NUMERIC(8, 2)   NULL,
    dxy                   NUMERIC(8, 2)   NULL,
    volume                BIGINT          NULL,
    atr_14                NUMERIC(10, 4)  NULL,
    event_type            TEXT            NULL,
    event_offset_minutes  INT             NULL,
    data_source           TEXT            NOT NULL
        CHECK (data_source IN ('yahoo', 'finnhub', 'mixed')),
    created_at            TIMESTAMPTZ     NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.market_snapshots IS
    'Per-trade market context (VIX, DXY, volume, ATR, macro event). PK = trade_id enforces 1:0..1.';

CREATE INDEX IF NOT EXISTS market_snapshots_symbol_snapshot_at_idx
    ON public.market_snapshots (symbol, snapshot_at);

COMMIT;
