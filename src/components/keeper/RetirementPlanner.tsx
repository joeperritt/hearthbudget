import { useState, useEffect, useMemo, useCallback } from 'react';
import { ArrowLeft, Info, CheckCircle2, AlertTriangle, Sparkles, RefreshCw } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToolState } from '@/hooks/useToolState';
import { ageFromDob } from '@/lib/ageUtils';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ContextualAskAI } from './ContextualAskAI';
import { AIInsightsList, parseAIInsights, type AIInsight } from './AIInsightsList';
import { formatDistanceToNow } from 'date-fns';

interface RetirementPlannerProps {
  onBack: () => void;
  householdId: string | null;
  onNavigateToProfile?: (tab?: string) => void;
  onNavigateToBudget?: (monthKey?: string) => void;
  onNavigateToPlanTool?: (toolId: import('@/lib/aiNavigation').PlanToolId) => void;
}

function fmt(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n || 0);
}

// Fidelity age-based salary multiples
const AGE_MULTIPLES: { age: number; mult: number }[] = [
  { age: 30, mult: 1 },
  { age: 40, mult: 3 },
  { age: 50, mult: 6 },
  { age: 60, mult: 8 },
  { age: 67, mult: 10 },
];

function targetMultipleForAge(age: number): { mult: number; label: string } {
  if (age < 30) return { mult: 1, label: 'by age 30' };
  for (let i = 0; i < AGE_MULTIPLES.length - 1; i++) {
    const cur = AGE_MULTIPLES[i];
    const next = AGE_MULTIPLES[i + 1];
    if (age >= cur.age && age < next.age) {
      // linear interpolation between brackets for a smoother target
      const t = (age - cur.age) / (next.age - cur.age);
      const mult = cur.mult + (next.mult - cur.mult) * t;
      return { mult, label: `at age ${age} (between ${cur.mult}x by ${cur.age} and ${next.mult}x by ${next.age})` };
    }
  }
  return { mult: 10, label: 'at age 67+' };
}

function GuidelineCard({
  icon: Icon, title, benchmark, status, statusColor, body, source,
}: {
  icon: typeof Info;
  title: string;
  benchmark: string;
  status: 'on-track' | 'behind' | 'info';
  statusColor: string;
  body: React.ReactNode;
  source: string;
}) {
  const StatusIcon = status === 'on-track' ? CheckCircle2 : status === 'behind' ? AlertTriangle : Info;
  return (
    <div className="bg-card rounded-xl shadow-sm border border-border/40 p-4">
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-lg bg-accent/10 flex items-center justify-center shrink-0">
          <Icon size={18} className="text-accent" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-display text-base font-semibold text-foreground">{title}</h3>
          <p className="text-xs text-muted-foreground mt-0.5">{benchmark}</p>
        </div>
        <StatusIcon size={18} className={`shrink-0 mt-1 ${statusColor}`} />
      </div>
      <div className="mt-3 text-sm text-foreground/90 leading-relaxed">{body}</div>
      <p className="mt-3 text-[10px] text-muted-foreground/70 italic">Source: {source}</p>
    </div>
  );
}

