import { useState } from 'react';
import { BudgetCategory, FixedExpense, GIVING_VARIABLE_CATEGORY } from '@/types/budget';
import { ArrowLeft, ChevronDown, ChevronUp, Info, Plus, Minus, Calculator } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  estimateFederalTax,
  estimateFICA,
  estimateStateTax,
  STATES,
  type FilingStatus,
  type IncomeType,
} from '@/lib/taxEstimation';

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
  primaryName?: string;
  partnerName?: string | null;
}

type PayFrequency = 'monthly' | 'semimonthly' | 'biweekly' | 'weekly';
type PlanningMode = 'basic' | 'standard' | 'advanced';

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

const INCOME_TYPE_LABELS: Record<IncomeType, string> = {
  w2: 'W-2 Employee',
  self_employed: 'Self-Employed / 1099',
  scorp: 'S-Corp Owner',
  mixed: 'Mixed',
};

const FILING_STATUS_LABELS: Record<FilingStatus, string> = {
  single: 'Single',
  married_jointly: 'Married Filing Jointly',
  married_separately: 'Married Filing Separately',
  head_of_household: 'Head of Household',
};

const MODE_LABELS: Record<PlanningMode, string> = {
  basic: 'Basic',
  standard: 'Standard',
  advanced: 'Advanced',
};

const MODE_DESCRIPTIONS: Record<PlanningMode, string> = {
  basic: 'Take-Home Only',
  standard: 'Summary',
  advanced: 'Deduction Breakdown',
};

interface PayFields {
  grossPay: string;
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
  partnerGrossPay: string;
  partnerFedTaxAmt: string;
  partnerSsTaxAmt: string;
  partnerMedicareAmt: string;
  partnerStateTaxAmt: string;
  partnerRetirementAmt: string;
  partnerSavingsDeductions: string;
  partnerOtherDeductions: string;
  partnerPayFrequency: string;
  incomeType: string;
  filingStatus: string;
  stateCode: string;
  partnerStateCode: string;
  partnerIncomeType: string;
  // Legacy
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
  incomeType: 'w2', filingStatus: 'single', stateCode: '', partnerStateCode: '', partnerIncomeType: 'w2',
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

function DollarDeductionRow({ label, value, onChange, onBlur, sublabel, estimateButton }: {
  label: string; value: string; onChange: (v: string) => void; onBlur?: () => void; sublabel?: string;
  estimateButton?: { onEstimate: () => void };
}) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <div className="flex items-center gap-1.5">
        <div>
          <span className="text-xs text-muted-foreground">{label}</span>
          {sublabel && <p className="text-[10px] text-muted-foreground/70 mt-0.5">{sublabel}</p>}
        </div>
        {estimateButton && (
          <button
            onClick={estimateButton.onEstimate}
            className="flex items-center gap-0.5 text-[9px] font-medium text-accent bg-accent/10 px-1.5 py-0.5 rounded hover:bg-accent/20 active:scale-95 transition-all"
            title="Estimate for me"
          >
            <Calculator size={10} /> Est.
          </button>
        )}
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
  annualGross: number;
  fedTaxAmt: string; onFedTaxAmtChange: (v: string) => void;
  ssTaxAmt: string; onSsTaxAmtChange: (v: string) => void;
  medicareAmt: string; onMedicareAmtChange: (v: string) => void;
  stateTaxAmt: string; onStateTaxAmtChange: (v: string) => void;
  retirementAmt: string; onRetirementAmtChange: (v: string) => void;
  savingsDeductions: string; onSavingsDeductionsChange: (v: string) => void;
  otherDeductions: string; onOtherDeductionsChange: (v: string) => void;
  payFrequency: PayFrequency;
  onBlur: () => void;
  computedMonthlyNet: number;
  monthlyGross: number;
  perPaycheckGross: number;
  incomeType: IncomeType;
  filingStatus: FilingStatus;
  stateCode: string;
  onEstimateFed: () => void;
  onEstimateFICA: () => void;
  onEstimateState: () => void;
  ficaNote?: string;
}

