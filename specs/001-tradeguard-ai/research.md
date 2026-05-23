# Phase 0 — Research: TradeGuard AI

**Branch**: `001-tradeguard-ai` | **Date**: 2026-05-23

이 문서는 plan.md의 Technical Context에서 미해결로 남았던 항목과 핵심 의사결정을 정리한다. 각 항목은 결정 / 근거 / 검토한 대안 3축으로 구성된다.

---

## R-01: 풀스택 프레임워크

**Decision**: Next.js 15 (App Router, RSC)

**Rationale**:
- 단일 사용자 SaaS라 백/프론트 분리 비용이 큼. API Routes로 충분.
- React Server Components로 거래 테이블·차트 등 데이터 헤비 페이지의 초기 로딩 단축.
- Vercel 배포 표준화 — 로그/모니터링 무료 티어로 시작 가능.
- TypeScript 우선, shadcn/ui와 호환성 최고.

**Alternatives considered**:
- **Remix**: SSR 품질 우수하나 RSC 생태계 협소.
- **SvelteKit**: 번들 작고 빠르나 차트·금융 컴포넌트 생태계 부족.
- **백엔드 분리(FastAPI/NestJS)**: 단일 사용자 규모에선 과잉.

---

## R-02: 데이터 저장소 & 인증

**Decision**: Supabase (Postgres + Auth + Storage + RLS)

**Rationale**:
- Google·Kakao OAuth(FR-017a)를 Supabase Auth 한 줄 설정으로 활성화.
- RLS는 단일 사용자라도 방어 깊이 차원에서 유지 — 향후 다중 사용자 전환 비용 0.
- Postgres 풀-피처(JSON 컬럼·인덱싱·View)로 행동 프로파일 집계 쿼리 구현 용이.
- Storage로 원본 CSV 보관, Edge Functions로 PII 익명화 분리 옵션.

**Alternatives considered**:
- **PlanetScale + Clerk**: 인증·DB 분리. 무료 OAuth 채널 적고 한국 Kakao 미지원.
- **Firebase**: NoSQL이라 행동 분석용 집계 쿼리 비효율.
- **자체 Postgres + NextAuth**: 운영 부담 큼, Kakao Provider 직접 작성 필요.

---

## R-03: LLM 제공자

**Decision**: Anthropic Claude Sonnet 4.6 (회고 + 위험도 설명)

**Rationale**:
- 한국어 회고 품질·논리적 추론 우수. "냉정한 분석 톤"(FR-013) 프롬프트 준수도 높음.
- Sonnet 4.6은 가격/성능 균형 최적 — 회고 1건당 인풋 ~2~5K 토큰, 비용 추정 < $0.05/건.
- 200K 컨텍스트로 주간 회고 시 다수 거래를 한 번에 전달 가능.
- 5초 SLA(SC-004) 위험도 호출은 짧은 시스템 프롬프트 + 구조화 출력으로 ~1~2초 응답 가능.

**Alternatives considered**:
- **GPT-4 Turbo**: 한국어 회고 품질 양호하나 톤 컨트롤이 Claude보다 어려움.
- **Claude Haiku 4.5**: 더 빠르고 저렴하나 회고 길이/품질 부족. 위험도 설명 전용 보조 모델로 향후 검토.
- **로컬 LLM(Ollama+Llama)**: 단일 사용자라 호스팅 비용 부담, 한국어 품질 부족.

---

## R-04: PII 익명화 전략

**Decision**: 결정론적 토큰화 — HMAC-SHA256(user_secret, field_value)의 첫 12자를 토큰으로 치환

**Rationale**:
- 동일 입력 → 동일 토큰이라 분석 일관성·재생산성 유지(FR-018).
- LLM은 토큰을 "별명"으로 처리해 회고 품질 영향 최소화 — "ACCT_9f3a..."가 회고에 등장해도 사용자가 보기 전에 후처리로 복원.
- `user_secret`은 가입 시 1회 생성, Supabase에만 저장. 외부 유출 시에도 역추적 불가.

**전송되는 필드 (분석 필수)**: 종목 코드(NQ·ES 등), 방향, 진입가/청산가, 진입/청산 시각, 계약 수, 손익, 행동 점수, 시장 컨텍스트(VIX/DXY/ATR/이벤트 타입), Tilt 신호등 색.

**전송 제외 + 토큰화 대상**: 계좌번호, 실명, 이메일, 브로커 식별자, 사용자 자유 텍스트(Tilt 체크인 "직전 외부 사건" 등 — 별도 옵션으로 사용자가 LLM 전송 동의 시에만 포함).

**Alternatives considered**:
- **무작위 UUID 토큰**: 결정론적이지 않아 재생산 불가.
- **AES 암호화 후 base64**: 길이 길어 컨텍스트 낭비, 복호화 키 관리 복잡.

---

## R-05: 시장 데이터 소스

**Decision**: Yahoo Finance(`yahoo-finance2`) — 기본 시세/지수, Finnhub — 경제 캘린더 이벤트, Trading Economics — 보조 검증

