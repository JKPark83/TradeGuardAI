# Auth Provider Setup

## Local Development

`auth.email` magic link via Supabase Inbucket(`http://127.0.0.1:54324`).

```bash
supabase start
# Login at http://localhost:3000/login → enter email
# Check Inbucket inbox at http://127.0.0.1:54324 for magic link
```

## Production (Supabase Cloud + Vercel)

Both Google and Kakao OAuth must be configured manually via Supabase Studio (cannot be set via `config.toml` in cloud).

### Google OAuth

1. Google Cloud Console → Create OAuth 2.0 Client ID
2. Authorized redirect URIs: `https://<your-project-ref>.supabase.co/auth/v1/callback`
3. Supabase Studio → Authentication → Providers → Google → Enable, paste Client ID + Secret

### Kakao OAuth

1. https://developers.kakao.com → Create App → Web platform
2. Site Domain: `https://<your-project-ref>.supabase.co`
3. Redirect URI: `https://<your-project-ref>.supabase.co/auth/v1/callback`
4. Activate "카카오 로그인" + "OpenID Connect"
5. Supabase Studio → Authentication → Providers → Kakao → Enable, paste REST API key (Client ID) + Client Secret

### Vercel Site URL

After setup, set `auth.site_url` in Supabase to `https://tradeguard.app` (or your prod domain). Redirect allow list: `https://tradeguard.app/callback`.

## Token Storage

`@supabase/ssr` handles cookies. No additional config needed.
