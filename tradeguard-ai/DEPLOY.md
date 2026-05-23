# Deploy — TradeGuard AI

Vercel(Next.js) + Supabase Cloud(Postgres/Auth/Storage) 기반. 단일 사용자 SaaS라 무료 티어로 시작.

## 0. 사전 준비

- GitHub 저장소 push 완료 (현재 `001-tradeguard-ai` 브랜치 또는 main)
- Anthropic 또는 OpenAI API 키 (적어도 하나)
- Finnhub 무료 계정 (https://finnhub.io/register → API 키)
- Google Cloud Console 프로젝트
- (선택) Kakao Developers 앱

## 1. Supabase Cloud 프로젝트 생성

1. https://supabase.com/dashboard → **New project**
   - Name: `tradeguard-ai`
   - Region: 가까운 곳 (Tokyo / Seoul)
2. **Project Settings → API**:
   - `Project URL` 복사 → 나중에 `NEXT_PUBLIC_SUPABASE_URL`
   - `anon public` 키 복사 → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `service_role` 키 복사 → `SUPABASE_SERVICE_ROLE_KEY`

### 마이그레이션 적용

로컬에서 push:

```bash
supabase link --project-ref <your-project-ref>
supabase db push                    # supabase/migrations/* 전체 적용
```

또는 SQL Editor에서 `supabase/migrations/0001_*.sql` ~ `0013_*.sql`를 순서대로 실행.

`broker_mapping_presets` 시스템 시드는 `supabase/seed.sql`을 SQL Editor에서 실행.

### Storage bucket

`0012_storage_bucket.sql` 마이그레이션이 자동으로 `csv-upload` 버킷 + RLS 정책 생성. Storage UI에서 확인.

## 2. OAuth Provider 설정 (Supabase Studio)

자세한 단계는 [`supabase/AUTH-SETUP.md`](./supabase/AUTH-SETUP.md) 참고. 요약:

### Google OAuth (필수)

1. Google Cloud Console → **APIs & Services → Credentials → Create OAuth client ID**
2. **Authorized redirect URIs**:
   ```
   https://<your-project-ref>.supabase.co/auth/v1/callback
   ```
3. Supabase Studio → **Authentication → Providers → Google**:
   - Enable
   - Client ID, Client secret 붙여넣기
   - Save

### Kakao OAuth (선택)

1. https://developers.kakao.com → **내 애플리케이션 → 추가** → Web 플랫폼
2. **Redirect URI**: `https://<your-project-ref>.supabase.co/auth/v1/callback`
3. **카카오 로그인 활성화** + **OpenID Connect 활성화**
4. Supabase Studio → **Authentication → Providers → Kakao**:
   - REST API 키를 Client ID로, Client Secret(설정 후 발급)을 Client Secret으로

### Site URL

**Authentication → URL Configuration**:
- Site URL: `https://tradeguard.app` (또는 본인 도메인)
- Additional redirect URLs: `https://tradeguard.app/callback`

## 3. Vercel 배포

### 3.1 프로젝트 생성

1. https://vercel.com/new → GitHub 저장소 선택
2. **Root Directory**: `tradeguard-ai` (워크스페이스 모노레포 구조)
3. **Framework Preset**: Next.js (자동 인식)

### 3.2 환경 변수 (Settings → Environment Variables)

```
NEXT_PUBLIC_SUPABASE_URL          (Supabase Project URL)
NEXT_PUBLIC_SUPABASE_ANON_KEY     (Supabase anon key)
SUPABASE_SERVICE_ROLE_KEY         (Supabase service_role key — Production only)

LLM_PROVIDER                      anthropic   (또는 openai)
ANTHROPIC_API_KEY                 sk-ant-...
ANTHROPIC_MODEL                   claude-sonnet-4-6   (선택)

OPENAI_API_KEY                    sk-...      (LLM_PROVIDER=openai 시)
OPENAI_MODEL                      gpt-4o-2024-08-06   (선택)

FINNHUB_API_KEY                   (Finnhub 무료 키)

PII_HMAC_SECRET                   (`openssl rand -hex 32`로 새로 생성 — 로컬과 분리!)
LLM_DAILY_USD_CAP                 5.00        (선택)
```

⚠️ **PII_HMAC_SECRET은 프로덕션 전용으로 새로 생성**. 로컬 dev 값을 그대로 쓰면 익명화 토큰이 환경 간 충돌.

### 3.3 첫 배포

`Deploy` 클릭 → 빌드 로그 확인 → 성공 시 `https://<project-name>.vercel.app` URL 발급.

이 URL을 **Supabase Site URL + Allowed Redirect URLs**에 추가 (이미 prod 도메인을 등록했더라도 vercel.app도 백업으로):

- Site URL: `https://<project-name>.vercel.app`
- Redirect: `https://<project-name>.vercel.app/callback`

### 3.4 Google Cloud Console Redirect URI

OAuth 클라이언트 → **Authorized redirect URIs**에 prod URL 추가 (이미 Supabase 콜백을 등록한 상태라 추가 작업 없음 — Google → Supabase → 우리 앱 흐름).

## 4. Supabase Edge Functions 배포

```bash
supabase functions deploy recompute-profile
supabase functions deploy prop-firm-eod
```

### Cron 설정

Supabase Studio → **Database → Webhooks** 또는 **Cron Jobs**:

- `recompute-profile` — 매 5분 (행동 프로필 재계산 큐 소비)
- `prop-firm-eod` — 매일 UTC 00:00 (EOD trailing 드로우다운 갱신)

## 5. 첫 로그인 검증

1. `https://<prod-url>/login` 접속
2. "Google로 로그인" → Google 동의 → `/dashboard` 도착
3. Supabase Studio → **Authentication → Users**에 행 생성 확인
4. SQL Editor:
   ```sql
   SELECT user_id, length(pii_hmac_secret) AS len FROM public.user_secrets;
   ```
   → `len=64` (32바이트 hex) 확인

## 6. 운영 점검

### LLM 비용 모니터링

```sql
-- 일별 spend
SELECT * FROM public.llm_daily_spend ORDER BY spend_date DESC LIMIT 7;

-- 최근 호출 (PII 없음 — 안전하게 공유 가능)
SELECT provider, model, purpose, input_tokens, output_tokens, cost_usd, latency_ms, ok, called_at
FROM public.llm_calls
ORDER BY called_at DESC LIMIT 50;
```

### Rate limit (in-memory, 인스턴스당)

Vercel Functions는 stateless라 인스턴스 간 rate limit이 공유되지 않습니다. 단일 사용자 SaaS 가정상 문제 없지만, 다중 사용자로 확장 시 Upstash Redis 또는 Vercel KV로 마이그레이션 필요. `lib/utils/rate-limit.ts` 주석 참고.

### 데이터 삭제 (FR-019)

`/account` 페이지에서 확인 토큰(`DELETE_ALL_MY_TRADEGUARD_DATA`) 타이핑 → 모든 owned 데이터 + Storage CSV + PII 시크릿 회전.

## 7. 트러블슈팅

| 증상 | 원인 / 해결 |
|---|---|
| 로그인 후 `/login?error=invalid_code` | Supabase Site URL 또는 redirect 화이트리스트 불일치 |
| 로그인 후 `/login?error=server_error` | `ensureUserSecret` 실패 — `SUPABASE_SERVICE_ROLE_KEY` 환경변수 확인 |
| CSV 업로드 200이지만 trades 0건 | RLS 미적용 또는 `owner_id` 누락. SQL Editor에서 `SELECT * FROM trades WHERE owner_id = auth.uid()` 확인 |
| AI 회고 429 (rate_limited) | `LLM_DAILY_USD_CAP` 도달 — `llm_daily_spend` 뷰 확인 |
| `429 retryAfterSeconds 3600` | Cost guard 발동 — 다음 UTC 자정까지 대기 또는 cap 상향 |
| Yahoo/Finnhub 데이터 결측 | 무료 티어 한도 초과 가능. 분당 호출 수 모니터링 |
