import { useState, useMemo, useEffect, useCallback } from 'react';
import { ArrowLeft, Sparkles, Loader2, Info, CheckCircle2, AlertTriangle, RefreshCw, ChevronDown, ChevronRight, ArrowRight } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { supabase } from '@/integrations/supabase/client';
import { useToolState } from '@/hooks/useToolState';
import { formatDistanceToNow } from 'date-fns';
import { AIInsightsList, parseAIInsights, type AIInsight } from './AIInsightsList';
import type { PlanToolId } from '@/lib/aiNavigation';

type ProfileTab = 'profile' | 'income' | 'housing' | 'debts' | 'accounts' | 'insurance';

function fmt(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);
}

interface EmergencyFundAnalysisProps {
  onBack: () => void;
  householdId: string | null;
  onNavigateToProfile?: (tab?: ProfileTab) => void;
  onNavigateToBudget?: (monthKey: string) => void;
  onNavigateToPlanTool?: (toolId: PlanToolId) => void;
  householdMembers?: { primaryName: string; partnerName: string | null };
}

type IncomeStability = 'very-stable' | 'stable' | 'variable' | 'self-employed';

interface EFState {
  householdType: 'single' | 'dual';
  householdTypeOverridden: boolean;
  nonEssentialBackout: string;
  primaryStability: IncomeStability;
  secondaryStability: IncomeStability;
}

const defaultState: EFState = {
  householdType: 'single',
  householdTypeOverridden: false,
  nonEssentialBackout: '0',
  primaryStability: 'stable',
  secondaryStability: 'stable',
};

function getRecommendedMonths(s: EFState, dependents: number): [number, number] {
  const deps = Math.max(0, dependents - 2);
  const extra = deps > 0 ? deps : 0;

  if (s.householdType === 'single') {
    const isVariable = s.primaryStability === 'variable' || s.primaryStability === 'self-employed';
    if (isVariable) return [9 + extra, 12 + extra];
    return [6 + extra, 6 + extra];
  }

  const p = s.primaryStability;
  const sec = s.secondaryStability;
  const bothStable = (p === 'very-stable' || p === 'stable') && (sec === 'very-stable' || sec === 'stable');
  const bothVariable = (p === 'variable' || p === 'self-employed') && (sec === 'variable' || sec === 'self-employed');
  const oneVariable = !bothStable && !bothVariable;

  if (bothStable) return [3 + extra, 4 + extra];
  if (oneVariable) return [5 + extra, 6 + extra];
  return [6 + extra, 9 + extra];
}

