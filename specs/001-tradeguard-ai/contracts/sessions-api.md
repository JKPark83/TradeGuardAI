# Contract: Trading Sessions & Tilt Check API

## `POST /api/sessions`

새 거래 세션 시작. 사용자에게 활성 세션이 이미 있으면 그것을 반환.

**Request**: 없음 (옵션: `{ "force": true }` — 기존 활성 세션 종료 후 새로 시작)

**Response 201**:
```json
{ "sessionId": "uuid", "startedAt": "2026-05-23T13:30:00Z", "tiltCheck": null }
```

**Response 200** (이미 활성 세션 존재):
```json
{ "sessionId": "uuid", "startedAt": "...", "tiltCheck": { ... } }
```

## `POST /api/sessions/:id/tilt`

활성 세션에 멘탈 체크인 등록. 세션당 1회.

**Request**:
```json
{
  "sleepScore": 4,
  "stressScore": 8,
  "externalEvent": "어제 큰 손실 후 잠 못 잤음",
  "externalEventSerious": true
}
```

**Response 201**:
```json
{
  "tiltCheckId": "uuid",
  "tiltColor": "red",
  "rawScore": 22.3,
  "recommendations": [
    "거래 중단 권고",
    "사이즈 50% 이하 감소"
  ],
  "submittedAt": "2026-05-23T13:31:00Z"
}
```

**Response 409** — 이미 체크인 존재:
```json
{ "error": "tilt_already_submitted", "existing": { ... } }
```

## `PATCH /api/sessions/:id/end`

세션 종료.

**Response 200**:
```json
{ "sessionId": "uuid", "endedAt": "2026-05-23T19:00:00Z", "tradesInSession": 7 }
```

## `GET /api/sessions/active`

현재 활성 세션 + Tilt 정보. 헤더 신호등 표시용.

**Response 200**:
```json
{
  "activeSession": {
    "id": "uuid",
    "startedAt": "...",
    "tiltCheck": { "color": "yellow", "submittedAt": "..." }
  }
}
```

**Response 200** (활성 세션 없음): `{ "activeSession": null }`

## `GET /api/sessions/history`

세션 이력.

**Query**: `from`, `to`, `limit`

**Response 200**:
```json
{
  "sessions": [
    {
      "id": "uuid",
      "startedAt": "...",
      "endedAt": "...",
      "tiltColor": "green",
      "tradeCount": 5,
      "totalPnL": 240
    }
  ]
}
```
