import { useState, useMemo } from 'react';
import { BudgetCategory, FixedExpense } from '@/types/budget';
import { format, addMonths } from 'date-fns';

function fmt(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(n);
}

function fmtWhole(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);
}

interface PlanningViewProps {
  currentMonth: Date;
  categories: BudgetCategory[];
  fixedExpenses: FixedExpense[];
  onStartMonth: (nextMonth: Date, cats: BudgetCategory[]) => void;
}

interface PayFields {
  grossPay: string;
  fedTaxRate: string;
  ssTaxRate: string;
  medicareRate: string;
  scTaxRate: string;
  roth401kRate: string;
  titheRate: string;
  creditCardTotal: string;
  checkingTotal: string;
  katiePay1: string;
  katiePay2: string;
}

const DEFAULT_RATES: PayFields = {
  grossPay: '',
  fedTaxRate: '15.15',
  ssTaxRate: '6.20',
  medicareRate: '1.45',
  scTaxRate: '5.70',
  roth401kRate: '6.00',
  titheRate: '12.74',
  creditCardTotal: '',
  checkingTotal: '',
  katiePay1: '',
  katiePay2: '',
};

function InputRow({ label, value, onChange, prefix, suffix, computed, bold }: {
  label: string; value?: string; onChange?: (v: string) => void;
  prefix?: string; suffix?: string; computed?: number; bold?: boolean;
}) {
  const isReadOnly = computed !== undefined && !onChange;
  return (
    <div className="flex items-center justify-between py-2.5 border-b border-border/50 last:border-0">
      <span className={`text-sm ${bold ? 'font-semibold text-foreground' : 'text-foreground'}`}>{label}</span>
      <div className="flex items-center gap-1">
        {prefix && <span className="text-xs text-muted-foreground">{prefix}</span>}
        {computed !== undefined && !onChange ? (
          <span className={`text-sm tabular-nums text-right ${bold ? 'font-semibold text-foreground' : 'text-foreground'}`}>
            {fmt(computed)}
          </span>
        ) : (
          <input
            type="number"
            step="0.01"
            value={value}
            onChange={e => onChange?.(e.target.value)}
            placeholder="0"
            className="w-24 text-right px-2 py-1 rounded bg-card border border-border text-sm tabular-nums text-foreground focus:outline-none focus:ring-2 focus:ring-accent/30"
          />
        )}
        {suffix && <span className="text-xs text-muted-foreground">{suffix}</span>}
      </div>
    </div>
  );
}

