// Standardized API error responses — see contracts/account-api.md#공통-응답-규약.
// All factory functions return a `Response` with the canonical JSON body shape
// declared in `types/api.ts#ApiErrorBody`.

import type { ApiErrorBody } from '@/types/api';

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8' } as const;

export class ApiError extends Error {
  readonly status: number;
  readonly body: ApiErrorBody;

  constructor(status: number, body: ApiErrorBody) {
    super(body.error);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }

  toResponse(): Response {
    return new Response(JSON.stringify(this.body), {
      status: this.status,
      headers: JSON_HEADERS,
    });
  }
}

function jsonResponse(
  status: number,
  body: ApiErrorBody,
  extraHeaders?: Record<string, string>,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...JSON_HEADERS, ...(extraHeaders ?? {}) },
  });
}

export function unauthenticated(): Response {
  return jsonResponse(401, { error: 'unauthenticated' });
}

export function notFound(): Response {
  return jsonResponse(404, { error: 'not_found' });
}

export function validationError(issues: { path: string; message: string }[]): Response {
  return jsonResponse(400, { error: 'validation_failed', issues });
}

export function rateLimited(retryAfterSeconds: number): Response {
  return jsonResponse(
    429,
    { error: 'rate_limited', retryAfterSeconds },
    { 'Retry-After': String(retryAfterSeconds) },
  );
}

export function internalError(requestId: string): Response {
  return jsonResponse(500, { error: 'internal_error', requestId });
}

/**
 * Catch-all converter. Honors `ApiError` instances; otherwise returns 500.
 * Never leaks the inner error message — that goes to the logger, not the client.
 */
export function toApiResponse(err: unknown, requestId: string): Response {
  if (err instanceof ApiError) {
    return err.toResponse();
  }
  return internalError(requestId);
}
