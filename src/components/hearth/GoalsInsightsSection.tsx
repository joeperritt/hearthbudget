import { useState, useCallback } from 'react';
import { Sparkles, AlertTriangle, CheckCircle2, Lightbulb, PiggyBank, RefreshCw } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { formatDistanceToNow } from 'date-fns';

interface Insight {
  type: 'warning' | 'encouragement' | 'tip' | 'savings';
  title: string;
  body: string;
}

const iconMap: Record<string, { icon: typeof AlertTriangle; color: string; border: string }> = {
  warning: { icon: AlertTriangle, color: 'text-yellow-600', border: 'border-l-destructive' },
  encouragement: { icon: CheckCircle2, color: 'text-green-600', border: 'border-l-green-500' },
  tip: { icon: Lightbulb, color: 'text-accent', border: 'border-l-accent' },
  savings: { icon: PiggyBank, color: 'text-primary', border: 'border-l-primary' },
};

interface Goal {
  id: string;
  name: string;
  targetAmount: number;
  currentSavings: number;
  monthlyContribution: number;
  targetMonths: number;
}

interface GoalsInsightsSectionProps {
  householdId: string | null;
  goals: Goal[];
  financialProfile: any;
}

export function GoalsInsightsSection({ householdId, goals, financialProfile }: GoalsInsightsSectionProps) {
  const [insights, setInsights] = useState<Insight[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchInsights = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const goalsSummary = goals.map(g => {
        const remaining = Math.max(0, g.targetAmount - g.currentSavings);
        const monthlyNeeded = g.targetMonths > 0 ? remaining / g.targetMonths : 0;
        const surplus = g.monthlyContribution - monthlyNeeded;
        const projectedMonths = g.monthlyContribution > 0 ? remaining / g.monthlyContribution : Infinity;
        return {
          name: g.name,
          targetAmount: g.targetAmount,
          currentSavings: g.currentSavings,
          monthlyContribution: g.monthlyContribution,
          targetMonths: g.targetMonths,
          monthlyNeeded: Math.round(monthlyNeeded),
          surplus: Math.round(surplus),
          onTrack: surplus >= 0,
          projectedMonths: Math.round(projectedMonths),
        };
      });

      const totalContributing = goals.reduce((s, g) => s + g.monthlyContribution, 0);
      const totalNeeded = goalsSummary.reduce((s, g) => s + g.monthlyNeeded, 0);

      const systemPrompt = `You are a Certified Financial Planner (CFP) and Certified Kingdom Advisor (CKA). Analyze this household's non-retirement savings goals and provide 2-3 specific, actionable insights. Consider: which goal needs the most attention, whether total goal contributions ($${totalContributing}/mo toward $${totalNeeded}/mo needed) are sustainable relative to income, any goals that could be consolidated or reprioritized, and stewardship framing around intentional saving. Be practical, specific with dollar amounts, and warm — help them be faithful stewards. Format as JSON array of objects with "type" (warning/encouragement/tip/savings), "title" (5 words max), "body" (2-3 sentences with specific numbers). Do NOT use markdown formatting like **bold** or *italic*.`;

      const { data, error: fnError } = await supabase.functions.invoke('budget-insights', {
        body: {
          budgetSummary: {
            context: 'non_retirement_goals_analysis',
            goals: goalsSummary,
            totalContributing,
            totalNeeded,
            ...(financialProfile ? {
              financialProfile: {
                member_incomes: Array.isArray(financialProfile.member_incomes) ? financialProfile.member_incomes : [],
                filing_status: financialProfile.filing_status,
                annual_gross_income: Number(financialProfile.annual_gross_income) || 0,
                emergency_fund_balance: Number(financialProfile.emergency_fund_balance) || 0,
              },
            } : {}),
          },
          chatMessages: [{ role: 'system', content: systemPrompt }],
        },
      });

      if (fnError) throw new Error(fnError.message);
      const content = data?.content || '';
      const jsonMatch = content.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        setInsights(JSON.parse(jsonMatch[0]) as Insight[]);
        setLastUpdated(new Date());
      } else {
        throw new Error('Could not parse insights');
      }
    } catch (e: any) {
      setError(e?.message || 'Failed to generate insights');
    } finally {
      setLoading(false);
    }
  }, [goals, financialProfile]);

  return (
    <div className="px-6 mt-6">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <Sparkles size={14} className="text-accent" />
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">AI Insights</h3>
        </div>
        <button onClick={fetchInsights} disabled={loading} className="flex items-center gap-1 text-xs text-accent font-medium active:opacity-70 disabled:opacity-50">
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          {loading ? 'Loading…' : insights.length > 0 ? 'Refresh' : 'Generate'}
        </button>
      </div>

      {loading && insights.length === 0 ? (
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
              <p className="text-xs text-muted-foreground mt-0.5">{error}</p>
            </div>
          </div>
        </div>
      ) : insights.length === 0 ? (
        <div className="bg-card rounded-lg shadow-sm px-4 py-6 flex flex-col items-center">
          <Sparkles size={20} className="text-muted-foreground/30 mb-2" />
          <p className="text-sm text-muted-foreground">Tap Generate for AI savings goal insights</p>
        </div>
      ) : (
        <div className="space-y-2">
          {insights.map((insight, i) => {
            const config = iconMap[insight.type] || iconMap.tip;
            const Icon = config.icon;
            return (
              <div key={i} className={`bg-card rounded-lg shadow-sm p-3.5 border-l-[3px] ${config.border}`}>
                <div className="flex items-start gap-2.5">
                  <Icon size={16} className={`${config.color} mt-0.5 shrink-0`} />
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-foreground font-display">{insight.title.replace(/\*+/g, '')}</p>
                    <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{insight.body.replace(/\*+/g, '')}</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {lastUpdated && !error && (
        <p className="text-[10px] text-muted-foreground/60 mt-1.5 text-center">
          Updated {formatDistanceToNow(lastUpdated, { addSuffix: true })}
        </p>
      )}
    </div>
  );
}
