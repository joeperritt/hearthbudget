import { useState, useMemo, useEffect, useCallback } from 'react';
import { ArrowLeft, Info, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
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
  type: string;
  balance: number;
  rate: number;
  monthlyPayment: number;
}

interface PayoffResult {
  type: string;
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
}

function simulatePayoff(debts: Debt[], extraPayment: number, rollForward: boolean): { results: PayoffResult[]; totalMonths: number; totalInterest: number } {
  if (debts.length === 0) return { results: [], totalMonths: 0, totalInterest: 0 };

  const active = debts.map((d, i) => ({
    idx: i, type: d.type, balance: d.balance, rate: d.rate,
    minPayment: d.monthlyPayment, totalInterest: 0, paidOff: false, payoffMonth: 0, payoffOrder: 0,
  }));

  const getTarget = () => {
    const remaining = active.filter(d => !d.paidOff && d.balance > 0);
    if (remaining.length === 0) return null;
    remaining.sort((a, b) => b.rate - a.rate);
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
    type: d.type, balance: debts[d.idx].balance, rate: d.rate, monthlyPayment: d.minPayment,
    payoffMonths: d.payoffMonth, totalInterest: d.totalInterest, payoffOrder: d.payoffOrder,
  }));
  results.sort((a, b) => (a.payoffOrder || 0) - (b.payoffOrder || 0));

  return { results, totalMonths: Math.max(...active.map(d => d.payoffMonth)), totalInterest: active.reduce((s, d) => s + d.totalInterest, 0) };
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