**Rationale**:
- Yahoo: VIX·DXY·선물 지수 5분봉 무료. `yahoo-finance2` Node 라이브러리 활성 유지보수.
- Finnhub: CPI/FOMC/NFP 캘린더 무료(분당 60회). 이벤트 타입·시각 정확.
- 일별 캐시 + 분당 토큰 버킷으로 무료 한도 초과 방지.

**Alternatives considered**:
- **Polygon.io**: 정확하나 유료. v2에서 정밀도 필요 시 전환.
- **Alpha Vantage**: 분당 5회 한계로 백필 작업에 부적합.

**Edge case 처리**: 데이터 결측 시 "데이터 없음" UI 상태로 표시(FR-010), 자동 재시도 큐는 v1에서 수동 트리거만 제공.

---

## R-06: CSV 브로커 프리셋 (v1)

**Decision**: 3개 프리셋 — `ebest`(이베스트 해외선물 거래내역), `ninjatrader`(NT8 Trades Export), `tradingview`(Strategy/Manual Trade Export). 그 외는 사용자 매핑 UI 폴백.

**Rationale**:
- 사용자 본인이 사용하는 브로커 1~2개에 우선 대응.
- 각 프리셋은 `lib/csv/presets/<broker>.ts`에 컬럼 매핑 + 시간 포맷 + 손익 부호 변환 규칙으로 분리, 추가 브로커는 신규 파일만 추가.
- 자동 인식은 첫 행 컬럼 헤더 시그니처(예: NinjaTrader는 `Instrument,Account,Strategy,...`)로 판별.

**Alternatives considered**:
- **MT5/MT4 형식**: 해외 선물 트레이더 일부 사용하나 v1에서는 후순위. 매핑 UI로 커버 가능.
- **자유 형식만 매핑 UI**: 초기 UX 부담 큼. 프리셋 + 폴백 조합이 균형.

**스키마**: 사용자가 매핑을 완료하면 `broker_mapping_presets` 테이블에 저장(FR-002a) → 다음 업로드 자동 적용.

---

## R-07: 결정론적 점수 산식

각 함수는 순수(pure)·UTC 기준·동일 입력 → 동일 출력을 보장. 모든 식은 `lib/scoring/` 모듈에 위치하고 골든 픽스처로 테스트.

### 7.1 손절 지연 점수 (Stop-Loss Delay Score, 0~100)

```
holding_ratio = holding_time / user_avg_holding_time_30d
if pnl >= 0: score = 0
else:
  if holding_ratio <= 1.0: score = 0
  elif holding_ratio <= 2.0: score = 20
  elif holding_ratio <= 3.0: score = 50
  else: score = min(100, 50 + (holding_ratio - 3.0) * 20)
```

### 7.2 복구매매 점수 (Revenge Trade Score, 0~100)

```
gap_minutes = (this.entry_time - prev_loss.exit_time) in minutes
if prev_consecutive_loss_count == 0: score = 0
elif gap_minutes < 10 and prev_consecutive_loss_count >= 2: score = 80
elif gap_minutes < 10 and prev_consecutive_loss_count == 1: score = 50
elif gap_minutes < 30: score = 30
else: score = 0
```

### 7.3 확신 과다 점수 (Overconfidence Score, 0~100)

```
size_ratio = this.contracts / user_median_contracts_30d
if prev_trade.pnl > 0 and size_ratio >= 2.0: score = 80
elif prev_trade.pnl > 0 and size_ratio >= 1.5: score = 50
elif win_streak >= 3 and size_ratio >= 1.5: score = 60
else: score = 0
```

### 7.4 Tilt Score (Green / Yellow / Red)

```
sleep_score: 1~10 (사용자 입력)
stress_score: 1~10
flag = 1 if (직전 외부 사건 텍스트 비어있지 않음 and 사용자가 "심각" 체크) else 0

raw = (10 - sleep_score) * 1.5 + stress_score * 1.2 + flag * 5
if raw <= 8: Green
elif raw <= 18: Yellow
else: Red
```

### 7.5 진입 위험도 점수 (Risk Score, 0~100)

5개 신호 가중 합산:

| 신호 | 가중치 | 계산 |
|---|---|---|
| 직전 N=2시간 손익 흐름 | 0.20 | 손익 음수 streak에 비례, max 100 |
| 시장 컨텍스트 위험 | 0.15 | VIX>30 또는 CPI/FOMC ±60분 → 60+ |
| 과거 유사 컨텍스트 본인 패율 | 0.25 | (유사 거래 패율 - 0.5) × 200 |
| Tilt Score | 0.20 | Green=0, Yellow=50, Red=100 |
| Prop Firm 룰 여유 | 0.20 | 일일 손실 한도 사용률(0~100) |

Tilt=Red 시 최종 점수의 floor가 70(FR-025).

---

## R-08: Prop Firm 드로우다운 계산

