import { useState } from 'react';
import { BudgetCategory, FixedExpense, GIVING_VARIABLE_CATEGORY } from '@/types/budget';
import { format, addMonths } from 'date-fns';
import { ArrowLeft, ChevronDown, ChevronUp, Info, Plus, Minus } from 'lucide-react';

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

type PayMode = 'estimate' | 'actual';

interface PayFields {
  grossPay: string;
  netIncome: string;
  katieNetIncome: string;
  fedTaxRate: string;
  ssTaxRate: string;
  medicareRate: string;
  stateTaxRate: string;
  retirementRate: string;
  fedTaxAmt: string;
  ssTaxAmt: string;
  medicareAmt: string;
  stateTaxAmt: string;
  retirementAmt: string;
  titheAmt: string;
  creditCardTotal: string;
  checkingTotal: string;
  // Partner fields
  partnerEnabled: string;
  partnerGrossPay: string;
  partnerFedTaxRate: string;
  partnerSsTaxRate: string;
  partnerMedicareRate: string;
  partnerStateTaxRate: string;
  partnerRetirementRate: string;
  partnerFedTaxAmt: string;
  partnerSsTaxAmt: string;
  partnerMedicareAmt: string;
  partnerStateTaxAmt: string;
  partnerRetirementAmt: string;
}

const DEFAULT_FIELDS: PayFields = {
  grossPay: '',
  netIncome: '',
  katieNetIncome: '',
  fedTaxRate: '15.15',
  ssTaxRate: '6.20',
  medicareRate: '1.45',
  stateTaxRate: '5.70',
  retirementRate: '6.00',
  fedTaxAmt: '',
  ssTaxAmt: '',
  medicareAmt: '',
  stateTaxAmt: '',
  retirementAmt: '',
  titheAmt: '3000',
  creditCardTotal: '',
  checkingTotal: '',
  partnerEnabled: 'false',
  partnerGrossPay: '',
  partnerFedTaxRate: '15.15',
  partnerSsTaxRate: '6.20',
  partnerMedicareRate: '1.45',
  partnerStateTaxRate: '5.70',
  partnerRetirementRate: '6.00',
  partnerFedTaxAmt: '',
  partnerSsTaxAmt: '',
  partnerMedicareAmt: '',
  partnerStateTaxAmt: '',
  partnerRetirementAmt: '',
};

