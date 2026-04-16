import { useState, useEffect, useMemo } from 'react';
import { ArrowLeft, Shield, TrendingDown, FileText, Heart, Target, PiggyBank, Home } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

type InsightToolId = 'mortgage-analyzer' | 'debt-payoff' | 'tax-estimator' | 'life-insurance' | 'emergency-fund' | 'savings-goals' | 'retirement';

interface FinancialInsightsListProps {
  onBack: () => void;
  onSelectTool: (tool: InsightToolId) => void;
  householdId: string | null;
}

interface ToolStatus {
  label: string;
  color: 'green' | 'gold' | 'red' | 'grey';
}

function statusBadge(s: ToolStatus) {
  const colors = {
    green: 'bg-green-100 text-green-700',
    gold: 'bg-accent/10 text-accent',
    red: 'bg-red-100 text-destructive',
    grey: 'bg-muted text-muted-foreground',
  };
  return (
    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${colors[s.color]}`}>
      {s.label}
    </span>
  );
}

const tools: { id: InsightToolId; name: string; subtitle: string; icon: typeof Shield }[] = [
  { id: 'mortgage-analyzer', name: 'Mortgage Analyzer', subtitle: 'Analyze your current mortgage', icon: Home },
  { id: 'debt-payoff', name: 'Debt Payoff Analyzer', subtitle: 'See your path to debt freedom', icon: TrendingDown },
  { id: 'tax-estimator', name: 'Federal Tax Estimator', subtitle: 'Estimate your federal tax liability', icon: FileText },
  { id: 'life-insurance', name: 'Life Insurance Analysis', subtitle: 'Is your family protected?', icon: Heart },
  { id: 'emergency-fund', name: 'Emergency Fund Analysis', subtitle: 'Are you prepared for the unexpected?', icon: Shield },
  { id: 'savings-goals', name: 'Non-Retirement Goals', subtitle: 'Plan and track your non-retirement savings goals', icon: Target },
  { id: 'retirement', name: 'Retirement Planner', subtitle: 'Are you on track to retire?', icon: PiggyBank },
];

export function FinancialInsightsList({ onBack, onSelectTool, householdId }: FinancialInsightsListProps) {
  const [financialProfile, setFinancialProfile] = useState<any>(null);
  const [toolStates, setToolStates] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!householdId) { setLoading(false); return; }
    Promise.all([
      supabase.from('financial_profiles').select('*').eq('household_id', householdId).maybeSingle(),
      supabase.from('tool_states' as any).select('tool_name, state_json').eq('household_id', householdId),
    ]).then(([fpRes, tsRes]: any[]) => {
      if (fpRes.data) setFinancialProfile(fpRes.data);
      const states: Record<string, any> = {};
      (tsRes.data || []).forEach((r: any) => { states[r.tool_name] = r.state_json; });
      setToolStates(states);
      setLoading(false);
    });
  }, [householdId]);

  const getStatus = (toolId: InsightToolId): ToolStatus => {
    const ts = toolStates;
    switch (toolId) {
      case 'mortgage-analyzer': {
        const s = ts['mortgage-calculator'];
        if (!s || !s.exCurrentBalance) return { label: 'Not Set Up', color: 'grey' };
        return { label: 'Reviewed ✓', color: 'gold' };
      }
      case 'debt-payoff': {
        if (!financialProfile) return { label: 'Not Set Up', color: 'grey' };
        const debts: any[] = Array.isArray(financialProfile.debts) ? financialProfile.debts : [];
        if (debts.length === 0) return { label: 'Debt Free', color: 'green' };
        const members: any[] = Array.isArray(financialProfile.member_incomes) ? financialProfile.member_incomes : [];
        const grossMonthly = members.reduce((s: number, m: any) => s + (Number(m.gross_income) || 0), 0) / 12;
        const debtPayments = debts.reduce((s: number, d: any) => s + (Number(d.monthlyPayment) || Number(d.minimum_payment) || 0), 0)
          + (Number(financialProfile.mortgage_payment) || 0);
        if (grossMonthly <= 0) return { label: 'Not Set Up', color: 'grey' };
        const dti = debtPayments / grossMonthly;
        if (dti > 0.43) return { label: 'High DTI', color: 'red' };
        return { label: 'On Track', color: 'green' };
      }
      case 'tax-estimator': {
        const s = ts['tax-withholding'];
        if (!s) return { label: 'Not Set Up', color: 'grey' };
        return { label: 'Reviewed ✓', color: 'gold' };
      }
      case 'life-insurance': {
        const s = ts['life-insurance'];
        if (!s || !s.members) return { label: 'Not Set Up', color: 'grey' };
        const members = Array.isArray(s.members) ? s.members : [];
        const earning = members.filter((m: any) => Number(m.annualIncome) > 0);
        if (earning.length === 0) return { label: 'Not Set Up', color: 'grey' };
        const allCovered = earning.every((m: any) => Number(m.currentCoverage) > 0);
        if (!allCovered) return { label: 'Gap Detected', color: 'red' };
        return { label: 'Adequate', color: 'green' };
      }
      case 'emergency-fund': {
        const s = ts['emergency-fund'];
        if (!s || !s.currentBalance) return { label: 'Not Set Up', color: 'grey' };
        const bal = Number(s.currentBalance) || 0;
        const exp = Number(s.monthlyExpenses) || 0;
        if (exp <= 0) return { label: 'Reviewed ✓', color: 'gold' };
        const months = bal / exp;
        return months >= 3 ? { label: 'On Track', color: 'green' } : { label: 'Needs Attention', color: 'red' };
      }
      case 'savings-goals': {
        const s = ts['goals-planner'];
        if (!s || !s.goals || !Array.isArray(s.goals) || s.goals.length === 0) return { label: 'Not Set Up', color: 'grey' };
        const goals = s.goals.filter((g: any) => g.name && g.targetAmount);
        if (goals.length === 0) return { label: 'Not Set Up', color: 'grey' };
        const now = new Date();
        let onTrack = 0;
        goals.forEach((g: any) => {
          const target = Number(g.targetAmount) || 0;
          const current = Number(g.currentSavings) || 0;
          const monthly = Number(g.monthlyContribution) || 0;
          if (target <= 0) return;
          let months = 0;
          if (g.useDate && g.targetDate) {
            const [y, m] = g.targetDate.split('-').map(Number);
            months = Math.max(0, (y - now.getFullYear()) * 12 + (m - 1 - now.getMonth()));
          } else {
            months = Number(g.targetMonths) || 0;
          }
          const projected = current + monthly * months;
          if (projected >= target) onTrack++;
        });
        if (onTrack === goals.length) return { label: `${onTrack} of ${goals.length} On Track`, color: 'green' };
        if (onTrack > 0) return { label: `${onTrack} of ${goals.length} On Track`, color: 'gold' };
        return { label: `0 of ${goals.length} On Track`, color: 'red' };
      }
      case 'retirement': {
        const s = ts['retirement-planner'];
        if (!s || !s.retirementAge) return { label: 'Not Set Up', color: 'grey' };
        return { label: 'Reviewed ✓', color: 'gold' };
      }
      default:
        return { label: 'Not Set Up', color: 'grey' };
    }
  };

  if (loading) {
    return (
      <div className="max-w-lg mx-auto px-6 pt-12 safe-top">
        <div className="animate-pulse space-y-4">
          <div className="h-6 bg-muted rounded w-2/3" />
          <div className="h-16 bg-muted rounded-xl" />
          <div className="h-16 bg-muted rounded-xl" />
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto pb-32">
      <div className="px-6 pt-12 safe-top flex items-center gap-3">
        <button onClick={onBack} className="p-1.5 -ml-1.5 rounded-lg hover:bg-muted">
          <ArrowLeft size={20} className="text-foreground" />
        </button>
        <div>
          <h1 className="font-display text-xl font-bold text-foreground">Financial Insights</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Analysis based on your current situation</p>
        </div>
      </div>

      <div className="px-6 mt-4 space-y-2">
        {tools.map(tool => {
          const status = getStatus(tool.id);
          return (
            <button
              key={tool.id}
              onClick={() => onSelectTool(tool.id)}
              className="w-full flex items-center gap-3 bg-card rounded-xl p-3.5 shadow-sm text-left active:scale-[0.98] transition-transform"
            >
              <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                <tool.icon size={18} className="text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-foreground leading-tight">{tool.name}</p>
                <p className="text-xs text-muted-foreground mt-0.5 leading-snug truncate">{tool.subtitle}</p>
              </div>
              {statusBadge(status)}
            </button>
          );
        })}
      </div>
    </div>
  );
}
