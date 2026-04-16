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

interface TaxWithholdingInsightsSectionProps {
  householdId: string | null;
  memberName: string;
  filingStatus: string;
  annualGross: number;
  payFrequency: string;
  payPeriods: number;
  federalWithholdingPerPaycheck: number;
  stateWithholdingPerPaycheck: number;
  selectedState: string;
  preTaxDeductions: { retirement: number; health: number; hsa: number; other: number };
  additionalWithholding: number;
  estimatedFederalTax: number;
  annualFederalWithheld: number;
  federalDelta: number;
  estimatedStateTax: number;
  annualStateWithheld: number;
  stateDelta: number;
  ficaSS: number;
  ficaMedicare: number;
  effectiveRate: number;
  marginalRate: number;
  takeHomePay: number;
  withholdingStatus: string;
  recommendedAdjustment: number;
  financialProfile: any;
}

export function TaxWithholdingInsightsSection(props: TaxWithholdingInsightsSectionProps) {
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
        context: 'tax_withholding_analysis',
        memberName: props.memberName,
        filingStatus: props.filingStatus,
        annualGross: props.annualGross,
        payFrequency: props.payFrequency,
        payPeriods: props.payPeriods,
        federalWithholdingPerPaycheck: props.federalWithholdingPerPaycheck,
        stateWithholdingPerPaycheck: props.stateWithholdingPerPaycheck,
        state: props.selectedState,
        preTaxDeductions: props.preTaxDeductions,
        additionalWithholding: props.additionalWithholding,
        estimatedFederalTax: props.estimatedFederalTax,
        annualFederalWithheld: props.annualFederalWithheld,
        federalDelta: props.federalDelta,
        estimatedStateTax: props.estimatedStateTax,
        annualStateWithheld: props.annualStateWithheld,
        stateDelta: props.stateDelta,
        ficaSS: props.ficaSS,
        ficaMedicare: props.ficaMedicare,
        effectiveRate: props.effectiveRate,
        marginalRate: props.marginalRate,
        takeHomePay: props.takeHomePay,
        withholdingStatus: props.withholdingStatus,
        recommendedAdjustment: props.recommendedAdjustment,
        ...(props.financialProfile ? {
          financialProfile: {
            member_incomes: Array.isArray(props.financialProfile.member_incomes) ? props.financialProfile.member_incomes : [],
            filing_status: props.financialProfile.filing_status,
            debts: Array.isArray(props.financialProfile.debts) ? props.financialProfile.debts : [],
            emergency_fund_balance: Number(props.financialProfile.emergency_fund_balance) || 0,
            retirement_balance: Number(props.financialProfile.retirement_balance) || 0,
            non_retirement_investments: Number(props.financialProfile.non_retirement_investments) || 0,
            roth_retirement_balance: Number(props.financialProfile.roth_retirement_balance) || 0,
          },
        } : {}),
      };

      const systemPrompt = `You are a Certified Financial Planner (CFP) and Certified Kingdom Advisor (CKA). Analyze this household member's tax withholding situation and provide 2-3 specific, actionable insights. Cover: withholding accuracy and W-4 adjustment recommendation, pre-tax deduction optimization (flag if 401k contribution is below the $23,500 2026 limit or if HSA is underutilized), and FICA considerations for high earners. Be practical, specific, and stewardship-framed — help them be wise stewards of every dollar. Use specific dollar amounts from the data. Format as JSON array of objects with "type" (warning/encouragement/tip/savings), "title" (5 words max), "body" (2-3 sentences with specific numbers).`;

      const { data, error: fnError } = await supabase.functions.invoke('budget-insights', {
        body: {
          budgetSummary: payload,
          chatMessages: [{ role: 'system', content: systemPrompt }],
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
  }, [props]);

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
          <p className="text-sm text-muted-foreground">Tap Generate for AI tax withholding insights</p>
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
