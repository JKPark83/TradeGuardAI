'use client';

/**
 * Prop firm profile create/edit dialog.
 *
 * One form covers both modes — POST when `mode === 'create'`, PATCH with the
 * profile id otherwise. The submit handler always sends the full validated
 * shape because the API treats PATCH bodies as partial and ignores missing
 * keys, so re-sending everything is harmless and keeps the type narrow.
 *
 * Validation is intentionally light (positive numbers, threshold range) —
 * the server is the source of truth and surfaces detailed `issues[]`.
 */

import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input, Label, Select } from '@/components/ui/form';
import { apiFetch, ApiClientError } from '@/lib/api/client';
import type { PropFirmProfileCreateRequest, PropFirmProfileResponse } from '@/types/api';
import type { DrawdownType, FirmName } from '@/types/db';

interface PropFirmProfileDialogProps {
  open: boolean;
  mode: 'create' | 'edit';
  initial: PropFirmProfileResponse | null;
  onClose: () => void;
}

interface FormState {
  firmName: FirmName;
  firmLabel: string;
  accountSize: string;
  dailyLossLimit: string;
  drawdownType: DrawdownType;
  drawdownLimit: string;
  warnThresholdPct: string;
}

function emptyForm(): FormState {
  return {
    firmName: 'topstep',
    firmLabel: '',
    accountSize: '',
    dailyLossLimit: '',
    drawdownType: 'eod_trailing',
    drawdownLimit: '',
    warnThresholdPct: '80',
  };
}

function fromProfile(p: PropFirmProfileResponse): FormState {
  return {
    firmName: p.firmName,
    firmLabel: p.firmLabel ?? '',
    accountSize: String(p.accountSize),
    dailyLossLimit: p.dailyLossLimit !== null ? String(p.dailyLossLimit) : '',
    drawdownType: p.drawdownType,
    drawdownLimit: String(p.drawdownLimit),
    warnThresholdPct: String(Math.round(p.warnThresholdPct * 100)),
  };
}

function validate(f: FormState): string | null {
  const acct = Number(f.accountSize);
  if (!Number.isFinite(acct) || acct <= 0) return '계정 잔고는 0보다 큰 숫자여야 합니다.';
  const dd = Number(f.drawdownLimit);
  if (!Number.isFinite(dd) || dd <= 0) return '드로우다운 한도는 0보다 큰 숫자여야 합니다.';
  if (f.dailyLossLimit.length > 0) {
    const dll = Number(f.dailyLossLimit);
    if (!Number.isFinite(dll) || dll < 0) return '일일 손실 한도는 0 이상이어야 합니다.';
  }
  const pct = Number(f.warnThresholdPct);
  if (!Number.isFinite(pct) || pct <= 0 || pct >= 100)
    return '경고 임계치는 0과 100 사이의 값이어야 합니다.';
  return null;
}

function toRequest(f: FormState): PropFirmProfileCreateRequest {
  return {
    firmName: f.firmName,
    firmLabel: f.firmLabel.trim().length > 0 ? f.firmLabel.trim() : undefined,
    accountSize: Number(f.accountSize),
    dailyLossLimit: f.dailyLossLimit.length > 0 ? Number(f.dailyLossLimit) : null,
    drawdownType: f.drawdownType,
    drawdownLimit: Number(f.drawdownLimit),
    warnThresholdPct: Number(f.warnThresholdPct) / 100,
  };
}

const FIRM_OPTIONS: { value: FirmName; label: string }[] = [
  { value: 'topstep', label: 'Topstep' },
  { value: 'apex', label: 'Apex' },
  { value: 'ftmo', label: 'FTMO' },
  { value: 'fundednext', label: 'FundedNext' },
  { value: 'other', label: '기타' },
];

const DD_OPTIONS: { value: DrawdownType; label: string }[] = [
  { value: 'static', label: 'Static (정적)' },
  { value: 'eod_trailing', label: 'EOD Trailing' },
  { value: 'intraday_trailing', label: 'Intraday Trailing' },
];

