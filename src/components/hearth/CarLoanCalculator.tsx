import { useState, useMemo, useEffect, useCallback } from 'react';
import { ArrowLeft, ChevronDown, AlertTriangle } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ProgressBar } from './ProgressBar';
import { supabase } from '@/integrations/supabase/client';
import { useToolState } from '@/hooks/useToolState';
import { CarLoanInsightsSection } from './CarLoanInsightsSection';

const STATE_SALES_TAX: Record<string, number> = {
  AL: 2, AK: 0, AZ: 5.6, AR: 6.5, CA: 7.25, CO: 2.9, CT: 6.35, DE: 0, FL: 6, GA: 6.6,
  HI: 4, ID: 6, IL: 6.25, IN: 7, IA: 5, KS: 6.5, KY: 6, LA: 4.45, ME: 5.5, MD: 6,
  MA: 6.25, MI: 6, MN: 6.875, MS: 5, MO: 4.225, MT: 0, NE: 5.5, NV: 8.25, NH: 0,
  NJ: 6.625, NM: 4, NY: 4, NC: 3, ND: 5, OH: 5.75, OK: 4.5, OR: 0, PA: 6, RI: 7,
  SC: 5, SD: 4.5, TN: 7, TX: 6.25, UT: 6.85, VT: 6, VA: 4.15, WA: 6.5, WV: 6, WI: 5, WY: 4, DC: 6,
};

const STATE_OPTIONS_LIST = Object.entries(STATE_SALES_TAX)
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
  shoppingOnly?: boolean;
}

