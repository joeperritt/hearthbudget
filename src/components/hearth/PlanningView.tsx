import { useState } from 'react';
import { BudgetCategory, FixedExpense, GIVING_VARIABLE_CATEGORY } from '@/types/budget';
import { format, addMonths } from 'date-fns';
import { ArrowLeft, ChevronDown, ChevronUp, Info, Plus, Minus } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

function fmt(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(n);
}

interface PlanningViewProps {
  currentMonth: Date;
  categories: BudgetCategory[];
  fixedExpenses: FixedExpense[];
  planningData: Record<string, string>;
  onUpdatePlanningData: (data: Record<string, string>) => void;
  onBack: () => void;
}

type PayFrequency = 'monthly' | 'semimonthly' | 'biweekly' | 'weekly';

const FREQ_LABELS: Record<PayFrequency, string> = {
  monthly: 'Monthly (12x)',
  semimonthly: 'Semi-Monthly (24x)',
  biweekly: 'Bi-Weekly (26x)',
  weekly: 'Weekly (52x)',
};

const FREQ_PERIODS: Record<PayFrequency, number> = {
  monthly: 12,
  semimonthly: 24,
  biweekly: 26,
  weekly: 52,
};

const FREQ_MULTIPLIERS: Record<PayFrequency, number> = {
  monthly: 1,
  semimonthly: 2,
  biweekly: 26 / 12,
  weekly: 52 / 12,
};

interface PayFields {
  grossPay: string; // now stores ANNUAL gross
  netIncome: string;
  katieNetIncome: string;
  fedTaxAmt: string;
  ssTaxAmt: string;
  medicareAmt: string;
  stateTaxAmt: string;
  retirementAmt: string;
  savingsDeductions: string;
  otherDeductions: string;
  payFrequency: string;
  titheAmt: string;
  creditCardTotal: string;
  checkingTotal: string;
  partnerEnabled: string;
  partnerGrossPay: string; // now stores ANNUAL gross
  partnerFedTaxAmt: string;
  partnerSsTaxAmt: string;
  partnerMedicareAmt: string;
  partnerStateTaxAmt: string;
  partnerRetirementAmt: string;
  partnerSavingsDeductions: string;
  partnerOtherDeductions: string;
  partnerPayFrequency: string;
  // Legacy rate fields kept for backward compat
  fedTaxRate: string;
  ssTaxRate: string;
  medicareRate: string;
  stateTaxRate: string;
  retirementRate: string;
  partnerFedTaxRate: string;
  partnerSsTaxRate: string;
  partnerMedicareRate: string;
  partnerStateTaxRate: string;
  partnerRetirementRate: string;
}

const DEFAULT_FIELDS: PayFields = {
  grossPay: '', netIncome: '', katieNetIncome: '',
  fedTaxAmt: '', ssTaxAmt: '', medicareAmt: '', stateTaxAmt: '', retirementAmt: '',
  savingsDeductions: '', otherDeductions: '', payFrequency: 'monthly',
  titheAmt: '3000', creditCardTotal: '', checkingTotal: '',
  partnerEnabled: 'false', partnerGrossPay: '',
  partnerFedTaxAmt: '', partnerSsTaxAmt: '', partnerMedicareAmt: '',
  partnerStateTaxAmt: '', partnerRetirementAmt: '',
  partnerSavingsDeductions: '', partnerOtherDeductions: '', partnerPayFrequency: 'monthly',
  fedTaxRate: '', ssTaxRate: '', medicareRate: '', stateTaxRate: '', retirementRate: '',
  partnerFedTaxRate: '', partnerSsTaxRate: '', partnerMedicareRate: '', partnerStateTaxRate: '', partnerRetirementRate: '',
};

function InputRow({ label, value, onChange, onBlur, prefix, suffix, computed, bold, sublabel, highlight }: {
  label: string; value?: string; onChange?: (v: string) => void; onBlur?: () => void;
  prefix?: string; suffix?: string; computed?: number; bold?: boolean; sublabel?: string; highlight?: 'positive' | 'negative';
}) {
  const highlightClass = highlight === 'positive' ? 'text-green-600 dark:text-green-400' : highlight === 'negative' ? 'text-destructive' : '';
  return (
    <div className="flex items-center justify-between py-2.5 border-b border-border/50 last:border-0">
      <div>
        <span className={`text-sm ${bold ? 'font-semibold text-foreground' : 'text-foreground'}`}>{label}</span>
        {sublabel && <p className="text-[10px] text-muted-foreground mt-0.5">{sublabel}</p>}
      </div>
      <div className="flex items-center gap-1">
        {prefix && <span className="text-xs text-muted-foreground">{prefix}</span>}
        {computed !== undefined && !onChange ? (
          <span className={`text-sm tabular-nums text-right ${bold ? 'font-semibold' : ''} ${highlightClass || 'text-foreground'}`}>
            {fmt(computed)}
          </span>
        ) : (
          <input
            type="number" step="0.01" value={value} onChange={e => onChange?.(e.target.value)} onBlur={onBlur}
            placeholder="0"
            className="w-24 text-right px-2 py-1 rounded bg-card border border-border text-sm tabular-nums text-foreground focus:outline-none focus:ring-2 focus:ring-accent/30"
          />
        )}
        {suffix && <span className="text-xs text-muted-foreground">{suffix}</span>}
      </div>
    </div>
  );
}

