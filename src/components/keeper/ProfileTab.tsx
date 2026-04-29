import { useEffect, useState } from 'react';
import {
  LogOut, Building2, Sparkles, BarChart3, Calculator, ShieldCheck,
  Heart, Baby, PawPrint, ChevronRight, User as UserIcon, Loader2,
  RotateCcw,
} from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useHouseholdFlags } from '@/hooks/useHouseholdFlags';
import { Switch } from '@/components/ui/switch';
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
  | 'financial-profile'
  | 'bank-connections'
  | 'security'
  | 'ai-advisor'
  | 'calculators'
  | 'trends';

interface ProfileTabProps {
  onSelect: (target: ProfileTabSelection) => void;
  householdId: string | null;
}

export function ProfileTab({ onSelect, householdId }: ProfileTabProps) {
  const { signOut, profile, user } = useAuth();
  const { flags, loading: flagsLoading, updateFlag } = useHouseholdFlags(householdId);
  const canResetOnboarding = !!user?.email && RESET_ONBOARDING_ALLOWLIST.has(user.email.toLowerCase());
  const [resettingOnboarding, setResettingOnboarding] = useState(false);

  const handleResetOnboarding = async () => {
    if (!householdId) return;
    setResettingOnboarding(true);
    try {
      // Flip the household back to un-onboarded.
      const { error: hhErr } = await supabase
        .from('households')
        .update({ onboarding_completed: false })
        .eq('id', householdId);
      if (hhErr) throw hhErr;

      // Clear onboarding-specific tool state if present (no-op if absent).
      await supabase
        .from('tool_states')
        .delete()
        .eq('household_id', householdId)
        .eq('tool_name', 'onboarding');

      toast.success('Onboarding reset. Reload to walk through the flow.');
    } catch (e) {
      console.error(e);
      toast.error('Could not reset onboarding');
    } finally {
      setResettingOnboarding(false);
    }
  };

  const [displayName, setDisplayName] = useState(profile?.display_name ?? '');
  const [savingName, setSavingName] = useState(false);
  useEffect(() => {
    setDisplayName(profile?.display_name ?? '');
  }, [profile?.display_name]);

  const saveDisplayName = async () => {
    const trimmed = displayName.trim();
    if (!profile?.id || !trimmed || trimmed === profile.display_name) return;
    setSavingName(true);
    const { error } = await supabase
      .from('profiles')
      .update({ display_name: trimmed })
      .eq('id', profile.id);
    setSavingName(false);
    if (error) {
      toast.error('Could not update name');
      setDisplayName(profile.display_name ?? '');
    } else {
      toast.success('Name updated');
    }
  };

  const handleToggle = async (key: 'stewardship_mode' | 'has_kids' | 'has_pets', value: boolean) => {
    try {
      await updateFlag(key, value);
    } catch {
      toast.error('Could not save change');
    }
  };

  return (
    <div className="max-w-lg mx-auto">
      <div className="px-6 pt-12 safe-top">
        <h1 className="font-display text-2xl lg:text-3xl font-bold tracking-tight text-foreground">Profile</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Settings, household, and connections</p>
      </div>

      {/* Identity */}
      <div className="px-6 mt-6">
        <div className="bg-card rounded-xl shadow-sm p-4">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-full bg-primary flex items-center justify-center">
              <span className="text-primary-foreground font-display text-base font-bold">
                {profile?.avatar_initial || 'U'}
              </span>
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">Display name</p>
              <input
                type="text"
                value={displayName}
                onChange={e => setDisplayName(e.target.value)}
                onBlur={saveDisplayName}
                placeholder="Your name"
                className="w-full text-sm font-semibold text-foreground bg-transparent outline-none border-b border-transparent focus:border-amber-400 transition-colors py-0.5"
              />
            </div>
            {savingName && <Loader2 className="w-4 h-4 text-muted-foreground animate-spin" />}
          </div>
        </div>
      </div>

      {/* Household preferences */}
      <div className="px-6 mt-6">
        <h2 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-3">Household</h2>
        <div className="bg-card rounded-xl shadow-sm divide-y divide-border">
          <FlagRow
            icon={Heart}
            label="Stewardship Mode"
            help="Faith-informed framing across the AI advisor and the spending analyzer (10% giving guideline, gentler tone)."
            checked={flags.stewardship_mode}
            disabled={flagsLoading}
            onChange={v => handleToggle('stewardship_mode', v)}
          />
          <FlagRow
            icon={Baby}
            label="We have kids"
            help="Keeps the Kids bucket relevant in the analyzer."
            checked={flags.has_kids}
            disabled={flagsLoading}
            onChange={v => handleToggle('has_kids', v)}
          />
          <FlagRow
            icon={PawPrint}
            label="We have pets"
            help="Keeps the Pets bucket relevant in the analyzer."
            checked={flags.has_pets}
            disabled={flagsLoading}
            onChange={v => handleToggle('has_pets', v)}
          />
        </div>
      </div>

      {/* Plan & connections */}
      <div className="px-6 mt-6 space-y-3">
        <Tile
          icon={UserIcon}
          color="primary"
          title="Financial Profile"
          subtitle="Income, housing, debts, accounts, insurance"
          onClick={() => onSelect('financial-profile')}
        />
        <Tile
          icon={Building2}
          color="primary"
          title="Accounts & Connections"
          subtitle="Manage users & linked bank accounts"
          onClick={() => onSelect('bank-connections')}
        />
        <Tile
          icon={ShieldCheck}
          color="primary"
          title="Security"
          subtitle="Password, MFA, signed-in devices"
          onClick={() => onSelect('security')}
        />
      </div>

      {/* Other tools */}
      <div className="px-6 mt-6 space-y-3">
        <h2 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1">Tools</h2>
        <Tile
          icon={Sparkles}
          color="accent"
          title="AI Advisor"
          subtitle="Personalized budget insights & chat"
          onClick={() => onSelect('ai-advisor')}
        />
        <Tile
          icon={Calculator}
          color="primary"
          title="Calculators"
          subtitle="Generic financial calculators"
          onClick={() => onSelect('calculators')}
        />
        <Tile
          icon={BarChart3}
          color="primary"
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

function FlagRow({
  icon: Icon, label, help, checked, disabled, onChange,
}: {
  icon: typeof Heart;
  label: string;
  help: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start gap-3 p-4">
      <div className="w-9 h-9 rounded-full bg-muted flex items-center justify-center shrink-0 mt-0.5">
        <Icon size={18} className="text-foreground/80" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-foreground">{label}</p>
        <p className="text-[11px] text-muted-foreground leading-snug mt-0.5">{help}</p>
      </div>
      <Switch
        checked={checked}
        disabled={disabled}
        onCheckedChange={onChange}
        className="mt-1 shrink-0"
      />
    </div>
  );
}

function Tile({
  icon: Icon, color, title, subtitle, onClick,
}: {
  icon: typeof Heart;
  color: 'primary' | 'accent';
  title: string;
  subtitle: string;
  onClick: () => void;
}) {
  const bg = color === 'accent' ? 'bg-accent/10' : 'bg-primary/10';
  const fg = color === 'accent' ? 'text-accent' : 'text-primary';
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-4 bg-card rounded-lg p-4 shadow-sm text-left active:scale-[0.98] transition-transform"
    >
      <div className={`w-10 h-10 rounded-full ${bg} flex items-center justify-center`}>
        <Icon size={20} className={fg} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-foreground">{title}</p>
        <p className="text-xs text-muted-foreground">{subtitle}</p>
      </div>
      <ChevronRight size={16} className="text-muted-foreground shrink-0" />
    </button>
  );
}
