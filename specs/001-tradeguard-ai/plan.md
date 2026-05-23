# Implementation Plan: TradeGuard AI

**Branch**: `001-tradeguard-ai` | **Date**: 2026-05-23 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-tradeguard-ai/spec.md`

## Summary

TradeGuard AI는 해외선물 트레이더 본인 한 명을 위한 **단일 사용자 클라우드 SaaS**다. 거래 CSV(브로커 프리셋 + 매핑 UI)를 업로드하면 (1) 결정론적 행동 분석, (2) AI 회고 리포트, (3) 시장 컨텍스트 매칭, (4) 5신호 결합 진입 위험도, (5) Prop Firm 룰 컴플라이언스 추적, (6) 세션 시작 시 Tilt Score 체크인을 통해 "사용자가 무너지는 순간"을 사전·사후 양쪽에서 감지한다.

**기술 접근**: Next.js 15(App Router) 풀스택 + Supabase(Postgres·Auth·Storage·RLS) + Anthropic Claude Sonnet 4.6(회고/설명 생성) + Yahoo Finance·Finnhub 무료 시장 데이터. PII 익명화 레이어는 Edge Function으로 LLM 호출 전 통과. 단일 사용자 SaaS라 RLS는 미래 확장을 위한 방어적 설계 수준으로 유지한다.

## Technical Context

**Language/Version**: TypeScript 5.x · Node.js 20 LTS

**Primary Dependencies**:
- Frontend: Next.js 15 (App Router, RSC), React 19, TailwindCSS 4, shadcn/ui, Recharts, TanStack Query
- Backend: Next.js API Routes + Supabase JS Client, Zod (검증), Anthropic SDK, Papa Parse (CSV)
- 데이터: Supabase Postgres 15
- 시장 데이터: Yahoo Finance(`yahoo-finance2`), Finnhub(이벤트 캘린더), Trading Economics(보조)

**Storage**: Supabase Postgres (트레이드·세션·프로필·분석 결과 영구 저장) + Supabase Storage (원본 CSV 보관)

**Testing**: Vitest(단위·계산식 결정론 검증) + Playwright(E2E 핵심 흐름) + MSW(외부 API 모킹). 결정론적 행동 점수에는 골든 픽스처(known input → known output) 테스트 필수.

**Target Platform**: 웹(데스크탑·모바일 브라우저). v1은 PWA 수준 반응형, 네이티브 앱은 v2.

**Project Type**: Web application (단일 Next.js 풀스택, 백/프론트 분리 없음)

**Performance Goals**:
- 거래 CSV 1,000행 업로드 후 행동 점수 산출까지 ≤ 2분(SC-001)
- 위험도 평가 API 응답 ≤ 5초 p95(SC-004) — LLM 호출 포함
- 대시보드 초기 로딩 ≤ 1.5초(거래 1만건 기준)

**Constraints**:
- LLM 호출 전 PII 익명화 필수 — 토큰화는 결정론적이라 동일 입력 → 동일 토큰(분석 일관성)
- 시장 데이터 무료 티어 — 분당 호출 제한 존재, 지수 백오프 + 캐싱 필수
- 단일 사용자 SaaS — Supabase 무료 티어로 시작, 페이로드 < 500MB / 10만 행 가정
- 비밀번호 기반 인증 불가 — Google + Kakao OAuth만 허용

**Scale/Scope**:
- 동시 사용자 1명(본인)
- 누적 거래 ~수만 건, 일일 신규 거래 수십 건
- AI 회고 호출 ~50회/일 예상(피크), 위험도 평가 ~20회/일

## Constitution Check

`.specify/memory/constitution.md`는 미비준 템플릿 상태이므로 정식 게이트는 적용되지 않는다. 대신 다음 기본 원칙을 자율 적용한다:

| 원칙 | 적용 방식 | 위반/예외 |
|---|---|---|
| **Simplicity-First** | 단일 Next.js 풀스택 — 별도 백엔드 분리 없음. 단일 사용자라 마이크로서비스 불필요. | 없음 |
| **결정론적 핵심 로직** | 행동 점수·Tilt Score·위험도 점수는 순수 함수로 분리, 골든 픽스처 테스트. AI는 설명/회고에만. | 없음 |
| **Test-First(NON-NEGOTIABLE)** | 결정론적 계산식(SC-002 보장)에는 TDD 필수. UI/통합은 핵심 흐름만 E2E. | 없음 |
| **Observability** | Supabase 로그 + Vercel Analytics + LLM 호출별 입력/출력 토큰·지연 기록. PII 익명화 후 저장. | 없음 |
| **Security/Privacy** | RLS는 단일 사용자라도 활성화(방어 깊이). PII는 토큰화 후 LLM 전송. CSV는 Storage 암호화. | 없음 |

게이트 통과. Phase 0로 진행.

## Project Structure

### Documentation (this feature)

```text
specs/001-tradeguard-ai/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
│   ├── trades-api.md
│   ├── analysis-api.md
│   ├── risk-api.md
│   ├── sessions-api.md
│   ├── prop-firm-api.md
│   └── account-api.md
├── checklists/
│   └── requirements.md
└── tasks.md             # Phase 2 (/speckit-tasks)
```

### Source Code (repository root)

단일 Next.js 풀스택 구조. v1에서는 별도 백엔드 서비스를 두지 않는다.

```text
tradeguard-ai/
├── app/                          # Next.js App Router
│   ├── (auth)/
│   │   ├── login/page.tsx
│   │   └── callback/page.tsx
│   ├── (app)/
│   │   ├── dashboard/page.tsx
│   │   ├── upload/page.tsx
│   │   ├── trades/page.tsx
│   │   ├── analysis/[tradeId]/page.tsx
│   │   ├── retrospective/page.tsx
│   │   ├── risk/page.tsx
│   │   ├── prop-firm/page.tsx
│   │   └── session/page.tsx       # Tilt 체크인 + 세션 상태
│   ├── api/
│   │   ├── trades/route.ts
│   │   ├── trades/upload/route.ts
│   │   ├── analysis/route.ts
│   │   ├── analysis/retrospective/route.ts
│   │   ├── risk/assess/route.ts
│   │   ├── sessions/route.ts
│   │   ├── sessions/[id]/tilt/route.ts
│   │   ├── prop-firm-profiles/route.ts
│   │   ├── market-context/fill/route.ts
│   │   └── account/data/route.ts
│   └── layout.tsx
├── components/
│   ├── charts/                   # 시간대별 승률, equity curve 등
│   ├── trades/                   # 거래 테이블, CSV 매핑 UI
│   ├── risk/                     # 위험도 패널, Tilt 신호등
│   └── prop-firm/                # 룰 여유 패널
├── lib/
│   ├── supabase/                 # 클라이언트·서버 인스턴스
│   ├── csv/
│   │   ├── presets/              # 브로커 프리셋 (ebest, ninjatrader, tradingview)
│   │   ├── parser.ts
│   │   └── validate.ts
│   ├── scoring/                  # 결정론적 점수 함수 (테스트 필수)
│   │   ├── behavioral.ts         # 손절 지연·복구매매·확신 과다
│   │   ├── tilt.ts               # Green/Yellow/Red
│   │   ├── risk.ts               # 5-signal 가중 합산
│   │   └── prop-firm.ts          # 드로우다운/일일 손실 계산
│   ├── llm/
│   │   ├── client.ts             # Anthropic SDK
│   │   ├── anonymize.ts          # PII 토큰화
│   │   ├── prompts.ts            # 시스템 프롬프트
│   │   └── filter.ts             # 위로 표현 후처리 필터
│   ├── market/
│   │   ├── yahoo.ts
│   │   ├── finnhub.ts
│   │   └── cache.ts
│   └── utils/
│       ├── time.ts               # UTC 변환
│       └── dedup.ts
├── types/                        # 공유 타입
├── tests/
│   ├── unit/
│   │   └── scoring/              # 골든 픽스처 테스트
│   ├── integration/
│   │   ├── csv-pipeline.test.ts
│   │   └── risk-pipeline.test.ts
│   └── e2e/
│       ├── upload-flow.spec.ts
│       ├── risk-flow.spec.ts
│       └── tilt-flow.spec.ts
├── supabase/
│   ├── migrations/               # SQL 마이그레이션
│   └── seed.sql                  # 브로커 프리셋 시드
├── .env.example
└── package.json
```

**Structure Decision**: 단일 Next.js 풀스택 프로젝트(`tradeguard-ai/`). 별도 `backend/` 디렉토리를 두지 않고 API Routes를 사용한다. 이유:
1. 단일 사용자 SaaS라 백/프론트 독립 스케일링 불필요
2. Vercel 단일 배포 단위로 운영 단순화
3. 결정론적 점수 함수(`lib/scoring/`)는 클라이언트/서버 양쪽에서 재사용 가능하게 분리

테스트 디렉토리는 `tests/`로 통합하되 단위/통합/E2E로 구분. 결정론적 점수 함수는 `tests/unit/scoring/`의 골든 픽스처가 SC-002(100% 일관성)의 1차 게이트다.

## Complexity Tracking

위반 사항 없음. 단일 Next.js 프로젝트 + Supabase 단일 데이터 저장소 — 가장 단순한 구조.
