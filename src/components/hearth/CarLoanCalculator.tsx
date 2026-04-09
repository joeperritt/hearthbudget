import { useState, useMemo, useEffect, useCallback } from 'react';
import { ArrowLeft } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { useToolState } from '@/hooks/useToolState';
import { CarLoanInsightsSection } from './CarLoanInsightsSection';

// State sales tax defaults (approximate vehicle sales tax rates)
const STATE_SALES_TAX: Record<string, number> = {
  AL: 2, AK: 0, AZ: 5.6, AR: 6.5, CA: 7.25, CO: 2.9, CT: 6.35, DE: 0, FL: 6, GA: 6.6,
  HI: 4, ID: 6, IL: 6.25, IN: 7, IA: 5, KS: 6.5, KY: 6, LA: 4.45, ME: 5.5, MD: 6,
  MA: 6.25, MI: 6, MN: 6.875, MS: 5, MO: 4.225, MT: 0, NE: 5.5, NV: 8.25, NH: 0,
  NJ: 6.625, NM: 4, NY: 4, NC: 3, ND: 5, OH: 5.75, OK: 4.5, OR: 0, PA: 6, RI: 7,
  SC: 5, SD: 4.5, TN: 7, TX: 6.25, UT: 6.85, VT: 6, VA: 4.15, WA: 6.5, WV: 6, WI: 5, WY: 4, DC: 6,
};

const STATE_OPTIONS = Object.entries(STATE_SALES_TAX)
  .map(([code, rate]) => ({ code, rate }))
  .sort((a, b) => a.code.localeCompare(b.code));

const STATE_LABELS: Record<string, string> = {
  AL:'Alabama',AK:'Alaska',AZ:'Arizona',AR:'Arkansas',CA:'California',CO:'Colorado',CT:'Connecticut',
  DE:'Delaware',FL:'Florida',GA:'Georgia',HI:'Hawaii',ID:'Idaho',IL:'Illinois',IN:'Indiana',
  IA:'Iowa',KS:'Kansas',KY:'Kentucky',LA:'Louisiana',ME:'Maine',MD:'Maryland',MA:'Massachusetts',
  MI:'Michigan',MN:'Minnesota',MS:'Mississippi',MO:'Missouri',MT:'Montana',NE:'Nebraska',NV:'Nevada',
  NH:'New Hampshire',NJ:'New Jersey',NM:'New Mexico',NY:'New York',NC:'North Carolina',ND:'North Dakota',
  OH:'Ohio',OK:'Oklahoma',OR:'Oregon',PA:'Pennsylvania',RI:'Rhode Island',SC:'South Carolina',
  SD:'South Dakota',TN:'Tennessee',TX:'Texas',UT:'Utah',VT:'Vermont',VA:'Virginia',WA:'Washington',
  WV:'West Virginia',WI:'Wisconsin',WY:'Wyoming',DC:'Washington DC',
};

function fmt(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(n);
}
function fmtRound(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);
}
function pct(n: number) {
  return (n * 100).toFixed(1) + '%';
}

interface CarLoanCalculatorProps {
  onBack: () => void;
  householdId: string | null;
}

