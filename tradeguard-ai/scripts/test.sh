#!/usr/bin/env bash
# TradeGuard AI 테스트 러너
#
#   ./scripts/test.sh                인터랙티브 메뉴
#   ./scripts/test.sh --check        환경 점검만
#   ./scripts/test.sh --static       typecheck + lint + unit (Supabase 불필요)
#   ./scripts/test.sh --unit         단위 테스트
#   ./scripts/test.sh --integration  통합 테스트 (Supabase 자동 기동)
#   ./scripts/test.sh --e2e          E2E (Playwright + dev server)
#   ./scripts/test.sh --all          typecheck + lint + 모든 테스트 계층
#   ./scripts/test.sh --manual       Supabase + dev server를 띄우고 수동 스모크 안내

set -euo pipefail

# ── 색상 ──
if [ -t 1 ]; then
  C_R=$'\033[31m'; C_G=$'\033[32m'; C_Y=$'\033[33m'; C_B=$'\033[34m'; C_DIM=$'\033[2m'; C_OFF=$'\033[0m'
else
  C_R=""; C_G=""; C_Y=""; C_B=""; C_DIM=""; C_OFF=""
fi

info() { printf "%s▶%s %s\n" "$C_B" "$C_OFF" "$*"; }
ok()   { printf "%s✓%s %s\n" "$C_G" "$C_OFF" "$*"; }
warn() { printf "%s!%s %s\n" "$C_Y" "$C_OFF" "$*"; }
err()  { printf "%s✗%s %s\n" "$C_R" "$C_OFF" "$*" >&2; }
hr()   { printf "%s%s%s\n" "$C_DIM" "────────────────────────────────────────────" "$C_OFF"; }

# ── tradeguard-ai 루트로 이동 ──
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."
ROOT="$(pwd)"

# ── 환경 점검 ──
check_node() {
  command -v node >/dev/null 2>&1 || { err "node 가 없습니다. Node 20+ 설치 필요."; exit 1; }
  local major
  major="$(node -v | sed -E 's/^v([0-9]+)\..*/\1/')"
  if [ "$major" -lt 20 ]; then
    err "Node $major 감지됨. 20+ 필요합니다 (\`nvm install 20 && nvm use 20\`)."
    exit 1
  fi
  ok "Node $(node -v)"
}

check_env_file() {
  if [ ! -f .env.local ]; then
    err ".env.local 이 없습니다."
    echo "    cp .env.example .env.local  후 키를 채워주세요."
    exit 1
  fi
  ok ".env.local 존재"
}

check_deps() {
  if [ ! -d node_modules ]; then
    warn "node_modules 없음 — npm install 실행"
    npm install
  fi
  ok "의존성 설치됨"
}

check_supabase_cli() {
  if ! command -v supabase >/dev/null 2>&1; then
    err "supabase CLI 가 없습니다."
    echo "    brew install supabase/tap/supabase"
    exit 1
  fi
}

check_supabase_running() {
  check_supabase_cli
  if supabase status >/dev/null 2>&1; then
    ok "Supabase 로컬 가동 중"
  else
    warn "Supabase 로컬이 정지 상태 — \`supabase start\` 실행 (Docker 이미지 받는 첫 실행은 수 분 소요)"
    supabase start
    ok "Supabase 로컬 시작 완료"
  fi
}

check_playwright_browsers() {
  if ! npx --no-install playwright --version >/dev/null 2>&1; then
    warn "Playwright 미설치 — npm install 로 처리됐는지 확인"
  fi
  # 브라우저 캐시 위치는 OS마다 다르지만, 첫 실행 시 자동 안내됨.
  # 빠른 검증을 위해 chromium 설치 시도 (이미 있으면 즉시 종료).
  if ! npx playwright install --dry-run chromium >/dev/null 2>&1; then
    info "Playwright Chromium 설치"
    npx playwright install chromium
  fi
}

preflight() {
  hr
  info "환경 점검"
  check_node
  check_env_file
  check_deps
  hr
}

# ── 각 테스트 계층 ──
run_typecheck() { info "TypeScript 타입 체크"; npm run typecheck; }
run_lint()      { info "ESLint";              npm run lint; }
run_unit()      { info "Unit (점수 함수 골든)"; npm run test:unit; }

run_integration() {
  check_supabase_running
  info "Integration (CSV→DB→점수 파이프라인, LLM/시장은 MSW 모킹)"
  npm run test:integration
}

run_e2e() {
  check_supabase_running
  check_playwright_browsers
  info "E2E (Playwright — 6개 핵심 사용자 흐름)"
  npm run test:e2e
}

run_static() {
  run_typecheck
  run_lint
  run_unit
  ok "Static + Unit 모두 통과"
}

run_all() {
  run_typecheck
  run_lint
  run_unit
  run_integration
  run_e2e
  hr
  ok "모든 테스트 계층 통과 🎉"
}

run_manual() {
  check_supabase_running
  hr
  info "수동 스모크 테스트 안내"
  cat <<EOF

  Next.js dev server 를 시작합니다 (Ctrl+C 로 종료).

  주요 URL:
    앱            http://localhost:3000
    Supabase UI   http://127.0.0.1:54321

  로그인:
    /login 에서 이메일 입력 → Supabase Studio (Auth → users) 에서 Magic Link 확인

  검증할 6단계 (자세한 절차는 specs/001-tradeguard-ai/quickstart.md):
    1) /upload         CSV 업로드 — 자동 인식 / accepted/rejected 확인
    2) /dashboard      손절 지연·복구매매·시간대별 승률 차트
    3) /trades         손실 거래 클릭 → "회고 생성" → 위로 표현/PII 없는지
    4) /session, /risk sleep=4, stress=8 입력 → Tilt Red, riskScore ≥ 70
    5) /prop-firm      Topstep 50K 등록 → 잔여 손실 패널 노출
    6) DELETE /api/account/data — 모든 데이터 0건 확인

EOF
  hr
  npm run dev
}

# ── 인터랙티브 메뉴 ──
print_menu() {
  cat <<EOF

TradeGuard AI 테스트 러너

  1) Static          typecheck + lint + unit          (Supabase 불필요, ~15s)
  2) Unit            단위 테스트만                     (~5s)
  3) Integration     CSV→DB 파이프라인                 (~30s, Supabase 자동 기동)
  4) E2E             Playwright 6개 흐름               (~2–5분)
  5) All             1+3+4 전부                       (~5분+)
  6) Manual          dev server 띄우고 직접 클릭 테스트
  7) Check           환경 점검만
  q) 종료

EOF
}

interactive() {
  preflight
  while true; do
    print_menu
    printf "선택 > "
    read -r choice </dev/tty || { echo; exit 0; }
    case "$choice" in
      1) run_static ;;
      2) run_unit ;;
      3) run_integration ;;
      4) run_e2e ;;
      5) run_all ;;
      6) run_manual ;;
      7) ok "환경 OK" ;;
      q|Q|"") echo "bye"; exit 0 ;;
      *) warn "알 수 없는 선택: $choice" ;;
    esac
  done
}

# ── 진입점 ──
main() {
  case "${1:-}" in
    --check)        preflight ;;
    --static)       preflight; run_static ;;
    --unit)         preflight; run_unit ;;
    --integration)  preflight; run_integration ;;
    --e2e)          preflight; run_e2e ;;
    --all)          preflight; run_all ;;
    --manual)       preflight; run_manual ;;
    -h|--help)
      sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'
      ;;
    "")             interactive ;;
    *)
      err "알 수 없는 옵션: $1"
      sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'
      exit 1
      ;;
  esac
}

main "$@"
