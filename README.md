# TradeGuardAI

미국 선물 매매 데이터를 업로드해 행동 패턴(손절 지연·복구매매·과신)을 분석하고, AI 회고와 위험도 평가를 받는 도구입니다.

이 디렉터리는 **워크스페이스 컨테이너**입니다. 실제 앱 코드는 [`tradeguard-ai/`](tradeguard-ai/) 안에 있고, 그 외 서브프로젝트는 [`CLAUDE.md`](CLAUDE.md) 참고.

---

## 0. 빠른 시작

```bash
cd tradeguard-ai
cp .env.example .env.local          # 키 채우기 (아래 1.2 참고)
./scripts/test.sh --check           # 환경 점검만
./scripts/test.sh                   # 사용 가능한 명령 보기
```

---

## 1. 테스트 가이드

TradeGuard AI는 4계층 검증을 지원합니다.

| 계층 | 무엇을 검증 | 외부 의존 | 평균 시간 |
|---|---|---|---|
| **Static** (`typecheck`, `lint`) | 타입/문법 | 없음 | ~10s |
| **Unit** (`test:unit`) | 점수 함수 결정성 (골든 픽스처) | 없음 | ~5s |
| **Integration** (`test:integration`) | CSV → DB → 점수 파이프라인 (MSW로 LLM·시장 모킹) | Supabase 로컬 | ~30s |
| **E2E** (`test:e2e`) | Playwright로 6개 핵심 흐름 | Supabase 로컬 + dev server | ~2–5분 |

그 위로 **수동 스모크 테스트**(UI에서 직접 클릭) 절차는 [`tradeguard-ai/specs/001-tradeguard-ai/quickstart.md`](tradeguard-ai/specs/001-tradeguard-ai/quickstart.md)에 6단계로 정리돼 있습니다.

### 1.1 사전 준비

- Node.js ≥ 20 (`nvm install 20 && nvm use 20`)
- Docker Desktop 실행 중 (Supabase 로컬 컨테이너용)
- Supabase CLI (`brew install supabase/tap/supabase`)
- Playwright 브라우저 (E2E 처음 돌릴 때 한 번: `npx playwright install chromium`)

### 1.2 환경 변수 (`tradeguard-ai/.env.local`)

`.env.example`을 복사 후 아래 값을 채웁니다.

| 키 | 어디서 얻나 | 누가 쓰나 |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` / `..._ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` | `supabase start` 출력 | 전 계층 |
| `ANTHROPIC_API_KEY` | [console.anthropic.com](https://console.anthropic.com) | dev server / E2E |
| `FINNHUB_API_KEY` | [finnhub.io/register](https://finnhub.io/register) (무료) | 시장 컨텍스트 |
| `PII_HMAC_SECRET` | `openssl rand -hex 32` | **테스트 픽스처 결정론** ⚠ 운영은 `user_secrets` 테이블 사용 |
| `KAKAO_CLIENT_ID` / `_SECRET` | (선택) Kakao Developers | OAuth |

> Unit 테스트만 돌릴 거면 `ANTHROPIC_API_KEY`, `FINNHUB_API_KEY`는 비워둬도 됩니다.

### 1.3 자동화된 테스트

가장 빠른 신뢰 확인 (Supabase 없이):
```bash
cd tradeguard-ai
./scripts/test.sh --static    # typecheck + lint + unit
```

전체 (CI와 동일한 체크):
```bash
./scripts/test.sh --all
```

개별 실행:
```bash
./scripts/test.sh --unit
./scripts/test.sh --integration
./scripts/test.sh --e2e
```

또는 직접:
```bash
npm run test:unit
npm run test:integration
npm run test:e2e
npm run test:watch          # vitest watch 모드
```

### 1.4 수동 스모크 테스트

Supabase + Next.js dev server를 띄우고 [`quickstart.md`](tradeguard-ai/specs/001-tradeguard-ai/quickstart.md) §"핵심 흐름 검증"을 따라가세요.

```bash
./scripts/test.sh --manual
# → Supabase 자동 기동, http://localhost:3000 안내
```

검증할 6단계:
1. **거래 업로드** (`/upload`) — CSV 자동 인식 / 138건 accepted
2. **행동 분석** (`/dashboard`) — 손절 지연·복구매매·시간대별 승률 차트
3. **AI 회고** (`/trades` → 손실 거래 → "회고 생성") — 위로 표현 없는지, PII 누출 없는지
4. **Tilt + 위험도** (`/session`, `/risk`) — sleep=4, stress=8 입력 시 Red, riskScore ≥ 70
5. **Prop Firm** (`/prop-firm`) — Topstep 50K 등록 → 대시보드 잔여 손실 패널
6. **데이터 전체 삭제** — `DELETE /api/account/data`로 모두 0건 확인

### 1.5 자주 막히는 곳

| 증상 | 원인 / 해결 |
|---|---|
| `supabase start` 포트 충돌 | `supabase stop && docker ps`로 점유 확인 (5432·54321·54322) |
| Playwright "browser not installed" | `npx playwright install chromium` |
| Unit OK / Integration 실패 | Supabase 로컬 미가동 — `supabase status`로 확인 |
| OAuth 콜백 404 | 로컬은 Magic Link만 사용 (Supabase Studio → Auth → users) |
| AI 회고 응답 7초 초과 | `ANTHROPIC_MODEL=claude-haiku-4-5-20251001`로 토글 |
| 회고에 "괜찮"·"잘했" 단어 | `lib/llm/filter.ts` 블랙리스트 / `lib/llm/prompts.ts` negative example 보강 |
| 시장 데이터 결측 | Yahoo·Finnhub 한도 초과 가능성. 캐시 무효화 후 재시도 |

---

## 2. 다른 서브프로젝트

워크스페이스에 함께 보관된 독립 프로젝트는 [`CLAUDE.md`](CLAUDE.md)에 정리돼 있습니다. 각 서브 디렉터리에 자체 `README.md` / `CLAUDE.md`가 있으니 그쪽이 우선입니다.