export function DebtPayoffCalculator({ onBack, householdId }: DebtPayoffCalculatorProps) {
  const [debts, setDebts] = useState<Debt[]>([]);
  const [loading, setLoading] = useState(true);
  const [showInfo, setShowInfo] = useState(false);
  const [financialProfile, setFinancialProfile] = useState<any>(null);

  const { state: toolState, setState: setToolState, loaded: toolStateLoaded } = useToolState(
    householdId, 'debt-payoff', { rollForward: true, extraPayment: '0' }
  );

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
                type: d.type || 'Debt',
                balance: Number(d.balance) || 0,
                rate: Number(d.interestRate) || Number(d.rate) || 0,
                monthlyPayment: Number(d.monthlyPayment) || 0,
              }));
            setDebts(parsed);
          }
        }
        setLoading(false);
      });
  }, [householdId]);

  const extra = parseFloat(toolState.extraPayment) || 0;
  const withSettings = useMemo(() => simulatePayoff(debts, extra, toolState.rollForward), [debts, extra, toolState.rollForward]);
  const baselineOnly = useMemo(() => simulatePayoff(debts, 0, false), [debts]);

  const totalBalance = debts.reduce((s, d) => s + d.balance, 0);
  const totalMinPayments = debts.reduce((s, d) => s + d.monthlyPayment, 0);
  const interestSaved = baselineOnly.totalInterest - withSettings.totalInterest;
  const monthsSaved = baselineOnly.totalMonths - withSettings.totalMonths;

  if (loading || !toolStateLoaded) {
    return (
      <div className="max-w-lg mx-auto pb-32">
        <div className="px-6 pt-12 safe-top flex items-center gap-3">
          <button onClick={onBack} className="p-1.5 -ml-1.5 rounded-lg hover:bg-muted"><ArrowLeft size={20} className="text-foreground" /></button>
          <h1 className="font-display text-xl font-bold text-foreground">Debt Payoff Calculator</h1>
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
          <h1 className="font-display text-xl font-bold text-foreground">Debt Payoff Calculator</h1>
          <p className="text-sm text-muted-foreground mt-0.5">See your path to debt freedom</p>
        </div>
      </div>

      {debts.length === 0 ? (
        <div className="px-6 mt-10 text-center">
          <div className="bg-card rounded-xl p-8 shadow-sm border border-border">
            <p className="text-base font-semibold text-foreground">No debts found</p>
            <p className="text-sm text-muted-foreground mt-2">Add debts in your Financial Profile to use the Debt Payoff Calculator.</p>
          </div>
        </div>
      ) : (
        <>
          {/* Total Debt Summary */}
          <div className="px-6 mt-5">
            <div className="bg-primary rounded-xl p-4 shadow-md">
              <div className="flex justify-between items-start">
                <div>
                  <p className="text-xs text-primary-foreground/70 font-medium">Total Debt Balance</p>
                  <p className="text-2xl font-bold text-accent mt-0.5">{fmt(totalBalance)}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-primary-foreground/70 font-medium">Monthly Minimums</p>
                  <p className="text-lg font-bold text-primary-foreground mt-0.5">{fmtDecimal(totalMinPayments)}</p>
                </div>
              </div>
            </div>
          </div>

          {/* Controls */}
          <div className="px-6 mt-5 space-y-4">
            <div className="bg-card rounded-xl p-4 shadow-sm border border-border">
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
                <div className="mt-3 bg-muted/50 rounded-lg p-3 relative">
                  <button onClick={() => setShowInfo(false)} className="absolute top-2 right-2 p-0.5 rounded hover:bg-muted"><X size={12} className="text-muted-foreground" /></button>
                  <p className="text-xs text-muted-foreground leading-relaxed pr-5">
                    When a debt is paid off, its monthly payment automatically applies to your next debt — keeping your total monthly payment the same and accelerating payoff.
                  </p>
                </div>
              )}
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Extra Monthly Payment</Label>
              <Input type="number" value={toolState.extraPayment} onChange={e => setToolState({ extraPayment: e.target.value })} placeholder="0" className="mt-1" />
            </div>
          </div>

          {/* Debt Cards */}
          <div className="px-6 mt-5 space-y-3">
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Payoff Order (Highest Rate First)</p>
            {withSettings.results.map((debt, i) => (
              <div key={i} className="bg-card rounded-xl p-4 shadow-sm border border-border relative">
                {debt.payoffOrder && (
                  <span className="absolute top-3 right-3 text-[10px] font-bold text-accent bg-primary px-2 py-0.5 rounded-full">{ordinal(debt.payoffOrder)}</span>
                )}
                <div className="flex items-start justify-between pr-16">
                  <div>
                    <p className="text-sm font-semibold text-foreground capitalize">{debt.type.replace(/_/g, ' ')}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{debt.rate}% APR · {fmtDecimal(debt.monthlyPayment)}/mo min</p>
                  </div>
                  <p className="text-sm font-bold text-foreground">{fmt(debt.balance)}</p>
                </div>
                <div className="mt-3 pt-3 border-t border-border flex justify-between items-center">
                  <p className="text-xs text-muted-foreground">Projected payoff</p>
                  <p className="text-xs font-semibold text-foreground">{formatMonths(debt.payoffMonths)}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Summary */}
          <div className="px-6 mt-5">
            <div className="bg-card rounded-xl shadow-sm border border-border overflow-hidden">
              <div className="p-4 border-b border-border">
                <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Payoff Summary</p>
              </div>
              <div className="divide-y divide-border">
                <SummaryRow label="Total Months to Payoff" value={formatMonths(withSettings.totalMonths)} />
                <SummaryRow label="Total Interest Paid" value={fmtDecimal(withSettings.totalInterest)} />
                {interestSaved > 0 && (
                  <div className="flex justify-between items-center p-4 bg-green-50 dark:bg-green-950/30">
                    <p className="text-sm font-semibold text-green-700 dark:text-green-300">Interest Saved</p>
                    <p className="text-sm font-bold text-green-700 dark:text-green-300">{fmtDecimal(interestSaved)}</p>
                  </div>
                )}
                {monthsSaved > 0 && (
                  <div className="flex justify-between items-center p-4 bg-green-50 dark:bg-green-950/30">
                    <p className="text-sm font-semibold text-green-700 dark:text-green-300">Months Saved</p>
                    <p className="text-sm font-bold text-green-700 dark:text-green-300">{monthsSaved} months</p>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* AI Insights */}
          <DebtInsightsSection
            householdId={householdId}
            debts={debts}
            payoffResults={withSettings}
            baselineResults={baselineOnly}
            rollForward={toolState.rollForward}
            extraPayment={extra}
            financialProfile={financialProfile}
          />
        </>
      )}
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between items-center p-4">
      <p className="text-sm text-foreground">{label}</p>
      <p className="text-sm font-medium text-foreground">{value}</p>
    </div>
  );
}
