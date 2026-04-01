import { useState } from 'react';
import { BudgetCategory, FixedExpense, GIVING_VARIABLE_CATEGORY } from '@/types/budget';
import { format, addMonths } from 'date-fns';
import { ArrowLeft } from 'lucide-react';

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
  planningData: Record<string, string>;
  onUpdatePlanningData: (data: Record<string, string>) => void;
  onBack: () => void;
}

type PayMode = 'estimate' | 'actual';

interface PayFields {
  grossPay: string;
  fedTaxRate: string;
  ssTaxRate: string;
  medicareRate: string;
  scTaxRate: string;
  roth401kRate: string;
  fedTaxAmt: string;
  ssTaxAmt: string;
  medicareAmt: string;
  scTaxAmt: string;
  roth401kAmt: string;
  titheAmt: string;
  creditCardTotal: string;
  checkingTotal: string;
  katiePay1: string;
  katiePay2: string;
}

const DEFAULT_FIELDS: PayFields = {
  grossPay: '',
  fedTaxRate: '15.15',
  ssTaxRate: '6.20',
  medicareRate: '1.45',
  scTaxRate: '5.70',
  roth401kRate: '6.00',
  fedTaxAmt: '',
  ssTaxAmt: '',
  medicareAmt: '',
  scTaxAmt: '',
  roth401kAmt: '',
  titheAmt: '3000',
  creditCardTotal: '',
  checkingTotal: '',
  katiePay1: '',
  katiePay2: '',
};

function InputRow({ label, value, onChange, onBlur, prefix, suffix, computed, bold }: {
  label: string; value?: string; onChange?: (v: string) => void; onBlur?: () => void;
  prefix?: string; suffix?: string; computed?: number; bold?: boolean;
}) {
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
            onBlur={onBlur}
            placeholder="0"
            className="w-24 text-right px-2 py-1 rounded bg-card border border-border text-sm tabular-nums text-foreground focus:outline-none focus:ring-2 focus:ring-accent/30"
          />
        )}
        {suffix && <span className="text-xs text-muted-foreground">{suffix}</span>}
      </div>
    </div>
  );
}

function DeductionRow({ label, mode, rate, onRateChange, dollarAmt, onDollarChange, computedAmt, gross, onBlur }: {
  label: string;
  mode: PayMode;
  rate: string;
  onRateChange: (v: string) => void;
  dollarAmt: string;
  onDollarChange: (v: string) => void;
  computedAmt: number;
  gross: number;
  onBlur?: () => void;
}) {
  const actualPct = gross > 0 ? ((computedAmt / gross) * 100).toFixed(2) : '0.00';

  return (
    <div className="flex items-center justify-between py-1.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="flex items-center gap-2">
        {mode === 'estimate' ? (
          <>
            <input type="number" step="0.01" value={rate} onChange={e => onRateChange(e.target.value)}
              onBlur={onBlur}
              className="w-16 text-right px-1.5 py-0.5 rounded bg-background border border-border text-xs tabular-nums text-foreground focus:outline-none focus:ring-1 focus:ring-accent/30" />
            <span className="text-xs text-muted-foreground">%</span>
            <span className="text-xs tabular-nums text-muted-foreground w-20 text-right">{fmt(computedAmt)}</span>
          </>
        ) : (
          <>
            <span className="text-xs text-muted-foreground">$</span>
            <input type="number" step="0.01" value={dollarAmt} onChange={e => onDollarChange(e.target.value)}
              onBlur={onBlur}
              className="w-20 text-right px-1.5 py-0.5 rounded bg-background border border-border text-xs tabular-nums text-foreground focus:outline-none focus:ring-1 focus:ring-accent/30"
              placeholder="0.00" />
            <span className="text-[10px] tabular-nums text-muted-foreground w-14 text-right">{actualPct}%</span>
          </>
        )}
      </div>
    </div>
  );
}

