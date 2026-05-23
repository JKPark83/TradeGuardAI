# Phase 1 — Data Model: TradeGuard AI

**Branch**: `001-tradeguard-ai` | **Date**: 2026-05-23

이 문서는 spec.md의 Key Entities를 Supabase Postgres 스키마로 구체화한다. 모든 테이블은 `owner_id UUID NOT NULL` 컬럼을 가지고 RLS 정책 `owner_id = auth.uid()`를 적용한다(단일 사용자 SaaS지만 미래 확장 대비).

타입 표기는 Postgres 기준이며, 마이그레이션 작성 시 `supabase/migrations/`에 SQL로 옮긴다.

---

## ER 개요

```
auth.users (Supabase)
    │
    │ 1:1
    ▼
user_secrets ────────── 1:N ──→ trading_sessions
    │                              │
    │                              │ 1:1
    │                              ▼
    │                          tilt_checks
    │
    ├── 1:N ──→ prop_firm_profiles
    │
    ├── 1:N ──→ broker_mapping_presets
    │
    ├── 1:N ──→ trades ──── 1:0..1 ──→ market_snapshots
    │                  │
    │                  └── 1:N ──→ analyses
    │
    ├── 1:N ──→ risk_assessments
    │
    └── 1:1 ──→ behavioral_profiles  (materialized aggregate)
```

---

## Tables

### `user_secrets`
PII 익명화에 사용하는 사용자별 HMAC 시크릿. 가입 시 1회 생성.

| 컬럼 | 타입 | 제약 | 비고 |
|---|---|---|---|
| `user_id` | UUID | PK, FK → auth.users | |
| `pii_hmac_secret` | TEXT | NOT NULL | 가입 시 `gen_random_bytes(32)` → hex |
| `created_at` | TIMESTAMPTZ | NOT NULL DEFAULT now() | |

RLS: `auth.uid() = user_id`. Service role만 select.

### `prop_firm_profiles`
사용자가 등록한 펀딩 계정 룰셋.

| 컬럼 | 타입 | 제약 |
|---|---|---|
| `id` | UUID | PK |
| `owner_id` | UUID | NOT NULL FK → auth.users |
| `firm_name` | TEXT | NOT NULL — 'topstep' \| 'apex' \| 'ftmo' \| 'fundednext' \| 'other' |
| `firm_label` | TEXT | 사용자 정의 라벨(예: "Topstep 50K Combine") |
| `account_size` | NUMERIC(14,2) | NOT NULL — 시작 잔고 |
| `daily_loss_limit` | NUMERIC(14,2) | NULLABLE — 일일 손실 한도($) |
| `drawdown_type` | TEXT | NOT NULL — 'static' \| 'eod_trailing' \| 'intraday_trailing' |
| `drawdown_limit` | NUMERIC(14,2) | NOT NULL — 드로우다운 한도 |
| `warn_threshold_pct` | NUMERIC(4,2) | DEFAULT 0.80 — 80% 도달 시 경고 |
| `is_active` | BOOLEAN | DEFAULT true |
| `created_at` | TIMESTAMPTZ | DEFAULT now() |

Index: `(owner_id, is_active)`

**State transitions**: `is_active`만 토글. 삭제는 `is_active=false`로 소프트(다만 사용자가 명시적으로 hard delete 요청 시 `DELETE`).

### `broker_mapping_presets`
시스템 시드 + 사용자 정의 매핑.

| 컬럼 | 타입 | 제약 |
|---|---|---|
| `id` | UUID | PK |
| `owner_id` | UUID | NULLABLE — NULL이면 시스템 시드(`ebest`, `ninjatrader`, `tradingview`) |
| `preset_name` | TEXT | NOT NULL |
| `header_signature` | TEXT[] | 자동 인식용 컬럼 헤더 시그니처 |
| `column_mapping` | JSONB | NOT NULL — `{"symbol": "Instrument", "side": "Action", ...}` |
| `time_format` | TEXT | NOT NULL — strftime 패턴 |
| `pnl_sign_convention` | TEXT | 'broker_native' \| 'computed' |
| `created_at` | TIMESTAMPTZ | DEFAULT now() |

Unique: `(owner_id, preset_name)`. RLS: owner_id IS NULL 인 시드는 모든 인증 사용자가 SELECT.

### `trading_sessions`
사용자가 시작·종료하는 거래 시간 블록. Tilt 체크인이 묶이는 단위.

| 컬럼 | 타입 | 제약 |
|---|---|---|
| `id` | UUID | PK |
| `owner_id` | UUID | NOT NULL FK |
| `started_at` | TIMESTAMPTZ | NOT NULL DEFAULT now() |
| `ended_at` | TIMESTAMPTZ | NULLABLE — NULL이면 활성 세션 |
| `created_at` | TIMESTAMPTZ | DEFAULT now() |

