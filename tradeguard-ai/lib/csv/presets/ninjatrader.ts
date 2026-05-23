// NinjaTrader 8 Trades Export preset.
// NT8 exports one row per fill/action; the upload pipeline pairs Buy/Sell
// actions into long/short trades upstream. Here we just normalize columns.

import type { BrokerPreset } from './index';

export const ninjatraderPreset: BrokerPreset = {
  name: 'ninjatrader',
  headerSignature: [
    'Instrument',
    'Account',
    'Strategy',
    'Time',
    'Action',
    'Quantity',
    'Price',
    'Commission',
    'P&L',
  ],
  columnMapping: {
    symbol: 'Instrument',
    side: 'Action',
    entry_at: 'Time',
    // NT8's fill-level export only has a single `Time`; the pairing step
    // populates exit_at downstream. For preset-level mapping we point at the
    // same column — `applyPreset` keeps it as a string and validators skip
    // pnl checks when exit_at/exit_price are absent at a later stage.
    exit_at: 'Time',
    entry_price: 'Price',
    exit_price: 'Price',
    pnl: 'P&L',
    contracts: 'Quantity',
  },
  timeFormat: 'M/d/yyyy h:mm:ss tt',
  pnlSignConvention: 'broker_native',
  sideValueMap: {
    Buy: 'long',
    Sell: 'short',
    Long: 'long',
    Short: 'short',
  },
};
