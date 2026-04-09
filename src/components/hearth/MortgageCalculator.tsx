import { useState, useMemo, useEffect } from 'react';
import { ArrowLeft } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { useToolState } from '@/hooks/useToolState';

function fmt(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(n);
}

function pct(n: number) {
  return (n * 100).toFixed(1) + '%';
}

interface MortgageCalculatorProps {
  planningData: Record<string, string>;
  onBack: () => void;
  householdId: string | null;
}

export function MortgageCalculator({ planningData, onBack, householdId }: MortgageCalculatorProps) {
  const [financialProfile, setFinancialProfile] = useState<any>(null);
  const [profileLoading, setProfileLoading] = useState(true);

  const { state, setState, loaded: toolStateLoaded } = useToolState(householdId, 'mortgage-calculator', {
    homePrice: '350000',
    downPaymentPct: '20',
    downPaymentMode: 'percent' as 'percent' | 'dollar',
    downPaymentAmt: '70000',
    loanTermYears: '30',
    interestRate: '6.5',
    propertyTaxRate: '1.2',
    insuranceRate: '0.5',
    otherDebtPayments: '',
  });

  useEffect(() => {
    if (!householdId) { setProfileLoading(false); return; }
    supabase
      .from('financial_profiles')
      .select('*')
      .eq('household_id', householdId)
      .maybeSingle()
      .then(({ data }) => {
        if (data) {
          setFinancialProfile(data);
        }
        setProfileLoading(false);
      });
  }, [householdId]);

  // Auto-populate other debt payments from profile (only on initial load)
  useEffect(() => {
    if (!financialProfile || !toolStateLoaded) return;
    // Only auto-populate if not already set by saved state
    if (state.otherDebtPayments === '') {
      const debts = Array.isArray(financialProfile.debts) ? financialProfile.debts as any[] : [];
      const totalDebtPayments = debts.reduce((s: number, d: any) => s + (Number(d.monthlyPayment) || 0), 0);
      if (totalDebtPayments > 0) setState({ otherDebtPayments: String(totalDebtPayments) });
    }
  }, [financialProfile, toolStateLoaded]);

  // Pull gross monthly income from Financial Profile member_incomes
  const grossMonthlyIncome = useMemo(() => {
    if (financialProfile) {
      const memberIncomes = Array.isArray(financialProfile.member_incomes) ? financialProfile.member_incomes as any[] : [];
      const totalFromProfile = memberIncomes.reduce((s: number, m: any) => s + (Number(m.gross_income) || 0), 0);
      if (totalFromProfile > 0) return totalFromProfile / 12;
    }
    return 0;
  }, [financialProfile]);

  const hasProfile = financialProfile && grossMonthlyIncome > 0;

  const calc = useMemo(() => {
    const price = parseFloat(state.homePrice) || 0;
    const dp = state.downPaymentMode === 'percent'
      ? price * (parseFloat(state.downPaymentPct) || 0) / 100
      : parseFloat(state.downPaymentAmt) || 0;
    const loanAmount = Math.max(0, price - dp);
    const years = parseInt(state.loanTermYears) || 30;
    const monthlyRate = (parseFloat(state.interestRate) || 0) / 100 / 12;
    const numPayments = years * 12;

    let monthlyPI = 0;
    if (monthlyRate > 0 && numPayments > 0) {
      monthlyPI = loanAmount * (monthlyRate * Math.pow(1 + monthlyRate, numPayments)) / (Math.pow(1 + monthlyRate, numPayments) - 1);
    } else if (numPayments > 0) {
      monthlyPI = loanAmount / numPayments;
    }

    const monthlyTax = price * (parseFloat(state.propertyTaxRate) || 0) / 100 / 12;
    const monthlyInsurance = price * (parseFloat(state.insuranceRate) || 0) / 100 / 12;
    const totalHousing = monthlyPI + monthlyTax + monthlyInsurance;
    const otherDebt = parseFloat(state.otherDebtPayments) || 0;

    const housingRatio = grossMonthlyIncome > 0 ? totalHousing / grossMonthlyIncome : 0;
    const dtiRatio = grossMonthlyIncome > 0 ? (totalHousing + otherDebt) / grossMonthlyIncome : 0;

    return { loanAmount, dp, monthlyPI, monthlyTax, monthlyInsurance, totalHousing, housingRatio, dtiRatio, otherDebt };
  }, [state, grossMonthlyIncome]);

  const housingOk = calc.housingRatio <= 0.28;
  const dtiOk = calc.dtiRatio <= 0.36;
  const overallOk = housingOk && dtiOk;

  if (profileLoading || !toolStateLoaded) {
    return (
      <div className="max-w-lg mx-auto pb-32">
        <div className="px-6 pt-12 safe-top flex items-center gap-3">
          <button onClick={onBack} className="p-1.5 -ml-1.5 rounded-lg hover:bg-muted"><ArrowLeft size={20} className="text-foreground" /></button>
          <h1 className="font-display text-xl font-bold text-foreground">Mortgage Calculator</h1>
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
          <h1 className="font-display text-xl font-bold text-foreground">Mortgage Calculator</h1>
          <p className="text-sm text-muted-foreground mt-0.5">How much home can you afford?</p>
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

      {/* Inputs */}
      <div className="px-6 mt-5 space-y-4">
        <div>
          <Label className="text-xs text-muted-foreground">Home Price</Label>
          <Input type="number" value={state.homePrice} onChange={e => setState({ homePrice: e.target.value })} className="mt-1" />
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
                    downPaymentAmt: String(Math.round((parseFloat(state.homePrice) || 0) * (parseFloat(e.target.value) || 0) / 100)),
                  });
                } else {
                  const price = parseFloat(state.homePrice) || 1;
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

        <div className="flex gap-3">
          <div className="flex-1">
            <Label className="text-xs text-muted-foreground">Loan Term (years)</Label>
            <Select value={state.loanTermYears} onValueChange={v => setState({ loanTermYears: v })}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="15">15 years</SelectItem>
                <SelectItem value="20">20 years</SelectItem>
                <SelectItem value="30">30 years</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex-1">
            <Label className="text-xs text-muted-foreground">Interest Rate (%)</Label>
            <Input type="number" step="0.1" value={state.interestRate} onChange={e => setState({ interestRate: e.target.value })} className="mt-1" />
          </div>
        </div>

        <div className="flex gap-3">
          <div className="flex-1">
            <Label className="text-xs text-muted-foreground">Property Tax (%/yr)</Label>
            <Input type="number" step="0.1" value={state.propertyTaxRate} onChange={e => setState({ propertyTaxRate: e.target.value })} className="mt-1" />
          </div>
          <div className="flex-1">
            <Label className="text-xs text-muted-foreground">Insurance (%/yr)</Label>
            <Input type="number" step="0.1" value={state.insuranceRate} onChange={e => setState({ insuranceRate: e.target.value })} className="mt-1" />
          </div>
        </div>
      </div>

      {/* Results */}
      <div className="px-6 mt-6">
        <div className="bg-card rounded-xl shadow-sm border border-border overflow-hidden">
          <div className="p-4 border-b border-border">
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Monthly Payment Breakdown</p>
          </div>
          <div className="divide-y divide-border">
            <Row label="Loan Amount" value={fmt(calc.loanAmount)} />
            <Row label="Principal & Interest" value={fmt(calc.monthlyPI)} />
            <Row label="Property Tax" value={fmt(calc.monthlyTax)} sub={`${state.propertyTaxRate}% of home value/yr`} />
            <Row label="Insurance" value={fmt(calc.monthlyInsurance)} sub={`${state.insuranceRate}% of home value/yr`} />
            <div className="flex justify-between items-center p-4 bg-primary/5">
              <p className="text-sm font-bold text-foreground">Total Monthly Housing</p>
              <p className="text-sm font-bold text-foreground">{fmt(calc.totalHousing)}</p>
            </div>
          </div>
        </div>
      </div>

      {/* CFP Indicators */}
      <div className="px-6 mt-5 space-y-3">
        <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">CFP Guideline Indicators</p>

        <div className={`rounded-xl p-4 border ${housingOk ? 'bg-green-50 border-green-200 dark:bg-green-950/30 dark:border-green-800' : 'bg-red-50 border-red-200 dark:bg-red-950/30 dark:border-red-800'}`}>
          <div className="flex justify-between items-center">
            <div>
              <p className="text-sm font-semibold text-foreground">Housing Ratio</p>
              <p className="text-xs text-muted-foreground mt-0.5">Total housing ÷ gross income (guideline: ≤ 28%)</p>
            </div>
            <span className={`text-lg font-bold ${housingOk ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
              {hasProfile ? pct(calc.housingRatio) : '—'}
            </span>
          </div>
        </div>

        <div className={`rounded-xl p-4 border ${dtiOk ? 'bg-green-50 border-green-200 dark:bg-green-950/30 dark:border-green-800' : 'bg-red-50 border-red-200 dark:bg-red-950/30 dark:border-red-800'}`}>
          <div className="flex justify-between items-start">
            <div className="flex-1">
              <p className="text-sm font-semibold text-foreground">Debt-to-Income Ratio</p>
              <p className="text-xs text-muted-foreground mt-0.5">(Housing + other debt) ÷ gross income (guideline: ≤ 36%)</p>
              <div className="mt-2">
                <Label className="text-xs text-muted-foreground">Other Monthly Debt Payments</Label>
                <Input
                  type="number" placeholder="0"
                  value={state.otherDebtPayments}
                  onChange={e => setState({ otherDebtPayments: e.target.value })}
                  className="mt-1 max-w-[180px] h-8 text-sm"
                />
              </div>
            </div>
            <span className={`text-lg font-bold ${dtiOk ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
              {hasProfile ? pct(calc.dtiRatio) : '—'}
            </span>
          </div>
        </div>

        <div className={`rounded-xl p-4 border text-center ${overallOk ? 'bg-green-50 border-green-200 dark:bg-green-950/30 dark:border-green-800' : 'bg-red-50 border-red-200 dark:bg-red-950/30 dark:border-red-800'}`}>
          <p className={`text-base font-bold ${overallOk ? 'text-green-700 dark:text-green-300' : 'text-red-700 dark:text-red-300'}`}>
            {!hasProfile ? '— Complete Financial Profile for ratios' : overallOk ? '✓ Within CFP Guidelines' : '⚠ Exceeds Recommended Limits'}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            {!hasProfile
              ? 'Add income data in your Financial Profile to see affordability analysis.'
              : overallOk
                ? 'This home fits comfortably within standard financial planning guidelines.'
                : 'Consider a lower price, larger down payment, or paying down existing debt.'}
          </p>
        </div>
      </div>
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
