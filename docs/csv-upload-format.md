# TradeGuard AI — CSV 업로드 포맷 가이드

`tradeguard-ai`의 `/upload` 화면 또는 `POST /api/trades/upload` 엔드포인트가 받는 CSV의 규격을 정리한 문서입니다.

샘플 파일은 [`docs/samples/`](./samples/) 에 있습니다.

| 파일 | 용도 |
|---|---|
| [`sample-ebest.csv`](./samples/sample-ebest.csv) | **권장**. 표준 8개 필드를 한글 헤더로 그대로 사용한 캐노니컬 포맷 (eBest 프리셋) |
| [`sample-ninjatrader.csv`](./samples/sample-ninjatrader.csv) | NinjaTrader 8 거래 내역 export 포맷 (체결 단위) |
| [`sample-tradingview.csv`](./samples/sample-tradingview.csv) | TradingView 주문 export 포맷 (주문 단위) |

---

## 1. 시스템이 요구하는 표준 8개 필드 (Canonical Schema)

스펙 `FR-002`에 정의된 정규 필드입니다. 업로드한 CSV의 헤더가 브로커 프리셋 중 하나와 일치하면 자동으로 이 필드들에 매핑되고, 일치하지 않으면 업로드 UI에서 사용자가 직접 매핑해야 합니다.

| 정규 필드 | 타입 | 필수 | 설명 |
|---|---|---|---|
| `symbol` | string | ✅ | 종목 심볼 (예: `ESZ4`, `NQZ4`, `CLZ4`). 자유 텍스트, 트림됨 |
| `side` | enum `long` / `short` | ✅ | 방향. 브로커별 원문(`매수`/`매도`, `Buy`/`Sell`)은 프리셋이 변환 |
| `entry_at` | ISO 8601 datetime | ✅ | 진입 시각. `new Date()` 가 파싱할 수 있는 형식이면 OK |
| `exit_at` | ISO 8601 datetime · nullable | — | 청산 시각. **비어 있으면 오픈 포지션으로 처리** |
| `entry_price` | number (소수점 가능) | ✅ | 진입가. 쉼표 1000 단위 구분(`1,234.56`) 허용 |
| `exit_price` | number · nullable | — | 청산가. 비어 있으면 오픈 포지션 |
| `pnl` | signed number · nullable | — | 손익(부호 포함, **음수=손실**). 비어 있으면 청산되지 않은 행으로 간주 |
| `contracts` | positive number | ✅ | 계약수 |

### 검증 규칙 (lib/csv/validate.ts)

업로드 시 행마다 다음을 검사하고, 하나라도 실패하면 그 행은 거절(`rejected`)되며 나머지는 저장됩니다.

1. **필수 필드 누락** — `symbol`, `entry_at`, `entry_price`, `contracts` 중 하나라도 비면 거절
2. **side 정합성** — 프리셋이 `long`/`short`로 정규화하지 못하면 거절
3. **날짜 파싱 실패** — `entry_at` 또는 `exit_at`이 `Date()` 파싱 실패 시 거절
4. **숫자 파싱 실패** — `entry_price`, `contracts`, (있다면) `exit_price`, `pnl`이 숫자가 아니면 거절
5. **PnL 정합성 (FR-004)** — 청산된 행에 대해
   `expected = (exit_price − entry_price) × direction × contracts`
   를 계산해 보고된 `pnl`과 비교. 허용 오차 = `max(|expected| × 0.5%, $1)`. 초과 시 거절
   - `direction = long ? +1 : −1`
   - **수수료를 별도 컬럼으로 분리해 export하면 손익 차이가 커져 거절될 수 있음**. 대부분의 브로커는 수수료를 손익 컬럼에 이미 반영해 둠

### 중복 감지

`(owner, symbol, entry_at, exit_at, entry_price, exit_price)` 조합으로 같은 거래가 이미 있는지 확인하고, 동일 행은 다시 저장하지 않습니다 (spec edge case).

### 파일 제한

- 최대 크기: **10 MB**
- 인코딩: UTF-8 (한글 헤더의 BOM 유무는 무방)
- 헤더 행 필수

---

## 2. 지원 프리셋

업로드 직후 시스템이 헤더를 보고 자동 감지합니다 (`lib/csv/presets/`). 모든 시그니처 헤더가 CSV에 있으면 매치됩니다.

### 2.1 eBest 해외선물 — **캐노니컬 (권장)**

스펙 `FR-002`의 8개 표준 필드와 1:1로 대응합니다. 한 행 = 하나의 라운드트립 거래.

```
종목,진입시간,청산시간,방향,진입가,청산가,손익,계약수
```

- `방향`: `매수` → long, `매도` → short (영문 `Long`/`Short`도 허용)
- `손익`: 브로커 부호 그대로 사용 (`pnlSignConvention: 'broker_native'`)
- 시간 포맷: `yyyy-MM-dd HH:mm:ss`

### 2.2 NinjaTrader 8

체결(fill) 단위 export. 한 행 = 하나의 매수/매도 액션. 진입/청산 페어링은 업로드 파이프라인의 후처리 단계에서 수행됩니다.

```
Instrument,Account,Strategy,Time,Action,Quantity,Price,Commission,P&L
```

- `Action`: `Buy` → long, `Sell` → short
- `P&L`: 브로커 부호 그대로 사용
- 시간 포맷: `M/d/yyyy h:mm:ss tt` (미국식)

### 2.3 TradingView

주문 단위 export. PnL은 가격·방향·계약수로 시스템이 재계산합니다 (`pnlSignConvention: 'computed'`).

```
Symbol,Side,Type,Qty,Avg Price,Filled,Status,Filled Time
```

- `Side`: `Buy` → long, `Sell` → short
- 시간 포맷: ISO 8601 (`yyyy-MM-dd'T'HH:mm:ssXXX`)

---

## 3. 프리셋이 없을 때 (커스텀 CSV)

위 세 프리셋 어느 것도 매칭되지 않으면 업로드 UI에서 **컬럼 매핑 다이얼로그**가 뜹니다 (`components/trades/CsvMappingDialog.tsx`).

- CSV의 원본 컬럼명을 표준 8개 필드에 드래그&드롭으로 매핑
- 매핑이 완성되지 않으면 저장 거부
- 완성된 매핑은 `broker_mapping_presets` 테이블에 사용자 프리셋으로 저장되어 다음 업로드부터 자동 재사용

자세한 데이터 모델은 [`specs/001-tradeguard-ai/data-model.md`](../specs/001-tradeguard-ai/data-model.md) 참조.

---

## 4. 빠른 시작 — 캐노니컬 샘플 사용

```bash
# 1) 개발 서버 기동 (tradeguard-ai/ 디렉터리에서)
npm run dev

# 2) 브라우저에서 로그인 후 /upload 진입
# 3) docs/samples/sample-ebest.csv 업로드
# → "ebest 프리셋이 자동 감지되었습니다" 메시지 + 정상 저장 확인
```

API로 직접 올리는 경우:

```bash
curl -X POST http://localhost:3000/api/trades/upload \
  -H "Cookie: <세션 쿠키>" \
  -F "file=@docs/samples/sample-ebest.csv"
```