export function EmergencyFundAnalysis({ onBack, householdId, onNavigateToProfile, onNavigateToBudget, onNavigateToPlanTool, householdMembers }: EmergencyFundAnalysisProps) {
  const { state, setState, loaded } = useToolState<EFState>(householdId, 'emergency-fund', defaultState);
  const [profileLoading, setProfileLoading] = useState(true);
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [totalBudget, setTotalBudget] = useState(0);
  const [profileBalance, setProfileBalance] = useState(0);
  const [profileDependents, setProfileDependents] = useState(0);
  const [efContribution, setEfContribution] = useState(0);
  const [earnerNames, setEarnerNames] = useState<{ primary: string; secondary: string | null }>({ primary: 'Primary', secondary: null });
  const [showWhy, setShowWhy] = useState(false);

  // AI Insights
  const [aiInsights, setAiInsights] = useState<AIInsight[]>([]);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiLastUpdated, setAiLastUpdated] = useState<Date | null>(null);

  // Next upcoming month (e.g., "May 2026")
  const nextMonth = useMemo(() => {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() + 1);
    return {
      key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
      label: d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
    };
  }, []);

  // Load financial profile & budget
  useEffect(() => {
    if (!householdId || profileLoaded) return;
    Promise.all([
      supabase.from('financial_profiles').select('*').eq('household_id', householdId).maybeSingle(),
      supabase.from('budget_categories').select('budgeted').eq('household_id', householdId),
      supabase.from('fixed_expenses').select('amount').eq('household_id', householdId),
    ]).then(([fpRes, catRes, feRes]) => {
      const fp = fpRes.data;
      const updates: Partial<EFState> = {};

      if (fp) {
        const members = Array.isArray(fp.member_incomes) ? (fp.member_incomes as any[]) : [];
        const earners = members.filter(m => Number(m?.gross_income) > 0);
        const smartHouseholdType: 'single' | 'dual' = earners.length >= 2 ? 'dual' : 'single';
        if (!state.householdTypeOverridden) {
          updates.householdType = smartHouseholdType;
        }

        // Map earner names from member_incomes (fallback to profile names)
        const primaryName = earners[0]?.name || householdMembers?.primaryName || 'Primary';
        const secondaryName = earners[1]?.name || (earners.length >= 2 ? householdMembers?.partnerName || 'Second Earner' : null);
        setEarnerNames({ primary: primaryName, secondary: secondaryName });

        const deps = Array.isArray(fp.dependents) ? (fp.dependents as any[]) : [];
        setProfileDependents(deps.length);
        setProfileBalance(Number(fp.emergency_fund_balance) || 0);

        const additions = (fp.monthly_additions_per_key as Record<string, number>) || {};
        setEfContribution(Number(additions['savings_ef']) || 0);
      }

      const catTotal = (catRes.data || []).reduce((s: number, c: any) => s + (Number(c.budgeted) || 0), 0);
      const feTotal = (feRes.data || []).reduce((s: number, e: any) => s + (Number(e.amount) || 0), 0);
      const budget = Math.round(catTotal + feTotal);
      setTotalBudget(budget);

      if (Object.keys(updates).length > 0) setState(updates);
      setProfileLoading(false);
      setProfileLoaded(true);
    });
  }, [householdId, profileLoaded, householdMembers]);

  const nonEssential = Number(state.nonEssentialBackout) || 0;
  const adjustedExpenses = Math.max(0, totalBudget - nonEssential);
  const balance = profileBalance;
  const [recLow, recHigh] = useMemo(() => getRecommendedMonths(state, profileDependents), [state, profileDependents]);
  const targetLow = adjustedExpenses * recLow;
  const targetHigh = adjustedExpenses * recHigh;
  const coverageMonths = adjustedExpenses > 0 ? balance / adjustedExpenses : 0;
  const shortfall = Math.max(0, targetLow - balance);
  const surplus = balance > targetHigh ? balance - targetHigh : 0;

  // Three-tier status
  const coverageRatio = targetLow > 0 ? balance / targetLow : (balance > 0 ? 1 : 0);
  let status: 'critical' | 'attention' | 'on-track' = 'critical';
  if (coverageRatio >= 1) status = 'on-track';
  else if (coverageRatio >= 0.5) status = 'attention';

  const monthly12 = shortfall > 0 ? Math.ceil(shortfall / 12) : 0;
  const monthly24 = shortfall > 0 ? Math.ceil(shortfall / 24) : 0;

  // AI Insights
  const fetchInsights = useCallback(async () => {
    if (!householdId) return;
    setAiLoading(true);
    try {
      const systemPrompt = `You are a Certified Financial Planner (CFP®) and Certified Kingdom Advisor (CKA®) analyzing a household's emergency fund. Provide exactly 3 warm, specific, stewardship-framed insights using the numbers provided. Reference specific dollar amounts and months of coverage.

Each insight MUST include a "nextStep" object with:
- "action": a concrete, imperative next step (e.g., "Redirect $250/mo from dining out to emergency fund").
- "destination": EXACTLY ONE of these route strings (pick the most relevant):
  "Financial Profile > Accounts", "Financial Profile > Insurance", "Financial Profile > Housing", "Financial Profile > Debts", "Financial Profile > Profile", "Financial Profile > Income", "Budget", "Plan > Emergency Fund Analysis", "Plan > Non-Retirement Goals", "Plan > Retirement Planner", "Plan > Mortgage Analyzer", "Plan > Debt Payoff Analyzer", "Plan > Life Insurance Analysis".

Return a JSON array of 3 objects with keys: "type" (warning | encouragement | tip | savings), "title" (max 5 words), "body" (2-3 sentences with specific numbers, no markdown), and "nextStep" ({ "action", "destination" }). Do NOT use markdown formatting. Return ONLY the JSON array.`;

      const stabilityLine = state.householdType === 'dual'
        ? `- ${earnerNames.primary} stability: ${state.primaryStability}\n- ${earnerNames.secondary || 'Second earner'} stability: ${state.secondaryStability}`
        : `- ${earnerNames.primary} stability: ${state.primaryStability}`;

      const prompt = `Household emergency fund snapshot:
- Current emergency fund balance: ${fmt(balance)}
- Monthly essential expenses (raw budget): ${fmt(totalBudget)}
- Non-essential backed out: ${fmt(nonEssential)}
- Adjusted essential monthly expenses: ${fmt(adjustedExpenses)}
- Household type: ${state.householdType}
${stabilityLine}
- Dependents: ${profileDependents}
- Current monthly contribution to emergency fund: ${fmt(efContribution)}
- CFP target range: ${recLow}-${recHigh} months (${fmt(targetLow)}–${fmt(targetHigh)})
- Current coverage: ${coverageMonths.toFixed(1)} months
- Shortfall to low target: ${fmt(shortfall)}
- Status: ${status}

Generate 3 insights with nextStep actions per the system instructions.`;

      const { data, error: fnError } = await supabase.functions.invoke('budget-insights', {
        body: { prompt, systemPrompt, householdId },
      });
      if (fnError) throw new Error(fnError.message || 'Edge function call failed');
      if (data?.error) throw new Error(data.error);
      const raw = data?.insights ?? data?.content ?? '';
      const parsed = parseAIInsights(raw);
      setAiInsights(parsed.slice(0, 3));
      setAiLastUpdated(new Date());
    } catch (e) {
      console.error('AI insights error:', e);
    }
    setAiLoading(false);
  }, [householdId, balance, adjustedExpenses, coverageMonths, recLow, recHigh, status, shortfall, state, profileDependents, totalBudget, nonEssential, targetLow, targetHigh, efContribution, earnerNames]);

  if (!loaded || profileLoading) {
    return (
      <div className="max-w-lg mx-auto px-6 pt-12 safe-top">
        <div className="animate-pulse space-y-4">
          <div className="h-6 bg-muted rounded w-1/2" />
          <div className="h-40 bg-muted rounded-xl" />
        </div>
      </div>
    );
  }

  const statusConfig = {
    'on-track': {
      label: surplus > 0 ? 'Excellent — Well Funded' : 'On Track',
      sub: `${coverageMonths.toFixed(1)} months of essential expenses covered`,
      bg: 'bg-green-50 border-green-200',
      text: 'text-green-700',
      bar: 'bg-green-500',
      icon: <CheckCircle2 size={24} className="text-green-600" />,
    },
    'attention': {
      label: 'Needs Attention',
      sub: `${coverageMonths.toFixed(1)} months of essential expenses covered`,
      bg: 'bg-yellow-50 border-yellow-200',
      text: 'text-yellow-700',
      bar: 'bg-yellow-500',
      icon: <AlertTriangle size={24} className="text-yellow-600" />,
    },
    'critical': {
      label: 'Critical',
      sub: `${coverageMonths.toFixed(1)} months of essential expenses covered`,
      bg: 'bg-red-50 border-red-200',
      text: 'text-destructive',
      bar: 'bg-destructive',
      icon: <AlertTriangle size={24} className="text-destructive" />,
    },
  }[status];

  return (
    <div className="max-w-lg mx-auto pb-32">
      {/* Header */}
      <div className="px-6 pt-12 safe-top flex items-center gap-3">
        <button onClick={onBack} className="p-1.5 -ml-1.5 rounded-lg hover:bg-muted">
          <ArrowLeft size={20} className="text-foreground" />
        </button>
        <div>
          <h1 className="font-display text-xl font-bold text-foreground">Emergency Fund Analysis</h1>
          <p className="text-sm text-muted-foreground mt-0.5">How long could your household cover expenses without income?</p>
        </div>
      </div>

      {/* Status banner */}
      <div className="px-6 mt-6">
        <div className={`rounded-xl p-5 border ${statusConfig.bg}`}>
          <div className="flex items-center gap-3">
            {statusConfig.icon}
            <div>
              <p className={`font-display font-bold ${statusConfig.text}`}>{statusConfig.label}</p>
              <p className="text-sm text-muted-foreground mt-0.5">{statusConfig.sub}</p>
            </div>
          </div>
          <div className="mt-4">
            <div className="flex justify-between text-xs text-muted-foreground mb-1">
              <span>{fmt(balance)} saved</span>
              <span>{fmt(targetLow)}–{fmt(targetHigh)} target</span>
            </div>
            <div className="h-3 bg-white/60 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${statusConfig.bar}`}
                style={{ width: `${Math.min(100, targetHigh > 0 ? (balance / targetHigh) * 100 : 0)}%` }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Your Situation */}
      <div className="px-6 mt-6">
        <div className="bg-card rounded-xl p-4 shadow-sm space-y-3">
          <p className="text-sm font-semibold text-foreground">Your Situation</p>

          {/* Row 1: Budget + Non-Essential */}
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col">
              <div className="h-9 flex items-end">
                <Label className="text-xs text-muted-foreground leading-tight">Current Monthly Budget</Label>
              </div>
              <div className="mt-1 bg-muted/50 rounded-lg px-3 h-[38px] flex items-center">
                <p className="text-sm font-semibold text-foreground tabular-nums">{fmt(totalBudget)}</p>
              </div>
              <button
                onClick={() => onNavigateToBudget ? onNavigateToBudget(nextMonth.key) : onBack()}
                className="mt-1 text-[10px] text-accent font-medium hover:underline text-left"
              >
                From {nextMonth.label} Budget →
              </button>
            </div>
            <div className="flex flex-col">
              <div className="h-9 flex items-end gap-1">
                <Label className="text-xs text-muted-foreground leading-tight">Non-Essential to Back Out</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <button type="button" className="text-muted-foreground hover:text-foreground" aria-label="More info">
                      <Info size={11} />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent side="top" className="max-w-[260px] text-xs p-3">
                    Think about what you would cut immediately if income stopped: dining out, subscriptions, entertainment, clothing, travel, etc.
                  </PopoverContent>
                </Popover>
              </div>
              <div className="relative mt-1">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
                <Input
                  type="text"
                  inputMode="numeric"
                  className="pl-7 h-[38px]"
                  value={
                    state.nonEssentialBackout && state.nonEssentialBackout !== '0'
                      ? Number(String(state.nonEssentialBackout).replace(/[^0-9.]/g, '') || 0).toLocaleString('en-US')
                      : ''
                  }
                  onChange={e => {
                    const raw = e.target.value.replace(/[^0-9.]/g, '');
                    setState({ nonEssentialBackout: raw });
                  }}
                  placeholder="0"
                />
              </div>
            </div>
          </div>

          {/* Adjusted essential expenses (subtle line) */}
          <div className="flex items-center justify-between text-xs border-t border-border pt-2">
            <span className="text-muted-foreground">Adjusted Essential Monthly Expenses</span>
            <span className="font-semibold text-foreground tabular-nums">{fmt(adjustedExpenses)}</span>
          </div>

          {/* Row 2: Household Type + Dependents */}
          <div className="grid grid-cols-2 gap-3 pt-1">
            <div>
              <Label className="text-xs text-muted-foreground">Household Type</Label>
              <div className="flex mt-1 bg-muted rounded-lg p-0.5">
                {(['single', 'dual'] as const).map(t => (
                  <button
                    key={t}
                    onClick={() => setState({ householdType: t, householdTypeOverridden: true })}
                    className={`flex-1 py-1.5 text-[11px] font-semibold rounded-md transition-colors ${
                      state.householdType === t ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'
                    }`}
                  >
                    {t === 'single' ? 'Single' : 'Dual'}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Dependents</Label>
              <div className="mt-1 bg-muted/50 rounded-lg px-3 py-2.5">
                <p className="text-sm font-semibold text-foreground tabular-nums">{profileDependents}</p>
              </div>
              {onNavigateToProfile && (
                <button onClick={() => onNavigateToProfile('profile')} className="mt-1 text-[10px] text-accent font-medium hover:underline">
                  From Financial Profile →
                </button>
              )}
            </div>
          </div>

          {/* Row 3: Stability dropdowns */}
          <div className={`grid ${state.householdType === 'dual' ? 'grid-cols-2' : 'grid-cols-1'} gap-3`}>
            <div>
              <Label className="text-xs text-muted-foreground">
                {state.householdType === 'dual' ? `${earnerNames.primary}'s Stability` : `${earnerNames.primary}'s Stability`}
              </Label>
              <Select value={state.primaryStability} onValueChange={(v: IncomeStability) => setState({ primaryStability: v })}>
                <SelectTrigger className="mt-1 h-[38px] text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="very-stable">Very Stable (Gov, Tenured)</SelectItem>
                  <SelectItem value="stable">Stable (Salaried, W-2)</SelectItem>
                  <SelectItem value="variable">Variable (Commission)</SelectItem>
                  <SelectItem value="self-employed">Self-Employed</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {state.householdType === 'dual' && (
              <div>
                <Label className="text-xs text-muted-foreground">{earnerNames.secondary || 'Second Earner'}'s Stability</Label>
                <Select value={state.secondaryStability} onValueChange={(v: IncomeStability) => setState({ secondaryStability: v })}>
                  <SelectTrigger className="mt-1 h-[38px] text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="very-stable">Very Stable (Gov, Tenured)</SelectItem>
                    <SelectItem value="stable">Stable (Salaried, W-2)</SelectItem>
                    <SelectItem value="variable">Variable (Commission)</SelectItem>
                    <SelectItem value="self-employed">Self-Employed</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          {/* Row 4: Current Emergency Fund Balance */}
          <div>
            <Label className="text-xs text-muted-foreground">Current Emergency Fund Balance</Label>
            <div className="mt-1 bg-muted/50 rounded-lg px-3 py-2.5">
              <p className="text-sm font-semibold text-foreground tabular-nums">{fmt(profileBalance)}</p>
            </div>
            {onNavigateToProfile && (
              <button onClick={() => onNavigateToProfile('accounts')} className="mt-1 text-[10px] text-accent font-medium hover:underline">
                From Financial Profile →
              </button>
            )}
          </div>
        </div>
      </div>

      {/* CFP Recommendation */}
      <div className="px-6 mt-4">
        <div className="bg-card rounded-xl p-4 shadow-sm">
          <p className="text-sm font-semibold text-foreground mb-3">
            CFP® Recommendation: {recLow === recHigh ? `${recLow} months` : `${recLow}–${recHigh} months`}
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-muted/50 rounded-lg p-3">
              <p className="text-xs font-semibold text-foreground">Low Target</p>
              <p className="text-lg font-bold text-primary mt-1 tabular-nums">{fmt(targetLow)}</p>
              <p className="text-[11px] text-muted-foreground">{recLow} months × {fmt(adjustedExpenses)}</p>
            </div>
            <div className="bg-muted/50 rounded-lg p-3">
              <p className="text-xs font-semibold text-foreground">High Target</p>
              <p className="text-lg font-bold text-primary mt-1 tabular-nums">{fmt(targetHigh)}</p>
              <p className="text-[11px] text-muted-foreground">{recHigh} months × {fmt(adjustedExpenses)}</p>
            </div>
          </div>
          <button
            onClick={() => setShowWhy(v => !v)}
            className="mt-3 flex items-center gap-1 text-xs text-accent font-medium"
          >
            {showWhy ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            Why this recommendation?
          </button>
          {showWhy && (
            <div className="mt-2 text-xs text-muted-foreground leading-relaxed bg-accent/10 border border-accent/20 rounded-lg p-3">
              {state.householdType === 'dual' ? (
                <>With two income streams, the household can absorb one job loss while the other income continues. The Certified Financial Planner (CFP®) Board generally considers 3–6 months appropriate for stable dual-income households. Variable income or dependents can push this higher.</>
              ) : (
                <>For a single-income household, the CFP® Board generally recommends at least 6 months of essential expenses, and 9–12 months for variable or self-employed income. Each additional dependent beyond two adds another month to the target.</>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Analysis (no header) */}
      {adjustedExpenses > 0 && (
        <div className="px-6 mt-4">
          <div className="bg-card rounded-xl p-4 shadow-sm space-y-3">
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <p className="text-muted-foreground">Coverage</p>
                <p className="font-bold text-foreground text-base tabular-nums">{coverageMonths.toFixed(1)} months</p>
              </div>
              <div>
                <p className="text-muted-foreground">{status === 'on-track' ? 'Surplus' : 'Shortfall'}</p>
                <p className={`font-bold text-base tabular-nums ${status === 'on-track' ? 'text-green-600' : 'text-destructive'}`}>
                  {status === 'on-track' ? fmt(surplus > 0 ? surplus : 0) : fmt(shortfall)}
                </p>
              </div>
            </div>
            {shortfall > 0 && (
              <div className="border-t border-border pt-3 space-y-2">
                {/* Current monthly savings from profile */}
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Current monthly savings</span>
                  <span className="font-semibold text-foreground tabular-nums">{fmt(efContribution)}/mo</span>
                </div>
                {onNavigateToProfile && (
                  <button onClick={() => onNavigateToProfile('accounts')} className="text-[10px] text-accent font-medium hover:underline">
                    From Financial Profile →
                  </button>
                )}
                <p className="text-xs text-muted-foreground font-medium pt-1">Additional monthly contribution to reach low target:</p>
                <div className="grid grid-cols-2 gap-3 text-xs">
                  {(() => {
                    const renderCard = (months: number, label: string) => {
                      const totalNeeded = Math.ceil(shortfall / months);
                      const additional = Math.max(0, totalNeeded - efContribution);
                      const onPace = additional === 0;
                      const yearsToReach = efContribution > 0 ? Math.ceil(shortfall / efContribution) : null;
                      if (onPace && yearsToReach !== null) {
                        return (
                          <div key={label} className="bg-muted/50 rounded-lg p-3 col-span-2">
                            <p className="text-muted-foreground">On pace</p>
                            <p className="font-semibold text-green-700 text-xs leading-snug mt-1">
                              At your current pace of {fmt(efContribution)}/mo, you'll reach your low target in approximately {yearsToReach} months.
                            </p>
                          </div>
                        );
                      }
                      return (
                        <div key={label} className="bg-muted/50 rounded-lg p-3">
                          <p className="text-muted-foreground">{label}</p>
                          <p className="font-bold text-foreground text-sm tabular-nums">+{fmt(additional)}/mo</p>
                        </div>
                      );
                    };
                    const totalNeeded12 = Math.ceil(shortfall / 12);
                    if (totalNeeded12 <= efContribution && efContribution > 0) {
                      return renderCard(12, 'In 12 months');
                    }
                    return [renderCard(12, 'In 12 months'), renderCard(24, 'In 24 months')];
                  })()}
                </div>
                {onNavigateToProfile && (
                  <button
                    onClick={() => onNavigateToProfile('accounts')}
                    className="flex items-center gap-1 text-xs text-accent font-medium hover:underline"
                  >
                    Update your monthly savings <ArrowRight size={12} />
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* AI Insights */}
      <div className="px-6 mt-4">
        <div className="bg-card rounded-xl p-4 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Sparkles size={16} className="text-accent" />
              <p className="text-sm font-semibold text-foreground">AI Insights</p>
            </div>
            <button onClick={fetchInsights} disabled={aiLoading} className="flex items-center gap-1 text-xs text-accent font-semibold">
              {aiLoading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
              {aiInsights.length > 0 ? 'Refresh' : 'Generate'}
            </button>
          </div>
          {aiInsights.length > 0 ? (
            <div className="space-y-3">
              <AIInsightsList
                insights={aiInsights}
                navigationHandlers={{
                  onNavigateToProfile,
                  onNavigateToPlanTool,
                  onNavigateToBudget: onNavigateToBudget ? () => onNavigateToBudget(nextMonth.key) : undefined,
                }}
              />
              {aiLastUpdated && (
                <p className="text-[10px] text-muted-foreground/50">Updated {formatDistanceToNow(aiLastUpdated, { addSuffix: true })}</p>
              )}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">Tap Generate for personalized emergency fund insights.</p>
          )}
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
