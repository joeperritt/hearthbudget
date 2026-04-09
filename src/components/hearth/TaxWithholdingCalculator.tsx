import { useState, useMemo, useEffect } from 'react';
import { ArrowLeft, ChevronDown, ChevronUp } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { supabase } from '@/integrations/supabase/client';
import { useToolState } from '@/hooks/useToolState';
import { TaxWithholdingInsightsSection } from './TaxWithholdingInsightsSection';

// --- 2026 Federal Tax Brackets ---
type FilingStatus = 'single' | 'married_jointly' | 'married_separately' | 'head_of_household';

interface Bracket { min: number; max: number; rate: number }

const FEDERAL_BRACKETS_2026: Record<FilingStatus, Bracket[]> = {
  single: [
    { min: 0, max: 12400, rate: 0.10 },
    { min: 12400, max: 50400, rate: 0.12 },
    { min: 50400, max: 105700, rate: 0.22 },
    { min: 105700, max: 200750, rate: 0.24 },
    { min: 200750, max: 243725, rate: 0.32 },
    { min: 243725, max: 609350, rate: 0.35 },
    { min: 609350, max: Infinity, rate: 0.37 },
  ],
  married_jointly: [
    { min: 0, max: 24850, rate: 0.10 },
    { min: 24850, max: 100750, rate: 0.12 },
    { min: 100750, max: 211400, rate: 0.22 },
    { min: 211400, max: 401500, rate: 0.24 },
    { min: 401500, max: 487450, rate: 0.32 },
    { min: 487450, max: 731200, rate: 0.35 },
    { min: 731200, max: Infinity, rate: 0.37 },
  ],
  married_separately: [
    { min: 0, max: 12400, rate: 0.10 },
    { min: 12400, max: 50400, rate: 0.12 },
    { min: 50400, max: 105700, rate: 0.22 },
    { min: 105700, max: 200750, rate: 0.24 },
    { min: 200750, max: 243725, rate: 0.32 },
    { min: 243725, max: 365600, rate: 0.35 },
    { min: 365600, max: Infinity, rate: 0.37 },
  ],
  head_of_household: [
    { min: 0, max: 17600, rate: 0.10 },
    { min: 17600, max: 67250, rate: 0.12 },
    { min: 67250, max: 105700, rate: 0.22 },
    { min: 105700, max: 200750, rate: 0.24 },
    { min: 200750, max: 243725, rate: 0.32 },
    { min: 243725, max: 609350, rate: 0.35 },
    { min: 609350, max: Infinity, rate: 0.37 },
  ],
};

const STANDARD_DEDUCTION_2026: Record<FilingStatus, number> = {
  single: 16100,
  married_jointly: 32200,
  married_separately: 16100,
  head_of_household: 24150,
};

// State income tax (SC flat 6.2% for 2026 as specified; others use taxEstimation.ts data)
import { STATES, estimateStateTax } from '@/lib/taxEstimation';

const STATE_OPTIONS = STATES.map(s => ({ code: s.abbr, name: s.name }));

// FICA 2026 (same as 2025 until announced)
const SS_WAGE_BASE = 176100;
const SS_RATE = 0.062;
const MEDICARE_RATE = 0.0145;
const ADDITIONAL_MEDICARE_THRESHOLD_SINGLE = 200000;
const ADDITIONAL_MEDICARE_THRESHOLD_MFJ = 250000;
const ADDITIONAL_MEDICARE_RATE = 0.009;

const PAY_FREQUENCIES: { value: string; label: string; periods: number }[] = [
  { value: 'weekly', label: 'Weekly', periods: 52 },
  { value: 'biweekly', label: 'Bi-Weekly', periods: 26 },
  { value: 'semimonthly', label: 'Semi-Monthly', periods: 24 },
  { value: 'monthly', label: 'Monthly', periods: 12 },
];

function fmt(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(n);
}
function fmtRound(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);
}
function pct(n: number) {
  return (n * 100).toFixed(1) + '%';
}

function calcFederalTax(annualGross: number, filingStatus: FilingStatus, annualPreTaxDeductions: number): number {
  const agi = Math.max(0, annualGross - annualPreTaxDeductions);
  const taxableIncome = Math.max(0, agi - STANDARD_DEDUCTION_2026[filingStatus]);
  const brackets = FEDERAL_BRACKETS_2026[filingStatus];
  let tax = 0;
  for (const b of brackets) {
    if (taxableIncome <= b.min) break;
    tax += (Math.min(taxableIncome, b.max) - b.min) * b.rate;
  }
  return tax;
}

