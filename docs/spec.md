# TradeGuard AI
## AI 기반 해외선물 리스크 가드레일 시스템

---

## 1. 프로젝트 목표

TradeGuard AI는 해외선물 트레이더의:
- 손절 지연
- 복구매매
- 확신 과다
- 감정적 진입

패턴을 분석하고, 시장 데이터와 결합하여:
- 현재 진입 위험도
- 과거 유사 상황
- 행동 기반 리스크

를 제공하는 개인용 AI 트레이딩 가드레일 시스템이다.

핵심은 **"시장 예측"**보다 **"사용자 행동 리스크 관리"**에 집중한다.

---

## 2. 핵심 기능 정의

### 핵심 기능 1 — 거래 기록 업로드

사용자는 CSV 업로드 또는 API 연동을 통해 거래내역을 입력한다.

지원 데이터:
- 종목
- 진입 시간
- 청산 시간
- 방향 (Long/Short)
- 진입가
- 청산가
- 손익
- 계약 수

### 핵심 기능 2 — 과거 거래 분석

시스템은 다음을 분석한다:
- 손절 지연
- 물타기
- 복구매매
- 연속 손실 후 행동
- 시간대별 승률
- 변동성 구간 성과

### 핵심 기능 3 — 시장 상황 매칭

거래 시점 기준으로 다음을 연결한다:
- VIX
- DXY
- 금리
- 거래량
- ATR
- CPI/FOMC 일정
- 나스닥 상태

### 핵심 기능 4 — AI 회고 리포트

예시:
> "이번 손실은 CPI 직전 변동성 확대 구간에서 손절 기준을 계속 수정한 패턴과 유사합니다."

### 핵심 기능 5 — 현재 진입 위험도

사용자: "지금 NQ Long 들어가도 될까?"

시스템은 다음을 비교한다:
- 현재 시장 상태
- 사용자 과거 패턴
- 유사 상황

출력:
- 위험도 점수
- 유사 과거 패턴
- 경고 메시지

---

## 3. 추천 기술 스택

### Frontend — Next.js 15 (App Router)
- Vercel 최적화
- SSR 지원
- API Route 내장
- AI 프로젝트 친화적

### UI — TailwindCSS + shadcn/ui
- 빠른 개발
- 깔끔한 다크 UI
- 금융앱 스타일 구현 용이

### Backend — Supabase
- PostgreSQL
- Auth
- Storage
- Row Level Security
- Edge Functions

### AI — OpenAI API
사용 목적:
- 거래 패턴 분석
- 회고 리포트 생성
- 위험 설명
- 행동 분석

추천 모델: GPT-5.5, text-embedding

### 시장 데이터 API
- **초기**: Yahoo Finance, Finnhub, AlphaVantage
- **후기**: Polygon.io, TwelveData

---

## 4. 전체 아키텍처

```
[Next.js Frontend]
       ↓
 [Vercel Hosting]
       ↓
  [API Routes]
       ↓
   [Supabase]
   ├── PostgreSQL
   ├── Auth
   ├── Storage
   └── Edge Functions
       ↓
  [OpenAI API]
       ↓
[Market Data APIs]
```

---

## 5. 데이터베이스 설계

### users
Supabase Auth 기본 사용.

### trades

| 컬럼 | 타입 |
|---|---|
| id | uuid |
| user_id | uuid |
| symbol | text |
| side | text |
| entry_price | numeric |
| exit_price | numeric |
| pnl | numeric |
| quantity | numeric |
| opened_at | timestamp |
| closed_at | timestamp |
| created_at | timestamp |

### market_snapshots

| 컬럼 | 타입 |
|---|---|
| id | uuid |
| symbol | text |
| timestamp | timestamp |
| vix | numeric |
| dxy | numeric |
| volume | numeric |
| atr | numeric |
| event_type | text |

### analyses

| 컬럼 | 타입 |
|---|---|
| id | uuid |
| trade_id | uuid |
| user_id | uuid |
| risk_score | integer |
| revenge_score | integer |
| overconfidence_score | integer |
| analysis_text | text |
| created_at | timestamp |

### behavioral_patterns

