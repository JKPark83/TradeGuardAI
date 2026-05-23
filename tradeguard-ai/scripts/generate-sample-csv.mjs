#!/usr/bin/env node
/**
 * 1년치 샘플 거래 데이터 생성기 — TradeGuard AI 테스트용.
 *
 * 출력: tests/fixtures/sample-1year-ebest.csv
 * 프리셋: ebest (한국어 헤더 + 1-row-per-trade with separate entry/exit)
 *
 * 시드 기반 결정론 — 다시 실행해도 같은 CSV 생성됨. 시드를 바꾸면 새 데이터셋.
 *
 * 포함된 현실적 패턴 (US1~US4 분석이 의미 있도록):
 *   - ~52% 베이스 승률, 종목별 변동
 *   - 손절 지연 (8%) — 평균 보유시간의 3~5배
 *   - 복구매매 (5%) — 손실 후 10분 내 재진입
 *   - 확신 과다 (3%) — 연승 후 2배 사이즈
 *   - 연속 손실 streak (간헐적 3~5건)
 *   - 야간 매매 (10%) — 22:00~06:00 UTC
 *   - CPI/FOMC 클러스터 (월 1~2회) — 발표 시각 ±60분에 손실 집중
 *
 * 실행:
 *   node scripts/generate-sample-csv.mjs              # 기본 1년
 *   node scripts/generate-sample-csv.mjs --days=180   # 6개월
 *   node scripts/generate-sample-csv.mjs --seed=42    # 다른 시드
 *   node scripts/generate-sample-csv.mjs --end=2026-12-31  # 종료일 지정
 */

import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const OUT_PATH = resolve(REPO_ROOT, 'tests/fixtures/sample-1year-ebest.csv');

// ─── CLI 옵션 ─────────────────────────────────────────────────────────────

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .filter((a) => a.startsWith('--'))
    .map((a) => {
      const [k, v] = a.replace(/^--/, '').split('=');
      return [k, v ?? 'true'];
    }),
);

const SEED = Number(args.seed ?? 20260523);
const DAYS = Number(args.days ?? 365);
const END_DATE = args.end ? new Date(args.end) : new Date('2026-05-22T23:59:59Z');

// ─── 결정론적 PRNG (Mulberry32) ─────────────────────────────────────────

function makeRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = makeRng(SEED);
const rand = () => rng();
const randInt = (min, max) => Math.floor(rand() * (max - min + 1)) + min;
const randomGaussian = () => {
  // Box-Muller
  const u = 1 - rand();
  const v = 1 - rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};

// ─── 도메인 상수 ──────────────────────────────────────────────────────────

const SYMBOLS = [
  // NQ family (Nasdaq) — tick=0.25, 1pt=$20 (NQ), $2 (MNQ)
  { code: 'NQ', basePrice: 18000, drift: 0.0008, dailyVol: 0.012, tick: 0.25, ptValue: 20, share: 0.55 },
  { code: 'MNQ', basePrice: 18000, drift: 0.0008, dailyVol: 0.012, tick: 0.25, ptValue: 2, share: 0.1 },
  // ES family (S&P) — tick=0.25, 1pt=$50 (ES), $5 (MES)
  { code: 'ES', basePrice: 5500, drift: 0.0005, dailyVol: 0.008, tick: 0.25, ptValue: 50, share: 0.25 },
  { code: 'MES', basePrice: 5500, drift: 0.0005, dailyVol: 0.008, tick: 0.25, ptValue: 5, share: 0.1 },
];

// 1년 일자별 종가 시뮬레이션 (지오메트릭 브라우니안)
function simulateDailyPrices(symbol, startDate, days) {
  const prices = new Map();
  let price = symbol.basePrice;
  for (let i = 0; i < days; i += 1) {
    const date = new Date(startDate.getTime() + i * 86400_000);
    const drift = symbol.drift;
    const shock = randomGaussian() * symbol.dailyVol;
    price = price * Math.exp(drift - 0.5 * symbol.dailyVol ** 2 + shock);
    price = Math.round(price / symbol.tick) * symbol.tick;
    prices.set(dateKey(date), price);
  }
  return prices;
}

function dateKey(d) {
  return d.toISOString().slice(0, 10);
}

function isWeekday(date) {
  const day = date.getUTCDay();
  return day !== 0 && day !== 6;
}

