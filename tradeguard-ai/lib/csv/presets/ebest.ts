// eBest 해외선물 거래내역 CSV preset.
// Headers are Korean — broker keeps native locale on exports.
// See research.md R-06 for the canonical column set.

import type { BrokerPreset } from './index';

export const ebestPreset: BrokerPreset = {
  name: 'ebest',
  headerSignature: ['종목', '진입시간', '청산시간', '방향', '진입가', '청산가', '손익', '계약수'],
  columnMapping: {
    symbol: '종목',
    side: '방향',
    entry_at: '진입시간',
    exit_at: '청산시간',
    entry_price: '진입가',
    exit_price: '청산가',
    pnl: '손익',
    contracts: '계약수',
  },
  timeFormat: 'yyyy-MM-dd HH:mm:ss',
  pnlSignConvention: 'broker_native',
  sideValueMap: {
    매수: 'long',
    매도: 'short',
    Long: 'long',
    Short: 'short',
  },
};
