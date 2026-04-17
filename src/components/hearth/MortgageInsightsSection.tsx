import { useState, useCallback } from 'react';
import { Sparkles, AlertTriangle, RefreshCw } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { formatDistanceToNow } from 'date-fns';
import { AIInsightsList, parseAIInsights, type AIInsight } from './AIInsightsList';
import type { AINavigationHandlers } from '@/lib/aiNavigation';

function fmt(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n || 0);
}

interface MortgageInsightsSectionProps {
  householdId: string | null;
  homePrice: number;
  loanAmount: number;
  downPayment: number;
  downPaymentPct: number;
  interestRate: number;
  loanTermYears: number;
  monthlyPI: number;
  monthlyTax: number;
  monthlyInsurance: number;
  totalHousing: number;
  housingRatio: number;
  dtiRatio: number;
  otherDebt: number;
  selectedState: string;
  financialProfile: any;
  mortgageMode: 'shopping' | 'existing';
  payoffDate?: string | null;
  remainingTermMonths?: number;
  totalInterestRemaining?: number;
  homeValue?: number;
  equity?: number;
  loanType?: string | null;
  extraPaymentScenarios?: { extra: number; monthsSaved: number; interestSaved: number }[];
  navigationHandlers?: AINavigationHandlers;
}

export function MortgageInsightsSection({
  householdId, homePrice, loanAmount, downPayment, downPaymentPct,
  interestRate, loanTermYears, monthlyPI, monthlyTax, monthlyInsurance,
  totalHousing, housingRatio, dtiRatio, otherDebt, selectedState, financialProfile, mortgageMode,
  payoffDate, remainingTermMonths, totalInterestRemaining, homeValue, equity, loanType, extraPaymentScenarios,
  navigationHandlers,
}: MortgageInsightsSectionProps) {
  const [insights, setInsights] = useState<AIInsight[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchInsights = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const existingPrompt = `You are a Certified Financial Planner (CFP®) and Certified Kingdom Advisor (CKA) providing mortgage analysis within a household budgeting app called Hearth. You will receive the user's mortgage data including: current balance, interest rate, loan type, monthly payment with P&I and escrow breakdown, projected payoff date, remaining term, total interest remaining, home value, equity position, housing ratio, total debt-to-income ratio, and extra payment scenarios. Provide exactly 3 insights as a JSON array. Each insight must have: 'type' (one of 'warning', 'tip', or 'encouragement'), 'title' (5 words or less), 'body' (2-3 sentences referencing specific dollar amounts, percentages, and dates from the data provided, be direct and practical), and 'nextStep' (an object with 'action' as a specific thing to do and 'destination' as where in the app to do it). Focus ONLY on mortgage and housing topics. Do not reference retirement, insurance, or non-housing debt topics. If housing ratio is well below 28%, note the financial flexibility. If DTI exceeds 36%, flag it as priority. Quantify extra payment impact in dollars and time saved. Frame homeownership as stewardship of a major asset. For next steps, point to 'Financial Profile > Housing' to update extra payment amount, or to 'Plan > Debt Payoff Analyzer' if DTI is a concern.

Valid destination strings (use EXACTLY one):
"Financial Profile > Accounts", "Financial Profile > Insurance", "Financial Profile > Housing", "Financial Profile > Debts", "Financial Profile > Profile", "Financial Profile > Income", "Budget", "Plan > Emergency Fund Analysis", "Plan > Non-Retirement Goals", "Plan > Retirement Planner", "Plan > Mortgage Analyzer", "Plan > Debt Payoff Analyzer", "Plan > Life Insurance Analysis".

Return ONLY the JSON array, no markdown fences, no prose.`;

      const shoppingPrompt = `You are a Certified Financial Planner (CFP®) and Certified Kingdom Advisor (CKA) helping a household evaluate a potential home purchase within a budgeting app called Hearth. Speak in future tense — they have NOT committed yet. Provide exactly 3 insights as a JSON array. Each insight must have: 'type' (one of 'warning', 'tip', or 'encouragement'), 'title' (5 words or less), 'body' (2-3 sentences referencing specific dollar amounts and ratios, be direct and practical), and 'nextStep' (an object with 'action' as a specific thing to do and 'destination' as where in the app to do it). Cover payment sustainability, down payment strategy (PMI under 20%), and state-specific considerations for ${selectedState || 'their state'}. Do not reference retirement, insurance, or non-housing debt topics.

Valid destination strings (use EXACTLY one):
"Financial Profile > Accounts", "Financial Profile > Insurance", "Financial Profile > Housing", "Financial Profile > Debts", "Financial Profile > Profile", "Financial Profile > Income", "Budget", "Plan > Emergency Fund Analysis", "Plan > Non-Retirement Goals", "Plan > Retirement Planner", "Plan > Mortgage Analyzer", "Plan > Debt Payoff Analyzer", "Plan > Life Insurance Analysis".

Return ONLY the JSON array, no markdown fences, no prose.`;

      const systemPrompt = mortgageMode === 'existing' ? existingPrompt : shoppingPrompt;

      const scenarioLines = (extraPaymentScenarios || [])
        .map(s => `  - +${fmt(s.extra)}/mo: saves ${fmt(s.interestSaved)} interest, ${s.monthsSaved} months sooner`)
        .join('\n');

      const prompt = mortgageMode === 'existing'
        ? `Household existing mortgage snapshot:
- Current balance: ${fmt(loanAmount)}
- Interest rate: ${interestRate}%
- Loan type: ${loanType || 'n/a'}
- Original/term years: ${loanTermYears}
- Remaining term: ${remainingTermMonths ?? 'n/a'} months
- Monthly P&I: ${fmt(monthlyPI)}
- Monthly tax (escrow): ${fmt(monthlyTax)}
- Monthly insurance (escrow): ${fmt(monthlyInsurance)}
- Total monthly housing (PITI): ${fmt(totalHousing)}
- Projected payoff date: ${payoffDate || 'n/a'}
- Total interest remaining: ${fmt(totalInterestRemaining || 0)}
- Estimated home value: ${fmt(homeValue || 0)}
- Equity: ${fmt(equity || 0)}
- Housing ratio (front-end DTI): ${housingRatio.toFixed(1)}%
- Total DTI (back-end): ${dtiRatio.toFixed(1)}%
- Other monthly debt payments: ${fmt(otherDebt)}
- State: ${selectedState}

Extra payment scenarios:
${scenarioLines || '  (none modeled)'}

Generate exactly 3 insights with nextStep actions per the system instructions.`
        : `Prospective home purchase snapshot:
- Home price: ${fmt(homePrice)}
- Loan amount: ${fmt(loanAmount)}
- Down payment: ${fmt(downPayment)} (${downPaymentPct.toFixed(1)}%)
- Interest rate: ${interestRate}%
- Term: ${loanTermYears} years
- Monthly P&I: ${fmt(monthlyPI)}
- Monthly tax: ${fmt(monthlyTax)}
- Monthly insurance: ${fmt(monthlyInsurance)}
- Total monthly housing (PITI): ${fmt(totalHousing)}
- Housing ratio: ${housingRatio.toFixed(1)}%
- Total DTI: ${dtiRatio.toFixed(1)}%
- Other monthly debt: ${fmt(otherDebt)}
- State: ${selectedState}

Generate exactly 3 insights with nextStep actions per the system instructions.`;

      console.log('[MortgageInsights] prompt sent to budget-insights:\n', prompt);

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
  }, [homePrice, loanAmount, downPayment, downPaymentPct, interestRate, loanTermYears, monthlyPI, monthlyTax, monthlyInsurance, totalHousing, housingRatio, dtiRatio, otherDebt, selectedState, financialProfile, mortgageMode, payoffDate, remainingTermMonths, totalInterestRemaining, homeValue, equity, loanType, extraPaymentScenarios, householdId]);

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
          <p className="text-sm text-muted-foreground">Tap Generate for AI mortgage insights</p>
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