function IncomeBreakdown({
  label, annualGross,
  fedTaxAmt, onFedTaxAmtChange, ssTaxAmt, onSsTaxAmtChange,
  medicareAmt, onMedicareAmtChange, stateTaxAmt, onStateTaxAmtChange,
  retirementAmt, onRetirementAmtChange, savingsDeductions, onSavingsDeductionsChange,
  otherDeductions, onOtherDeductionsChange,
  payFrequency, onBlur,
  computedMonthlyNet, monthlyGross, perPaycheckGross,
  incomeType, filingStatus, stateCode,
  onEstimateFed, onEstimateFICA, onEstimateState, ficaNote,
}: IncomeBreakdownProps) {
  return (
    <>
      <div className="flex items-center py-2 border-b border-border/50">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{label}</span>
      </div>

      {/* Summary from setup */}
      <div className="py-2 border-b border-border/50">
        <div className="flex justify-between text-xs">
          <span className="text-muted-foreground">Annual Gross</span>
          <span className="font-medium text-foreground tabular-nums">{fmt(annualGross)}</span>
        </div>
        <div className="flex justify-between text-xs mt-1">
          <span className="text-muted-foreground">Monthly Gross</span>
          <span className="text-foreground tabular-nums">{fmt(monthlyGross)}</span>
        </div>
        <div className="flex justify-between text-xs mt-1">
          <span className="text-muted-foreground">Per Paycheck</span>
          <span className="text-foreground tabular-nums">{fmt(perPaycheckGross)}</span>
        </div>
      </div>

      {/* Per-paycheck deductions */}
      <div className="pl-3 border-l-2 border-border/30 ml-1 mt-1 mb-1">
        <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider py-1">Per-Paycheck Deductions</p>
        <DollarDeductionRow label="Federal Income Tax" value={fedTaxAmt} onChange={onFedTaxAmtChange} onBlur={onBlur}
          estimateButton={{ onEstimate: onEstimateFed }} />
        <DollarDeductionRow label="Social Security" value={ssTaxAmt} onChange={onSsTaxAmtChange} onBlur={onBlur}
          estimateButton={{ onEstimate: onEstimateFICA }} />
        <DollarDeductionRow label="Medicare" value={medicareAmt} onChange={onMedicareAmtChange} onBlur={onBlur}
          estimateButton={{ onEstimate: onEstimateFICA }} />
        {ficaNote && (
          <div className="flex items-start gap-1.5 py-1">
            <Info size={10} className="text-accent mt-0.5 shrink-0" />
            <p className="text-[9px] text-accent leading-relaxed">{ficaNote}</p>
          </div>
        )}
        <DollarDeductionRow label="State Income Tax" value={stateTaxAmt} onChange={onStateTaxAmtChange} onBlur={onBlur}
          estimateButton={stateCode ? { onEstimate: onEstimateState } : undefined}
          sublabel={stateCode ? STATES.find(s => s.abbr === stateCode)?.name : 'Select state in setup'} />
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

function resolveSavedMode(planningData: Record<string, string>): PlanningMode {
  const saved = planningData.planningMode;
  if (saved === 'basic' || saved === 'standard' || saved === 'advanced') return saved;
  // Migrate legacy values
  if (planningData.incomeMode === 'gross') return 'advanced';
  if (planningData.incomeMode === 'net') return 'standard';
  return 'basic';
}

export function PlanningView({ currentMonth, categories, fixedExpenses, planningData, onUpdatePlanningData, onBack, primaryName, partnerName }: PlanningViewProps) {
  const pName = primaryName || 'Primary';
  const ptName = partnerName || 'Partner';
  const [mode, setMode] = useState<PlanningMode>(() => resolveSavedMode(planningData));
  const [grossOpen, setGrossOpen] = useState(false);
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
    onUpdatePlanningData({ ...pay, planningMode: mode });
  };

  const updateAndSave = (updates: Partial<PayFields>) => {
    const updated = { ...pay, ...updates };
    setPay(updated);
    onUpdatePlanningData({ ...updated, planningMode: mode });
  };

  const cycleMode = () => {
    const order: PlanningMode[] = ['basic', 'standard', 'advanced'];
    const idx = order.indexOf(mode);
    const next = order[(idx + 1) % order.length];
    setMode(next);
    onUpdatePlanningData({ ...pay, planningMode: next });
  };

  const togglePartner = () => {
    const next = !partnerOpen;
    setPartnerOpen(next);
    updateAndSave({ partnerEnabled: next ? 'true' : 'false' });
  };

  // Setup fields
  const incomeType = (pay.incomeType || 'w2') as IncomeType;
  const filingStatus = (pay.filingStatus || 'single') as FilingStatus;
  const stateCode = pay.stateCode || '';
  const partnerIncomeType = (pay.partnerIncomeType || 'w2') as IncomeType;
  const partnerStateCode = pay.partnerStateCode || '';
  const showPartner = filingStatus === 'married_jointly' || filingStatus === 'married_separately';
  const hasPartnerProfile = !!partnerName;

  // Frequencies
  const primaryFreq = (pay.payFrequency || 'monthly') as PayFrequency;
  const partnerFreq = (pay.partnerPayFrequency || 'monthly') as PayFrequency;

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

  // For basic/standard: use entered take-home or calculated from gross
  const simpleNetPrimary = primaryAnnualGross > 0 ? primaryMonthlyNet : (parseFloat(pay.netIncome) || 0);
  const simpleNetPartner = showPartner && partnerAnnualGross > 0 ? partnerMonthlyNet : (parseFloat(pay.katieNetIncome) || 0);

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

  // Totals
  const totalHouseholdIncome = simpleNetPrimary + simpleNetPartner;
  const simpleNetForSavings = totalHouseholdIncome - budgetTotal;

  // Advanced mode totals
  const combinedNetPay = primaryMonthlyNet + (showPartner && partnerOpen ? partnerMonthlyNet : 0);
  const combinedMonthlyGross = primaryMonthlyGross + (showPartner && partnerOpen ? partnerMonthlyGross : 0);
  const householdNetForSavings = combinedNetPay - budgetTotal;

  const tithePercent = combinedMonthlyGross > 0 ? ((titheAmt / combinedMonthlyGross) * 100).toFixed(2) : '0.00';
  const surplusLabel = (amount: number) => amount >= 0 ? 'Monthly Surplus' : 'Monthly Deficit';
  const surplusHighlight = (amount: number): 'positive' | 'negative' | undefined => amount >= 0 ? 'positive' : 'negative';

  // FICA notes
  const primaryFica = estimateFICA(primaryAnnualGross, incomeType);
  const partnerFica = estimateFICA(partnerAnnualGross, partnerIncomeType);

  // Estimate handlers — primary
  const estimatePrimaryFed = () => {
    const annualTax = estimateFederalTax(primaryAnnualGross, filingStatus);
    const perPaycheck = (annualTax / FREQ_PERIODS[primaryFreq]).toFixed(2);
    updateAndSave({ fedTaxAmt: perPaycheck });
  };

  const estimatePrimaryFICA = () => {
    const fica = estimateFICA(primaryAnnualGross, incomeType);
    const ssPerPaycheck = (fica.ss / FREQ_PERIODS[primaryFreq]).toFixed(2);
    const medPerPaycheck = (fica.medicare / FREQ_PERIODS[primaryFreq]).toFixed(2);
    updateAndSave({ ssTaxAmt: ssPerPaycheck, medicareAmt: medPerPaycheck });
  };

  const estimatePrimaryState = () => {
    if (!stateCode) return;
    const annualTax = estimateStateTax(primaryAnnualGross, stateCode);
    const perPaycheck = (annualTax / FREQ_PERIODS[primaryFreq]).toFixed(2);
    updateAndSave({ stateTaxAmt: perPaycheck });
  };

  // Estimate handlers — partner
  const estimatePartnerFed = () => {
    const annualTax = estimateFederalTax(partnerAnnualGross, filingStatus === 'married_jointly' ? 'married_jointly' : filingStatus);
    const perPaycheck = (annualTax / FREQ_PERIODS[partnerFreq]).toFixed(2);
    updateAndSave({ partnerFedTaxAmt: perPaycheck });
  };

  const estimatePartnerFICA = () => {
    const fica = estimateFICA(partnerAnnualGross, partnerIncomeType);
    const ssPerPaycheck = (fica.ss / FREQ_PERIODS[partnerFreq]).toFixed(2);
    const medPerPaycheck = (fica.medicare / FREQ_PERIODS[partnerFreq]).toFixed(2);
    updateAndSave({ partnerSsTaxAmt: ssPerPaycheck, partnerMedicareAmt: medPerPaycheck });
  };

  const estimatePartnerState = () => {
    const code = partnerStateCode || stateCode;
    if (!code) return;
    const annualTax = estimateStateTax(partnerAnnualGross, code);
    const perPaycheck = (annualTax / FREQ_PERIODS[partnerFreq]).toFixed(2);
    updateAndSave({ partnerStateTaxAmt: perPaycheck });
  };

  return (
    <div className="max-w-lg mx-auto pb-28">
      <div className="px-6 pt-12 safe-top">
        <button onClick={onBack} className="flex items-center gap-1 text-accent text-sm font-medium mb-4 active:scale-95 transition-transform">
          <ArrowLeft size={16} /> Back
        </button>
        <h1 className="font-display text-xl font-bold text-foreground">Income Planning</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Setup & Pay Calculator</p>
      </div>

      {/* ───── SETUP SECTION (Standard & Advanced only) ───── */}
      {mode !== 'basic' && (
        <div className="px-6 mt-5">
          <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Income Setup</h2>
          <div className="bg-card rounded-lg shadow-sm px-4 py-3 space-y-3">

            {/* Income Type */}
            <div className="flex items-center justify-between">
              <span className="text-sm text-foreground">Income Type</span>
              <Select value={incomeType} onValueChange={v => updateAndSave({ incomeType: v })}>
                <SelectTrigger className="w-44 h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.entries(INCOME_TYPE_LABELS) as [IncomeType, string][]).map(([k, l]) => (
                    <SelectItem key={k} value={k} className="text-xs">{l}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Filing Status */}
            <div className="flex items-center justify-between">
              <span className="text-sm text-foreground">Filing Status</span>
              <Select value={filingStatus} onValueChange={v => {
                const isMarried = v === 'married_jointly' || v === 'married_separately';
                updateAndSave({
                  filingStatus: v,
                  partnerEnabled: isMarried ? pay.partnerEnabled : 'false',
                });
                if (!isMarried) setPartnerOpen(false);
              }}>
                <SelectTrigger className="w-52 h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.entries(FILING_STATUS_LABELS) as [FilingStatus, string][]).map(([k, l]) => (
                    <SelectItem key={k} value={k} className="text-xs">{l}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* State */}
            <div className="flex items-center justify-between">
              <span className="text-sm text-foreground">State</span>
              <Select value={stateCode} onValueChange={v => updateAndSave({ stateCode: v })}>
                <SelectTrigger className="w-44 h-8 text-xs"><SelectValue placeholder="Select state" /></SelectTrigger>
                <SelectContent className="max-h-60">
                  {STATES.map(s => (
                    <SelectItem key={s.abbr} value={s.abbr} className="text-xs">{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="border-t border-border/50 pt-3" />

            {/* Primary Annual Gross Income */}
            <div>
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-sm font-semibold text-foreground">{pName}'s Annual Gross Income</span>
                  <p className="text-[10px] text-muted-foreground mt-0.5">Monthly: {fmt(primaryMonthlyGross)}</p>
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-xs text-muted-foreground">$</span>
                  <input
                    type="number" step="1" value={pay.grossPay}
                    onChange={e => setPay(p => ({ ...p, grossPay: e.target.value }))}
                    onBlur={saveAll}
                    placeholder="0"
                    className="w-28 text-right px-2 py-1 rounded bg-background border border-border text-sm tabular-nums text-foreground font-semibold focus:outline-none focus:ring-2 focus:ring-accent/30"
                  />
                </div>
              </div>
            </div>

            {/* Primary Pay Frequency */}
            <div className="flex items-center justify-between">
              <div>
                <span className="text-sm text-foreground">Pay Frequency</span>
                <p className="text-[10px] text-muted-foreground mt-0.5">Per paycheck: {fmt(primaryPerPaycheckGross)}</p>
              </div>
              <Select value={primaryFreq} onValueChange={v => updateAndSave({ payFrequency: v })}>
                <SelectTrigger className="w-44 h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.entries(FREQ_LABELS) as [PayFrequency, string][]).map(([k, l]) => (
                    <SelectItem key={k} value={k} className="text-xs">{l}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Partner section */}
            {showPartner && (
              <>
                <div className="border-t border-border/50 pt-3" />
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">{ptName}</p>

                {/* Partner Income Type */}
                <div className="flex items-center justify-between">
                  <span className="text-sm text-foreground">Income Type</span>
                  <Select value={partnerIncomeType} onValueChange={v => updateAndSave({ partnerIncomeType: v })}>
                    <SelectTrigger className="w-44 h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {(Object.entries(INCOME_TYPE_LABELS) as [IncomeType, string][]).map(([k, l]) => (
                        <SelectItem key={k} value={k} className="text-xs">{l}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Partner State */}
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-sm text-foreground">State</span>
                    <p className="text-[10px] text-muted-foreground">Defaults to {pName}'s if blank</p>
                  </div>
                  <Select value={partnerStateCode} onValueChange={v => updateAndSave({ partnerStateCode: v })}>
                    <SelectTrigger className="w-44 h-8 text-xs"><SelectValue placeholder={`Same as ${pName}`} /></SelectTrigger>
                    <SelectContent className="max-h-60">
                      {STATES.map(s => (
                        <SelectItem key={s.abbr} value={s.abbr} className="text-xs">{s.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Partner Annual Gross */}
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-sm font-semibold text-foreground">{ptName}'s Annual Gross Income</span>
                    <p className="text-[10px] text-muted-foreground mt-0.5">Monthly: {fmt(partnerMonthlyGross)}</p>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-xs text-muted-foreground">$</span>
                    <input
                      type="number" step="1" value={pay.partnerGrossPay}
                      onChange={e => setPay(p => ({ ...p, partnerGrossPay: e.target.value }))}
                      onBlur={saveAll}
                      placeholder="0"
                      className="w-28 text-right px-2 py-1 rounded bg-background border border-border text-sm tabular-nums text-foreground font-semibold focus:outline-none focus:ring-2 focus:ring-accent/30"
                    />
                  </div>
                </div>

                {/* Partner Pay Frequency */}
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-sm text-foreground">Pay Frequency</span>
                    <p className="text-[10px] text-muted-foreground mt-0.5">Per paycheck: {fmt(partnerPerPaycheckGross)}</p>
                  </div>
                  <Select value={partnerFreq} onValueChange={v => updateAndSave({ partnerPayFrequency: v })}>
                    <SelectTrigger className="w-44 h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {(Object.entries(FREQ_LABELS) as [PayFrequency, string][]).map(([k, l]) => (
                        <SelectItem key={k} value={k} className="text-xs">{l}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </>
            )}
          </div>
        </div>
      )}
      <div className="px-6 mt-5">
        {/* ───── BASIC MODE ───── */}
        {mode === 'basic' && (
          <div className="bg-card rounded-lg shadow-sm px-4 py-2">
            {/* Primary monthly take-home */}
            <InputRow
              label={`Monthly Take-Home Pay${hasPartnerProfile ? ` (${pName})` : ''}`}
              value={pay.netIncome}
              onChange={up('netIncome')}
              onBlur={saveAll}
              prefix="$"
              bold
            />
            {/* Partner monthly take-home — show if there's another household member */}
            {hasPartnerProfile && (
              <InputRow
                label={`Monthly Take-Home Pay (${ptName})`}
                value={pay.katieNetIncome}
                onChange={up('katieNetIncome')}
                onBlur={saveAll}
                prefix="$"
                bold
              />
            )}

            {/* Optional annual gross income — collapsed by default */}
            <Collapsible open={grossOpen} onOpenChange={setGrossOpen}>
              <CollapsibleTrigger className="flex items-center gap-1.5 w-full py-2.5 border-b border-border/50">
                <ChevronDown size={12} className={`text-muted-foreground transition-transform duration-200 ${grossOpen ? 'rotate-180' : ''}`} />
                <span className="text-xs text-muted-foreground">Annual Gross Income — used for AI insights &amp; Financial Tools</span>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="py-2 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-foreground">{hasPartnerProfile ? `${pName}'s` : ''} Annual Gross</span>
                    <div className="flex items-center gap-1">
                      <span className="text-xs text-muted-foreground">$</span>
                      <input
                        type="number" step="1" value={pay.grossPay}
                        onChange={e => setPay(p => ({ ...p, grossPay: e.target.value }))}
                        onBlur={saveAll}
                        placeholder="0"
                        className="w-28 text-right px-2 py-1 rounded bg-background border border-border text-sm tabular-nums text-foreground focus:outline-none focus:ring-2 focus:ring-accent/30"
                      />
                    </div>
                  </div>
                  {hasPartnerProfile && (
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-foreground">{ptName}'s Annual Gross</span>
                      <div className="flex items-center gap-1">
                        <span className="text-xs text-muted-foreground">$</span>
                        <input
                          type="number" step="1" value={pay.partnerGrossPay}
                          onChange={e => setPay(p => ({ ...p, partnerGrossPay: e.target.value }))}
                          onBlur={saveAll}
                          placeholder="0"
                          className="w-28 text-right px-2 py-1 rounded bg-background border border-border text-sm tabular-nums text-foreground focus:outline-none focus:ring-2 focus:ring-accent/30"
                        />
                      </div>
                    </div>
                  )}
                  <div className="flex items-start gap-1.5 pt-1">
                    <Info size={10} className="text-muted-foreground mt-0.5 shrink-0" />
                    <p className="text-[10px] text-muted-foreground leading-relaxed">
                      Powers mortgage ratios, retirement planner, and AI giving-percentage insights. Not required for basic budgeting.
                    </p>
                  </div>
                </div>
              </CollapsibleContent>
            </Collapsible>

            <div className="my-2 border-t border-border" />
            <InputRow label="Budget Total" computed={budgetTotal} bold />
            <InputRow
              label={surplusLabel(totalHouseholdIncome - budgetTotal)}
              computed={totalHouseholdIncome - budgetTotal}
              bold
              highlight={surplusHighlight(totalHouseholdIncome - budgetTotal)}
            />
          </div>
        )}

        {/* ───── STANDARD MODE ───── */}
        {mode === 'standard' && (
          <div className="bg-card rounded-lg shadow-sm px-4 py-2">
            <InputRow label={`Monthly Take-Home (${pName})`} computed={simpleNetPrimary} bold
              sublabel={primaryAnnualGross > 0 ? 'Calculated from annual gross' : undefined}
              {...(primaryAnnualGross <= 0 ? { value: pay.netIncome, onChange: up('netIncome'), onBlur: saveAll, prefix: '$' } : {})}
            />
            {showPartner && (
              <InputRow label={`Monthly Take-Home (${ptName})`} computed={simpleNetPartner} bold
                sublabel={partnerAnnualGross > 0 ? 'Calculated from annual gross' : undefined}
                {...(partnerAnnualGross <= 0 ? { value: pay.katieNetIncome, onChange: up('katieNetIncome'), onBlur: saveAll, prefix: '$' } : {})}
              />
            )}
            <InputRow label="Total Household Income" computed={totalHouseholdIncome} bold />
            <div className="my-2 border-t border-border" />
            <InputRow label="Budget Total" computed={budgetTotal} bold />
            <InputRow label={surplusLabel(simpleNetForSavings)} computed={simpleNetForSavings} bold highlight={surplusHighlight(simpleNetForSavings)} />
          </div>
        )}

        {/* ───── ADVANCED MODE ───── */}
        {mode === 'advanced' && (
          <div className="bg-card rounded-lg shadow-sm px-4 py-2">
            <IncomeBreakdown
              label={`${pName}'s Income`}
              annualGross={primaryAnnualGross}
              fedTaxAmt={pay.fedTaxAmt} onFedTaxAmtChange={up('fedTaxAmt')}
              ssTaxAmt={pay.ssTaxAmt} onSsTaxAmtChange={up('ssTaxAmt')}
              medicareAmt={pay.medicareAmt} onMedicareAmtChange={up('medicareAmt')}
              stateTaxAmt={pay.stateTaxAmt} onStateTaxAmtChange={up('stateTaxAmt')}
              retirementAmt={pay.retirementAmt} onRetirementAmtChange={up('retirementAmt')}
              savingsDeductions={pay.savingsDeductions} onSavingsDeductionsChange={up('savingsDeductions')}
              otherDeductions={pay.otherDeductions} onOtherDeductionsChange={up('otherDeductions')}
              payFrequency={primaryFreq} onBlur={saveAll}
              computedMonthlyNet={primaryMonthlyNet}
              monthlyGross={primaryMonthlyGross}
              perPaycheckGross={primaryPerPaycheckGross}
              incomeType={incomeType}
              filingStatus={filingStatus}
              stateCode={stateCode}
              onEstimateFed={estimatePrimaryFed}
              onEstimateFICA={estimatePrimaryFICA}
              onEstimateState={estimatePrimaryState}
              ficaNote={primaryFica.note}
            />

            {showPartner && (
              <>
                <div className="my-2 border-t border-border" />
                <button onClick={togglePartner}
                  className="flex items-center justify-between w-full py-2.5 border-b border-border/50 active:scale-[0.99] transition-transform">
                  <span className="text-sm font-medium text-foreground">{ptName}'s Income</span>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] text-muted-foreground">{partnerOpen ? 'Hide' : 'Show'}</span>
                    {partnerOpen ? <Minus size={14} className="text-muted-foreground" /> : <Plus size={14} className="text-muted-foreground" />}
                  </div>
                </button>

                {partnerOpen && (
                  <IncomeBreakdown
                    label={`${ptName}'s Income`}
                    annualGross={partnerAnnualGross}
                    fedTaxAmt={pay.partnerFedTaxAmt} onFedTaxAmtChange={up('partnerFedTaxAmt')}
                    ssTaxAmt={pay.partnerSsTaxAmt} onSsTaxAmtChange={up('partnerSsTaxAmt')}
                    medicareAmt={pay.partnerMedicareAmt} onMedicareAmtChange={up('partnerMedicareAmt')}
                    stateTaxAmt={pay.partnerStateTaxAmt} onStateTaxAmtChange={up('partnerStateTaxAmt')}
                    retirementAmt={pay.partnerRetirementAmt} onRetirementAmtChange={up('partnerRetirementAmt')}
                    savingsDeductions={pay.partnerSavingsDeductions} onSavingsDeductionsChange={up('partnerSavingsDeductions')}
                    otherDeductions={pay.partnerOtherDeductions} onOtherDeductionsChange={up('partnerOtherDeductions')}
                    payFrequency={partnerFreq} onBlur={saveAll}
                    computedMonthlyNet={partnerMonthlyNet}
                    monthlyGross={partnerMonthlyGross}
                    perPaycheckGross={partnerPerPaycheckGross}
                    incomeType={partnerIncomeType}
                    filingStatus={filingStatus}
                    stateCode={partnerStateCode || stateCode}
                    onEstimateFed={estimatePartnerFed}
                    onEstimateFICA={estimatePartnerFICA}
                    onEstimateState={estimatePartnerState}
                    ficaNote={partnerFica.note}
                  />
                )}
              </>
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
                Income data powers AI Advisor insights and Financial Tools. Never shared externally.
              </p>
            </div>

            <InputRow label="Budget Total" computed={budgetTotal} bold />
            <InputRow label="Household Net for Savings" computed={householdNetForSavings} bold />

            <div className="my-2 border-t border-border" />
            <InputRow label={surplusLabel(householdNetForSavings)} computed={householdNetForSavings} bold highlight={surplusHighlight(householdNetForSavings)} />
          </div>
        )}
      </div>
    </div>
  );
}
