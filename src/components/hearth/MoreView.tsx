import { useState, useEffect } from 'react';
import { LogOut, Building2, Sparkles, BarChart3, Calculator, Shield, CheckCircle2, ChevronRight, Lock } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';

type MoreTab = 'settings' | 'bank-connections' | 'ai-advisor' | 'trends' | 'financial-tools' | 'cfp-profile';

interface MoreViewProps {
  onSelect: (tab: MoreTab) => void;
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
  if (debts.length > 0 || filled >= 3) filled++; // debts section visited
  if (profile.has_life_insurance !== null) filled++; // insurance section visited
  return { complete: filled >= total, filled, total };
}

export function MoreView({ onSelect, householdId }: MoreViewProps) {
  const { signOut, profile } = useAuth();
  const [financialProfile, setFinancialProfile] = useState<any>(null);
  const [fpLoading, setFpLoading] = useState(true);

  useEffect(() => {
    if (!householdId) { setFpLoading(false); return; }
    supabase
      .from('financial_profiles')
      .select('*')
      .eq('household_id', householdId)
      .maybeSingle()
      .then(({ data }) => {
        if (data) setFinancialProfile(data);
        setFpLoading(false);
      });
  }, [householdId]);

  const { complete, filled, total } = getProfileCompleteness(financialProfile);
  const toolsUnlocked = complete;

  return (
    <div className="max-w-lg mx-auto">
      <div className="px-6 pt-12 safe-top">
        <h1 className="font-display text-xl font-bold text-foreground">More</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Tools & settings</p>
      </div>

      {/* Financial Profile Banner */}
      <div className="px-6 mt-6">
        {fpLoading ? (
          <div className="w-full bg-primary rounded-xl p-4 animate-pulse">
            <div className="h-4 bg-primary-foreground/20 rounded w-2/3 mb-2" />
            <div className="h-3 bg-primary-foreground/10 rounded w-1/2" />
          </div>
        ) : complete ? (
          <button
            onClick={() => onSelect('cfp-profile')}
            className="w-full flex items-center gap-4 bg-primary rounded-xl p-4 shadow-md text-left active:scale-[0.98] transition-transform"
          >
            <div className="w-11 h-11 rounded-full bg-green-500/20 flex items-center justify-center flex-shrink-0">
              <CheckCircle2 size={22} className="text-green-400" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-primary-foreground">Financial Profile — Up to date</p>
              <p className="text-xs text-primary-foreground/70 mt-0.5">Powering your personalized insights</p>
            </div>
            <span className="text-xs text-accent font-semibold flex-shrink-0">Edit</span>
          </button>
        ) : (
          <button
            onClick={() => onSelect('cfp-profile')}
            className="w-full flex items-center gap-4 bg-primary rounded-xl p-4 shadow-md text-left active:scale-[0.98] transition-transform"
          >
            <div className="w-11 h-11 rounded-full bg-accent/20 flex items-center justify-center flex-shrink-0">
              <Shield size={22} className="text-accent" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-accent">Complete your Financial Profile</p>
              <p className="text-xs text-primary-foreground/70 mt-0.5">Required for personalized insights</p>
              <div className="flex items-center gap-2 mt-2">
                <div className="flex-1 h-1.5 bg-primary-foreground/10 rounded-full overflow-hidden">
                  <div className="h-full bg-accent rounded-full transition-all" style={{ width: `${(filled / total) * 100}%` }} />
                </div>
                <span className="text-[10px] text-primary-foreground/60 font-medium">{filled} of {total}</span>
              </div>
            </div>
            <ChevronRight size={18} className="text-accent flex-shrink-0" />
          </button>
        )}
      </div>

      <div className="px-6 mt-4 space-y-3">
        <button
          onClick={() => onSelect('ai-advisor')}
          className="w-full flex items-center gap-4 bg-card rounded-lg p-4 shadow-sm text-left active:scale-[0.98] transition-transform"
        >
          <div className="w-10 h-10 rounded-full bg-accent/10 flex items-center justify-center">
            <Sparkles size={20} className="text-accent" />
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground">AI Advisor</p>
            <p className="text-xs text-muted-foreground">Personalized budget insights & chat</p>
          </div>
        </button>

        <button
          onClick={() => toolsUnlocked ? onSelect('financial-tools') : onSelect('cfp-profile')}
          className={`w-full flex items-center gap-4 bg-card rounded-lg p-4 shadow-sm text-left transition-transform ${
            toolsUnlocked ? 'active:scale-[0.98]' : 'opacity-60'
          }`}
        >
          <div className={`w-10 h-10 rounded-full flex items-center justify-center ${toolsUnlocked ? 'bg-primary/10' : 'bg-muted'}`}>
            {toolsUnlocked ? (
              <Calculator size={20} className="text-primary" />
            ) : (
              <Lock size={20} className="text-muted-foreground" />
            )}
          </div>
          <div>
            <p className={`text-sm font-semibold ${toolsUnlocked ? 'text-foreground' : 'text-muted-foreground'}`}>Financial Tools</p>
            <p className="text-xs text-muted-foreground">
              {toolsUnlocked ? 'Calculators powered by your real data' : 'Complete your Financial Profile to unlock'}
            </p>
          </div>
        </button>

        <button
          onClick={() => onSelect('trends')}
          className="w-full flex items-center gap-4 bg-card rounded-lg p-4 shadow-sm text-left active:scale-[0.98] transition-transform"
        >
          <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
            <BarChart3 size={20} className="text-primary" />
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground">Trends</p>
            <p className="text-xs text-muted-foreground">Month over month spending comparison</p>
          </div>
        </button>

        <button
          onClick={() => onSelect('bank-connections')}
          className="w-full flex items-center gap-4 bg-card rounded-lg p-4 shadow-sm text-left active:scale-[0.98] transition-transform"
        >
          <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
            <Building2 size={20} className="text-primary" />
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground">Accounts & Connections</p>
            <p className="text-xs text-muted-foreground">Manage users & linked bank accounts</p>
          </div>
        </button>
      </div>

      {/* Log Out */}
      <div className="px-6 mt-10">
        <button
          onClick={signOut}
          className="w-full flex items-center gap-4 bg-card rounded-lg p-4 shadow-sm text-left active:scale-[0.98] transition-transform border border-border"
        >
          <div className="w-10 h-10 rounded-full bg-destructive/10 flex items-center justify-center">
            <LogOut size={20} className="text-destructive" />
          </div>
          <div>
            <p className="text-sm font-semibold text-destructive">Log Out</p>
            <p className="text-xs text-muted-foreground">Signed in as {profile?.display_name || 'User'}</p>
          </div>
        </button>
      </div>
    </div>
  );
}
