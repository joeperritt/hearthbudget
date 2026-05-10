import { useState, useMemo, useEffect, useCallback } from 'react';
import { ArrowLeft, Plus, Trash2, ChevronDown, ChevronUp, CheckCircle2, AlertTriangle, Info, Flag, GraduationCap, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { supabase } from '@/integrations/supabase/client';
import { useToolState } from '@/hooks/useToolState';
import { GoalsInsightsSection } from './GoalsInsightsSection';
import { ContextualAskAI } from './ContextualAskAI';
import { ProgressBar } from './ProgressBar';
import { ageFromDob } from '@/lib/ageUtils';
import { hasUnclassifiedNq } from '@/lib/nqIntent';
import { EducationCostEstimator, EducationDependent } from './EducationCostEstimator';

function fmt(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);
}

interface GoalData {
  id: string;
  name: string;
  targetAmount: string;
  currentSavings: string;
  monthlyContribution: string;
  useDate: boolean;       // true = target date, false = number of months
  targetDate: string;     // YYYY-MM
  targetMonths: string;
  expanded: boolean;
  recExpanded?: boolean;
  /** When set, this goal is tied to a specific dependent (for education goals) */
  dependentName?: string;
  /** Expected annual return %, 0-12. Auto-defaults based on horizon if not user-set */
  expectedReturn?: string;
  /** True once the user has manually adjusted the return slider — blocks horizon auto-default */
  returnTouched?: boolean;
}

/** Smart default expected return based on time horizon (years). */
function defaultReturnForYears(years: number): number {
  if (years < 2) return 0;
  if (years < 5) return 4;
  if (years < 10) return 6;
  return 7;
}

function newGoal(overrides: Partial<GoalData> = {}): GoalData {
  const d = new Date();
  d.setFullYear(d.getFullYear() + 2);
  return {
    id: crypto.randomUUID(),
    name: '',
    targetAmount: '',
    currentSavings: '0',
    monthlyContribution: '0',
    useDate: true,
    targetDate: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
    targetMonths: '24',
    expanded: true,
    recExpanded: true,
    expectedReturn: '4', // 2-year default horizon
    returnTouched: false,
    ...overrides,
  };
}

function isEducationGoalName(name: string): boolean {
  const n = (name || '').toLowerCase();
  return /education|college|529/.test(n);
}

function monthsBetween(from: Date, toStr: string): number {
  if (!toStr) return 0;
  const [y, m] = toStr.split('-').map(Number);
  if (!y || !m) return 0;
  const to = new Date(y, m - 1);
  const diff = (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());
  return Math.max(0, diff);
}

