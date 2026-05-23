'use client';

/**
 * Fallback CSV-mapping dialog.
 *
 * Shown when `POST /api/trades/upload` returns 400 `mapping_required` — the
 * user picks which detected CSV header maps to each canonical field (symbol,
 * side, entry_at, ...). On submit, the parent re-POSTs with `mappingOverride`
 * appended to the FormData.
 *
 * The dialog seeds each field with the server's suggested mapping when present
 * so the user usually just confirms; manual override is the exceptional path.
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label, Select } from '@/components/ui/form';

interface CsvMappingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  detectedHeaders: string[];
  requiredFields: string[];
  suggested?: Record<string, string>;
  onSubmit: (mapping: Record<string, string>) => void;
}

const FIELD_LABELS: Record<string, string> = {
  symbol: '종목',
  side: '방향(매수/매도)',
  entry_at: '진입 시각',
  exit_at: '청산 시각',
  entry_price: '진입가',
  exit_price: '청산가',
  pnl: '손익(PnL)',
  contracts: '계약수',
};

function buildInitialMapping(
  requiredFields: string[],
  suggested: Record<string, string>,
): Record<string, string> {
  // `suggested` from server is `{ csvHeader: canonicalField }`; invert for our shape.
  const inverted: Record<string, string> = {};
  for (const [header, field] of Object.entries(suggested)) {
    inverted[field] = header;
  }
  const init: Record<string, string> = {};
  for (const field of requiredFields) {
    init[field] = inverted[field] ?? '';
  }
  return init;
}

export function CsvMappingDialog({
  open,
  onOpenChange,
  detectedHeaders,
  requiredFields,
  suggested = {},
  onSubmit,
}: CsvMappingDialogProps): ReactNode {
  const initial = useMemo(
    () => buildInitialMapping(requiredFields, suggested),
    [requiredFields, suggested],
  );
  const [mapping, setMapping] = useState<Record<string, string>>(initial);

  useEffect(() => {
    if (open) setMapping(initial);
  }, [open, initial]);

  const incomplete = requiredFields.some((f) => !mapping[f]);

  const handleSubmit = (): void => {
    if (incomplete) return;
    onSubmit(mapping);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onClose={() => onOpenChange(false)} className="max-w-xl">
      <DialogContent>
        <DialogHeader>
          <DialogTitle>CSV 컬럼 매핑</DialogTitle>
          <p className="text-xs text-muted-foreground">
            자동 인식이 실패했습니다. 각 필드에 해당하는 CSV 헤더를 선택하세요.
          </p>
        </DialogHeader>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {requiredFields.map((field) => {
            const labelId = `map-${field}`;
            return (
              <div key={field} className="flex flex-col gap-1">
                <Label htmlFor={labelId}>{FIELD_LABELS[field] ?? field}</Label>
                <Select
                  id={labelId}
                  value={mapping[field] ?? ''}
                  onChange={(e) => setMapping((prev) => ({ ...prev, [field]: e.target.value }))}
                >
                  <option value="">— 선택 —</option>
                  {detectedHeaders.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </Select>
              </div>
            );
          })}
        </div>

        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            취소
          </Button>
          <Button size="sm" onClick={handleSubmit} disabled={incomplete}>
            매핑 저장 및 재시도
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
