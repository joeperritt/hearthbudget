import { useState, useEffect, useMemo } from 'react';
import { Shield, PiggyBank, Target, TrendingDown, Home, Heart, ChevronRight, CheckCircle2, Info } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

type InsightToolId = 'mortgage-analyzer' | 'debt-payoff' | 'life-insurance' | 'emergency-fund' | 'savings-goals' | 'retirement';

interface PlanViewProps {
  householdId: string | null;
  onNavigate: (target: string) => void;
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
  disabled?: boolean;
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

export function PlanView({ householdId, onNavigate }: PlanViewProps) {
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

  const { complete: profileComplete, filled, total } = useMemo(() => getProfileCompleteness(financialProfile), [financialProfile]);
  const profileStatus: ToolStatus = profileComplete ? { label: 'Complete ✓', color: 'green' } : { label: 'Incomplete', color: 'red' };

  const getInsightStatus = (toolId: InsightToolId): ToolStatus => {
    const ts = toolStates;
    const fp = financialProfile;

    switch (toolId) {
      case 'mortgage-analyzer': {
        if (!fp) return { label: 'Not Set Up', color: 'grey' };
        const ht = fp.housing_type;
        if (ht === 'rent' || ht === 'own-no-mortgage') return { label: 'N/A', color: 'grey', disabled: true };
        const s = ts['mortgage-calculator'];
        if (!s || !s.exCurrentBalance) return { label: 'Not Set Up', color: 'grey' };
        if (s.goalPayoffDate) {
          // Check if on track
          const rate = Number(s.exInterestRate || fp.mortgage_rate) || 0;
          const balance = Number(fp.mortgage_balance || s.exCurrentBalance) || 0;
          const pi = Number(fp.mortgage_payment || s.exMonthlyPayment) || 0;
          const extra = Number(s.extraPayment) || 0;
          const totalPmt = pi + extra;
          if (rate > 0 && totalPmt > 0) {
            const monthlyRate = rate / 100 / 12;
            const monthsRemaining = Math.ceil(-Math.log(1 - (monthlyRate * balance) / totalPmt) / Math.log(1 + monthlyRate));
            const projectedDate = new Date();
            projectedDate.setMonth(projectedDate.getMonth() + monthsRemaining);
            const goalDate = new Date(s.goalPayoffDate);
            return projectedDate <= goalDate
              ? { label: 'On Track', color: 'green' }
              : { label: 'Off Track', color: 'red' };
          }
        }
        return { label: 'Reviewed ✓', color: 'gold' };
      }
      case 'debt-payoff': {
        if (!fp) return { label: 'Not Set Up', color: 'grey' };
        const debts: any[] = Array.isArray(fp.debts) ? fp.debts : [];
        if (debts.length === 0) return { label: 'N/A', color: 'grey', disabled: true };
        const s = ts['debt-payoff'];
        if (!s) return { label: 'Not Set Up', color: 'grey' };
        if (s.goalDebtFreeDate) {
          // Simple check: calculate total months to pay off
          const totalMinPayment = debts.reduce((sum: number, d: any) => sum + (Number(d.monthlyPayment) || Number(d.minimum_payment) || 0), 0);
          const totalExtra = debts.reduce((sum: number, d: any) => sum + (Number(d.extra_payment) || 0), 0) + (Number(s.additionalExtra) || 0);
          const totalBalance = debts.reduce((sum: number, d: any) => sum + (Number(d.balance) || 0), 0);
          const monthlyTotal = totalMinPayment + totalExtra;
          if (monthlyTotal > 0 && totalBalance > 0) {
            const roughMonths = totalBalance / monthlyTotal;
            const projectedDate = new Date();
            projectedDate.setMonth(projectedDate.getMonth() + Math.ceil(roughMonths));
            const goalDate = new Date(s.goalDebtFreeDate);
            return projectedDate <= goalDate
              ? { label: 'On Track', color: 'green' }
              : { label: 'Off Track', color: 'red' };
          }
        }
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
        // Check for gap
        if (s.monthlyGap !== undefined) {
          return Number(s.monthlyGap) >= 0
            ? { label: 'On Track', color: 'green' }
            : { label: 'Gap Detected', color: 'red' };
        }
        return { label: 'Reviewed ✓', color: 'gold' };
      }
      default:
        return { label: 'Not Set Up', color: 'grey' };
    }
  };

  const insightTools: { id: InsightToolId; name: string; subtitle: string; icon: typeof Shield }[] = [
    { id: 'mortgage-analyzer', name: 'Mortgage Analyzer', subtitle: 'Analyze your current mortgage', icon: Home },
    { id: 'debt-payoff', name: 'Debt Payoff Analyzer', subtitle: 'See your path to debt freedom', icon: TrendingDown },
    { id: 'retirement', name: 'Retirement Planner', subtitle: 'Are you on track to retire?', icon: PiggyBank },
    { id: 'life-insurance', name: 'Life Insurance Analysis', subtitle: 'Is your family protected?', icon: Heart },
    { id: 'emergency-fund', name: 'Emergency Fund Analysis', subtitle: 'Are you prepared for the unexpected?', icon: Shield },
    { id: 'savings-goals', name: 'Savings Goals', subtitle: 'Track and plan your savings goals', icon: Target },
  ];

  if (loading) {
    return (
      <div className="max-w-lg mx-auto px-6 pt-12 safe-top">
        <div className="animate-pulse space-y-4">
          <div className="h-6 bg-muted rounded w-2/3" />
          <div className="h-20 bg-muted rounded-xl" />
          <div className="h-16 bg-muted rounded-xl" />
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto pb-32">
      {/* Header */}
      <div className="px-6 pt-12 safe-top">
        <h1 className="font-display text-xl font-bold text-foreground">Financial Plan</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Your complete financial picture</p>
      </div>

      {/* Financial Profile Banner */}
      <div className="px-6 mt-6">
        <button
          onClick={() => onNavigate('financial-profile')}
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

      {/* Financial Insights — inline list */}
      <div className="px-6 mt-6">
        <h2 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-3">Financial Insights</h2>
        <div className="space-y-2">
          {insightTools.map(tool => {
            const status = getInsightStatus(tool.id);
            const isDisabled = status.disabled;
            return (
              <button
                key={tool.id}
                onClick={() => !isDisabled && onNavigate(tool.id)}
                disabled={isDisabled}
                className={`w-full flex items-center gap-3 bg-card rounded-xl p-3.5 shadow-sm text-left transition-transform ${
                  isDisabled ? 'opacity-50 cursor-not-allowed' : 'active:scale-[0.98]'
                }`}
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
