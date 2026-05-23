// Lightweight structured JSON logger. No external deps.
// Emits one JSON object per log call so it can be parsed by any log aggregator.
//
// SECURITY: Any field whose key (case-insensitive) matches the redact list is
// recursively stripped before serialization. This is a defense-in-depth guard;
// callers should still avoid passing secrets in the first place.

type Level = 'debug' | 'info' | 'warn' | 'error';
type Fields = Record<string, unknown>;

const REDACT_KEYS: ReadonlySet<string> = new Set([
  'pii_hmac_secret',
  'password',
  'token',
  'authorization',
  'cookie',
  'secret',
  'api_key',
  'apikey',
  'access_token',
  'refresh_token',
  'client_secret',
  'key',
]);

const REDACTED = '[REDACTED]';

function redact(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(redact);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (REDACT_KEYS.has(k.toLowerCase())) {
      out[k] = REDACTED;
    } else {
      out[k] = redact(v);
    }
  }
  return out;
}

function redactFields(fields?: Fields): Fields | undefined {
  if (!fields) return undefined;
  return redact(fields) as Fields;
}

interface BaseEntry {
  ts: string;
  level: Level;
  msg: string;
  requestId?: string;
}

function emit(level: Level, msg: string, requestId: string | undefined, fields?: Fields): void {
  const entry: BaseEntry & Fields = {
    ts: new Date().toISOString(),
    level,
    msg,
    ...(requestId ? { requestId } : {}),
    ...(redactFields(fields) ?? {}),
  };
  const line = JSON.stringify(entry);
  if (level === 'error' || level === 'warn') {
    // eslint-disable-next-line no-console
    console.error(line);
  } else {
    // eslint-disable-next-line no-console
    console.log(line);
  }
}

export interface Logger {
  debug(msg: string, fields?: Fields): void;
  info(msg: string, fields?: Fields): void;
  warn(msg: string, fields?: Fields): void;
  error(msg: string, fields?: Fields): void;
}

function makeLogger(requestId?: string): Logger {
  return {
    debug: (msg, fields) => emit('debug', msg, requestId, fields),
    info: (msg, fields) => emit('info', msg, requestId, fields),
    warn: (msg, fields) => emit('warn', msg, requestId, fields),
    error: (msg, fields) => emit('error', msg, requestId, fields),
  };
}

export const logger: Logger = makeLogger();

/** Returns a sub-logger that auto-injects `requestId` on every entry. */
export function withRequestId(requestId: string): Logger {
  return makeLogger(requestId);
}
