---
description: "Task list for TradeGuard AI implementation"
---

# Tasks: TradeGuard AI

**Input**: Design documents from `/specs/001-tradeguard-ai/`

**Prerequisites**: plan.md (✅), spec.md (✅), research.md (✅), data-model.md (✅), contracts/ (✅)

**Tests**: 포함됨 — plan.md의 "Test-First (NON-NEGOTIABLE)" 원칙에 따라 결정론적 점수 함수와 핵심 흐름에 테스트 필수.

**Organization**: 6개 User Story(US1~US6) 기준으로 그룹화. 우선순위(P1 → P2 → P3 → P4)대로 정렬되며 각 스토리는 독립 테스트 가능.

**Path Convention**: Single Next.js project at repository root (`tradeguard-ai/`). 모든 경로는 이 루트 기준.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Next.js 15 프로젝트 초기화 + 도구 체인 셋업

- [X] T001 Create Next.js 15 App Router project structure at `tradeguard-ai/` per plan.md (app/, components/, lib/, types/, tests/, supabase/)
- [X] T002 Initialize package.json with Next.js 15, React 19, TypeScript 5, Tailwind 4 in `tradeguard-ai/package.json`
- [X] T003 [P] Install runtime deps: `@supabase/supabase-js`, `@supabase/ssr`, `@anthropic-ai/sdk`, `zod`, `papaparse`, `yahoo-finance2`, `recharts`, `@tanstack/react-query`, `lucide-react` in `tradeguard-ai/package.json`
- [X] T004 [P] Install dev deps: `vitest`, `@vitest/ui`, `playwright`, `msw`, `eslint`, `prettier`, `@types/papaparse` in `tradeguard-ai/package.json`
- [X] T005 [P] Configure ESLint + Prettier in `tradeguard-ai/.eslintrc.json` and `tradeguard-ai/.prettierrc`
- [X] T006 [P] Configure Vitest with happy-dom + path aliases in `tradeguard-ai/vitest.config.ts`
- [X] T007 [P] Configure Playwright in `tradeguard-ai/playwright.config.ts`
- [X] T008 [P] Configure TailwindCSS 4 + shadcn/ui base in `tradeguard-ai/tailwind.config.ts` and `tradeguard-ai/app/globals.css`
- [X] T009 [P] Initialize Supabase local CLI: run `supabase init` and create `tradeguard-ai/supabase/config.toml`
- [X] T010 [P] Create `tradeguard-ai/.env.example` with all required vars (ANTHROPIC_API_KEY, FINNHUB_API_KEY, PII_HMAC_SECRET, SUPABASE_*, KAKAO_*)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: 모든 User Story에 공통으로 필요한 DB 스키마·인증·공유 라이브러리. 이 단계 완료 전엔 어떤 US도 시작 불가.

**⚠️ CRITICAL**: 모든 User Story는 이 Phase 완료 후 시작.

### Database Schema (data-model.md 기반)

- [X] T011 Migration: `user_secrets` table with PII HMAC secret + RLS in `tradeguard-ai/supabase/migrations/0001_user_secrets.sql`
- [X] T012 [P] Migration: `broker_mapping_presets` table + system seed (ebest, ninjatrader, tradingview) in `tradeguard-ai/supabase/migrations/0002_broker_presets.sql`
- [X] T013 [P] Migration: `trades` table with unique constraint on dedup key + indexes in `tradeguard-ai/supabase/migrations/0003_trades.sql`
- [X] T014 [P] Migration: `market_snapshots` table in `tradeguard-ai/supabase/migrations/0004_market_snapshots.sql`
- [X] T015 [P] Migration: `trading_sessions` + `tilt_checks` tables in `tradeguard-ai/supabase/migrations/0005_sessions.sql`
- [X] T016 [P] Migration: `prop_firm_profiles` table in `tradeguard-ai/supabase/migrations/0006_prop_firm.sql`
- [X] T017 [P] Migration: `analyses`, `risk_assessments`, `behavioral_profiles`, `csv_uploads` tables in `tradeguard-ai/supabase/migrations/0007_analyses.sql`
- [X] T018 Apply RLS policies to all user-data tables (owner_id = auth.uid()) in `tradeguard-ai/supabase/migrations/0008_rls.sql`
- [X] T019 [P] Postgres trigger: enqueue behavioral_profile recompute on trades INSERT/UPDATE in `tradeguard-ai/supabase/migrations/0009_triggers.sql`
- [X] T020 [P] Create system seed data file for broker presets in `tradeguard-ai/supabase/seed.sql`

### Authentication

