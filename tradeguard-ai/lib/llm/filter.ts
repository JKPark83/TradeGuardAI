// Post-generation 위로 표현(warmth/comfort) detector for AI 회고.
// See research.md#R-09 and spec.md#FR-013 / SC-003.
//
// This module is deliberately pure + deterministic:
//   - No I/O, no state, no dependencies.
//   - Same input → same boolean → easy to unit-test exhaustively.
//   - The service layer (lib/services/retrospective.ts) handles the retry
//     loop; this file only answers "does this text contain warmth?".

// Whitespace tolerance is encoded with `\s*` rather than `\s+` so the regex
// catches both "다음에잘" (no space) and "다음에 잘" (single space).
// All patterns are case-insensitive even though Korean has no case — the
// `i` flag is harmless and future-proofs us if ASCII fragments creep in.
export const BLACKLIST: ReadonlyArray<RegExp> = [
  /괜찮/i,
  /다음에\s*잘/i,
  /잘했/i,
  /수고했/i,
  /걱정\s*마/i,
  /힘내/i,
  /화이팅/i,
  /파이팅/i,
  /좋은\s*경험/i,
];

/**
 * Returns `true` if `text` matches any blacklisted warmth/encouragement
 * phrase. The check is intentionally over-eager: false positives just trigger
 * a regeneration attempt, while a missed false negative would silently break
 * SC-003 (≤ 2% warmth-expression rate).
 */
export function containsWarmthExpression(text: string): boolean {
  if (!text) return false;
  for (const pattern of BLACKLIST) {
    if (pattern.test(text)) return true;
  }
  return false;
}
