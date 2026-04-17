import { useState, useCallback } from 'react';
import { Sparkles, AlertTriangle, RefreshCw } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { formatDistanceToNow } from 'date-fns';
import { AIInsightsList, parseAIInsights, type AIInsight } from './AIInsightsList';
import type { AINavigationHandlers } from '@/lib/aiNavigation';

function fmt(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n || 0);
}

interface Goal {
  id: string;
  name: string;
  targetAmount: number;
  currentSavings: number;
  monthlyContribution: number;
  targetMonths: number;
  targetDate?: string | null;
  expectedReturn?: number;
  projectedCompletionMonths?: number;
  isEducation?: boolean;
  dependentName?: string;
  educationInflationAdjusted?: number;
}

interface GoalsInsightsSectionProps {
  householdId: string | null;
  goals: Goal[];
  financialProfile: any;
  monthlyPoolTotal?: number;
  allocatedMonthly?: number;
  navigationHandlers?: AINavigationHandlers;
}

export function GoalsInsightsSection({ householdId, goals, financialProfile, monthlyPoolTotal = 0, allocatedMonthly = 0, navigationHandlers }: GoalsInsightsSectionProps) {
  const [insights, setInsights] = useState<AIInsight[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchInsights = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const systemPrompt = `You are a Certified Financial Planner (CFP®) and Certified Kingdom Advisor (CKA) providing savings goal guidance within a household budgeting app called Hearth. You will receive the user's non-retirement savings data including: monthly savings pool total, allocated vs unallocated amounts, individual goals with target amounts, current savings, monthly allocations, expected return rates, target dates, and projected completion dates. Provide exactly 3 insights as a JSON array. Each insight must have: 'type' (one of 'warning', 'tip', or 'encouragement'), 'title' (5 words or less), 'body' (2-3 sentences referencing specific dollar amounts, goal names, and timelines from the data provided, be direct and practical), and 'nextStep' (an object with 'action' as a specific thing to do and 'destination' as where in the app to do it). Focus ONLY on non-retirement savings goals. Do not reference emergency fund adequacy, retirement planning, insurance, or debt topics covered by other tools. Reference specific goal names. If goals are off track, quantify the gap and suggest specific allocation changes. If the savings pool has unallocated money, suggest putting it to work. For education goals, reference the inflation-adjusted cost and time horizon. Frame saving intentionally as good stewardship. For next steps, point to 'Financial Profile > Accounts' to increase the savings pool, or to specific goals to adjust allocations. Make actions concrete with specific dollar amounts.

Valid destination strings (use EXACTLY one):
"Financial Profile > Accounts", "Financial Profile > Insurance", "Financial Profile > Housing", "Financial Profile > Debts", "Financial Profile > Profile", "Financial Profile > Income", "Budget", "Plan > Emergency Fund Analysis", "Plan > Non-Retirement Goals", "Plan > Retirement Planner", "Plan > Mortgage Analyzer", "Plan > Debt Payoff Analyzer", "Plan > Life Insurance Analysis".

Return ONLY the JSON array, no markdown fences, no prose.`;

      const goalLines = goals.map(g => {
        const remaining = Math.max(0, g.targetAmount - g.currentSavings);
        const monthlyNeeded = g.targetMonths > 0 ? remaining / g.targetMonths : 0;
        const surplus = g.monthlyContribution - monthlyNeeded;
        const onTrack = surplus >= 0;
        const parts = [
          `- ${g.name}${g.isEducation ? ' (education)' : ''}`,
          `target ${fmt(g.targetAmount)}`,
          `current ${fmt(g.currentSavings)}`,
          `monthly allocation ${fmt(g.monthlyContribution)}`,
          `monthly needed ${fmt(monthlyNeeded)}`,
          `target in ${g.targetMonths} months`,
          `expected return ${(g.expectedReturn ?? 0).toFixed(1)}%`,
          onTrack ? 'on track' : `gap ${fmt(Math.abs(surplus))}/mo`,
        ];
        if (g.targetDate) parts.push(`target date ${g.targetDate}`);
        if (g.projectedCompletionMonths && isFinite(g.projectedCompletionMonths)) parts.push(`projected in ${g.projectedCompletionMonths} months`);
        if (g.isEducation && g.educationInflationAdjusted) parts.push(`inflation-adjusted cost ${fmt(g.educationInflationAdjusted)}`);
        if (g.isEducation && g.dependentName) parts.push(`for ${g.dependentName}`);
        return parts.join('; ');
      }).join('\n');

      const unallocated = Math.max(0, monthlyPoolTotal - allocatedMonthly);

      const prompt = `Household non-retirement savings goals:
- Monthly savings pool total: ${fmt(monthlyPoolTotal)}
- Allocated across goals: ${fmt(allocatedMonthly)}
- Unallocated: ${fmt(unallocated)}
- Number of goals: ${goals.length}

Goals:
${goalLines || '(no goals defined)'}

Generate exactly 3 insights with nextStep actions per the system instructions.`;

      console.log('[GoalsInsights] prompt sent to budget-insights:\n', prompt);

      const { data, error: fnError } = await supabase.functions.invoke('budget-insights', {
        body: { prompt, systemPrompt, householdId },
      });
      if (fnError) throw new Error(fnError.message);
      if (data?.error) throw new Error(data.error);
      const raw = data?.insights ?? data?.content ?? '';
      const parsed = parseAIInsights(raw).slice(0, 3);
      setInsights(parsed);
      setLastUpdated(new Date());
    } catch (e: any) {
      setError(e?.message || 'Failed to generate insights');
    } finally {
      setLoading(false);
    }
  }, [goals, financialProfile, monthlyPoolTotal, allocatedMonthly, householdId]);

  return (
    <div className="px-6 mt-6">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <Sparkles size={14} className="text-accent" />
          <h3 className="text-xs font-semibold text-muted-foreground ">AI Insights</h3>
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
        <AIInsightsList insights={insights} navigationHandlers={navigationHandlers} />
      )}

      {lastUpdated && !error && (
        <p className="text-[10px] text-muted-foreground/60 mt-1.5 text-center">
          Updated {formatDistanceToNow(lastUpdated, { addSuffix: true })}
        </p>
      )}
    </div>
  );
}
