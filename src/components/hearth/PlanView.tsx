import { useState, useEffect, useMemo } from 'react';
import { Shield, PiggyBank, Target, TrendingDown, Home, Heart, ChevronRight, CheckCircle2, Info } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { format } from 'date-fns';

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

export function PlanView({ householdId, onNavigate }: PlanViewProps) {
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

  const isToolDisabled = (toolId: InsightToolId): boolean => {
    const fp = financialProfile;
    if (toolId === 'mortgage-analyzer') {
      if (!fp) return false;
      const ht = fp.housing_type;
      return ht === 'rent' || ht === 'own-no-mortgage';
    }
    if (toolId === 'debt-payoff') {
      if (!fp) return false;
      const debts = Array.isArray(fp.debts) ? fp.debts : [];
      return debts.length === 0;
    }
    return false;
  };

  const getDisabledReason = (toolId: InsightToolId): string | null => {
    if (toolId === 'mortgage-analyzer' && isToolDisabled(toolId)) return 'N/A';
    if (toolId === 'debt-payoff' && isToolDisabled(toolId)) return 'N/A';
    return null;
  };

  const insightTools: { id: InsightToolId; name: string; subtitle: string; icon: typeof Shield }[] = [
    { id: 'mortgage-analyzer', name: 'Mortgage Analyzer', subtitle: 'Analyze your current mortgage', icon: Home },
    { id: 'debt-payoff', name: 'Debt Payoff Analyzer', subtitle: 'See your path to debt freedom', icon: TrendingDown },
    { id: 'retirement', name: 'Retirement Planner', subtitle: 'Are you on track to retire?', icon: PiggyBank },
    { id: 'life-insurance', name: 'Life Insurance Analysis', subtitle: 'Is your family protected?', icon: Heart },
    { id: 'emergency-fund', name: 'Emergency Fund Analysis', subtitle: 'Are you prepared for the unexpected?', icon: Shield },
    { id: 'savings-goals', name: 'Savings Goals', subtitle: 'Track and plan your savings goals', icon: Target },
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
                  <div className="h-full bg-accent rounded-full transition-all" style={{ width: `${profilePct}%` }} />
                </div>
                <span className="text-[10px] text-primary-foreground/60 font-medium">{filled} of {total}</span>
              </div>
            )}
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <span className="text-[10px] text-primary-foreground/60 font-medium whitespace-nowrap">
              {profilePct}% complete{profileUpdated ? ` · ${formatLastVisited(profileUpdated)}` : ''}
            </span>
            <ChevronRight size={16} className="text-accent" />
          </div>
        </button>
      </div>

      {/* Financial Insights — inline list */}
      <div className="px-6 mt-6">
        <h2 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-3">Financial Insights</h2>
        <div className="space-y-2">
          {insightTools.map(tool => {
            const disabled = isToolDisabled(tool.id);
            const disabledReason = getDisabledReason(tool.id);
            const lastVisited = getLastVisited(tool.id);
            return (
              <button
                key={tool.id}
                onClick={() => handleToolNavigate(tool.id)}
                disabled={disabled}
                className={`w-full flex items-center gap-3 bg-card rounded-xl p-3.5 shadow-sm text-left transition-transform ${
                  disabled ? 'opacity-50 cursor-not-allowed' : 'active:scale-[0.98]'
                }`}
              >
                <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <tool.icon size={18} className="text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-foreground leading-tight">{tool.name}</p>
                  <p className="text-xs text-muted-foreground mt-0.5 leading-snug truncate">{tool.subtitle}</p>
                </div>
                {disabled && disabledReason ? (
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
