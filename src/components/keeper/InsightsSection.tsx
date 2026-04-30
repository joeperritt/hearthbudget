import { Sparkles, AlertTriangle, CheckCircle2, Lightbulb, Heart, PiggyBank, RefreshCw, Loader2 } from 'lucide-react';
import { Insight } from '@/hooks/useBudgetInsights';
import { formatDistanceToNow, differenceInDays } from 'date-fns';

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
  hasCached: boolean;
  onGenerate: () => void;
  onAskAI?: () => void;
}

export function InsightsSection({ insights, loading, error, lastUpdated, hasCached, onGenerate, onAskAI }: InsightsSectionProps) {
  const displayInsights = insights.slice(0, 3);
  const ageDays = lastUpdated ? differenceInDays(new Date(), lastUpdated) : 0;
  const isStale = lastUpdated && ageDays >= 7;
  const showEmpty = !hasCached && displayInsights.length === 0 && !loading && !error;

  return (
    <div className="px-6 mt-6 animate-fade-up" style={{ animationDelay: '400ms', animationFillMode: 'both' }}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <Sparkles size={14} className="text-accent" />
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Insights</h3>
        </div>
        {(hasCached || displayInsights.length > 0) && (
          <button
            onClick={onGenerate}
            disabled={loading}
            className="flex items-center gap-1 text-xs text-accent font-medium active:opacity-70 disabled:opacity-50"
          >
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
            {loading ? 'Analyzing…' : 'Refresh'}
          </button>
        )}
      </div>

      {/* Empty state — button-only invitation */}
      {showEmpty ? (
        <button
          onClick={onGenerate}
          className="w-full bg-card rounded-lg shadow-sm px-4 py-6 flex flex-col items-center gap-3 active:scale-[0.99] transition-transform"
        >
          <Sparkles size={22} className="text-accent" />
          <p className="text-sm text-foreground text-center max-w-xs leading-snug">
            Get personalized analysis of this month's budget from your AI financial advisor
          </p>
          <span className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-primary text-primary-foreground text-sm font-medium">
            <Sparkles size={14} />
            Generate insights
          </span>
        </button>
      ) : loading && displayInsights.length === 0 ? (
        // Loading-from-empty state
        <div className="bg-card rounded-lg shadow-sm px-4 py-8 flex flex-col items-center gap-2">
          <Loader2 size={20} className="text-accent animate-spin" />
          <p className="text-sm text-muted-foreground">Analyzing your budget…</p>
        </div>
      ) : (
        <>
          {/* Stale nudge */}
          {isStale && !error && !loading && (
            <div className="mb-2 bg-accent/5 border border-accent/20 rounded-lg px-3 py-2 flex items-center justify-between gap-2">
              <p className="text-xs text-foreground">
                Your insights are {ageDays} days old
              </p>
              <button
                onClick={onGenerate}
                className="text-xs text-accent font-semibold whitespace-nowrap active:opacity-70"
              >
                Refresh for latest
              </button>
            </div>
          )}

          {/* Loading overlay strip while keeping cached content visible */}
          {loading && displayInsights.length > 0 && (
            <div className="mb-2 bg-card border border-border rounded-lg px-3 py-2 flex items-center gap-2">
              <Loader2 size={14} className="text-accent animate-spin" />
              <p className="text-xs text-muted-foreground">Analyzing your budget…</p>
            </div>
          )}

          {/* Inline error preserves section */}
          {error && (
            <div className="mb-2 bg-card rounded-lg shadow-sm px-3 py-2.5 border-l-[3px] border-l-destructive flex items-start gap-2">
              <AlertTriangle size={14} className="text-destructive mt-0.5 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-foreground">Couldn't refresh insights</p>
                <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">{error}</p>
              </div>
              <button
                onClick={onGenerate}
                disabled={loading}
                className="text-xs text-accent font-semibold whitespace-nowrap active:opacity-70 disabled:opacity-50"
              >
                Try again
              </button>
            </div>
          )}

          {/* Cached insights */}
          {displayInsights.length > 0 && (
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

          {lastUpdated && !loading && (
            <p className="text-[10px] text-muted-foreground/60 mt-1.5 text-center">
              Generated {formatDistanceToNow(lastUpdated, { addSuffix: true })}
            </p>
          )}
        </>
      )}
    </div>
  );
}
