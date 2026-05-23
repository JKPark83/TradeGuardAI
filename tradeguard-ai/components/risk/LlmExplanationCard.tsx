/**
 * LLM explanation card.
 *
 * Renders the (optional) anonymized LLM rationale alongside the deterministic
 * signal breakdown. Hidden entirely when null/empty — the deterministic UI
 * must stand on its own (FR-013, FR-018).
 */

import { Sparkles } from 'lucide-react';
import type { ReactNode } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface LlmExplanationCardProps {
  explanation: string | null;
}

export function LlmExplanationCard({ explanation }: LlmExplanationCardProps): ReactNode {
  if (!explanation || explanation.trim().length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-muted-foreground" aria-hidden />
          <span>AI 분석</span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">{explanation}</p>
      </CardContent>
    </Card>
  );
}
