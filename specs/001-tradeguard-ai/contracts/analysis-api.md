# Contract: Analysis API

행동 분석(결정론) + AI 회고(LLM) 계열.

## `POST /api/analysis/run`

특정 거래(들)의 정량 점수를 재계산. 결정론적이라 멱등.

**Request**:
```json
{ "tradeIds": ["uuid", "..."] | null, "scope": "all" | "uncomputed" }
```

`tradeIds`가 null이고 `scope=uncomputed`면 점수 미산출 거래 전부 처리.

**Response 200**:
```json
{
  "processed": 12,
  "skippedDuplicate": 0,
  "analyses": [
    { "tradeId": "uuid", "analysisId": "uuid", "stopDelayScore": 50, "revengeScore": 80, "overconfidenceScore": 0 }
  ]
}
```

## `POST /api/analysis/retrospective`

AI 회고 생성. 단일 거래 또는 기간.

**Request** (단일):
```json
{ "tradeId": "uuid", "regenerate": false }
```

**Request** (기간 회고):
```json
{ "periodFrom": "2026-05-15", "periodTo": "2026-05-22" }
```

**Response 200**:
```json
{
  "analysisId": "uuid",
  "retrospectiveText": "이번 손실은 연속 손실 2건 직후 ...",
  "filterPassed": true,
  "tokenUsage": { "input": 2400, "output": 320, "model": "claude-sonnet-4-6" },
  "inputSnapshot": { "tradeId": "uuid", "anonymized": true }
}
```

**Response 422** — 위로 표현 필터 통과 실패:
```json
{
  "error": "tone_filter_failed",
  "attemptsUsed": 2,
  "lastOutputBlocked": "..."
}
```

**Behavior**:
- LLM 호출 전 PII 익명화 통과 — 익명화 실패 시 500
- 출력 위로 표현 검출 시 재생성(최대 2회), 모두 실패하면 analysis.status='filtered_out' 저장하고 422
- 호출 결과는 항상 `analyses` 테이블에 저장(재생산성)

## `GET /api/analysis/profile`

사용자 행동 프로파일 (집계).

**Response 200**:
```json
{
  "totalTrades": 138,
  "avgStopDelayScore": 24.5,
  "avgRevengeTradeGapMinutes": 12.3,
  "maxLossStreak": 4,
  "nightTradingRatio": 0.28,
  "overconfidenceScore": 18.2,
  "lastRecomputedAt": "2026-05-23T11:00:00Z",
  "minimumTradesReached": true
}
```

`minimumTradesReached=false`면 "분석을 위한 최소 거래 수 미달" UX 노출.

## `GET /api/analysis/hourly-winrate`

시간대별 승률 차트용 (FR-007).

**Query**: `symbol` (optional)

**Response 200**:
```json
{
  "buckets": [
    { "hourUtc": 0, "trades": 4, "wins": 1, "winRate": 0.25, "totalPnL": -120 },
    { "hourUtc": 1, "trades": 0, "wins": 0, "winRate": null, "totalPnL": 0 }
  ]
}
```

## `GET /api/analysis/atr-buckets`

변동성 구간 성과 (FR-007).

**Response 200**:
```json
{
  "buckets": [
    { "bucket": "low", "atrRange": [0, 20], "trades": 30, "winRate": 0.6, "totalPnL": 1200 },
    { "bucket": "normal", "atrRange": [20, 40], "trades": 60, "winRate": 0.5, "totalPnL": -240 },
    { "bucket": "high", "atrRange": [40, null], "trades": 48, "winRate": 0.42, "totalPnL": -1800 }
  ]
}
```
