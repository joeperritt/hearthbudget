import { useState, useMemo, useEffect, useCallback } from 'react';
import { ArrowLeft, Plus, Trash2, ChevronDown, ChevronUp, Target, TrendingUp, TrendingDown, CheckCircle2, AlertTriangle, Info, Flag } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { supabase } from '@/integrations/supabase/client';
import { useToolState } from '@/hooks/useToolState';
import { GoalsInsightsSection } from './GoalsInsightsSection';
import { ProgressBar } from './ProgressBar';

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
}

function newGoal(): GoalData {
  const d = new Date();
  d.setFullYear(d.getFullYear() + 2);
  return {
    id: crypto.randomUUID(),
    name: '',
    targetAmount: '',
    currentSavings: '',
    monthlyContribution: '',
    useDate: true,
    targetDate: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
    targetMonths: '24',
    expanded: true,
  };
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
}

export function GoalsPlanner({ onBack, householdId }: GoalsPlannerProps) {
  const [financialProfile, setFinancialProfile] = useState<any>(null);

  const { state, setState, loaded } = useToolState(householdId, 'goals-planner', {
    goals: [] as GoalData[],
  });

  useEffect(() => {
    if (!householdId) return;
    supabase.from('financial_profiles').select('*').eq('household_id', householdId).maybeSingle()
      .then(({ data }) => { if (data) setFinancialProfile(data); });
  }, [householdId]);

  const goals: GoalData[] = Array.isArray(state.goals) ? state.goals : [];

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

  const moveGoal = useCallback((idx: number, dir: -1 | 1) => {
    const newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= goals.length) return;
    const arr = [...goals];
    [arr[idx], arr[newIdx]] = [arr[newIdx], arr[idx]];
    setState({ goals: arr });
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
      const monthlyNeeded = targetMonths > 0 ? remaining / targetMonths : 0;
      const surplus = contrib - monthlyNeeded;
      const onTrack = surplus >= -0.5; // small tolerance
      const projectedMonths = contrib > 0 ? Math.ceil(remaining / contrib) : Infinity;
      const projectedDate = contrib > 0 ? addMonthsToStr(projectedMonths) : '';
      const progressPct = target > 0 ? Math.min((current / target) * 100, 100) : 0;
      const yearsToGoal = targetMonths / 12;
      return { target, current, remaining, targetMonths, monthlyNeeded, surplus, onTrack, projectedMonths, projectedDate, progressPct, yearsToGoal, contrib };
    });
  }, [goals]);

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

  function savingsVehicleRec(years: number) {
    if (years < 2) return {
      label: 'Short-Term Goal',
      body: `A high-yield savings account or money market fund is typically appropriate. Capital preservation matters more than growth at this horizon. ${savingsFootnote}`,
    };
    if (years < 5) return {
      label: 'Medium-Term Goal',
      body: `A conservative mix of savings and low-volatility investments may be worth exploring. Consult a Certified Financial Planner (CFP®) to discuss options appropriate for your situation. ${savingsFootnote}`,
    };
    return {
      label: 'Long-Term Goal',
      body: `With this time horizon, investing a portion of your contributions may allow your money to grow faster than a savings account. A Certified Financial Planner (CFP®) can help you build an appropriate investment strategy. ${savingsFootnote}`,
    };
  }

  // For AI insights
  const goalsForInsights = useMemo(() => goals.map((g, i) => ({
    id: g.id,
    name: g.name || `Goal ${i + 1}`,
    targetAmount: computed[i].target,
    currentSavings: computed[i].current,
    monthlyContribution: computed[i].contrib,
    targetMonths: computed[i].targetMonths,
  })), [goals, computed]);

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
          <h1 className="font-display text-xl font-bold text-foreground">Savings Goals</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Plan and track non-retirement goals</p>
        </div>
      </div>

      {/* Summary Card */}
      {goals.length > 0 && (
        <div className="mx-6 mt-5 bg-card rounded-xl shadow-sm p-4">
          <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Goals Summary</h2>
          <div className="grid grid-cols-2 gap-3 text-center">
            <div>
              <p className="text-[11px] text-muted-foreground">Total Monthly Needed</p>
              <p className="text-lg font-bold font-display text-foreground">{fmt(summary.totalNeeded)}</p>
            </div>
            <div>
              <p className="text-[11px] text-muted-foreground">Currently Contributing</p>
              <p className="text-lg font-bold font-display text-foreground">{fmt(summary.totalContributing)}</p>
            </div>
          </div>
          <div className="mt-3 pt-3 border-t border-border text-center">
            <p className="text-[11px] text-muted-foreground">Combined Surplus / Shortfall</p>
            <p className={`text-xl font-bold font-display ${summary.combinedSurplus >= 0 ? 'text-green-600' : 'text-destructive'}`}>
              {summary.combinedSurplus >= 0 ? '+' : ''}{fmt(summary.combinedSurplus)}/mo
            </p>
          </div>
          <div className="mt-2 flex justify-center gap-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <CheckCircle2 size={12} className="text-green-600" /> {summary.onTrackCount} on track
            </span>
            {summary.offTrackCount > 0 && (
              <span className="flex items-center gap-1">
                <AlertTriangle size={12} className="text-destructive" /> {summary.offTrackCount} off track
              </span>
            )}
          </div>
          {/* Summary Verdict */}
          <div className="mt-3 pt-3 border-t border-border text-center">
            {summary.offTrackCount === 0 ? (
              <p className="text-sm font-semibold text-green-600 flex items-center justify-center gap-1.5">
                <CheckCircle2 size={14} /> All Goals On Track
              </p>
            ) : summary.onTrackCount === 0 ? (
              <p className="text-sm font-semibold text-destructive flex items-center justify-center gap-1.5">
                <AlertTriangle size={14} /> All Goals Off Track
              </p>
            ) : (
              <p className="text-sm font-semibold text-[#C9A84C] flex items-center justify-center gap-1.5">
                <AlertTriangle size={14} /> {summary.offTrackCount} of {summary.onTrackCount + summary.offTrackCount} Goals Need Attention
              </p>
            )}
          </div>
        </div>
      )}

      {/* Goal Cards */}
      <div className="px-6 mt-5 space-y-3">
        {goals.map((goal, idx) => {
          const c = computed[idx];
          const rec = savingsVehicleRec(c.yearsToGoal);
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
                        <Label className="text-xs text-muted-foreground">Target Amount</Label>
                        <div className="relative mt-1">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">$</span>
                          <Input value={goal.targetAmount} onChange={e => updateGoal(goal.id, { targetAmount: e.target.value.replace(/[^0-9.]/g, '') })} placeholder="50,000" className="h-9 text-sm pl-7" inputMode="decimal" />
                        </div>
                      </div>
                      <div>
                        <Label className="text-xs text-muted-foreground">Current Savings</Label>
                        <div className="relative mt-1">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">$</span>
                          <Input value={goal.currentSavings} onChange={e => updateGoal(goal.id, { currentSavings: e.target.value.replace(/[^0-9.]/g, '') })} placeholder="5,000" className="h-9 text-sm pl-7" inputMode="decimal" />
                        </div>
                      </div>
                    </div>

                    {/* Monthly Contribution */}
                    <div>
                      <Label className="text-xs text-muted-foreground">Monthly Contribution</Label>
                      <div className="relative mt-1">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">$</span>
                        <Input value={goal.monthlyContribution} onChange={e => updateGoal(goal.id, { monthlyContribution: e.target.value.replace(/[^0-9.]/g, '') })} placeholder="500" className="h-9 text-sm pl-7" inputMode="decimal" />
                      </div>
                    </div>

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
                      </div>
                    )}

                    {/* Savings Vehicle Recommendation */}
                    {c.target > 0 && c.targetMonths > 0 && (
                      <div className="bg-card rounded-lg shadow-sm p-3.5 border-l-[3px] border-l-[#C9A84C]">
                        <p className="text-xs font-semibold text-foreground font-display">{rec.label}</p>
                        <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed">{rec.body}</p>
                      </div>
                    )}

                    {/* Reorder & Delete */}
                    <div className="flex items-center justify-between pt-1">
                      <div className="flex gap-1">
                        <button onClick={() => moveGoal(idx, -1)} disabled={idx === 0} className="p-1.5 rounded-md hover:bg-muted disabled:opacity-30">
                          <ChevronUp size={14} className="text-muted-foreground" />
                        </button>
                        <button onClick={() => moveGoal(idx, 1)} disabled={idx === goals.length - 1} className="p-1.5 rounded-md hover:bg-muted disabled:opacity-30">
                          <ChevronDown size={14} className="text-muted-foreground" />
                        </button>
                      </div>
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
        <GoalsInsightsSection
          householdId={householdId}
          goals={goalsForInsights}
          financialProfile={financialProfile}
        />
      )}

      <div className="h-8" />
    </div>
  );
}
