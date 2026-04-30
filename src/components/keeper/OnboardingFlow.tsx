import { useState, useEffect, useMemo, useCallback } from 'react';
import { usePlaidLink } from 'react-plaid-link';
import {
  ChevronLeft, ChevronRight, Check, Sparkles, Heart, Baby, PawPrint,
  Wallet, Building2, Compass, MessageSquareText, ListChecks, Loader2,
  HelpCircle, AlertTriangle,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Switch } from '@/components/ui/switch';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from '@/components/ui/tooltip';
import { toast } from 'sonner';
import { CFP_BUCKETS, type CfpBucket } from '@/lib/cfpBuckets';
import { STATE_OPTIONS } from '@/data/stateDefaults';

/* ---------- Types ---------- */

interface OnboardingFlowProps {
  householdId: string;
  onComplete: () => void;
}

type IncomeEntry = {
  /** Local-only id for list keying. */
  key: string;
  label: string;
  /** Monthly take-home (post-tax). */
  amount: string;
};

type BucketDraft = {
  key: string;
  /** "" = skipped (no category will be created). */
  amount: string;
};

const STEPS = [
  'welcome',
  'household',
  'income',
  'plaid',
  'budget',
  'tour',
] as const;

type StepId = typeof STEPS[number];

/* ---------- Helpers ---------- */

function formatCurrency(n: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(n);
}

/* ---------- Bucket → starter category metadata ---------- */
function bucketToBudgetRow(bucket: CfpBucket, amount: number, householdId: string, sortOrder: number) {
  if (bucket.role === 'variable') {
    return {
      table: 'budget_categories' as const,
      row: {
        household_id: householdId,
        slug: bucket.key,
        name: bucket.label,
        budgeted: amount,
        group: 'shared',
        sort_order: sortOrder,
        notes_required: false,
      },
    };
  }
  const fixedGroup =
    bucket.key === 'giving' ? 'tithe'
    : bucket.key === 'saving' ? 'savings'
    : 'bills';
  return {
    table: 'fixed_expenses' as const,
    row: {
      household_id: householdId,
      slug: bucket.key,
      name: bucket.label,
      amount,
      group: fixedGroup,
      sort_order: sortOrder,
      notes_required: false,
    },
  };
}

/* ---------- Main component ---------- */

