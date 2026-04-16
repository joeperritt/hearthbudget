import { AlertTriangle, CheckCircle2, Lightbulb, PiggyBank, Heart } from 'lucide-react';

export interface AIInsight {
  type: 'warning' | 'encouragement' | 'tip' | 'savings' | 'giving';
  title: string;
  body: string;
}

const iconMap: Record<string, { icon: typeof AlertTriangle; color: string; border: string }> = {
  warning: { icon: AlertTriangle, color: 'text-yellow-600', border: 'border-l-destructive' },
  encouragement: { icon: CheckCircle2, color: 'text-green-600', border: 'border-l-green-500' },
  tip: { icon: Lightbulb, color: 'text-accent', border: 'border-l-accent' },
  savings: { icon: PiggyBank, color: 'text-primary', border: 'border-l-primary' },
  giving: { icon: Heart, color: 'text-accent', border: 'border-l-accent' },
};

/**
 * Parses raw AI output (which may be a JSON array, JSON inside markdown,
 * or a plain text string) into a list of AIInsight objects.
 */
export function parseAIInsights(raw: unknown): AIInsight[] {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw
      .filter((i: any) => i && (i.title || i.body))
      .map((i: any) => ({
        type: (i.type as AIInsight['type']) || 'tip',
        title: String(i.title || '').trim(),
        body: String(i.body || '').trim(),
      }));
  }
  const text = String(raw).trim();
  // Strip markdown fences
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '');
  // Find JSON array
  const match = cleaned.match(/\[[\s\S]*\]/);
  if (match) {
    try {
      const parsed = JSON.parse(match[0]);
      return parseAIInsights(parsed);
    } catch {
      // fall through
    }
  }
  // Plaintext fallback: split on blank lines, treat as body-only tips
  return cleaned
    .split(/\n\s*\n/)
    .map(s => s.trim())
    .filter(Boolean)
    .map(body => ({ type: 'tip' as const, title: '', body }));
}

export function AIInsightsList({ insights }: { insights: AIInsight[] }) {
  if (insights.length === 0) return null;
  return (
    <div className="space-y-2">
      {insights.map((insight, i) => {
        const config = iconMap[insight.type] || iconMap.tip;
        const Icon = config.icon;
        return (
          <div key={i} className={`bg-card rounded-lg shadow-sm p-3.5 border-l-[3px] ${config.border}`}>
            <div className="flex items-start gap-2.5">
              <Icon size={16} className={`${config.color} mt-0.5 shrink-0`} />
              <div className="min-w-0">
                {insight.title && (
                  <p className="text-sm font-semibold text-foreground font-display">{insight.title}</p>
                )}
                {insight.body && (
                  <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{insight.body}</p>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
