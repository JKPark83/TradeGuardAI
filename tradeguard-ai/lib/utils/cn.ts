/**
 * Minimal classname joiner — concatenates truthy class values with spaces.
 *
 * Deliberately written without `clsx` to avoid an extra dependency.
 * Accepts the common conditional patterns:
 *   cn('a', condition && 'b', undefined, falsy && 'c', 'd')
 *
 * For object-style merging (`cn({ active: true })`), upgrade to `clsx` later.
 */

export type ClassValue = string | number | false | null | undefined;

export function cn(...inputs: ClassValue[]): string {
  const out: string[] = [];
  for (const input of inputs) {
    if (typeof input === 'string' && input.length > 0) {
      out.push(input);
    } else if (typeof input === 'number') {
      out.push(String(input));
    }
  }
  return out.join(' ');
}
