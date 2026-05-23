'use client';

/**
 * Prop Firm page client — list + create/edit flow.
 *
 * Owns dialog state (create vs edit) so the dialog component itself stays
 * stateless apart from form fields. The query key `['prop-firm-profiles']` is
 * the single invalidation target shared with the dashboard summary card.
 */

import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { apiFetch } from '@/lib/api/client';
import { PropFirmProfileCard } from '@/components/prop-firm/PropFirmProfileCard';
import { PropFirmProfileDialog } from '@/components/prop-firm/PropFirmProfileDialog';
import { EquityTimelineChart } from '@/components/prop-firm/EquityTimelineChart';
import type { PropFirmProfileResponse } from '@/types/api';

interface ProfilesListResponse {
  profiles: PropFirmProfileResponse[];
}

type DialogState =
  | { mode: 'closed' }
  | { mode: 'create' }
  | { mode: 'edit'; profile: PropFirmProfileResponse };

export function PropFirmPage(): ReactNode {
  const [dialog, setDialog] = useState<DialogState>({ mode: 'closed' });
  const [expandedTimeline, setExpandedTimeline] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery<ProfilesListResponse>({
    queryKey: ['prop-firm-profiles'],
    queryFn: () => apiFetch<ProfilesListResponse>('/api/prop-firm-profiles'),
  });

  const profiles = data?.profiles ?? [];
  const active = profiles.filter((p) => p.isActive);
  const inactive = profiles.filter((p) => !p.isActive);

  return (
    <>
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          {active.length}개의 활성 프로필
          {inactive.length > 0 ? ` · ${inactive.length}개 비활성` : ''}
        </p>
        <Button size="sm" onClick={() => setDialog({ mode: 'create' })}>
          <Plus className="h-3.5 w-3.5" /> 프로필 추가
        </Button>
      </div>

      {error ? (
        <div className="rounded-md border border-tilt-red/40 bg-tilt-red/10 px-3 py-2 text-sm text-tilt-red">
          프로필을 불러오지 못했습니다.
        </div>
      ) : null}

      {isLoading ? (
        <Card>
          <CardContent className="p-6 text-center text-sm text-muted-foreground">
            불러오는 중…
          </CardContent>
        </Card>
      ) : active.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
            <p className="text-sm text-muted-foreground">등록된 활성 프로필이 없습니다.</p>
            <Button size="sm" onClick={() => setDialog({ mode: 'create' })}>
              <Plus className="h-3.5 w-3.5" /> 첫 프로필 등록
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-4">
          {active.map((profile) => (
            <div key={profile.id} className="flex flex-col gap-3">
              <PropFirmProfileCard
                profile={profile}
                onEdit={() => setDialog({ mode: 'edit', profile })}
                onToggleTimeline={() =>
                  setExpandedTimeline((prev) => (prev === profile.id ? null : profile.id))
                }
                timelineOpen={expandedTimeline === profile.id}
              />
              {expandedTimeline === profile.id ? (
                <EquityTimelineChart profileId={profile.id} />
              ) : null}
            </div>
          ))}
        </div>
      )}

      {inactive.length > 0 ? (
        <details className="rounded-md border border-border bg-muted/10 px-3 py-2">
          <summary className="cursor-pointer text-xs uppercase tracking-wider text-muted-foreground">
            비활성 프로필 ({inactive.length})
          </summary>
          <div className="mt-3 flex flex-col gap-3">
            {inactive.map((profile) => (
              <PropFirmProfileCard
                key={profile.id}
                profile={profile}
                onEdit={() => setDialog({ mode: 'edit', profile })}
              />
            ))}
          </div>
        </details>
      ) : null}

      <PropFirmProfileDialog
        open={dialog.mode !== 'closed'}
        mode={dialog.mode === 'edit' ? 'edit' : 'create'}
        initial={dialog.mode === 'edit' ? dialog.profile : null}
        onClose={() => setDialog({ mode: 'closed' })}
      />
    </>
  );
}
