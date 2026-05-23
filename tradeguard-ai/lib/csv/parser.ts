// Thin wrapper around `papaparse` for the upload pipeline.
// Returns a normalized shape so callers don't depend on Papa's full API surface.
// Pure I/O-free: takes a string, returns plain values — no fs, no network.

import Papa from 'papaparse';
import type { ParseError } from 'papaparse';

export interface CsvParseResult {
  headers: string[];
  rows: Record<string, string>[];
  errors: ParseError[];
}

/**
 * Parse a CSV string with header row. Trims keys and stringifies all cells
 * so downstream broker presets work on a stable string-only shape.
 *
 * - `header: true` — first row becomes object keys.
 * - `skipEmptyLines: true` — blank rows are dropped before reaching us.
 */
export function parseCsv(text: string): CsvParseResult {
  const result = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
  });

  const headers: string[] = Array.isArray(result.meta?.fields)
    ? result.meta.fields.map((h) => String(h))
    : [];

  // Coerce every cell to string so presets/validators handle one type.
  const rows: Record<string, string>[] = (result.data ?? []).map((row) => {
    const out: Record<string, string> = {};
    for (const key of Object.keys(row)) {
      const v = row[key];
      out[key] = v === null || v === undefined ? '' : String(v);
    }
    return out;
  });

  return {
    headers,
    rows,
    errors: result.errors ?? [],
  };
}