function DollarDeductionRow({ label, value, onChange, onBlur, sublabel }: {
  label: string; value: string; onChange: (v: string) => void; onBlur?: () => void; sublabel?: string;
}) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <div>
        <span className="text-xs text-muted-foreground">{label}</span>
        {sublabel && <p className="text-[10px] text-muted-foreground/70 mt-0.5">{sublabel}</p>}
      </div>
      <div className="flex items-center gap-1">
        <span className="text-xs text-muted-foreground">$</span>
        <input type="number" step="0.01" value={value} onChange={e => onChange(e.target.value)} onBlur={onBlur}
          placeholder="0.00"
          className="w-20 text-right px-1.5 py-0.5 rounded bg-background border border-border text-xs tabular-nums text-foreground focus:outline-none focus:ring-1 focus:ring-accent/30" />
      </div>
    </div>
  );
}

interface IncomeBreakdownProps {
  label: string;
  annualGross: string;
  onAnnualGrossChange: (v: string) => void;
  fedTaxAmt: string; onFedTaxAmtChange: (v: string) => void;
  ssTaxAmt: string; onSsTaxAmtChange: (v: string) => void;
  medicareAmt: string; onMedicareAmtChange: (v: string) => void;
  stateTaxAmt: string; onStateTaxAmtChange: (v: string) => void;
  retirementAmt: string; onRetirementAmtChange: (v: string) => void;
  savingsDeductions: string; onSavingsDeductionsChange: (v: string) => void;
  otherDeductions: string; onOtherDeductionsChange: (v: string) => void;
  payFrequency: PayFrequency;
  onPayFrequencyChange: (v: PayFrequency) => void;
  onBlur: () => void;
  computedMonthlyNet: number;
  monthlyGross: number;
  perPaycheckGross: number;
}

function IncomeBreakdown({
  label, annualGross, onAnnualGrossChange,
  fedTaxAmt, onFedTaxAmtChange, ssTaxAmt, onSsTaxAmtChange,
  medicareAmt, onMedicareAmtChange, stateTaxAmt, onStateTaxAmtChange,
  retirementAmt, onRetirementAmtChange, savingsDeductions, onSavingsDeductionsChange,
  otherDeductions, onOtherDeductionsChange,
  payFrequency, onPayFrequencyChange, onBlur,
  computedMonthlyNet, monthlyGross, perPaycheckGross,
}: IncomeBreakdownProps) {
  return (
    <>
      <div className="flex items-center py-2 border-b border-border/50">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{label}</span>
      </div>

      {/* Annual Gross Income - primary input */}
      <div className="flex items-center justify-between py-2.5 border-b border-border/50">
        <div>
          <span className="text-sm font-semibold text-foreground">Annual Gross Income</span>
          <p className="text-[10px] text-muted-foreground mt-0.5">Monthly: {fmt(monthlyGross)}</p>
        </div>
        <div className="flex items-center gap-1">
          <span className="text-xs text-muted-foreground">$</span>
          <input
            type="number" step="0.01" value={annualGross} onChange={e => onAnnualGrossChange(e.target.value)} onBlur={onBlur}
            placeholder="0"
            className="w-28 text-right px-2 py-1 rounded bg-card border border-border text-sm tabular-nums text-foreground focus:outline-none focus:ring-2 focus:ring-accent/30"
          />
        </div>
      </div>

      {/* Pay Frequency Selector */}
      <div className="flex items-center justify-between py-2.5 border-b border-border/50">
        <div>
          <span className="text-sm text-foreground">Pay Frequency</span>
          <p className="text-[10px] text-muted-foreground mt-0.5">Per paycheck: {fmt(perPaycheckGross)}</p>
        </div>
        <Select value={payFrequency} onValueChange={(v) => onPayFrequencyChange(v as PayFrequency)}>
          <SelectTrigger className="w-40 h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.entries(FREQ_LABELS) as [PayFrequency, string][]).map(([key, lbl]) => (
              <SelectItem key={key} value={key} className="text-xs">{lbl}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Per-paycheck deductions */}
      <div className="pl-3 border-l-2 border-border/30 ml-1 mt-1 mb-1">
        <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider py-1">Per-Paycheck Deductions</p>
        <DollarDeductionRow label="Federal Income Tax" value={fedTaxAmt} onChange={onFedTaxAmtChange} onBlur={onBlur} />
        <DollarDeductionRow label="Social Security" value={ssTaxAmt} onChange={onSsTaxAmtChange} onBlur={onBlur} />
        <DollarDeductionRow label="Medicare" value={medicareAmt} onChange={onMedicareAmtChange} onBlur={onBlur} />
        <DollarDeductionRow label="State Income Tax" value={stateTaxAmt} onChange={onStateTaxAmtChange} onBlur={onBlur} />
        <DollarDeductionRow label="Retirement Contribution" value={retirementAmt} onChange={onRetirementAmtChange} onBlur={onBlur} />
        <DollarDeductionRow label="Savings Deductions" value={savingsDeductions} onChange={onSavingsDeductionsChange} onBlur={onBlur}
          sublabel="HSA, FSA, dependent care, etc." />
        <DollarDeductionRow label="Other Deductions" value={otherDeductions} onChange={onOtherDeductionsChange} onBlur={onBlur}
          sublabel="Union dues, insurance, etc." />
      </div>

      <InputRow
        label="Net Pay (monthly)"
        computed={computedMonthlyNet}
        bold
        sublabel={`Per paycheck: ${fmt(computedMonthlyNet / FREQ_MULTIPLIERS[payFrequency])}`}
      />
    </>
  );
}