**Decision**: 룰 타입별 분리된 순수 함수 + 일일 EOD 배치(00:00 사용자 타임존)

```
Static DD:    floor = account_size - max_drawdown
              breach = current_equity < floor
EOD Trailing: highest_eod = max(eod_balance_history)
              floor = highest_eod - max_drawdown
              breach = current_equity < floor
Intraday Tr:  highest_intraday = max(equity_curve_intraday)
              floor = highest_intraday - max_drawdown
              breach = current_equity < floor
Daily Loss:   daily_pnl = sum(today.realized_pnl)
              warn_threshold = -daily_loss_limit * 0.80
              breach_threshold = -daily_loss_limit
```

**Rationale**: 룰 타입별 모듈화로 신규 펀딩 회사 룰 추가 비용 최소화. 일일 EOD 갱신은 사용자 타임존 기준(미국 동부 = 본 도메인 표준).

---

## R-09: 회고 톤 후처리 필터

**Decision**: 정규식·키워드 블랙리스트 + 재생성 루프(최대 2회)

**Rationale**:
- LLM 출력에서 "괜찮", "다음에 잘", "잘했", "수고", "걱정 마", "힘내" 등 위로 키워드 매칭 시 → 시스템 프롬프트에 negative example 추가해 재호출.
- 2회 재시도 후에도 통과 못 하면 출력 대신 "회고 재생성 실패 — 정량 점수만 표시" UX.
- SC-003(위로 표현 ≤ 2%) 달성을 위한 안전망.

**Alternatives considered**:
- **별도 분류 LLM**: 호출 2회로 비용·지연 증가. 정규식이 비용 대비 효율 우수.
- **임베딩 기반 유사도 차단**: 과차단 위험.

---

## R-10: 테스트 전략

**Decision**: 3-Tier 피라미드

| Tier | 도구 | 대상 | 기준 |
|---|---|---|---|
| Unit (60%) | Vitest | `lib/scoring/*`, `lib/csv/*`, `lib/llm/anonymize.ts` | 골든 픽스처 필수. SC-002의 1차 게이트. |
| Integration (30%) | Vitest + Supabase 로컬 + MSW | CSV→DB→점수, 위험도 파이프라인, PII 익명화 round-trip | LLM은 MSW 모킹. |
| E2E (10%) | Playwright | 업로드 → 분석 → 회고 → 위험도 → Tilt 체크인 핵심 흐름 | 실 LLM 호출은 staging만, 일반 CI는 모킹. |

**Rationale**: 결정론적 핵심 로직(점수 함수)에 단위 테스트 집중, UI/통합은 핵심 흐름만 — TDD 비용 대비 가치 최적.

---

## R-11: 배포 & 환경

**Decision**: Vercel(Next.js) + Supabase Cloud(Postgres·Auth·Storage)

| 환경 | 도메인 | 데이터 |
|---|---|---|
| local | localhost:3000 | Supabase local CLI (Docker) |
| preview | tradeguard-*.vercel.app | Supabase preview branch |
| production | tradeguard.app (미정) | Supabase production project |

**환경 변수**:
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (서버 전용)
- `ANTHROPIC_API_KEY`
- `FINNHUB_API_KEY`
- `PII_HMAC_SECRET`(서버 전용, 토큰화 마스터 시크릿)
- `KAKAO_CLIENT_ID`, `KAKAO_CLIENT_SECRET` (Supabase Auth Provider 콘솔)

---

## R-12: 데이터 삭제(FR-019, SC-006)

**Decision**: 하드 삭제 — `DELETE /api/account/data` 호출 시 모든 owned 레코드 즉시 삭제 + Storage CSV 파일 삭제 + LLM 호출 캐시 삭제. Supabase auth.users는 보존(재가입 시 OAuth 재연동 가능).

**Rationale**: 단일 사용자 도구의 신뢰 핵심. 소프트 삭제로 복구 가능성을 남기는 것이 오히려 사용자 안심 저해.

---

## NEEDS CLARIFICATION 해결 요약

| 항목 | 상태 | 해결 위치 |
|---|---|---|
| 호스팅 모델 | ✅ 단일 사용자 SaaS | spec.md Clarifications Q1 |
| LLM 외부 전송 정책 | ✅ 외부 LLM + PII 익명화 | spec.md Q2 + R-03/R-04 |
| CSV 매핑 전략 | ✅ 프리셋 + UI 폴백 | spec.md Q3 + R-06 |
| v1 스코프 확장 | ✅ Prop Firm + Tilt 포함 | spec.md Q4 |
| 인증 채널 | ✅ Google + Kakao OAuth | spec.md Q5 + R-02 |
| 시장 데이터 소스 | ✅ Yahoo + Finnhub | R-05 |
| 점수 산식 | ✅ 결정론적 공식 명시 | R-07 |
| 후처리 톤 필터 | ✅ 정규식 + 재생성 | R-09 |

남은 미해결: **없음**. Phase 1로 진행.
