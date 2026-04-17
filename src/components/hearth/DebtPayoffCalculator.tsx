import { useState, useMemo, useEffect } from 'react';
import { ArrowLeft, Info, X } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { supabase } from '@/integrations/supabase/client';
import { useToolState } from '@/hooks/useToolState';
import { DebtInsightsSection } from './DebtInsightsSection';

function fmt(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);
}

function fmtDecimal(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(n);
}

interface Debt {
  name: string;
  type: string;
  balance: number;
  rate: number;
  monthlyPayment: number;
  extraPayment: number;
}

interface PayoffResult {
  type: string;
  name: string;
  balance: number;
  rate: number;
  monthlyPayment: number;
  payoffMonths: number;
  totalInterest: number;
  payoffOrder?: number;
}

interface DebtPayoffCalculatorProps {
  onBack: () => void;
  householdId: string | null;
  onNavigateToProfile?: (tab?: string) => void;
}

const BUSINESS_BUY_IN_TYPE = 'Business Buy-In / Partnership Investment';

type PayoffMethod = 'avalanche' | 'snowball';

function simulatePayoff(debts: Debt[], extraPayment: number, rollForward: boolean, method: PayoffMethod = 'avalanche'): { results: PayoffResult[]; totalMonths: number; totalInterest: number } {
  if (debts.length === 0) return { results: [], totalMonths: 0, totalInterest: 0 };

  const active = debts.map((d, i) => ({
    idx: i, type: d.type, name: d.name, balance: d.balance, rate: d.rate,
    minPayment: d.monthlyPayment + d.extraPayment, totalInterest: 0, paidOff: false, payoffMonth: 0, payoffOrder: 0,
  }));

  const getTarget = () => {
    const remaining = active.filter(d => !d.paidOff && d.balance > 0);
    if (remaining.length === 0) return null;
    if (method === 'snowball') {
      remaining.sort((a, b) => a.balance - b.balance);
    } else {
      remaining.sort((a, b) => b.rate - a.rate);
    }
    return remaining[0];
  };

  let month = 0;
  let orderCounter = 1;
  const MAX_MONTHS = 600;

  while (active.some(d => !d.paidOff && d.balance > 0) && month < MAX_MONTHS) {
    month++;
    let availableExtra = extraPayment;
    if (rollForward) {
      for (const d of active) { if (d.paidOff) availableExtra += d.minPayment; }
    }
    for (const d of active) {
      if (d.paidOff || d.balance <= 0) continue;
      const interest = d.balance * (d.rate / 100 / 12);
      d.totalInterest += interest;
      d.balance += interest;
    }
    for (const d of active) {
      if (d.paidOff || d.balance <= 0) continue;
      d.balance -= Math.min(d.minPayment, d.balance);
      if (d.balance <= 0.01) { d.balance = 0; d.paidOff = true; d.payoffMonth = month; d.payoffOrder = orderCounter++; }
    }
    const target = getTarget();
    if (target && availableExtra > 0) {
      target.balance -= Math.min(availableExtra, target.balance);
      if (target.balance <= 0.01) { target.balance = 0; target.paidOff = true; target.payoffMonth = month; target.payoffOrder = orderCounter++; }
    }
  }

  for (const d of active) {
    if (!d.paidOff) { d.payoffMonth = MAX_MONTHS; d.payoffOrder = orderCounter++; }
  }

  const results: PayoffResult[] = active.map(d => ({
    type: d.type, name: d.name, balance: debts[d.idx].balance, rate: d.rate, monthlyPayment: debts[d.idx].monthlyPayment,
    payoffMonths: d.payoffMonth, totalInterest: d.totalInterest, payoffOrder: d.payoffOrder,
  }));
  results.sort((a, b) => (a.payoffOrder || 0) - (b.payoffOrder || 0));

  return { results, totalMonths: Math.max(...active.map(d => d.payoffMonth)), totalInterest: active.reduce((s, d) => s + d.totalInterest, 0) };
}