- [X] T021 Configure Supabase Auth providers (Google OAuth + Kakao OAuth) in `tradeguard-ai/supabase/config.toml` + Supabase Studio dashboard notes in `tradeguard-ai/supabase/AUTH-SETUP.md`
- [X] T022 [P] Supabase browser client in `tradeguard-ai/lib/supabase/client.ts`
- [X] T023 [P] Supabase server client (RSC + Route Handlers) in `tradeguard-ai/lib/supabase/server.ts`
- [X] T024 [P] Auth middleware for protected routes in `tradeguard-ai/middleware.ts`
- [X] T025 Login page with Google + Kakao buttons in `tradeguard-ai/app/(auth)/login/page.tsx`
- [X] T026 OAuth callback handler in `tradeguard-ai/app/(auth)/callback/route.ts`
- [X] T027 User secret auto-generation on first login (insert into user_secrets) in `tradeguard-ai/lib/auth/ensure-user-secret.ts`

### Shared Libraries

- [X] T028 [P] Shared TypeScript types matching data-model.md entities in `tradeguard-ai/types/db.ts` and `tradeguard-ai/types/api.ts`
- [X] T029 [P] PII anonymization helper (HMAC-SHA256 deterministic tokenization, R-04) in `tradeguard-ai/lib/llm/anonymize.ts`
- [X] T030 [P] UTC time conversion utilities in `tradeguard-ai/lib/utils/time.ts`
- [X] T031 [P] Structured error response helper in `tradeguard-ai/lib/utils/api-error.ts`
- [X] T032 [P] Request-scoped logger with requestId in `tradeguard-ai/lib/utils/logger.ts`
- [X] T033 [P] Zod validation helpers + common schemas in `tradeguard-ai/lib/validation/common.ts`

### Shared UI Shell

- [X] T034 Root layout with TanStack Query provider + theme in `tradeguard-ai/app/layout.tsx`
- [X] T035 [P] Authenticated app layout with sidebar + header (Tilt indicator placeholder) in `tradeguard-ai/app/(app)/layout.tsx`
- [X] T036 [P] shadcn/ui base components (Button, Card, Dialog, Table, Form) in `tradeguard-ai/components/ui/`

### Test Infrastructure

- [X] T037 [P] Vitest test helpers (Supabase test client, MSW handlers stub) in `tradeguard-ai/tests/helpers/setup.ts`
- [X] T038 [P] MSW handlers for Anthropic API + Yahoo + Finnhub in `tradeguard-ai/tests/mocks/handlers.ts`

**Checkpoint**: Foundation 완료 — 모든 User Story가 병렬 또는 순차로 시작 가능.

---

## Phase 3: User Story 1 — 거래 업로드 + 행동 패턴 분석 (Priority: P1) 🎯 MVP

**Goal**: 사용자가 CSV를 업로드하면 거래가 저장되고 손절 지연/복구매매/확신 과다 점수 + 시간대별·ATR 구간별 통계가 대시보드에 표시된다. AI/시장 데이터 없이 단독으로 완전 동작.

**Independent Test**: 표준 CSV 138건을 업로드 → 2분 이내 행동 점수 + 차트 표시(SC-001 검증).

### Tests for US1 (TDD — 작성 후 FAIL 확인)

- [X] T039 [P] [US1] Unit tests for behavioral scoring (R-07.1, 7.2, 7.3) — golden fixtures from `tests/fixtures/golden/behavioral/*.json` in `tradeguard-ai/tests/unit/scoring/behavioral.test.ts`
- [X] T040 [P] [US1] Unit tests for CSV preset auto-detection (header signature match) in `tradeguard-ai/tests/unit/csv/presets.test.ts`
- [X] T041 [P] [US1] Unit tests for CSV validation + pnl sign check + dedup logic in `tradeguard-ai/tests/unit/csv/validate.test.ts`
- [X] T042 [P] [US1] Integration test: CSV → DB → analysis → dashboard data in `tradeguard-ai/tests/integration/csv-pipeline.test.ts`
- [X] T043 [P] [US1] E2E test: upload sample CSV + verify dashboard charts render in `tradeguard-ai/tests/e2e/upload-flow.spec.ts`

### Implementation for US1

