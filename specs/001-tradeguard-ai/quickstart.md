# Quickstart — TradeGuard AI

신규 개발자 또는 본인이 로컬에서 TradeGuard AI를 처음 띄울 때 사용한다.

## 사전 요구사항

- Node.js 20 LTS (`nvm install 20 && nvm use 20`)
- Docker Desktop (Supabase 로컬 CLI용)
- Supabase CLI (`brew install supabase/tap/supabase`)
- Anthropic API 키 ([console.anthropic.com](https://console.anthropic.com))
- Finnhub API 키 (무료 — [finnhub.io/register](https://finnhub.io/register))
- Google OAuth credentials (선택, 로컬에선 Magic Link로 대체 가능)
- Kakao Developers App 등록 (선택)

## 초기 셋업 (한 번만)

```bash
# 1. 의존성 설치
npm install

# 2. 환경 변수
cp .env.example .env.local
# .env.local 편집:
#   ANTHROPIC_API_KEY=sk-ant-...
#   FINNHUB_API_KEY=...
#   PII_HMAC_SECRET=$(openssl rand -hex 32)
#   NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
#   NEXT_PUBLIC_SUPABASE_ANON_KEY=(supabase start 출력)
#   SUPABASE_SERVICE_ROLE_KEY=(supabase start 출력)

# 3. Supabase 로컬 띄우기
supabase start

# 4. 마이그레이션 + 시드
supabase db reset
# 이 명령은 supabase/migrations/* 적용 후 supabase/seed.sql 실행
# 시드에는 system broker_mapping_presets (ebest, ninjatrader, tradingview) 포함
```

## 개발 서버

```bash
npm run dev
# Next.js 15 dev server → http://localhost:3000
```

첫 로그인은 로컬 Magic Link (Supabase Studio 메일 받은편지함 시뮬레이션):
- http://127.0.0.1:54321 (Supabase Studio) → Authentication → users → "magic link" 발송된 이메일 확인

## 핵심 흐름 검증 (≈ 5분)

### 1) 거래 업로드
```
http://localhost:3000/upload
```
- `tests/fixtures/sample-ninjatrader.csv` 업로드
- 자동 인식 → `ninjatrader` 프리셋 사용 메시지
- 138건 accepted, 0건 rejected

### 2) 행동 분석
```
http://localhost:3000/dashboard
```
- 손절 지연 점수, 복구매매 점수, 시간대별 승률 차트가 보여야 함
- "최소 거래 수에 도달" 안내 노출 없어야 함

### 3) AI 회고
```
http://localhost:3000/trades → 손실 거래 클릭 → "회고 생성"
```
- 5~10초 내 회고 텍스트 표시
- 위로 표현("괜찮", "잘했" 등) 없는지 육안 확인
- DevTools Network: `/api/analysis/retrospective` payload에 PII(이메일·실명) 없는지 확인

### 4) Tilt 체크인 + 위험도
```
http://localhost:3000/session
```
- 새 세션 시작 → sleep=4, stress=8, "어제 손실" 입력
- Tilt: Red 산출 확인
- `/risk` 페이지 → "NQ Long, 1계약" 평가 → riskScore ≥ 70 보장

### 5) Prop Firm 프로필
```
http://localhost:3000/prop-firm
```
- "Topstep 50K, EOD Trailing $2,000, 일일 손실 $1,000" 등록
- 대시보드에 "오늘 추가 허용 손실 $XXX" 패널 노출

### 6) 데이터 전체 삭제
```bash
curl -X DELETE http://localhost:3000/api/account/data \
  -H "Content-Type: application/json" \
  -d '{"confirm":"DELETE_ALL_MY_TRADEGUARD_DATA"}' \
  --cookie "$(cat .auth-cookie)"
```
- 거래·세션·분석·회고 모두 0건이 되어야 함
- `user_secrets`은 새로 회전

## 테스트 실행

```bash
# 단위 테스트 — 결정론적 점수 함수 (SC-002 게이트)
npm run test:unit

# 통합 테스트 — CSV→DB→점수 파이프라인
npm run test:integration

# E2E — 6개 핵심 흐름
npm run test:e2e
```

전체 통과 기준:
- Unit: `lib/scoring/*` 골든 픽스처 100% 통과
- Integration: 외부 LLM·시장 데이터는 MSW 모킹
- E2E: 업로드 / 분석 / 회고(MSW 응답) / Tilt / 위험도 / 삭제 흐름

## 자주 막히는 곳

| 증상 | 원인 / 해결 |
|---|---|
| `supabase start` 가 Docker 포트 충돌 | 5432/54321/54322가 비어있는지 확인. 충돌하면 `supabase stop && docker ps` 확인. |
| OAuth 콜백 404 | 로컬에선 Google·Kakao Provider 대신 이메일 Magic Link 사용 권장. Provider는 Vercel preview부터 활성화. |
| LLM 응답 7초 초과 | Sonnet 4.6 대신 Haiku 4.5로 fallback 테스트. `lib/llm/client.ts`의 모델 ID 토글. |
| 회고에 "괜찮" 단어 등장 | `lib/llm/filter.ts` 블랙리스트 확장 + `lib/llm/prompts.ts` negative example 강화. |
| 시장 데이터 결측 | Yahoo·Finnhub 한도 초과 가능성. `npm run market:cache:clear`로 캐시 재설정. |

## 배포 (Vercel + Supabase Cloud)

상세는 별도 `DEPLOY.md` (Phase 2 task로 작성 예정). 핵심:
1. Supabase 프로덕션 프로젝트 생성 → 마이그레이션 push
2. Vercel 프로젝트 연결 → 환경 변수 등록 (PII_HMAC_SECRET은 Vercel 콘솔에서 새로 생성)
3. Google·Kakao OAuth redirect URL 화이트리스트 등록
4. 첫 배포 후 `/api/account/data` 호출로 시드 데이터 정리
