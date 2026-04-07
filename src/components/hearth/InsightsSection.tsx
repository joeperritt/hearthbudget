import { Sparkles, AlertTriangle, CheckCircle2, Lightbulb, Heart, PiggyBank, ChevronRight } from 'lucide-react';
import { Insight } from '@/hooks/useBudgetInsights';
import { formatDistanceToNow } from 'date-fns';

const iconMap: Record<Insight['type'], { icon: typeof AlertTriangle; color: string; border: string }> = {
  warning: { icon: AlertTriangle, color: 'text-yellow-600', border: 'border-l-destructive' },
  encouragement: { icon: CheckCircle2, color: 'text-green-600', border: 'border-l-green-500' },
  tip: { icon: Lightbulb, color: 'text-accent', border: 'border-l-accent' },
  giving: { icon: Heart, color: 'text-accent', border: 'border-l-accent' },
  savings: { icon: PiggyBank, color: 'text-primary', border: 'border-l-primary' },
};

interface InsightsSectionProps {
  insights: Insight[];
  loading: boolean;
  lastUpdated: Date | null;
  onSeeAll: () => void;
}

export function InsightsSection({ insights, loading, lastUpdated, onSeeAll }: InsightsSectionProps) {
  const displayInsights = insights.slice(0, 3);

  return (
    <div className="px-6 mt-6 animate-fade-up" style={{ animationDelay: '400ms', animationFillMode: 'both' }}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <Sparkles size={14} className="text-accent" />
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Insights</h3>
        </div>
        {insights.length > 0 && (
          <button onClick={onSeeAll} className="flex items-center gap-0.5 text-xs text-accent font-medium active:opacity-70">
            See all <ChevronRight size={12} />
          </button>
        )}
      </div>

      {loading && displayInsights.length === 0 ? (
        <div className="space-y-2">
          {[1, 2].map(i => (
            <div key={i} className="bg-card rounded-lg shadow-sm p-4 animate-pulse">
              <div className="h-3 bg-muted rounded w-1/3 mb-2" />
              <div className="h-2 bg-muted rounded w-full mb-1" />
              <div className="h-2 bg-muted rounded w-2/3" />
            </div>
          ))}
        </div>
      ) : displayInsights.length === 0 ? (
        <div className="bg-card rounded-lg shadow-sm px-4 py-6 flex flex-col items-center">
          <Sparkles size={20} className="text-muted-foreground/30 mb-2" />
          <p className="text-sm text-muted-foreground">Tap sync to generate insights</p>
        </div>
      ) : (
        <div className="space-y-2">
          {displayInsights.map((insight, i) => {
            const config = iconMap[insight.type] || iconMap.tip;
            const Icon = config.icon;
            return (
              <div
                key={i}
                className={`bg-card rounded-lg shadow-sm p-3.5 border-l-[3px] ${config.border}`}
              >
                <div className="flex items-start gap-2.5">
                  <Icon size={16} className={`${config.color} mt-0.5 shrink-0`} />
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-foreground font-display">{insight.title}</p>
                    <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{insight.body}</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {lastUpdated && (
        <p className="text-[10px] text-muted-foreground/60 mt-1.5 text-center">
          Insights updated {formatDistanceToNow(lastUpdated, { addSuffix: true })}
        </p>
      )}
    </div>
  );
}
