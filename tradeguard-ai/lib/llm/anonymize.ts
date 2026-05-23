// PII anonymization layer — see specs/001-tradeguard-ai/research.md#R-04.
//
// Deterministic so same trade → same token across calls → consistent LLM analysis.
// The caller MUST supply the per-user `userSecret` (from user_secrets.pii_hmac_secret).
// This module never reads PII_HMAC_SECRET from env — separation of concerns:
// secret retrieval is the caller's responsibility, tokenization is ours.

import { createHmac } from 'node:crypto';

import type { Trade, TradeSide, ISODateTime } from '@/types/db';

/**
 * Deterministic HMAC-SHA256 tokenizer.
 * Returns the first 12 hex characters of HMAC(userSecret, value).
 * Same (value, userSecret) pair always produces the same token.
 */
export function anonymizeValue(value: string, userSecret: string): string {
  if (!userSecret) {
    throw new Error('anonymizeValue: userSecret is required');
  }
  return createHmac('sha256', userSecret).update(value).digest('hex').slice(0, 12);
}

/**
 * Anonymized projection of a Trade row safe to ship to an external LLM.
 * Strips PII fields (account, name, email, broker_id if present) and tokenizes
 * internal IDs into stable short tokens (T_xxxxxx, S_xxxxxx).
 */
export interface AnonymizedTrade {
  id: string; // "T_<12hex>"
  session_id: string | null; // "S_<12hex>" | null
  symbol: string;
  side: TradeSide;
  entry_price: string;
  exit_price: string | null;
  entry_at: ISODateTime;
  exit_at: ISODateTime | null;
  contracts: string;
  pnl: string | null;
}

/**
 * Project a Trade into its LLM-safe form.
 * Keeps analysis-relevant numeric/temporal fields verbatim; tokenizes IDs;
 * drops any PII-bearing field if it ever appears on the input object.
 */
export function anonymizeTrade(trade: Trade, userSecret: string): AnonymizedTrade {
  return {
    id: `T_${anonymizeValue(trade.id, userSecret)}`,
    session_id:
      trade.session_id === null ? null : `S_${anonymizeValue(trade.session_id, userSecret)}`,
    symbol: trade.symbol,
    side: trade.side,
    entry_price: trade.entry_price,
    exit_price: trade.exit_price,
    entry_at: trade.entry_at,
    exit_at: trade.exit_at,
    contracts: trade.contracts,
    pnl: trade.pnl,
  };
}
