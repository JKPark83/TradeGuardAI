# Contract: Risk Assessment API

## `POST /api/risk/assess`

후보 거래에 대한 실시간 진입 위험도 평가.

**Request**:
```json
{
  "candidateSymbol": "NQ",
  "candidateSide": "long",
  "candidateContracts": 2,
  "includeLLMExplanation": true
}
```

**Response 200** (p95 ≤ 5초 — SC-004):
```json
{
  "assessmentId": "uuid",
  "riskScore": 78,
  "signalsBreakdown": {
    "recentPnlStreak": 60,
    "marketContext": 45,
    "similarHistoryLossRate": 70,
    "tilt": 100,
    "propFirmRoom": 80
  },
  "weights": {
    "recentPnlStreak": 0.20,
    "marketContext": 0.15,
    "similarHistoryLossRate": 0.25,
    "tilt": 0.20,
    "propFirmRoom": 0.20
  },
  "warningMessage": "현재 행동은 과거 대손실 패턴과 유사합니다.",
  "tiltColor": "red",
  "propFirmRoom": [
    { "profileId": "uuid", "label": "Topstep 50K", "dailyLossRoom": 220, "drawdownRoom": 480 }
  ],
  "similarPastTrades": [
    { "tradeId": "uuid", "entryAt": "2026-04-12T14:00:00Z", "pnl": -480, "similarity": 0.86 }
  ],
  "llmExplanation": "직전 2시간 내 2연속 손실 + Tilt Red + Prop Firm 룰 잔여 ...",
  "warningRaisedAt": "2026-05-23T13:45:01Z"
}
```

**Behavior**:
- 5신호 계산은 결정론(`lib/scoring/risk.ts`)
- Tilt가 Red면 `riskScore` floor=70 강제(FR-025, SC-008)
- 활성 세션의 Tilt 체크인이 없으면 `tiltColor: "absent"`, 가중치는 다른 신호로 재분배
- 등록된 Prop Firm 프로필이 없으면 propFirmRoom 신호 가중치 재분배 후 빈 배열
- `includeLLMExplanation=true`일 때만 LLM 호출(비용 절감 옵션)
- 결과는 항상 `risk_assessments` 테이블에 저장 (FR-018)

## `GET /api/risk/assessments/recent`

최근 위험도 평가 이력.

**Query**: `limit` (default 20)

**Response 200**: `{ "assessments": [ ... ] }`

## `GET /api/risk/similar-trades`

후보 거래와 유사한 과거 거래 검색 (LLM 없이 패턴만).

**Query**:
- `symbol` (required)
- `side` (required)
- `marketContextHint`: `vix-high` | `event-near` 등 (optional)

**Response 200**:
```json
{
  "matches": [
    { "tradeId": "uuid", "entryAt": "...", "pnl": -400, "vix": 28.5, "eventOffsetMinutes": -45, "similarity": 0.82 }
  ]
}
```

유사도는 (a) 종목·방향 일치, (b) 시장 컨텍스트(VIX 범위, 이벤트 근접) 유사, (c) 행동 점수 유사 의 가중 코사인.

## 위험도 → 사후 회고 연결 (SC-005)

`risk_score >= 70`인 평가 직후 실제 거래가 업로드되어 매칭(±5분 + symbol·side 일치)되면, 해당 거래의 회고 생성 시 입력에 `priorWarningPresent: true` 플래그가 자동 포함 — 회고 텍스트에 "사전 경고가 있었음" 단서가 반드시 등장하도록 프롬프트 가드.
