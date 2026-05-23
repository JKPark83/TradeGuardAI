-- seed.sql
-- TradeGuard AI — system-seed broker_mapping_presets (owner_id = NULL).
--
-- These three presets cover the launch brokers. They are intentionally
-- conservative approximations of each broker's CSV export — exact column
-- order, casing, and time format vary between platform versions, so the
-- runtime importer tolerates partial matches and falls back to user prompts.
--
-- Header naming conventions per broker (as of 2026-05):
--   * ebest        — Korean column headers, KST timestamps formatted "YYYY-MM-DD HH24:MI:SS"
--                    e.g. "종목 / 진입시간 / 청산시간 / 매매구분 / 진입가 / 청산가 / 수량 / 손익"
--   * ninjatrader  — Trade Performance export. ISO-ish "YYYY-MM-DD HH:MI:SS" times.
--                    Headers: Instrument, Account, Strategy, Time, Action, Quantity, Price, Commission, P&L
--   * tradingview  — Paper Trading / Broker tab. Times like "YYYY-MM-DD HH24:MI:SS".
--                    Headers: Symbol, Side, Type, Qty, Avg Price, Filled, Status, Filled Time
--
-- If actual CSV headers drift, edit column_mapping; never edit owner_id.

BEGIN;

INSERT INTO public.broker_mapping_presets
    (owner_id, preset_name, header_signature, column_mapping, time_format, pnl_sign_convention)
VALUES
    (
        NULL,
        'ebest',
        ARRAY['종목', '진입시간', '청산시간', '매매구분', '진입가', '청산가', '수량', '손익'],
        jsonb_build_object(
            'symbol',      '종목',
            'entry_at',    '진입시간',
            'exit_at',     '청산시간',
            'side',        '매매구분',
            'entry_price', '진입가',
            'exit_price',  '청산가',
            'contracts',   '수량',
            'pnl',         '손익'
        ),
        'YYYY-MM-DD HH24:MI:SS',
        'broker_native'
    ),
    (
        NULL,
        'ninjatrader',
        ARRAY['Instrument', 'Account', 'Strategy', 'Time', 'Action', 'Quantity', 'Price', 'Commission', 'P&L'],
        jsonb_build_object(
            'symbol',      'Instrument',
            'entry_at',    'Time',
            'side',        'Action',
            'contracts',   'Quantity',
            'entry_price', 'Price',
            'pnl',         'P&L'
        ),
        'YYYY-MM-DD"T"HH24:MI:SS',
        'broker_native'
    ),
    (
        NULL,
        'tradingview',
        ARRAY['Symbol', 'Side', 'Type', 'Qty', 'Avg Price', 'Filled', 'Status', 'Filled Time'],
        jsonb_build_object(
            'symbol',      'Symbol',
            'side',        'Side',
            'contracts',   'Qty',
            'entry_price', 'Avg Price',
            'entry_at',    'Filled Time'
        ),
        'YYYY-MM-DD HH24:MI:SS',
        'computed'
    )
ON CONFLICT (owner_id, preset_name) DO NOTHING;

COMMIT;