| 컬럼 | 타입 |
|---|---|
| id | uuid |
| user_id | uuid |
| avg_stop_delay | numeric |
| avg_revenge_trade_time | numeric |
| max_loss_streak | integer |
| night_trading_score | integer |
| overconfidence_score | integer |

---

## 6. 프로젝트 폴더 구조

```
/app
  /dashboard
  /upload
  /analysis
  /api

/components
  /charts
  /trades
  /risk

/lib
  /supabase
  /openai
  /market
  /analysis

/types

/utils
```

---

## 7. MVP 개발 단계

### PHASE 1 — 거래 업로드 시스템
**목표**: CSV 업로드 + DB 저장

구현:
- 로그인
- CSV 업로드
- trades 저장

예상 기간: 2~3일

### PHASE 2 — 기본 분석 엔진
분석:
- 손절 지연
- 연속 손실
- 복구매매
- 시간대 분석

예상 기간: 4~5일

### PHASE 3 — GPT 회고 시스템
OpenAI 연동.

출력:
- 거래 회고
- 행동 분석
- 위험 분석

예상 기간: 3~4일

### PHASE 4 — 시장 데이터 연결
추가:
- VIX
- DXY
- ATR
- 경제 일정

예상 기간: 5~7일

### PHASE 5 — 실시간 진입 위험도
입력: "지금 진입해도 될까?"

출력:
- 위험 점수
- 유사 과거 상황
- 경고

예상 기간: 1~2주

---

## 8. AI 분석 로직

초기에는 머신러닝보다 **"규칙 기반 + GPT"** 조합 사용 권장.

### 예시 규칙

```
if (loss_streak >= 3 && time_since_last_trade < 10min)
    revenge_score += 30

if (holding_time > avg_holding_time * 3)
    stop_delay_score += 20
```

---

## 9. OpenAI 프롬프트 예시

```
사용자의 거래를 분석하라.

분석 포인트:
- 복구매매 가능성
- 확신 과다
- 손절 지연
- 변동성 이벤트 영향
- 감정적 진입 가능성

시장 상태:
VIX: 28
CPI 발표 1시간 전
DXY 상승 중

거래:
NQ Long
손실: -1200$

출력:
- 위험 분석
- 행동 분석
- 개선 포인트
```

---

## 10. UI 컨셉

스타일:
- 블랙/다크
- 터미널 느낌
- 리스크 시스템 느낌

중요: **"위로"보다 "냉정한 분석"**

예시:
- ❌ "괜찮아요"
- ⭕ "현재 행동은 과거 대손실 패턴과 유사합니다."

---

## 11. 추천 구현 순서

1. Next.js 생성
2. Supabase 연결
3. 로그인
4. CSV 업로드
5. trades 저장
6. 분석 로직
7. GPT 연동
8. 대시보드
9. 시장 데이터 연결
10. 위험도 시스템

---

## 12. 추천 배포 구조

- **Front**: Vercel
- **DB/Auth**: Supabase
- **Cron**: Vercel Cron 또는 Supabase Edge Functions

---

## 13. 초기 MVP 목표

목표는 **"완벽한 AI"**가 아니라, **"내 매매를 객관적으로 보게 만드는 시스템"**이어야 한다.

초기 목표:
- 자기 패턴 시각화
- 행동 위험 감지
- 감정적 진입 억제

---

## 14. 미래 확장 가능성

- 실시간 브로커 연동
- 모바일 앱
- 음성 AI 리스크 경고
- 거래 제한 기능
- 자동 회고 생성
- 유사 패턴 검색
- 행동 기반 승률 계산

---

## 15. 추천 개발 시작 명령어

```bash
npx create-next-app@latest tradeguard-ai
```

설치 추천:
- TailwindCSS
- TypeScript
- ESLint
- App Router

---

## 16. 추천 Supabase 설정

생성:
- project
- database
- auth
- storage bucket (`csv-upload`)

환경변수:
```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
OPENAI_API_KEY
```

---

## 17. 가장 중요한 철학

이 프로젝트의 목적은 **"시장을 맞추는 것"**이 아니다.

목표는:

> **"사용자가 무너지는 순간을 먼저 감지하는 것"**