// Binary search for extra payment needed to pay off in targetMonths
function findExtraForTarget(debts: Debt[], targetMonths: number, rollForward: boolean, method: PayoffMethod): number {
  if (debts.length === 0) return 0;
  let lo = 0;
  let hi = debts.reduce((s, d) => s + d.balance, 0); // upper bound
  for (let iter = 0; iter < 50; iter++) {
    const mid = (lo + hi) / 2;
    const result = simulatePayoff(debts, mid, rollForward, method);
    if (result.totalMonths <= targetMonths) {
      hi = mid;
    } else {
      lo = mid;
    }
    if (hi - lo < 0.5) break;
  }
  return Math.ceil(hi);
}

function formatMonths(months: number): string {
  if (months >= 600) return '50+ years';
  const years = Math.floor(months / 12);
  const rem = months % 12;
  if (years === 0) return `${rem} mo`;
  if (rem === 0) return `${years} yr`;
  return `${years} yr ${rem} mo`;
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

export function DebtPayoffCalculator({ onBack, householdId, onNavigateToProfile }: DebtPayoffCalculatorProps) {
  const [debts, setDebts] = useState<Debt[]>([]);
  const [loading, setLoading] = useState(true);
  const [showInfo, setShowInfo] = useState(false);
  const [financialProfile, setFinancialProfile] = useState<any>(null);

  const { state: toolState, setState: setToolState, loaded: toolStateLoaded } = useToolState(
    householdId, 'debt-payoff', { rollForward: true, targetPayoffYear: '', method: 'avalanche' as PayoffMethod, showMethodInfo: false }
  );
  const method: PayoffMethod = (toolState.method as PayoffMethod) || 'avalanche';

  useEffect(() => {
    if (!householdId) { setLoading(false); return; }
    supabase
      .from('financial_profiles')
      .select('*')
      .eq('household_id', householdId)
      .maybeSingle()
      .then(({ data }) => {
        if (data) {
          setFinancialProfile(data);
          if (Array.isArray(data.debts)) {
            const parsed = (data.debts as any[])
              .filter((d: any) => (Number(d.balance) || 0) > 0)
              .map((d: any) => ({
                name: d.name || d.type || 'Debt',
                type: d.type || 'Debt',
                balance: Number(d.balance) || 0,
                rate: Number(d.interestRate) || Number(d.rate) || 0,
                monthlyPayment: Number(d.monthlyPayment) || 0,
                extraPayment: Number(d.extraPayment) || 0,
              }));
            setDebts(parsed);
          }
        }
        setLoading(false);
      });
  }, [householdId]);

  // Split debts: consumer debts get optimized; business buy-ins are tracked separately
  const consumerDebts = useMemo(() => debts.filter(d => d.type !== BUSINESS_BUY_IN_TYPE), [debts]);
  const excludedDebts = useMemo(() => debts.filter(d => d.type === BUSINESS_BUY_IN_TYPE), [debts]);

  // Baseline (no extra, no roll) — consumer debts only
  const baselineOnly = useMemo(() => simulatePayoff(consumerDebts, 0, false, method), [consumerDebts, method]);
  // With roll forward but no additional extra (current pace)
  const currentPace = useMemo(() => simulatePayoff(consumerDebts, 0, toolState.rollForward, method), [consumerDebts, toolState.rollForward, method]);

  // Totals INCLUDE business buy-ins for total debt + DTI
  const totalBalance = debts.reduce((s, d) => s + d.balance, 0);
  const totalMinPayments = debts.reduce((s, d) => s + d.monthlyPayment, 0);
  const totalExtraFromProfile = debts.reduce((s, d) => s + d.extraPayment, 0);

  // Slider range — based on consumer debt payoff
  const now = new Date();
  const projectedYear = now.getFullYear() + Math.ceil(currentPace.totalMonths / 12);
  const minYear = now.getFullYear() + 1;
  const maxYear = Math.max(projectedYear, minYear + 1);
  const targetYear = toolState.targetPayoffYear ? Number(toolState.targetPayoffYear) : maxYear;
  const clampedTarget = Math.max(minYear, Math.min(maxYear, targetYear));
  const isDefault = clampedTarget >= maxYear;

  // Calculate what's needed for the target year — consumer debts only
  const targetMonths = Math.max(1, (clampedTarget - now.getFullYear()) * 12 - now.getMonth());
  const extraNeeded = useMemo(() => {
    if (isDefault) return 0;
    return findExtraForTarget(consumerDebts, targetMonths, toolState.rollForward, method);
  }, [consumerDebts, targetMonths, toolState.rollForward, isDefault, method]);

  const withTarget = useMemo(() => simulatePayoff(consumerDebts, extraNeeded, toolState.rollForward, method), [consumerDebts, extraNeeded, toolState.rollForward, method]);
  const interestSaved = currentPace.totalInterest - withTarget.totalInterest;
  const monthsSaved = currentPace.totalMonths - withTarget.totalMonths;

  // For debt cards display, use current pace results
  const displayResults = currentPace;

  if (loading || !toolStateLoaded) {
    return (
      <div className="max-w-lg mx-auto pb-32">
        <div className="px-6 pt-12 safe-top flex items-center gap-3">
          <button onClick={onBack} className="p-1.5 -ml-1.5 rounded-lg hover:bg-muted"><ArrowLeft size={20} className="text-foreground" /></button>
          <h1 className="font-display text-xl font-bold text-foreground">Debt Payoff Analyzer</h1>
        </div>
        <div className="px-6 mt-8 text-center text-muted-foreground text-sm">Loading…</div>
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto pb-32">
      <div className="px-6 pt-12 safe-top flex items-center gap-3">
        <button onClick={onBack} className="p-1.5 -ml-1.5 rounded-lg hover:bg-muted"><ArrowLeft size={20} className="text-foreground" /></button>
        <div>
          <h1 className="font-display text-xl font-bold text-foreground">Debt Payoff Analyzer</h1>
          <p className="text-sm text-muted-foreground mt-0.5">See your path to debt freedom</p>
        </div>
      </div>

      {debts.length === 0 ? (
        <div className="px-6 mt-10 text-center">
          <div className="bg-card rounded-xl p-8 shadow-sm border border-border">
            <p className="text-base font-semibold text-foreground">No debts found</p>
            <p className="text-sm text-muted-foreground mt-2">Add debts in your Financial Profile to use the Debt Payoff Analyzer.</p>
            {onNavigateToProfile && (
              <button onClick={() => onNavigateToProfile('debts')} className="text-sm font-semibold text-accent mt-3">
                Go to Financial Profile →
              </button>
            )}
          </div>
        </div>
      ) : (
        <>
          {/* Read-only profile card */}
          <div className="px-6 mt-5">
            <div className="bg-card rounded-xl p-4 shadow-sm border border-border space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-foreground">Your Debts</p>
                {onNavigateToProfile && (
                  <button onClick={() => onNavigateToProfile('debts')} className="text-xs font-semibold text-accent">
                    From Financial Profile →
                  </button>
                )}
              </div>
              <div className="space-y-2">
                {debts.map((d, i) => {
                  const isExcluded = d.type === BUSINESS_BUY_IN_TYPE;
                  return (
                    <div key={i} className="bg-muted/30 rounded-lg p-3 relative">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <p className="text-sm font-semibold text-foreground capitalize">{d.name.replace(/_/g, ' ')}</p>
                            <span className={`px-1.5 py-0.5 rounded text-[9px] font-semibold tracking-wider shrink-0 ${isExcluded ? 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300' : 'bg-muted text-muted-foreground'}`}>
                              {d.type}
                            </span>
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {d.rate}% APR · {fmtDecimal(d.monthlyPayment)}/mo min
                            {d.extraPayment > 0 && <span className="text-accent"> · +{fmtDecimal(d.extraPayment)}/mo extra</span>}
                          </p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-sm font-bold text-foreground">{fmt(d.balance)}</p>
                          {onNavigateToProfile && (
                            <button onClick={() => onNavigateToProfile('debts')} className="text-[10px] font-semibold text-accent mt-1">Edit →</button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="flex justify-between items-center pt-2 border-t border-border">
                <p className="text-xs text-muted-foreground">Total</p>
                <div className="text-right">
                  <p className="text-sm font-bold text-foreground">{fmt(totalBalance)}</p>
                  <p className="text-[10px] text-muted-foreground">{fmtDecimal(totalMinPayments)}/mo min{totalExtraFromProfile > 0 ? ` · +${fmtDecimal(totalExtraFromProfile)} extra` : ''}</p>
                </div>
              </div>
            </div>
          </div>

          {/* Debt Analysis */}
          <div className="px-6 mt-4">
            <div className="bg-card rounded-xl shadow-sm border border-border overflow-hidden">
              <div className="px-4 pt-3 pb-3 border-b border-border space-y-2">
                <p className="text-sm font-semibold text-foreground">Debt Analysis</p>
                {/* Method toggle */}
                <div className="flex gap-1 p-1 bg-muted/50 rounded-lg">
                  <button
                    onClick={() => setToolState({ method: 'avalanche' })}
                    className={`flex-1 px-2 py-1.5 rounded text-[11px] font-semibold transition-colors ${method === 'avalanche' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground'}`}
                  >
                    Avalanche (highest rate)
                  </button>
                  <button
                    onClick={() => setToolState({ method: 'snowball' })}
                    className={`flex-1 px-2 py-1.5 rounded text-[11px] font-semibold transition-colors ${method === 'snowball' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground'}`}
                  >
                    Snowball (smallest balance)
                  </button>
                </div>
                <button
                  onClick={() => setToolState({ showMethodInfo: !toolState.showMethodInfo })}
                  className="text-[11px] font-semibold text-accent flex items-center gap-1"
                >
                  {toolState.showMethodInfo ? '▾' : '▸'} Why these methods?
                </button>
                {toolState.showMethodInfo && (
                  <p className="text-[11px] text-muted-foreground leading-relaxed bg-muted/40 rounded-lg p-2.5">
                    Avalanche targets the highest interest rate first, saving the most money over time. Snowball targets the smallest balance first, giving you quicker wins to build momentum. Both work — choose the approach that fits your personality.
                  </p>
                )}
              </div>
              <div className="divide-y divide-border">
                <SummaryRow label="Projected Debt-Free" value={(() => {
                  const d = new Date();
                  d.setMonth(d.getMonth() + currentPace.totalMonths);
                  return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
                })()} />
                <SummaryRow label="Remaining Term" value={formatMonths(currentPace.totalMonths)} />
                <SummaryRow label="Total Interest Remaining" value={fmtDecimal(currentPace.totalInterest)} />
              </div>
            </div>
          </div>

          {/* CFP Guideline Indicator */}
          {(() => {
            const grossMonthly = financialProfile ? Number(financialProfile.annual_gross_income) / 12 : 0;
            const mortgagePmt = financialProfile ? Number(financialProfile.mortgage_payment) || 0 : 0;
            const rent = financialProfile ? Number(financialProfile.monthly_rent) || 0 : 0;
            const housing = financialProfile?.housing_type === 'own' ? mortgagePmt : rent;
            const totalDebtPmts = totalMinPayments + totalExtraFromProfile;
            const backEnd = grossMonthly > 0 ? ((housing + totalDebtPmts) / grossMonthly) * 100 : 0;
            const backOk = backEnd <= 36;
            const hasIncome = grossMonthly > 0;
            const pctFmt = (v: number) => `${v.toFixed(1)}%`;

            return (
              <div className="px-6 mt-4 space-y-2">
                <p className="text-xs text-muted-foreground font-medium tracking-wide">CFP® Guideline Indicator</p>

                <div className={`rounded-xl p-3.5 border ${backOk ? 'bg-green-50 border-green-200 dark:bg-green-950/30 dark:border-green-800' : 'bg-red-50 border-red-200 dark:bg-red-950/30 dark:border-red-800'}`}>
                  <div className="flex justify-between items-center">
                    <div>
                      <p className="text-sm font-semibold text-foreground">Debt-to-Income Ratio</p>
                      <p className="text-[11px] text-muted-foreground mt-0.5">(Housing + all debt) ÷ gross income (guideline: ≤ 36%)</p>
                    </div>
                    <span className={`text-lg font-bold ${backOk ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                      {hasIncome ? pctFmt(backEnd) : '—'}
                    </span>
                  </div>
                </div>

                {hasIncome && !backOk && (
                  <div className="rounded-xl p-3 border text-center bg-red-50 border-red-200 dark:bg-red-950/30 dark:border-red-800">
                    <p className="text-sm font-bold text-red-700 dark:text-red-300">⚠ Exceeds Recommended Limits</p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      {backEnd > 43
                        ? 'Your DTI exceeds 43% — above FHA qualifying limits. Prioritize debt reduction.'
                        : 'Consider accelerating debt payoff to bring ratios within guidelines.'}
                    </p>
                  </div>
                )}
              </div>
            );
          })()}

          {/* Payoff Order */}
          <div className="px-6 mt-4 space-y-1.5">
            <p className="text-sm font-semibold text-foreground">Payoff Order</p>
            <p className="text-[10px] text-muted-foreground">
              {method === 'snowball'
                ? 'Extra payments target the smallest balance first (snowball). Order below reflects when each debt reaches $0.'
                : 'Extra payments target the highest rate first (avalanche). Order below reflects when each debt reaches $0.'}
            </p>
            {displayResults.results.length === 0 ? (
              <div className="bg-card rounded-lg p-3 shadow-sm border border-border">
                <p className="text-xs text-muted-foreground">No consumer debts to optimize.</p>
              </div>
            ) : (() => {
              const targetIdx = method === 'snowball'
                ? consumerDebts.reduce((minI, d, i, arr) => d.balance < arr[minI].balance ? i : minI, 0)
                : consumerDebts.reduce((maxI, d, i, arr) => d.rate > arr[maxI].rate ? i : maxI, 0);
              const targetName = consumerDebts[targetIdx]?.name;
              return displayResults.results.map((debt, i) => {
                const isTarget = debt.name === targetName;
                return (
                  <div key={i} className="bg-card rounded-lg p-2.5 shadow-sm border border-border flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-bold text-accent bg-primary w-5 h-5 rounded-full flex items-center justify-center">{debt.payoffOrder}</span>
                      <div>
                        <p className="text-xs font-semibold text-foreground capitalize">{debt.name.replace(/_/g, ' ')}</p>
                        <div className="flex items-center gap-1.5">
                          <p className="text-[10px] text-muted-foreground">{debt.rate}% · {fmt(debt.balance)}</p>
                          {isTarget && (
                            <span className="text-[9px] font-semibold text-accent bg-accent/10 px-1.5 py-0.5 rounded">Extra → here</span>
                          )}
                        </div>
                      </div>
                    </div>
                    <p className="text-xs font-medium text-muted-foreground">{formatMonths(debt.payoffMonths)}</p>
                  </div>
                );
              });
            })()}
          </div>

          {/* Excluded from Payoff Optimization */}
          {excludedDebts.length > 0 && (
            <div className="px-6 mt-4 space-y-1.5">
              <p className="text-sm font-semibold text-foreground">Excluded from Payoff Optimization</p>
              {excludedDebts.map((d, i) => (
                <div key={i} className="bg-card rounded-lg p-3 shadow-sm border border-border">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <p className="text-xs font-semibold text-foreground capitalize">{d.name.replace(/_/g, ' ')}</p>
                        <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold tracking-wider shrink-0 bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
                          {d.type}
                        </span>
                      </div>
                      <p className="text-[10px] text-muted-foreground mt-0.5">{d.rate}% APR · {fmtDecimal(d.monthlyPayment)}/mo min</p>
                    </div>
                    <p className="text-xs font-bold text-foreground shrink-0">{fmt(d.balance)}</p>
                  </div>
                </div>
              ))}
              <p className="text-[11px] text-muted-foreground leading-relaxed mt-1">
                This debt is classified as a Business Buy-In / Partnership Investment. It is tracked for total debt and debt-to-income calculations but excluded from the consumer debt payoff strategy.
              </p>
            </div>
          )}

          {/* Roll Forward + Slider */}
          <div className="px-6 mt-4">
            <div className="bg-card rounded-xl p-4 shadow-sm border border-border space-y-3">
              <p className="text-xs font-semibold text-foreground tracking-wide">Payoff Goal</p>

              {/* Roll Forward Toggle */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-base">🔄</span>
                  <Label className="text-sm font-semibold text-foreground cursor-pointer">Roll Payments Forward</Label>
                  <button onClick={() => setShowInfo(!showInfo)} className="p-0.5 rounded-full hover:bg-muted transition-colors">
                    <Info size={14} className="text-muted-foreground" />
                  </button>
                </div>
                <Switch checked={toolState.rollForward} onCheckedChange={v => setToolState({ rollForward: v })} />
              </div>
              {showInfo && (
                <div className="bg-muted/50 rounded-lg p-3 relative">
                  <button onClick={() => setShowInfo(false)} className="absolute top-2 right-2 p-0.5 rounded hover:bg-muted"><X size={12} className="text-muted-foreground" /></button>
                  <p className="text-xs text-muted-foreground leading-relaxed pr-5">
                    When a debt is paid off, its monthly payment automatically applies to your next debt — keeping your total monthly payment the same and accelerating payoff.
                  </p>
                </div>
              )}

              {/* Year Slider */}
              <div>
                <div className="flex justify-between items-baseline mb-2">
                  <span className="text-xs text-muted-foreground">Target Debt-Free Year</span>
                  <span className="text-sm font-bold text-foreground">{clampedTarget}</span>
                </div>
                <Slider
                  min={minYear}
                  max={maxYear}
                  step={1}
                  value={[clampedTarget]}
                  onValueChange={([v]) => setToolState({ targetPayoffYear: String(v) })}
                  className="[&_[role=slider]]:bg-accent [&_[role=slider]]:border-accent [&_[data-orientation=horizontal]>[data-orientation=horizontal]]:bg-primary"
                />
                <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
                  <span>{minYear}</span>
                  <span>{maxYear} (current pace)</span>
                </div>
              </div>

              {isDefault ? (
                <div className="bg-muted/50 rounded-lg p-3">
                  <p className="text-sm text-muted-foreground">No extra payment needed at current pace</p>
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-muted/50 rounded-lg p-3">
                      <p className="text-[10px] font-semibold text-muted-foreground">Extra Payment</p>
                      <p className="text-lg font-bold text-foreground mt-1">{fmt(extraNeeded)}<span className="text-xs font-normal text-muted-foreground">/mo</span></p>
                    </div>
                    <div className="bg-muted/50 rounded-lg p-3">
                      <p className="text-[10px] font-semibold text-muted-foreground">Interest Saved</p>
                      <p className="text-lg font-bold text-green-600 dark:text-green-400 mt-1">{fmt(Math.max(0, interestSaved))}</p>
                    </div>
                  </div>
                  {monthsSaved > 0 && (
                    <div className="bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 rounded-lg p-3">
                      <p className="text-sm font-semibold text-green-700 dark:text-green-300">
                        Debt-free {Math.floor(monthsSaved / 12) > 0 ? `${Math.floor(monthsSaved / 12)} year${Math.floor(monthsSaved / 12) !== 1 ? 's' : ''} ` : ''}{monthsSaved % 12 > 0 ? `${monthsSaved % 12} month${monthsSaved % 12 !== 1 ? 's' : ''} ` : ''}earlier
                      </p>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          {/* AI Insights */}
          <DebtInsightsSection
            householdId={householdId}
            debts={debts}
            payoffResults={currentPace}
            baselineResults={baselineOnly}
            rollForward={toolState.rollForward}
            extraPayment={extraNeeded}
            financialProfile={financialProfile}
          />
        </>
      )}
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between items-center px-4 py-2.5">
      <p className="text-xs text-foreground">{label}</p>
      <p className="text-xs font-medium text-foreground">{value}</p>
    </div>
  );
}
