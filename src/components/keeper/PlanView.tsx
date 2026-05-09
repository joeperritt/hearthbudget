import { useState, useEffect, useMemo } from 'react';
import { Shield, PiggyBank, Target, TrendingDown, Home, Heart, ChevronRight, CheckCircle2, Info, Lock, ArrowLeft } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { format } from 'date-fns';

type InsightToolId = 'mortgage-analyzer' | 'debt-payoff' | 'life-insurance' | 'emergency-fund' | 'savings-goals' | 'retirement';

interface PlanViewProps {
  householdId: string | null;
  onNavigate: (target: string) => void;
  onBack?: () => void;
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

// Map tool IDs to tool_states tool_name keys
const TOOL_STATE_KEY: Record<InsightToolId, string> = {
  'mortgage-analyzer': 'mortgage-calculator',
  'debt-payoff': 'debt-payoff',
  'retirement': 'retirement-planner',
  'life-insurance': 'life-insurance',
  'emergency-fund': 'emergency-fund',
  'savings-goals': 'goals-planner',
};

function formatLastVisited(dateStr: string | undefined): string {
  if (!dateStr) return 'Not yet visited';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return 'Not yet visited';
    return format(d, 'MMM d');
  } catch {
    return 'Not yet visited';
  }
}

export function PlanView({ householdId, onNavigate, onBack }: PlanViewProps) {
  const [financialProfile, setFinancialProfile] = useState<any>(null);
  const [toolStates, setToolStates] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!householdId) { setLoading(false); return; }
    Promise.all([
      supabase.from('financial_profiles').select('*').eq('household_id', householdId).maybeSingle(),
      supabase.from('tool_states').select('tool_name, state_json, updated_at').eq('household_id', householdId),
    ]).then(([fpRes, tsRes]) => {
      if (fpRes.data) setFinancialProfile(fpRes.data);
      const states: Record<string, any> = {};
      ((tsRes.data as any[]) || []).forEach((r: any) => {
        states[r.tool_name] = { ...r.state_json, _updated_at: r.updated_at };
      });
      setToolStates(states);
      setLoading(false);
    });
  }, [householdId]);

  const { complete: profileComplete, filled, total } = useMemo(() => getProfileCompleteness(financialProfile), [financialProfile]);
  const profilePct = Math.round((filled / total) * 100);
  const profileUpdated = financialProfile?.updated_at;

  const getLastVisited = (toolId: InsightToolId): string => {
    const key = TOOL_STATE_KEY[toolId];
    const ts = toolStates[key];
    if (!ts) return 'Not yet visited';
    const lv = ts.last_visited_at || ts._updated_at;
    return formatLastVisited(lv);
  };

  const hasIncome = (() => {
    const fp = financialProfile;
    if (!fp) return false;
    const incomes = Array.isArray(fp.member_incomes) ? fp.member_incomes : [];
    return incomes.some((m: any) => (Number(m.gross_income) || 0) > 0);
  })();

  const isToolDisabled = (toolId: InsightToolId): boolean => {
    const fp = financialProfile;
    if (!fp) return true;
    if (toolId === 'debt-payoff') {
      const debts = Array.isArray(fp.debts) ? fp.debts : [];
      return debts.length === 0;
    }
    if (toolId === 'retirement') {
      // Needs income to model contributions and replacement targets
      return !hasIncome;
    }
    if (toolId === 'mortgage-analyzer') {
      // Only meaningful if the household owns and has mortgage data populated
      if (fp.housing_type !== 'own') return true;
      return !(Number(fp.mortgage_balance) > 0 && Number(fp.mortgage_payment) > 0);
    }
    if (toolId === 'life-insurance') {
      // Income Replacement / DIME both need income
      return !hasIncome;
    }
    if (toolId === 'emergency-fund') {
      // Target months are derived from income + housing
      return !hasIncome || !fp.housing_type;
    }
    return false;
  };

  const getDisabledReason = (toolId: InsightToolId): string | null => {
    if (!isToolDisabled(toolId)) return null;
    if (toolId === 'debt-payoff') return 'N/A';
    return 'Locked';
  };

  const insightTools: { id: InsightToolId; name: string; subtitle: string; icon: typeof Shield }[] = [
    { id: 'emergency-fund', name: 'Emergency Fund Analysis', subtitle: 'Are you prepared for the unexpected?', icon: Shield },
    { id: 'savings-goals', name: 'Non-Retirement Goals', subtitle: 'Plan and track your non-retirement savings goals', icon: Target },
    { id: 'retirement', name: 'Retirement Planner', subtitle: 'Are you on track to retire?', icon: PiggyBank },
    { id: 'mortgage-analyzer', name: 'Mortgage Analyzer', subtitle: 'Analyze your current mortgage', icon: Home },
    { id: 'debt-payoff', name: 'Debt Payoff Analyzer', subtitle: 'See your path to debt freedom', icon: TrendingDown },
    { id: 'life-insurance', name: 'Life Insurance Analysis', subtitle: 'Is your family protected?', icon: Heart },
  ];

  // Record last_visited_at when navigating to a tool
  const handleToolNavigate = (toolId: InsightToolId) => {
    if (isToolDisabled(toolId)) return;
    // Fire and forget: update last_visited_at in tool_states
    if (householdId) {
      const toolName = TOOL_STATE_KEY[toolId];
      const existingState = toolStates[toolName] || {};
      const { _updated_at, ...cleanState } = existingState;
      const newState = { ...cleanState, last_visited_at: new Date().toISOString() };
      supabase
        .from('tool_states')
        .upsert(
          { household_id: householdId, tool_name: toolName, state_json: newState, updated_at: new Date().toISOString() },
          { onConflict: 'household_id,tool_name' }
        )
        .then(() => {});
    }
    onNavigate(toolId);
  };

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
        {onBack && (
          <button onClick={onBack} className="flex items-center gap-1 text-accent text-sm font-medium mb-3 active:scale-95 transition-transform">
            <ArrowLeft size={16} /> Back
          </button>
        )}
        <h1 className="font-display text-2xl lg:text-3xl font-bold tracking-tight text-foreground">Financial Plan</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Your complete financial picture</p>
      </div>

      {/* Financial Profile lives under More now. Keep a slim "Edit profile" link for convenience. */}
      {!profileComplete && (
        <div className="px-6 mt-6">
          <div className="bg-accent/10 border border-accent/30 rounded-xl p-3 flex items-center gap-3">
            <Shield size={18} className="text-accent shrink-0" />
            <p className="text-xs text-foreground flex-1">
              Some tools are locked until your Financial Profile is complete ({filled} of {total}).
            </p>
            <button
              onClick={() => onNavigate('financial-profile')}
              className="text-xs font-semibold text-accent whitespace-nowrap active:opacity-70"
            >
              Edit profile
            </button>
          </div>
        </div>
      )}

      {/* Financial Insights — inline list */}
      <div className="px-6 mt-6">
        <h2 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-3">Financial Insights</h2>
        <div className="space-y-2 lg:space-y-0 lg:grid lg:grid-cols-2 xl:grid-cols-3 lg:gap-4">
          {insightTools.map(tool => {
            const disabled = isToolDisabled(tool.id);
            const disabledReason = getDisabledReason(tool.id);
            const lastVisited = getLastVisited(tool.id);
            const isLocked = disabled && disabledReason === 'Locked';
            return (
              <button
                key={tool.id}
                onClick={() => handleToolNavigate(tool.id)}
                disabled={disabled}
                className={`w-full flex items-center gap-3 bg-card rounded-xl p-3.5 shadow-sm text-left transition-transform ${
                  disabled ? 'opacity-50 cursor-not-allowed pointer-events-none' : 'active:scale-[0.98]'
                }`}
              >
                <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <tool.icon size={18} className="text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-foreground leading-tight">{tool.name}</p>
                  <p className="text-xs text-muted-foreground mt-0.5 leading-snug truncate">
                    {isLocked ? 'Complete profile to unlock' : tool.subtitle}
                  </p>
                </div>
                {isLocked ? (
                  <Lock size={14} className="text-muted-foreground shrink-0" />
                ) : disabled && disabledReason ? (
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap bg-muted text-muted-foreground">
                    {disabledReason}
                  </span>
                ) : (
                  <span className="text-[10px] text-muted-foreground whitespace-nowrap">{lastVisited}</span>
                )}
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
