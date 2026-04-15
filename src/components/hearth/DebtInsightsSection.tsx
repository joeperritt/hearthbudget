import { useState, useCallback } from 'react';
import { Sparkles, AlertTriangle, CheckCircle2, Lightbulb, PiggyBank, RefreshCw } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { formatDistanceToNow } from 'date-fns';

interface Insight {
  type: 'warning' | 'encouragement' | 'tip' | 'giving' | 'savings';
  title: string;
  body: string;
}

const iconMap: Record<string, { icon: typeof AlertTriangle; color: string; border: string }> = {
  warning: { icon: AlertTriangle, color: 'text-yellow-600', border: 'border-l-destructive' },
  encouragement: { icon: CheckCircle2, color: 'text-green-600', border: 'border-l-green-500' },
  tip: { icon: Lightbulb, color: 'text-accent', border: 'border-l-accent' },
  giving: { icon: Lightbulb, color: 'text-accent', border: 'border-l-accent' },
  savings: { icon: PiggyBank, color: 'text-primary', border: 'border-l-primary' },
};

interface DebtInsightsSectionProps {
  householdId: string | null;
  debts: { type: string; balance: number; rate: number; monthlyPayment: number }[];
  payoffResults: { results: any[]; totalMonths: number; totalInterest: number };
  baselineResults: { totalMonths: number; totalInterest: number };
  rollForward: boolean;
  extraPayment: number;
  financialProfile: any;
}

export function DebtInsightsSection({ householdId, debts, payoffResults, baselineResults, rollForward, extraPayment, financialProfile }: DebtInsightsSectionProps) {
  const [insights, setInsights] = useState<Insight[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchInsights = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const totalBalance = debts.reduce((s, d) => s + d.balance, 0);
      const totalMonthlyDebtPayments = debts.reduce((s, d) => s + d.monthlyPayment, 0) + extraPayment;
      const grossMonthlyIncome = financialProfile ? Number(financialProfile.annual_gross_income) / 12 : 0;
      const mortgagePayment = financialProfile ? Number(financialProfile.mortgage_payment) || 0 : 0;
      const monthlyRent = financialProfile ? Number(financialProfile.monthly_rent) || 0 : 0;
      const housingPayment = financialProfile?.housing_type === 'own' ? mortgagePayment : monthlyRent;
      const frontEndDTI = grossMonthlyIncome > 0 ? (housingPayment / grossMonthlyIncome) * 100 : 0;
      const backEndDTI = grossMonthlyIncome > 0 ? ((housingPayment + totalMonthlyDebtPayments) / grossMonthlyIncome) * 100 : 0;

      const debtPayload = {
        currentMonth: new Date().toISOString().slice(0, 7),
        context: 'debt_payoff_analysis',
        totalDebtBalance: totalBalance,
        debtToIncomeRatios: {
          grossMonthlyIncome: Math.round(grossMonthlyIncome),
          housingPayment,
          totalMonthlyDebtPayments,
          frontEndDTI: Math.round(frontEndDTI * 10) / 10,
          backEndDTI: Math.round(backEndDTI * 10) / 10,
        },
        debts: payoffResults.results.map(r => ({
          type: r.type, balance: r.balance, rate: r.rate,
          monthlyPayment: r.monthlyPayment, projectedPayoffMonths: r.payoffMonths,
          totalInterest: r.totalInterest, payoffOrder: r.payoffOrder,
        })),
        payoffTimeline: { totalMonths: payoffResults.totalMonths, totalInterest: payoffResults.totalInterest },
        baseline: { totalMonths: baselineResults.totalMonths, totalInterest: baselineResults.totalInterest },
        interestSaved: baselineResults.totalInterest - payoffResults.totalInterest,
        monthsSaved: baselineResults.totalMonths - payoffResults.totalMonths,
        rollPaymentsForward: rollForward,
        extraMonthlyPayment: extraPayment,
        ...(financialProfile ? {
          financialProfile: {
            annual_gross_income: Number(financialProfile.annual_gross_income) || 0,
            member_incomes: Array.isArray(financialProfile.member_incomes) ? financialProfile.member_incomes : [],
            filing_status: financialProfile.filing_status,
            emergency_fund_balance: Number(financialProfile.emergency_fund_balance) || 0,
            retirement_balance: Number(financialProfile.retirement_balance) || 0,
            non_retirement_investments: Number(financialProfile.non_retirement_investments) || 0,
            housing_type: financialProfile.housing_type,
            mortgage_balance: Number(financialProfile.mortgage_balance) || 0,
            mortgage_payment: Number(financialProfile.mortgage_payment) || 0,
          },
        } : {}),
      };

      const systemOverride = `You are a CFP (Certified Financial Planner) analyzing a household's debt payoff strategy. The data includes debtToIncomeRatios with frontEndDTI (housing/income) and backEndDTI (housing+debts/income). ALWAYS analyze DTI ratios: front-end should be under 28%, back-end under 36%. If back-end DTI exceeds 36%, issue a warning — above 43% is critical (FHA max). If DTI is healthy, acknowledge it as encouragement. Also cover: interest cost awareness, payoff acceleration opportunities, and overall financial health impact. Be specific with dollar amounts, percentages, and timelines. Format as JSON array of objects with "type" (warning/encouragement/tip/savings), "title" (5 words max), "body" (2-3 sentences with specific numbers).`;

      const { data, error: fnError } = await supabase.functions.invoke('budget-insights', {
        body: {
          budgetSummary: debtPayload,
          chatMessages: [{ role: 'system', content: systemOverride }],
        },
      });

      if (fnError) throw new Error(fnError.message);
      const content = data?.content || '';
      const jsonMatch = content.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]) as Insight[];
        setInsights(parsed);
        setLastUpdated(new Date());
      } else {
        throw new Error('Could not parse insights');
      }
    } catch (e: any) {
      setError(e?.message || 'Failed to generate insights');
    } finally {
      setLoading(false);
    }
  }, [debts, payoffResults, baselineResults, rollForward, extraPayment, financialProfile]);

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
          <p className="text-sm text-muted-foreground">Tap Generate for AI debt insights</p>
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
          Updated {formatDistanceToNow(lastUpdated, { addSuffix: true })}
        </p>
      )}
    </div>
  );
}
