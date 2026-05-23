// POST /api/trades/upload — multipart CSV upload.
// Field `file` (CSV, ≤10MB), optional `presetName`, optional `mappingOverride` (JSON string).

import { createClient } from '@/lib/supabase/server';
import { toApiResponse, unauthenticated, validationError } from '@/lib/utils/api-error';
import { withRequestId } from '@/lib/utils/logger';
import { handleCsvUpload } from '@/lib/services/csv-upload';

const MAX_BYTES = 10 * 1024 * 1024;

export const runtime = 'nodejs';

export async function POST(req: Request): Promise<Response> {
  const requestId = crypto.randomUUID();
  const log = withRequestId(requestId);
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return unauthenticated();

    const contentType = req.headers.get('content-type') ?? '';
    if (!contentType.includes('multipart/form-data')) {
      return validationError([{ path: 'body', message: 'multipart/form-data required' }]);
    }

    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) {
      return validationError([{ path: 'file', message: 'file is required' }]);
    }
    if (file.size > MAX_BYTES) {
      return validationError([{ path: 'file', message: `file exceeds ${MAX_BYTES} bytes` }]);
    }
    const presetNameRaw = form.get('presetName');
    const presetName =
      typeof presetNameRaw === 'string' && presetNameRaw.length > 0 ? presetNameRaw : undefined;

    let mappingOverride: Record<string, string> | undefined;
    const overrideRaw = form.get('mappingOverride');
    if (typeof overrideRaw === 'string' && overrideRaw.length > 0) {
      try {
        const parsed: unknown = JSON.parse(overrideRaw);
        if (!isStringRecord(parsed)) {
          return validationError([
            { path: 'mappingOverride', message: 'must be an object of string→string' },
          ]);
        }
        mappingOverride = parsed;
      } catch {
        return validationError([{ path: 'mappingOverride', message: 'invalid JSON' }]);
      }
    }

    const fileText = await file.text();
    const result = await handleCsvUpload({
      supabase,
      ownerId: user.id,
      fileText,
      presetName,
      mappingOverride,
    });

    if ('error' in result) {
      return new Response(JSON.stringify(result), {
        status: 400,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
      });
    }
    log.info('csv_upload_completed', {
      uploadId: result.uploadId,
      accepted: result.accepted,
      rejected: result.rejected,
    });
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  } catch (err) {
    log.error('csv_upload_failed', { message: err instanceof Error ? err.message : String(err) });
    return toApiResponse(err, requestId);
  }
}

function isStringRecord(v: unknown): v is Record<string, string> {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return false;
  return Object.values(v).every((x) => typeof x === 'string');
}