function addMonthsToStr(months: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() + months);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function formatMonthYear(s: string): string {
  if (!s) return '';
  const [y, m] = s.split('-').map(Number);
  if (!y || !m) return s;
  const d = new Date(y, m - 1);
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

interface GoalsPlannerProps {
  onBack: () => void;
  householdId: string | null;
  onNavigateToProfile?: (tab?: string) => void;
  onNavigateToBudget?: (monthKey?: string) => void;
  onNavigateToPlanTool?: (toolId: import('@/lib/aiNavigation').PlanToolId) => void;
}

export function GoalsPlanner({ onBack, householdId, onNavigateToProfile, onNavigateToBudget, onNavigateToPlanTool }: GoalsPlannerProps) {
  const [financialProfile, setFinancialProfile] = useState<any>(null);

  const { state, setState, loaded } = useToolState(householdId, 'goals-planner', {
    goals: [] as GoalData[],
    dismissedEducationSuggestions: [] as string[],
  });

  const [estimatorGoalId, setEstimatorGoalId] = useState<string | null>(null);

  useEffect(() => {
    if (!householdId) return;
    supabase.from('financial_profiles').select('*').eq('household_id', householdId).maybeSingle()
      .then(({ data }) => { if (data) setFinancialProfile(data); });
  }, [householdId]);

  const goals: GoalData[] = Array.isArray(state.goals) ? state.goals : [];
  const dismissedSuggestions: string[] = Array.isArray(state.dismissedEducationSuggestions) ? state.dismissedEducationSuggestions : [];

  // Dependents from financial profile, with derived ages and year-turns-18
  const dependentDetails: EducationDependent[] = useMemo(() => {
    const raw: any[] = Array.isArray(financialProfile?.dependents) ? financialProfile.dependents : [];
    const currentYear = new Date().getFullYear();
    return raw.map((d: any) => {
      const age = d.dob ? (ageFromDob(d.dob) ?? null) : (typeof d.age === 'number' ? d.age : null);
      const yearTurns18 = age !== null ? currentYear + Math.max(0, 18 - age) : currentYear + 18;
      return { name: d.name || 'Dependent', currentAge: age, yearTurns18 };
    });
  }, [financialProfile]);

  const updateGoal = useCallback((id: string, updates: Partial<GoalData>) => {
    const updated = goals.map(g => g.id === id ? { ...g, ...updates } : g);
    setState({ goals: updated });
  }, [goals, setState]);

  const addGoal = useCallback(() => {
    setState({ goals: [...goals, newGoal()] });
  }, [goals, setState]);

  const removeGoal = useCallback((id: string) => {
    setState({ goals: goals.filter(g => g.id !== id) });
  }, [goals, setState]);

  // Suggested education goals: one per dependent who doesn't already have one and hasn't been dismissed
  const educationSuggestions = useMemo(() => {
    return dependentDetails.filter(dep => {
      if (dismissedSuggestions.includes(dep.name)) return false;
      const alreadyHas = goals.some(g =>
        g.dependentName === dep.name ||
        (isEducationGoalName(g.name) && g.name.toLowerCase().includes(dep.name.toLowerCase()))
      );
      return !alreadyHas;
    });
  }, [dependentDetails, dismissedSuggestions, goals]);

  const addEducationGoalForDependent = useCallback((dep: EducationDependent) => {
    const targetMonth = `${dep.yearTurns18}-09`; // September of year they turn 18
    const goal = newGoal({
      name: `Education Fund — ${dep.name}`,
      dependentName: dep.name,
      useDate: true,
      targetDate: targetMonth,
    });
    setState({ goals: [...goals, goal] });
    // Open estimator immediately
    setTimeout(() => setEstimatorGoalId(goal.id), 0);
  }, [goals, setState]);

  const dismissEducationSuggestion = useCallback((depName: string) => {
    setState({ dismissedEducationSuggestions: [...dismissedSuggestions, depName] });
  }, [dismissedSuggestions, setState]);

  const handleEstimatorApply = useCallback((goalId: string, result: { total: number; dependentName: string | null; targetYear: number }) => {
    const updates: Partial<GoalData> = { targetAmount: String(result.total) };
    if (result.dependentName) {
      updates.dependentName = result.dependentName;
      updates.useDate = true;
      updates.targetDate = `${result.targetYear}-09`;
    }
    const updated = goals.map(g => g.id === goalId ? { ...g, ...updates } : g);
    setState({ goals: updated });
  }, [goals, setState]);


  // Computed per-goal
  const computed = useMemo(() => {
    const now = new Date();
    return goals.map(g => {
      const target = Number(g.targetAmount) || 0;
      const current = Number(g.currentSavings) || 0;
      const contrib = Number(g.monthlyContribution) || 0;
      const remaining = Math.max(0, target - current);
      const targetMonths = g.useDate ? monthsBetween(now, g.targetDate) : (Number(g.targetMonths) || 0);
      const yearsToGoal = targetMonths / 12;
      const ret = Math.max(0, Math.min(12, Number(g.expectedReturn ?? defaultReturnForYears(yearsToGoal)))) / 100;
      const monthlyRate = ret / 12;
      // Future value of current savings at goal date
      const fvCurrent = current * Math.pow(1 + monthlyRate, targetMonths);
      const remainingFV = Math.max(0, target - fvCurrent);
      // Required monthly contribution: PMT in FV-of-annuity formula
      let monthlyNeeded = 0;
      if (targetMonths > 0) {
        if (monthlyRate > 0.0000001) {
          const fvAnnuityFactor = (Math.pow(1 + monthlyRate, targetMonths) - 1) / monthlyRate;
          monthlyNeeded = remainingFV / fvAnnuityFactor;
        } else {
          monthlyNeeded = remaining / targetMonths;
        }
      }
      const surplus = contrib - monthlyNeeded;
      const onTrack = surplus >= -0.5;

      // Projected completion: months until current * (1+r)^n + contrib * fvAnnuity >= target
      let projectedMonths = Infinity;
      if (contrib > 0 || current > 0) {
        if (monthlyRate > 0.0000001) {
          const denom = current + (contrib / monthlyRate);
          const numer = target + (contrib / monthlyRate);
          if (denom > 0 && numer / denom > 0) {
            const n = Math.log(numer / denom) / Math.log(1 + monthlyRate);
            projectedMonths = isFinite(n) && n > 0 ? Math.ceil(n) : Infinity;
          }
        } else if (contrib > 0) {
          projectedMonths = Math.ceil(remaining / contrib);
        }
      }
      const projectedDate = isFinite(projectedMonths) ? addMonthsToStr(projectedMonths) : '';
      const progressPct = target > 0 ? Math.min((current / target) * 100, 100) : 0;
      return { target, current, remaining, targetMonths, monthlyNeeded, surplus, onTrack, projectedMonths, projectedDate, progressPct, yearsToGoal, contrib, returnRate: ret * 100 };
    });
  }, [goals]);

  // Auto-default expectedReturn based on horizon (only when user hasn't touched the slider)
  useEffect(() => {
    let dirty = false;
    const updated = goals.map((g, i) => {
      if (g.returnTouched) return g;
      const targetDefault = String(defaultReturnForYears(computed[i]?.yearsToGoal || 0));
      if ((g.expectedReturn ?? '') !== targetDefault) {
        dirty = true;
        return { ...g, expectedReturn: targetDefault };
      }
      return g;
    });
    if (dirty) setState({ goals: updated });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [computed.map(c => c.yearsToGoal).join(',')]);

  // Summary
  const summary = useMemo(() => {
    const totalNeeded = computed.reduce((s, c) => s + c.monthlyNeeded, 0);
    const totalContributing = computed.reduce((s, c) => s + c.contrib, 0);
    const combinedSurplus = totalContributing - totalNeeded;
    const onTrackCount = computed.filter(c => c.onTrack).length;
    const offTrackCount = computed.filter(c => !c.onTrack).length;
    return { totalNeeded, totalContributing, combinedSurplus, onTrackCount, offTrackCount };
  }, [computed]);

  const savingsFootnote = 'Savings vehicle recommendations are general and educational. Consult a Certified Financial Planner (CFP®) before making investment decisions.';

  function savingsVehicleRec(years: number, returnRate: number) {
    const rateNote = returnRate > 0
      ? ` Your plan assumes a ${returnRate.toFixed(1)}% expected annual return.`
      : ' Your plan assumes 0% return (capital preservation).';
    if (years < 2) return {
      label: 'Short-Term Goal',
      body: `A high-yield savings account or money market fund is typically appropriate. Capital preservation matters more than growth at this horizon.${rateNote} ${savingsFootnote}`,
    };
    if (years < 5) return {
      label: 'Medium-Term Goal',
      body: `A conservative mix of savings and low-volatility investments may be worth exploring. Consult a Certified Financial Planner (CFP®) to discuss options appropriate for your situation.${rateNote} ${savingsFootnote}`,
    };
    return {
      label: 'Long-Term Goal',
      body: `With this time horizon, investing a portion of your contributions may allow your money to grow faster than a savings account. A Certified Financial Planner (CFP®) can help you build an appropriate investment strategy.${rateNote} ${savingsFootnote}`,
    };
  }

  // For AI insights
  const goalsForInsights = useMemo(() => goals.map((g, i) => {
    const c = computed[i];
    const isEdu = isEducationGoalName(g.name) || !!g.dependentName;
    const projectedCompletion = c.contrib > 0 ? Math.ceil(Math.max(0, c.target - c.current) / c.contrib) : null;
    return {
      id: g.id,
      name: g.name || `Goal ${i + 1}`,
      targetAmount: c.target,
      currentSavings: c.current,
      monthlyContribution: c.contrib,
      targetMonths: c.targetMonths,
      targetDate: g.useDate ? g.targetDate : null,
      expectedReturn: Number(g.expectedReturn) || 0,
      projectedCompletionMonths: projectedCompletion ?? undefined,
      isEducation: isEdu,
      dependentName: g.dependentName,
      educationInflationAdjusted: isEdu ? c.target : undefined,
    };
  }), [goals, computed]);

  // Compute non-retirement savings pool from financial profile
  const savingsPool = useMemo(() => {
    if (!financialProfile) return null;
    const additions = (financialProfile.monthly_additions_per_key || {}) as Record<string, number>;
    const nqBalances = (financialProfile.non_retirement_per_member || {}) as Record<string, number>;
    const nqIntent = (financialProfile.non_retirement_intent || {}) as Record<string, string>;
    // Non-Retirement Goals additions from Savings section
    const savingsNonret = Number(additions['savings_nonret']) || 0;
    // "For Non-Retirement Goals" from NQ accounts explicitly marked for other goals.
    let nqNonRet = 0;
    Object.entries(additions).forEach(([key, val]) => {
      const match = key.match(/^nq_(.+)_nonret$/);
      if (match && nqIntent[match[1]] !== 'retirement') nqNonRet += (Number(val) || 0);
    });
    const otherGoalBalance = Object.entries(nqBalances).reduce((s, [key, val]) => s + (nqIntent[key] === 'retirement' ? 0 : Number(val) || 0), 0);
    const totalAvailable = savingsNonret + nqNonRet;
    const allocated = goals.reduce((s, g) => s + (Number(g.monthlyContribution) || 0), 0);
    const surplus = totalAvailable - allocated;
    return { totalAvailable, allocated, surplus, otherGoalBalance, hasData: totalAvailable > 0 || otherGoalBalance > 0 };
  }, [financialProfile, goals]);

  if (!loaded) {
    return (
      <div className="max-w-lg mx-auto px-6 pt-16 safe-top">
        <div className="animate-pulse space-y-4">
          <div className="h-6 bg-muted rounded w-1/2" />
          <div className="h-32 bg-muted rounded" />
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto pb-32">
      {/* Header */}
      <div className="px-6 pt-12 safe-top flex items-center gap-3">
        <button onClick={onBack} className="p-1.5 -ml-1.5 rounded-lg hover:bg-muted">
          <ArrowLeft size={20} className="text-foreground" />
        </button>
        <div>
          <h1 className="font-display text-2xl lg:text-3xl font-bold tracking-tight text-foreground">Non-Retirement Goals</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Plan and track your non-retirement savings goals</p>
        </div>
      </div>

      {hasUnclassifiedNq(financialProfile) && (
        <div className="px-6 mt-3">
          <button
            onClick={() => onNavigateToProfile?.('accounts')}
            className="w-full text-left rounded-lg border border-accent/30 bg-accent/5 px-3 py-2 text-xs text-foreground/85 active:opacity-70"
          >
            Some non-qualified balances aren't designated yet. <span className="text-accent font-semibold">Designate now →</span>
          </button>
        </div>
      )}
      <div className="mx-6 mt-5">
        {savingsPool && savingsPool.hasData ? (
          <div className="bg-card rounded-xl shadow-sm p-4">
            <h2 className="text-sm font-display font-semibold text-foreground mb-3">Monthly Savings Pool</h2>
            <div className="space-y-1.5">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Monthly Non-Retirement Savings</span>
                <span className="font-semibold text-foreground tabular-nums">{fmt(savingsPool.totalAvailable)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">NQ for Other Goals</span>
                <span className="font-semibold text-foreground tabular-nums">{fmt(savingsPool.otherGoalBalance)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Allocated to Goals</span>
                <span className="font-semibold text-foreground tabular-nums">{fmt(savingsPool.allocated)}</span>
              </div>
              <div className="flex justify-between text-sm border-t border-border pt-1.5">
                <span className="text-muted-foreground font-semibold">Unallocated</span>
                <span className={`font-bold tabular-nums ${savingsPool.surplus > 0 ? 'text-green-600' : 'text-destructive'}`}>
                  {fmt(Math.max(0, savingsPool.surplus))}/mo
                </span>
              </div>
              {goals.length > 0 && (
                <div className="pt-2 mt-1 border-t border-border text-center">
                  {summary.offTrackCount === 0 ? (
                    <p className="text-xs font-semibold text-green-600 flex items-center justify-center gap-1.5">
                      <CheckCircle2 size={12} />
                      All goals on track · +{fmt(summary.combinedSurplus)}/mo surplus
                    </p>
                  ) : (
                    <p className={`text-xs font-semibold flex items-center justify-center gap-1.5 ${summary.combinedSurplus >= 0 ? 'text-[#C9A84C]' : 'text-destructive'}`}>
                      <AlertTriangle size={12} />
                      {summary.offTrackCount} of {summary.onTrackCount + summary.offTrackCount} goals off track · {summary.combinedSurplus >= 0 ? '+' : ''}{fmt(summary.combinedSurplus)}/mo {summary.combinedSurplus >= 0 ? 'surplus' : 'shortfall'}
                    </p>
                  )}
                </div>
              )}
            </div>
            {savingsPool.surplus <= 0 ? (
              <button
                onClick={() => onNavigateToProfile ? onNavigateToProfile('accounts') : onBack()}
                className="mt-2 text-[11px] font-semibold text-accent flex items-center gap-1"
              >
                Increase your monthly savings →
              </button>
            ) : (
              <button
                onClick={() => onNavigateToProfile ? onNavigateToProfile('accounts') : onBack()}
                className="mt-2 text-[11px] font-semibold text-accent flex items-center gap-1"
              >
                From Financial Profile →
              </button>
            )}
          </div>
        ) : (
          <div className="bg-card rounded-xl shadow-sm p-4 text-center">
            <p className="text-xs text-muted-foreground">Add your monthly non-retirement savings in your Financial Profile to see your savings pool.</p>
            <button
              onClick={() => onNavigateToProfile ? onNavigateToProfile('accounts') : onBack()}
              className="mt-2 text-[11px] font-semibold text-accent"
            >
              Go to Financial Profile →
            </button>
          </div>
        )}
      </div>

      {/* Suggested Education Goals */}
      {educationSuggestions.length > 0 && (
        <div className="px-6 mt-5 space-y-2">
          {educationSuggestions.map(dep => (
            <div key={dep.name} className="bg-accent/10 border border-accent/30 rounded-xl p-3.5 flex items-start gap-3">
              <div className="w-8 h-8 rounded-full bg-accent/20 flex items-center justify-center shrink-0">
                <GraduationCap size={16} className="text-accent" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-foreground">
                  Have you started saving for {dep.name}'s education?
                </p>
                <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">
                  {dep.name}{typeof dep.currentAge === 'number' ? `, age ${dep.currentAge}` : ''} — turns 18 in {dep.yearTurns18}.
                </p>
                <button
                  type="button"
                  onClick={() => addEducationGoalForDependent(dep)}
                  className="mt-2 text-[11px] font-semibold bg-accent text-accent-foreground px-3 py-1.5 rounded-full active:opacity-90"
                >
                  Add Education Fund Goal
                </button>
              </div>
              <button
                type="button"
                onClick={() => dismissEducationSuggestion(dep.name)}
                className="text-muted-foreground active:opacity-70 shrink-0"
                aria-label="Dismiss"
              >
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Goal Cards */}
      <div className="px-6 mt-5 space-y-3">
        {goals.map((goal, idx) => {
          const c = computed[idx];
          const rec = savingsVehicleRec(c.yearsToGoal, c.returnRate);
          return (
            <Collapsible key={goal.id} open={goal.expanded} onOpenChange={(open) => updateGoal(goal.id, { expanded: open })}>
              <div className="bg-card rounded-xl shadow-sm overflow-hidden">
                <CollapsibleTrigger className="w-full px-4 py-3 flex items-center gap-3 text-left">
                  <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 bg-[#1B2B4B]/10">
                    <Flag size={16} className="text-[#1B2B4B]" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-foreground truncate">{goal.name || `Goal ${idx + 1}`}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <ProgressBar value={c.current} max={c.target} className="flex-1" />
                      <span className="text-[10px] text-muted-foreground shrink-0">{c.progressPct.toFixed(0)}%</span>
                    </div>
                  </div>
                  {goal.expanded ? <ChevronUp size={16} className="text-muted-foreground shrink-0" /> : <ChevronDown size={16} className="text-muted-foreground shrink-0" />}
                </CollapsibleTrigger>

                <CollapsibleContent>
                  <div className="px-4 pb-4 space-y-3 border-t border-border pt-3">
                    {/* Goal Name */}
                    <div>
                      <Label className="text-xs text-muted-foreground">Goal Name</Label>
                      <Input value={goal.name} onChange={e => updateGoal(goal.id, { name: e.target.value })} placeholder="e.g. Beach House Down Payment" className="mt-1 h-9 text-sm" />
                    </div>

                    {/* Target Amount & Current Savings */}
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <div className="flex items-center justify-between min-h-[18px]">
                          <Label className="text-xs text-muted-foreground">Target Amount</Label>
                          {(isEducationGoalName(goal.name) || goal.dependentName) && (
                            <button
                              type="button"
                              onClick={() => setEstimatorGoalId(goal.id)}
                              className="text-[10px] font-semibold text-accent active:opacity-70"
                            >
                              Help me estimate
                            </button>
                          )}
                        </div>
                        <div className="relative mt-1">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">$</span>
                          <Input value={goal.targetAmount} onChange={e => updateGoal(goal.id, { targetAmount: e.target.value.replace(/[^0-9.]/g, '') })} placeholder="50,000" className="h-9 text-sm pl-7" inputMode="decimal" />
                        </div>
                      </div>
                      <div>
                        <div className="flex items-center min-h-[18px]">
                          <Label className="text-xs text-muted-foreground">Current Savings</Label>
                        </div>
                        <div className="relative mt-1">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">$</span>
                          <Input value={goal.currentSavings} onChange={e => updateGoal(goal.id, { currentSavings: e.target.value.replace(/[^0-9.]/g, '') })} placeholder="0" className="h-9 text-sm pl-7" inputMode="decimal" />
                        </div>
                      </div>
                    </div>

                    {/* Monthly Allocation (from Savings Pool) */}
                    {(() => {
                      const poolTotal = savingsPool?.totalAvailable ?? 0;
                      const poolAllocated = savingsPool?.allocated ?? 0;
                      const thisAlloc = Number(goal.monthlyContribution) || 0;
                      const otherAlloc = poolAllocated - thisAlloc;
                      const remainingForThis = poolTotal > 0 ? Math.max(0, poolTotal - otherAlloc) : Infinity;
                      const atCap = poolTotal > 0 && thisAlloc >= remainingForThis && remainingForThis > 0;
                      const fullyAllocated = poolTotal > 0 && (poolTotal - poolAllocated) <= 0;
                      return (
                        <div>
                          <div className="flex items-center justify-between mb-1">
                            <Label className="text-xs text-muted-foreground">Monthly Allocation</Label>
                            {poolTotal > 0 && (
                              <span className="text-[10px] text-muted-foreground">
                                Pool remaining: <span className="font-semibold text-foreground">{fmt(Math.max(0, poolTotal - poolAllocated))}/mo</span>
                              </span>
                            )}
                          </div>
                          <div className="relative">
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">$</span>
                            <Input
                              value={goal.monthlyContribution}
                              onChange={e => {
                                const raw = e.target.value.replace(/[^0-9.]/g, '');
                                const num = Number(raw) || 0;
                                if (poolTotal > 0 && num > remainingForThis) {
                                  updateGoal(goal.id, { monthlyContribution: String(remainingForThis) });
                                } else {
                                  updateGoal(goal.id, { monthlyContribution: raw });
                                }
                              }}
                              placeholder="0"
                              className="h-9 text-sm pl-7"
                              inputMode="decimal"
                            />
                          </div>
                          {fullyAllocated && (
                            <p className="text-[10px] text-destructive mt-1">Pool fully allocated. Increase your savings to allocate more.</p>
                          )}
                          {!fullyAllocated && atCap && (
                            <p className="text-[10px] text-muted-foreground mt-1">Capped at pool remaining.</p>
                          )}
                        </div>
                      );
                    })()}

                    {/* Expected Annual Return */}
                    {(() => {
                      const ret = Number(goal.expectedReturn ?? defaultReturnForYears(c.yearsToGoal));
                      return (
                        <div>
                          <div className="flex items-center justify-between mb-1">
                            <div className="flex items-center gap-1.5">
                              <Label className="text-xs text-muted-foreground">Expected Annual Return</Label>
                              <Popover>
                                <PopoverTrigger asChild>
                                  <button type="button" className="text-muted-foreground active:opacity-70" aria-label="About expected return">
                                    <Info size={11} />
                                  </button>
                                </PopoverTrigger>
                                <PopoverContent side="top" className="w-72 text-[11px] leading-relaxed">
                                  For longer time horizons, investing your savings may help your money grow faster. Higher expected returns come with higher risk. This estimate assumes consistent monthly contributions and a steady return rate, which is simplified. Actual investment returns will vary. Consult a Certified Financial Planner (CFP®) for personalized investment guidance.
                                </PopoverContent>
                              </Popover>
                            </div>
                            <span className="text-xs font-semibold text-foreground tabular-nums">{ret.toFixed(1)}%</span>
                          </div>
                          <Slider
                            value={[ret]}
                            onValueChange={([v]) => updateGoal(goal.id, { expectedReturn: String(v), returnTouched: true })}
                            min={0}
                            max={12}
                            step={0.5}
                            className="mt-1"
                          />
                          <div className="flex justify-between text-[10px] text-muted-foreground mt-0.5">
                            <span>0%</span>
                            <span>12%</span>
                          </div>
                        </div>
                      );
                    })()}

                    {/* Target Date vs Months toggle */}
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <Label className="text-xs text-muted-foreground">Timeline</Label>
                        <div className="flex items-center gap-2">
                          <span className={`text-[10px] ${!goal.useDate ? 'text-foreground font-semibold' : 'text-muted-foreground'}`}>Months</span>
                          <Switch checked={goal.useDate} onCheckedChange={(v) => {
                            if (v) {
                              // Switching to date mode — calc date from months
                              const months = Number(goal.targetMonths) || 24;
                              updateGoal(goal.id, { useDate: true, targetDate: addMonthsToStr(months) });
                            } else {
                              // Switching to months mode — calc months from date
                              const months = monthsBetween(new Date(), goal.targetDate) || 24;
                              updateGoal(goal.id, { useDate: false, targetMonths: String(months) });
                            }
                          }} />
                          <span className={`text-[10px] ${goal.useDate ? 'text-foreground font-semibold' : 'text-muted-foreground'}`}>Date</span>
                        </div>
                      </div>
                      {goal.useDate ? (
                        <Input type="month" value={goal.targetDate} onChange={e => updateGoal(goal.id, { targetDate: e.target.value })} className="h-9 text-sm" />
                      ) : (
                        <Input type="number" value={goal.targetMonths} onChange={e => updateGoal(goal.id, { targetMonths: e.target.value.replace(/[^0-9]/g, '') })} placeholder="24" className="h-9 text-sm" inputMode="numeric" min="1" />
                      )}
                    </div>

                    {/* Calculated Output */}
                    {c.target > 0 && (
                      <div className="bg-muted/50 rounded-lg p-3 space-y-2">
                        <div className="flex justify-between text-xs">
                          <span className="text-muted-foreground">Monthly Needed</span>
                          <span className="font-semibold text-foreground">{fmt(c.monthlyNeeded)}/mo</span>
                        </div>
                        <div className="flex justify-between text-xs">
                          <span className="text-muted-foreground">Surplus / Shortfall</span>
                          <span className={`font-semibold ${c.surplus >= 0 ? 'text-green-600' : 'text-destructive'}`}>
                            {c.surplus >= 0 ? '+' : ''}{fmt(c.surplus)}/mo
                          </span>
                        </div>
                        <div className="flex justify-between text-xs">
                          <span className="text-muted-foreground">Projected Completion</span>
                          <span className="font-semibold text-foreground">
                            {c.projectedDate ? formatMonthYear(c.projectedDate) : 'N/A'}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          {c.onTrack ? (
                            <>
                              <CheckCircle2 size={14} className="text-green-600" />
                              <span className="text-xs font-semibold text-green-600">On Track</span>
                            </>
                          ) : (
                            <>
                              <AlertTriangle size={14} className="text-destructive" />
                              <span className="text-xs font-semibold text-destructive">Off Track</span>
                            </>
                          )}
                        </div>
                        {c.contrib > 0 && c.target > 0 && (
                          <p className="text-[11px] text-muted-foreground leading-relaxed pt-1.5 border-t border-border">
                            At <span className="font-semibold text-foreground">{fmt(c.contrib)}/mo</span>, you'll reach your <span className="font-semibold text-foreground">{fmt(c.target)}</span> goal by <span className="font-semibold text-foreground">{c.projectedDate ? formatMonthYear(c.projectedDate) : 'N/A'}</span>.
                            {!c.onTrack && c.targetMonths > 0 && (
                              <> To hit your <span className="font-semibold text-foreground">{goal.useDate ? formatMonthYear(goal.targetDate) : `${c.targetMonths}-month`}</span> deadline, increase to <span className="font-semibold text-foreground">{fmt(c.monthlyNeeded)}/mo</span>.</>
                            )}
                          </p>
                        )}
                      </div>
                    )}

                    {/* Savings Vehicle Recommendation (collapsible) */}
                    {c.target > 0 && c.targetMonths > 0 && (
                      <Collapsible open={goal.recExpanded ?? false} onOpenChange={(open) => updateGoal(goal.id, { recExpanded: open })}>
                        <CollapsibleTrigger className="w-full flex items-center justify-between px-3 py-2 rounded-lg bg-muted/50 hover:bg-muted text-left">
                          <span className="text-xs font-semibold text-foreground">Savings Vehicle Recommendation</span>
                          {goal.recExpanded ? <ChevronUp size={14} className="text-muted-foreground" /> : <ChevronDown size={14} className="text-muted-foreground" />}
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                          <div className="bg-card rounded-lg shadow-sm p-3.5 mt-2 border-l-[3px] border-l-[#C9A84C]">
                            <p className="text-xs font-semibold text-foreground font-display">{rec.label}</p>
                            <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed">{rec.body}</p>
                          </div>
                        </CollapsibleContent>
                      </Collapsible>
                    )}

                    {/* Delete */}
                    <div className="flex items-center justify-end pt-1">
                      <button onClick={() => removeGoal(goal.id)} className="flex items-center gap-1 text-xs text-destructive active:opacity-70">
                        <Trash2 size={12} /> Remove
                      </button>
                    </div>
                  </div>
                </CollapsibleContent>
              </div>
            </Collapsible>
          );
        })}

        {/* Add Goal Button */}
        <button
          onClick={addGoal}
          className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border-2 border-dashed border-border text-sm font-semibold text-muted-foreground hover:border-accent hover:text-accent transition-colors active:scale-[0.98]"
        >
          <Plus size={16} /> Add Goal
        </button>
      </div>

      {/* Footnote */}
      {goals.length > 0 && (
        <div className="px-6 mt-4 flex gap-2">
          <Info size={12} className="text-muted-foreground shrink-0 mt-0.5" />
          <p className="text-[10px] text-muted-foreground leading-relaxed">
            Savings vehicle recommendations are general and educational. Consult a Certified Financial Planner (CFP®) before making investment decisions.
          </p>
        </div>
      )}

      {/* AI Insights */}
      {goals.length > 0 && (
        <>
          <GoalsInsightsSection
            householdId={householdId}
            goals={goalsForInsights}
            financialProfile={financialProfile}
            monthlyPoolTotal={savingsPool?.totalAvailable ?? 0}
            allocatedMonthly={savingsPool?.allocated ?? 0}
            navigationHandlers={{ onNavigateToProfile: onNavigateToProfile as any, onNavigateToBudget, onNavigateToPlanTool }}
          />
          <ContextualAskAI
            contextLabel="Non-Retirement Goals"
            contextPreface={`The user is on the Non-Retirement Goals planner. ${goals.length} goals. Monthly pool: ${(savingsPool?.totalAvailable ?? 0).toFixed(0)}, allocated: ${(savingsPool?.allocated ?? 0).toFixed(0)}. Goals: ${JSON.stringify(goalsForInsights).slice(0, 1200)}.`}
          />
        </>
      )}

      {/* Education Cost Estimator Modal */}
      {estimatorGoalId && (() => {
        const g = goals.find(x => x.id === estimatorGoalId);
        return (
          <EducationCostEstimator
            open={!!estimatorGoalId}
            onOpenChange={(o) => { if (!o) setEstimatorGoalId(null); }}
            dependents={dependentDetails}
            initialDependentName={g?.dependentName ?? null}
            allowManualYears
            onApply={(result) => handleEstimatorApply(estimatorGoalId, result)}
          />
        );
      })()}

      <div className="h-8" />
    </div>
  );
}