- [X] T044 [P] [US1] CSV parser wrapping papaparse in `tradeguard-ai/lib/csv/parser.ts`
- [X] T045 [P] [US1] Broker preset `ebest` definition in `tradeguard-ai/lib/csv/presets/ebest.ts`
- [X] T046 [P] [US1] Broker preset `ninjatrader` definition in `tradeguard-ai/lib/csv/presets/ninjatrader.ts`
- [X] T047 [P] [US1] Broker preset `tradingview` definition in `tradeguard-ai/lib/csv/presets/tradingview.ts`
- [X] T048 [P] [US1] Preset registry + auto-detection by header signature in `tradeguard-ai/lib/csv/presets/index.ts`
- [X] T049 [P] [US1] CSV validation rules (required columns, pnl sign check FR-004) in `tradeguard-ai/lib/csv/validate.ts`
- [X] T050 [P] [US1] Behavioral scoring functions (stop-delay, revenge, overconfidence per R-07) in `tradeguard-ai/lib/scoring/behavioral.ts`
- [X] T051 [US1] Trades repository (CRUD, dedup query, time-bucket aggregates) in `tradeguard-ai/lib/repositories/trades.ts`
- [X] T052 [US1] Mapping presets repository in `tradeguard-ai/lib/repositories/mapping-presets.ts`
- [X] T053 [US1] CSV upload service composing parser + validate + dedup + persist in `tradeguard-ai/lib/services/csv-upload.ts`
- [X] T054 [US1] Analysis recompute service in `tradeguard-ai/lib/services/behavioral-analysis.ts`
- [X] T055 [US1] POST `/api/trades/upload` route in `tradeguard-ai/app/api/trades/upload/route.ts`
- [X] T056 [US1] GET `/api/trades` route in `tradeguard-ai/app/api/trades/route.ts`
- [X] T057 [US1] GET + DELETE `/api/trades/[id]` routes in `tradeguard-ai/app/api/trades/[id]/route.ts`
- [X] T058 [US1] GET + POST `/api/trades/mapping-presets` routes in `tradeguard-ai/app/api/trades/mapping-presets/route.ts`
- [X] T059 [US1] POST `/api/analysis/run` route in `tradeguard-ai/app/api/analysis/route.ts`
- [X] T060 [US1] GET `/api/analysis/profile` route in `tradeguard-ai/app/api/analysis/profile/route.ts`
- [X] T061 [US1] GET `/api/analysis/hourly-winrate` route in `tradeguard-ai/app/api/analysis/hourly-winrate/route.ts`
- [X] T062 [US1] GET `/api/analysis/atr-buckets` route in `tradeguard-ai/app/api/analysis/atr-buckets/route.ts`
- [X] T063 [US1] Behavioral profile recompute Edge Function in `tradeguard-ai/supabase/functions/recompute-profile/index.ts` (consumes T019 trigger queue)
- [X] T064 [P] [US1] Upload page with drag-drop + preset detection feedback in `tradeguard-ai/app/(app)/upload/page.tsx`
- [X] T065 [P] [US1] CSV column mapping dialog (fallback UI) in `tradeguard-ai/components/trades/CsvMappingDialog.tsx`
- [X] T066 [P] [US1] Trades table with sort/filter in `tradeguard-ai/components/trades/TradesTable.tsx`
- [X] T067 [P] [US1] Trades list page in `tradeguard-ai/app/(app)/trades/page.tsx`
- [X] T068 [P] [US1] Hourly winrate bar chart component in `tradeguard-ai/components/charts/HourlyWinRateChart.tsx`
- [X] T069 [P] [US1] ATR bucket chart component in `tradeguard-ai/components/charts/AtrBucketChart.tsx`
- [X] T070 [P] [US1] Behavioral profile summary card in `tradeguard-ai/components/trades/BehavioralProfileCard.tsx`
- [X] T071 [US1] Dashboard page composing summary + charts + recent trades in `tradeguard-ai/app/(app)/dashboard/page.tsx`
- [X] T072 [US1] Golden fixture: `tests/fixtures/sample-ninjatrader.csv` (138-row reference dataset) in `tradeguard-ai/tests/fixtures/`

**Checkpoint**: US1 단독으로 MVP 완성. SC-001 (CSV 업로드 → 2분 내 점수), SC-002 (결정론 점수 100% 일치) 검증 가능.

---

## Phase 4: User Story 6 — Tilt Score 사전 멘탈 체크 (Priority: P2)

**Goal**: 거래 세션 시작 시 30초 체크인으로 Green/Yellow/Red 신호등 산출 + 세션 헤더 표시. US4(위험도)의 입력 신호 1개를 제공.

**Independent Test**: 새 세션 → sleep=4, stress=8 입력 → Red 산출 확인 → 헤더에 빨간 신호등 표시.

### Tests for US6

- [ ] T073 [P] [US6] Unit tests for tilt scoring (Green/Yellow/Red boundaries per R-07.4) in `tradeguard-ai/tests/unit/scoring/tilt.test.ts`
- [ ] T074 [P] [US6] Integration test: session create → tilt submit → active session reflects color in `tradeguard-ai/tests/integration/tilt-pipeline.test.ts`
- [ ] T075 [P] [US6] E2E test: session start + tilt check-in flow in `tradeguard-ai/tests/e2e/tilt-flow.spec.ts`

### Implementation for US6

