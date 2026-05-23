# TradeGuard AI

> **"시장을 맞추는 것이 아니라, 사용자가 무너지는 순간을 먼저 감지하는 것."**

해외선물 트레이더 본인을 위한 **AI 기반 행동 리스크 가드레일 시스템**. 거래 CSV를 업로드하면 시스템이 손절 지연·복구매매·확신 과다 같은 행동 패턴을 정량 점수로 변환하고, 시장 컨텍스트(VIX/DXY/CPI 등)와 결합해 진입 위험도를 사전·사후 양쪽에서 평가합니다.

## 핵심 기능 (User Stories)

| Story | 우선순위 | 설명 |
|---|---|---|
| **US1** | P1 (MVP) | 거래 CSV 업로드 + 결정론적 행동 분석 + 대시보드 |
| **US2** | P2 | AI 회고 — PII 익명화 + 톤 필터 + 재시도 |
| **US3** | P3 | 시장 컨텍스트 매칭 (Yahoo + Finnhub) |
| **US4** | P4 | 5신호 결합 실시간 진입 위험도 — Tilt-Red floor=70 |
| **US5** | P3 | Prop Firm 컴플라이언스 (Topstep/Apex/FTMO 룰 추적) |
| **US6** | P2 | 사전 멘탈 체크인 (Tilt Score: Green/Yellow/Red) |

상세 스펙: [`specs/001-tradeguard-ai/spec.md`](../specs/001-tradeguard-ai/spec.md)

## Tech Stack

- **Frontend**: Next.js 15 (App Router, RSC) · React 19 · TailwindCSS 4 · shadcn/ui · Recharts
- **Backend**: Next.js API Routes (Node runtime) · Zod 검증 · Papa Parse
- **Data**: Supabase Postgres (RLS) + Auth (Google/Kakao OAuth) + Storage
- **LLM**: Dual provider — Anthropic Claude (default) + OpenAI GPT (`LLM_PROVIDER` 환경변수로 전환)
- **Market data**: `yahoo-finance2` + Finnhub (둘 다 무료 티어)
- **Testing**: Vitest (단위·통합) + Playwright (E2E) + MSW (외부 API 모킹)

## Quick Start

상세 셋업은 [`quickstart.md`](../specs/001-tradeguard-ai/quickstart.md) 참고. 최단 경로:

```bash
# 1) 의존성 + 환경
npm install
cp .env.example .env.local            # .env.local에 키 입력
#   - ANTHROPIC_API_KEY 또는 OPENAI_API_KEY
#   - FINNHUB_API_KEY (무료)
#   - PII_HMAC_SECRET=$(openssl rand -hex 32)
#   - GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET (로컬 Google OAuth)

# 2) Supabase 로컬 (Docker 필요)
supabase start
supabase db reset                     # migrations + seed 적용

# 3) Dev 서버
npm run dev                           # → http://localhost:3000
```

샘플 거래 CSV는 [`tests/fixtures/sample-ninjatrader.csv`](./tests/fixtures/sample-ninjatrader.csv) (NinjaTrader 30행).

## Scripts

```bash
npm run dev               # Next.js dev (Turbopack)
npm run build             # Production build
npm run typecheck         # tsc --noEmit
npm run lint              # ESLint
npm run format            # Prettier

npm run test              # 전체 (unit + integration)
npm run test:unit         # 단위 테스트만 (결정론 점수 함수 골든 픽스처)
npm run test:integration  # 통합 (MSW로 외부 API 모킹)
npm run test:e2e          # Playwright E2E
```

## LLM 프로바이더 전환

```bash
# .env.local
LLM_PROVIDER=anthropic   # 기본
ANTHROPIC_API_KEY=sk-ant-...

# 또는
LLM_PROVIDER=openai
OPENAI_API_KEY=sk-...
```

`createLlmClient()` 팩토리가 환경변수를 읽어 자동 선택. 회고·위험도 설명 모두 영향받으며 코드 변경 불필요.

## 비용 가드 + Rate Limit

`/api/risk/assess` (LLM explanation 포함 시) 와 `/api/analysis/retrospective` 는 다음 보호 장치를 거칩니다:

- **Rate limit** — 사용자당 분당 호출 횟수 캡 (위험도 12/분, 회고 6/분)
- **Cost guard** — 일일 LLM 지출이 `LLM_DAILY_USD_CAP` (기본 $5) 초과 시 429 반환
- **Telemetry** — 모든 LLM 호출이 `llm_calls` 테이블에 토큰·지연·비용 기록 (PII 없음)

## Project Structure

```
tradeguard-ai/
├── app/
│   ├── (app)/                     # 인증된 사용자 라우트
│   │   ├── dashboard/             # US1: 행동 점수 + 차트
│   │   ├── upload/                # US1: CSV 업로드 (드래그&드롭 + 매핑 UI)
│   │   ├── trades/                # US1: 거래 목록 + 상세
│   │   ├── analysis/[tradeId]/    # US2: AI 회고
│   │   ├── retrospective/         # US2: 기간 회고
│   │   ├── risk/                  # US4: 실시간 진입 위험도
│   │   ├── prop-firm/             # US5: Prop Firm 프로필
│   │   ├── session/               # US6: Tilt 체크인
│   │   └── account/               # 데이터 전체 삭제
│   ├── (auth)/                    # 로그인 / OAuth 콜백
│   └── api/                       # Route Handlers
├── components/
│   ├── ui/                        # shadcn-style primitives
│   ├── charts/                    # 시간대별·ATR 차트
│   ├── trades/ risk/ prop-firm/   # 도메인 UI
├── lib/
│   ├── scoring/                   # 결정론적 점수 함수 (TDD 필수)
│   ├── csv/                       # 파서 + 브로커 프리셋
│   ├── llm/                       # 듀얼 프로바이더 + 익명화 + 필터 + 비용 가드
│   ├── market/                    # Yahoo + Finnhub 어댑터
│   ├── repositories/              # Supabase 데이터 접근
│   ├── services/                  # 도메인 오케스트레이션
│   ├── supabase/ auth/ utils/     # 인증 + 공통 유틸 (rate limit 포함)
├── supabase/
│   ├── migrations/                # 0001~0013 (storage bucket, RLS, telemetry 포함)
│   ├── functions/                 # Edge Functions (recompute-profile, prop-firm-eod)
│   └── seed.sql                   # 브로커 시드 프리셋
├── tests/
│   ├── unit/                      # 결정론 점수 골든 픽스처
│   ├── integration/               # 파이프라인 (LLM은 MSW)
│   ├── e2e/                       # Playwright
│   ├── fixtures/                  # sample-ninjatrader.csv 등
│   └── mocks/                     # MSW 핸들러 (Anthropic·OpenAI·Yahoo·Finnhub)
└── types/                         # 공유 TS 타입
```

## Status

- ✅ US1~US6 전체 구현 완료
- ✅ Dual LLM 프로바이더 (Anthropic + OpenAI)
- ✅ Rate limit + cost guard + LLM telemetry
- ✅ Storage bucket (`csv-upload`) RLS 정책
- ✅ 데이터 전체 삭제 + PII 시크릿 회전 (FR-019, SC-006)
- ✅ 204/204 단위 테스트 통과 (`tsc --noEmit` clean)

## Deploy

[`DEPLOY.md`](./DEPLOY.md) 참고 — Vercel + Supabase Cloud + Google/Kakao OAuth 설정 가이드.

## License

Private. Single-user SaaS.
