# Contract: Account / Market Context API

## `DELETE /api/account/data`

사용자의 모든 데이터 영구 삭제 (FR-019, SC-006).

**Request**:
```json
{ "confirm": "DELETE_ALL_MY_TRADEGUARD_DATA" }
```

확인 토큰이 일치하지 않으면 400.

**Response 200**:
```json
{
  "deleted": {
    "trades": 138,
    "marketSnapshots": 130,
    "analyses": 240,
    "riskAssessments": 32,
    "tradingSessions": 18,
    "tiltChecks": 15,
    "propFirmProfiles": 1,
    "csvUploads": 4,
    "behavioralProfile": 1,
    "storageFiles": 4
  },
  "userSecretsRotated": true,
  "completedAt": "2026-05-23T13:50:00Z"
}
```

**Behavior**:
- 같은 트랜잭션 안에서 모든 owned 레코드 DELETE
- Supabase Storage에서 `csv_uploads.storage_path` 파일 삭제
- `user_secrets`는 신규 시크릿으로 회전(완전 새 출발)
- Supabase auth.users는 보존 — 사용자가 원하면 별도 콘솔에서 계정 자체 삭제 가능

## `POST /api/market-context/fill`

기존 거래에 시장 컨텍스트를 일괄 채움 (User Story 3, P3).

**Request**:
```json
{ "tradeIds": ["uuid", "..."] | null, "scope": "missing_only" }
```

**Response 202** (비동기):
```json
{
  "jobId": "uuid",
  "queued": 138,
  "estimatedSeconds": 60
}
```

## `GET /api/market-context/fill/:jobId`

배치 진행 상태.

**Response 200**:
```json
{
  "jobId": "uuid",
  "status": "running" | "completed" | "failed",
  "filled": 90,
  "skippedNoData": 8,
  "failed": 0,
  "total": 138
}
```

## `GET /api/market-context/upcoming-events`

다가오는 경제 이벤트 (대시보드 위젯).

**Query**: `windowHours` (default 24)

**Response 200**:
```json
{
  "events": [
    {
      "type": "cpi",
      "scheduledAt": "2026-05-24T12:30:00Z",
      "country": "US",
      "expectedImpact": "high"
    },
    {
      "type": "fomc",
      "scheduledAt": "2026-05-28T18:00:00Z",
      "country": "US",
      "expectedImpact": "high"
    }
  ]
}
```

## 공통 응답 규약

**인증 실패** (401):
```json
{ "error": "unauthenticated" }
```

**RLS 위반** (404 — 정보 누출 방지로 not found):
```json
{ "error": "not_found" }
```

**검증 실패** (400):
```json
{ "error": "validation_failed", "issues": [ { "path": "drawdownLimit", "message": "must be > 0" } ] }
```

**Rate limited** (429):
```json
{ "error": "rate_limited", "retryAfterSeconds": 60 }
```

**서버 오류** (500):
```json
{ "error": "internal_error", "requestId": "uuid" }
```
