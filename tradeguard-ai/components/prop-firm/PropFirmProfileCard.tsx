/**
 * Prop firm profile card — header, room panel, footer actions.
 *
 * Pure presentational shell. The actual deactivation request is wired here
 * (kept colocated since it's a one-shot button), but the create/edit flow
 * lives in the parent's dialog state machine.
 */

'use client';

import { type ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ChevronDown, Pencil, Power } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { RoomPanel } from '@/components/prop-firm/RoomPanel';
import { apiFetch } from '@/lib/api/client';
import { cn } from '@/lib/utils/cn';
import type { PropFirmProfileResponse } from '@/types/api';
import type { DrawdownType, FirmName } from '@/types/db';

interface PropFirmProfileCardProps {
  profile: PropFirmProfileResponse;
  onEdit?: () => void;
  onToggleTimeline?: () => void;
  timelineOpen?: boolean;
}

const FIRM_LABEL: Record<FirmName, string> = {
  topstep: 'Topstep',
  apex: 'Apex',
  ftmo: 'FTMO',
  fundednext: 'FundedNext',
  other: '기타',
};

const DD_LABEL: Record<DrawdownType, string> = {
  static: 'Static',
  eod_trailing: 'EOD Trailing',
  intraday_trailing: 'Intraday Trailing',
};

export function PropFirmProfileCard({
  profile,
  onEdit,
  onToggleTimeline,
  timelineOpen,
}: PropFirmProfileCardProps): ReactNode {
  const qc = useQueryClient();
  const warning = profile.currentRoom?.warningActive === true;

  const deactivate = useMutation<void, Error, void>({
    mutationFn: () => apiFetch<void>(`/api/prop-firm-profiles/${profile.id}`, { method: 'DELETE' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['prop-firm-profiles'] });
    },
  });

  function onDeactivate(): void {
    if (
      !window.confirm(
        `'${profile.firmLabel ?? FIRM_LABEL[profile.firmName]}' 프로필을 비활성화할까요?`,
      )
    ) {
      return;
    }
    deactivate.mutate();
  }

  return (
    <Card className={cn(warning && 'border-tilt-red/50')}>
      {warning ? (
        <div className="flex items-center gap-2 rounded-t-lg bg-tilt-red/10 px-4 py-2 text-xs text-tilt-red lg:px-6">
          <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
          <span>룰 위반 임박 — 사이즈를 축소하고 새 진입을 중단하세요.</span>
        </div>
      ) : null}

      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <CardTitle>
            {profile.firmLabel ?? `${FIRM_LABEL[profile.firmName]} ${profile.accountSize}`}
          </CardTitle>
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="rounded-full border border-border bg-muted/40 px-2 py-0.5 text-muted-foreground">
              {FIRM_LABEL[profile.firmName]}
            </span>
            <span className="rounded-full border border-border bg-muted/40 px-2 py-0.5 text-muted-foreground">
              {DD_LABEL[profile.drawdownType]}
            </span>
            <span className="rounded-full border border-border bg-muted/40 px-2 py-0.5 text-muted-foreground tabular-nums">
              ${profile.accountSize.toLocaleString()}
            </span>
            {!profile.isActive ? (
              <span className="rounded-full border border-tilt-red/40 bg-tilt-red/10 px-2 py-0.5 text-tilt-red">
                비활성
              </span>
            ) : null}
          </div>
        </div>
      </CardHeader>

      <CardContent>
        <RoomPanel
          currentRoom={profile.currentRoom}
          profile={{
            dailyLossLimit: profile.dailyLossLimit,
            drawdownLimit: profile.drawdownLimit,
          }}
        />
      </CardContent>

      <CardFooter className="justify-between">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={onEdit}>
            <Pencil className="h-3.5 w-3.5" /> 수정
          </Button>
          {profile.isActive ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={onDeactivate}
              disabled={deactivate.isPending}
            >
              <Power className="h-3.5 w-3.5" /> {deactivate.isPending ? '처리 중…' : '비활성화'}
            </Button>
          ) : null}
        </div>
        {onToggleTimeline ? (
          <Button variant="ghost" size="sm" onClick={onToggleTimeline}>
            <ChevronDown
              className={cn('h-3.5 w-3.5 transition-transform', timelineOpen && 'rotate-180')}
            />
            {timelineOpen ? '시계열 닫기' : '시계열 보기'}
          </Button>
        ) : null}
      </CardFooter>
    </Card>
  );
}