export function PropFirmProfileDialog({
  open,
  mode,
  initial,
  onClose,
}: PropFirmProfileDialogProps): ReactNode {
  const qc = useQueryClient();
  const [form, setForm] = useState<FormState>(emptyForm());
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setForm(initial ? fromProfile(initial) : emptyForm());
    setLocalError(null);
  }, [open, initial]);

  const mutation = useMutation<PropFirmProfileResponse, Error, PropFirmProfileCreateRequest>({
    mutationFn: (body) => {
      const url =
        mode === 'edit' && initial
          ? `/api/prop-firm-profiles/${initial.id}`
          : '/api/prop-firm-profiles';
      return apiFetch<PropFirmProfileResponse>(url, {
        method: mode === 'edit' ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['prop-firm-profiles'] });
      onClose();
    },
  });

  function onSubmit(e: FormEvent<HTMLFormElement>): void {
    e.preventDefault();
    const err = validate(form);
    if (err) {
      setLocalError(err);
      return;
    }
    setLocalError(null);
    mutation.mutate(toRequest(form));
  }

  const errorMessage =
    localError ??
    (mutation.error
      ? mutation.error instanceof ApiClientError
        ? (mutation.error.body.error ?? '저장에 실패했습니다.')
        : '저장에 실패했습니다.'
      : null);

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{mode === 'edit' ? '프로필 수정' : '프로필 추가'}</DialogTitle>
        </DialogHeader>
        <form className="flex flex-col gap-4" onSubmit={onSubmit}>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <Label htmlFor="pf-firm">펀딩 회사</Label>
              <Select
                id="pf-firm"
                value={form.firmName}
                onChange={(e) => setForm((p) => ({ ...p, firmName: e.target.value as FirmName }))}
              >
                {FIRM_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="pf-label">라벨</Label>
              <Input
                id="pf-label"
                value={form.firmLabel}
                placeholder="예: Topstep 50K Combine"
                onChange={(e) => setForm((p) => ({ ...p, firmLabel: e.target.value }))}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="pf-account">계정 잔고 ($)</Label>
              <Input
                id="pf-account"
                type="number"
                min={0}
                value={form.accountSize}
                onChange={(e) => setForm((p) => ({ ...p, accountSize: e.target.value }))}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="pf-daily">일일 손실 한도 ($)</Label>
              <Input
                id="pf-daily"
                type="number"
                min={0}
                placeholder="선택"
                value={form.dailyLossLimit}
                onChange={(e) => setForm((p) => ({ ...p, dailyLossLimit: e.target.value }))}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="pf-ddtype">드로우다운 종류</Label>
              <Select
                id="pf-ddtype"
                value={form.drawdownType}
                onChange={(e) =>
                  setForm((p) => ({ ...p, drawdownType: e.target.value as DrawdownType }))
                }
              >
                {DD_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="pf-ddlimit">드로우다운 한도 ($)</Label>
              <Input
                id="pf-ddlimit"
                type="number"
                min={0}
                value={form.drawdownLimit}
                onChange={(e) => setForm((p) => ({ ...p, drawdownLimit: e.target.value }))}
              />
            </div>
            <div className="flex flex-col gap-1 col-span-2">
              <Label htmlFor="pf-warn">경고 임계치 (%) · 0–100</Label>
              <Input
                id="pf-warn"
                type="number"
                min={1}
                max={99}
                value={form.warnThresholdPct}
                onChange={(e) => setForm((p) => ({ ...p, warnThresholdPct: e.target.value }))}
              />
            </div>
          </div>

          {errorMessage ? <p className="text-xs text-tilt-red">{errorMessage}</p> : null}

          <DialogFooter>
            <Button type="button" variant="ghost" size="sm" onClick={onClose}>
              취소
            </Button>
            <Button type="submit" size="sm" disabled={mutation.isPending}>
              {mutation.isPending ? '저장 중…' : mode === 'edit' ? '저장' : '등록'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
