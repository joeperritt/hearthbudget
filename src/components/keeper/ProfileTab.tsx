import { useState } from 'react';
import {
  LogOut, Building2, BarChart3, Calculator, ShieldCheck,
  ChevronRight, Loader2, RotateCcw, CalendarDays, Users, Compass,
} from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader,
  AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';

// Email allowlist for the "Reset onboarding" dev tool. Hardcoded on purpose:
// this button must NOT be gated by general admin role — only this single
// test inbox should ever see it.
const RESET_ONBOARDING_ALLOWLIST = new Set<string>([
  'joeperritt31+test@gmail.com',
]);

export type ProfileTabSelection =
  | 'manage-users'
  | 'financial-profile'
  | 'bank-connections'
  | 'security'
  | 'budget-setup'
  | 'plan-tools'
  | 'calculators'
  | 'trends'
  // Plan tools surfaced as deep-links from PlanToolsView:
  | 'emergency-fund'
  | 'savings-goals'
  | 'retirement'
  | 'mortgage-analyzer'
  | 'debt-payoff'
  | 'life-insurance';

interface ProfileTabProps {
  onSelect: (target: ProfileTabSelection, profileTabHint?: string) => void;
  householdId: string | null;
}

export function ProfileTab({ onSelect, householdId }: ProfileTabProps) {
  const { signOut, profile, user } = useAuth();
  const canResetOnboarding = !!user?.email && RESET_ONBOARDING_ALLOWLIST.has(user.email.toLowerCase());
  const [resettingOnboarding, setResettingOnboarding] = useState(false);

  const handleResetOnboarding = async () => {
    if (!householdId) return;
    setResettingOnboarding(true);
    try {
      const { error: hhErr } = await supabase
        .from('households')
        .update({ onboarding_completed: false })
        .eq('id', householdId);
      if (hhErr) throw hhErr;

      await Promise.all([
        supabase.from('budget_categories').delete().eq('household_id', householdId),
        supabase.from('fixed_expenses').delete().eq('household_id', householdId),
        supabase.from('budget_transfers').delete().eq('household_id', householdId),
        supabase.from('budget_month_snapshots').delete().eq('household_id', householdId),
        supabase.from('category_bucket_map').delete().eq('household_id', householdId),
        supabase.from('tool_states').delete().eq('household_id', householdId).eq('tool_name', 'onboarding'),
      ]);

      toast.success('Onboarding reset. Reload to walk through the flow.');
    } catch (e) {
      console.error(e);
      toast.error('Could not reset onboarding');
    } finally {
      setResettingOnboarding(false);
    }
  };

  return (
    <div className="max-w-lg mx-auto pb-12">
      <div className="px-6 pt-12 safe-top">
        <h1 className="font-display text-2xl lg:text-3xl font-bold tracking-tight text-foreground">More</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Household, budget setup, planning tools, and settings</p>
      </div>

      <div className="px-6 mt-6 space-y-3">
        <Tile
          accent="neutral"
          icon={Users}
          title="Manage Users"
          subtitle="Members, display names, household settings, invites"
          onClick={() => onSelect('manage-users')}
        />

        <Tile
          accent="yellow"
          icon={CalendarDays}
          title="Budget Setup"
          subtitle="Take-home, categories, fixed bills, savings, giving"
          onClick={() => onSelect('budget-setup')}
        />

        <Tile
          accent="primary"
          icon={Compass}
          title="Personal Financial Planning Tools"
          subtitle="Profile-driven tools for the long-term picture"
          onClick={() => onSelect('plan-tools')}
        />

        <Tile
          accent="neutral"
          icon={Building2}
          title="Bank Accounts"
          subtitle="Linked banks, sync, and cardholder mapping"
          onClick={() => onSelect('bank-connections')}
        />

        <Tile
          accent="neutral"
          icon={ShieldCheck}
          title="Security"
          subtitle="Password, MFA, trusted devices"
          onClick={() => onSelect('security')}
        />

        <Tile
          accent="neutral"
          icon={Calculator}
          title="Calculators"
          subtitle="Generic financial calculators"
          onClick={() => onSelect('calculators')}
        />

        <Tile
          accent="neutral"
          icon={BarChart3}
          title="Trends"
          subtitle="Month over month spending comparison"
          onClick={() => onSelect('trends')}
        />
      </div>

      {/* Dev: Reset Onboarding (test account only) */}
      {canResetOnboarding && (
        <div className="px-6 mt-10">
          <h2 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-3">Developer</h2>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <button
                className="w-full flex items-center gap-4 bg-card rounded-lg p-4 shadow-sm text-left active:scale-[0.98] transition-transform border border-amber-400/40"
                disabled={resettingOnboarding}
              >
                <div className="w-10 h-10 rounded-full bg-amber-400/15 flex items-center justify-center">
                  {resettingOnboarding
                    ? <Loader2 size={20} className="text-amber-600 animate-spin" />
                    : <RotateCcw size={20} className="text-amber-600" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-foreground">Reset onboarding</p>
                  <p className="text-xs text-muted-foreground">Replays the welcome flow on next reload</p>
                </div>
              </button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Reset onboarding for this household?</AlertDialogTitle>
                <AlertDialogDescription>
                  This flips your household back to "not onboarded" and clears any
                  onboarding-specific saved state. Your transactions, accounts, budgets,
                  and profile data are NOT touched. Reload after confirming to walk
                  through the flow again.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={handleResetOnboarding}>Reset</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      )}

      {/* Log Out */}
      <div className="px-6 mt-10 pb-6">
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

function Tile({
  accent, icon: Icon, title, subtitle, onClick,
}: {
  accent: 'neutral' | 'yellow' | 'primary';
  icon: typeof Users;
  title: string;
  subtitle: string;
  onClick: () => void;
}) {
  const styles = {
    neutral: { border: 'border-border', chip: 'bg-primary/10 text-primary' },
    yellow: { border: 'border-amber-400', chip: 'bg-amber-400/15 text-amber-600' },
    primary: { border: 'border-primary', chip: 'bg-primary/10 text-primary' },
  }[accent];

  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 bg-card rounded-xl p-4 shadow-sm text-left active:scale-[0.98] transition-transform border-l-4 ${styles.border}`}
    >
      <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${styles.chip}`}>
        <Icon size={20} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-foreground">{title}</p>
        <p className="text-xs text-muted-foreground truncate">{subtitle}</p>
      </div>
      <ChevronRight size={16} className="text-muted-foreground shrink-0" />
    </button>
  );
}