- [ ] T076 [P] [US6] Tilt scoring function (deterministic per R-07.4) in `tradeguard-ai/lib/scoring/tilt.ts`
- [ ] T077 [P] [US6] Tilt recommendation generator (Green/Yellow/Red → 권고 메시지) in `tradeguard-ai/lib/scoring/tilt-recommendations.ts`
- [ ] T078 [US6] Trading sessions repository in `tradeguard-ai/lib/repositories/sessions.ts`
- [ ] T079 [US6] Tilt checks repository in `tradeguard-ai/lib/repositories/tilt-checks.ts`
- [ ] T080 [US6] POST `/api/sessions` route (create or return active) in `tradeguard-ai/app/api/sessions/route.ts`
- [ ] T081 [US6] GET `/api/sessions/active` route in `tradeguard-ai/app/api/sessions/active/route.ts`
- [ ] T082 [US6] GET `/api/sessions/history` route in `tradeguard-ai/app/api/sessions/history/route.ts`
- [ ] T083 [US6] PATCH `/api/sessions/[id]/end` route in `tradeguard-ai/app/api/sessions/[id]/end/route.ts`
- [ ] T084 [US6] POST `/api/sessions/[id]/tilt` route (409 if existing) in `tradeguard-ai/app/api/sessions/[id]/tilt/route.ts`
- [ ] T085 [P] [US6] Session start + tilt check-in form in `tradeguard-ai/app/(app)/session/page.tsx`
- [ ] T086 [P] [US6] Tilt traffic-light header indicator in `tradeguard-ai/components/layout/TiltIndicator.tsx`
- [ ] T087 [US6] Wire TiltIndicator into authenticated layout (replace placeholder from T035) in `tradeguard-ai/app/(app)/layout.tsx`

**Checkpoint**: US6 완료. Tilt 신호가 세션에 저장되어 후속 US4가 소비 가능.

---

## Phase 5: User Story 2 — AI 회고 리포트 (Priority: P2)

**Goal**: 단일 거래 또는 기간을 입력으로 PII 익명화 후 Claude Sonnet을 호출해 냉정한 분석 톤의 회고를 생성. 위로 표현 검출 시 재생성(최대 2회) + 후처리 필터.

**Independent Test**: 손실 거래 선택 → "회고 생성" → 5~10초 내 위로 표현 0% 텍스트 + 재생산용 input snapshot 저장.

### Tests for US2

- [ ] T088 [P] [US2] Unit tests for PII anonymization round-trip (deterministic, same input → same token) in `tradeguard-ai/tests/unit/llm/anonymize.test.ts`
- [ ] T089 [P] [US2] Unit tests for tone filter blacklist (괜찮, 다음에 잘 등) in `tradeguard-ai/tests/unit/llm/filter.test.ts`
- [ ] T090 [P] [US2] Integration test: retrospective pipeline with MSW-mocked LLM (success + filter-failed paths) in `tradeguard-ai/tests/integration/retrospective.test.ts`
- [ ] T091 [P] [US2] E2E test: generate retrospective from trade detail in `tradeguard-ai/tests/e2e/retrospective-flow.spec.ts`

### Implementation for US2

- [ ] T092 [P] [US2] Anthropic SDK client wrapper (Sonnet 4.6 default, model toggle env var) in `tradeguard-ai/lib/llm/client.ts`
- [ ] T093 [P] [US2] System prompt + negative examples for "냉정한 분석 톤" in `tradeguard-ai/lib/llm/prompts.ts`
- [ ] T094 [P] [US2] Tone filter (regex blacklist per R-09) in `tradeguard-ai/lib/llm/filter.ts`
- [ ] T095 [US2] Analyses repository in `tradeguard-ai/lib/repositories/analyses.ts`
- [ ] T096 [US2] Retrospective service: anonymize → call LLM → filter → retry max 2 → persist (with token usage + input snapshot for FR-018) in `tradeguard-ai/lib/services/retrospective.ts`
- [ ] T097 [US2] POST `/api/analysis/retrospective` route (single trade or period) in `tradeguard-ai/app/api/analysis/retrospective/route.ts`
- [ ] T098 [P] [US2] Trade detail page with retrospective generation button + display in `tradeguard-ai/app/(app)/analysis/[tradeId]/page.tsx`
- [ ] T099 [P] [US2] Period retrospective page (date range picker + summary) in `tradeguard-ai/app/(app)/retrospective/page.tsx`
- [ ] T100 [US2] Retrospective failure UX: "재시도" CTA when status=filtered_out or failed

**Checkpoint**: US2 완료. SC-003(위로 표현 ≤ 2%) 위한 톤 필터 + 재생성 루프 동작.

---

## Phase 6: User Story 3 — 시장 컨텍스트 매칭 (Priority: P3)

