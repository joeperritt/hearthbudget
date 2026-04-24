import { Sparkles, AlertTriangle, CheckCircle2, Lightbulb, Heart, PiggyBank, ChevronRight, RefreshCw } from 'lucide-react';
import { Insight } from '@/hooks/useBudgetInsights';
import { formatDistanceToNow } from 'date-fns';

const iconMap: Record<Insight['type'], { icon: typeof AlertTriangle; color: string; border: string; bg: string }> = {
  warning: { icon: AlertTriangle, color: 'text-destructive', border: 'border-l-destructive', bg: 'lg:bg-destructive/5' },
  encouragement: { icon: CheckCircle2, color: 'text-green-600', border: 'border-l-green-500', bg: 'lg:bg-green-500/5' },
  tip: { icon: Lightbulb, color: 'text-yellow-600', border: 'border-l-yellow-500', bg: 'lg:bg-yellow-500/5' },
  giving: { icon: Heart, color: 'text-green-600', border: 'border-l-green-500', bg: 'lg:bg-green-500/5' },
  savings: { icon: PiggyBank, color: 'text-green-600', border: 'border-l-green-500', bg: 'lg:bg-green-500/5' },
};

interface InsightsSectionProps {
  insights: Insight[];
  loading: boolean;
  error: string | null;
  lastUpdated: Date | null;
  onSeeAll: () => void;
  onRefresh: () => void;
}

export function InsightsSection({ insights, loading, error, lastUpdated, onSeeAll, onRefresh }: InsightsSectionProps) {
  const displayInsights = insights.slice(0, 3);

  return (
    <div className="px-6 mt-6 animate-fade-up" style={{ animationDelay: '400ms', animationFillMode: 'both' }}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <Sparkles size={14} className="text-accent" />
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Insights</h3>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onRefresh}
            disabled={loading}
            className="flex items-center gap-1 text-xs text-accent font-medium active:opacity-70 disabled:opacity-50"
          >
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
            {loading ? 'Loading…' : 'Refresh'}
          </button>
          {insights.length > 0 && (
            <button onClick={onSeeAll} className="flex items-center gap-0.5 text-xs text-accent font-medium active:opacity-70">
              See all <ChevronRight size={12} />
            </button>
          )}
        </div>
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
      ) : error ? (
        <div className="bg-card rounded-lg shadow-sm px-4 py-4 border-l-[3px] border-l-destructive">
          <div className="flex items-start gap-2.5">
            <AlertTriangle size={16} className="text-destructive mt-0.5 shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-foreground">Insights unavailable</p>
              <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{error}</p>
            </div>
          </div>
        </div>
      ) : displayInsights.length === 0 ? (
        <div className="bg-card rounded-lg shadow-sm px-4 py-6 flex flex-col items-center">
          <Sparkles size={20} className="text-muted-foreground/30 mb-2" />
          <p className="text-sm text-muted-foreground">Tap Refresh to generate insights</p>
        </div>
      ) : (
        <div className="space-y-2">
          {displayInsights.map((insight, i) => {
            const config = iconMap[insight.type] || iconMap.tip;
            const Icon = config.icon;
            return (
              <div
                key={i}
                className={`bg-card rounded-lg shadow-sm p-3.5 border-l-[3px] ${config.border} ${config.bg}`}
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

      {lastUpdated && !error && (
        <p className="text-[10px] text-muted-foreground/60 mt-1.5 text-center">
          Insights updated {formatDistanceToNow(lastUpdated, { addSuffix: true })}
        </p>
      )}
    </div>
  );
}
