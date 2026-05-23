-- 0001_user_secrets.sql
-- TradeGuard AI — per-user HMAC secret used for PII anonymization.
-- 1:1 with auth.users. RLS: only the owning user can SELECT.

BEGIN;

CREATE TABLE IF NOT EXISTS public.user_secrets (
    user_id          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    pii_hmac_secret  TEXT        NOT NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE  public.user_secrets             IS 'Per-user HMAC secret for PII anonymization. Created once at signup.';
COMMENT ON COLUMN public.user_secrets.pii_hmac_secret IS 'gen_random_bytes(32) -> hex; never exposed to the client.';

ALTER TABLE public.user_secrets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_secrets_owner_only"
    ON public.user_secrets
    FOR ALL
    TO authenticated
    USING  (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

COMMIT;