**Goal**: 각 거래의 진입 시각 기준 VIX/DXY/ATR/거래량/경제 이벤트 스냅샷 일괄 채움. 회고 품질을 시장 맥락으로 보강.

**Independent Test**: 거래 138건에 "시장 컨텍스트 채우기" 실행 → 각 거래에 스냅샷 저장 + 거래 후 발생 이벤트는 별도 표시.

### Tests for US3

- [ ] T101 [P] [US3] Unit tests for cache + rate limiter (token bucket) in `tradeguard-ai/tests/unit/market/cache.test.ts`
- [ ] T102 [P] [US3] Integration test: backfill job with MSW-mocked Yahoo + Finnhub in `tradeguard-ai/tests/integration/market-context.test.ts`

### Implementation for US3

- [ ] T103 [P] [US3] Yahoo Finance adapter (VIX, DXY, volume, ATR-14 계산) in `tradeguard-ai/lib/market/yahoo.ts`
- [ ] T104 [P] [US3] Finnhub adapter (economic calendar: CPI/FOMC/NFP) in `tradeguard-ai/lib/market/finnhub.ts`
- [ ] T105 [P] [US3] Market data cache + rate limiter in `tradeguard-ai/lib/market/cache.ts`
- [ ] T106 [US3] Market snapshots repository in `tradeguard-ai/lib/repositories/market-snapshots.ts`
- [ ] T107 [US3] Market context backfill service (async, idempotent) in `tradeguard-ai/lib/services/market-context.ts`
- [ ] T108 [US3] POST `/api/market-context/fill` route (queue job) in `tradeguard-ai/app/api/market-context/fill/route.ts`
- [ ] T109 [US3] GET `/api/market-context/fill/[jobId]` route in `tradeguard-ai/app/api/market-context/fill/[jobId]/route.ts`
- [ ] T110 [US3] GET `/api/market-context/upcoming-events` route in `tradeguard-ai/app/api/market-context/upcoming-events/route.ts`
- [ ] T111 [US3] Augment retrospective service (T096) to include market context in LLM input when available
- [ ] T112 [P] [US3] Market snapshot display block on trade detail page (extend T098) in `tradeguard-ai/components/trades/MarketSnapshotCard.tsx`
- [ ] T113 [P] [US3] Upcoming events widget on dashboard in `tradeguard-ai/components/market/UpcomingEventsWidget.tsx`
- [ ] T114 [P] [US3] "시장 컨텍스트 채우기" 일괄 액션 버튼 + progress UI on trades page

**Checkpoint**: US3 완료. 회고 텍스트에 "CPI 발표 1시간 전" 같은 단서가 자동 포함됨.

---

## Phase 7: User Story 5 — Prop Firm 컴플라이언스 (Priority: P3)

**Goal**: 사용자가 펀딩 룰셋(계정·일일 손실 한도·드로우다운 종류·한도)을 등록하면 매 거래·매 위험도 평가마다 룰 여유를 실시간 계산 + 임계치 도달 시 경고.

**Independent Test**: "Topstep 50K, EOD Trailing $2,000, 일일 손실 $1,000" 등록 → 거래 업로드 후 "오늘 추가 허용 손실 $420 / 트레일링 여유 $1,580" 패널 표시.

### Tests for US5

- [ ] T115 [P] [US5] Unit tests for drawdown calculation: static / EOD trailing / intraday trailing per R-08 in `tradeguard-ai/tests/unit/scoring/prop-firm.test.ts`
- [ ] T116 [P] [US5] Unit tests for daily loss room calculation + warning threshold logic in `tradeguard-ai/tests/unit/scoring/prop-firm-daily.test.ts`
- [ ] T117 [P] [US5] Integration test: trade upload → room recompute → warning emitted in `tradeguard-ai/tests/integration/prop-firm-pipeline.test.ts`
- [ ] T118 [P] [US5] E2E test: prop firm profile creation + dashboard room panel in `tradeguard-ai/tests/e2e/prop-firm-flow.spec.ts`

### Implementation for US5