function getMarginalRate(annualGross: number, filingStatus: FilingStatus, annualPreTaxDeductions: number): number {
  const agi = Math.max(0, annualGross - annualPreTaxDeductions);
  const taxableIncome = Math.max(0, agi - STANDARD_DEDUCTION_2026[filingStatus]);
  const brackets = FEDERAL_BRACKETS_2026[filingStatus];
  for (let i = brackets.length - 1; i >= 0; i--) {
    if (taxableIncome > brackets[i].min) return brackets[i].rate;
  }
  return 0.10;
}

function calcStateTax2026(annualGross: number, stateAbbr: string, annualPreTaxDeductions: number): number {
  const taxable = Math.max(0, annualGross - annualPreTaxDeductions);
  // SC 2026 flat rate override
  if (stateAbbr === 'SC') return taxable * 0.062;
  return estimateStateTax(taxable, stateAbbr);
}

interface TaxWithholdingCalculatorProps {
  onBack: () => void;
  householdId: string | null;
}

export function TaxWithholdingCalculator({ onBack, householdId }: TaxWithholdingCalculatorProps) {
  const [financialProfile, setFinancialProfile] = useState<any>(null);
  const [profileLoading, setProfileLoading] = useState(true);

  const { state, setState, loaded: toolStateLoaded } = useToolState(householdId, 'tax-withholding', {
    selectedMember: '',
    filingStatus: 'single' as string,
    annualGross: '',
    payFrequency: 'biweekly',
    federalWithholding: '',
    stateWithholding: '',
    selectedState: '',
    retirementDeduction: '',
    healthDeduction: '',
    hsaDeduction: '',
    otherDeduction: '',
    additionalWithholding: '',
    showAdvanced: false,
  });

  useEffect(() => {
    if (!householdId) { setProfileLoading(false); return; }
    supabase
      .from('financial_profiles')
      .select('*')
      .eq('household_id', householdId)
      .maybeSingle()
      .then(({ data }) => {
        if (data) setFinancialProfile(data);
        setProfileLoading(false);
      });
  }, [householdId]);

  // Members from profile
  const members: { name: string; gross_income: number }[] = useMemo(() => {
    if (!financialProfile?.member_incomes) return [];
    const raw = financialProfile.member_incomes as any[];
    return raw.filter(m => m.name).map(m => ({ name: m.name, gross_income: Number(m.gross_income) || 0 }));
  }, [financialProfile]);

  // Auto-populate from profile on first load
  const [initialized, setInitialized] = useState(false);
  useEffect(() => {
    if (!toolStateLoaded || !financialProfile || initialized) return;
    // Only set defaults if state is empty (fresh)
    if (!state.selectedMember && members.length > 0) {
      const updates: any = {};
      if (!state.selectedMember) updates.selectedMember = members[0].name;
      if (!state.filingStatus || state.filingStatus === 'single') updates.filingStatus = financialProfile.filing_status || 'single';
      if (!state.selectedState && financialProfile.state) updates.selectedState = financialProfile.state;
      if (!state.annualGross && members[0]?.gross_income) updates.annualGross = String(members[0].gross_income);
      if (Object.keys(updates).length) setState(updates);
    }
    setInitialized(true);
  }, [toolStateLoaded, financialProfile, members, initialized]);

  // When member changes, update income
  useEffect(() => {
    if (!state.selectedMember || !members.length) return;
    const member = members.find(m => m.name === state.selectedMember);
    if (member && member.gross_income && !initialized) {
      setState({ annualGross: String(member.gross_income) });
    }
  }, [state.selectedMember]);

  const handleMemberChange = (name: string) => {
    const member = members.find(m => m.name === name);
    setState({
      selectedMember: name,
      annualGross: member ? String(member.gross_income) : state.annualGross,
    });
  };

  // Parsed values
  const annualGross = Number(state.annualGross) || 0;
  const filingStatus = (state.filingStatus || 'single') as FilingStatus;
  const payFreqObj = PAY_FREQUENCIES.find(p => p.value === state.payFrequency) || PAY_FREQUENCIES[1];
  const payPeriods = payFreqObj.periods;
  const federalWithholdingPer = Number(state.federalWithholding) || 0;
  const stateWithholdingPer = Number(state.stateWithholding) || 0;
  const retirement = Number(state.retirementDeduction) || 0;
  const health = Number(state.healthDeduction) || 0;
  const hsa = Number(state.hsaDeduction) || 0;
  const other = Number(state.otherDeduction) || 0;
  const additionalWithholding = Number(state.additionalWithholding) || 0;

  const annualPreTaxDeductions = (retirement + health + hsa + other) * payPeriods;

  // Calculations
  const estimatedFederalTax = calcFederalTax(annualGross, filingStatus, annualPreTaxDeductions);
  const annualFederalWithheld = (federalWithholdingPer + additionalWithholding) * payPeriods;
  const federalDelta = annualFederalWithheld - estimatedFederalTax;

  const estimatedStateTax = calcStateTax2026(annualGross, state.selectedState, annualPreTaxDeductions);
  const annualStateWithheld = stateWithholdingPer * payPeriods;
  const stateDelta = annualStateWithheld - estimatedStateTax;

  const medicareThreshold = filingStatus === 'married_jointly' ? ADDITIONAL_MEDICARE_THRESHOLD_MFJ : ADDITIONAL_MEDICARE_THRESHOLD_SINGLE;
  const ficaSS = Math.min(annualGross, SS_WAGE_BASE) * SS_RATE;
  const ficaMedicare = annualGross * MEDICARE_RATE + (annualGross > medicareThreshold ? (annualGross - medicareThreshold) * ADDITIONAL_MEDICARE_RATE : 0);
  const totalFICA = ficaSS + ficaMedicare;

  const totalTaxes = estimatedFederalTax + estimatedStateTax + totalFICA;
  const effectiveRate = annualGross > 0 ? totalTaxes / annualGross : 0;
  const marginalRate = getMarginalRate(annualGross, filingStatus, annualPreTaxDeductions);

  const takeHomePay = annualGross - totalTaxes - annualPreTaxDeductions;

  // Withholding status
  const combinedDelta = federalDelta + stateDelta;
  let withholdingStatus = 'On Track';
  let statusColor = 'text-accent';
  if (combinedDelta > 1000) { withholdingStatus = 'Overwithholding'; statusColor = 'text-yellow-600'; }
  else if (combinedDelta < -500) { withholdingStatus = 'Underwithholding'; statusColor = 'text-destructive'; }
  else if (Math.abs(combinedDelta) <= 500) { statusColor = 'text-green-600'; }

  const recommendedAdjustment = payPeriods > 0 ? -(federalDelta / payPeriods) : 0;

  function deltaColor(d: number) {
    if (Math.abs(d) <= 500) return 'text-accent';
    if (d > 0) return 'text-green-600';
    return 'text-destructive';
  }
  function deltaLabel(d: number) {
    if (Math.abs(d) <= 500) return `${fmtRound(Math.abs(d))} — Within target`;
    if (d > 0) return `${fmtRound(d)} surplus (refund)`;
    return `${fmtRound(Math.abs(d))} shortfall (owe)`;
  }

  if (profileLoading || !toolStateLoaded) {
    return (
      <div className="max-w-lg mx-auto px-6 pt-16 safe-top">
        <div className="animate-pulse space-y-4">
          <div className="h-6 bg-muted rounded w-1/2" />
          <div className="h-40 bg-muted rounded" />
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
          <h1 className="font-display text-xl font-bold text-foreground">Tax Withholding</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Optimize your W-4 withholding</p>
        </div>
      </div>

      {/* Member selector */}
      {members.length > 1 && (
        <div className="px-6 mt-4">
          <div className="flex bg-muted rounded-full p-0.5">
            {members.map(m => (
              <button
                key={m.name}
                onClick={() => handleMemberChange(m.name)}
                className={`flex-1 text-sm font-medium py-1.5 rounded-full transition-colors ${
                  state.selectedMember === m.name
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'text-muted-foreground'
                }`}
              >
                {m.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Inputs */}
      <div className="px-6 mt-4 space-y-3">
        <div>
          <Label className="text-xs text-muted-foreground">Filing Status</Label>
          <Select value={state.filingStatus} onValueChange={v => setState({ filingStatus: v })}>
            <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="single">Single</SelectItem>
              <SelectItem value="married_jointly">Married Filing Jointly</SelectItem>
              <SelectItem value="married_separately">Married Filing Separately</SelectItem>
              <SelectItem value="head_of_household">Head of Household</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label className="text-xs text-muted-foreground">State</Label>
          <Select value={state.selectedState} onValueChange={v => setState({ selectedState: v })}>
            <SelectTrigger className="mt-1"><SelectValue placeholder="Select state" /></SelectTrigger>
            <SelectContent>
              {STATE_OPTIONS.map(s => (
                <SelectItem key={s.code} value={s.code}>{s.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label className="text-xs text-muted-foreground">Annual Gross Income</Label>
          <div className="relative mt-1">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
            <Input
              type="number"
              className="pl-7"
              value={state.annualGross}
              onChange={e => setState({ annualGross: e.target.value })}
            />
          </div>
        </div>

        <div>
          <Label className="text-xs text-muted-foreground">Pay Frequency</Label>
          <Select value={state.payFrequency} onValueChange={v => setState({ payFrequency: v })}>
            <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
            <SelectContent>
              {PAY_FREQUENCIES.map(p => (
                <SelectItem key={p.value} value={p.value}>{p.label} ({p.periods}/yr)</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-xs text-muted-foreground">Federal Withholding / Check</Label>
            <div className="relative mt-1">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
              <Input
                type="number"
                className="pl-7"
                value={state.federalWithholding}
                onChange={e => setState({ federalWithholding: e.target.value })}
                placeholder="0"
              />
            </div>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">State Withholding / Check</Label>
            <div className="relative mt-1">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
              <Input
                type="number"
                className="pl-7"
                value={state.stateWithholding}
                onChange={e => setState({ stateWithholding: e.target.value })}
                placeholder="0"
              />
            </div>
          </div>
        </div>

        {/* Pre-tax deductions */}
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Pre-Tax Deductions / Paycheck</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-[11px] text-muted-foreground">401(k) / Retirement</Label>
              <div className="relative mt-1">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
                <Input type="number" className="pl-7" value={state.retirementDeduction} onChange={e => setState({ retirementDeduction: e.target.value })} placeholder="0" />
              </div>
            </div>
            <div>
              <Label className="text-[11px] text-muted-foreground">Health Insurance</Label>
              <div className="relative mt-1">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
                <Input type="number" className="pl-7" value={state.healthDeduction} onChange={e => setState({ healthDeduction: e.target.value })} placeholder="0" />
              </div>
            </div>
            <div>
              <Label className="text-[11px] text-muted-foreground">HSA</Label>
              <div className="relative mt-1">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
                <Input type="number" className="pl-7" value={state.hsaDeduction} onChange={e => setState({ hsaDeduction: e.target.value })} placeholder="0" />
              </div>
            </div>
            <div>
              <Label className="text-[11px] text-muted-foreground">Other Pre-Tax</Label>
              <div className="relative mt-1">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
                <Input type="number" className="pl-7" value={state.otherDeduction} onChange={e => setState({ otherDeduction: e.target.value })} placeholder="0" />
              </div>
            </div>
          </div>
        </div>

        {/* Advanced section */}
        <Collapsible open={state.showAdvanced} onOpenChange={v => setState({ showAdvanced: v })}>
          <CollapsibleTrigger className="flex items-center gap-1 text-xs text-accent font-medium">
            {state.showAdvanced ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            Additional Withholding
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-2">
            <div>
              <Label className="text-[11px] text-muted-foreground">Extra Federal Withholding / Check</Label>
              <div className="relative mt-1">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
                <Input type="number" className="pl-7" value={state.additionalWithholding} onChange={e => setState({ additionalWithholding: e.target.value })} placeholder="0" />
              </div>
            </div>
          </CollapsibleContent>
        </Collapsible>
      </div>

      {/* Output Section */}
      {annualGross > 0 && (
        <div className="px-6 mt-6">
          <h2 className="font-display text-base font-bold text-foreground mb-3">Your Withholding Picture</h2>
          <p className="text-[10px] text-muted-foreground mb-3">Using 2026 tax brackets per IRS inflation adjustments. 2025 brackets used as fallback where 2026 data is pending.</p>

          {/* Federal */}
          <div className="bg-card rounded-xl shadow-sm p-4 mb-3">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Federal</p>
            <div className="space-y-1.5">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Estimated Tax Owed</span>
                <span className="font-semibold text-foreground">{fmtRound(estimatedFederalTax)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Annual Withheld</span>
                <span className="font-semibold text-foreground">{fmtRound(annualFederalWithheld)}</span>
              </div>
              <div className="flex justify-between text-sm border-t border-border pt-1.5">
                <span className="text-muted-foreground">{federalDelta >= 0 ? 'Surplus' : 'Shortfall'}</span>
                <span className={`font-bold ${deltaColor(federalDelta)}`}>{deltaLabel(federalDelta)}</span>
              </div>
            </div>
          </div>

          {/* State */}
          {state.selectedState && (
            <div className="bg-card rounded-xl shadow-sm p-4 mb-3">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">State ({state.selectedState})</p>
              <div className="space-y-1.5">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Estimated Tax Owed</span>
                  <span className="font-semibold text-foreground">{fmtRound(estimatedStateTax)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Annual Withheld</span>
                  <span className="font-semibold text-foreground">{fmtRound(annualStateWithheld)}</span>
                </div>
                <div className="flex justify-between text-sm border-t border-border pt-1.5">
                  <span className="text-muted-foreground">{stateDelta >= 0 ? 'Surplus' : 'Shortfall'}</span>
                  <span className={`font-bold ${deltaColor(stateDelta)}`}>{deltaLabel(stateDelta)}</span>
                </div>
              </div>
            </div>
          )}

          {/* FICA */}
          <div className="bg-card rounded-xl shadow-sm p-4 mb-3">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">FICA</p>
            <div className="space-y-1.5">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Social Security (6.2%)</span>
                <span className="font-semibold text-foreground">{fmtRound(ficaSS)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Medicare (1.45%{annualGross > medicareThreshold ? ' + 0.9%' : ''})</span>
                <span className="font-semibold text-foreground">{fmtRound(ficaMedicare)}</span>
              </div>
              <div className="flex justify-between text-sm border-t border-border pt-1.5">
                <span className="text-muted-foreground">Total FICA</span>
                <span className="font-bold text-foreground">{fmtRound(totalFICA)}</span>
              </div>
            </div>
          </div>

          {/* Summary */}
          <div className="bg-card rounded-xl shadow-sm p-4 mb-3">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Summary</p>
            <div className="space-y-1.5">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Effective Tax Rate</span>
                <span className="font-semibold text-foreground">{pct(effectiveRate)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Marginal Tax Rate</span>
                <span className="font-semibold text-foreground">{pct(marginalRate)}</span>
              </div>
              <div className="flex justify-between text-sm border-t border-border pt-1.5">
                <span className="text-muted-foreground">Est. Annual Take-Home</span>
                <span className="font-bold text-green-600">{fmtRound(takeHomePay)}</span>
              </div>
            </div>
          </div>

          {/* CFP Guideline */}
          <div className="bg-card rounded-xl shadow-sm p-4 mb-3">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
              Certified Financial Planner (CFP) Guideline
            </p>
            <div className="space-y-2">
              <div className="flex items-start gap-2">
                <div className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${
                  withholdingStatus === 'On Track' ? 'bg-green-500' : withholdingStatus === 'Overwithholding' ? 'bg-yellow-500' : 'bg-destructive'
                }`} />
                <div>
                  <p className={`text-sm font-semibold ${statusColor}`}>{withholdingStatus}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {withholdingStatus === 'On Track' && 'Your withholding is dialed in — within $500 of your estimated liability.'}
                    {withholdingStatus === 'Overwithholding' && `You're on pace for a ${fmtRound(Math.abs(combinedDelta))} refund. That's an interest-free loan to the government — consider reducing withholding and redirecting to savings or investments.`}
                    {withholdingStatus === 'Underwithholding' && `You're on pace to owe ${fmtRound(Math.abs(combinedDelta))} at filing. Consider increasing withholding to avoid underpayment penalties.`}
                  </p>
                </div>
              </div>
              {Math.abs(federalDelta) > 100 && (
                <div className="bg-muted/50 rounded-lg px-3 py-2">
                  <p className="text-xs text-muted-foreground">
                    <span className="font-semibold">Recommended adjustment:</span>{' '}
                    {recommendedAdjustment > 0
                      ? `Increase federal withholding by ${fmt(recommendedAdjustment)} per paycheck`
                      : `Decrease federal withholding by ${fmt(Math.abs(recommendedAdjustment))} per paycheck`
                    } to break even.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* AI Insights */}
      {annualGross > 0 && (
        <TaxWithholdingInsightsSection
          householdId={householdId}
          memberName={state.selectedMember}
          filingStatus={state.filingStatus}
          annualGross={annualGross}
          payFrequency={state.payFrequency}
          payPeriods={payPeriods}
          federalWithholdingPerPaycheck={federalWithholdingPer}
          stateWithholdingPerPaycheck={stateWithholdingPer}
          selectedState={state.selectedState}
          preTaxDeductions={{ retirement, health, hsa, other }}
          additionalWithholding={additionalWithholding}
          estimatedFederalTax={estimatedFederalTax}
          annualFederalWithheld={annualFederalWithheld}
          federalDelta={federalDelta}
          estimatedStateTax={estimatedStateTax}
          annualStateWithheld={annualStateWithheld}
          stateDelta={stateDelta}
          ficaSS={ficaSS}
          ficaMedicare={ficaMedicare}
          effectiveRate={effectiveRate}
          marginalRate={marginalRate}
          takeHomePay={takeHomePay}
          withholdingStatus={withholdingStatus}
          recommendedAdjustment={recommendedAdjustment}
          financialProfile={financialProfile}
        />
      )}

      <div className="h-8" />
    </div>
  );
}