export function CarLoanCalculator({ onBack, householdId, shoppingOnly }: CarLoanCalculatorProps) {
  const [financialProfile, setFinancialProfile] = useState<any>(null);
  const [profileLoading, setProfileLoading] = useState(true);

  const { state, setState, loaded: toolStateLoaded } = useToolState(householdId, 'car-loan', {
    loanMode: 'shopping' as 'shopping' | 'existing',
    // Shopping mode
    vehiclePrice: '30000',
    downPaymentPct: '10',
    downPaymentMode: 'percent' as 'percent' | 'dollar',
    downPaymentAmt: '3000',
    loanTermMonths: '60',
    interestRate: '6.5',
    salesTaxRate: '6',
    tradeInValue: '0',
    selectedState: '',
    extraPayment: '0',
    // Existing loan mode
    exCurrentBalance: '',
    exStatementMonth: '',
    exStatementYear: '',
    exOriginalTerm: '60',
    exInterestRate: '',
    exMonthlyPayment: '',
    exVehicleValue: '',
    exExtraPayment: '0',
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

  // Auto-populate from profile
  useEffect(() => {
    if (!financialProfile || !toolStateLoaded) return;
    const updates: Record<string, string> = {};

    // State / sales tax
    if (state.selectedState === '' && financialProfile.state) {
      const st = financialProfile.state.toUpperCase();
      if (STATE_SALES_TAX[st] !== undefined) {
        updates.selectedState = st;
        updates.salesTaxRate = String(STATE_SALES_TAX[st]);
      }
    }

    // Existing mode: pull auto loan from debts array
    const debts = Array.isArray(financialProfile.debts) ? financialProfile.debts as any[] : [];
    const autoDebt = debts.find((d: any) => {
      const t = (d.type || d.name || '').toLowerCase();
      return t.includes('auto') || t.includes('car') || t.includes('vehicle');
    });
    if (autoDebt) {
      if (state.exCurrentBalance === '' && autoDebt.balance) updates.exCurrentBalance = String(autoDebt.balance);
      if (state.exInterestRate === '' && autoDebt.interestRate) updates.exInterestRate = String(autoDebt.interestRate);
      if (state.exMonthlyPayment === '' && autoDebt.monthlyPayment) updates.exMonthlyPayment = String(autoDebt.monthlyPayment);
    }

    if (Object.keys(updates).length > 0) setState(updates);
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
  const isShopping = shoppingOnly || state.loanMode === 'shopping';

  // ── Shopping mode calculations ──
  const shoppingCalc = useMemo(() => {
    const price = parseFloat(state.vehiclePrice) || 0;
    const dp = state.downPaymentMode === 'percent'
      ? price * (parseFloat(state.downPaymentPct) || 0) / 100
      : parseFloat(state.downPaymentAmt) || 0;
    const tradeIn = parseFloat(state.tradeInValue) || 0;
    const taxRate = (parseFloat(state.salesTaxRate) || 0) / 100;

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

    const totalInterest = (monthlyPayment * months) - amountFinanced;
    const totalCost = price + totalInterest + salesTax;
    const paymentToIncomeRatio = grossMonthlyIncome > 0 ? monthlyPayment / grossMonthlyIncome : 0;
    const vehiclePriceToIncomeRatio = annualGrossIncome > 0 ? price / annualGrossIncome : 0;

    // Extra payment analysis
    const extra = parseFloat(state.extraPayment) || 0;
    let monthsWithExtra = months;
    let totalInterestExtra = totalInterest;
    if (extra > 0 && monthlyRate > 0 && amountFinanced > 0) {
      let bal = amountFinanced;
      let m = 0;
      let interest = 0;
      const totalPmt = monthlyPayment + extra;
      while (bal > 0 && m < months * 2) {
        const intCharge = bal * monthlyRate;
        interest += intCharge;
        bal -= Math.min(bal, totalPmt - intCharge);
        m++;
        if (bal <= 0) break;
      }
      monthsWithExtra = m;
      totalInterestExtra = interest;
    }
    const interestSaved = totalInterest - totalInterestExtra;
    const monthsSaved = months - monthsWithExtra;

    return {
      dp, tradeIn, salesTax, amountFinanced, monthlyPayment, totalInterest, totalCost,
      paymentToIncomeRatio, vehiclePriceToIncomeRatio, months,
      monthsWithExtra, totalInterestExtra, interestSaved, monthsSaved,
    };
  }, [state.vehiclePrice, state.downPaymentMode, state.downPaymentPct, state.downPaymentAmt, state.tradeInValue, state.salesTaxRate, state.selectedState, state.loanTermMonths, state.interestRate, state.extraPayment, grossMonthlyIncome, annualGrossIncome]);

  // ── Existing loan calculations ──
  const existingCalc = useMemo(() => {
    const currentBalance = parseFloat(state.exCurrentBalance) || 0;
    const rate = (parseFloat(state.exInterestRate) || 0) / 100 / 12;
    const monthlyPmt = parseFloat(state.exMonthlyPayment) || 0;
    const vehicleValue = parseFloat(state.exVehicleValue) || 0;

    // Statement date offset
    const stmtMonth = parseInt(state.exStatementMonth) || 0;
    const stmtYear = parseInt(state.exStatementYear) || 0;
    let monthsSinceStatement = 0;
    if (stmtMonth > 0 && stmtYear > 0) {
      const now = new Date();
      const stmtDate = new Date(stmtYear, stmtMonth - 1);
      monthsSinceStatement = Math.max(0, (now.getFullYear() - stmtDate.getFullYear()) * 12 + (now.getMonth() - stmtDate.getMonth()));
    }

    let adjustedBalance = currentBalance;
    if (monthsSinceStatement > 0 && rate > 0 && monthlyPmt > 0) {
      let bal = currentBalance;
      for (let i = 0; i < monthsSinceStatement; i++) {
        const intCharge = bal * rate;
        bal -= (monthlyPmt - intCharge);
        if (bal <= 0) { bal = 0; break; }
      }
      adjustedBalance = Math.max(0, bal);
    }

    // Remaining months
    let remainingMonths = 0;
    let totalInterestRemaining = 0;
    if (rate > 0 && monthlyPmt > 0 && adjustedBalance > 0) {
      let bal = adjustedBalance;
      while (bal > 0 && remainingMonths < 600) {
        const intCharge = bal * rate;
        totalInterestRemaining += intCharge;
        bal -= (monthlyPmt - intCharge);
        remainingMonths++;
        if (bal <= 0) break;
      }
    } else if (monthlyPmt > 0 && adjustedBalance > 0) {
      remainingMonths = Math.ceil(adjustedBalance / monthlyPmt);
    }

    const payoffDate = new Date();
    payoffDate.setMonth(payoffDate.getMonth() + remainingMonths);

    // LTV
    const ltv = vehicleValue > 0 ? adjustedBalance / vehicleValue : 0;
    const isUnderwater = vehicleValue > 0 && adjustedBalance > vehicleValue;

    // Income ratios
    const paymentToIncomeRatio = grossMonthlyIncome > 0 ? monthlyPmt / grossMonthlyIncome : 0;
    const vehiclePriceToIncomeRatio = 0; // not applicable for existing

    // Extra payment analysis
    const extra = parseFloat(state.exExtraPayment) || 0;
    let monthsWithExtra = remainingMonths;
    let totalInterestExtra = totalInterestRemaining;
    if (extra > 0 && rate > 0 && adjustedBalance > 0 && monthlyPmt > 0) {
      let bal = adjustedBalance;
      let m = 0;
      let interest = 0;
      const totalPay = monthlyPmt + extra;
      while (bal > 0 && m < 600) {
        const intCharge = bal * rate;
        interest += intCharge;
        bal -= Math.min(bal, totalPay - intCharge);
        m++;
        if (bal <= 0) break;
      }
      monthsWithExtra = m;
      totalInterestExtra = interest;
    }
    const interestSaved = totalInterestRemaining - totalInterestExtra;
    const monthsSaved = remainingMonths - monthsWithExtra;

    return {
      currentBalance, adjustedBalance, monthlyPmt, vehicleValue, ltv, isUnderwater,
      remainingMonths, totalInterestRemaining, payoffDate,
      paymentToIncomeRatio, vehiclePriceToIncomeRatio,
      monthsWithExtra, totalInterestExtra, interestSaved, monthsSaved, extra,
    };
  }, [state.exCurrentBalance, state.exStatementMonth, state.exStatementYear, state.exOriginalTerm, state.exInterestRate, state.exMonthlyPayment, state.exVehicleValue, state.exExtraPayment, grossMonthlyIncome]);

  // Active ratios for guidelines
  const activePaymentRatio = isShopping ? shoppingCalc.paymentToIncomeRatio : existingCalc.paymentToIncomeRatio;
  const activePriceRatio = isShopping ? shoppingCalc.vehiclePriceToIncomeRatio : existingCalc.vehiclePriceToIncomeRatio;
  const activeMonthlyPayment = isShopping ? shoppingCalc.monthlyPayment : existingCalc.monthlyPmt;

  const paymentOk = activePaymentRatio <= 0.15;
  const priceOk = isShopping ? activePriceRatio <= 0.35 : true;
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

  const monthOptions = [
    { value: '1', label: 'Jan' }, { value: '2', label: 'Feb' }, { value: '3', label: 'Mar' },
    { value: '4', label: 'Apr' }, { value: '5', label: 'May' }, { value: '6', label: 'Jun' },
    { value: '7', label: 'Jul' }, { value: '8', label: 'Aug' }, { value: '9', label: 'Sep' },
    { value: '10', label: 'Oct' }, { value: '11', label: 'Nov' }, { value: '12', label: 'Dec' },
  ];
  const currentYear = new Date().getFullYear();
  const yearOptions = Array.from({ length: 5 }, (_, i) => currentYear - i);

  return (
    <div className="max-w-lg mx-auto pb-32">
      <div className="px-6 pt-12 safe-top flex items-center gap-3">
        <button onClick={onBack} className="p-1.5 -ml-1.5 rounded-lg hover:bg-muted">
          <ArrowLeft size={20} className="text-foreground" />
        </button>
        <div>
          <h1 className="font-display text-xl font-bold text-foreground">Car Loan Calculator</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {isShopping ? 'Calculate your true cost of ownership' : 'Analyze your current auto loan'}
          </p>
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

      {/* Mode toggle */}
      <div className="px-6 mt-4">
        <div className="flex rounded-lg bg-muted p-0.5">
          <button
            onClick={() => setState({ loanMode: 'shopping' as any })}
            className={`flex-1 text-sm font-semibold py-2 rounded-md transition-colors ${
              isShopping
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            I'm Shopping
          </button>
          <button
            onClick={() => setState({ loanMode: 'existing' as any })}
            className={`flex-1 text-sm font-semibold py-2 rounded-md transition-colors ${
              !isShopping
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            This is My Loan
          </button>
        </div>
      </div>

      {/* ═══════════════════════════════════════════ */}
      {/* SHOPPING MODE */}
      {/* ═══════════════════════════════════════════ */}
      {isShopping && (
        <>
          {/* State selector */}
          <div className="px-6 mt-4">
            <Label className="text-xs text-muted-foreground">State (for sales tax)</Label>
            <Select value={state.selectedState} onValueChange={handleStateChange}>
              <SelectTrigger className="mt-1"><SelectValue placeholder="Select state…" /></SelectTrigger>
              <SelectContent className="max-h-60">
                {STATE_OPTIONS_LIST.map(s => (
                  <SelectItem key={s.code} value={s.code}>{STATE_LABELS[s.code] || s.code}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Shopping Inputs */}
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

          {/* Shopping Results */}
          <div className="px-6 mt-6">
            <div className="bg-card rounded-xl shadow-sm border border-border overflow-hidden">
              <div className="p-4 border-b border-border">
                <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Monthly Payment Breakdown</p>
              </div>
              <div className="divide-y divide-border">
                <Row label="Loan Amount" value={fmt(shoppingCalc.amountFinanced)} sub={`After ${fmtRound(shoppingCalc.dp)} down${shoppingCalc.tradeIn > 0 ? ` + ${fmtRound(shoppingCalc.tradeIn)} trade-in` : ''}`} />
                <Row label="Sales Tax" value={fmt(shoppingCalc.salesTax)} sub={state.selectedState === 'SC' && shoppingCalc.salesTax >= 500 ? 'Capped at $500 (SC)' : `${state.salesTaxRate}% of vehicle price`} />
                <Row label="Principal & Interest" value={fmt(shoppingCalc.monthlyPayment)} sub={`${state.loanTermMonths} months at ${state.interestRate}%`} />
                <Row label="Total Interest Paid" value={fmt(shoppingCalc.totalInterest)} />
                <div className="flex justify-between items-center p-4 bg-primary/5">
                  <p className="text-sm font-bold text-foreground">Monthly Payment</p>
                  <p className="text-sm font-bold text-foreground">{fmt(shoppingCalc.monthlyPayment)}</p>
                </div>
              </div>
            </div>
          </div>

          {/* Shopping Extra Payment */}
          <ExtraPaymentSection
            extraPayment={state.extraPayment}
            onExtraPaymentChange={v => setState({ extraPayment: v })}
            standardMonths={shoppingCalc.months}
            totalInterestStandard={shoppingCalc.totalInterest}
            monthsWithExtra={shoppingCalc.monthsWithExtra}
            totalInterestExtra={shoppingCalc.totalInterestExtra}
            interestSaved={shoppingCalc.interestSaved}
            monthsSaved={shoppingCalc.monthsSaved}
          />
        </>
      )}

      {/* ═══════════════════════════════════════════ */}
      {/* EXISTING LOAN MODE */}
      {/* ═══════════════════════════════════════════ */}
      {!isShopping && (
        <>
          <div className="px-6 mt-4 space-y-4">
            <div>
              <Label className="text-xs text-muted-foreground">
                Current Loan Balance
                {financialProfile?.debts && (() => {
                  const debts = Array.isArray(financialProfile.debts) ? financialProfile.debts as any[] : [];
                  return debts.some((d: any) => {
                    const t = (d.type || d.name || '').toLowerCase();
                    return (t.includes('auto') || t.includes('car') || t.includes('vehicle')) && d.balance;
                  });
                })() ? <span className="text-accent ml-1">(from profile)</span> : ''}
              </Label>
              <Input type="number" value={state.exCurrentBalance} onChange={e => setState({ exCurrentBalance: e.target.value })} placeholder="0" className="mt-1" />
            </div>

            <div>
              <Label className="text-xs text-muted-foreground">Statement Date (when balance was accurate)</Label>
              <div className="flex gap-2 mt-1">
                <Select value={state.exStatementMonth} onValueChange={v => setState({ exStatementMonth: v })}>
                  <SelectTrigger className="flex-1"><SelectValue placeholder="Month" /></SelectTrigger>
                  <SelectContent>
                    {monthOptions.map(m => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={state.exStatementYear} onValueChange={v => setState({ exStatementYear: v })}>
                  <SelectTrigger className="w-24"><SelectValue placeholder="Year" /></SelectTrigger>
                  <SelectContent>
                    {yearOptions.map(y => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex gap-3">
              <div className="flex-1">
                <Label className="text-xs text-muted-foreground">Original Loan Term</Label>
                <Select value={state.exOriginalTerm} onValueChange={v => setState({ exOriginalTerm: v })}>
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
                <Label className="text-xs text-muted-foreground">
                  Interest Rate (%)
                  {financialProfile?.debts && (() => {
                    const debts = Array.isArray(financialProfile.debts) ? financialProfile.debts as any[] : [];
                    return debts.some((d: any) => {
                      const t = (d.type || d.name || '').toLowerCase();
                      return (t.includes('auto') || t.includes('car') || t.includes('vehicle')) && d.interestRate;
                    });
                  })() ? <span className="text-accent ml-1">(profile)</span> : ''}
                </Label>
                <Input type="number" step="0.1" value={state.exInterestRate} onChange={e => setState({ exInterestRate: e.target.value })} placeholder="0" className="mt-1" />
              </div>
            </div>

            <div>
              <Label className="text-xs text-muted-foreground">
                Actual Monthly Payment
                {financialProfile?.debts && (() => {
                  const debts = Array.isArray(financialProfile.debts) ? financialProfile.debts as any[] : [];
                  return debts.some((d: any) => {
                    const t = (d.type || d.name || '').toLowerCase();
                    return (t.includes('auto') || t.includes('car') || t.includes('vehicle')) && d.monthlyPayment;
                  });
                })() ? <span className="text-accent ml-1">(from profile)</span> : ''}
              </Label>
              <Input type="number" value={state.exMonthlyPayment} onChange={e => setState({ exMonthlyPayment: e.target.value })} placeholder="0" className="mt-1" />
            </div>

            <div className="border-t border-border pt-4">
              <Label className="text-xs text-muted-foreground">Vehicle Value (optional — enables loan-to-value analysis)</Label>
              <Input type="number" value={state.exVehicleValue} onChange={e => setState({ exVehicleValue: e.target.value })} placeholder="0" className="mt-1" />
            </div>
          </div>

          {/* Existing Loan Results */}
          <div className="px-6 mt-6">
            <div className="bg-card rounded-xl shadow-sm border border-border overflow-hidden">
              <div className="p-4 border-b border-border">
                <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Loan Analysis</p>
              </div>
              <div className="divide-y divide-border">
                <Row label="Current Balance" value={fmt(existingCalc.adjustedBalance)} sub={existingCalc.adjustedBalance !== existingCalc.currentBalance ? 'Adjusted to today from statement date' : undefined} />
                <Row label="Monthly Payment" value={fmt(existingCalc.monthlyPmt)} />
                <Row label="Projected Payoff" value={existingCalc.remainingMonths > 0 ? existingCalc.payoffDate.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) : '—'} />
                <Row label="Remaining Term" value={existingCalc.remainingMonths > 0 ? `${Math.floor(existingCalc.remainingMonths / 12)}y ${existingCalc.remainingMonths % 12}m` : '—'} />
                <Row label="Total Interest Remaining" value={fmt(existingCalc.totalInterestRemaining)} />
              </div>
            </div>
          </div>

          {/* LTV / Underwater */}
          {existingCalc.vehicleValue > 0 && (
            <div className="px-6 mt-5">
              <div className="bg-card rounded-xl shadow-sm border border-border p-4">
                <div className="flex justify-between items-baseline mb-2">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Loan-to-Value</p>
                  <span className={`text-sm font-bold ${existingCalc.isUnderwater ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}`}>
                    {pct(existingCalc.ltv)}
                  </span>
                </div>
                <ProgressBar value={Math.min(existingCalc.adjustedBalance, existingCalc.vehicleValue)} max={existingCalc.vehicleValue} className="mb-2" />
                <div className="flex justify-between text-[11px] text-muted-foreground tabular-nums">
                  <span>Owed: {fmt(existingCalc.adjustedBalance)}</span>
                  <span>Value: {fmt(existingCalc.vehicleValue)}</span>
                </div>
                {existingCalc.isUnderwater && (
                  <div className="mt-3 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-lg p-3">
                    <div className="flex items-start gap-2">
                      <AlertTriangle size={14} className="text-red-500 mt-0.5 shrink-0" />
                      <div>
                        <p className="text-sm font-semibold text-red-700 dark:text-red-300">Underwater by {fmt(existingCalc.adjustedBalance - existingCalc.vehicleValue)}</p>
                        <p className="text-xs text-muted-foreground mt-1">Being underwater on a vehicle loan means you owe more than the car is worth. This is common early in a loan but worth monitoring.</p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Existing Extra Payment */}
          <ExtraPaymentSection
            extraPayment={state.exExtraPayment}
            onExtraPaymentChange={v => setState({ exExtraPayment: v })}
            standardMonths={existingCalc.remainingMonths}
            totalInterestStandard={existingCalc.totalInterestRemaining}
            monthsWithExtra={existingCalc.monthsWithExtra}
            totalInterestExtra={existingCalc.totalInterestExtra}
            interestSaved={existingCalc.interestSaved}
            monthsSaved={existingCalc.monthsSaved}
          />
        </>
      )}

      {/* ═══════════════════════════════════════════ */}
      {/* SHARED: CFP Guideline Indicators */}
      {/* ═══════════════════════════════════════════ */}
      <div className="px-6 mt-5 space-y-3">
        <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Certified Financial Planner (CFP) Guideline Indicators</p>

        <div className={`rounded-xl p-4 border ${paymentOk ? 'bg-green-50 border-green-200 dark:bg-green-950/30 dark:border-green-800' : 'bg-red-50 border-red-200 dark:bg-red-950/30 dark:border-red-800'}`}>
          <div className="flex justify-between items-center">
            <div>
              <p className="text-sm font-semibold text-foreground">Payment-to-Income Ratio</p>
              <p className="text-xs text-muted-foreground mt-0.5">Monthly payment ÷ gross income (guideline: ≤ 15%)</p>
            </div>
            <span className={`text-lg font-bold ${paymentOk ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
              {hasProfile ? pct(activePaymentRatio) : '—'}
            </span>
          </div>
        </div>

        {isShopping && (
          <div className={`rounded-xl p-4 border ${priceOk ? 'bg-green-50 border-green-200 dark:bg-green-950/30 dark:border-green-800' : 'bg-red-50 border-red-200 dark:bg-red-950/30 dark:border-red-800'}`}>
            <div className="flex justify-between items-center">
              <div>
                <p className="text-sm font-semibold text-foreground">Vehicle Price to Annual Income</p>
                <p className="text-xs text-muted-foreground mt-0.5">Purchase price ÷ annual gross (guideline: ≤ 35%)</p>
              </div>
              <span className={`text-lg font-bold ${priceOk ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                {hasProfile ? pct(activePriceRatio) : '—'}
              </span>
            </div>
          </div>
        )}

        <div className={`rounded-xl p-4 border text-center ${overallOk ? 'bg-green-50 border-green-200 dark:bg-green-950/30 dark:border-green-800' : 'bg-red-50 border-red-200 dark:bg-red-950/30 dark:border-red-800'}`}>
          <p className={`text-base font-bold ${overallOk ? 'text-green-700 dark:text-green-300' : 'text-red-700 dark:text-red-300'}`}>
            {!hasProfile ? '— Complete Financial Profile for ratios' : overallOk ? '✓ Within Guidelines' : '⚠ Exceeds Recommended Limits'}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            {!hasProfile
              ? 'Add income data in your Financial Profile to see affordability analysis.'
              : overallOk
                ? (isShopping ? 'This vehicle fits within standard financial planning guidelines.' : 'Your auto loan fits within standard financial planning guidelines.')
                : (isShopping ? 'Consider a less expensive vehicle, larger down payment, or shorter loan term.' : 'Your auto loan payment exceeds recommended limits. Consider refinancing or accelerating payoff.')}
          </p>
        </div>
      </div>

      {/* AI Insights */}
      <CarLoanInsightsSection
        householdId={householdId}
        vehiclePrice={isShopping ? (parseFloat(state.vehiclePrice) || 0) : existingCalc.vehicleValue}
        loanAmount={isShopping ? shoppingCalc.amountFinanced : existingCalc.adjustedBalance}
        downPayment={isShopping ? shoppingCalc.dp : 0}
        tradeIn={isShopping ? shoppingCalc.tradeIn : 0}
        interestRate={isShopping ? (parseFloat(state.interestRate) || 0) : (parseFloat(state.exInterestRate) || 0)}
        loanTermMonths={isShopping ? shoppingCalc.months : existingCalc.remainingMonths}
        salesTax={isShopping ? shoppingCalc.salesTax : 0}
        monthlyPayment={activeMonthlyPayment}
        totalInterest={isShopping ? shoppingCalc.totalInterest : existingCalc.totalInterestRemaining}
        totalCost={isShopping ? shoppingCalc.totalCost : 0}
        paymentToIncomeRatio={activePaymentRatio}
        vehiclePriceToIncomeRatio={activePriceRatio}
        financialProfile={financialProfile}
        loanMode={state.loanMode as 'shopping' | 'existing'}
      />
    </div>
  );
}

/* ── Sub-components ────────────────────────────── */

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

function ExtraPaymentSection({
  extraPayment, onExtraPaymentChange,
  standardMonths, totalInterestStandard,
  monthsWithExtra, totalInterestExtra,
  interestSaved, monthsSaved,
}: {
  extraPayment: string; onExtraPaymentChange: (v: string) => void;
  standardMonths: number; totalInterestStandard: number;
  monthsWithExtra: number; totalInterestExtra: number;
  interestSaved: number; monthsSaved: number;
}) {
  const extra = parseFloat(extraPayment) || 0;
  return (
    <div className="px-6 mt-5">
      <Collapsible>
        <CollapsibleTrigger className="flex items-center gap-1.5 text-accent text-sm font-semibold mb-3">
          <ChevronDown size={14} className="transition-transform duration-200 [[data-state=open]>&]:rotate-180" />
          See Extra Payment Impact
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="space-y-4">
            <div>
              <Label className="text-xs text-muted-foreground">Extra Monthly Payment ($)</Label>
              <Input
                type="number" placeholder="0"
                value={extraPayment}
                onChange={e => onExtraPaymentChange(e.target.value)}
                className="mt-1 max-w-[200px]"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="bg-card rounded-lg shadow-sm p-3 border border-border">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">Standard</p>
                <div className="space-y-1.5">
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">Term</span>
                    <span className="font-medium text-foreground">{Math.floor(standardMonths / 12)}y {standardMonths % 12}m</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">Total Interest</span>
                    <span className="font-medium text-foreground">{fmt(totalInterestStandard)}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">Payoff</span>
                    <span className="font-medium text-foreground">
                      {new Date(Date.now() + standardMonths * 30.44 * 24 * 60 * 60 * 1000).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}
                    </span>
                  </div>
                </div>
              </div>

              <div className={`bg-card rounded-lg shadow-sm p-3 border ${extra > 0 ? 'border-green-300 dark:border-green-700' : 'border-border'}`}>
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">With Extra</p>
                <div className="space-y-1.5">
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">Term</span>
                    <span className="font-medium text-foreground">{Math.floor(monthsWithExtra / 12)}y {monthsWithExtra % 12}m</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">Total Interest</span>
                    <span className="font-medium text-foreground">{fmt(totalInterestExtra)}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">Payoff</span>
                    <span className="font-medium text-foreground">
                      {new Date(Date.now() + monthsWithExtra * 30.44 * 24 * 60 * 60 * 1000).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {extra > 0 && interestSaved > 0 && (
              <div className="bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 rounded-lg p-3">
                <p className="text-sm font-semibold text-green-700 dark:text-green-300">
                  Paying an extra {fmt(extra)}/mo saves {fmt(interestSaved)} in interest and pays off your loan {Math.floor(monthsSaved / 12) > 0 ? `${Math.floor(monthsSaved / 12)} year${Math.floor(monthsSaved / 12) !== 1 ? 's' : ''} ` : ''}{monthsSaved % 12 > 0 ? `${monthsSaved % 12} month${monthsSaved % 12 !== 1 ? 's' : ''} ` : ''}early.
                </p>
              </div>
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