export function OnboardingFlow({ householdId, onComplete }: OnboardingFlowProps) {
  const { profile } = useAuth();
  const [stepIdx, setStepIdx] = useState(0);
  const stepId = STEPS[stepIdx];

  /* ---- Step 2: household flags ---- */
  const [stewardship, setStewardship] = useState(true);
  const [hasKids, setHasKids] = useState(false);
  const [hasPets, setHasPets] = useState(false);

  /* ---- Step 3: income (monthly take-home) + state ---- */
  const [incomes, setIncomes] = useState<IncomeEntry[]>([
    { key: 'me', label: profile?.display_name || 'You', amount: '' },
  ]);
  const [hasPartner, setHasPartner] = useState(false);
  const [partnerName, setPartnerName] = useState('');
  const [stateCode, setStateCode] = useState<string>('');

  /* ---- Step 5: budget builder (single-page) ---- */
  const [skipBudgetEntirely, setSkipBudgetEntirely] = useState(false);
  const [bucketDrafts, setBucketDrafts] = useState<BucketDraft[]>([]);

  /* ---- Plaid skip flag ---- */
  const [skippedPlaid, setSkippedPlaid] = useState(false);
  const [plaidConnected, setPlaidConnected] = useState(false);

  /* ---- Submit state ---- */
  const [submitting, setSubmitting] = useState(false);

  /* Initialize household flags from existing values */
  useEffect(() => {
    let cancelled = false;
    supabase
      .from('households')
      .select('stewardship_mode, has_kids, has_pets')
      .eq('id', householdId)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled || !data) return;
        setStewardship(data.stewardship_mode ?? true);
        setHasKids(data.has_kids ?? false);
        setHasPets(data.has_pets ?? false);
      });
    return () => { cancelled = true; };
  }, [householdId]);

  /* Filter buckets by household flags */
  const visibleBuckets = useMemo(() => {
    return CFP_BUCKETS.filter(b => {
      if (b.key === 'kids' && !hasKids) return false;
      if (b.key === 'pets' && !hasPets) return false;
      return true;
    });
  }, [hasKids, hasPets]);

  /* Initialize the bucket drafts when entering Step 5 */
  useEffect(() => {
    if (stepId !== 'budget' || skipBudgetEntirely) return;
    setBucketDrafts(prev => {
      // Reconcile drafts with currently-visible buckets (preserve user input).
      const existingByKey = new Map(prev.map(d => [d.key, d]));
      return visibleBuckets.map(b => existingByKey.get(b.key) ?? { key: b.key, amount: '' });
    });
  }, [stepId, visibleBuckets, skipBudgetEntirely]);

  /* ---- Computed values ---- */

  const monthlyTakeHome = useMemo(
    () => incomes.reduce((s, i) => s + (Number(i.amount) || 0), 0),
    [incomes],
  );

  const totalAllocated = useMemo(
    () => bucketDrafts.reduce((s, d) => s + (Number(d.amount) || 0), 0),
    [bucketDrafts],
  );

  /* ---- Step nav helpers ---- */

  const goNext = () => setStepIdx(i => Math.min(STEPS.length - 1, i + 1));
  const goBack = () => setStepIdx(i => Math.max(0, i - 1));

  /* ---- Persistence ---- */

  const persistHouseholdFlags = useCallback(async () => {
    await supabase
      .from('households')
      .update({
        stewardship_mode: stewardship,
        has_kids: hasKids,
        has_pets: hasPets,
      })
      .eq('id', householdId);
  }, [householdId, stewardship, hasKids, hasPets]);

  // Save income to financial_profiles. We capture monthly take-home directly,
  // so we annualize it (×12) into annual_gross_income's slot for now — the
  // analyzer reads this as the take-home anchor. Gross income can be filled in
  // later from the Financial Profile.
  const persistIncome = useCallback(async () => {
    if (monthlyTakeHome <= 0 || !stateCode) return;
    const { data: existing } = await supabase
      .from('financial_profiles')
      .select('id')
      .eq('household_id', householdId)
      .maybeSingle();

    const memberIncomes = incomes.map(i => ({
      profile_id: i.key === 'me' ? profile?.id ?? null : null,
      name: i.label || 'Member',
      // Store monthly take-home × 12 as annual take-home for now; gross is
      // optional and refined later in the Financial Profile.
      gross_income: (Number(i.amount) || 0) * 12,
      monthly_take_home: Number(i.amount) || 0,
      income_type: 'w2',
      income_sources: [],
      dob: null,
      pay_frequency: 'monthly' as const,
    }));

    if (existing?.id) {
      await supabase
        .from('financial_profiles')
        .update({
          member_incomes: memberIncomes as any,
          annual_gross_income: monthlyTakeHome * 12,
          state: stateCode,
        })
        .eq('id', existing.id);
    } else {
      await supabase.from('financial_profiles').insert({
        household_id: householdId,
        member_incomes: memberIncomes as any,
        annual_gross_income: monthlyTakeHome * 12,
        state: stateCode,
        filing_status: hasPartner ? 'married_jointly' : 'single',
        income_type: 'w2',
        housing_type: 'rent',
      } as any);
    }
  }, [householdId, incomes, monthlyTakeHome, hasPartner, profile?.id, stateCode]);

  const persistBudget = useCallback(async () => {
    if (skipBudgetEntirely) return;
    const filled = bucketDrafts
      .map((d, idx) => {
        const amt = Number(d.amount);
        if (!d.amount || isNaN(amt) || amt <= 0) return null;
        const bucket = CFP_BUCKETS.find(b => b.key === d.key);
        if (!bucket) return null;
        return bucketToBudgetRow(bucket, amt, householdId, idx);
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);

    const variableRows = filled.filter(f => f.table === 'budget_categories').map(f => f.row);
    const fixedRows = filled.filter(f => f.table === 'fixed_expenses').map(f => f.row);

    if (variableRows.length > 0) {
      await supabase.from('budget_categories').insert(variableRows as any);
    }
    if (fixedRows.length > 0) {
      await supabase.from('fixed_expenses').insert(fixedRows as any);
    }

    const allMappings = filled.map(f => ({
      household_id: householdId,
      category_slug: f.row.slug,
      bucket_key: f.row.slug,
      category_kind: f.table === 'budget_categories' ? 'variable' : 'fixed',
    }));
    if (allMappings.length > 0) {
      await supabase
        .from('category_bucket_map')
        .upsert(allMappings as any, { onConflict: 'household_id,category_slug' });
    }
  }, [skipBudgetEntirely, bucketDrafts, householdId]);

  const finishOnboarding = useCallback(async () => {
    setSubmitting(true);
    try {
      await persistHouseholdFlags();
      await persistIncome();
      await persistBudget();

      await supabase
        .from('tool_states')
        .upsert(
          {
            household_id: householdId,
            tool_name: 'home-cards',
            state_json: {
              welcome_toast_shown: false,
              budget_setup_dismissed: false,
              plaid_setup_dismissed: false,
              needs_budget_setup: skipBudgetEntirely,
              needs_plaid_setup: skippedPlaid && !plaidConnected,
            },
            updated_at: new Date().toISOString(),
          } as any,
          { onConflict: 'household_id,tool_name' },
        );

      await supabase
        .from('households')
        .update({ onboarding_completed: true })
        .eq('id', householdId);

      onComplete();
    } catch (e) {
      console.error(e);
      toast.error('Could not save onboarding. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }, [
    persistHouseholdFlags, persistIncome, persistBudget,
    householdId, skipBudgetEntirely, skippedPlaid, plaidConnected, onComplete,
  ]);

  /* ---- Step gating ---- */

  const canAdvanceFromIncome = monthlyTakeHome > 0 && !!stateCode;

  /* ---- Render ---- */

  const progress = ((stepIdx + 1) / STEPS.length) * 100;

  return (
    <TooltipProvider delayDuration={150}>
      <div className="fixed inset-0 z-50 bg-background overflow-y-auto">
        {/* Top bar with progress */}
        <div className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b border-border safe-top">
          <div className="max-w-xl mx-auto px-6 py-3 flex items-center gap-3">
            {stepIdx > 0 && stepId !== 'tour' && (
              <button
                onClick={goBack}
                className="text-muted-foreground hover:text-foreground active:scale-95 transition"
                aria-label="Back"
              >
                <ChevronLeft size={20} />
              </button>
            )}
            <div className="flex-1">
              <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full bg-accent transition-all duration-500"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <p className="text-[11px] text-muted-foreground mt-1.5 font-medium">
                Step {stepIdx + 1} of {STEPS.length}
              </p>
            </div>
          </div>
        </div>

        {/* Step content */}
        <div className="max-w-xl mx-auto px-6 py-8 pb-32">
          {stepId === 'welcome' && (
            <WelcomeStep firstName={profile?.display_name?.split(' ')[0] || ''} onNext={goNext} />
          )}

          {stepId === 'household' && (
            <HouseholdStep
              stewardship={stewardship} setStewardship={setStewardship}
              hasKids={hasKids} setHasKids={setHasKids}
              hasPets={hasPets} setHasPets={setHasPets}
              onNext={async () => { await persistHouseholdFlags(); goNext(); }}
            />
          )}

          {stepId === 'income' && (
            <IncomeStep
              incomes={incomes} setIncomes={setIncomes}
              hasPartner={hasPartner} setHasPartner={setHasPartner}
              partnerName={partnerName} setPartnerName={setPartnerName}
              stateCode={stateCode} setStateCode={setStateCode}
              canAdvance={canAdvanceFromIncome}
              monthlyTakeHome={monthlyTakeHome}
              onNext={async () => { await persistIncome(); goNext(); }}
            />
          )}

          {stepId === 'plaid' && (
            <PlaidStep
              householdId={householdId}
              onConnected={() => setPlaidConnected(true)}
              connected={plaidConnected}
              onSkip={() => { setSkippedPlaid(true); goNext(); }}
              onContinue={() => { setSkippedPlaid(false); goNext(); }}
            />
          )}

          {stepId === 'budget' && (
            <BudgetStep
              buckets={visibleBuckets}
              drafts={bucketDrafts}
              setDrafts={setBucketDrafts}
              monthlyTakeHome={monthlyTakeHome}
              totalAllocated={totalAllocated}
              skipEntirely={skipBudgetEntirely}
              onSkipEntirely={() => { setSkipBudgetEntirely(true); goNext(); }}
              onComplete={goNext}
            />
          )}

          {stepId === 'tour' && (
            <TourStep
              firstName={profile?.display_name?.split(' ')[0] || ''}
              submitting={submitting}
              onFinish={finishOnboarding}
            />
          )}
        </div>
      </div>
    </TooltipProvider>
  );
}

/* ============================================================
 * Step 1 — Welcome
 * ============================================================ */
function WelcomeStep({ firstName, onNext }: { firstName: string; onNext: () => void }) {
  return (
    <div className="text-center pt-12">
      <div className="w-16 h-16 mx-auto rounded-3xl bg-primary flex items-center justify-center mb-6 shadow-lg">
        <span className="text-primary-foreground font-display text-2xl font-bold">K</span>
      </div>
      <h1 className="font-display text-3xl font-bold tracking-tight text-foreground">
        Welcome to Keeper{firstName ? `, ${firstName}` : ''}
      </h1>
      <p className="text-base text-muted-foreground mt-3 leading-relaxed">
        A budget app for households who want to be intentional with their money.
        Christian faith-informed framing, no shame, just clarity.
      </p>
      <p className="text-sm text-muted-foreground mt-6">
        This setup takes about 3 minutes. You can change anything later in your Profile.
      </p>
      <button
        onClick={onNext}
        className="mt-10 w-full bg-primary text-primary-foreground font-semibold py-3.5 rounded-xl active:scale-[0.98] transition shadow-md flex items-center justify-center gap-2"
      >
        Let's get started <ChevronRight size={18} />
      </button>
    </div>
  );
}

/* ============================================================
 * Step 2 — Household
 * ============================================================ */
function HouseholdStep({
  stewardship, setStewardship, hasKids, setHasKids, hasPets, setHasPets, onNext,
}: {
  stewardship: boolean; setStewardship: (v: boolean) => void;
  hasKids: boolean; setHasKids: (v: boolean) => void;
  hasPets: boolean; setHasPets: (v: boolean) => void;
  onNext: () => void;
}) {
  return (
    <div>
      <h2 className="font-display text-2xl font-bold tracking-tight text-foreground">
        Tell us about your household
      </h2>
      <p className="text-sm text-muted-foreground mt-1.5">
        These shape how Keeper talks to you and which buckets are relevant.
      </p>

      <div className="mt-8 space-y-3">
        <FlagCard
          icon={Heart}
          title="Stewardship Mode"
          description="Christian faith-informed framing — biblical stewardship principles, gentle tone, giving as a baseline."
          checked={stewardship}
          onChange={setStewardship}
        />
        <FlagCard
          icon={Baby}
          title="We have kids"
          description="Keeps the Kids bucket relevant in the analyzer."
          checked={hasKids}
          onChange={setHasKids}
        />
        <FlagCard
          icon={PawPrint}
          title="We have pets"
          description="Keeps the Pets bucket relevant in the analyzer."
          checked={hasPets}
          onChange={setHasPets}
        />
      </div>

      <button
        onClick={onNext}
        className="mt-10 w-full bg-primary text-primary-foreground font-semibold py-3.5 rounded-xl active:scale-[0.98] transition shadow-md flex items-center justify-center gap-2"
      >
        Continue <ChevronRight size={18} />
      </button>
    </div>
  );
}

function FlagCard({
  icon: Icon, title, description, checked, onChange,
}: {
  icon: typeof Heart;
  title: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div
      className={`bg-card rounded-xl shadow-sm p-4 border-2 transition ${
        checked ? 'border-accent/40' : 'border-transparent'
      }`}
    >
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center shrink-0">
          <Icon size={20} className="text-foreground/80" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-foreground">{title}</p>
          <p className="text-xs text-muted-foreground leading-snug mt-0.5">{description}</p>
        </div>
        <Switch checked={checked} onCheckedChange={onChange} className="mt-1 shrink-0" />
      </div>
    </div>
  );
}

/* ============================================================
 * Step 3 — Income (monthly take-home + state)
 * ============================================================ */
function IncomeStep({
  incomes, setIncomes, hasPartner, setHasPartner, partnerName, setPartnerName,
  stateCode, setStateCode, canAdvance, monthlyTakeHome, onNext,
}: {
  incomes: IncomeEntry[]; setIncomes: (v: IncomeEntry[]) => void;
  hasPartner: boolean; setHasPartner: (v: boolean) => void;
  partnerName: string; setPartnerName: (v: string) => void;
  stateCode: string; setStateCode: (v: string) => void;
  canAdvance: boolean;
  monthlyTakeHome: number;
  onNext: () => void;
}) {
  const togglePartner = (v: boolean) => {
    setHasPartner(v);
    if (v && !incomes.some(i => i.key === 'partner')) {
      setIncomes([...incomes, { key: 'partner', label: partnerName || 'Partner', amount: '' }]);
    } else if (!v) {
      setIncomes(incomes.filter(i => i.key !== 'partner'));
    }
  };

  const updateIncome = (key: string, field: 'label' | 'amount', value: string) => {
    setIncomes(incomes.map(i => i.key === key ? { ...i, [field]: value } : i));
  };

  return (
    <div>
      <h2 className="font-display text-2xl font-bold tracking-tight text-foreground">
        What's your household take-home?
      </h2>
      <p className="text-sm text-muted-foreground mt-1.5">
        Your monthly take-home pay — what actually hits your bank account after taxes,
        retirement, and benefits. This is what we'll budget against.
      </p>

      <div className="mt-8 space-y-4">
        {incomes.map(inc => (
          <div key={inc.key} className="bg-card rounded-xl shadow-sm p-4">
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
              {inc.key === 'me' ? 'Your name' : 'Partner name'}
            </label>
            <input
              type="text"
              value={inc.label}
              onChange={e => updateIncome(inc.key, 'label', e.target.value)}
              className="w-full text-sm font-semibold text-foreground bg-transparent outline-none border-b border-border focus:border-accent py-1"
              placeholder="Name"
            />
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mt-4 mb-1.5">
              Monthly take-home pay
            </label>
            <div className="flex items-baseline gap-2 border-b border-border focus-within:border-accent">
              <span className="text-lg font-semibold text-muted-foreground">$</span>
              <input
                type="number"
                inputMode="decimal"
                value={inc.amount}
                onChange={e => updateIncome(inc.key, 'amount', e.target.value)}
                className="flex-1 text-lg font-semibold text-foreground bg-transparent outline-none py-1 tabular-nums"
                placeholder="4500"
              />
              <span className="text-xs text-muted-foreground font-medium">/ month</span>
            </div>
          </div>
        ))}

        <div className="bg-card rounded-xl shadow-sm p-4 flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-foreground">I have a partner</p>
            <p className="text-xs text-muted-foreground">Add their take-home to the household total.</p>
          </div>
          <Switch checked={hasPartner} onCheckedChange={togglePartner} />
        </div>

        {/* State picker */}
        <div className="bg-card rounded-xl shadow-sm p-4">
          <label className="block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
            Your state
          </label>
          <Select value={stateCode} onValueChange={setStateCode}>
            <SelectTrigger>
              <SelectValue placeholder="Pick a state" />
            </SelectTrigger>
            <SelectContent>
              {STATE_OPTIONS.map(s => (
                <SelectItem key={s.code} value={s.code}>{s.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-[11px] text-muted-foreground mt-2 leading-snug">
            Used for tax estimates and housing defaults across Keeper's tools.
          </p>
        </div>

        {monthlyTakeHome > 0 && (
          <div className="bg-accent/10 border border-accent/30 rounded-xl p-4">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-accent">
              Household monthly take-home
            </p>
            <p className="text-2xl font-display font-bold text-foreground mt-1 tabular-nums">
              {formatCurrency(monthlyTakeHome)}
            </p>
          </div>
        )}
      </div>

      <button
        onClick={onNext}
        disabled={!canAdvance}
        className="mt-10 w-full bg-primary text-primary-foreground font-semibold py-3.5 rounded-xl active:scale-[0.98] transition shadow-md flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        Continue <ChevronRight size={18} />
      </button>
    </div>
  );
}

/* ============================================================
 * Step 4 — Plaid (optional)
 * ============================================================ */
function PlaidStep({
  householdId, onConnected, connected, onSkip, onContinue,
}: {
  householdId: string;
  onConnected: () => void;
  connected: boolean;
  onSkip: () => void;
  onContinue: () => void;
}) {
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const onSuccess = useCallback(async (publicToken: string, metadata: any) => {
    try {
      setLoading(true);
      const institution = metadata.institution as Record<string, string> | undefined;
      const accounts = metadata.accounts as Array<Record<string, string>> | undefined;
      await supabase.functions.invoke('plaid-exchange-token', {
        body: {
          public_token: publicToken,
          institution_name: institution?.name || '',
          accounts: accounts || [],
        },
      });
      onConnected();
      toast.success('Bank connected!');
    } catch {
      toast.error('Failed to connect bank.');
    } finally {
      setLoading(false);
      setLinkToken(null);
    }
  }, [onConnected]);

  const { open: openPlaid, ready: plaidReady } = usePlaidLink({
    token: linkToken,
    onSuccess,
    onExit: () => { setLinkToken(null); setLoading(false); },
  });

  useEffect(() => {
    if (linkToken && plaidReady) openPlaid();
  }, [linkToken, plaidReady, openPlaid]);

  const handleConnect = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('plaid-create-link-token');
      if (error) throw error;
      setLinkToken(data.link_token);
    } catch {
      toast.error('Failed to start bank connection.');
      setLoading(false);
    }
  };

  return (
    <div>
      <h2 className="font-display text-2xl font-bold tracking-tight text-foreground">
        Connect your accounts
      </h2>
      <p className="text-sm text-muted-foreground mt-1.5">
        Optional. Linking your bank pulls transactions automatically so you don't have
        to enter them by hand. You can add this anytime from your Profile.
      </p>

      <div className="mt-8 bg-card rounded-xl shadow-sm p-6 text-center">
        <div className="w-14 h-14 mx-auto rounded-full bg-primary/10 flex items-center justify-center mb-4">
          <Building2 size={28} className="text-primary" />
        </div>
        {connected ? (
          <>
            <p className="font-display text-lg font-bold text-foreground">Connected</p>
            <p className="text-sm text-muted-foreground mt-1">
              We'll pull transactions in the background.
            </p>
          </>
        ) : (
          <>
            <p className="font-display text-lg font-bold text-foreground">Link a bank account</p>
            <p className="text-sm text-muted-foreground mt-1">
              Powered by Plaid. We never see or store your bank login.
            </p>
            <button
              onClick={handleConnect}
              disabled={loading}
              className="mt-5 w-full bg-primary text-primary-foreground font-semibold py-3 rounded-lg active:scale-[0.98] transition flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {loading ? <Loader2 size={16} className="animate-spin" /> : <Building2 size={16} />}
              {loading ? 'Connecting...' : 'Connect bank'}
            </button>
          </>
        )}
      </div>

      <div className="mt-8 flex flex-col gap-3">
        <button
          onClick={onContinue}
          className="w-full bg-primary text-primary-foreground font-semibold py-3.5 rounded-xl active:scale-[0.98] transition shadow-md flex items-center justify-center gap-2"
        >
          Continue <ChevronRight size={18} />
        </button>
        {!connected && (
          <button
            onClick={onSkip}
            className="text-sm text-muted-foreground font-medium hover:text-foreground py-2 active:scale-95 transition"
          >
            Skip — I'll connect later
          </button>
        )}
      </div>
    </div>
  );
}

/* ============================================================
 * Step 5 — Budget builder (single-page)
 * ============================================================ */
function BudgetStep({
  buckets, drafts, setDrafts,
  monthlyTakeHome, totalAllocated, skipEntirely, onSkipEntirely, onComplete,
}: {
  buckets: CfpBucket[];
  drafts: BucketDraft[];
  setDrafts: (d: BucketDraft[] | ((prev: BucketDraft[]) => BucketDraft[])) => void;
  monthlyTakeHome: number;
  totalAllocated: number;
  skipEntirely: boolean;
  onSkipEntirely: () => void;
  onComplete: () => void;
}) {
  const allocPct = monthlyTakeHome > 0 ? (totalAllocated / monthlyTakeHome) * 100 : 0;
  const remaining = monthlyTakeHome - totalAllocated;
  const overAllocated = totalAllocated > monthlyTakeHome;

  const updateDraft = (key: string, val: string) => {
    setDrafts(prev => prev.map(d => d.key === key ? { ...d, amount: val } : d));
  };

  return (
    <div>
      <div className="w-14 h-14 rounded-2xl bg-accent/15 flex items-center justify-center mb-5">
        <Wallet size={28} className="text-accent" />
      </div>
      <h2 className="font-display text-2xl font-bold tracking-tight text-foreground">
        Build your starter budget
      </h2>
      <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
        Enter what you want to budget for each bucket. Skip the ones that don't apply —
        no pressure to fill them all in. You can revise everything later.
      </p>

      {/* Allocation progress bar — sticky-ish at top of the list */}
      <div className="mt-6 bg-card rounded-xl shadow-sm p-4 border border-border/60">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Allocated
          </p>
          <p className="text-[11px] font-semibold text-muted-foreground tabular-nums">
            {Math.round(allocPct)}%
          </p>
        </div>
        <p className="text-lg font-display font-bold text-foreground mt-1 tabular-nums">
          {formatCurrency(totalAllocated)}
          <span className="text-sm font-medium text-muted-foreground"> of {formatCurrency(monthlyTakeHome)}</span>
        </p>
        <div className="mt-2 h-2 rounded-full bg-muted overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-300 ${
              overAllocated ? 'bg-destructive' : 'bg-accent'
            }`}
            style={{ width: `${Math.min(allocPct, 100)}%` }}
          />
        </div>
        {overAllocated ? (
          <div className="mt-2.5 flex items-start gap-1.5 text-xs text-destructive font-medium">
            <AlertTriangle size={13} className="shrink-0 mt-0.5" />
            <span>You've allocated {formatCurrency(totalAllocated - monthlyTakeHome)} more than your take-home.</span>
          </div>
        ) : remaining > 0 && totalAllocated > 0 ? (
          <p className="text-xs text-muted-foreground mt-2.5">
            {formatCurrency(remaining)} left to allocate
          </p>
        ) : null}
      </div>

      {/* Bucket cards */}
      <div className="mt-6 space-y-3">
        {buckets.map(b => {
          const draft = drafts.find(d => d.key === b.key);
          return (
            <BucketRow
              key={b.key}
              bucket={b}
              monthlyTakeHome={monthlyTakeHome}
              amount={draft?.amount ?? ''}
              onChange={(v) => updateDraft(b.key, v)}
            />
          );
        })}
      </div>

      <div className="mt-10 flex flex-col gap-3">
        <button
          onClick={onComplete}
          className="w-full bg-primary text-primary-foreground font-semibold py-3.5 rounded-xl active:scale-[0.98] transition shadow-md flex items-center justify-center gap-2"
        >
          Continue to tour <ChevronRight size={18} />
        </button>
        <button
          onClick={onSkipEntirely}
          className="text-sm text-muted-foreground font-medium hover:text-foreground py-2 active:scale-95 transition"
        >
          I'll set this up later
        </button>
      </div>
    </div>
  );
}

function BucketRow({
  bucket, monthlyTakeHome, amount, onChange,
}: {
  bucket: CfpBucket;
  monthlyTakeHome: number;
  amount: string;
  onChange: (v: string) => void;
}) {
  const isMin = bucket.guideline_kind === 'min';
  const guidelineDollar = monthlyTakeHome > 0
    ? Math.round((monthlyTakeHome * bucket.guideline_pct) / 100)
    : 0;
  const recommendation = isMin
    ? `Recommended: at least ${bucket.guideline_pct}% of take-home`
    : `Recommended: no more than ${bucket.guideline_pct}% of take-home`;

  return (
    <div className="bg-card rounded-xl shadow-sm p-4 border border-border/60">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-foreground">{bucket.label}</p>
          <p className="text-xs text-muted-foreground leading-snug mt-0.5">{bucket.description}</p>
        </div>
        <div className="flex items-baseline gap-1 border-b-2 border-border focus-within:border-accent shrink-0 w-32">
          <span className="text-base font-semibold text-muted-foreground">$</span>
          <input
            type="number"
            inputMode="decimal"
            value={amount}
            onChange={e => onChange(e.target.value)}
            className="flex-1 w-full text-base font-semibold text-foreground bg-transparent outline-none py-1 tabular-nums text-right"
            placeholder="0"
          />
        </div>
      </div>

      <div className="mt-2.5 flex items-center gap-2 flex-wrap">
        <p className="text-[11px] text-muted-foreground">
          {recommendation}
          {monthlyTakeHome > 0 && (
            <> · ~{formatCurrency(guidelineDollar)}/mo</>
          )}
        </p>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className="inline-flex items-center gap-1 text-[11px] text-accent font-medium hover:underline active:scale-95 transition"
              aria-label={`Why ${bucket.guideline_pct}%?`}
            >
              <HelpCircle size={11} />
              Why this number?
            </button>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-[260px] text-xs leading-snug">
            {bucket.guideline_source}
          </TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}

/* ============================================================
 * Step 6 — Quick tour
 * ============================================================ */
function TourStep({
  firstName, submitting, onFinish,
}: {
  firstName: string;
  submitting: boolean;
  onFinish: () => void;
}) {
  return (
    <div>
      <div className="w-16 h-16 rounded-3xl bg-accent flex items-center justify-center mb-5">
        <Sparkles size={28} className="text-accent-foreground" />
      </div>
      <h2 className="font-display text-2xl font-bold tracking-tight text-foreground">
        You're all set{firstName ? `, ${firstName}` : ''}
      </h2>
      <p className="text-sm text-muted-foreground mt-1.5">
        A few places worth knowing about as you settle in.
      </p>

      <div className="mt-8 space-y-3">
        <TourCard
          icon={ListChecks}
          title="Review your transactions"
          description="The Activity tab is where you categorize spending and keep things organized."
        />
        <TourCard
          icon={Compass}
          title="Set savings goals"
          description="Head to the Budget tab to add savings buckets — vacation, emergency fund, anything you're working toward."
        />
        <TourCard
          icon={MessageSquareText}
          title="Ask Keeper anything"
          description="The AI Advisor in your Profile gives faith-informed, CFP-style guidance on your real numbers."
        />
      </div>

      <button
        onClick={onFinish}
        disabled={submitting}
        className="mt-10 w-full bg-primary text-primary-foreground font-semibold py-3.5 rounded-xl active:scale-[0.98] transition shadow-md flex items-center justify-center gap-2 disabled:opacity-50"
      >
        {submitting ? <Loader2 size={18} className="animate-spin" /> : <Check size={18} />}
        Take me to Keeper
      </button>
      <button
        onClick={onFinish}
        disabled={submitting}
        className="mt-3 w-full text-sm text-muted-foreground font-medium hover:text-foreground py-2 active:scale-95 transition disabled:opacity-50"
      >
        Skip the tour
      </button>
    </div>
  );
}

function TourCard({
  icon: Icon, title, description,
}: {
  icon: typeof Heart;
  title: string;
  description: string;
}) {
  return (
    <div className="bg-card rounded-xl shadow-sm p-4 flex items-start gap-3">
      <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
        <Icon size={20} className="text-primary" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-foreground">{title}</p>
        <p className="text-xs text-muted-foreground leading-snug mt-0.5">{description}</p>
      </div>
    </div>
  );
}