export function PlanningView({ currentMonth, categories, fixedExpenses, planningData, onUpdatePlanningData, onBack }: PlanningViewProps) {
  const nextMonth = addMonths(currentMonth, 1);
  const nextMonthLabel = format(nextMonth, 'MMMM yyyy');

  const [payMode, setPayMode] = useState<PayMode>(() => (planningData.payMode as PayMode) || 'estimate');
  const [pay, setPay] = useState<PayFields>(() => {
    const restored: PayFields = { ...DEFAULT_FIELDS };
    for (const key of Object.keys(DEFAULT_FIELDS) as (keyof PayFields)[]) {
      if (planningData[key] !== undefined) restored[key] = planningData[key];
    }
    return restored;
  });

  const up = (field: keyof PayFields) => (v: string) => setPay(p => ({ ...p, [field]: v }));

  const saveAll = () => {
    onUpdatePlanningData({ ...pay, payMode });
  };

  const gross = parseFloat(pay.grossPay) || 0;

  const fedTax = payMode === 'estimate' ? gross * (parseFloat(pay.fedTaxRate) || 0) / 100 : (parseFloat(pay.fedTaxAmt) || 0);
  const ssTax = payMode === 'estimate' ? gross * (parseFloat(pay.ssTaxRate) || 0) / 100 : (parseFloat(pay.ssTaxAmt) || 0);
  const medicareTax = payMode === 'estimate' ? gross * (parseFloat(pay.medicareRate) || 0) / 100 : (parseFloat(pay.medicareAmt) || 0);
  const scTax = payMode === 'estimate' ? gross * (parseFloat(pay.scTaxRate) || 0) / 100 : (parseFloat(pay.scTaxAmt) || 0);
  const roth = payMode === 'estimate' ? gross * (parseFloat(pay.roth401kRate) || 0) / 100 : (parseFloat(pay.roth401kAmt) || 0);
  const netPay = gross - fedTax - ssTax - medicareTax - scTax - roth;

  const givingVarCats = categories.filter(c => c.group === 'giving' || c.id === GIVING_VARIABLE_CATEGORY);
  const givingVarAmt = givingVarCats.reduce((s, c) => s + c.budgeted, 0);
  const variableTotal = categories.filter(c => c.group !== 'giving' && c.id !== GIVING_VARIABLE_CATEGORY).reduce((s, c) => s + c.budgeted, 0);
  const fixedBills = fixedExpenses.filter(e => e.group === 'bills');
  const savingsBuckets = fixedExpenses.filter(e => e.group === 'savings');
  const titheItems = fixedExpenses.filter(e => e.group === 'tithe');
  const fixedTotal = fixedBills.reduce((s, e) => s + e.amount, 0);
  const savingsTotal = savingsBuckets.reduce((s, e) => s + e.amount, 0);
  const rawTithe = titheItems.reduce((s, e) => s + e.amount, 0);
  const titheAmt = rawTithe + givingVarAmt;
  const tithePercent = gross > 0 ? ((titheAmt / gross) * 100).toFixed(2) : '0.00';
  const budgetTotal = variableTotal + fixedTotal + savingsTotal + titheAmt;

  const creditCard = parseFloat(pay.creditCardTotal) || 0;
  const checking = parseFloat(pay.checkingTotal) || 0;
  const totalCheckingNeed = budgetTotal + creditCard - checking;
  const netForSavings = netPay - totalCheckingNeed;

  const katiePay1 = parseFloat(pay.katiePay1) || 0;
  const katiePay2 = parseFloat(pay.katiePay2) || 0;
  const totalKatiePay = katiePay1 + katiePay2;
  const totalMonthlySavings = netForSavings + totalKatiePay;

  return (
    <div className="max-w-lg mx-auto pb-28">
      <div className="px-6 pt-12 safe-top">
        <button onClick={onBack} className="flex items-center gap-1 text-accent text-sm font-medium mb-4 active:scale-95 transition-transform">
          <ArrowLeft size={16} /> Back
        </button>
        <h1 className="font-display text-xl font-bold text-foreground">Planning</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Pay & Savings Calculator</p>
      </div>

      {/* Pay & Savings Planner */}
      <div className="px-6 mt-6">
        <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Pay & Savings Planner</h2>

        <div className="flex bg-card rounded-lg p-1 mb-3 shadow-sm">
          {(['estimate', 'actual'] as PayMode[]).map(mode => (
            <button
              key={mode}
              onClick={() => { setPayMode(mode); onUpdatePlanningData({ ...pay, payMode: mode }); }}
              className={`flex-1 py-2 rounded-md text-xs font-semibold transition-colors active:scale-[0.98] ${
                payMode === mode
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'text-muted-foreground'
              }`}
            >
              {mode === 'estimate' ? 'Estimate' : 'Actual'}
            </button>
          ))}
        </div>

        <div className="bg-card rounded-lg shadow-sm px-4 py-2">
          <InputRow label="Gross Pay (Joe)" value={pay.grossPay} onChange={up('grossPay')} onBlur={saveAll} prefix="$" />

          <div className="pl-3 border-l-2 border-border/30 ml-1 mt-1 mb-1">
            <DeductionRow label="Federal Income Tax" mode={payMode}
              rate={pay.fedTaxRate} onRateChange={up('fedTaxRate')}
              dollarAmt={pay.fedTaxAmt} onDollarChange={up('fedTaxAmt')}
              computedAmt={fedTax} gross={gross} onBlur={saveAll} />
            <DeductionRow label="Social Security" mode={payMode}
              rate={pay.ssTaxRate} onRateChange={up('ssTaxRate')}
              dollarAmt={pay.ssTaxAmt} onDollarChange={up('ssTaxAmt')}
              computedAmt={ssTax} gross={gross} onBlur={saveAll} />
            <DeductionRow label="Medicare" mode={payMode}
              rate={pay.medicareRate} onRateChange={up('medicareRate')}
              dollarAmt={pay.medicareAmt} onDollarChange={up('medicareAmt')}
              computedAmt={medicareTax} gross={gross} onBlur={saveAll} />
            <DeductionRow label="SC Income Tax" mode={payMode}
              rate={pay.scTaxRate} onRateChange={up('scTaxRate')}
              dollarAmt={pay.scTaxAmt} onDollarChange={up('scTaxAmt')}
              computedAmt={scTax} gross={gross} onBlur={saveAll} />
            <DeductionRow label="Roth 401k" mode={payMode}
              rate={pay.roth401kRate} onRateChange={up('roth401kRate')}
              dollarAmt={pay.roth401kAmt} onDollarChange={up('roth401kAmt')}
              computedAmt={roth} gross={gross} onBlur={saveAll} />
          </div>

          <InputRow label="Net Pay" computed={netPay} bold />

          <div className="my-2 border-t border-border" />

          {/* Tithe */}
          <div className="flex items-center justify-between py-2.5 border-b border-border/50">
            <div>
              <span className="text-sm text-foreground">Tithe/Giving</span>
              <p className="text-[10px] text-muted-foreground mt-0.5">{tithePercent}% of gross</p>
            </div>
            <span className="text-sm font-medium tabular-nums text-foreground">{fmt(titheAmt)}</span>
          </div>

          <InputRow label="Budget Total" computed={budgetTotal} bold />
          <InputRow label="Credit Card Total" value={pay.creditCardTotal} onChange={up('creditCardTotal')} onBlur={saveAll} prefix="$" />
          <InputRow label="Checking Total" value={pay.checkingTotal} onChange={up('checkingTotal')} onBlur={saveAll} prefix="$" />
          <InputRow label="Total Checking Need" computed={totalCheckingNeed} bold />
          <InputRow label="Net for Savings (Joe)" computed={netForSavings} bold />

          <div className="my-2 border-t border-border" />

          <InputRow label="Katie Pay 1" value={pay.katiePay1} onChange={up('katiePay1')} onBlur={saveAll} prefix="$" />
          <InputRow label="Katie Pay 2" value={pay.katiePay2} onChange={up('katiePay2')} onBlur={saveAll} prefix="$" />
          <InputRow label="Total Katie Pay" computed={totalKatiePay} />

          <div className="my-2 border-t border-border" />
          <InputRow label="Total Monthly Savings" computed={totalMonthlySavings} bold />
        </div>
      </div>
    </div>
  );
}