// CPI / FOMC 일정 — 1년에 ~20개 클러스터 (월 ~2회)
function generateEventDays(startDate, endDate) {
  const events = [];
  const cursor = new Date(startDate);
  cursor.setUTCDate(1);
  while (cursor <= endDate) {
    const firstOfMonth = new Date(cursor);

    // CPI — 둘째주 수요일 12:30 UTC
    let cpiDay = new Date(firstOfMonth);
    let wedCount = 0;
    while (wedCount < 2 && cpiDay.getUTCMonth() === firstOfMonth.getUTCMonth()) {
      if (cpiDay.getUTCDay() === 3) wedCount += 1;
      if (wedCount < 2) cpiDay = new Date(cpiDay.getTime() + 86400_000);
    }
    if (wedCount === 2 && cpiDay >= startDate && cpiDay <= endDate) {
      const cpiTime = new Date(cpiDay);
      cpiTime.setUTCHours(12, 30, 0, 0);
      events.push({ type: 'CPI', time: cpiTime });
    }

    // FOMC — 3, 6, 9, 12월 셋째 수요일 18:00 UTC (분기마다)
    if ([2, 5, 8, 11].includes(cursor.getUTCMonth())) {
      let fomcDay = new Date(firstOfMonth);
      let wc = 0;
      while (wc < 3 && fomcDay.getUTCMonth() === firstOfMonth.getUTCMonth()) {
        if (fomcDay.getUTCDay() === 3) wc += 1;
        if (wc < 3) fomcDay = new Date(fomcDay.getTime() + 86400_000);
      }
      if (wc === 3 && fomcDay >= startDate && fomcDay <= endDate) {
        const fomcTime = new Date(fomcDay);
        fomcTime.setUTCHours(18, 0, 0, 0);
        events.push({ type: 'FOMC', time: fomcTime });
      }
    }

    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return events;
}

// ─── 트레이드 생성 ───────────────────────────────────────────────────────

function weightedPickSymbol() {
  const r = rand();
  let cum = 0;
  for (const s of SYMBOLS) {
    cum += s.share;
    if (r <= cum) return s;
  }
  return SYMBOLS[0];
}

function formatPrice(p, tick) {
  const decimals = tick.toString().split('.')[1]?.length ?? 0;
  return p.toFixed(decimals);
}

function formatDateTime(d) {
  // ebest 포맷: yyyy-MM-dd HH:mm:ss (UTC)
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

function expirationCode(date) {
  // 분기 만기 코드 (예: 03-26, 06-26, 09-26, 12-26)
  const m = date.getUTCMonth();
  const year = String(date.getUTCFullYear()).slice(2);
  const expiryMonth = m < 3 ? '03' : m < 6 ? '06' : m < 9 ? '09' : '12';
  return `${expiryMonth}-${year}`;
}

function generateTrade({ symbol, entryAt, dayPrice, opts = {} }) {
  const { stopDelay = false, revenge = false, overconfident = false, nearEvent = null } = opts;

  // 진입 가격 — 일중 변동성 (일변동의 30%)
  const intradayVol = symbol.dailyVol * 0.3;
  const entryPrice =
    Math.round((dayPrice * (1 + randomGaussian() * intradayVol)) / symbol.tick) * symbol.tick;

  // 방향 — 약 52% long bias (드리프트 살짝 반영)
  const side = rand() < 0.52 ? 'long' : 'short';

  // 계약 수 — 보통 1~3, 확신 과다 시 2배
  let contracts = randInt(1, 3);
  if (overconfident) contracts = Math.min(contracts * 2, 6);

  // 결과: 베이스 승률 ~52%. 패턴별 조정:
  let winProb = 0.52;
  if (revenge) winProb = 0.25;
  if (stopDelay) winProb = 0.18;
  if (nearEvent) winProb = 0.4;
  const hour = entryAt.getUTCHours();
  const isNight = hour >= 22 || hour < 6;
  if (isNight) winProb *= 0.92;
  const isWin = rand() < winProb;

  // 보유 시간 — 평균 30분, stop_delay면 120~240분
  let holdingMin = Math.max(2, Math.round(15 + randomGaussian() * 12));
  if (stopDelay) holdingMin = randInt(90, 240);

  // 가격 이동 — 변동성·보유시간 기반
  const moveSize =
    Math.abs(randomGaussian()) * symbol.dailyVol * dayPrice * 0.5 * Math.sqrt(holdingMin / 30);
  const directionMul = isWin ? 1 : -1;
  const sideMul = side === 'long' ? 1 : -1;
  const priceDelta = directionMul * sideMul * moveSize;
  const exitPrice = Math.round((entryPrice + priceDelta) / symbol.tick) * symbol.tick;

  const points = (exitPrice - entryPrice) * sideMul;
  const pnl = Math.round(points * contracts * symbol.ptValue * 100) / 100;

  return {
    symbol: `${symbol.code} ${expirationCode(entryAt)}`,
    side,
    entry_at: formatDateTime(entryAt),
    exit_at: formatDateTime(new Date(entryAt.getTime() + holdingMin * 60_000)),
    entry_price: formatPrice(entryPrice, symbol.tick),
    exit_price: formatPrice(exitPrice, symbol.tick),
    pnl: pnl.toFixed(2),
    contracts: String(contracts),
  };
}

// ─── 메인 생성 루프 ─────────────────────────────────────────────────────

function main() {
  const startDate = new Date(END_DATE.getTime() - DAYS * 86400_000);
  startDate.setUTCHours(0, 0, 0, 0);

  // 종목별 일자별 가격
  const priceSeries = new Map();
  for (const s of SYMBOLS) {
    priceSeries.set(s.code, simulateDailyPrices(s, startDate, DAYS + 1));
  }

  const events = generateEventDays(startDate, END_DATE);
  const eventByDay = new Map();
  for (const ev of events) {
    eventByDay.set(dateKey(ev.time), ev);
  }

  // 거래 생성
  const trades = [];
  let recentLossStreak = 0;
  let lastWinStreak = 0;
  let lastExitTime = null;

  // 패턴 카운터 (디버그용)
  const patternCounts = { revenge: 0, stopDelay: 0, overconfident: 0, night: 0, nearEvent: 0 };

  for (let day = 0; day < DAYS; day += 1) {
    const dayDate = new Date(startDate.getTime() + day * 86400_000);
    if (!isWeekday(dayDate)) continue;

    const dayTradeCount = Math.max(0, Math.round(5 + randomGaussian() * 2));
    const event = eventByDay.get(dateKey(dayDate));

    for (let t = 0; t < dayTradeCount; t += 1) {
      // 진입 시각 — 정규 13:30~21:00 UTC 또는 야간 22~06
      let hour, minute;
      if (rand() < 0.1) {
        hour = rand() < 0.5 ? randInt(22, 23) : randInt(0, 5);
        minute = randInt(0, 59);
      } else {
        hour = randInt(13, 20);
        minute = randInt(0, 59);
      }
      const entryAt = new Date(dayDate);
      entryAt.setUTCHours(hour, minute, randInt(0, 59), 0);

      const symbol = weightedPickSymbol();
      const dayPrice = priceSeries.get(symbol.code).get(dateKey(dayDate)) ?? symbol.basePrice;

      const nearEvent =
        event && Math.abs(entryAt.getTime() - event.time.getTime()) < 60 * 60_000 ? event : null;

      const isRevenge =
        lastExitTime &&
        recentLossStreak >= 1 &&
        entryAt.getTime() - lastExitTime.getTime() < 10 * 60_000 &&
        rand() < 0.5;

      const isStopDelay = !isRevenge && rand() < 0.08;
      const isOverconfident = !isRevenge && !isStopDelay && lastWinStreak >= 2 && rand() < 0.3;
      const isNight = hour >= 22 || hour < 6;

      const trade = generateTrade({
        symbol,
        entryAt,
        dayPrice,
        opts: {
          stopDelay: isStopDelay,
          revenge: isRevenge,
          overconfident: isOverconfident,
          nearEvent: nearEvent ? nearEvent.type : null,
        },
      });

      trades.push(trade);
      if (isRevenge) patternCounts.revenge += 1;
      if (isStopDelay) patternCounts.stopDelay += 1;
      if (isOverconfident) patternCounts.overconfident += 1;
      if (isNight) patternCounts.night += 1;
      if (nearEvent) patternCounts.nearEvent += 1;

      const pnlNum = Number(trade.pnl);
      if (pnlNum < 0) {
        recentLossStreak += 1;
        lastWinStreak = 0;
      } else if (pnlNum > 0) {
        recentLossStreak = 0;
        lastWinStreak += 1;
      }
      lastExitTime = new Date(`${trade.exit_at}Z`);
    }
  }

  // 시간 순 정렬
  trades.sort((a, b) => a.entry_at.localeCompare(b.entry_at));

  // CSV — ebest 한국어 헤더
  const header = '종목,진입시간,청산시간,방향,진입가,청산가,손익,계약수';
  const rows = trades.map((t) =>
    [
      t.symbol,
      t.entry_at,
      t.exit_at,
      t.side === 'long' ? '매수' : '매도',
      t.entry_price,
      t.exit_price,
      t.pnl,
      t.contracts,
    ].join(','),
  );
  const csv = `${[header, ...rows].join('\n')}\n`;

  writeFileSync(OUT_PATH, csv, 'utf8');

  // 통계 요약
  const total = trades.length;
  const wins = trades.filter((t) => Number(t.pnl) > 0).length;
  const losses = trades.filter((t) => Number(t.pnl) < 0).length;
  const totalPnl = trades.reduce((s, t) => s + Number(t.pnl), 0);
  const symbolDist = {};
  for (const t of trades) {
    const code = t.symbol.split(' ')[0];
    symbolDist[code] = (symbolDist[code] || 0) + 1;
  }

  console.log(`✅ 생성 완료: ${OUT_PATH}`);
  console.log(
    `총 ${total}건 (시드=${SEED}, 기간=${DAYS}일, 종료=${END_DATE.toISOString().slice(0, 10)})`,
  );
  console.log(`승률: ${((wins / total) * 100).toFixed(1)}% (W ${wins} / L ${losses})`);
  console.log(`누적 손익: $${totalPnl.toFixed(2)}`);
  console.log(`종목 분포:`, symbolDist);
  console.log(
    `이벤트: CPI ${events.filter((e) => e.type === 'CPI').length}개, FOMC ${events.filter((e) => e.type === 'FOMC').length}개`,
  );
  console.log(`패턴 카운트:`, patternCounts);
}

main();
