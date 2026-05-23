/**
 * Broker preset detection + side-value normalization.
 *
 * Validates research.md R-06: the 3 system presets (ebest, ninjatrader,
 * tradingview) must auto-detect by header signature and normalize side
 * strings into canonical 'long' | 'short'.
 *
 * Tests are behavioral: they don't introspect the preset objects, they
 * synthesize CSV header arrays and assert the detected preset's `name`.
 */

import { describe, it, expect } from 'vitest';

import {
  detectPreset,
  applyPreset,
  SYSTEM_PRESETS,
  type BrokerPreset,
} from '@/lib/csv/presets/index';

function presetByName(name: string): BrokerPreset {
  const p = SYSTEM_PRESETS.find((x) => x.name === name);
  if (!p) throw new Error(`fixture: missing system preset "${name}"`);
  return p;
}

// ---- detectPreset: signature matching ---------------------------------

describe('detectPreset', () => {
  it('detects ebest from its full header signature', () => {
    const headers = presetByName('ebest').headerSignature.slice();
    const match = detectPreset(headers);
    expect(match).not.toBeNull();
    expect(match?.preset.name).toBe('ebest');
  });

  it('detects ninjatrader from its full header signature', () => {
    const headers = presetByName('ninjatrader').headerSignature.slice();
    const match = detectPreset(headers);
    expect(match).not.toBeNull();
    expect(match?.preset.name).toBe('ninjatrader');
  });

  it('detects tradingview from its full header signature', () => {
    const headers = presetByName('tradingview').headerSignature.slice();
    const match = detectPreset(headers);
    expect(match).not.toBeNull();
    expect(match?.preset.name).toBe('tradingview');
  });

  it('returns null when a required column is missing', () => {
    const sig = presetByName('ebest').headerSignature;
    // Drop the first required header.
    const partial = sig.slice(1);
    expect(detectPreset(partial)).toBeNull();
  });

  it('detection is independent of header order', () => {
    const shuffled = [...presetByName('ninjatrader').headerSignature].reverse();
    const match = detectPreset(shuffled);
    expect(match?.preset.name).toBe('ninjatrader');
  });

  it('ninjatrader headers are case-sensitive — lowercase fails', () => {
    const lowered = presetByName('ninjatrader').headerSignature.map((h) => h.toLowerCase());
    expect(detectPreset(lowered)).toBeNull();
  });

  it('returns null on completely unrelated headers', () => {
    expect(detectPreset(['foo', 'bar', 'baz'])).toBeNull();
  });

  it('returns null on empty header list', () => {
    expect(detectPreset([])).toBeNull();
  });
});

// ---- applyPreset: sideValueMap conversion -----------------------------

describe('applyPreset — sideValueMap normalization', () => {
  it('converts ebest 매수/매도 to long/short', () => {
    const preset = presetByName('ebest');
    const rows: Record<string, string>[] = [
      {
        종목: 'NQ',
        진입시간: '2026-05-20 13:00:00',
        청산시간: '2026-05-20 13:42:00',
        방향: '매수',
        진입가: '18250.5',
        청산가: '18260.0',
        손익: '190.0',
        계약수: '1',
      },
      {
        종목: 'ES',
        진입시간: '2026-05-20 14:00:00',
        청산시간: '2026-05-20 14:15:00',
        방향: '매도',
        진입가: '5800',
        청산가: '5795',
        손익: '250',
        계약수: '1',
      },
    ];
    const normalized = applyPreset(rows, preset);
    expect(normalized[0]?.side).toBe('long');
    expect(normalized[1]?.side).toBe('short');
  });

  it('converts ninjatrader Buy/Sell to long/short', () => {
    const preset = presetByName('ninjatrader');
    const rows: Record<string, string>[] = [
      {
        Instrument: 'NQ 06-26',
        Account: 'Sim101',
        Strategy: 'Manual',
        Time: '5/20/2026 9:00:00 AM',
        Action: 'Buy',
        Quantity: '2',
        Price: '18250.5',
        Commission: '4.50',
        'P&L': '120',
      },
      {
        Instrument: 'NQ 06-26',
        Account: 'Sim101',
        Strategy: 'Manual',
        Time: '5/20/2026 9:30:00 AM',
        Action: 'Sell',
        Quantity: '2',
        Price: '18245.0',
        Commission: '4.50',
        'P&L': '-220',
      },
    ];
    const normalized = applyPreset(rows, preset);
    expect(normalized[0]?.side).toBe('long');
    expect(normalized[1]?.side).toBe('short');
  });

  it('throws on unknown side value (e.g., "foobar")', () => {
    const preset = presetByName('ebest');
    const rows: Record<string, string>[] = [
      {
        종목: 'NQ',
        진입시간: '2026-05-20 13:00:00',
        청산시간: '2026-05-20 13:42:00',
        방향: 'foobar',
        진입가: '100',
        청산가: '101',
        손익: '50',
        계약수: '1',
      },
    ];
    expect(() => applyPreset(rows, preset)).toThrow();
  });

  it('preserves stringified numerics (NUMERIC-as-string convention)', () => {
    const preset = presetByName('ebest');
    const rows: Record<string, string>[] = [
      {
        종목: 'NQ',
        진입시간: '2026-05-20 13:00:00',
        청산시간: '2026-05-20 13:42:00',
        방향: '매수',
        진입가: '18250.5',
        청산가: '18260.0',
        손익: '190.0',
        계약수: '1',
      },
    ];
    const [row] = applyPreset(rows, preset);
    expect(typeof row?.entry_price).toBe('string');
    expect(row?.entry_price).toBe('18250.5');
    expect(row?.contracts).toBe('1');
  });
});