export function PlanningView({ currentMonth, categories, fixedExpenses, onStartMonth }: PlanningViewProps) {
  const nextMonth = addMonths(currentMonth, 1);
  const nextMonthLabel = format(nextMonth, 'MMMM yyyy');
  const nextMonthShort = format(nextMonth, 'MMMM');

  const [pay, setPay] = useState<PayFields>(DEFAULT_RATES);
  const [nextCats, setNextCats] = useState<BudgetCategory[]>(() => categories.map(c => ({ ...c })));
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');

  const up = (field: keyof PayFields) => (v: string) => setPay(p => ({ ...p, [field]: v }));

  const gross = parseFloat(pay.grossPay) || 0;
  const fedTax = gross * (parseFloat(pay.fedTaxRate) || 0) / 100;
  const ssTax = gross * (parseFloat(pay.ssTaxRate) || 0) / 100;
  const medicareTax = gross * (parseFloat(pay.medicareRate) || 0) / 100;
  const scTax = gross * (parseFloat(pay.scTaxRate) || 0) / 100;
  const roth = gross * (parseFloat(pay.roth401kRate) || 0) / 100;
  const netPay = gross - fedTax - ssTax - medicareTax - scTax - roth;

  const titheAmt = gross * (parseFloat(pay.titheRate) || 0) / 100;

  const variableTotal = nextCats.reduce((s, c) => s + c.budgeted, 0);
  const fixedTotal = fixedExpenses.filter(e => e.group === 'bills').reduce((s, e) => s + e.amount, 0);
  const savingsTotal = fixedExpenses.filter(e => e.group === 'savings').reduce((s, e) => s + e.amount, 0);
  const titheTotal = fixedExpenses.filter(e => e.group === 'tithe').reduce((s, e) => s + e.amount, 0);
  const budgetTotal = variableTotal + fixedTotal + savingsTotal + titheTotal;

  const creditCard = parseFloat(pay.creditCardTotal) || 0;
  const checking = parseFloat(pay.checkingTotal) || 0;
  const totalCheckingNeed = budgetTotal;
  const netForSavings = netPay - budgetTotal;

  const katiePay1 = parseFloat(pay.katiePay1) || 0;
  const katiePay2 = parseFloat(pay.katiePay2) || 0;
  const totalKatiePay = katiePay1 + katiePay2;
  const totalMonthlySavings = netForSavings + totalKatiePay;

  const sharedCats = nextCats.filter(c => c.group === 'shared');
  const joeCats = nextCats.filter(c => c.group === 'joe');
  const katieCats = nextCats.filter(c => c.group === 'katie');

  const startEditCat = (id: string, val: number) => { setEditingId(id); setEditValue(String(val)); };
  const saveCatEdit = (id: string) => {
    const v = parseFloat(editValue);
    if (!isNaN(v)) setNextCats(cats => cats.map(c => c.id === id ? { ...c, budgeted: v } : c));
    setEditingId(null);
  };

  return (
    <div className="max-w-lg mx-auto pb-28">
      <div className="px-6 pt-12 safe-top">
        <h1 className="font-display text-xl font-bold text-foreground">Planning</h1>
        <p className="text-sm text-muted-foreground mt-0.5">{nextMonthLabel}</p>
      </div>

      {/* Section A: Pay & Savings Planner */}
      <div className="px-6 mt-6">
        <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Pay & Savings Planner</h2>
        <div className="bg-card rounded-lg shadow-sm px-4 py-2">
          <InputRow label="Gross Pay (Joe)" value={pay.grossPay} onChange={up('grossPay')} prefix="$" />

          <div className="pl-3 border-l-2 border-border/30 ml-1 mt-1 mb-1">
            <div className="flex items-center justify-between py-1.5">
              <span className="text-xs text-muted-foreground">Federal Income Tax</span>
              <div className="flex items-center gap-2">
                <input type="number" step="0.01" value={pay.fedTaxRate} onChange={e => up('fedTaxRate')(e.target.value)}
                  className="w-16 text-right px-1.5 py-0.5 rounded bg-background border border-border text-xs tabular-nums text-foreground focus:outline-none focus:ring-1 focus:ring-accent/30" />
                <span className="text-xs text-muted-foreground">%</span>
                <span className="text-xs tabular-nums text-muted-foreground w-20 text-right">{fmt(fedTax)}</span>
              </div>
            </div>
            <div className="flex items-center justify-between py-1.5">
              <span className="text-xs text-muted-foreground">Social Security</span>
              <div className="flex items-center gap-2">
                <input type="number" step="0.01" value={pay.ssTaxRate} onChange={e => up('ssTaxRate')(e.target.value)}
                  className="w-16 text-right px-1.5 py-0.5 rounded bg-background border border-border text-xs tabular-nums text-foreground focus:outline-none focus:ring-1 focus:ring-accent/30" />
                <span className="text-xs text-muted-foreground">%</span>
                <span className="text-xs tabular-nums text-muted-foreground w-20 text-right">{fmt(ssTax)}</span>
              </div>
            </div>
            <div className="flex items-center justify-between py-1.5">
              <span className="text-xs text-muted-foreground">Medicare</span>
              <div className="flex items-center gap-2">
                <input type="number" step="0.01" value={pay.medicareRate} onChange={e => up('medicareRate')(e.target.value)}
                  className="w-16 text-right px-1.5 py-0.5 rounded bg-background border border-border text-xs tabular-nums text-foreground focus:outline-none focus:ring-1 focus:ring-accent/30" />
                <span className="text-xs text-muted-foreground">%</span>
                <span className="text-xs tabular-nums text-muted-foreground w-20 text-right">{fmt(medicareTax)}</span>
              </div>
            </div>
            <div className="flex items-center justify-between py-1.5">
              <span className="text-xs text-muted-foreground">SC Income Tax</span>
              <div className="flex items-center gap-2">
                <input type="number" step="0.01" value={pay.scTaxRate} onChange={e => up('scTaxRate')(e.target.value)}
                  className="w-16 text-right px-1.5 py-0.5 rounded bg-background border border-border text-xs tabular-nums text-foreground focus:outline-none focus:ring-1 focus:ring-accent/30" />
                <span className="text-xs text-muted-foreground">%</span>
                <span className="text-xs tabular-nums text-muted-foreground w-20 text-right">{fmt(scTax)}</span>
              </div>
            </div>
            <div className="flex items-center justify-between py-1.5">
              <span className="text-xs text-muted-foreground">Roth 401k</span>
              <div className="flex items-center gap-2">
                <input type="number" step="0.01" value={pay.roth401kRate} onChange={e => up('roth401kRate')(e.target.value)}
                  className="w-16 text-right px-1.5 py-0.5 rounded bg-background border border-border text-xs tabular-nums text-foreground focus:outline-none focus:ring-1 focus:ring-accent/30" />
                <span className="text-xs text-muted-foreground">%</span>
                <span className="text-xs tabular-nums text-muted-foreground w-20 text-right">{fmt(roth)}</span>
              </div>
            </div>
          </div>

          <InputRow label="Net Pay" computed={netPay} bold />

          <div className="my-2 border-t border-border" />

          <div className="flex items-center justify-between py-2.5">
            <div>
              <span className="text-sm text-foreground">Tithe</span>
              <div className="flex items-center gap-1 mt-0.5">
                <input type="number" step="0.01" value={pay.titheRate} onChange={e => up('titheRate')(e.target.value)}
                  className="w-14 text-right px-1.5 py-0.5 rounded bg-background border border-border text-xs tabular-nums text-foreground focus:outline-none focus:ring-1 focus:ring-accent/30" />
                <span className="text-[10px] text-muted-foreground">% of gross</span>
              </div>
            </div>
            <span className="text-sm font-medium tabular-nums text-foreground">{fmt(titheAmt)}</span>
          </div>

          <InputRow label="Budget Total" computed={budgetTotal} bold />
          <InputRow label="Credit Card Total" value={pay.creditCardTotal} onChange={up('creditCardTotal')} prefix="$" />
          <InputRow label="Checking Total" value={pay.checkingTotal} onChange={up('checkingTotal')} prefix="$" />
          <InputRow label="Total Checking Need" computed={totalCheckingNeed} bold />
          <InputRow label="Net for Savings (Joe)" computed={netForSavings} bold />

          <div className="my-2 border-t border-border" />

          <InputRow label="Katie Pay 1" value={pay.katiePay1} onChange={up('katiePay1')} prefix="$" />
          <InputRow label="Katie Pay 2" value={pay.katiePay2} onChange={up('katiePay2')} prefix="$" />
          <InputRow label="Total Katie Pay" computed={totalKatiePay} />
          
          <div className="my-2 border-t border-border" />
          <InputRow label="Total Monthly Savings" computed={totalMonthlySavings} bold />
        </div>
      </div>

      {/* Section B: Next Month Budget */}
      <div className="px-6 mt-8">
        <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">{nextMonthShort} Variable Budget</h2>

        {[
          { label: 'Shared', cats: sharedCats },
          { label: "Joe's", cats: joeCats },
          { label: "Katie's", cats: katieCats },
        ].map(({ label, cats }) => (
          <div key={label} className="mb-4">
            <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">{label}</p>
            <div className="bg-card rounded-lg shadow-sm divide-y divide-border overflow-hidden">
              {cats.map(c => (
                <div key={c.id} className="flex justify-between items-center px-4 py-2.5">
                  <span className="text-sm text-foreground">{c.name}</span>
                  {editingId === c.id ? (
                    <div className="flex gap-1.5">
                      <input type="number" step="1" value={editValue} onChange={e => setEditValue(e.target.value)}
                        className="w-20 px-2 py-1 text-right text-sm rounded bg-background border border-border tabular-nums focus:outline-none focus:ring-2 focus:ring-accent/30"
                        autoFocus onKeyDown={e => e.key === 'Enter' && saveCatEdit(c.id)} />
                      <button onClick={() => saveCatEdit(c.id)} className="text-xs text-accent font-medium">Save</button>
                    </div>
                  ) : (
                    <button onClick={() => startEditCat(c.id, c.budgeted)}
                      className="text-sm font-medium tabular-nums text-foreground active:scale-95 transition-transform">
                      {fmtWhole(c.budgeted)}
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}

        <div className="bg-card rounded-lg shadow-sm px-4 py-3 mb-4">
          <div className="flex justify-between text-sm mb-1">
            <span className="text-muted-foreground">Variable Total</span>
            <span className="font-medium tabular-nums">{fmtWhole(variableTotal)}</span>
          </div>
          <div className="flex justify-between text-sm mb-1">
            <span className="text-muted-foreground">Fixed Bills</span>
            <span className="font-medium tabular-nums">{fmtWhole(fixedTotal)}</span>
          </div>
          <div className="flex justify-between text-sm mb-1">
            <span className="text-muted-foreground">Savings Buckets</span>
            <span className="font-medium tabular-nums">{fmtWhole(savingsTotal)}</span>
          </div>
          <div className="flex justify-between text-sm mb-1">
            <span className="text-muted-foreground">Tithe/Giving</span>
            <span className="font-medium tabular-nums">{fmtWhole(titheTotal)}</span>
          </div>
          <div className="border-t border-border mt-2 pt-2 flex justify-between text-sm">
            <span className="font-semibold text-foreground">Total Budget</span>
            <span className="font-semibold tabular-nums text-foreground">{fmtWhole(budgetTotal)}</span>
          </div>
        </div>
      </div>

      <div className="px-6 mt-4 mb-8">
        <button
          onClick={() => onStartMonth(nextMonth, nextCats)}
          className="w-full py-4 rounded-xl bg-accent text-accent-foreground font-display font-semibold text-base active:scale-[0.98] transition-transform shadow-lg"
        >
          Start {nextMonthShort}
        </button>
      </div>
    </div>
  );
}
