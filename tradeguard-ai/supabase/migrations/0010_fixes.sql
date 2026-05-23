-- 0010_fixes.sql
-- Post-review remediation:
--   1. Make broker_mapping_presets unique index treat NULL owners as the same
--      bucket so re-running seed.sql is idempotent (Postgres 15+ feature).
--   2. Add the trades.source_csv_id → csv_uploads(id) foreign key that was
--      omitted from migration 0003 because csv_uploads didn't exist yet.

BEGIN;

-- 1) NULLS NOT DISTINCT on the preset unique index ----------------------------
DROP INDEX IF EXISTS public.broker_mapping_presets_owner_name_uniq;
CREATE UNIQUE INDEX broker_mapping_presets_owner_name_uniq
    ON public.broker_mapping_presets (owner_id, preset_name)
    NULLS NOT DISTINCT;

-- 2) trades.source_csv_id -> csv_uploads(id) ----------------------------------
-- ON DELETE SET NULL: deleting an upload row should NOT cascade-destroy
-- the user's actual trades. The CSV file itself is metadata; the trades
-- are derivative facts that survive.
ALTER TABLE public.trades
    DROP CONSTRAINT IF EXISTS trades_source_csv_id_fkey;

ALTER TABLE public.trades
    ADD CONSTRAINT trades_source_csv_id_fkey
    FOREIGN KEY (source_csv_id)
    REFERENCES public.csv_uploads(id)
    ON DELETE SET NULL;

COMMIT;
