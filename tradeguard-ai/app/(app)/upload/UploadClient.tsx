'use client';

/**
 * CSV upload flow (client).
 *
 * Two-step protocol per `contracts/trades-api.md#POST /api/trades/upload`:
 *   1. POST the file as multipart. If preset auto-detect succeeds → 200 with stats.
 *   2. If the server returns 400 `{ error: 'mapping_required', detectedHeaders }`,
 *      open the CSV mapping dialog so the user can wire detected headers to
 *      canonical fields, then POST again with `mappingOverride` JSON appended.
 *
 * We keep all state local — no TanStack Query mutation cache — because this
 * flow is one-shot and the success result is the source of truth shown inline.
 */

import {
  useCallback,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type ReactNode,
} from 'react';
import { Upload as UploadIcon, ChevronDown, ChevronRight, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { CsvMappingDialog } from '@/components/trades/CsvMappingDialog';
import { apiFetch, ApiClientError } from '@/lib/api/client';
import { cn } from '@/lib/utils/cn';
import type { CsvUploadResponse, CsvMappingRequiredResponse } from '@/types/api';

const REQUIRED_FIELDS = [
  'symbol',
  'side',
  'entry_at',
  'exit_at',
  'entry_price',
  'exit_price',
  'pnl',
  'contracts',
] as const;

interface ToastState {
  kind: 'success' | 'error';
  message: string;
}

export function UploadClient(): ReactNode {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<CsvUploadResponse | null>(null);
  const [mappingState, setMappingState] = useState<CsvMappingRequiredResponse | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [showRejected, setShowRejected] = useState(true);
  const [dragOver, setDragOver] = useState(false);

  const postUpload = useCallback(
    async (selected: File, mappingOverride?: Record<string, string>): Promise<void> => {
      setUploading(true);
      setToast(null);
      try {
        const form = new FormData();
        form.append('file', selected);
        if (mappingOverride) {
          form.append('mappingOverride', JSON.stringify(mappingOverride));
        }

        const body = await apiFetch<CsvUploadResponse>('/api/trades/upload', {
          method: 'POST',
          body: form,
        });
        setResult(body);
        setMappingState(null);
        setToast({
          kind: 'success',
          message: `업로드 완료: ${body.accepted}건 저장 / ${body.rejected}건 거부`,
        });
      } catch (err) {
        if (err instanceof ApiClientError && err.body.error === 'mapping_required') {
          setMappingState(err.body as unknown as CsvMappingRequiredResponse);
        } else {
          const msg = err instanceof Error ? err.message : '업로드 실패';
          setToast({ kind: 'error', message: msg });
        }
      } finally {
        setUploading(false);
      }
    },
    [],
  );

  const onFileSelected = useCallback(
    async (selected: File): Promise<void> => {
      setFile(selected);
      setResult(null);
      // Reading the text validates browser access; server re-parses authoritative copy.
      await selected.text();
      await postUpload(selected);
    },
    [postUpload],
  );

  const onInputChange = (e: ChangeEvent<HTMLInputElement>): void => {
    const f = e.target.files?.[0];
    if (f) void onFileSelected(f);
  };

  const onDrop = (e: DragEvent<HTMLDivElement>): void => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f && f.name.toLowerCase().endsWith('.csv')) {
      void onFileSelected(f);
    } else if (f) {
      setToast({ kind: 'error', message: 'CSV 파일만 업로드할 수 있습니다.' });
    }
  };

  const onMappingSubmit = (mapping: Record<string, string>): void => {
    if (!file) return;
    void postUpload(file, mapping);
  };

  return (
    <div className="flex flex-col gap-4">
      {toast ? (
        <div
          role="status"
          className={cn(
            'flex items-center justify-between rounded-md border px-3 py-2 text-sm',
            toast.kind === 'success'
              ? 'border-tilt-green/40 bg-tilt-green/10 text-tilt-green'
              : 'border-tilt-red/40 bg-tilt-red/10 text-tilt-red',
          )}
        >
          <span>{toast.message}</span>
          <button
            type="button"
            onClick={() => setToast(null)}
            className="text-muted-foreground hover:text-foreground"
            aria-label="알림 닫기"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : null}

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        className={cn(
          'flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed p-10 text-center transition-colors',
          dragOver ? 'border-tilt-green bg-tilt-green/5' : 'border-border bg-muted/20',
        )}
      >
        <UploadIcon className="h-8 w-8 text-muted-foreground" aria-hidden />
        <div className="flex flex-col gap-1">
          <p className="text-sm text-foreground">CSV 파일을 여기로 끌어다 놓거나</p>
          <p className="text-xs text-muted-foreground">아래 버튼으로 파일을 선택하세요</p>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={onInputChange}
        />
        <Button
          variant="outline"
          size="sm"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
        >
          {uploading ? '업로드 중…' : '파일 선택'}
        </Button>
        {file ? (
          <p className="text-xs text-muted-foreground">
            선택된 파일: <span className="text-foreground">{file.name}</span>
          </p>
        ) : null}
      </div>

      {result ? (
        <Card>
          <CardContent className="flex flex-col gap-3 p-4 lg:p-6">
            <div className="flex flex-wrap gap-4 text-sm">
              <div>
                <span className="text-muted-foreground">사용된 프리셋: </span>
                <span className="text-foreground">{result.presetUsed ?? '자동 매핑'}</span>
              </div>
              <div>
                <span className="text-muted-foreground">총 행: </span>
                <span className="text-foreground">{result.rowCount}</span>
              </div>
              <div>
                <span className="text-tilt-green">{result.accepted}건 저장</span>
                {' / '}
                <span className="text-tilt-red">{result.rejected}건 거부</span>
              </div>
            </div>

            {result.rejectedRows.length > 0 ? (
              <div className="flex flex-col gap-2">
                <button
                  type="button"
                  onClick={() => setShowRejected((v) => !v)}
                  className="flex items-center gap-1 self-start text-xs text-muted-foreground hover:text-foreground"
                >
                  {showRejected ? (
                    <ChevronDown className="h-3.5 w-3.5" />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5" />
                  )}
                  거부된 행 {result.rejectedRows.length}건
                </button>
                {showRejected ? (
                  <ul className="flex flex-col gap-1 rounded-md border border-border bg-background p-2 text-xs">
                    {result.rejectedRows.map((r) => (
                      <li key={`${r.row}-${r.reason}`} className="text-muted-foreground">
                        <span className="text-tilt-red">행 {r.row}</span> — {r.reason}
                        {r.details ? <span className="ml-1 opacity-70">({r.details})</span> : null}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <CsvMappingDialog
        open={mappingState !== null}
        onOpenChange={(o) => {
          if (!o) setMappingState(null);
        }}
        detectedHeaders={mappingState?.detectedHeaders ?? []}
        requiredFields={REQUIRED_FIELDS as unknown as string[]}
        suggested={mappingState?.suggestedFields ?? {}}
        onSubmit={onMappingSubmit}
      />
    </div>
  );
}
