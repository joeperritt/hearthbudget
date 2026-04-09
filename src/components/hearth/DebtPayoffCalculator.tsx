import { useState, useMemo, useEffect } from 'react';
import { ArrowLeft, Info, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { supabase } from '@/integrations/supabase/client';

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

function simulatePayoff(debts: Debt[], extraPayment: number, snowball: boolean): { results: PayoffResult[]; totalMonths: number; totalInterest: number } {
  if (debts.length === 0) return { results: [], totalMonths: 0, totalInterest: 0 };

  // Clone debts with tracking
  const active = debts.map((d, i) => ({
    idx: i,
    type: d.type,
    balance: d.balance,
    rate: d.rate,
    minPayment: d.monthlyPayment,
    totalInterest: 0,
    paidOff: false,
    payoffMonth: 0,
    payoffOrder: 0,
  }));

  // Sort order for targeting: snowball = lowest balance first, avalanche = highest rate first
  const getTarget = () => {
    const remaining = active.filter(d => !d.paidOff && d.balance > 0);
    if (remaining.length === 0) return null;
    if (snowball) {
      remaining.sort((a, b) => a.balance - b.balance);
    } else {
      remaining.sort((a, b) => b.rate - a.rate);
    }
    return remaining[0];
  };

  let month = 0;
  let orderCounter = 1;
  const MAX_MONTHS = 600; // 50 years safety cap

  while (active.some(d => !d.paidOff && d.balance > 0) && month < MAX_MONTHS) {
    month++;
    let availableExtra = extraPayment;

    // Add freed-up payments from paid-off debts
    for (const d of active) {
      if (d.paidOff) availableExtra += d.minPayment;
    }

    // Apply interest to all active debts
    for (const d of active) {
      if (d.paidOff || d.balance <= 0) continue;
      const monthlyRate = d.rate / 100 / 12;
      const interest = d.balance * monthlyRate;
      d.totalInterest += interest;
      d.balance += interest;
    }

    // Pay minimums on all active debts
    for (const d of active) {
      if (d.paidOff || d.balance <= 0) continue;
      const payment = Math.min(d.minPayment, d.balance);
      d.balance -= payment;
      if (d.balance <= 0.01) {
        d.balance = 0;
        d.paidOff = true;
        d.payoffMonth = month;
        d.payoffOrder = orderCounter++;
      }
    }

    // Apply extra to target debt
    const target = getTarget();
    if (target && availableExtra > 0) {
      const payment = Math.min(availableExtra, target.balance);
      target.balance -= payment;
      if (target.balance <= 0.01) {
        target.balance = 0;
        target.paidOff = true;
        target.payoffMonth = month;
        target.payoffOrder = orderCounter++;
      }
    }
  }

  // Handle debts that never pay off within cap
  for (const d of active) {
    if (!d.paidOff) {
      d.payoffMonth = MAX_MONTHS;
      d.payoffOrder = orderCounter++;
    }
  }

  const results: PayoffResult[] = active.map(d => ({
    type: d.type,
    balance: debts[d.idx].balance,
    rate: d.rate,
    monthlyPayment: d.minPayment,
    payoffMonths: d.payoffMonth,
    totalInterest: d.totalInterest,
    payoffOrder: d.payoffOrder,
  }));

  // Sort by payoff order when snowball/avalanche is active
  results.sort((a, b) => (a.payoffOrder || 0) - (b.payoffOrder || 0));

  return {
    results,
    totalMonths: Math.max(...active.map(d => d.payoffMonth)),
    totalInterest: active.reduce((s, d) => s + d.totalInterest, 0),
  };
}

function formatMonths(months: number): string {
  if (months >= 600) return '50+ years';
  const years = Math.floor(months / 12);
  const rem = months % 12;
  if (years === 0) return `${rem} mo`;
  if (rem === 0) return `${years} yr`;
  return `${years} yr ${rem} mo`;
}

export function DebtPayoffCalculator({ onBack, householdId }: DebtPayoffCalculatorProps) {
  const [debts, setDebts] = useState<Debt[]>([]);
  const [loading, setLoading] = useState(true);
  const [snowball, setSnowball] = useState(false);
  const [extraPayment, setExtraPayment] = useState('0');
  const [showInfo, setShowInfo] = useState(false);

  useEffect(() => {
    if (!householdId) { setLoading(false); return; }
    supabase
      .from('financial_profiles')
      .select('debts')
      .eq('household_id', householdId)
      .maybeSingle()
      .then(({ data }) => {
        if (data && Array.isArray(data.debts)) {
          const parsed = (data.debts as any[])
            .filter((d: any) => (Number(d.balance) || 0) > 0)
            .map((d: any) => ({
              type: d.type || 'Debt',
              balance: Number(d.balance) || 0,
              rate: Number(d.rate) || 0,
              monthlyPayment: Number(d.monthlyPayment) || 0,
            }));
          setDebts(parsed);
        }
        setLoading(false);
      });
  }, [householdId]);

  const extra = parseFloat(extraPayment) || 0;

  const withExtra = useMemo(() => simulatePayoff(debts, extra, snowball), [debts, extra, snowball]);
  const minimumOnly = useMemo(() => simulatePayoff(debts, 0, false), [debts]);

  const totalBalance = debts.reduce((s, d) => s + d.balance, 0);
  const totalMinPayments = debts.reduce((s, d) => s + d.monthlyPayment, 0);
  const interestSaved = minimumOnly.totalInterest - withExtra.totalInterest;

  if (loading) {
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
      {/* Header */}
      <div className="px-6 pt-12 safe-top flex items-center gap-3">
        <button onClick={onBack} className="p-1.5 -ml-1.5 rounded-lg hover:bg-muted">
          <ArrowLeft size={20} className="text-foreground" />
        </button>
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
            {/* Snowball Toggle */}
            <div className="bg-card rounded-xl p-4 shadow-sm border border-border">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-base">⛄</span>
                  <Label className="text-sm font-semibold text-foreground cursor-pointer">Snowball Method</Label>
                  <button
                    onClick={() => setShowInfo(!showInfo)}
                    className="p-0.5 rounded-full hover:bg-muted transition-colors"
                  >
                    <Info size={14} className="text-muted-foreground" />
                  </button>
                </div>
                <Switch checked={snowball} onCheckedChange={setSnowball} />
              </div>
              {showInfo && (
                <div className="mt-3 bg-muted/50 rounded-lg p-3 relative">
                  <button onClick={() => setShowInfo(false)} className="absolute top-2 right-2 p-0.5 rounded hover:bg-muted">
                    <X size={12} className="text-muted-foreground" />
                  </button>
                  <p className="text-xs text-muted-foreground leading-relaxed pr-5">
                    The debt snowball method pays minimums on all debts except the smallest balance, which gets any extra payment. As each debt is paid off, that payment rolls into the next — building momentum like a snowball.
                  </p>
                  <p className="text-xs text-muted-foreground mt-2 leading-relaxed">
                    When off, the <span className="font-semibold">avalanche method</span> is used instead — targeting the highest interest rate first to minimize total interest paid.
                  </p>
                </div>
              )}
            </div>

            {/* Extra Payment */}
            <div>
              <Label className="text-xs text-muted-foreground">Extra Monthly Payment</Label>
              <Input
                type="number"
                value={extraPayment}
                onChange={e => setExtraPayment(e.target.value)}
                placeholder="0"
                className="mt-1"
              />
            </div>
          </div>

          {/* Debt Cards */}
          <div className="px-6 mt-5 space-y-3">
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">
              {snowball ? 'Payoff Order (Snowball)' : 'Payoff Order (Avalanche)'}
            </p>
            {withExtra.results.map((debt, i) => (
              <div key={i} className="bg-card rounded-xl p-4 shadow-sm border border-border relative">
                {(extra > 0 || snowball) && debt.payoffOrder && (
                  <span className="absolute top-3 right-3 text-[10px] font-bold text-accent bg-primary px-2 py-0.5 rounded-full">
                    {ordinal(debt.payoffOrder)}
                  </span>
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
                <SummaryRow label="Total Months to Payoff" value={formatMonths(withExtra.totalMonths)} />
                <SummaryRow label="Total Interest Paid" value={fmtDecimal(withExtra.totalInterest)} />
                {extra > 0 && (
                  <div className="flex justify-between items-center p-4 bg-green-50 dark:bg-green-950/30">
                    <p className="text-sm font-semibold text-green-700 dark:text-green-300">Interest Saved</p>
                    <p className="text-sm font-bold text-green-700 dark:text-green-300">{fmtDecimal(interestSaved)}</p>
                  </div>
                )}
                {extra > 0 && (
                  <div className="flex justify-between items-center p-4 bg-green-50 dark:bg-green-950/30">
                    <p className="text-sm font-semibold text-green-700 dark:text-green-300">Months Saved</p>
                    <p className="text-sm font-bold text-green-700 dark:text-green-300">{minimumOnly.totalMonths - withExtra.totalMonths} months</p>
                  </div>
                )}
              </div>
            </div>
          </div>
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

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
