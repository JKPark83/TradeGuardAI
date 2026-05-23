// Reusable Zod schemas for IDs, timestamps, enums, and pagination.
// Mirror the canonical types in `types/db.ts`.

import { z } from 'zod';

export const uuidSchema = z.string().uuid();

export const isoDateTimeSchema = z.string().datetime();

/** Stringified decimal (matches NUMERIC columns serialized as strings). */
export const decimalStringSchema = z.string().regex(/^-?\d+(\.\d+)?$/, {
  message: 'must be a decimal string like "-12.34" or "0"',
});

export const tradeSideSchema = z.enum(['long', 'short']);

export const drawdownTypeSchema = z.enum(['static', 'eod_trailing', 'intraday_trailing']);

export const tiltColorSchema = z.enum(['green', 'yellow', 'red']);

export const firmNameSchema = z.enum(['topstep', 'apex', 'ftmo', 'fundednext', 'other']);

const PAGINATION_DEFAULT_LIMIT = 50;
const PAGINATION_MAX_LIMIT = 500;

export const paginationSchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce
    .number()
    .int()
    .positive()
    .max(PAGINATION_MAX_LIMIT)
    .default(PAGINATION_DEFAULT_LIMIT),
});

export type Pagination = z.infer<typeof paginationSchema>;
