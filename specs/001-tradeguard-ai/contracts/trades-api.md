# Contract: Trades API

Base path: `/api/trades`. 모든 엔드포인트는 인증된 세션 필수(Supabase JWT 쿠키).

## `POST /api/trades/upload`

CSV 파일 업로드. 멀티파트.

**Request** (multipart/form-data):
- `file`: CSV 파일 (max 10MB)
- `presetName` *(optional)*: `ebest` | `ninjatrader` | `tradingview` | `<user-defined>` — 미지정 시 헤더 시그니처로 자동 인식 시도
- `mappingOverride` *(optional, JSON)*: `{symbol: "Instrument", side: "Action", ...}` — 자동 인식 실패 시 수동 매핑

**Response 200**:
```json
{
  "uploadId": "uuid",
  "presetUsed": "ninjatrader",
  "rowCount": 142,
  "accepted": 138,
  "rejected": 4,
  "rejectedRows": [
    { "row": 12, "reason": "pnl_mismatch", "details": "computed -120, csv -100" }
  ],
  "tradeIds": ["uuid", "..."]
}
```

**Response 400** — 매핑 실패 또는 검증 실패:
```json
{
  "error": "mapping_required",
  "detectedHeaders": ["Instrument", "Action", "..."],
  "suggestedFields": { "Instrument": "symbol", "Action": "side" }
}
```

**Behavior**:
- 첫 행 헤더 시그니처로 자동 매핑 시도
- 매핑 실패 시 클라이언트가 사용자 매핑 UI 표시 → 재요청
- 중복은 silently skip(통계에만 반영)
- 미청산 행(exit 비어있음)은 accepted로 저장하되 `exit_at IS NULL`
- pnl 부호 검증 실패는 rejected (FR-004)

## `GET /api/trades`

거래 목록 조회.

**Query**:
- `from`, `to` (ISO 8601) — 진입 시각 범위
- `symbol`
- `status`: `open` | `closed` | `all` (default: `all`)
- `limit` (default 50, max 500), `cursor`

**Response 200**:
```json
{
  "trades": [
    {
      "id": "uuid",
      "symbol": "NQ",
      "side": "long",
      "entryAt": "2026-05-20T13:00:00Z",
      "exitAt": "2026-05-20T13:42:00Z",
      "entryPrice": 18250.5,
      "exitPrice": 18225.0,
      "contracts": 2,
      "pnl": -510.0,
      "hasMarketContext": true,
      "latestAnalysis": { "id": "uuid", "riskScore": 65 }
    }
  ],
  "nextCursor": "string|null",
  "summary": { "total": 138, "winRate": 0.54, "totalPnL": -1240.5 }
}
```

## `GET /api/trades/:id`

단일 거래 상세 + 최신 분석.

**Response 200**:
```json
{
  "trade": { "...same fields...": "..." },
  "marketSnapshot": { "vix": 16.8, "atr14": 32.5, "eventType": "normal" },
  "analyses": [
    {
      "id": "uuid",
      "stopDelayScore": 30,
      "revengeScore": 80,
      "overconfidenceScore": 0,
      "retrospectiveStatus": "generated",
      "retrospectiveText": "이번 손실은 ..."
    }
  ]
}
```

## `DELETE /api/trades/:id`

단일 거래 삭제 (자체 데이터 정리).

**Response 204**.

## Mapping Presets

### `GET /api/trades/mapping-presets`

시스템 + 사용자 정의 프리셋 목록.

**Response 200**:
```json
{
  "presets": [
    { "id": "uuid", "name": "ninjatrader", "isSystem": true, "headerSignature": ["Instrument","Account","..."] },
    { "id": "uuid", "name": "내 ebest 매핑", "isSystem": false }
  ]
}
```

### `POST /api/trades/mapping-presets`

사용자 매핑 프리셋 저장.

**Request**:
```json
{ "name": "내 키움 매핑", "columnMapping": { "symbol": "종목", "side": "구분", "..." : "..."}, "timeFormat": "yyyy-MM-dd HH:mm:ss", "pnlSignConvention": "broker_native" }
```

**Response 201**: `{ "id": "uuid" }`
