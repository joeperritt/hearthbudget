import { useEffect, useState } from 'react';
import {
  LogOut, Building2, Compass, BarChart3, Calculator, ShieldCheck,
  Heart, Baby, PawPrint, ChevronRight, ChevronDown, User as UserIcon, Loader2,
  RotateCcw, CalendarDays, Shield, PiggyBank, Target, TrendingDown, Home,
  Users, Lock,
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
import { InvitesManagement } from '@/components/auth/InvitesManagement';
import { AccountManagement } from '@/components/keeper/AccountManagement';

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
  | 'budget-setup'
  | 'plan'
  | 'calculators'
  | 'trends'
  // Plan tools surfaced inline in the More tab:
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

// Required Financial Profile sections per planning tool. When the required
// sections are missing, the tile is greyed out and tapping it deep-links to
// the relevant Financial Profile tab so the user can fill it in.
type ProfileSection = 'income' | 'housing' | 'debts' | 'dependents' | 'filing-status';

interface PlanToolDef {
  id: ProfileTabSelection;
  title: string;
  subtitle: string;
  icon: typeof Heart;
  // Function returns null if available; otherwise returns the missing section
  // label + the FP tab to deep-link into.
  requirement: (fp: any) => { missingLabel: string; profileTab: string } | null;
}

function hasIncome(fp: any): boolean {
  if (!fp) return false;
  const incomes = Array.isArray(fp.member_incomes) ? fp.member_incomes : [];
  return incomes.some((m: any) => (Number(m.gross_income) || 0) > 0);
}

function hasDebts(fp: any): boolean {
  if (!fp) return false;
  const debts = Array.isArray(fp.debts) ? fp.debts : [];
  return debts.length > 0;
}

function hasHousing(fp: any): boolean {
  if (!fp) return false;
  return !!fp.housing_type;
}

function hasDependents(fp: any): boolean {
  if (!fp) return false;
  const deps = Array.isArray(fp.dependents) ? fp.dependents : [];
  return deps.length > 0;
}

function hasFilingStatus(fp: any): boolean {
  return !!fp?.filing_status && !!fp?.state;
}

const PLAN_TOOLS: PlanToolDef[] = [
  {
    id: 'financial-profile',
    title: 'Financial Profile',
    subtitle: 'Income, housing, debts, accounts, insurance',
    icon: UserIcon,
    requirement: () => null, // always available — it's the entry point
  },
  {
    id: 'emergency-fund',
    title: 'Emergency Fund Analysis',
    subtitle: 'Are you prepared for the unexpected?',
    icon: Shield,
    requirement: (fp) => {
      if (!hasIncome(fp)) return { missingLabel: 'Income', profileTab: 'income' };
      if (!hasHousing(fp)) return { missingLabel: 'Housing', profileTab: 'housing' };
      // Debts are useful but not strictly required by the tool — keep it loose.
      return null;
    },
  },
  {
    id: 'retirement',
    title: 'Retirement Planner',
    subtitle: 'Are you on track to retire?',
    icon: PiggyBank,
    requirement: (fp) => {
      if (!hasIncome(fp)) return { missingLabel: 'Income', profileTab: 'income' };
      if (!hasFilingStatus(fp)) return { missingLabel: 'Filing status', profileTab: 'profile' };
      return null;
    },
  },
  {
    id: 'mortgage-analyzer',
    title: 'Mortgage Analyzer',
    subtitle: 'Analyze your current mortgage',
    icon: Home,
    requirement: (fp) => {
      if (!hasHousing(fp)) return { missingLabel: 'Housing', profileTab: 'housing' };
      if (fp?.housing_type !== 'own') return { missingLabel: 'Housing (own)', profileTab: 'housing' };
      if (!(Number(fp?.mortgage_balance) > 0 && Number(fp?.mortgage_payment) > 0)) {
        return { missingLabel: 'Mortgage details', profileTab: 'housing' };
      }
      return null;
    },
  },
  {
    id: 'debt-payoff',
    title: 'Debt Payoff Analyzer',
    subtitle: 'See your path to debt freedom',
    icon: TrendingDown,
    requirement: (fp) => {
      if (!hasDebts(fp)) return { missingLabel: 'Debts', profileTab: 'debts' };
      return null;
    },
  },
  {
    id: 'life-insurance',
    title: 'Life Insurance Analysis',
    subtitle: 'Is your family protected?',
    icon: Heart,
    requirement: (fp) => {
      if (!hasIncome(fp)) return { missingLabel: 'Income', profileTab: 'income' };
      if (!hasDependents(fp)) return { missingLabel: 'Dependents', profileTab: 'profile' };
      return null;
    },
  },
  {
    id: 'savings-goals',
    title: 'Non-Retirement Goals',
    subtitle: 'Plan and track non-retirement savings goals',
    icon: Target,
    requirement: () => null,
  },
];

// Section keys used for collapsible state. Always start collapsed.
type SectionKey =
  | 'household'
  | 'budget'
  | 'planning'
  | 'bank'
  | 'users'
  | 'security'
  | 'other';

export function ProfileTab({ onSelect, householdId }: ProfileTabProps) {
  const { signOut, profile, user } = useAuth();
  const { flags, loading: flagsLoading, updateFlag } = useHouseholdFlags(householdId);
  const canResetOnboarding = !!user?.email && RESET_ONBOARDING_ALLOWLIST.has(user.email.toLowerCase());
  const [resettingOnboarding, setResettingOnboarding] = useState(false);

  // Collapsible state — sections start collapsed every visit so the hierarchy
  // is the first thing the user sees.
  const [open, setOpen] = useState<Record<SectionKey, boolean>>({
    household: false,
    budget: false,
    planning: false,
    bank: false,
    users: false,
    security: false,
    other: false,
  });
  const toggle = (k: SectionKey) => setOpen(o => ({ ...o, [k]: !o[k] }));

  // Pull financial profile so we can grey out planning tools whose required
  // sections aren't complete.
  const [financialProfile, setFinancialProfile] = useState<any>(null);
  useEffect(() => {
    if (!householdId) return;
    let cancelled = false;
    supabase.from('financial_profiles').select('*').eq('household_id', householdId).maybeSingle()
      .then(({ data }) => { if (!cancelled) setFinancialProfile(data); });
    return () => { cancelled = true; };
  }, [householdId]);

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
    <div className="max-w-lg mx-auto pb-12">
      <div className="px-6 pt-12 safe-top">
        <h1 className="font-display text-2xl lg:text-3xl font-bold tracking-tight text-foreground">More</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Household, budget setup, planning tools, and settings</p>
      </div>

      <div className="px-6 mt-6 space-y-3">
        {/* a) Household Information */}
        <Section
          accent="neutral"
          icon={UserIcon}
          title="Household Information"
          subtitle="Display name and household preferences"
          isOpen={open.household}
          onToggle={() => toggle('household')}
        >
          <div className="bg-card rounded-xl shadow-sm divide-y divide-border">
            <div className="p-4 flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-primary flex items-center justify-center shrink-0">
                <span className="text-primary-foreground font-display text-sm font-bold">
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
            <FlagRow
              icon={Heart}
              label="Stewardship Mode"
              help="Christian faith-informed framing — biblical stewardship principles, gentle tone, giving as a baseline."
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
        </Section>

        {/* b) Budget Setup — yellow accent */}
        <Section
          accent="yellow"
          icon={CalendarDays}
          title="Budget Setup"
          subtitle="Take-home, categories, fixed bills, savings, giving"
          isOpen={open.budget}
          onToggle={() => toggle('budget')}
        >
          <button
            onClick={() => onSelect('budget-setup')}
            className="w-full flex items-center gap-3 bg-card rounded-xl p-4 shadow-sm text-left active:scale-[0.98] transition-transform border-l-4 border-amber-400"
          >
            <div className="w-10 h-10 rounded-full bg-amber-400/15 flex items-center justify-center shrink-0">
              <CalendarDays size={20} className="text-amber-600" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-foreground">Open Budget Setup</p>
              <p className="text-xs text-muted-foreground">Edit categories and fixed expenses by month</p>
            </div>
            <ChevronRight size={16} className="text-muted-foreground shrink-0" />
          </button>
        </Section>

        {/* c) Personal Financial Planning Tools — navy/blue accent */}
        <Section
          accent="blue"
          icon={Compass}
          title="Personal Financial Planning Tools"
          subtitle="Profile-driven tools for the long-term picture"
          isOpen={open.planning}
          onToggle={() => toggle('planning')}
        >
          <div className="space-y-2">
            {PLAN_TOOLS.map(tool => {
              const req = tool.requirement(financialProfile);
              const locked = !!req;
              return (
                <PlanTile
                  key={tool.id}
                  icon={tool.icon}
                  title={tool.title}
                  subtitle={locked ? `Complete ${req!.missingLabel} to unlock` : tool.subtitle}
                  locked={locked}
                  onClick={() => {
                    if (locked) {
                      // Deep-link to Financial Profile on the missing section.
                      onSelect('financial-profile', req!.profileTab);
                    } else {
                      onSelect(tool.id);
                    }
                  }}
                />
              );
            })}
          </div>
        </Section>

        {/* d) Bank Accounts */}
        <Section
          accent="neutral"
          icon={Building2}
          title="Bank Accounts"
          subtitle="Linked banks, sync, and cardholder mapping"
          isOpen={open.bank}
          onToggle={() => toggle('bank')}
        >
          <button
            onClick={() => onSelect('bank-connections')}
            className="w-full flex items-center gap-3 bg-card rounded-xl p-4 shadow-sm text-left active:scale-[0.98] transition-transform"
          >
            <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
              <Building2 size={20} className="text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-foreground">Manage bank connections</p>
              <p className="text-xs text-muted-foreground">Link banks via Plaid and assign cardholders</p>
            </div>
            <ChevronRight size={16} className="text-muted-foreground shrink-0" />
          </button>
        </Section>

        {/* e) Manage Users */}
        <Section
          accent="neutral"
          icon={Users}
          title="Manage Users"
          subtitle="Household members and invites"
          isOpen={open.users}
          onToggle={() => toggle('users')}
        >
          <div className="bg-card rounded-xl shadow-sm p-4">
            <AccountManagement />
          </div>
        </Section>

        {/* f) Security */}
        <Section
          accent="neutral"
          icon={ShieldCheck}
          title="Security"
          subtitle="Password, MFA, trusted devices"
          isOpen={open.security}
          onToggle={() => toggle('security')}
        >
          <button
            onClick={() => onSelect('security')}
            className="w-full flex items-center gap-3 bg-card rounded-xl p-4 shadow-sm text-left active:scale-[0.98] transition-transform"
          >
            <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
              <ShieldCheck size={20} className="text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-foreground">Open Security settings</p>
              <p className="text-xs text-muted-foreground">Change password, set up MFA, manage devices</p>
            </div>
            <ChevronRight size={16} className="text-muted-foreground shrink-0" />
          </button>
        </Section>

        {/* g) Other Tools */}
        <Section
          accent="neutral"
          icon={Calculator}
          title="Other Tools"
          subtitle="Generic calculators and spending trends"
          isOpen={open.other}
          onToggle={() => toggle('other')}
        >
          <div className="space-y-2">
            <FlatTile
              icon={Calculator}
              title="Calculators"
              subtitle="Generic financial calculators"
              onClick={() => onSelect('calculators')}
            />
            <FlatTile
              icon={BarChart3}
              title="Trends"
              subtitle="Month over month spending comparison"
              onClick={() => onSelect('trends')}
            />
          </div>
        </Section>
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

// Collapsible section header. Tapping the header expands/collapses the body.
// Color accent on the icon chip + left border signals which group this is.
function Section({
  accent, icon: Icon, title, subtitle, isOpen, onToggle, children,
}: {
  accent: 'neutral' | 'yellow' | 'blue';
  icon: typeof Heart;
  title: string;
  subtitle: string;
  isOpen: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  const accentClasses = {
    neutral: { chip: 'bg-muted text-foreground/70', border: 'border-border' },
    yellow: { chip: 'bg-amber-400/15 text-amber-600', border: 'border-amber-400' },
    blue: { chip: 'bg-blue-500/15 text-blue-600', border: 'border-blue-500' },
  }[accent];

  return (
    <div className={`bg-card rounded-xl shadow-sm overflow-hidden border-l-4 ${accentClasses.border}`}>
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-3 p-4 text-left active:bg-muted/30 transition-colors"
        aria-expanded={isOpen}
      >
        <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${accentClasses.chip}`}>
          <Icon size={18} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-foreground">{title}</p>
          <p className="text-xs text-muted-foreground truncate">{subtitle}</p>
        </div>
        <ChevronDown
          size={18}
          className={`text-muted-foreground shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`}
        />
      </button>
      {isOpen && (
        <div className="p-3 pt-0 space-y-2 animate-fade-up">
          {children}
        </div>
      )}
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

// Plain neutral tile used inside expanded sections (e.g. Other Tools).
function FlatTile({
  icon: Icon, title, subtitle, onClick,
}: {
  icon: typeof Heart;
  title: string;
  subtitle: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-3 bg-card rounded-xl p-4 shadow-sm text-left active:scale-[0.98] transition-transform"
    >
      <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
        <Icon size={20} className="text-primary" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-foreground">{title}</p>
        <p className="text-xs text-muted-foreground">{subtitle}</p>
      </div>
      <ChevronRight size={16} className="text-muted-foreground shrink-0" />
    </button>
  );
}

// Visually distinct tile for planning tools — blue accent. When `locked` the
// tile looks dim and shows a lock icon; tap still fires onClick (used to deep
// link into Financial Profile so the user can fill the missing section).
function PlanTile({
  icon: Icon, title, subtitle, locked, onClick,
}: {
  icon: typeof Heart;
  title: string;
  subtitle: string;
  locked?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-4 bg-card rounded-lg p-4 shadow-sm text-left active:scale-[0.98] transition-transform border-l-4 border-blue-500 ${locked ? 'opacity-55' : ''}`}
    >
      <div className="w-10 h-10 rounded-full bg-blue-500/10 flex items-center justify-center">
        <Icon size={20} className="text-blue-600" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-foreground">{title}</p>
        <p className="text-xs text-muted-foreground">{subtitle}</p>
      </div>
      {locked
        ? <Lock size={14} className="text-muted-foreground shrink-0" />
        : <ChevronRight size={16} className="text-muted-foreground shrink-0" />}
    </button>
  );
}
