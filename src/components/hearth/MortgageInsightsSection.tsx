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
}

export function MortgageInsightsSection({
  householdId, homePrice, loanAmount, downPayment, downPaymentPct,
  interestRate, loanTermYears, monthlyPI, monthlyTax, monthlyInsurance,
  totalHousing, housingRatio, dtiRatio, otherDebt, selectedState, financialProfile,
}: MortgageInsightsSectionProps) {
  const [insights, setInsights] = useState<Insight[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchInsights = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const payload = {
        currentMonth: new Date().toISOString().slice(0, 7),
        context: 'mortgage_analysis',
        homePrice, loanAmount, downPayment, downPaymentPct,
        interestRate, loanTermYears,
        piti: { principalAndInterest: monthlyPI, propertyTax: monthlyTax, insurance: monthlyInsurance, total: totalHousing },
        housingRatio, dtiRatio, otherMonthlyDebt: otherDebt,
        state: selectedState,
        ...(financialProfile ? {
          financialProfile: {
            member_incomes: Array.isArray(financialProfile.member_incomes) ? financialProfile.member_incomes : [],
            filing_status: financialProfile.filing_status,
            debts: Array.isArray(financialProfile.debts) ? financialProfile.debts : [],
            emergency_fund_balance: Number(financialProfile.emergency_fund_balance) || 0,
            retirement_balance: Number(financialProfile.retirement_balance) || 0,
            non_retirement_investments: Number(financialProfile.non_retirement_investments) || 0,
            housing_type: financialProfile.housing_type,
            mortgage_balance: Number(financialProfile.mortgage_balance) || 0,
            mortgage_payment: Number(financialProfile.mortgage_payment) || 0,
          },
        } : {}),
      };

      const systemOverride = `You are a CFP (Certified Financial Planner) analyzing a household's mortgage and home affordability. Focus specifically on home purchase strategy — surface 2-3 insights covering: whether the monthly payment is sustainable given their income and other debts, whether the down payment size is optimal, PMI considerations if down payment is under 20%, interest rate context, and any state-specific considerations for ${selectedState || 'their state'}. Be specific with dollar amounts and ratios from the data. Format as JSON array of objects with "type" (warning/encouragement/tip/savings), "title" (5 words max), "body" (2-3 sentences with specific numbers).`;

      const { data, error: fnError } = await supabase.functions.invoke('budget-insights', {
        body: {
          budgetSummary: payload,
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
  }, [homePrice, loanAmount, downPayment, downPaymentPct, interestRate, loanTermYears, monthlyPI, monthlyTax, monthlyInsurance, totalHousing, housingRatio, dtiRatio, otherDebt, selectedState, financialProfile]);

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
          <p className="text-sm text-muted-foreground">Tap Generate for AI mortgage insights</p>
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