/**
 * Calculate monthly net pay from annual gross and per-paycheck deductions.
 * annualGross is the annual salary; deductions are per-paycheck amounts.
 */
function calcMonthlyNet(annualGross: string, fedTaxAmt: string, ssTaxAmt: string, medicareAmt: string, stateTaxAmt: string, retirementAmt: string, savingsDeductions: string, otherDeductions: string, freq: PayFrequency) {
  const annual = parseFloat(annualGross) || 0;
  const periods = FREQ_PERIODS[freq];
  const perPaycheckGross = annual / periods;
  const perPaycheckNet = perPaycheckGross
    - (parseFloat(fedTaxAmt) || 0) - (parseFloat(ssTaxAmt) || 0)
    - (parseFloat(medicareAmt) || 0) - (parseFloat(stateTaxAmt) || 0)
    - (parseFloat(retirementAmt) || 0) - (parseFloat(savingsDeductions) || 0)
    - (parseFloat(otherDeductions) || 0);
  return perPaycheckNet * FREQ_MULTIPLIERS[freq];
}

export function PlanningView({ currentMonth, categories, fixedExpenses, planningData, onUpdatePlanningData, onBack }: PlanningViewProps) {
  const [advancedMode, setAdvancedMode] = useState(() => planningData.incomeMode === 'gross');
  const [pay, setPay] = useState<PayFields>(() => {
    const restored: PayFields = { ...DEFAULT_FIELDS };
    for (const key of Object.keys(DEFAULT_FIELDS) as (keyof PayFields)[]) {
      if (planningData[key] !== undefined) restored[key] = planningData[key];
    }
    return restored;
  });
  const [partnerOpen, setPartnerOpen] = useState(() => pay.partnerEnabled === 'true');

  const up = (field: keyof PayFields) => (v: string) => setPay(p => ({ ...p, [field]: v }));

  const saveAll = () => {
    onUpdatePlanningData({ ...pay, incomeMode: advancedMode ? 'gross' : 'net' });
  };

  const toggleMode = () => {
    const next = !advancedMode;
    setAdvancedMode(next);
    onUpdatePlanningData({ ...pay, incomeMode: next ? 'gross' : 'net' });
  };

  const togglePartner = () => {
    const next = !partnerOpen;
    setPartnerOpen(next);
    const updated = { ...pay, partnerEnabled: next ? 'true' : 'false' };
    setPay(updated);
    onUpdatePlanningData({ ...updated, incomeMode: 'gross' });
  };

  // Frequencies
  const primaryFreq = (pay.payFrequency || 'monthly') as PayFrequency;
  const partnerFreq = (pay.partnerPayFrequency || 'monthly') as PayFrequency;

  const setPrimaryFreq = (f: PayFrequency) => {
    const updated = { ...pay, payFrequency: f };
    setPay(updated);
    onUpdatePlanningData({ ...updated, incomeMode: 'gross' });
  };
  const setPartnerFreq = (f: PayFrequency) => {
    const updated = { ...pay, partnerPayFrequency: f };
    setPay(updated);
    onUpdatePlanningData({ ...updated, incomeMode: 'gross' });
  };

  // Primary calculations
  const primaryAnnualGross = parseFloat(pay.grossPay) || 0;
  const primaryMonthlyGross = primaryAnnualGross / 12;
  const primaryPerPaycheckGross = primaryAnnualGross / FREQ_PERIODS[primaryFreq];
  const primaryMonthlyNet = calcMonthlyNet(pay.grossPay, pay.fedTaxAmt, pay.ssTaxAmt, pay.medicareAmt, pay.stateTaxAmt, pay.retirementAmt, pay.savingsDeductions, pay.otherDeductions, primaryFreq);

  // Partner calculations
  const partnerAnnualGross = parseFloat(pay.partnerGrossPay) || 0;
  const partnerMonthlyGross = partnerAnnualGross / 12;
  const partnerPerPaycheckGross = partnerAnnualGross / FREQ_PERIODS[partnerFreq];
  const partnerMonthlyNet = calcMonthlyNet(pay.partnerGrossPay, pay.partnerFedTaxAmt, pay.partnerSsTaxAmt, pay.partnerMedicareAmt, pay.partnerStateTaxAmt, pay.partnerRetirementAmt, pay.partnerSavingsDeductions, pay.partnerOtherDeductions, partnerFreq);

  // Simple mode
  const netIncome = parseFloat(pay.netIncome) || 0;
  const katieNetIncome = parseFloat(pay.katieNetIncome) || 0;

  // Budget totals
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
  const budgetTotal = variableTotal + fixedTotal + savingsTotal + titheAmt;

  // Simple mode totals
  const totalHouseholdIncome = netIncome + katieNetIncome;
  const simpleNetForSavings = totalHouseholdIncome - budgetTotal;

  // Advanced mode totals
  const combinedNetPay = primaryMonthlyNet + (partnerOpen ? partnerMonthlyNet : 0);
  const combinedMonthlyGross = primaryMonthlyGross + (partnerOpen ? partnerMonthlyGross : 0);
  const householdNetForSavings = combinedNetPay - budgetTotal;

  const tithePercent = combinedMonthlyGross > 0 ? ((titheAmt / combinedMonthlyGross) * 100).toFixed(2) : '0.00';
  const surplusLabel = (amount: number) => amount >= 0 ? 'Monthly Surplus' : 'Monthly Deficit';
  const surplusHighlight = (amount: number): 'positive' | 'negative' | undefined => amount >= 0 ? 'positive' : 'negative';

  return (
    <div className="max-w-lg mx-auto pb-28">
      <div className="px-6 pt-12 safe-top">
        <button onClick={onBack} className="flex items-center gap-1 text-accent text-sm font-medium mb-4 active:scale-95 transition-transform">
          <ArrowLeft size={16} /> Back
        </button>
        <h1 className="font-display text-xl font-bold text-foreground">Planning</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Pay & Savings Calculator</p>
      </div>

      <div className="px-6 mt-6">
        <button onClick={toggleMode}
          className="flex items-center justify-between w-full mb-4 px-4 py-2.5 rounded-lg bg-card border border-border shadow-sm active:scale-[0.99] transition-transform">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-foreground">
              {advancedMode ? 'Gross Income Mode' : 'Net Income Mode'}
            </span>
            <span className="text-[10px] text-muted-foreground px-1.5 py-0.5 rounded bg-muted">
              {advancedMode ? 'Advanced' : 'Simple'}
            </span>
          </div>
          {advancedMode ? <ChevronUp size={16} className="text-muted-foreground" /> : <ChevronDown size={16} className="text-muted-foreground" />}
        </button>

        <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Pay & Savings Planner</h2>

        <div className="bg-card rounded-lg shadow-sm px-4 py-2">
          {advancedMode ? (
            <>
              <IncomeBreakdown
                label="Primary Income"
                annualGross={pay.grossPay} onAnnualGrossChange={up('grossPay')}
                fedTaxAmt={pay.fedTaxAmt} onFedTaxAmtChange={up('fedTaxAmt')}
                ssTaxAmt={pay.ssTaxAmt} onSsTaxAmtChange={up('ssTaxAmt')}
                medicareAmt={pay.medicareAmt} onMedicareAmtChange={up('medicareAmt')}
                stateTaxAmt={pay.stateTaxAmt} onStateTaxAmtChange={up('stateTaxAmt')}
                retirementAmt={pay.retirementAmt} onRetirementAmtChange={up('retirementAmt')}
                savingsDeductions={pay.savingsDeductions} onSavingsDeductionsChange={up('savingsDeductions')}
                otherDeductions={pay.otherDeductions} onOtherDeductionsChange={up('otherDeductions')}
                payFrequency={primaryFreq} onPayFrequencyChange={setPrimaryFreq}
                onBlur={saveAll} computedMonthlyNet={primaryMonthlyNet}
                monthlyGross={primaryMonthlyGross} perPaycheckGross={primaryPerPaycheckGross}
              />

              <div className="my-2 border-t border-border" />

              <button onClick={togglePartner}
                className="flex items-center justify-between w-full py-2.5 border-b border-border/50 active:scale-[0.99] transition-transform">
                <span className="text-sm font-medium text-foreground">Partner Income</span>
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] text-muted-foreground">{partnerOpen ? 'Hide' : 'Show'}</span>
                  {partnerOpen ? <Minus size={14} className="text-muted-foreground" /> : <Plus size={14} className="text-muted-foreground" />}
                </div>
              </button>

              {partnerOpen && (
                <IncomeBreakdown
                  label="Partner Income"
                  annualGross={pay.partnerGrossPay} onAnnualGrossChange={up('partnerGrossPay')}
                  fedTaxAmt={pay.partnerFedTaxAmt} onFedTaxAmtChange={up('partnerFedTaxAmt')}
                  ssTaxAmt={pay.partnerSsTaxAmt} onSsTaxAmtChange={up('partnerSsTaxAmt')}
                  medicareAmt={pay.partnerMedicareAmt} onMedicareAmtChange={up('partnerMedicareAmt')}
                  stateTaxAmt={pay.partnerStateTaxAmt} onStateTaxAmtChange={up('partnerStateTaxAmt')}
                  retirementAmt={pay.partnerRetirementAmt} onRetirementAmtChange={up('partnerRetirementAmt')}
                  savingsDeductions={pay.partnerSavingsDeductions} onSavingsDeductionsChange={up('partnerSavingsDeductions')}
                  otherDeductions={pay.partnerOtherDeductions} onOtherDeductionsChange={up('partnerOtherDeductions')}
                  payFrequency={partnerFreq} onPayFrequencyChange={setPartnerFreq}
                  onBlur={saveAll} computedMonthlyNet={partnerMonthlyNet}
                  monthlyGross={partnerMonthlyGross} perPaycheckGross={partnerPerPaycheckGross}
                />
              )}

              <div className="my-2 border-t border-border" />

              <div className="flex items-center justify-between py-2.5 border-b border-border/50">
                <div>
                  <span className="text-sm text-foreground">Tithe/Giving</span>
                  <p className="text-[10px] text-muted-foreground mt-0.5">{tithePercent}% of gross</p>
                </div>
                <span className="text-sm font-medium tabular-nums text-foreground">{fmt(titheAmt)}</span>
              </div>

              <div className="flex items-start gap-2 py-2.5 border-b border-border/50">
                <Info size={12} className="text-muted-foreground mt-0.5 shrink-0" />
                <p className="text-[10px] text-muted-foreground leading-relaxed">
                  Gross income data is used by the AI Advisor for financial health insights like giving as a percentage of gross and effective savings rate. This data is never shared externally.
                </p>
              </div>

              <InputRow label="Budget Total" computed={budgetTotal} bold />
              <InputRow label="Household Net for Savings" computed={householdNetForSavings} bold />

              <div className="my-2 border-t border-border" />
              <InputRow label={surplusLabel(householdNetForSavings)} computed={householdNetForSavings} bold highlight={surplusHighlight(householdNetForSavings)} />
            </>
          ) : (
            <>
              <InputRow label="Monthly Take-Home (Joe)" value={pay.netIncome} onChange={up('netIncome')} onBlur={saveAll} prefix="$" />
              <InputRow label="Monthly Take-Home (Katie)" value={pay.katieNetIncome} onChange={up('katieNetIncome')} onBlur={saveAll} prefix="$" />
              <InputRow label="Total Household Income" computed={totalHouseholdIncome} bold />

              <div className="my-2 border-t border-border" />

              <InputRow label="Budget Total" computed={budgetTotal} bold />
              <InputRow label={surplusLabel(simpleNetForSavings)} computed={simpleNetForSavings} bold highlight={surplusHighlight(simpleNetForSavings)} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