Index: `(owner_id, ended_at NULLS FIRST, started_at DESC)` — 활성 세션 빠른 조회.

**State transitions**: `started_at` 설정 → 활성 → `ended_at` 설정 시 종료. 한 사용자에 활성 세션은 0 또는 1개(앱 레벨 제약).

### `tilt_checks`
세션 시작 시 입력한 멘탈 상태. 세션 1건에 정확히 1개(있거나 없음).

| 컬럼 | 타입 | 제약 |
|---|---|---|
| `id` | UUID | PK |
| `session_id` | UUID | UNIQUE NOT NULL FK → trading_sessions |
| `owner_id` | UUID | NOT NULL |
| `sleep_score` | INT2 | NOT NULL CHECK (1..10) |
| `stress_score` | INT2 | NOT NULL CHECK (1..10) |
| `external_event` | TEXT | NULLABLE — 자유 텍스트 |
| `external_event_serious` | BOOLEAN | DEFAULT false |
| `tilt_color` | TEXT | NOT NULL — 'green' \| 'yellow' \| 'red' |
| `raw_score` | NUMERIC(5,2) | NOT NULL — 계산 결과 원본 |
| `submitted_at` | TIMESTAMPTZ | DEFAULT now() |

Index: `(owner_id, submitted_at DESC)`

### `trades`
한 번의 진입~청산 사이클.

| 컬럼 | 타입 | 제약 |
|---|---|---|
| `id` | UUID | PK |
| `owner_id` | UUID | NOT NULL FK |
| `session_id` | UUID | NULLABLE FK — 사후 업로드 시 매칭, 매칭 안 되면 NULL |
| `symbol` | TEXT | NOT NULL — 'NQ', 'ES' 등 |
| `side` | TEXT | NOT NULL CHECK ('long','short') |
| `entry_price` | NUMERIC(14,5) | NOT NULL |
| `exit_price` | NUMERIC(14,5) | NULLABLE — 미청산 시 NULL |
| `entry_at` | TIMESTAMPTZ | NOT NULL |
| `exit_at` | TIMESTAMPTZ | NULLABLE |
| `pnl` | NUMERIC(14,2) | NULLABLE |
| `contracts` | NUMERIC(8,2) | NOT NULL |
| `source_csv_id` | UUID | NULLABLE — Storage 파일 ID |
| `source_row` | INT | NULLABLE |
| `created_at` | TIMESTAMPTZ | DEFAULT now() |

Unique: `(owner_id, symbol, entry_at, exit_at, entry_price, exit_price)` — FR-003 중복 방지.

Index:
- `(owner_id, entry_at DESC)` — 거래 목록 정렬
- `(owner_id, exit_at)` — 청산 시각 기반 조회
- `(owner_id, symbol, entry_at)` — 유사 거래 검색

**State transitions**: 미청산(`exit_at IS NULL`) → 청산(`exit_at, exit_price, pnl` 설정). 사용자가 사후 업로드로 청산 데이터를 채울 수 있음.

### `market_snapshots`
거래 진입 시각의 시장 상태. 별도 테이블이지만 trade와 1:0..1.

| 컬럼 | 타입 | 제약 |
|---|---|---|
| `trade_id` | UUID | PK, FK → trades |
| `owner_id` | UUID | NOT NULL |
| `symbol` | TEXT | NOT NULL |
| `snapshot_at` | TIMESTAMPTZ | NOT NULL — 진입 시각과 동일 |
| `vix` | NUMERIC(8,2) | NULLABLE |
| `dxy` | NUMERIC(8,2) | NULLABLE |
| `volume` | BIGINT | NULLABLE |
| `atr_14` | NUMERIC(10,4) | NULLABLE |
| `event_type` | TEXT | NULLABLE — 'cpi'\|'fomc'\|'nfp'\|'cbproductivity'\|'normal' |
| `event_offset_minutes` | INT | NULLABLE — 진입 시각으로부터 이벤트까지의 분 |
| `data_source` | TEXT | NOT NULL — 'yahoo'\|'finnhub'\|'mixed' |
| `created_at` | TIMESTAMPTZ | DEFAULT now() |

Index: `(symbol, snapshot_at)`

### `analyses`
Trade 1건에 대한 정량 점수 + AI 회고. 시간 경과에 따라 누적 가능.

| 컬럼 | 타입 | 제약 |
|---|---|---|
| `id` | UUID | PK |
| `trade_id` | UUID | NOT NULL FK |
| `owner_id` | UUID | NOT NULL |
| `stop_delay_score` | INT2 | CHECK (0..100) |
| `revenge_score` | INT2 | CHECK (0..100) |
| `overconfidence_score` | INT2 | CHECK (0..100) |
| `risk_score` | INT2 | NULLABLE CHECK (0..100) — 사후 위험도(있다면) |
| `retrospective_text` | TEXT | NULLABLE — AI 회고 |
| `retrospective_status` | TEXT | NOT NULL — 'pending'\|'generated'\|'failed'\|'filtered_out' |
| `llm_input_snapshot` | JSONB | NULLABLE — 재생산용 입력 |
| `llm_token_usage` | JSONB | NULLABLE — `{input, output, model}` |
| `created_at` | TIMESTAMPTZ | DEFAULT now() |

