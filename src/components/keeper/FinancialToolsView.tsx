import { useState, useEffect, useMemo } from 'react';
import { ArrowLeft, Shield, Activity, PiggyBank, Target, TrendingDown, Home, Car, FileText, Heart, ChevronRight, CheckCircle2, AlertTriangle, Info } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { ProgressBar } from './ProgressBar';

type ToolId = 'cfp-profile' | 'health-score' | 'retirement' | 'goals-planner' | 'debt-payoff' | 'emergency-fund' | 'life-insurance' | 'tax-withholding' | 'mortgage' | 'car-loan';

interface FinancialToolsViewProps {
  onBack: () => void;
  onSelectTool: (tool: ToolId) => void;
  householdId: string | null;
}

function getProfileCompleteness(profile: any): { complete: boolean; filled: number; total: number } {
  if (!profile) return { complete: false, filled: 0, total: 6 };
  const total = 6;
  let filled = 0;
  const incomes = Array.isArray(profile.member_incomes) ? profile.member_incomes : [];
  if (incomes.length > 0 && incomes.some((m: any) => (Number(m.gross_income) || 0) > 0)) filled++;
  if (profile.filing_status && profile.state) filled++;
  if (profile.housing_type) filled++;
  if ((Number(profile.emergency_fund_balance) || 0) > 0 || (Number(profile.retirement_balance) || 0) > 0 || (Number(profile.non_retirement_investments) || 0) > 0) filled++;
  const debts = Array.isArray(profile.debts) ? profile.debts : [];
  if (debts.length > 0 || filled >= 3) filled++;
  if (profile.has_life_insurance !== null) filled++;
  return { complete: filled >= total, filled, total };
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

const tools: { id: ToolId; name: string; subtitle: string; icon: typeof Shield }[] = [
  { id: 'health-score', name: 'Financial Health Score', subtitle: 'Your overall score at a glance', icon: Activity },
  { id: 'retirement', name: 'Retirement Planner', subtitle: 'Are you on track to retire?', icon: PiggyBank },
  { id: 'goals-planner', name: 'Savings Goals', subtitle: 'Track and plan your savings goals', icon: Target },
  { id: 'debt-payoff', name: 'Debt Payoff', subtitle: 'See your path to debt freedom', icon: TrendingDown },
  { id: 'emergency-fund', name: 'Emergency Fund Analysis', subtitle: 'Are you prepared for the unexpected?', icon: Shield },
  { id: 'life-insurance', name: 'Life Insurance Analysis', subtitle: 'Is your family protected?', icon: Heart },
  { id: 'tax-withholding', name: 'Tax Withholding', subtitle: 'Optimize your W-4 withholding', icon: FileText },
  { id: 'mortgage', name: 'Mortgage Calculator', subtitle: 'How much home can you afford?', icon: Home },
  { id: 'car-loan', name: 'Car Loan', subtitle: 'Calculate your true cost of ownership', icon: Car },
];

export function FinancialToolsView({ onBack, onSelectTool, householdId }: FinancialToolsViewProps) {
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

  const profileStatus = useMemo((): ToolStatus => {
    const { complete } = getProfileCompleteness(financialProfile);
    return complete ? { label: 'Complete ✓', color: 'green' } : { label: 'Incomplete', color: 'red' };
  }, [financialProfile]);

  const { complete: profileComplete, filled, total } = useMemo(() => getProfileCompleteness(financialProfile), [financialProfile]);

  const getStatus = (toolId: ToolId): ToolStatus => {
    const ts = toolStates;
    switch (toolId) {
      case 'health-score': {
        const s = ts['financial-health-score'];
        if (!s) return { label: 'Not Set Up', color: 'grey' };
        // Health score is recalculated live, but if tool state exists it's been viewed
        return { label: 'Reviewed ✓', color: 'gold' };
      }
      case 'retirement': {
        const s = ts['retirement-planner'];
        if (!s) return { label: 'Not Set Up', color: 'grey' };
        // Check for gap/surplus in saved state
        if (s.retirementAge) {
          return { label: 'Reviewed ✓', color: 'gold' };
        }
        return { label: 'Not Set Up', color: 'grey' };
      }
      case 'goals-planner': {
        const s = ts['goals-planner'];
        if (!s || !s.goals || !Array.isArray(s.goals) || s.goals.length === 0) return { label: 'Not Set Up', color: 'grey' };
        const goals = s.goals.filter((g: any) => g.name && g.targetAmount);
        if (goals.length === 0) return { label: 'Not Set Up', color: 'grey' };
        // Calculate on-track count
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
      case 'debt-payoff': {
        if (!financialProfile) return { label: 'Not Set Up', color: 'grey' };
        const debts: any[] = Array.isArray(financialProfile.debts) ? financialProfile.debts : [];
        if (debts.length === 0) return { label: 'Debt Free', color: 'green' };
        const members: any[] = Array.isArray(financialProfile.member_incomes) ? financialProfile.member_incomes : [];
        const grossMonthly = members.reduce((s: number, m: any) => s + (Number(m.gross_income) || 0), 0) / 12;
        const debtPayments = debts.reduce((s: number, d: any) => s + (Number(d.minimum_payment) || 0), 0)
          + (Number(financialProfile.mortgage_payment) || 0);
        if (grossMonthly <= 0) return { label: 'Not Set Up', color: 'grey' };
        const dti = debtPayments / grossMonthly;
        if (dti > 0.43) return { label: 'High DTI', color: 'red' };
        return { label: 'On Track', color: 'green' };
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
      case 'tax-withholding': {
        const s = ts['tax-withholding'];
        if (!s) return { label: 'Not Set Up', color: 'grey' };
        // Check for withholding status if saved
        return { label: 'Reviewed ✓', color: 'gold' };
      }
      case 'mortgage': {
        const s = ts['mortgage-calculator'];
        if (!s) return { label: 'Not Set Up', color: 'grey' };
        return { label: 'Reviewed ✓', color: 'gold' };
      }
      case 'car-loan': {
        const s = ts['car-loan-calculator'];
        if (!s) return { label: 'Not Set Up', color: 'grey' };
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
          <div className="h-20 bg-muted rounded-xl" />
          <div className="h-16 bg-muted rounded-xl" />
          <div className="h-16 bg-muted rounded-xl" />
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto pb-32">
      {/* Header */}
      <div className="px-6 pt-12 safe-top flex items-center gap-3">
        <button onClick={onBack} className="p-1.5 -ml-1.5 rounded-lg hover:bg-muted">
          <ArrowLeft size={20} className="text-foreground" />
        </button>
        <div>
          <h1 className="font-display text-2xl lg:text-3xl font-bold tracking-tight text-foreground">Financial Insights & Calculators</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Your complete financial picture</p>
        </div>
      </div>

      {/* Financial Profile Banner */}
      <div className="px-6 mt-6">
        <button
          onClick={() => onSelectTool('cfp-profile')}
          className="w-full flex items-center gap-4 bg-primary rounded-xl p-4 shadow-md text-left active:scale-[0.98] transition-transform"
        >
          <div className={`w-11 h-11 rounded-full flex items-center justify-center flex-shrink-0 ${profileComplete ? 'bg-green-500/20' : 'bg-accent/20'}`}>
            {profileComplete ? <CheckCircle2 size={22} className="text-green-400" /> : <Shield size={22} className="text-accent" />}
          </div>
          <div className="flex-1 min-w-0">
            <p className={`text-sm font-bold ${profileComplete ? 'text-primary-foreground' : 'text-accent'}`}>
              {profileComplete ? 'Financial Profile — Up to date' : 'Complete your Financial Profile'}
            </p>
            <p className="text-xs text-primary-foreground/70 mt-0.5">
              {profileComplete ? 'Powering your personalized insights' : 'Required for personalized insights'}
            </p>
            {!profileComplete && (
              <div className="flex items-center gap-2 mt-2">
                <div className="flex-1 h-1.5 bg-primary-foreground/10 rounded-full overflow-hidden">
                  <div className="h-full bg-accent rounded-full transition-all" style={{ width: `${(filled / total) * 100}%` }} />
                </div>
                <span className="text-[10px] text-primary-foreground/60 font-medium">{filled} of {total}</span>
              </div>
            )}
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {statusBadge(profileStatus)}
            <ChevronRight size={16} className="text-accent" />
          </div>
        </button>
      </div>

      {/* Tool List */}
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

      {/* Disclaimer */}
      <div className="px-6 mt-6 mb-8 flex gap-2">
        <Info size={14} className="text-muted-foreground shrink-0 mt-0.5" />
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          These tools provide general financial estimates powered by AI and standard planning guidelines. Results are for educational purposes only and may not reflect your complete financial picture. For personalized advice, consult a Certified Financial Planner (CFP®) professional or CPA.
        </p>
      </div>
    </div>
  );
}
