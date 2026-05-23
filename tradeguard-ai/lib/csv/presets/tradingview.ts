// TradingView Strategy/Manual Trade export preset.
// TradingView exports order-level data; pairing into round-trip trades
// happens upstream. Mapping covers the canonical columns.

import type { BrokerPreset } from './index';

export const tradingviewPreset: BrokerPreset = {
  name: 'tradingview',
  headerSignature: [
    'Symbol',
    'Side',
    'Type',
    'Qty',
    'Avg Price',
    'Filled',
    'Status',
    'Filled Time',
  ],
  columnMapping: {
    symbol: 'Symbol',
    side: 'Side',
    entry_at: 'Filled Time',
    exit_at: 'Filled Time',
    entry_price: 'Avg Price',
    exit_price: 'Avg Price',
    // TradingView's basic export lacks a true PnL column on entry orders;
    // pipeline computes per-pair PnL when status/side pairing completes.
    // We map to `Filled` as a stable placeholder column that always exists
    // in the export, and the validator skips pnl checks when null/empty.
    pnl: 'Filled',
    contracts: 'Qty',
  },
  timeFormat: "yyyy-MM-dd'T'HH:mm:ssXXX",
  pnlSignConvention: 'computed',
  sideValueMap: {
    Buy: 'long',
    Sell: 'short',
    Long: 'long',
    Short: 'short',
  },
};