- [ ] T119 [P] [US5] Prop firm drawdown + daily loss calculation (3 rule types) in `tradeguard-ai/lib/scoring/prop-firm.ts`
- [ ] T120 [US5] Prop firm profiles repository in `tradeguard-ai/lib/repositories/prop-firm.ts`
- [ ] T121 [US5] Equity timeline service (per-profile EOD aggregation) in `tradeguard-ai/lib/services/prop-firm-timeline.ts`
- [ ] T122 [US5] POST `/api/prop-firm-profiles` route in `tradeguard-ai/app/api/prop-firm-profiles/route.ts`
- [ ] T123 [US5] GET `/api/prop-firm-profiles` route (currentRoom computed inline) in same file
- [ ] T124 [US5] PATCH `/api/prop-firm-profiles/[id]` route in `tradeguard-ai/app/api/prop-firm-profiles/[id]/route.ts`
- [ ] T125 [US5] DELETE `/api/prop-firm-profiles/[id]` route (soft, is_active=false) in same file
- [ ] T126 [US5] GET `/api/prop-firm-profiles/[id]/timeline` route in `tradeguard-ai/app/api/prop-firm-profiles/[id]/timeline/route.ts`
- [ ] T127 [US5] Daily EOD compute Edge Function (cron 00:00 사용자 timezone, EOD trailing 드로우다운 갱신) in `tradeguard-ai/supabase/functions/prop-firm-eod/index.ts`
- [ ] T128 [P] [US5] Prop firm profile management page (list + form) in `tradeguard-ai/app/(app)/prop-firm/page.tsx`
- [ ] T129 [P] [US5] Room panel widget on dashboard in `tradeguard-ai/components/prop-firm/RoomPanel.tsx`
- [ ] T130 [P] [US5] Equity timeline chart in `tradeguard-ai/components/prop-firm/EquityTimelineChart.tsx`

**Checkpoint**: US5 완료. SC-009(Prop Firm 80% 도달 → 100% 경고) 검증.

---

## Phase 8: User Story 4 — 실시간 진입 위험도 (Priority: P4)

**Goal**: 후보 거래 입력 시 5신호 가중 합산 (직전 손익 흐름·시장 컨텍스트·유사 과거·Tilt·Prop Firm 룰 여유)로 0~100 위험도 + 근거 + 유사 과거 패턴 + 경고를 5초 이내 반환.

**Independent Test**: US1~US3, US5, US6 완료 상태에서 "NQ Long, 1계약" 입력 → 5초 내 점수+신호 분해+유사 거래+경고 표시. Tilt Red 시 자동 70+ 점수(FR-025, SC-008).

### Tests for US4

- [ ] T131 [P] [US4] Unit tests for 5-signal weighted risk calculation + Tilt Red floor=70 in `tradeguard-ai/tests/unit/scoring/risk.test.ts`
- [ ] T132 [P] [US4] Unit tests for weight redistribution when signals missing (no Tilt / no Prop Firm) in `tradeguard-ai/tests/unit/scoring/risk-weights.test.ts`
- [ ] T133 [P] [US4] Unit tests for similar-trades cosine similarity search in `tradeguard-ai/tests/unit/scoring/similar.test.ts`
- [ ] T134 [P] [US4] Integration test: full risk pipeline with all 5 signals + warning↔retrospective auto-link (SC-005) in `tradeguard-ai/tests/integration/risk-pipeline.test.ts`
- [ ] T135 [P] [US4] E2E test: risk assessment input + score panel in `tradeguard-ai/tests/e2e/risk-flow.spec.ts`

### Implementation for US4

- [ ] T136 [P] [US4] Risk scoring formula (R-07.5, 5-signal weighted, Tilt-Red floor) in `tradeguard-ai/lib/scoring/risk.ts`
- [ ] T137 [P] [US4] Similar past trades search in `tradeguard-ai/lib/scoring/similar.ts`
- [ ] T138 [P] [US4] Recent PnL streak signal calculator in `tradeguard-ai/lib/scoring/risk-signals/recent-pnl.ts`
- [ ] T139 [P] [US4] Market context signal calculator in `tradeguard-ai/lib/scoring/risk-signals/market-ctx.ts`
- [ ] T140 [US4] Risk assessment composer service in `tradeguard-ai/lib/services/risk-assessment.ts`
- [ ] T141 [US4] Risk LLM explanation generator (uses T092 client + T029 anonymizer) in `tradeguard-ai/lib/services/risk-explanation.ts`
- [ ] T142 [US4] Risk assessments repository in `tradeguard-ai/lib/repositories/risk-assessments.ts`
- [ ] T143 [US4] POST `/api/risk/assess` route (5초 SLA budget, optional LLM explanation) in `tradeguard-ai/app/api/risk/assess/route.ts`
- [ ] T144 [US4] GET `/api/risk/assessments/recent` route in `tradeguard-ai/app/api/risk/assessments/recent/route.ts`
- [ ] T145 [US4] GET `/api/risk/similar-trades` route in `tradeguard-ai/app/api/risk/similar-trades/route.ts`
- [ ] T146 [US4] Auto-link service: on trade upload, find risk_assessments with score ≥ 70 within ±5min + symbol/side match, set `priorWarningPresent=true` on subsequent retrospective input in `tradeguard-ai/lib/services/warning-linker.ts`
- [ ] T147 [US4] Update retrospective service (T096) to honor `priorWarningPresent` flag (prompt guardrail for "사전 경고가 있었음" 단서 포함)
- [ ] T148 [P] [US4] Risk assessment page: input form + score gauge + breakdown bars + warning banner + similar trades list in `tradeguard-ai/app/(app)/risk/page.tsx`
- [ ] T149 [P] [US4] Risk score breakdown component (5-signal bars with weights) in `tradeguard-ai/components/risk/RiskBreakdown.tsx`
- [ ] T150 [P] [US4] Similar past trades panel in `tradeguard-ai/components/risk/SimilarTradesPanel.tsx`