Index: `(trade_id, created_at DESC)`

### `risk_assessments`
실시간 진입 위험도 평가 결과.

| 컬럼 | 타입 | 제약 |
|---|---|---|
| `id` | UUID | PK |
| `owner_id` | UUID | NOT NULL |
| `session_id` | UUID | NULLABLE FK |
| `requested_at` | TIMESTAMPTZ | DEFAULT now() |
| `candidate_symbol` | TEXT | NOT NULL |
| `candidate_side` | TEXT | NOT NULL |
| `candidate_contracts` | NUMERIC(8,2) | NULLABLE |
| `risk_score` | INT2 | NOT NULL CHECK (0..100) |
| `signals_breakdown` | JSONB | NOT NULL — `{recent_pnl: 30, market_ctx: 45, similar_history: 70, tilt: 50, prop_firm: 80}` |
| `warning_message` | TEXT | NULLABLE |
| `tilt_check_id` | UUID | NULLABLE FK |
| `market_snapshot` | JSONB | NULLABLE — 평가 시점 시장 컨텍스트 |
| `prop_firm_room_snapshot` | JSONB | NULLABLE — 평가 시점 룰 여유 |
| `llm_explanation` | TEXT | NULLABLE |
| `llm_input_snapshot` | JSONB | NULLABLE |

Index: `(owner_id, requested_at DESC)`

### `behavioral_profiles`
사용자 단위 집계 — 거래 N건 이상 누적 시 갱신되는 materialized view 또는 행 1개 테이블.

| 컬럼 | 타입 |
|---|---|
| `owner_id` | UUID PK FK |
| `avg_stop_delay_score` | NUMERIC(5,2) |
| `avg_revenge_trade_gap_minutes` | NUMERIC(8,2) |
| `max_loss_streak` | INT |
| `night_trading_ratio` | NUMERIC(4,3) — 22시~06시 거래 비율 |
| `overconfidence_score` | NUMERIC(5,2) |
| `total_trades` | INT |
| `last_recomputed_at` | TIMESTAMPTZ |

**Recompute trigger**: trades INSERT/UPDATE 시 큐에 작업 등록 → 백그라운드 job(또는 Edge Function)이 30초 디바운스로 재계산. 단일 사용자라 동시성 문제 거의 없음.

### `csv_uploads` (감사)
원본 CSV 메타.

| 컬럼 | 타입 | 제약 |
|---|---|---|
| `id` | UUID | PK |
| `owner_id` | UUID | NOT NULL |
| `storage_path` | TEXT | NOT NULL — Supabase Storage 경로 |
| `preset_used` | TEXT | NULLABLE FK preset_name |
| `row_count` | INT | NOT NULL |
| `accepted_count` | INT | NOT NULL |
| `rejected_count` | INT | NOT NULL |
| `uploaded_at` | TIMESTAMPTZ | DEFAULT now() |

---

## RLS 정책 (요약)

모든 사용자 데이터 테이블:

```sql
ALTER TABLE <table> ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner_only" ON <table>
  FOR ALL TO authenticated
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());
```

`broker_mapping_presets`만 예외 — 시스템 시드(`owner_id IS NULL`) 조건부 SELECT 추가.

---

## 무결성 제약 요약

| 규칙 | 위치 |
|---|---|
| 중복 거래 방지 | `trades` UNIQUE (owner_id, symbol, entry_at, exit_at, entry_price, exit_price) |
| 점수 범위 0~100 | CHECK 제약 |
| 활성 세션 최대 1개 | 앱 레벨 (`SELECT WHERE ended_at IS NULL` 조회 후 처리) |
| Tilt 점수 입력 범위 | CHECK (1..10) |
| 드로우다운 룰 타입 | CHECK ('static'\|'eod_trailing'\|'intraday_trailing') |
| 회고 상태 | CHECK ('pending'\|'generated'\|'failed'\|'filtered_out') |

---

## 마이그레이션 순서 (참고)

1. `user_secrets`
2. `broker_mapping_presets` (시스템 시드 데이터 포함)
3. `prop_firm_profiles`
4. `trading_sessions`
5. `tilt_checks`
6. `trades`
7. `market_snapshots`
8. `analyses`
9. `risk_assessments`
10. `behavioral_profiles`
11. `csv_uploads`
12. RLS 정책 일괄 적용
13. Trigger: `trades` INSERT/UPDATE → behavioral_profiles 재계산 큐