export function CarLoanCalculator({ onBack, householdId }: CarLoanCalculatorProps) {
  const [financialProfile, setFinancialProfile] = useState<any>(null);
  const [profileLoading, setProfileLoading] = useState(true);

  const { state, setState, loaded: toolStateLoaded } = useToolState(householdId, 'car-loan', {
    loanMode: 'shopping' as 'shopping' | 'existing',
    vehiclePrice: '30000',
    downPaymentPct: '10',
    downPaymentMode: 'percent' as 'percent' | 'dollar',
    downPaymentAmt: '3000',
    loanTermMonths: '60',
    interestRate: '6.5',
    salesTaxRate: '6',
    tradeInValue: '0',
    selectedState: '',
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

  // Auto-populate state from profile
  useEffect(() => {
    if (!financialProfile || !toolStateLoaded) return;
    if (state.selectedState === '' && financialProfile.state) {
      const st = financialProfile.state.toUpperCase();
      if (STATE_SALES_TAX[st] !== undefined) {
        let taxRate = STATE_SALES_TAX[st];
        setState({ selectedState: st, salesTaxRate: String(taxRate) });
      }
    }
  }, [financialProfile, toolStateLoaded]);

  const handleStateChange = useCallback((st: string) => {
    const taxRate = STATE_SALES_TAX[st] ?? 6;
    setState({ selectedState: st, salesTaxRate: String(taxRate) });
  }, [setState]);

  const grossMonthlyIncome = useMemo(() => {
    if (financialProfile) {
      const memberIncomes = Array.isArray(financialProfile.member_incomes) ? financialProfile.member_incomes as any[] : [];
      const total = memberIncomes.reduce((s: number, m: any) => s + (Number(m.gross_income) || 0), 0);
      if (total > 0) return total / 12;
    }
    return 0;
  }, [financialProfile]);

  const annualGrossIncome = grossMonthlyIncome * 12;
  const hasProfile = financialProfile && grossMonthlyIncome > 0;

  const calc = useMemo(() => {
    const price = parseFloat(state.vehiclePrice) || 0;
    const dp = state.downPaymentMode === 'percent'
      ? price * (parseFloat(state.downPaymentPct) || 0) / 100
      : parseFloat(state.downPaymentAmt) || 0;
    const tradeIn = parseFloat(state.tradeInValue) || 0;
    const taxRate = (parseFloat(state.salesTaxRate) || 0) / 100;

    // SC caps vehicle sales tax at $500
    let salesTax = price * taxRate;
    if (state.selectedState === 'SC' && salesTax > 500) salesTax = 500;

    const amountFinanced = Math.max(0, price - dp - tradeIn + salesTax);
    const months = parseInt(state.loanTermMonths) || 60;
    const monthlyRate = (parseFloat(state.interestRate) || 0) / 100 / 12;

    let monthlyPayment = 0;
    if (monthlyRate > 0 && months > 0) {
      monthlyPayment = amountFinanced * (monthlyRate * Math.pow(1 + monthlyRate, months)) / (Math.pow(1 + monthlyRate, months) - 1);
    } else if (months > 0) {
      monthlyPayment = amountFinanced / months;
    }

    const totalPaid = monthlyPayment * months;
    const totalInterest = totalPaid - amountFinanced;
    const totalCost = price + totalInterest + salesTax;

    const paymentToIncomeRatio = grossMonthlyIncome > 0 ? monthlyPayment / grossMonthlyIncome : 0;
    const vehiclePriceToIncomeRatio = annualGrossIncome > 0 ? price / annualGrossIncome : 0;

    return {
      dp, tradeIn, salesTax, amountFinanced, monthlyPayment, totalInterest, totalCost,
      paymentToIncomeRatio, vehiclePriceToIncomeRatio, months,
    };
  }, [state, grossMonthlyIncome, annualGrossIncome]);

  const paymentOk = calc.paymentToIncomeRatio <= 0.15;
  const priceOk = calc.vehiclePriceToIncomeRatio <= 0.35;
  const overallOk = paymentOk && priceOk;

  if (profileLoading || !toolStateLoaded) {
    return (
      <div className="max-w-lg mx-auto pb-32">
        <div className="px-6 pt-12 safe-top flex items-center gap-3">
          <button onClick={onBack} className="p-1.5 -ml-1.5 rounded-lg hover:bg-muted"><ArrowLeft size={20} className="text-foreground" /></button>
          <h1 className="font-display text-xl font-bold text-foreground">Car Loan Calculator</h1>
        </div>
        <div className="px-6 mt-8 text-center text-muted-foreground text-sm">Loading…</div>
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto pb-32">
      <div className="px-6 pt-12 safe-top flex items-center gap-3">
        <button onClick={onBack} className="p-1.5 -ml-1.5 rounded-lg hover:bg-muted">
          <ArrowLeft size={20} className="text-foreground" />
        </button>
        <div>
          <h1 className="font-display text-xl font-bold text-foreground">Car Loan Calculator</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Calculate your true cost of ownership</p>
        </div>
      </div>

      {/* Income context */}
      <div className="px-6 mt-5">
        {hasProfile ? (
          <div className="bg-primary/5 rounded-lg p-3 border border-primary/10">
            <p className="text-xs text-muted-foreground">Gross Monthly Income (from Financial Profile)</p>
            <p className="text-lg font-bold text-foreground">{fmt(grossMonthlyIncome)}</p>
          </div>
        ) : (
          <div className="bg-destructive/5 rounded-lg p-3 border border-destructive/10">
            <p className="text-sm font-semibold text-foreground">Income data needed</p>
            <p className="text-xs text-muted-foreground mt-0.5">Complete your Financial Profile with income details to calculate affordability ratios.</p>
          </div>
        )}
      </div>

      {/* State selector */}
      <div className="px-6 mt-4">
        <Label className="text-xs text-muted-foreground">State (for sales tax)</Label>
        <Select value={state.selectedState} onValueChange={handleStateChange}>
          <SelectTrigger className="mt-1"><SelectValue placeholder="Select state…" /></SelectTrigger>
          <SelectContent className="max-h-60">
            {STATE_OPTIONS.map(s => (
              <SelectItem key={s.code} value={s.code}>{STATE_LABELS[s.code] || s.code}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Mode toggle */}
      <div className="px-6 mt-4">
        <div className="flex rounded-lg bg-muted p-0.5">
          <button
            onClick={() => setState({ loanMode: 'shopping' as any })}
            className={`flex-1 text-sm font-semibold py-2 rounded-md transition-colors ${
              state.loanMode === 'shopping'
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            I'm Shopping
          </button>
          <button
            onClick={() => setState({ loanMode: 'existing' as any })}
            className={`flex-1 text-sm font-semibold py-2 rounded-md transition-colors ${
              state.loanMode === 'existing'
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            This is My Loan
          </button>
        </div>
      </div>

      {/* Inputs */}
      <div className="px-6 mt-4 space-y-4">
        <div>
          <Label className="text-xs text-muted-foreground">Vehicle Price</Label>
          <Input type="number" value={state.vehiclePrice} onChange={e => setState({ vehiclePrice: e.target.value })} className="mt-1" />
        </div>

        <div className="flex gap-3">
          <div className="flex-1">
            <Label className="text-xs text-muted-foreground">Down Payment</Label>
            <Input
              type="number"
              value={state.downPaymentMode === 'percent' ? state.downPaymentPct : state.downPaymentAmt}
              onChange={e => {
                if (state.downPaymentMode === 'percent') {
                  setState({
                    downPaymentPct: e.target.value,
                    downPaymentAmt: String(Math.round((parseFloat(state.vehiclePrice) || 0) * (parseFloat(e.target.value) || 0) / 100)),
                  });
                } else {
                  const price = parseFloat(state.vehiclePrice) || 1;
                  setState({
                    downPaymentAmt: e.target.value,
                    downPaymentPct: String(((parseFloat(e.target.value) || 0) / price * 100).toFixed(1)),
                  });
                }
              }}
              className="mt-1"
            />
          </div>
          <div className="w-24">
            <Label className="text-xs text-muted-foreground">&nbsp;</Label>
            <Select value={state.downPaymentMode} onValueChange={(v: 'percent' | 'dollar') => setState({ downPaymentMode: v })}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="percent">%</SelectItem>
                <SelectItem value="dollar">$</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div>
          <Label className="text-xs text-muted-foreground">Trade-in Value</Label>
          <Input type="number" value={state.tradeInValue} onChange={e => setState({ tradeInValue: e.target.value })} className="mt-1" placeholder="0" />
        </div>

        <div className="flex gap-3">
          <div className="flex-1">
            <Label className="text-xs text-muted-foreground">Loan Term</Label>
            <Select value={state.loanTermMonths} onValueChange={v => setState({ loanTermMonths: v })}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="24">24 months</SelectItem>
                <SelectItem value="36">36 months</SelectItem>
                <SelectItem value="48">48 months</SelectItem>
                <SelectItem value="60">60 months</SelectItem>
                <SelectItem value="72">72 months</SelectItem>
                <SelectItem value="84">84 months</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex-1">
            <Label className="text-xs text-muted-foreground">Interest Rate (%)</Label>
            <Input type="number" step="0.1" value={state.interestRate} onChange={e => setState({ interestRate: e.target.value })} className="mt-1" />
          </div>
        </div>

        <div>
          <Label className="text-xs text-muted-foreground">Sales Tax Rate (%){state.selectedState === 'SC' ? ' — SC caps at $500' : ''}</Label>
          <Input type="number" step="0.1" value={state.salesTaxRate} onChange={e => setState({ salesTaxRate: e.target.value })} className="mt-1" />
        </div>
      </div>

      {/* Results */}
      <div className="px-6 mt-6">
        <div className="bg-card rounded-xl shadow-sm border border-border overflow-hidden">
          <div className="p-4 border-b border-border">
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Monthly Payment Breakdown</p>
          </div>
          <div className="divide-y divide-border">
            <Row label="Loan Amount" value={fmt(calc.amountFinanced)} sub={`After ${fmtRound(calc.dp)} down${calc.tradeIn > 0 ? ` + ${fmtRound(calc.tradeIn)} trade-in` : ''}`} />
            <Row label="Sales Tax" value={fmt(calc.salesTax)} sub={state.selectedState === 'SC' && calc.salesTax >= 500 ? 'Capped at $500 (SC)' : `${state.salesTaxRate}% of vehicle price`} />
            <Row label="Principal & Interest" value={fmt(calc.monthlyPayment)} sub={`${state.loanTermMonths} months at ${state.interestRate}%`} />
            <Row label="Total Interest Paid" value={fmt(calc.totalInterest)} />
            <div className="flex justify-between items-center p-4 bg-primary/5">
              <p className="text-sm font-bold text-foreground">Monthly Payment</p>
              <p className="text-sm font-bold text-foreground">{fmt(calc.monthlyPayment)}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Guideline Indicators */}
      <div className="px-6 mt-5 space-y-3">
        <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Certified Financial Planner (CFP) Guideline Indicators</p>

        <div className={`rounded-xl p-4 border ${paymentOk ? 'bg-green-50 border-green-200 dark:bg-green-950/30 dark:border-green-800' : 'bg-red-50 border-red-200 dark:bg-red-950/30 dark:border-red-800'}`}>
          <div className="flex justify-between items-center">
            <div>
              <p className="text-sm font-semibold text-foreground">Payment-to-Income Ratio</p>
              <p className="text-xs text-muted-foreground mt-0.5">Monthly payment ÷ gross income (guideline: ≤ 15%)</p>
            </div>
            <span className={`text-lg font-bold ${paymentOk ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
              {hasProfile ? pct(calc.paymentToIncomeRatio) : '—'}
            </span>
          </div>
        </div>

        <div className={`rounded-xl p-4 border ${priceOk ? 'bg-green-50 border-green-200 dark:bg-green-950/30 dark:border-green-800' : 'bg-red-50 border-red-200 dark:bg-red-950/30 dark:border-red-800'}`}>
          <div className="flex justify-between items-center">
            <div>
              <p className="text-sm font-semibold text-foreground">Vehicle Price to Annual Income</p>
              <p className="text-xs text-muted-foreground mt-0.5">Purchase price ÷ annual gross (guideline: ≤ 35%)</p>
            </div>
            <span className={`text-lg font-bold ${priceOk ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
              {hasProfile ? pct(calc.vehiclePriceToIncomeRatio) : '—'}
            </span>
          </div>
        </div>

        <div className={`rounded-xl p-4 border text-center ${overallOk ? 'bg-green-50 border-green-200 dark:bg-green-950/30 dark:border-green-800' : 'bg-red-50 border-red-200 dark:bg-red-950/30 dark:border-red-800'}`}>
          <p className={`text-base font-bold ${overallOk ? 'text-green-700 dark:text-green-300' : 'text-red-700 dark:text-red-300'}`}>
            {!hasProfile ? '— Complete Financial Profile for ratios' : overallOk ? '✓ Within Guidelines' : '⚠ Exceeds Recommended Limits'}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            {!hasProfile
              ? 'Add income data in your Financial Profile to see affordability analysis.'
              : overallOk
                ? 'This vehicle fits within standard financial planning guidelines.'
                : 'Consider a less expensive vehicle, larger down payment, or shorter loan term.'}
          </p>
        </div>
      </div>

      {/* AI Insights */}
      <CarLoanInsightsSection
        householdId={householdId}
        vehiclePrice={parseFloat(state.vehiclePrice) || 0}
        loanAmount={calc.amountFinanced}
        downPayment={calc.dp}
        tradeIn={calc.tradeIn}
        interestRate={parseFloat(state.interestRate) || 0}
        loanTermMonths={calc.months}
        salesTax={calc.salesTax}
        monthlyPayment={calc.monthlyPayment}
        totalInterest={calc.totalInterest}
        totalCost={calc.totalCost}
        paymentToIncomeRatio={calc.paymentToIncomeRatio}
        vehiclePriceToIncomeRatio={calc.vehiclePriceToIncomeRatio}
        financialProfile={financialProfile}
        loanMode={state.loanMode as 'shopping' | 'existing'}
      />
    </div>
  );
}

function Row({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex justify-between items-center p-4">
      <div>
        <p className="text-sm text-foreground">{label}</p>
        {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
      </div>
      <p className="text-sm font-medium text-foreground">{value}</p>
    </div>
  );
}