**Checkpoint**: US4 완료. SC-004(5초 내 응답), SC-005(경고-회고 90% 일관성), SC-008(Tilt Red → 100% 임계치 이상) 모두 검증.

---

## Phase 9: Polish & Cross-Cutting Concerns

**Purpose**: 데이터 삭제 / 관측성 / 비용 가드 / 문서 / 성능 검증

### Tests

- [ ] T151 [P] Integration test: full data deletion (SC-006) round-trip in `tradeguard-ai/tests/integration/data-deletion.test.ts`
- [ ] T152 [P] Integration test: unauthenticated access returns 401/404 across all routes (SC-007) in `tradeguard-ai/tests/integration/auth-isolation.test.ts`

### Implementation

- [ ] T153 DELETE `/api/account/data` route (transactional + Storage cleanup + user_secrets rotation) in `tradeguard-ai/app/api/account/data/route.ts`
- [ ] T154 [P] Account settings page with delete confirmation dialog in `tradeguard-ai/app/(app)/account/page.tsx`
- [ ] T155 [P] Vercel Analytics + Web Vitals integration in `tradeguard-ai/app/layout.tsx`
- [ ] T156 [P] LLM call telemetry middleware (token usage + latency to a `llm_calls` table) in `tradeguard-ai/lib/llm/telemetry.ts`
- [ ] T157 [P] Rate limiting on `/api/risk/assess` + `/api/analysis/retrospective` (Upstash or in-memory token bucket) in `tradeguard-ai/lib/utils/rate-limit.ts`
- [ ] T158 [P] Cost guard: daily LLM spend cap with circuit breaker (return 429 when exceeded) in `tradeguard-ai/lib/llm/cost-guard.ts`
- [ ] T159 [P] README.md with quickstart pointer + screenshots in `tradeguard-ai/README.md`
- [ ] T160 [P] DEPLOY.md with Vercel + Supabase Cloud setup in `tradeguard-ai/DEPLOY.md`
- [ ] T161 [P] Run `quickstart.md` golden-path validation manually (6 steps) and capture screen recording
- [ ] T162 Performance audit: dashboard p95 < 1.5s for 10k trades, risk endpoint p95 < 5s — record results in `tradeguard-ai/PERF.md`
- [ ] T163 Security audit: verify CSV upload size cap, RLS coverage, secret rotation on data deletion — record in `tradeguard-ai/SECURITY.md`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: 외부 의존 없음 — 즉시 시작.
- **Phase 2 (Foundational)**: Phase 1 완료 후 시작. 모든 US 진입 차단.
- **Phase 3 (US1, P1) 🎯 MVP**: Foundational 완료 후. 단독으로 가치 전달 가능.
- **Phase 4 (US6, Tilt)**: Foundational 완료 후 — US1과 병렬 가능. 단 US4 시작 전 완료 필요.
- **Phase 5 (US2, AI 회고)**: Foundational + US1(거래 데이터) 완료 후. US3 없이도 동작.
- **Phase 6 (US3, 시장 컨텍스트)**: Foundational + US1 완료 후. US2 회고를 보강하지만 독립 가치 있음.
- **Phase 7 (US5, Prop Firm)**: Foundational + US1 완료 후. US4 시작 전 완료 필요.
- **Phase 8 (US4, 위험도)**: US1 + US3 + US5 + US6 모두 완료 후 — 마지막에 통합.
- **Phase 9 (Polish)**: 원하는 US 완료 후.

### Story Dependencies (Mermaid 풍 요약)

```
Setup → Foundational ─┬─► US1 (P1) MVP
                      ├─► US6 (Tilt) ─┐
                      │              │
                      └─► US1 ─┬─► US2 (회고)
                              ├─► US3 (시장) ─┐
                              └─► US5 (PropFirm) ──┐
                                                   │
            US1 + US3 + US5 + US6 ───────────► US4 (위험도)
                                                   │
                                              ─► Polish
```

### Parallel Opportunities