export function RetirementPlanner({ onBack, householdId, onNavigateToProfile }: RetirementPlannerProps) {
  const [profile, setProfile] = useState<any>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [insights, setInsights] = useState<AIInsight[]>([]);
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [insightsError, setInsightsError] = useState<string | null>(null);
  const [insightsUpdated, setInsightsUpdated] = useState<Date | null>(null);

  const { state, setState, loaded: toolStateLoaded } = useToolState(householdId, 'retirement-planner', {
    annualContribution: '',  // total household $ saved per year incl. employer match
  });

  useEffect(() => {
    if (!householdId) { setProfileLoading(false); return; }
    (async () => {
      const { data } = await supabase.from('financial_profiles').select('*').eq('household_id', householdId).maybeSingle();
      setProfile(data || null);
      setProfileLoading(false);
    })();
  }, [householdId]);

  const metrics = useMemo(() => {
    const fp = profile || {};
    const members: any[] = Array.isArray(fp.member_incomes) ? fp.member_incomes : [];
    const grossIncome = members.reduce((s, m) => {
      const sources = Array.isArray(m.income_sources) ? m.income_sources : [];
      const fromSources = sources.reduce((a: number, src: any) => a + (Number(src.amount) || 0), 0);
      return s + (fromSources > 0 ? fromSources : Number(m.gross_income) || 0);
    }, 0);
    const ages = members.map(m => m.dob ? ageFromDob(m.dob) : undefined).filter((a): a is number => typeof a === 'number');
    const primaryAge = ages.length > 0 ? Math.min(...ages) : null;

    const preTax = Number(fp.retirement_balance) || 0;
    const roth = Number(fp.roth_retirement_balance) || 0;
    const nonRet = Number(fp.non_retirement_investments) || 0;
    const totalRetirement = preTax + roth;

    const annualContribution = Number(state.annualContribution) || 0;
    const savingsRate = grossIncome > 0 ? annualContribution / grossIncome : 0;

    const salaryMultiple = grossIncome > 0 ? totalRetirement / grossIncome : 0;
    const ageTarget = primaryAge !== null ? targetMultipleForAge(primaryAge) : null;

    const rothShare = totalRetirement > 0 ? roth / totalRetirement : 0;

    return {
      grossIncome, primaryAge, preTax, roth, nonRet, totalRetirement,
      annualContribution, savingsRate, salaryMultiple, ageTarget, rothShare,
    };
  }, [profile, state.annualContribution]);

  const fetchInsights = useCallback(async () => {
    setInsightsLoading(true);
    setInsightsError(null);
    try {
      const systemPrompt = `You are a Certified Financial Planner (CFP®) and Certified Kingdom Advisor (CKA) commenting on a household's retirement readiness against published industry guidelines (Fidelity savings rate and age-based salary multiples). DO NOT generate specific dollar projections of future retirement income or "you'll have $X at retirement" estimates — those are out of scope.

Your job is to give 3 short benchmark-comparison insights:
1. Savings rate vs. the 15% guideline.
2. Age-based salary multiple vs. the Fidelity targets (1x@30, 3x@40, 6x@50, 8x@60, 10x@67).
3. One of: tax diversification (mix of pre-tax vs. Roth) OR asset allocation framing OR overall encouragement.

Tone: encouraging, never prescriptive. Cite real numbers from the data. Frame as "guidelines suggest" not "you must." If a metric can't be calculated (income missing, age missing), say what the user needs to fill in.

Return a JSON array of exactly 3 objects with: 'type' ('warning' | 'tip' | 'encouragement'), 'title' (≤5 words), 'body' (2 sentences max), 'nextStep' ({ 'action': string, 'destination': string }).

Valid destination strings: "Financial Profile > Income", "Financial Profile > Accounts", "Financial Profile > Profile", "Plan > Retirement Planner", "Budget".

Return ONLY the JSON array, no markdown, no prose.`;

      const prompt = `Household retirement snapshot vs. CFP/Fidelity guidelines:

- Combined annual gross income: ${fmt(metrics.grossIncome)}
- Primary (youngest) member age: ${metrics.primaryAge ?? 'unknown'}
- Total retirement balance: ${fmt(metrics.totalRetirement)} (Pre-tax ${fmt(metrics.preTax)}, Roth ${fmt(metrics.roth)})
- Non-retirement investments: ${fmt(metrics.nonRet)}
- Reported annual retirement contribution (incl. employer match): ${fmt(metrics.annualContribution)}
- Computed savings rate: ${(metrics.savingsRate * 100).toFixed(1)}% (guideline: 15%)
- Computed salary multiple: ${metrics.salaryMultiple.toFixed(2)}x ${metrics.ageTarget ? `(guideline target ${metrics.ageTarget.mult.toFixed(1)}x ${metrics.ageTarget.label})` : ''}
- Roth share of retirement balance: ${(metrics.rothShare * 100).toFixed(0)}%

Generate exactly 3 benchmark-comparison insights per the system instructions.`;

      const { data, error: fnError } = await supabase.functions.invoke('budget-insights', {
        body: { prompt, systemPrompt, householdId },
      });
      if (fnError) throw new Error(fnError.message);
      if (data?.error) throw new Error(data.error);
      const raw = data?.insights ?? data?.content ?? '';
      setInsights(parseAIInsights(raw).slice(0, 3));
      setInsightsUpdated(new Date());
    } catch (e: any) {
      setInsightsError(e?.message || 'Failed to generate insights');
    } finally {
      setInsightsLoading(false);
    }
  }, [metrics, householdId]);

  if (profileLoading || !toolStateLoaded) {
    return (
      <div className="max-w-lg mx-auto px-6 pt-12 safe-top">
        <div className="animate-pulse space-y-4">
          <div className="h-6 bg-muted rounded w-2/3" />
          <div className="h-24 bg-muted rounded-xl" />
          <div className="h-24 bg-muted rounded-xl" />
        </div>
      </div>
    );
  }

  // Status helpers
  const savingsStatus: 'on-track' | 'behind' | 'info' =
    metrics.grossIncome === 0 ? 'info' : metrics.savingsRate >= 0.15 ? 'on-track' : 'behind';
  const multipleStatus: 'on-track' | 'behind' | 'info' =
    !metrics.ageTarget || metrics.grossIncome === 0
      ? 'info'
      : metrics.salaryMultiple >= metrics.ageTarget.mult ? 'on-track' : 'behind';
  const diversificationStatus: 'on-track' | 'behind' | 'info' =
    metrics.totalRetirement === 0
      ? 'info'
      : metrics.rothShare >= 0.2 && metrics.rothShare <= 0.8 ? 'on-track' : 'behind';

  return (
    <div className="max-w-lg mx-auto pb-32">
      {/* Header */}
      <div className="px-6 pt-12 safe-top">
        <button onClick={onBack} className="p-1.5 -ml-1.5 rounded-lg hover:bg-muted active:scale-95 transition-transform">
          <ArrowLeft size={20} className="text-foreground" />
        </button>
        <h1 className="font-display text-2xl lg:text-3xl font-bold tracking-tight text-foreground mt-2">Retirement Planner</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Your retirement vs. published CFP guidelines</p>
      </div>

      {/* Disclaimer banner */}
      <div className="px-6 mt-5">
        <div className="rounded-xl border border-accent/30 bg-accent/5 p-4 flex items-start gap-3">
          <Info size={18} className="text-accent shrink-0 mt-0.5" />
          <p className="text-xs text-foreground/90 leading-relaxed">
            Guidelines below are based on standard assumptions: retirement at age 65, 7% annual return, 2.5% inflation. Every situation is different —
            for personalized planning, consult a Certified Financial Planner (CFP).
          </p>
        </div>
      </div>

      {/* Inputs */}
      <div className="px-6 mt-6">
        <h2 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-3">Your numbers</h2>
        <div className="bg-card rounded-xl shadow-sm border border-border/40 p-4 space-y-4">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <p className="text-xs text-muted-foreground">Combined gross income</p>
              <p className="font-semibold text-foreground">{fmt(metrics.grossIncome)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Primary member age</p>
              <p className="font-semibold text-foreground">{metrics.primaryAge ?? '—'}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Pre-tax balance</p>
              <p className="font-semibold text-foreground">{fmt(metrics.preTax)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Roth balance</p>
              <p className="font-semibold text-foreground">{fmt(metrics.roth)}</p>
            </div>
          </div>
          {(metrics.grossIncome === 0 || metrics.primaryAge === null) && (
            <button
              onClick={() => onNavigateToProfile?.('income')}
              className="text-xs font-semibold text-accent active:opacity-70"
            >
              Complete Financial Profile →
            </button>
          )}
          <div>
            <Label htmlFor="annual-contrib" className="text-xs">Annual retirement savings (incl. employer match)</Label>
            <Input
              id="annual-contrib"
              inputMode="decimal"
              placeholder="e.g. 18000"
              value={state.annualContribution}
              onChange={e => setState({ annualContribution: e.target.value })}
              className="mt-1"
            />
            <p className="text-[10px] text-muted-foreground mt-1">Used to compare your savings rate against the 15% guideline.</p>
          </div>
        </div>
      </div>

      {/* Guideline cards */}
      <div className="px-6 mt-6 space-y-3">
        <h2 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">CFP guidelines</h2>

        <GuidelineCard
          icon={CheckCircle2}
          title="Savings rate"
          benchmark="Save 15% of gross income (incl. employer match)"
          status={savingsStatus}
          statusColor={savingsStatus === 'on-track' ? 'text-emerald-600' : savingsStatus === 'behind' ? 'text-amber-600' : 'text-muted-foreground'}
          body={
            metrics.grossIncome === 0 ? (
              <p className="text-muted-foreground">Add household income in your Financial Profile to compare.</p>
            ) : (
              <p>You're saving <strong>{fmt(metrics.annualContribution)}</strong> per year, which is <strong>{(metrics.savingsRate * 100).toFixed(1)}%</strong> of your gross income. The Fidelity guideline is 15%.</p>
            )
          }
          source='Fidelity Investments, "How much should I save for retirement?" — also reflected in CFP Board curriculum.'
        />

        <GuidelineCard
          icon={Info}
          title="Age-based salary multiple"
          benchmark="1x@30 · 3x@40 · 6x@50 · 8x@60 · 10x@67"
          status={multipleStatus}
          statusColor={multipleStatus === 'on-track' ? 'text-emerald-600' : multipleStatus === 'behind' ? 'text-amber-600' : 'text-muted-foreground'}
          body={
            metrics.grossIncome === 0 || metrics.primaryAge === null ? (
              <p className="text-muted-foreground">Add age and income in your Financial Profile to compare.</p>
            ) : (
              <p>
                Current retirement balance is <strong>{fmt(metrics.totalRetirement)}</strong>, or <strong>{metrics.salaryMultiple.toFixed(2)}x</strong> your gross income.
                {metrics.ageTarget && <> Guideline target {metrics.ageTarget.label} is <strong>{metrics.ageTarget.mult.toFixed(1)}x</strong>.</>}
              </p>
            )
          }
          source="Fidelity Investments retirement savings guidelines."
        />

        <GuidelineCard
          icon={Info}
          title="Tax diversification"
          benchmark="Mix of pre-tax and Roth for retirement flexibility"
          status={diversificationStatus}
          statusColor={diversificationStatus === 'on-track' ? 'text-emerald-600' : 'text-muted-foreground'}
          body={
            metrics.totalRetirement === 0 ? (
              <p className="text-muted-foreground">Add retirement balances in your Financial Profile to compare.</p>
            ) : (
              <p>Roth makes up <strong>{(metrics.rothShare * 100).toFixed(0)}%</strong> of your retirement balance ({fmt(metrics.roth)} of {fmt(metrics.totalRetirement)}). A blend of pre-tax and Roth gives flexibility on retirement-era tax brackets.</p>
            )
          }
          source="Standard CFP planning practice."
        />

        <GuidelineCard
          icon={Info}
          title="Asset allocation"
          benchmark="Match risk profile to time horizon"
          status="info"
          statusColor="text-muted-foreground"
          body={
            <p>A longer runway to retirement allows more growth-oriented investing; closer to retirement, exposure typically shifts toward stability. Allocation specifics belong to your investment provider — Keeper does not pull live holdings.</p>
          }
          source="Standard CFP planning practice (CFP Board curriculum)."
        />
      </div>

      {/* AI Insights */}
      <div className="px-6 mt-6">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-1.5">
            <Sparkles size={14} className="text-accent" />
            <h3 className="text-xs font-semibold text-muted-foreground">AI Insights</h3>
          </div>
          <button onClick={fetchInsights} disabled={insightsLoading} className="flex items-center gap-1 text-xs text-accent font-medium active:opacity-70 disabled:opacity-50">
            <RefreshCw size={12} className={insightsLoading ? 'animate-spin' : ''} />
            {insightsLoading ? 'Loading…' : insights.length > 0 ? 'Refresh' : 'Generate'}
          </button>
        </div>
        {insightsLoading && insights.length === 0 ? (
          <div className="space-y-2">
            {[1, 2].map(i => (
              <div key={i} className="bg-card rounded-lg shadow-sm p-4 animate-pulse">
                <div className="h-3 bg-muted rounded w-1/3 mb-2" />
                <div className="h-2 bg-muted rounded w-full mb-1" />
                <div className="h-2 bg-muted rounded w-2/3" />
              </div>
            ))}
          </div>
        ) : insightsError ? (
          <div className="bg-card rounded-lg shadow-sm px-4 py-4 border-l-[3px] border-l-destructive">
            <p className="text-sm font-semibold text-foreground">Insights unavailable</p>
            <p className="text-xs text-muted-foreground mt-0.5">{insightsError}</p>
          </div>
        ) : insights.length === 0 ? (
          <div className="bg-card rounded-lg shadow-sm px-4 py-6 flex flex-col items-center">
            <Sparkles size={20} className="text-muted-foreground/30 mb-2" />
            <p className="text-sm text-muted-foreground">Tap Generate for AI commentary on these benchmarks</p>
          </div>
        ) : (
          <AIInsightsList insights={insights} />
        )}
        {insightsUpdated && !insightsError && (
          <p className="text-[10px] text-muted-foreground/60 mt-1.5 text-center">
            Updated {formatDistanceToNow(insightsUpdated, { addSuffix: true })}
          </p>
        )}
      </div>

      {/* Ask AI */}
      <ContextualAskAI
        contextLabel="Retirement"
        contextPreface={`The user is on the Retirement Planner viewing CFP guideline benchmarks (savings rate, age-based salary multiples, tax diversification, asset allocation). Their data: gross income ${fmt(metrics.grossIncome)}, age ${metrics.primaryAge ?? 'unknown'}, total retirement ${fmt(metrics.totalRetirement)} (pre-tax ${fmt(metrics.preTax)}, Roth ${fmt(metrics.roth)}), annual contribution ${fmt(metrics.annualContribution)}, savings rate ${(metrics.savingsRate * 100).toFixed(1)}%, salary multiple ${metrics.salaryMultiple.toFixed(2)}x. Discuss benchmarks; do NOT make specific projections of future retirement income.`}
      />
    </div>
  );
}
