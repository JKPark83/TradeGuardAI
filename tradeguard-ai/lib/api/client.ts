/**
 * Typed fetch wrapper for client components.
 *
 * Same-origin only — server routes live under `/api/*` on the Next.js host,
 * so we never need an absolute base URL. Auth cookies are forwarded
 * automatically by the browser (Supabase session is httpOnly via @supabase/ssr).
 *
 * Non-2xx responses are parsed as `ApiErrorBody` (see `types/api.ts`) and
 * thrown as a runtime `ApiClientError`. Callers can `instanceof` check or
 * inspect `.status` / `.body.error` for branching (e.g. `mapping_required`).
 */

import type { ApiErrorBody } from '@/types/api';

export class ApiClientError extends Error {
  readonly status: number;
  readonly body: ApiErrorBody;

  constructor(status: number, body: ApiErrorBody) {
    super(body.error ?? `HTTP ${status}`);
    this.name = 'ApiClientError';
    this.status = status;
    this.body = body;
  }
}

async function parseErrorBody(res: Response): Promise<ApiErrorBody> {
  try {
    const data = (await res.json()) as unknown;
    if (data && typeof data === 'object' && 'error' in data) {
      return data as ApiErrorBody;
    }
    return { error: `http_${res.status}` };
  } catch {
    return { error: `http_${res.status}` };
  }
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: 'same-origin',
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init?.headers ?? {}),
    },
  });

  if (!res.ok) {
    const body = await parseErrorBody(res);
    throw new ApiClientError(res.status, body);
  }

  // 204 No Content
  if (res.status === 204) {
    return undefined as T;
  }

  return (await res.json()) as T;
}