**Phase 1 (Setup)**: T003~T010 모두 [P] — 한 번에 8개 병렬.
**Phase 2 (Foundational)**: T012~T017(마이그레이션), T022~T024(Supabase 클라이언트), T028~T033(공유 lib), T036~T038(UI/테스트 인프라) 모두 병렬.
**Phase 3 (US1)**: 테스트 T039~T043 5개 + 점수 함수 T044~T050 7개 + UI 컴포넌트 T064~T070 7개 등 다수 병렬.
**Phase 4~8**: 각 US 내부에서 테스트 그룹·점수 함수·UI 컴포넌트 동시 진행 가능.
**Phase 9**: T151~T158 대부분 병렬.

### Within Each User Story

- 테스트 작성 → FAIL 확인 → 구현 → 통과 (TDD 사이클, 결정론적 점수 함수에는 NON-NEGOTIABLE)
- 모델/타입 → 리포지토리 → 서비스 → API 라우트 → UI 컴포넌트 → 페이지 조립
- 같은 파일을 수정하는 작업은 [P] 마커 없이 순차 실행
- 각 Checkpoint에서 해당 US를 단독 실행/검증

---

## Parallel Example: User Story 1 시작 직후

```bash
# 테스트 5개 동시 작성:
Task: "T039 [US1] behavioral.ts golden fixture tests"
Task: "T040 [US1] CSV preset detection tests"
Task: "T041 [US1] CSV validation tests"
Task: "T042 [US1] csv-pipeline integration test"
Task: "T043 [US1] upload-flow E2E test"

# 점수 함수 + 프리셋 + 유틸 7개 병렬:
Task: "T044 lib/csv/parser.ts"
Task: "T045 lib/csv/presets/ebest.ts"
Task: "T046 lib/csv/presets/ninjatrader.ts"
Task: "T047 lib/csv/presets/tradingview.ts"
Task: "T048 lib/csv/presets/index.ts (registry)"
Task: "T049 lib/csv/validate.ts"
Task: "T050 lib/scoring/behavioral.ts"
```

---

## Implementation Strategy

### MVP First (US1 단독)

1. Phase 1 Setup 완료
2. Phase 2 Foundational 완료 ⚠️ 모든 US 차단 해제
3. Phase 3 US1 완료
4. **STOP & VALIDATE**: 표준 CSV 138건 업로드 → 행동 점수·시간대 차트 검증. SC-001, SC-002, SC-007 통과 확인.
5. MVP 데모/배포 가능

### Incremental Delivery (권장)

1. Setup + Foundational → 기반 완성
2. US1 → MVP 출시
3. US6(Tilt) → 행동 분석에 사전 신호 추가
4. US2(회고) → 자연어 인사이트 추가
5. US3(시장 컨텍스트) → 회고 품질 강화 + 사후 분석 풍부화
6. US5(Prop Firm) → 펀딩 회사 사용자 핵심 가치
7. US4(위험도) → 모든 신호 결합한 사전 가드레일 — 가장 차별적 기능
8. Polish → 운영 안정성

### 단독 개발자 시나리오 (현실)

워크트리·다른 LLM 세션 없이 본인이 직접 개발한다면:
- Setup + Foundational: ~1주
- US1 (MVP): ~1.5주
- US6: ~0.5주
- US2: ~1주
- US3: ~1주
- US5: ~1주
- US4: ~1.5주
- Polish: ~0.5주

**총 8주 정도** 예상. AI 코딩 도구 적극 활용 시 4~6주.

---

## Summary

- **Total tasks**: 163
- **Per phase**:
  - Phase 1 Setup: 10
  - Phase 2 Foundational: 28
  - Phase 3 US1 (P1, MVP): 34
  - Phase 4 US6 (P2, Tilt): 15
  - Phase 5 US2 (P2, 회고): 13
  - Phase 6 US3 (P3, 시장): 14
  - Phase 7 US5 (P3, Prop Firm): 16
  - Phase 8 US4 (P4, 위험도): 20
  - Phase 9 Polish: 13
- **Independent test criteria**: 각 US의 Independent Test 절을 참고 (Phase 3~8 시작부)
- **Suggested MVP scope**: Phase 1 + Phase 2 + Phase 3 (US1)
- **Test tasks**: 28개 (단위 17 + 통합 7 + E2E 4) — 결정론적 점수 함수와 핵심 흐름에 집중
- **Parallel-marked tasks**: 89개([P])

## Notes

- 모든 작업은 `tradeguard-ai/` 단일 Next.js 프로젝트 디렉토리 기준 경로.
- 결정론적 점수 함수(`lib/scoring/*`)는 TDD NON-NEGOTIABLE — 테스트 먼저, 골든 픽스처 통과 후 다음 작업.
- LLM 통합(US2, US4)은 항상 MSW로 모킹된 통합 테스트 통과 후 실 LLM 호출 통합.
- 시장 데이터(US3)는 무료 티어 한도 고려 — 캐시·rate limit 필수.
- 각 Checkpoint에서 해당 US 단독 검증 후 다음 Phase로 진행.
