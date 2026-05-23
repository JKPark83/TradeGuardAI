# Contract: Prop Firm Profile API

## `POST /api/prop-firm-profiles`

펀딩 회사 프로필 등록.

**Request**:
```json
{
  "firmName": "topstep",
  "firmLabel": "Topstep 50K Combine",
  "accountSize": 50000,
  "dailyLossLimit": 1000,
  "drawdownType": "eod_trailing",
  "drawdownLimit": 2000,
  "warnThresholdPct": 0.80
}
```

**Validation**:
- `firmName` ∈ `topstep`, `apex`, `ftmo`, `fundednext`, `other`
- `drawdownType` ∈ `static`, `eod_trailing`, `intraday_trailing`
- `drawdownLimit` > 0, `accountSize` > 0
- `dailyLossLimit` ≥ 0 또는 null
- `warnThresholdPct` ∈ (0, 1)

**Response 201**: `{ "id": "uuid", "...echoed fields": "..." }`

## `GET /api/prop-firm-profiles`

활성 프로필 목록.

**Response 200**:
```json
{
  "profiles": [
    {
      "id": "uuid",
      "firmName": "topstep",
      "firmLabel": "Topstep 50K",
      "accountSize": 50000,
      "drawdownType": "eod_trailing",
      "drawdownLimit": 2000,
      "currentRoom": {
        "dailyLossRoom": 420,
        "dailyLossUsedPct": 0.58,
        "drawdownRoom": 1580,
        "drawdownFloor": 48420,
        "currentEquity": 50000,
        "warningActive": false
      },
      "lastComputedAt": "2026-05-23T13:00:00Z"
    }
  ]
}
```

**`currentRoom` 계산**:
- `dailyLossRoom = dailyLossLimit - |today_realized_loss|` (오늘 손실만, 이익 차감 안 함)
- `dailyLossUsedPct = |today_realized_loss| / dailyLossLimit`
- `drawdownFloor`: 룰 타입별 R-08 공식
- `drawdownRoom = currentEquity - drawdownFloor`
- `warningActive = dailyLossUsedPct >= warnThresholdPct OR drawdownRoom / drawdownLimit < (1 - warnThresholdPct)`

## `PATCH /api/prop-firm-profiles/:id`

룰셋 수정. 활성 프로필 한도 변경 시 즉시 currentRoom 재계산.

**Request**: 부분 필드.

**Response 200**: 갱신된 프로필.

## `DELETE /api/prop-firm-profiles/:id`

프로필 비활성화 (소프트). `is_active=false`.

**Response 204**.

## `GET /api/prop-firm-profiles/:id/timeline`

해당 프로필의 일별 equity·룰 여유 시계열 (대시보드 차트용).

**Query**: `from`, `to`

**Response 200**:
```json
{
  "timeline": [
    {
      "date": "2026-05-20",
      "eodEquity": 50180,
      "drawdownFloor": 48180,
      "dailyPnL": 180,
      "warningHit": false
    }
  ]
}
```
