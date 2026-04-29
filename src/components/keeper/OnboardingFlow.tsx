import { useState, useEffect, useMemo, useCallback } from 'react';
import { format } from 'date-fns';
import { usePlaidLink } from 'react-plaid-link';
import {
  ChevronLeft, ChevronRight, Check, Sparkles, Heart, Baby, PawPrint,
  Wallet, Building2, Compass, MessageSquareText, ListChecks, Loader2,
  Plus, Trash2,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import { CFP_BUCKETS, type CfpBucket } from '@/lib/cfpBuckets';

/* ---------- Types ---------- */

interface OnboardingFlowProps {
  householdId: string;
  onComplete: () => void;
}

type IncomeEntry = {
  /** Local-only id for list keying. */
  key: string;
  label: string;
  /** Annual gross. */
  amount: string;
};

type BucketDraft = {
  key: string;
  label: string;
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

function slugify(s: string) {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
}

/** Annual → monthly take-home estimate (very rough — used for CFP context only). */
function estimateMonthlyTakeHome(annualGross: number, hasPartner: boolean) {
  if (annualGross <= 0) return 0;
  // Light haircut: ~22% combined fed/FICA/state for a typical SC household.
  const factor = annualGross > 200_000 ? 0.72 : 0.78;
  return Math.round((annualGross * factor) / 12);
}

/* ---------- Bucket → starter category metadata ----------
 *
 * Maps a CFP bucket to the budget table it should land in:
 *   - "variable" → budget_categories (group: 'shared')
 *   - "fixed"    → fixed_expenses (group depends on bucket)
 *
 * We deliberately only seed buckets the user engaged with. Skipped buckets
 * create no rows — Joe's spec.
 */
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
  // Fixed bucket — pick a sensible group.
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
  const { user, profile } = useAuth();
  const [stepIdx, setStepIdx] = useState(0);
  const stepId = STEPS[stepIdx];

  /* ---- Step 2: household flags ---- */
  const [stewardship, setStewardship] = useState(true);
  const [hasKids, setHasKids] = useState(false);
  const [hasPets, setHasPets] = useState(false);

  /* ---- Step 3: income ---- */
  const [incomes, setIncomes] = useState<IncomeEntry[]>([
    { key: 'me', label: profile?.display_name || 'You', amount: '' },
  ]);
  const [hasPartner, setHasPartner] = useState(false);
  const [partnerName, setPartnerName] = useState('');

  /* ---- Step 5: budget builder ---- */
  // skipBudgetEntirely = took the "I'll set this up later" escape on entry.
  const [skipBudgetEntirely, setSkipBudgetEntirely] = useState(false);
  const [bucketIdx, setBucketIdx] = useState(0);
  const [bucketDrafts, setBucketDrafts] = useState<BucketDraft[]>([]);

  /* ---- Plaid skip flag ---- */
  const [skippedPlaid, setSkippedPlaid] = useState(false);
  const [plaidConnected, setPlaidConnected] = useState(false);

  /* ---- Submit state ---- */
  const [submitting, setSubmitting] = useState(false);

  /* Initialize household flags from existing values (so a reset preserves them
   * and re-onboarding doesn't surprise the user). */
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

  /* Initialize the bucket drafts whenever we land on Step 5 — filtered by
   * household flags so the list matches the user's life. */
  const visibleBuckets = useMemo(() => {
    return CFP_BUCKETS.filter(b => {
      if (b.key === 'kids' && !hasKids) return false;
      if (b.key === 'pets' && !hasPets) return false;
      // Stewardship-off users still see Giving — they can skip it. The bucket
      // still exists in the taxonomy.
      return true;
    });
  }, [hasKids, hasPets]);

  useEffect(() => {
    if (stepId !== 'budget' || skipBudgetEntirely) return;
    setBucketDrafts(prev => {
      if (prev.length > 0) return prev;
      return visibleBuckets.map(b => ({ key: b.key, label: b.label, amount: '' }));
    });
  }, [stepId, visibleBuckets, skipBudgetEntirely]);

  /* ---- Computed values ---- */

  const totalAnnualIncome = useMemo(
    () => incomes.reduce((s, i) => s + (Number(i.amount) || 0), 0),
    [incomes],
  );
  const monthlyTakeHome = useMemo(
    () => estimateMonthlyTakeHome(totalAnnualIncome, hasPartner),
    [totalAnnualIncome, hasPartner],
  );

  /* ---- Step nav helpers ---- */

  const goNext = () => setStepIdx(i => Math.min(STEPS.length - 1, i + 1));
  const goBack = () => setStepIdx(i => Math.max(0, i - 1));

  /* ---- Persistence ---- */

  // Save household flags (called whenever we leave Step 2 or Step 4 → Step 5).
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

  // Save income to financial_profiles (single source of truth for member_incomes).
  const persistIncome = useCallback(async () => {
    if (totalAnnualIncome <= 0) return;
    const { data: existing } = await supabase
      .from('financial_profiles')
      .select('id')
      .eq('household_id', householdId)
      .maybeSingle();

    const memberIncomes = incomes.map(i => ({
      profile_id: i.key === 'me' ? profile?.id ?? null : null,
      name: i.label || 'Member',
      gross_income: Number(i.amount) || 0,
      income_type: 'w2',
      income_sources: [],
      dob: null,
      pay_frequency: 'biweekly' as const,
    }));

    if (existing?.id) {
      await supabase
        .from('financial_profiles')
        .update({
          member_incomes: memberIncomes as any,
          annual_gross_income: totalAnnualIncome,
          state: 'SC',
        })
        .eq('id', existing.id);
    } else {
      await supabase.from('financial_profiles').insert({
        household_id: householdId,
        member_incomes: memberIncomes as any,
        annual_gross_income: totalAnnualIncome,
        state: 'SC',
        filing_status: hasPartner ? 'married_jointly' : 'single',
        income_type: 'w2',
        housing_type: 'rent',
      } as any);
    }
  }, [householdId, incomes, totalAnnualIncome, hasPartner, profile?.id]);

  // Seed only the buckets the user filled in.
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

    // Auto-map the seeded categories to their CFP buckets so the analyzer
    // works out of the box — saves the user from a second round of mapping.
    const allMappings = filled.map(f => ({
      household_id: householdId,
      category_slug: f.row.slug,
      bucket_key: f.row.slug, // bucket_key === slug because we used it as the slug
      category_kind: f.table === 'budget_categories' ? 'variable' : 'fixed',
    }));
    if (allMappings.length > 0) {
      await supabase
        .from('category_bucket_map')
        .upsert(allMappings as any, { onConflict: 'household_id,category_slug' });
    }
  }, [skipBudgetEntirely, bucketDrafts, householdId]);

  // Mark onboarding complete + persist the post-onboarding card flags.
  const finishOnboarding = useCallback(async () => {
    setSubmitting(true);
    try {
      await persistHouseholdFlags();
      await persistIncome();
      await persistBudget();

      // Persist the home-card state so the dashboard knows what to show.
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

  const canAdvanceFromIncome = totalAnnualIncome > 0;

  /* ---- Render ---- */

  const progress = ((stepIdx + 1) / STEPS.length) * 100;

  return (
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
            bucketIdx={bucketIdx}
            setBucketIdx={setBucketIdx}
            monthlyTakeHome={monthlyTakeHome}
            stewardship={stewardship}
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
        Faith-informed framing, no shame, just clarity.
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
          description="Faith-informed framing — assumes giving as a baseline, gentler tone, biblical anchors in advice."
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
 * Step 3 — Income
 * ============================================================ */
function IncomeStep({
  incomes, setIncomes, hasPartner, setHasPartner, partnerName, setPartnerName,
  canAdvance, monthlyTakeHome, onNext,
}: {
  incomes: IncomeEntry[]; setIncomes: (v: IncomeEntry[]) => void;
  hasPartner: boolean; setHasPartner: (v: boolean) => void;
  partnerName: string; setPartnerName: (v: string) => void;
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
        What's your household income?
      </h2>
      <p className="text-sm text-muted-foreground mt-1.5">
        Annual gross income before taxes. We use this to ground budget guidelines and
        analyzer math. State defaults to South Carolina — you can change it later.
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
              Annual gross income
            </label>
            <div className="flex items-baseline gap-2 border-b border-border focus-within:border-accent">
              <span className="text-lg font-semibold text-muted-foreground">$</span>
              <input
                type="number"
                inputMode="decimal"
                value={inc.amount}
                onChange={e => updateIncome(inc.key, 'amount', e.target.value)}
                className="flex-1 text-lg font-semibold text-foreground bg-transparent outline-none py-1 tabular-nums"
                placeholder="75000"
              />
            </div>
          </div>
        ))}

        <div className="bg-card rounded-xl shadow-sm p-4 flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-foreground">I have a partner</p>
            <p className="text-xs text-muted-foreground">Add their income to the household total.</p>
          </div>
          <Switch checked={hasPartner} onCheckedChange={togglePartner} />
        </div>

        {monthlyTakeHome > 0 && (
          <div className="bg-accent/10 border border-accent/30 rounded-xl p-4">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-accent">
              Estimated monthly take-home
            </p>
            <p className="text-2xl font-display font-bold text-foreground mt-1 tabular-nums">
              {formatCurrency(monthlyTakeHome)}
            </p>
            <p className="text-[11px] text-muted-foreground mt-1">
              Rough estimate after fed/FICA/SC state taxes. Refined later in your Financial Profile.
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
 * Step 5 — Budget builder (one bucket per screen)
 * ============================================================ */
function BudgetStep({
  buckets, drafts, setDrafts, bucketIdx, setBucketIdx,
  monthlyTakeHome, stewardship, skipEntirely, onSkipEntirely, onComplete,
}: {
  buckets: CfpBucket[];
  drafts: BucketDraft[];
  setDrafts: (d: BucketDraft[] | ((prev: BucketDraft[]) => BucketDraft[])) => void;
  bucketIdx: number;
  setBucketIdx: (i: number | ((prev: number) => number)) => void;
  monthlyTakeHome: number;
  stewardship: boolean;
  skipEntirely: boolean;
  onSkipEntirely: () => void;
  onComplete: () => void;
}) {
  // Intro screen — shown before any bucket is opened.
  const [showIntro, setShowIntro] = useState(true);

  if (showIntro) {
    return (
      <div>
        <div className="w-14 h-14 rounded-2xl bg-accent/15 flex items-center justify-center mb-5">
          <Wallet size={28} className="text-accent" />
        </div>
        <h2 className="font-display text-2xl font-bold tracking-tight text-foreground">
          Build your starter budget
        </h2>
        <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
          We'll walk through {buckets.length} spending buckets one at a time. Enter what
          you want to budget for each — or skip the ones that don't apply. There's no
          pressure to fill them all in.
        </p>

        <div className="mt-6 bg-card rounded-xl shadow-sm p-4 border border-border/60">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Heads up
          </p>
          <p className="text-sm text-foreground mt-1.5 leading-snug">
            CFP guidelines are <span className="font-semibold">caps and floors</span>, not
            target amounts. We'll show you the cap for context, but the number you enter
            is yours — based on what you actually spend.
          </p>
        </div>

        <button
          onClick={() => setShowIntro(false)}
          className="mt-8 w-full bg-primary text-primary-foreground font-semibold py-3.5 rounded-xl active:scale-[0.98] transition shadow-md flex items-center justify-center gap-2"
        >
          Start with bucket 1 <ChevronRight size={18} />
        </button>
        <button
          onClick={onSkipEntirely}
          className="mt-3 w-full text-sm text-muted-foreground font-medium hover:text-foreground py-2 active:scale-95 transition"
        >
          I'll set this up later
        </button>
      </div>
    );
  }

  const bucket = buckets[bucketIdx];
  const draft = drafts.find(d => d.key === bucket.key);
  const guidelinePct = bucket.guideline_pct;
  const guidelineDollar = monthlyTakeHome > 0
    ? Math.round((monthlyTakeHome * guidelinePct) / 100)
    : 0;

  const updateDraftAmount = (val: string) => {
    setDrafts(prev => prev.map(d => d.key === bucket.key ? { ...d, amount: val } : d));
  };

  const handleSkipBucket = () => {
    updateDraftAmount('');
    advance();
  };

  const advance = () => {
    if (bucketIdx >= buckets.length - 1) {
      onComplete();
    } else {
      setBucketIdx(i => i + 1);
    }
  };

  const handleContinue = () => {
    advance();
  };

  // Stewardship-aware copy for Giving / Saving (mins, not maxes)
  const isMin = bucket.guideline_kind === 'min';
  const verb = isMin ? 'at least' : 'up to';
  const capCopy = isMin
    ? `CFP guideline: at least ${guidelinePct}% of take-home`
    : `CFP guideline: ≤${guidelinePct}% of take-home`;

  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        Bucket {bucketIdx + 1} of {buckets.length}
      </p>
      <h2 className="font-display text-2xl font-bold tracking-tight text-foreground mt-1">
        {bucket.label}
      </h2>
      <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">
        {bucket.description}
      </p>

      {/* Guideline context card */}
      <div className="mt-6 bg-card rounded-xl shadow-sm p-4 border border-border/60">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Guideline
        </p>
        <p className="text-sm text-foreground mt-1.5 leading-snug">
          {capCopy}
          {monthlyTakeHome > 0 && (
            <> &middot; ~{formatCurrency(guidelineDollar)}/month for you</>
          )}
        </p>
        <p className="text-[11px] text-muted-foreground mt-2 leading-snug">
          {bucket.guideline_source}
        </p>
      </div>

      {/* Amount input */}
      <div className="mt-6">
        <label className="block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
          What do you want to budget for {bucket.label}?
        </label>
        <div className="flex items-baseline gap-2 border-b-2 border-border focus-within:border-accent py-1">
          <span className="text-2xl font-display font-bold text-muted-foreground">$</span>
          <input
            type="number"
            inputMode="decimal"
            value={draft?.amount ?? ''}
            onChange={e => updateDraftAmount(e.target.value)}
            className="flex-1 text-2xl font-display font-bold text-foreground bg-transparent outline-none tabular-nums"
            placeholder="0"
            autoFocus
          />
          <span className="text-sm text-muted-foreground font-medium">/ month</span>
        </div>
        <p className="text-[11px] text-muted-foreground mt-2">
          Enter your number. {isMin ? `Aim ${verb} the guideline if you can.` : `Most households budget below the cap.`}
        </p>
      </div>

      <div className="mt-10 flex flex-col gap-3">
        <button
          onClick={handleContinue}
          className="w-full bg-primary text-primary-foreground font-semibold py-3.5 rounded-xl active:scale-[0.98] transition shadow-md flex items-center justify-center gap-2"
        >
          {bucketIdx >= buckets.length - 1 ? 'Finish budget' : 'Next bucket'}
          {bucketIdx >= buckets.length - 1 ? <Check size={18} /> : <ChevronRight size={18} />}
        </button>
        <button
          onClick={handleSkipBucket}
          className="text-sm text-muted-foreground font-medium hover:text-foreground py-2 active:scale-95 transition"
        >
          Skip {bucket.label}
        </button>
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
