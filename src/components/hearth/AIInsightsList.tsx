import { AlertTriangle, CheckCircle2, Lightbulb, PiggyBank, Heart, ArrowRight } from 'lucide-react';
import { navigateToDestination, canNavigateTo, type AINavigationHandlers } from '@/lib/aiNavigation';

export interface AINextStep {
  action: string;
  destination: string;
}

export interface AIInsight {
  type: 'warning' | 'encouragement' | 'tip' | 'savings' | 'giving';
  title: string;
  body: string;
  nextStep?: AINextStep | null;
}

const iconMap: Record<string, { icon: typeof AlertTriangle; color: string; border: string; bg: string }> = {
  warning: { icon: AlertTriangle, color: 'text-destructive', border: 'border-l-destructive', bg: 'lg:bg-destructive/5' },
  encouragement: { icon: CheckCircle2, color: 'text-green-600', border: 'border-l-green-500', bg: 'lg:bg-green-500/5' },
  tip: { icon: Lightbulb, color: 'text-yellow-600', border: 'border-l-yellow-500', bg: 'lg:bg-yellow-500/5' },
  savings: { icon: PiggyBank, color: 'text-green-600', border: 'border-l-green-500', bg: 'lg:bg-green-500/5' },
  giving: { icon: Heart, color: 'text-green-600', border: 'border-l-green-500', bg: 'lg:bg-green-500/5' },
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
      .map((i: any) => {
        const ns = i.nextStep || i.next_step;
        const nextStep: AINextStep | null = ns && (ns.action || ns.destination)
          ? { action: String(ns.action || '').trim(), destination: String(ns.destination || '').trim() }
          : null;
        return {
          type: (i.type as AIInsight['type']) || 'tip',
          title: String(i.title || '').trim(),
          body: String(i.body || '').trim(),
          nextStep,
        };
      });
  }
  const text = String(raw).trim();
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '');
  const match = cleaned.match(/\[[\s\S]*\]/);
  if (match) {
    try {
      const parsed = JSON.parse(match[0]);
      return parseAIInsights(parsed);
    } catch {
      // fall through
    }
  }
  return cleaned
    .split(/\n\s*\n/)
    .map(s => s.trim())
    .filter(Boolean)
    .map(body => ({ type: 'tip' as const, title: '', body, nextStep: null }));
}

interface AIInsightsListProps {
  insights: AIInsight[];
  navigationHandlers?: AINavigationHandlers;
}

export function AIInsightsList({ insights, navigationHandlers }: AIInsightsListProps) {
  if (insights.length === 0) return null;
  return (
    <div className="space-y-2">
      {insights.map((insight, i) => {
        const config = iconMap[insight.type] || iconMap.tip;
        const Icon = config.icon;
        const ns = insight.nextStep;
        const tappable = ns && navigationHandlers ? canNavigateTo(ns.destination, navigationHandlers) : false;
        return (
          <div key={i} className={`bg-card rounded-lg shadow-sm p-3.5 border-l-[3px] ${config.border} ${config.bg}`}>
            <div className="flex items-start gap-2.5">
              <Icon size={16} className={`${config.color} mt-0.5 shrink-0`} />
              <div className="min-w-0 flex-1">
                {insight.title && (
                  <p className="text-sm font-semibold text-foreground font-display">{insight.title}</p>
                )}
                {insight.body && (
                  <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{insight.body}</p>
                )}
                {ns && (ns.action || ns.destination) && (
                  <div className="mt-2.5 pt-2.5 border-t border-border/60">
                    {ns.action && (
                      <p className="text-xs font-semibold text-accent leading-snug">{ns.action}</p>
                    )}
                    {ns.destination && (
                      tappable ? (
                        <button
                          onClick={() => navigateToDestination(ns.destination, navigationHandlers!)}
                          className="mt-1 inline-flex items-center gap-1 text-[11px] text-accent font-medium hover:underline"
                        >
                          {ns.destination}
                          <ArrowRight size={11} />
                        </button>
                      ) : (
                        <p className="mt-1 text-[11px] text-muted-foreground">{ns.destination}</p>
                      )
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
