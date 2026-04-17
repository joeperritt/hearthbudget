import { useState, useCallback } from 'react';
import { Sparkles, AlertTriangle, RefreshCw } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { formatDistanceToNow } from 'date-fns';
import { AIInsightsList, parseAIInsights, type AIInsight } from './AIInsightsList';
import type { AINavigationHandlers } from '@/lib/aiNavigation';

function fmt(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n || 0);
}

interface RetirementInsightsSectionProps {
  householdId: string | null;
  retirementPicture: any;
  financialProfile: any;
  navigationHandlers?: AINavigationHandlers;
}

export function RetirementInsightsSection({ householdId, retirementPicture, financialProfile, navigationHandlers }: RetirementInsightsSectionProps) {
  const [insights, setInsights] = useState<AIInsight[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchInsights = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const systemPrompt = `You are a Certified Financial Planner (CFP®) and Certified Kingdom Advisor (CKA) providing retirement planning guidance within a household budgeting app called Hearth. You will receive the user's retirement data including: current ages, target retirement year, current retirement balances by account type, monthly contributions, expected return rate, estimated retirement expenses, Social Security estimates, other retirement income sources, projected portfolio at retirement, phased income projections, and CFP guideline metrics. Provide exactly 4 insights as a JSON array. Each insight must have: 'type' (one of 'warning', 'tip', or 'encouragement'), 'title' (5 words or less), 'body' (2-3 sentences referencing specific dollar amounts, percentages, and projections from the data provided, be direct and practical), and 'nextStep' (an object with 'action' as a specific thing to do and 'destination' as where in the app to do it). Focus ONLY on retirement planning topics. Do not reference emergency funds, non-retirement savings goals, insurance, or mortgage topics. Reference the phased income projection when relevant. Discuss Roth vs pre-tax diversification based on current balance mix. Reference contribution room and limits. Treat any debt with type 'Business Buy-In / Partnership Investment' as investment-backed, not consumer debt. Frame retirement preparation as faithful stewardship. For next steps, point to 'Financial Profile > Accounts' to increase contributions, suggest specific dollar amounts, or reference the Retirement Expense Estimator if expenses seem unrefined.

Valid destination strings (use EXACTLY one):
"Financial Profile > Accounts", "Financial Profile > Insurance", "Financial Profile > Housing", "Financial Profile > Debts", "Financial Profile > Profile", "Financial Profile > Income", "Budget", "Plan > Emergency Fund Analysis", "Plan > Non-Retirement Goals", "Plan > Retirement Planner", "Plan > Mortgage Analyzer", "Plan > Debt Payoff Analyzer", "Plan > Life Insurance Analysis".

Return ONLY the JSON array, no markdown fences, no prose.`;

      const fp = financialProfile || {};
      const debts = Array.isArray(fp.debts) ? fp.debts : [];
      const debtLines = debts.map((d: any) => `  - ${d.name || d.type || 'Debt'}: balance ${fmt(Number(d.balance) || 0)}, type "${d.type || 'Other'}"`).join('\n');

      const rp = retirementPicture || {};
      const memberLines = Array.isArray(rp.members)
        ? rp.members.map((m: any) => `  - ${m.name}: age ${m.age}, retire age ${m.retireAge}, gross income ${fmt(Number(m.gross_income) || 0)}`).join('\n')
        : '';
      const phaseLines = Array.isArray(rp.incomePhases)
        ? rp.incomePhases.map((p: any) => `  - ${p.label} (${p.durationYears} yrs): total ${fmt(p.totalIncome)} (SS ${fmt(p.ssIncome)}, other ${fmt(p.otherIncome || 0)}, portfolio ${fmt(p.portfolioIncome)}, withdrawal rate ${(Number(p.withdrawalRate) * 100).toFixed(2)}%)`).join('\n')
        : '';
      const otherIncomeLines = Array.isArray(rp.otherIncomeSources)
        ? rp.otherIncomeSources.map((o: any) => `  - ${o.name || 'Other'}: ${fmt(o.startAmount)}/mo, ${o.startYr}–${o.endYr}${o.inflationAdjusted ? ' (inflation-adjusted)' : ''}`).join('\n')
        : '';

      const totalBalance = Number(rp.currentTotal) || 0;
      const totalMonthlyContrib = Number(rp.monthlyContributions) || 0;
      const rothPctVal = Number(rp.rothPct) || 0;
      const savingsRateVal = Number(rp.savingsRate) || 0;
      const salaryMultipleVal = Number(rp.salaryMultiple) || 0;

      const prompt = `Household retirement planning snapshot:

Members:
${memberLines || '  (none)'}

Demographics & Timeline:
- Target retirement year: ${rp.retirementYear ?? 'n/a'}
- Retirement age (primary): ${rp.retirementAge ?? 'n/a'}
- Years until retirement: ${rp.yearsToRetirement ?? 'n/a'}
- Assumed inflation rate: ${rp.inflationRate ?? 'n/a'}%

Current Balances:
- Pre-tax / 401(k) / Traditional IRA: ${fmt(Number(rp.currentPreTax) || 0)}
- Roth: ${fmt(Number(rp.currentRoth) || 0)}
- Taxable / non-qualified: ${fmt(Number(rp.currentNonQual) || 0)}
- Total invested: ${fmt(totalBalance)}
- Roth share of total: ${(rothPctVal * 100).toFixed(1)}%

Contributions (monthly):
- Pre-tax: ${fmt(Number(rp.preTaxContrib) || 0)}
- Roth: ${fmt(Number(rp.rothContrib) || 0)}
- Taxable / non-qualified: ${fmt(Number(rp.nonQualContrib) || 0)}
- Total monthly contributions: ${fmt(totalMonthlyContrib)}
- Total annual contributions: ${fmt(Number(rp.annualContributions) || 0)}
- Savings rate (% of gross): ${(savingsRateVal * 100).toFixed(1)}%

Assumptions & Projections:
- Expected return: ${rp.expectedReturn ?? 'n/a'}%
- Projected portfolio at retirement: ${fmt(Number(rp.projectedPortfolio) || 0)}
   (Pre-tax ${fmt(Number(rp.projectedPreTax) || 0)}, Roth ${fmt(Number(rp.projectedRoth) || 0)}, Taxable ${fmt(Number(rp.projectedNonQual) || 0)})
- 4% safe withdrawal monthly from portfolio: ${fmt(Number(rp.monthlyFromPortfolio) || 0)}
- Estimated monthly retirement expenses: ${fmt(Number(rp.monthlyExpenses) || 0)}
- Social Security enabled: ${rp.socialSecurityEnabled ? 'yes' : 'no'}
- Total Social Security monthly (household): ${fmt(Number(rp.totalSSBenefit) || 0)}
- Total monthly retirement income at start: ${fmt(Number(rp.totalMonthlyIncome) || 0)}
- Monthly gap (income − expenses): ${fmt(Number(rp.monthlyGap) || 0)}
- Implied withdrawal rate: ${(Number(rp.impliedWithdrawalRate) * 100).toFixed(2)}%
- Max phase withdrawal rate: ${(Number(rp.maxPhaseWithdrawalRate) * 100).toFixed(2)}%
- Withdrawal sustainable (≤4%): ${rp.withdrawalSustainable ? 'yes' : 'no'}
- Additional monthly savings needed to close gap: ${fmt(Number(rp.additionalMonthlyNeeded) || 0)}
- Lump-sum needed today to close gap: ${fmt(Number(rp.lumpSumNeeded) || 0)}

CFP guideline benchmarks:
- Salary multiple (current portfolio / annual gross): ${salaryMultipleVal.toFixed(2)}x

Phased income projection:
${phaseLines || '  (none)'}

Other income sources:
${otherIncomeLines || '  (none)'}

Household financial context:
- Filing status: ${fp.filing_status || 'n/a'}
- Annual gross income: ${fmt(Number(fp.annual_gross_income) || 0)}
- Emergency fund: ${fmt(Number(fp.emergency_fund_balance) || 0)}
- Debts:
${debtLines || '  (none)'}

Generate exactly 4 insights with nextStep actions per the system instructions.`;

      console.log('[RetirementInsights] prompt sent to budget-insights:\n', prompt);

      const { data, error: fnError } = await supabase.functions.invoke('budget-insights', {
        body: { prompt, systemPrompt, householdId },
      });
      if (fnError) throw new Error(fnError.message);
      if (data?.error) throw new Error(data.error);
      const raw = data?.insights ?? data?.content ?? '';
      const parsed = parseAIInsights(raw).slice(0, 4);
      setInsights(parsed);
      setLastUpdated(new Date());
    } catch (e: any) {
      setError(e?.message || 'Failed to generate insights');
    } finally {
      setLoading(false);
    }
  }, [retirementPicture, financialProfile, householdId]);

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
          <p className="text-sm text-muted-foreground">Tap Generate for AI retirement planning insights</p>
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