function InputRow({ label, value, onChange, onBlur, prefix, suffix, computed, bold, sublabel }: {
  label: string; value?: string; onChange?: (v: string) => void; onBlur?: () => void;
  prefix?: string; suffix?: string; computed?: number; bold?: boolean; sublabel?: string;
}) {
  return (
    <div className="flex items-center justify-between py-2.5 border-b border-border/50 last:border-0">
      <div>
        <span className={`text-sm ${bold ? 'font-semibold text-foreground' : 'text-foreground'}`}>{label}</span>
        {sublabel && <p className="text-[10px] text-muted-foreground mt-0.5">{sublabel}</p>}
      </div>
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

function calcDeduction(mode: PayMode, gross: number, rate: string, amt: string) {
  return mode === 'estimate' ? gross * (parseFloat(rate) || 0) / 100 : (parseFloat(amt) || 0);
}

interface IncomeBreakdownProps {
  label: string;
  grossPay: string;
  onGrossPayChange: (v: string) => void;
  fedTaxRate: string; onFedTaxRateChange: (v: string) => void;
  ssTaxRate: string; onSsTaxRateChange: (v: string) => void;
  medicareRate: string; onMedicareRateChange: (v: string) => void;
  stateTaxRate: string; onStateTaxRateChange: (v: string) => void;
  retirementRate: string; onRetirementRateChange: (v: string) => void;
  fedTaxAmt: string; onFedTaxAmtChange: (v: string) => void;
  ssTaxAmt: string; onSsTaxAmtChange: (v: string) => void;
  medicareAmt: string; onMedicareAmtChange: (v: string) => void;
  stateTaxAmt: string; onStateTaxAmtChange: (v: string) => void;
  retirementAmt: string; onRetirementAmtChange: (v: string) => void;
  payMode: PayMode;
  onBlur: () => void;
  computedNetPay: number;
}

function IncomeBreakdown({ label, grossPay, onGrossPayChange, fedTaxRate, onFedTaxRateChange, ssTaxRate, onSsTaxRateChange, medicareRate, onMedicareRateChange, stateTaxRate, onStateTaxRateChange, retirementRate, onRetirementRateChange, fedTaxAmt, onFedTaxAmtChange, ssTaxAmt, onSsTaxAmtChange, medicareAmt, onMedicareAmtChange, stateTaxAmt, onStateTaxAmtChange, retirementAmt, onRetirementAmtChange, payMode, onBlur, computedNetPay }: IncomeBreakdownProps) {
  const gross = parseFloat(grossPay) || 0;
  const fedTax = calcDeduction(payMode, gross, fedTaxRate, fedTaxAmt);
  const ssTax = calcDeduction(payMode, gross, ssTaxRate, ssTaxAmt);
  const medicareTax = calcDeduction(payMode, gross, medicareRate, medicareAmt);
  const stateTax = calcDeduction(payMode, gross, stateTaxRate, stateTaxAmt);
  const retirement = calcDeduction(payMode, gross, retirementRate, retirementAmt);

  return (
    <>
      <div className="flex items-center py-2 border-b border-border/50">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{label}</span>
      </div>
      <InputRow label="Gross Pay" value={grossPay} onChange={onGrossPayChange} onBlur={onBlur} prefix="$" />
      <div className="pl-3 border-l-2 border-border/30 ml-1 mt-1 mb-1">
        <DeductionRow label="Federal Income Tax" mode={payMode}
          rate={fedTaxRate} onRateChange={onFedTaxRateChange}
          dollarAmt={fedTaxAmt} onDollarChange={onFedTaxAmtChange}
          computedAmt={fedTax} gross={gross} onBlur={onBlur} />
        <DeductionRow label="Social Security" mode={payMode}
          rate={ssTaxRate} onRateChange={onSsTaxRateChange}
          dollarAmt={ssTaxAmt} onDollarChange={onSsTaxAmtChange}
          computedAmt={ssTax} gross={gross} onBlur={onBlur} />
        <DeductionRow label="Medicare" mode={payMode}
          rate={medicareRate} onRateChange={onMedicareRateChange}
          dollarAmt={medicareAmt} onDollarChange={onMedicareAmtChange}
          computedAmt={medicareTax} gross={gross} onBlur={onBlur} />
        <DeductionRow label="State Income Tax" mode={payMode}
          rate={stateTaxRate} onRateChange={onStateTaxRateChange}
          dollarAmt={stateTaxAmt} onDollarChange={onStateTaxAmtChange}
          computedAmt={stateTax} gross={gross} onBlur={onBlur} />
        <DeductionRow label="Retirement Contribution" mode={payMode}
          rate={retirementRate} onRateChange={onRetirementRateChange}
          dollarAmt={retirementAmt} onDollarChange={onRetirementAmtChange}
          computedAmt={retirement} gross={gross} onBlur={onBlur} />
      </div>
      <InputRow label="Net Pay" computed={computedNetPay} bold />
    </>
  );
}

export function PlanningView({ currentMonth, categories, fixedExpenses, planningData, onUpdatePlanningData, onBack }: PlanningViewProps) {
  const [advancedMode, setAdvancedMode] = useState(() => planningData.incomeMode === 'gross');
  const [payMode, setPayMode] = useState<PayMode>(() => (planningData.payMode as PayMode) || 'estimate');
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
    onUpdatePlanningData({ ...pay, payMode, incomeMode: advancedMode ? 'gross' : 'net' });
  };

  const toggleMode = () => {
    const next = !advancedMode;
    setAdvancedMode(next);
    onUpdatePlanningData({ ...pay, payMode, incomeMode: next ? 'gross' : 'net' });
  };

  const togglePartner = () => {
    const next = !partnerOpen;
    setPartnerOpen(next);
    const updated = { ...pay, partnerEnabled: next ? 'true' : 'false' };
    setPay(updated);
    onUpdatePlanningData({ ...updated, payMode, incomeMode: 'gross' });
  };

  // Primary calculations
  const gross = parseFloat(pay.grossPay) || 0;
  const netIncome = parseFloat(pay.netIncome) || 0;
  const katieNetIncome = parseFloat(pay.katieNetIncome) || 0;

  const fedTax = calcDeduction(payMode, gross, pay.fedTaxRate, pay.fedTaxAmt);
  const ssTax = calcDeduction(payMode, gross, pay.ssTaxRate, pay.ssTaxAmt);
  const medicareTax = calcDeduction(payMode, gross, pay.medicareRate, pay.medicareAmt);
  const stateTax = calcDeduction(payMode, gross, pay.stateTaxRate, pay.stateTaxAmt);
  const retirement = calcDeduction(payMode, gross, pay.retirementRate, pay.retirementAmt);
  const computedNetPay = gross - fedTax - ssTax - medicareTax - stateTax - retirement;

  // Partner calculations
  const partnerGross = parseFloat(pay.partnerGrossPay) || 0;
  const partnerFedTax = calcDeduction(payMode, partnerGross, pay.partnerFedTaxRate, pay.partnerFedTaxAmt);
  const partnerSsTax = calcDeduction(payMode, partnerGross, pay.partnerSsTaxRate, pay.partnerSsTaxAmt);
  const partnerMedicareTax = calcDeduction(payMode, partnerGross, pay.partnerMedicareRate, pay.partnerMedicareAmt);
  const partnerStateTax = calcDeduction(payMode, partnerGross, pay.partnerStateTaxRate, pay.partnerStateTaxAmt);
  const partnerRetirement = calcDeduction(payMode, partnerGross, pay.partnerRetirementRate, pay.partnerRetirementAmt);
  const partnerNetPay = partnerGross - partnerFedTax - partnerSsTax - partnerMedicareTax - partnerStateTax - partnerRetirement;

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
  const combinedNetPay = computedNetPay + (partnerOpen ? partnerNetPay : 0);
  const combinedGross = gross + (partnerOpen ? partnerGross : 0);
  const householdNetForSavings = combinedNetPay - budgetTotal;

  // Gross-mode percentages
  const tithePercent = combinedGross > 0 ? ((titheAmt / combinedGross) * 100).toFixed(2) : '0.00';

  // Dynamic surplus/deficit label
  const surplusLabel = (amount: number) => amount >= 0 ? 'Monthly Surplus' : 'Monthly Deficit';

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
        {/* Mode Toggle */}
        <button
          onClick={toggleMode}
          className="flex items-center justify-between w-full mb-4 px-4 py-2.5 rounded-lg bg-card border border-border shadow-sm active:scale-[0.99] transition-transform"
        >
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

        {advancedMode && (
          <div className="flex bg-card rounded-lg p-1 mb-3 shadow-sm">
            {(['estimate', 'actual'] as PayMode[]).map(mode => (
              <button
                key={mode}
                onClick={() => { setPayMode(mode); onUpdatePlanningData({ ...pay, payMode: mode, incomeMode: 'gross' }); }}
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
        )}

        <div className="bg-card rounded-lg shadow-sm px-4 py-2">
          {advancedMode ? (
            <>
              {/* Primary Income */}
              <IncomeBreakdown
                label="Primary Income"
                grossPay={pay.grossPay} onGrossPayChange={up('grossPay')}
                fedTaxRate={pay.fedTaxRate} onFedTaxRateChange={up('fedTaxRate')}
                ssTaxRate={pay.ssTaxRate} onSsTaxRateChange={up('ssTaxRate')}
                medicareRate={pay.medicareRate} onMedicareRateChange={up('medicareRate')}
                stateTaxRate={pay.stateTaxRate} onStateTaxRateChange={up('stateTaxRate')}
                retirementRate={pay.retirementRate} onRetirementRateChange={up('retirementRate')}
                fedTaxAmt={pay.fedTaxAmt} onFedTaxAmtChange={up('fedTaxAmt')}
                ssTaxAmt={pay.ssTaxAmt} onSsTaxAmtChange={up('ssTaxAmt')}
                medicareAmt={pay.medicareAmt} onMedicareAmtChange={up('medicareAmt')}
                stateTaxAmt={pay.stateTaxAmt} onStateTaxAmtChange={up('stateTaxAmt')}
                retirementAmt={pay.retirementAmt} onRetirementAmtChange={up('retirementAmt')}
                payMode={payMode} onBlur={saveAll} computedNetPay={computedNetPay}
              />

              <div className="my-2 border-t border-border" />

              {/* Partner Income Toggle */}
              <button
                onClick={togglePartner}
                className="flex items-center justify-between w-full py-2.5 border-b border-border/50 active:scale-[0.99] transition-transform"
              >
                <span className="text-sm font-medium text-foreground">Partner Income</span>
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] text-muted-foreground">{partnerOpen ? 'Hide' : 'Show'}</span>
                  {partnerOpen
                    ? <Minus size={14} className="text-muted-foreground" />
                    : <Plus size={14} className="text-muted-foreground" />}
                </div>
              </button>

              {partnerOpen && (
                <IncomeBreakdown
                  label="Partner Income"
                  grossPay={pay.partnerGrossPay} onGrossPayChange={up('partnerGrossPay')}
                  fedTaxRate={pay.partnerFedTaxRate} onFedTaxRateChange={up('partnerFedTaxRate')}
                  ssTaxRate={pay.partnerSsTaxRate} onSsTaxRateChange={up('partnerSsTaxRate')}
                  medicareRate={pay.partnerMedicareRate} onMedicareRateChange={up('partnerMedicareRate')}
                  stateTaxRate={pay.partnerStateTaxRate} onStateTaxRateChange={up('partnerStateTaxRate')}
                  retirementRate={pay.partnerRetirementRate} onRetirementRateChange={up('partnerRetirementRate')}
                  fedTaxAmt={pay.partnerFedTaxAmt} onFedTaxAmtChange={up('partnerFedTaxAmt')}
                  ssTaxAmt={pay.partnerSsTaxAmt} onSsTaxAmtChange={up('partnerSsTaxAmt')}
                  medicareAmt={pay.partnerMedicareAmt} onMedicareAmtChange={up('partnerMedicareAmt')}
                  stateTaxAmt={pay.partnerStateTaxAmt} onStateTaxAmtChange={up('partnerStateTaxAmt')}
                  retirementAmt={pay.partnerRetirementAmt} onRetirementAmtChange={up('partnerRetirementAmt')}
                  payMode={payMode} onBlur={saveAll} computedNetPay={partnerNetPay}
                />
              )}

              <div className="my-2 border-t border-border" />

              {/* Tithe with gross % */}
              <div className="flex items-center justify-between py-2.5 border-b border-border/50">
                <div>
                  <span className="text-sm text-foreground">Tithe/Giving</span>
                  <p className="text-[10px] text-muted-foreground mt-0.5">{tithePercent}% of gross</p>
                </div>
                <span className="text-sm font-medium tabular-nums text-foreground">{fmt(titheAmt)}</span>
              </div>

              {/* AI data notice */}
              <div className="flex items-start gap-2 py-2.5 border-b border-border/50">
                <Info size={12} className="text-muted-foreground mt-0.5 shrink-0" />
                <p className="text-[10px] text-muted-foreground leading-relaxed">
                  Gross income data is used by the AI Advisor for financial health insights like giving as a percentage of gross and effective savings rate. This data is never shared externally.
                </p>
              </div>

              <InputRow label="Budget Total" computed={budgetTotal} bold />
              <InputRow label="Household Net for Savings" computed={householdNetForSavings} bold />

              <div className="my-2 border-t border-border" />
              <InputRow label={surplusLabel(householdNetForSavings)} computed={householdNetForSavings} bold />
            </>
          ) : (
            <>
              {/* Net Income Mode — simple */}
              <InputRow label="Monthly Take-Home (Joe)" value={pay.netIncome} onChange={up('netIncome')} onBlur={saveAll} prefix="$" />
              <InputRow label="Monthly Take-Home (Katie)" value={pay.katieNetIncome} onChange={up('katieNetIncome')} onBlur={saveAll} prefix="$" />
              <InputRow label="Total Household Income" computed={totalHouseholdIncome} bold />

              <div className="my-2 border-t border-border" />

              <InputRow label="Budget Total" computed={budgetTotal} bold />
              <InputRow label={surplusLabel(simpleNetForSavings)} computed={simpleNetForSavings} bold />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
