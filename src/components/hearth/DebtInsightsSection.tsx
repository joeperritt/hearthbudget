import { useState, useCallback } from 'react';
import { Sparkles, AlertTriangle, RefreshCw } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { formatDistanceToNow } from 'date-fns';
import { AIInsightsList, parseAIInsights, type AIInsight } from './AIInsightsList';
import type { AINavigationHandlers } from '@/lib/aiNavigation';

function fmt(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n || 0);
}

interface DebtInsightsSectionProps {
  householdId: string | null;
  debts: { type: string; name?: string; balance: number; rate: number; monthlyPayment: number; excluded?: boolean }[];
  payoffResults: { results: any[]; totalMonths: number; totalInterest: number };
  baselineResults: { totalMonths: number; totalInterest: number };
  rollForward: boolean;
  extraPayment: number;
  financialProfile: any;
  payoffMethod?: 'avalanche' | 'snowball';
  payoffDate?: string | null;
  snowballComparison?: { totalMonths: number; totalInterest: number } | null;
  navigationHandlers?: AINavigationHandlers;
}

export function DebtInsightsSection({ householdId, debts, payoffResults, baselineResults, rollForward, extraPayment, financialProfile, payoffMethod = 'avalanche', payoffDate, snowballComparison, navigationHandlers }: DebtInsightsSectionProps) {
  const [insights, setInsights] = useState<AIInsight[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchInsights = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const totalBalance = debts.reduce((s, d) => s + (d.excluded ? 0 : d.balance), 0);
      const totalMonthlyDebtPayments = debts.reduce((s, d) => s + (d.excluded ? 0 : d.monthlyPayment), 0) + extraPayment;
      const grossMonthlyIncome = financialProfile ? Number(financialProfile.annual_gross_income) / 12 : 0;
      const mortgagePayment = financialProfile ? Number(financialProfile.mortgage_payment) || 0 : 0;
      const monthlyRent = financialProfile ? Number(financialProfile.monthly_rent) || 0 : 0;
      const housingPayment = financialProfile?.housing_type === 'own' ? mortgagePayment : monthlyRent;
      const backEndDTI = grossMonthlyIncome > 0 ? ((housingPayment + totalMonthlyDebtPayments) / grossMonthlyIncome) * 100 : 0;

      const systemPrompt = `You are a Certified Financial Planner (CFP®) and Certified Kingdom Advisor (CKA) providing debt payoff guidance within a household budgeting app called Hearth. You will receive the user's debt data including: all debts with balances, interest rates, minimum payments, and types; excluded debts; selected payoff method (avalanche or snowball); total debt amount; debt-to-income ratio; payoff order; projected debt-free date; and extra payment scenarios with interest and time saved. Provide exactly 3 insights as a JSON array. Each insight must have: 'type' (one of 'warning', 'tip', or 'encouragement'), 'title' (5 words or less), 'body' (2-3 sentences referencing specific debt names, dollar amounts, interest rates, and timelines from the data provided, be direct and practical), and 'nextStep' (an object with 'action' as a specific thing to do and 'destination' as where in the app to do it). Focus ONLY on debt payoff strategy. Do not reference emergency funds, retirement, insurance, or mortgage analysis. CRITICAL: Any debt with type 'Business Buy-In / Partnership Investment' should be recognized as investment-backed debt. Do NOT recommend aggressively paying it down like consumer debt. Reference it by its name, not as 'Other' debt. Compare avalanche vs snowball outcomes if meaningful. If DTI exceeds 36%, make it a priority. Frame debt freedom as stewardship that creates margin for generosity. For next steps, point to 'Financial Profile > Debts' to add extra payments, or to 'Budget' to find discretionary spending to redirect.

Valid destination strings (use EXACTLY one):
"Financial Profile > Accounts", "Financial Profile > Insurance", "Financial Profile > Housing", "Financial Profile > Debts", "Financial Profile > Profile", "Financial Profile > Income", "Budget", "Plan > Emergency Fund Analysis", "Plan > Non-Retirement Goals", "Plan > Retirement Planner", "Plan > Mortgage Analyzer", "Plan > Debt Payoff Analyzer", "Plan > Life Insurance Analysis".

Return ONLY the JSON array, no markdown fences, no prose.`;

      const activeDebtLines = (payoffResults.results || []).map((r: any, i: number) =>
        `  ${i + 1}. ${r.name || r.type || 'Debt'} — type "${r.type || 'Other'}", balance ${fmt(r.balance)}, rate ${Number(r.rate).toFixed(2)}%, min payment ${fmt(r.monthlyPayment)}, payoff in ${r.payoffMonths} months, interest ${fmt(r.totalInterest)}`
      ).join('\n');
      const excludedLines = debts.filter(d => d.excluded).map(d => `  - ${d.name || d.type}: balance ${fmt(d.balance)} (excluded from plan)`).join('\n');

      const prompt = `Household debt payoff snapshot:
- Payoff method: ${payoffMethod}
- Total active debt: ${fmt(totalBalance)}
- Total monthly debt payments (incl. extra): ${fmt(totalMonthlyDebtPayments)}
- Extra monthly payment applied: ${fmt(extraPayment)}
- Roll payments forward: ${rollForward ? 'yes' : 'no'}
- Gross monthly income: ${fmt(grossMonthlyIncome)}
- Back-end DTI: ${backEndDTI.toFixed(1)}%
- Projected debt-free date: ${payoffDate || 'n/a'}
- Total interest with plan: ${fmt(payoffResults.totalInterest)}
- Total months with plan: ${payoffResults.totalMonths}
- Baseline (minimums only): ${fmt(baselineResults.totalInterest)} interest over ${baselineResults.totalMonths} months
- Interest saved vs baseline: ${fmt(Math.max(0, baselineResults.totalInterest - payoffResults.totalInterest))}
- Months saved vs baseline: ${Math.max(0, baselineResults.totalMonths - payoffResults.totalMonths)}
${snowballComparison ? `- Snowball alternative: ${fmt(snowballComparison.totalInterest)} interest over ${snowballComparison.totalMonths} months` : ''}

Active debts (in payoff order):
${activeDebtLines || '  (none)'}

${excludedLines ? `Excluded debts:\n${excludedLines}` : ''}

Generate exactly 3 insights with nextStep actions per the system instructions.`;

      console.log('[DebtInsights] prompt sent to budget-insights:\n', prompt);

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
  }, [debts, payoffResults, baselineResults, rollForward, extraPayment, financialProfile, payoffMethod, payoffDate, snowballComparison, householdId]);

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
          <p className="text-sm text-muted-foreground">Tap Generate for AI debt insights</p>
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
