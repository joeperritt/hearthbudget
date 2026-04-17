import { useState, useMemo, useEffect, useCallback } from 'react';
import { ArrowLeft, Sparkles, Loader2, ChevronDown, AlertTriangle, Calculator } from 'lucide-react';
import { Slider } from '@/components/ui/slider';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ProgressBar } from './ProgressBar';
import { supabase } from '@/integrations/supabase/client';
import { useToolState } from '@/hooks/useToolState';
import { STATE_DEFAULTS, STATE_OPTIONS } from '@/data/stateDefaults';
import { MortgageInsightsSection } from './MortgageInsightsSection';

function PayoffYearSlider({ adjustedBalance, monthlyPI, monthlyRate, remainingMonths, totalInterestRemaining, payoffDate, state, setState }: {
  adjustedBalance: number;
  monthlyPI: number;
  monthlyRate: number;
  remainingMonths: number;
  totalInterestRemaining: number;
  payoffDate: Date;
  state: any;
  setState: (u: any) => void;
}) {
  const now = new Date();
  const projectedYear = payoffDate.getFullYear();
  const minYear = now.getFullYear() + 5;
  const maxYear = Math.max(projectedYear, minYear + 1);
  const targetYear = state.targetPayoffYear ? Number(state.targetPayoffYear) : maxYear;
  const clampedTarget = Math.max(minYear, Math.min(maxYear, targetYear));

  const targetMonths = Math.max(1, (clampedTarget - now.getFullYear()) * 12 - now.getMonth());
  let extraNeeded = 0;
  let interestSaved = 0;
  let monthsSaved = 0;

  if (monthlyRate > 0 && adjustedBalance > 0 && targetMonths < remainingMonths) {
    const requiredPayment = adjustedBalance * (monthlyRate * Math.pow(1 + monthlyRate, targetMonths)) / (Math.pow(1 + monthlyRate, targetMonths) - 1);
    extraNeeded = Math.max(0, requiredPayment - monthlyPI);

    const accelerated = simulateAmortization({
      startingBalance: adjustedBalance,
      monthlyRate,
      monthlyPI,
      extraPayment: extraNeeded,
    });

    interestSaved = totalInterestRemaining - accelerated.totalInterest;
    monthsSaved = remainingMonths - accelerated.months;
  }

  const isDefault = clampedTarget >= maxYear;

  return (
    <div className="px-6 mt-5">
      <div className="bg-card rounded-xl p-4 shadow-sm border border-border space-y-4">
        <p className="text-sm font-semibold text-foreground">Payoff Goal</p>

        <div>
          <div className="flex justify-between items-baseline mb-2">
            <span className="text-xs text-muted-foreground">Target Payoff Year</span>
            <span className="text-sm font-bold text-foreground">{clampedTarget}</span>
          </div>
          <Slider
            min={minYear}
            max={maxYear}
            step={1}
            value={[clampedTarget]}
            onValueChange={([v]) => setState({ targetPayoffYear: String(v) })}
            className="[&_[role=slider]]:bg-accent [&_[role=slider]]:border-accent [&_[data-orientation=horizontal]>[data-orientation=horizontal]]:bg-primary"
          />
          <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
            <span>Earliest Possible ({minYear})</span>
            <span>Current Pace ({maxYear})</span>
          </div>
        </div>

        {isDefault ? (
          <div className="bg-muted/50 rounded-lg p-3">
            <p className="text-sm text-muted-foreground">No extra payment needed at current pace</p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-2">
              <div className="bg-muted/50 rounded-lg p-3">
                <p className="text-[11px] font-semibold text-muted-foreground">Extra Payment</p>
                <p className="text-base font-bold text-foreground mt-1">{fmt(extraNeeded)}<span className="text-[10px] font-normal text-muted-foreground">/mo</span></p>
              </div>
              <div className="bg-muted/50 rounded-lg p-3">
                <p className="text-[11px] font-semibold text-muted-foreground">Interest Saved</p>
                <p className="text-base font-bold text-green-600 dark:text-green-400 mt-1">{fmt(interestSaved)}</p>
              </div>
              <div className="bg-muted/50 rounded-lg p-3">
                <p className="text-[11px] font-semibold text-muted-foreground">Time Saved</p>
                <p className="text-base font-bold text-green-600 dark:text-green-400 mt-1">
                  {monthsSaved > 0
                    ? `${Math.floor(monthsSaved / 12)}y ${monthsSaved % 12}m`
                    : '—'}
                </p>
              </div>
            </div>
            {monthsSaved > 0 && (
              <div className="bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 rounded-lg p-3">
                <p className="text-sm font-semibold text-green-700 dark:text-green-300">
                  Pay off {Math.floor(monthsSaved / 12) > 0 ? `${Math.floor(monthsSaved / 12)} year${Math.floor(monthsSaved / 12) !== 1 ? 's' : ''} ` : ''}{monthsSaved % 12 > 0 ? `${monthsSaved % 12} month${monthsSaved % 12 !== 1 ? 's' : ''} ` : ''}earlier
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function fmt(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(n);
}

function pct(n: number) {
  return (n * 100).toFixed(1) + '%';
}

type AmortizationPreview = {
  month: number;
  startingBalance: number;
  interest: number;
  principalPaid: number;
  extraPaid: number;
  balanceAfterScheduledPayment: number;
  endingBalance: number;
};

const LOAN_TYPE_LABELS: Record<string, string> = {
  '30-year-fixed': '30-Year Fixed',
  '20-year-fixed': '20-Year Fixed',
  '15-year-fixed': '15-Year Fixed',
  '10-year-fixed': '10-Year Fixed',
  '5-1-arm': '5/1 ARM',
  '7-1-arm': '7/1 ARM',
  other: 'Other',
};

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function roundForLog(value: number, decimals = 2) {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function applyAmortizationMonth(balance: number, monthlyRate: number, monthlyPI: number, extraPayment = 0) {
  const startingBalance = Math.max(0, balance);
  const safeMonthlyRate = Math.max(0, monthlyRate);
  const scheduledPayment = Math.max(0, monthlyPI);
  const extraPrincipalPayment = Math.max(0, extraPayment);

  const interest = startingBalance * safeMonthlyRate;
  const scheduledPrincipal = Math.max(0, scheduledPayment - interest);
  const principalPaid = Math.min(startingBalance, scheduledPrincipal);
  const balanceAfterScheduledPayment = Math.max(0, startingBalance - principalPaid);
  const extraPaid = Math.min(balanceAfterScheduledPayment, extraPrincipalPayment);
  const endingBalance = Math.max(0, balanceAfterScheduledPayment - extraPaid);

  return {
    startingBalance,
    interest,
    principalPaid,
    extraPaid,
    balanceAfterScheduledPayment,
    endingBalance,
  };
}

function simulateAmortization({
  startingBalance,
  monthlyRate,
  monthlyPI,
  extraPayment = 0,
  maxMonths = 600,
}: {
  startingBalance: number;
  monthlyRate: number;
  monthlyPI: number;
  extraPayment?: number;
  maxMonths?: number;
}) {
  let balance = Math.max(0, startingBalance);
  let months = 0;
  let totalInterest = 0;
  const preview: AmortizationPreview[] = [];
  let balanceAtMonth300: number | null = null;

  while (balance > 0.01 && months < maxMonths) {
    const step = applyAmortizationMonth(balance, monthlyRate, monthlyPI, extraPayment);
    if (step.principalPaid <= 0 && step.extraPaid <= 0) break;

    months += 1;
    totalInterest += step.interest;
    balance = step.endingBalance;

    if (months === 300) {
      balanceAtMonth300 = roundMoney(balance);
    }

    if (months <= 3) {
      preview.push({
        month: months,
        startingBalance: roundMoney(step.startingBalance),
        interest: roundMoney(step.interest),
        principalPaid: roundMoney(step.principalPaid),
        extraPaid: roundMoney(step.extraPaid),
        balanceAfterScheduledPayment: roundMoney(step.balanceAfterScheduledPayment),
        endingBalance: roundMoney(step.endingBalance),
      });
    }
  }

  const payoffDate = new Date();
  payoffDate.setMonth(payoffDate.getMonth() + months);

  return {
    months,
    totalInterest,
    payoffDate,
    preview,
    firstMonth: preview[0] ?? null,
    balanceAtMonth300,
    finalBalance: balance,
  };
}

function adjustBalanceFromStatement(statementBalance: number, statementMonth: string, monthlyRate: number, monthlyPI: number) {
  let adjustedBalance = Math.max(0, statementBalance);
  let monthsSinceStatement = 0;

  if (!statementMonth) {
    return { adjustedBalance, monthsSinceStatement };
  }

  const [year, month] = statementMonth.split('-').map(Number);
  if (!year || !month) {
    return { adjustedBalance, monthsSinceStatement };
  }

  const now = new Date();
  monthsSinceStatement = Math.max(0, (now.getFullYear() - year) * 12 + (now.getMonth() - (month - 1)));

  for (let i = 0; i < monthsSinceStatement && adjustedBalance > 0.01; i += 1) {
    const step = applyAmortizationMonth(adjustedBalance, monthlyRate, monthlyPI, 0);
    if (step.principalPaid <= 0 && step.extraPaid <= 0) break;
    adjustedBalance = step.endingBalance;
  }

  return { adjustedBalance, monthsSinceStatement };
}

interface MortgageCalculatorProps {
  planningData: Record<string, string>;
  onBack: () => void;
  householdId: string | null;
  shoppingOnly?: boolean;
  onNavigateToProfile?: (tab?: string) => void;
  onNavigateToCalculator?: (id: string) => void;
  onNavigateToBudget?: (monthKey?: string) => void;
  onNavigateToPlanTool?: (toolId: import('@/lib/aiNavigation').PlanToolId) => void;
}

export function MortgageCalculator({ planningData, onBack, householdId, shoppingOnly, onNavigateToProfile, onNavigateToCalculator, onNavigateToBudget, onNavigateToPlanTool }: MortgageCalculatorProps) {
  const [financialProfile, setFinancialProfile] = useState<any>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [taxEstCaption, setTaxEstCaption] = useState('');
  const [insEstCaption, setInsEstCaption] = useState('');
  const [taxEstLoading, setTaxEstLoading] = useState(false);
  const [insEstLoading, setInsEstLoading] = useState(false);

  const { state, setState, loaded: toolStateLoaded } = useToolState(householdId, 'mortgage-calculator', {
    mortgageMode: 'shopping' as 'shopping' | 'existing',
    // Shopping mode fields
    homePrice: '350000',
    downPaymentPct: '20',
    downPaymentMode: 'percent' as 'percent' | 'dollar',
    downPaymentAmt: '70000',
    loanTermYears: '30',
    interestRate: '6.5',
    propertyTaxRate: '1.2',
    propertyTaxMode: 'percent' as 'percent' | 'dollar',
    propertyTaxAmt: '',
    insuranceRate: '0.5',
    insuranceMode: 'percent' as 'percent' | 'dollar',
    insuranceAmt: '',
    otherDebtPayments: '',
    selectedState: '',
    extraPayment: '0',
    // Existing mortgage mode fields
    exCurrentBalance: '',
    exStatementMonth: '',
    exStatementYear: '',
    exOriginalTerm: '30',
    exInterestRate: '',
    exMonthlyPI: '',
    exEscrowTax: '',
    exEscrowInsurance: '',
    exEscrowPMI: '',
    exOriginalLoanAmount: '',
    exExtraPayment: '0',
    exOtherDebtPayments: '',
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

  // Auto-populate from financial profile
  useEffect(() => {
    if (!financialProfile || !toolStateLoaded) return;
    const updates: Record<string, string> = {};

    // Shopping mode: always sync debt payments total from profile (read-only)
    const debts = Array.isArray(financialProfile.debts) ? financialProfile.debts as any[] : [];
    const debtTotal = debts.reduce((s: number, d: any) => s + (Number(d.monthlyPayment) || 0), 0);
    if (String(debtTotal) !== state.otherDebtPayments) {
      updates.otherDebtPayments = String(debtTotal);
    }

    if (state.selectedState === '' && financialProfile.state) {
      const st = financialProfile.state.toUpperCase();
      if (STATE_DEFAULTS[st]) {
        updates.selectedState = st;
        updates.propertyTaxRate = String(STATE_DEFAULTS[st].tax);
        updates.insuranceRate = String(STATE_DEFAULTS[st].insurance);
      }
    }

    // Existing mode: pull from financial profile
    if (state.exCurrentBalance === '' && financialProfile.mortgage_balance) {
      updates.exCurrentBalance = String(financialProfile.mortgage_balance);
    }
    if (state.exInterestRate === '' && financialProfile.mortgage_rate) {
      updates.exInterestRate = String(financialProfile.mortgage_rate);
    }
    if (state.exMonthlyPI === '' && financialProfile.mortgage_pi) {
      updates.exMonthlyPI = String(financialProfile.mortgage_pi);
    } else if (state.exMonthlyPI === '' && financialProfile.mortgage_payment) {
      updates.exMonthlyPI = String(financialProfile.mortgage_payment);
    }
    if (String(debtTotal) !== state.exOtherDebtPayments) {
      updates.exOtherDebtPayments = String(debtTotal);
    }

    if (Object.keys(updates).length > 0) setState(updates);
  }, [financialProfile, toolStateLoaded]);

  const handleStateChange = useCallback((st: string) => {
    const defaults = STATE_DEFAULTS[st];
    if (defaults) {
      setState({
        selectedState: st,
        propertyTaxRate: String(defaults.tax),
        insuranceRate: String(defaults.insurance),
        propertyTaxMode: 'percent',
        insuranceMode: 'percent',
      });
      setTaxEstCaption('');
      setInsEstCaption('');
    }
  }, [setState]);

  const grossMonthlyIncome = useMemo(() => {
    if (financialProfile) {
      const memberIncomes = Array.isArray(financialProfile.member_incomes) ? financialProfile.member_incomes as any[] : [];
      const total = memberIncomes.reduce((s: number, m: any) => s + (Number(m.gross_income) || 0), 0);
      if (total > 0) return total / 12;
    }
    return 0;
  }, [financialProfile]);

  const hasProfile = financialProfile && grossMonthlyIncome > 0;

  // Determine if we're in analyzer (existing mortgage) mode vs shopping mode
  const isAnalyzer = !shoppingOnly;
  const isShopping = shoppingOnly || state.mortgageMode === 'shopping';

  // ── Shopping mode calculations ──
  const shoppingCalc = useMemo(() => {
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

    const monthlyTax = state.propertyTaxMode === 'percent'
      ? price * (parseFloat(state.propertyTaxRate) || 0) / 100 / 12
      : (parseFloat(state.propertyTaxAmt) || 0);
    const monthlyInsurance = state.insuranceMode === 'percent'
      ? price * (parseFloat(state.insuranceRate) || 0) / 100 / 12
      : (parseFloat(state.insuranceAmt) || 0);
    const totalHousing = monthlyPI + monthlyTax + monthlyInsurance;
    const otherDebt = parseFloat(state.otherDebtPayments) || 0;

    const housingRatio = grossMonthlyIncome > 0 ? totalHousing / grossMonthlyIncome : 0;
    const dtiRatio = grossMonthlyIncome > 0 ? (totalHousing + otherDebt) / grossMonthlyIncome : 0;
    const dpPct = price > 0 ? (dp / price) * 100 : 0;

    const extra = parseFloat(state.extraPayment) || 0;
    const totalInterestStandard = monthlyRate > 0 && numPayments > 0 ? (monthlyPI * numPayments) - loanAmount : 0;

    let monthsWithExtra = numPayments;
    let totalInterestExtra = totalInterestStandard;
    if (extra > 0 && monthlyRate > 0 && loanAmount > 0) {
      let balance = loanAmount;
      let months = 0;
      let interest = 0;
      const totalPayment = monthlyPI + extra;
      while (balance > 0 && months < numPayments * 2) {
        const intCharge = balance * monthlyRate;
        interest += intCharge;
        const principalPaid = Math.min(balance, totalPayment - intCharge);
        balance -= principalPaid;
        months++;
        if (balance <= 0) break;
      }
      monthsWithExtra = months;
      totalInterestExtra = interest;
    }
    const interestSaved = totalInterestStandard - totalInterestExtra;
    const monthsSaved = numPayments - monthsWithExtra;

    return { loanAmount, dp, dpPct, monthlyPI, monthlyTax, monthlyInsurance, totalHousing, housingRatio, dtiRatio, otherDebt, totalInterestStandard, totalInterestExtra, interestSaved, monthsSaved, monthsWithExtra, numPayments };
  }, [state.homePrice, state.downPaymentMode, state.downPaymentPct, state.downPaymentAmt, state.loanTermYears, state.interestRate, state.propertyTaxMode, state.propertyTaxRate, state.propertyTaxAmt, state.insuranceMode, state.insuranceRate, state.insuranceAmt, state.otherDebtPayments, state.extraPayment, grossMonthlyIncome]);

  // ── Existing mortgage calculations ──
  const existingCalc = useMemo(() => {
    const currentBalance = parseFloat(state.exCurrentBalance) || 0;
    const rate = (parseFloat(state.exInterestRate) || 0) / 100 / 12;
    const monthlyPI = parseFloat(state.exMonthlyPI) || 0;
    const escrowTax = parseFloat(state.exEscrowTax) || 0;
    const escrowIns = parseFloat(state.exEscrowInsurance) || 0;
    const escrowPMI = parseFloat(state.exEscrowPMI) || 0;
    const totalMonthly = monthlyPI + escrowTax + escrowIns + escrowPMI;
    const originalLoan = parseFloat(state.exOriginalLoanAmount) || 0;
    const otherDebt = parseFloat(state.exOtherDebtPayments) || 0;

    const stmtMonth = parseInt(state.exStatementMonth) || 0;
    const stmtYear = parseInt(state.exStatementYear) || 0;
    let monthsSinceStatement = 0;
    if (stmtMonth > 0 && stmtYear > 0) {
      const now = new Date();
      const stmtDate = new Date(stmtYear, stmtMonth - 1);
      monthsSinceStatement = Math.max(0, (now.getFullYear() - stmtDate.getFullYear()) * 12 + (now.getMonth() - stmtDate.getMonth()));
    }

    const adjustedBalance = monthsSinceStatement > 0 && rate > 0 && monthlyPI > 0
      ? adjustBalanceFromStatement(currentBalance, `${stmtYear}-${String(stmtMonth).padStart(2, '0')}`, rate, monthlyPI).adjustedBalance
      : currentBalance;

    const standardSchedule = rate > 0 && monthlyPI > 0 && adjustedBalance > 0
      ? simulateAmortization({
          startingBalance: adjustedBalance,
          monthlyRate: rate,
          monthlyPI,
          extraPayment: 0,
        })
      : null;

    const remainingMonths = standardSchedule?.months ?? (monthlyPI > 0 && adjustedBalance > 0 ? Math.ceil(adjustedBalance / monthlyPI) : 0);
    const totalInterestRemaining = standardSchedule?.totalInterest ?? 0;

    let interestAlreadyPaid = 0;
    if (originalLoan > 0 && rate > 0 && monthlyPI > 0) {
      const originalTermMonths = parseInt(state.exOriginalTerm) * 12;
      const totalPaidOverLife = monthlyPI * originalTermMonths;
      const totalInterestOverLife = totalPaidOverLife - originalLoan;
      interestAlreadyPaid = Math.max(0, totalInterestOverLife - totalInterestRemaining);
    }

    const payoffDate = new Date();
    payoffDate.setMonth(payoffDate.getMonth() + remainingMonths);

    const equityPct = originalLoan > 0 ? ((originalLoan - adjustedBalance) / originalLoan) * 100 : 0;

    const housingRatio = grossMonthlyIncome > 0 ? totalMonthly / grossMonthlyIncome : 0;
    const dtiRatio = grossMonthlyIncome > 0 ? (totalMonthly + otherDebt) / grossMonthlyIncome : 0;

    const extra = parseFloat(state.exExtraPayment) || 0;
    const acceleratedSchedule = extra > 0 && rate > 0 && adjustedBalance > 0 && monthlyPI > 0
      ? simulateAmortization({
          startingBalance: adjustedBalance,
          monthlyRate: rate,
          monthlyPI,
          extraPayment: extra,
        })
      : null;

    const monthsWithExtra = acceleratedSchedule?.months ?? remainingMonths;
    const totalInterestExtra = acceleratedSchedule?.totalInterest ?? totalInterestRemaining;
    const interestSaved = totalInterestRemaining - totalInterestExtra;
    const monthsSaved = remainingMonths - monthsWithExtra;

    return {
      currentBalance, adjustedBalance, monthlyPI, escrowTax, escrowIns, escrowPMI, totalMonthly,
      remainingMonths, totalInterestRemaining, interestAlreadyPaid, payoffDate,
      originalLoan, equityPct, housingRatio, dtiRatio, otherDebt,
      monthsWithExtra, totalInterestExtra, interestSaved, monthsSaved, extra,
    };
  }, [state.exCurrentBalance, state.exStatementMonth, state.exStatementYear, state.exOriginalTerm, state.exInterestRate, state.exMonthlyPI, state.exEscrowTax, state.exEscrowInsurance, state.exEscrowPMI, state.exOriginalLoanAmount, state.exExtraPayment, state.exOtherDebtPayments, grossMonthlyIncome]);

  const activeCalc = isShopping ? shoppingCalc : existingCalc;
  const activeHousingRatio = isShopping ? shoppingCalc.housingRatio : existingCalc.housingRatio;
  const activeDtiRatio = isShopping ? shoppingCalc.dtiRatio : existingCalc.dtiRatio;
  const activeTotalHousing = isShopping ? shoppingCalc.totalHousing : existingCalc.totalMonthly;
  const activeOtherDebt = isShopping ? shoppingCalc.otherDebt : existingCalc.otherDebt;

  const housingOk = activeHousingRatio <= 0.28;
  const dtiOk = activeDtiRatio <= 0.36;
  const overallOk = housingOk && dtiOk;

  const fetchAiEstimate = useCallback(async (field: 'tax' | 'insurance') => {
    const setLoading = field === 'tax' ? setTaxEstLoading : setInsEstLoading;
    const setCaption = field === 'tax' ? setTaxEstCaption : setInsEstCaption;
    setLoading(true);
    setCaption('');
    try {
      const prompt = field === 'tax'
        ? `For a home in ${STATE_DEFAULTS[state.selectedState]?.label || state.selectedState}, valued at $${state.homePrice}, what is a realistic effective property tax rate? Return JSON: {"rate": <number as percent like 0.57>, "explanation": "<one sentence>"}`
        : `For a home in ${STATE_DEFAULTS[state.selectedState]?.label || state.selectedState}, valued at $${state.homePrice} with a $${shoppingCalc.loanAmount} loan, what is a realistic annual homeowners insurance rate? Return JSON: {"rate": <number as percent like 0.75>, "explanation": "<one sentence>"}`;

      const { data, error } = await supabase.functions.invoke('budget-insights', {
        body: {
          budgetSummary: { context: 'rate_estimate', state: state.selectedState, homePrice: state.homePrice, loanAmount: shoppingCalc.loanAmount },
          chatMessages: [{ role: 'system', content: `You are a real estate data assistant. Respond ONLY with the JSON requested. ${prompt}` }],
        },
      });
      if (error) throw error;
      const content = data?.content || '';
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        const rate = Number(parsed.rate);
        if (rate > 0) {
          if (field === 'tax') {
            setState({ propertyTaxRate: String(rate), propertyTaxMode: 'percent' });
          } else {
            setState({ insuranceRate: String(rate), insuranceMode: 'percent' });
          }
          setCaption(parsed.explanation || '');
        }
      }
    } catch {
      setCaption('Estimate unavailable');
    } finally {
      setLoading(false);
    }
  }, [state.selectedState, state.homePrice, shoppingCalc.loanAmount, setState]);

  if (profileLoading || !toolStateLoaded) {
    return (
      <div className="max-w-lg mx-auto pb-32">
        <div className="px-6 pt-12 safe-top flex items-center gap-3">
          <button onClick={onBack} className="p-1.5 -ml-1.5 rounded-lg hover:bg-muted"><ArrowLeft size={20} className="text-foreground" /></button>
          <h1 className="font-display text-xl font-bold text-foreground">{isAnalyzer ? 'Mortgage Analyzer' : 'Mortgage Calculator'}</h1>
        </div>
        <div className="px-6 mt-8 text-center text-muted-foreground text-sm">Loading…</div>
      </div>
    );
  }

  // ═══════════════════════════════════════════
  // ANALYZER MODE (existing mortgage, read-only from profile)
  // ═══════════════════════════════════════════
  if (isAnalyzer) {
    const housingType = financialProfile?.housing_type || '';
    const balance = Number(financialProfile?.mortgage_balance) || 0;
    const rate = Number(financialProfile?.mortgage_rate) || 0;
    const payment = Number(financialProfile?.mortgage_payment) || 0;
    const statementMonth = financialProfile?.mortgage_statement_month || '';
    const pi = Number(financialProfile?.mortgage_pi) || 0;
    const escrow = Number(financialProfile?.mortgage_escrow) || 0;
    const originalLoan = parseFloat(state.exOriginalLoanAmount) || 0;
    const homeValue = Number(financialProfile?.estimated_home_value) || 0;
    const loanType = financialProfile?.mortgage_loan_type || '30-year-fixed';
    const extra = Number(financialProfile?.mortgage_extra) || 0;

    const monthlyRate = rate / 100 / 12;
    const { adjustedBalance } = adjustBalanceFromStatement(balance, statementMonth, monthlyRate, pi);

    const standardSchedule = simulateAmortization({
      startingBalance: adjustedBalance,
      monthlyRate,
      monthlyPI: pi,
      extraPayment: 0,
    });

    const acceleratedSchedule = simulateAmortization({
      startingBalance: adjustedBalance,
      monthlyRate,
      monthlyPI: pi,
      extraPayment: extra,
    });

    const interestSaved = standardSchedule.totalInterest - acceleratedSchedule.totalInterest;
    const monthsSaved = standardSchedule.months - acceleratedSchedule.months;

    console.log('[Mortgage Analyzer] Amortization verification:', {
      inputs: {
        startingBalance: roundForLog(adjustedBalance),
        annualRate: roundForLog(rate, 6),
        monthlyRate: roundForLog(monthlyRate, 10),
        monthlyPI: roundForLog(pi),
        extraPayment: roundForLog(extra),
      },
      standardLoop: {
        totalMonths: standardSchedule.months,
        totalInterest: roundForLog(standardSchedule.totalInterest),
        month300Balance: roundForLog(standardSchedule.balanceAtMonth300 ?? standardSchedule.finalBalance),
        month1Interest: roundForLog(standardSchedule.firstMonth?.interest ?? 0),
        month1EndingBalance: roundForLog(standardSchedule.firstMonth?.endingBalance ?? adjustedBalance),
        first3Months: standardSchedule.preview,
        months: standardSchedule.months,
        payoffDate: standardSchedule.payoffDate.toISOString(),
      },
      acceleratedLoop: {
        totalMonths: acceleratedSchedule.months,
        totalInterest: roundForLog(acceleratedSchedule.totalInterest),
        month300Balance: roundForLog(acceleratedSchedule.balanceAtMonth300 ?? acceleratedSchedule.finalBalance),
        month1Interest: roundForLog(acceleratedSchedule.firstMonth?.interest ?? 0),
        month1EndingBalance: roundForLog(acceleratedSchedule.firstMonth?.endingBalance ?? adjustedBalance),
        month1BalanceAfterScheduledPayment: roundForLog(acceleratedSchedule.firstMonth?.balanceAfterScheduledPayment ?? adjustedBalance),
        month1ExtraPaid: roundForLog(acceleratedSchedule.firstMonth?.extraPaid ?? 0),
        first3Months: acceleratedSchedule.preview,
        months: acceleratedSchedule.months,
        payoffDate: acceleratedSchedule.payoffDate.toISOString(),
      },
      interestSaved: roundForLog(interestSaved),
      monthsSaved,
    });

    if (housingType === 'rent' || housingType === 'own_no_mortgage') {
      return (
        <div className="max-w-lg mx-auto pb-32">
          <div className="px-6 pt-12 safe-top flex items-center gap-3">
            <button onClick={onBack} className="p-1.5 -ml-1.5 rounded-lg hover:bg-muted">
              <ArrowLeft size={20} className="text-foreground" />
            </button>
            <h1 className="font-display text-xl font-bold text-foreground">Mortgage Analyzer</h1>
          </div>
          <div className="flex flex-col items-center justify-center px-6 pt-24 text-center">
            <Calculator size={40} className="text-muted-foreground/30 mb-4" />
            <p className="text-base font-semibold text-foreground">According to your Financial Profile, you don't currently have a mortgage.</p>
            {onNavigateToProfile && (
              <button onClick={() => onNavigateToProfile('housing')} className="text-sm font-semibold text-accent mt-4">
                Update your profile →
              </button>
            )}
            <p className="text-sm text-muted-foreground mt-6">
              Want to explore what a mortgage might look like?{' '}
              {onNavigateToCalculator ? (
                <button onClick={() => onNavigateToCalculator('mortgage-shopping')} className="text-accent font-semibold">
                  Try the Mortgage Calculator →
                </button>
              ) : (
                <span className="text-accent font-semibold">Try the Mortgage Calculator.</span>
              )}
            </p>
          </div>
        </div>
      );
    }

    // Empty state: incomplete housing data
    const missingFields = !statementMonth || balance <= 0 || rate <= 0 || payment <= 0;
    if (missingFields) {
      return (
        <div className="max-w-lg mx-auto pb-32">
          <div className="px-6 pt-12 safe-top flex items-center gap-3">
            <button onClick={onBack} className="p-1.5 -ml-1.5 rounded-lg hover:bg-muted">
              <ArrowLeft size={20} className="text-foreground" />
            </button>
            <h1 className="font-display text-xl font-bold text-foreground">Mortgage Analyzer</h1>
          </div>
          <div className="flex flex-col items-center justify-center px-6 pt-24 text-center">
            <AlertTriangle size={40} className="text-accent mb-4" />
            <p className="text-base font-semibold text-foreground">More information required to use this tool.</p>
            <p className="text-sm text-muted-foreground mt-2">Complete your housing details — statement month, current balance, interest rate, and monthly minimum payment.</p>
            {onNavigateToProfile && (
              <button
                onClick={() => onNavigateToProfile('housing')}
                className="mt-6 px-6 py-2.5 rounded-lg bg-accent text-accent-foreground text-sm font-semibold active:scale-95 transition-transform"
              >
                Complete Housing Information
              </button>
            )}
          </div>
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
            <h1 className="font-display text-xl font-bold text-foreground">Mortgage Analyzer</h1>
            <p className="text-sm text-muted-foreground mt-0.5">Understand your payoff timeline and equity position.</p>
          </div>
        </div>

        {/* Read-only profile data — condensed 2-column layout */}
        <div className="px-6 mt-5">
          <div className="bg-card rounded-xl p-4 shadow-sm border border-border space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-foreground">Mortgage Details</p>
              {onNavigateToProfile && (
                <button onClick={() => onNavigateToProfile('housing')} className="text-xs font-semibold text-accent">
                  From Financial Profile →
                </button>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <DetailCell label="Current Balance" value={fmt(balance)} />
              <DetailCell label="Interest Rate" value={rate > 0 ? `${rate}%` : '—'} />
              <DetailCell label="Loan Type" value={LOAN_TYPE_LABELS[loanType] || loanType} />
              <DetailCell label="Monthly Minimum Payment" value={payment > 0 ? fmt(payment) : '—'} />
              <DetailCell label="P&I" value={pi > 0 ? fmt(pi) : '—'} />
              <DetailCell label="Escrow" value={escrow > 0 ? fmt(escrow) : '—'} />
            </div>
            {(loanType === '5-1-arm' || loanType === '7-1-arm') && (
              <p className="text-[10px] text-muted-foreground leading-tight">
                Adjustable rate mortgage — projections assume your current rate remains fixed, which may not reflect actual future payments.
              </p>
            )}
            {originalLoan > 0 && (
              <div className="pt-1 border-t border-border">
                <DetailCell label="Original Loan Amount" value={fmt(originalLoan)} />
              </div>
            )}
          </div>
        </div>

        {/* Check if P&I and Escrow are entered */}
        {(pi <= 0 || escrow <= 0) ? (
          <div className="px-6 mt-5">
            <div className="bg-card rounded-xl p-6 shadow-sm border border-border text-center space-y-3">
              <p className="text-sm text-foreground font-medium">Enter your P&I and Escrow breakdown in your Financial Profile to unlock full analysis.</p>
              {onNavigateToProfile && (
                <button onClick={() => onNavigateToProfile('housing')} className="text-sm font-semibold text-accent">
                  Complete Housing Information →
                </button>
              )}
            </div>
          </div>
        ) : (
          <>
            {balance > 0 && payment > 0 && (
              <>
                {/* Mortgage Analysis — condensed 2-column */}
                <div className="px-6 mt-5">
                  <div className="bg-card rounded-xl p-4 shadow-sm border border-border space-y-3">
                    <div>
                      <p className="text-sm font-semibold text-foreground">Mortgage Analysis</p>
                      <p className="text-[11px] text-muted-foreground mt-0.5">Balance as of today: {fmt(adjustedBalance)}</p>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <DetailCell label="Projected Payoff" value={(extra > 0 ? acceleratedSchedule.payoffDate : standardSchedule.payoffDate).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })} />
                      <DetailCell label="Remaining Term" value={(() => { const m = extra > 0 ? acceleratedSchedule.months : standardSchedule.months; return `${Math.floor(m / 12)}y ${m % 12}m`; })()} />
                      <DetailCell label="Total Interest Remaining" value={fmt(extra > 0 ? acceleratedSchedule.totalInterest : standardSchedule.totalInterest)} />
                      {extra > 0 && interestSaved > 0 && (
                        <DetailCell label="Interest Saved" value={fmt(interestSaved)} />
                      )}
                    </div>
                    {extra > 0 && monthsSaved > 0 && (
                      <div className="bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 rounded-lg p-3">
                        <p className="text-sm font-semibold text-green-700 dark:text-green-300">
                          Paying {fmt(extra)}/mo extra saves {fmt(interestSaved)} in interest and pays off {Math.floor(monthsSaved / 12) > 0 ? `${Math.floor(monthsSaved / 12)} year${Math.floor(monthsSaved / 12) !== 1 ? 's' : ''} ` : ''}{monthsSaved % 12 > 0 ? `${monthsSaved % 12} month${monthsSaved % 12 !== 1 ? 's' : ''} ` : ''}earlier
                        </p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Equity Progress — requires home value */}
                {homeValue > 0 ? (
                  <div className="px-6 mt-5">
                    <div className="bg-card rounded-xl shadow-sm border border-border p-4">
                      <p className="text-sm font-semibold text-foreground mb-3">Equity Progress</p>
                      {(() => {
                        const equity = homeValue - adjustedBalance;
                        const equityPct = homeValue > 0 ? (equity / homeValue) * 100 : 0;
                        return (
                          <>
                            <div className="grid grid-cols-2 gap-3 mb-3">
                              <DetailCell label="Home Value" value={fmt(homeValue)} />
                              <DetailCell label="Current Balance" value={fmt(adjustedBalance)} />
                            </div>
                            <div className="flex justify-between items-baseline mb-2">
                              <span className="text-sm font-semibold text-foreground">{fmt(equity)} equity</span>
                              <span className="text-sm font-bold text-foreground">{equityPct.toFixed(1)}%</span>
                            </div>
                            <ProgressBar value={Math.max(0, equity)} max={homeValue} />
                          </>
                        );
                      })()}
                    </div>
                  </div>
                ) : (
                  <div className="px-6 mt-5">
                    <div className="bg-muted/50 rounded-xl p-4 text-center">
                      <p className="text-sm text-muted-foreground">Add your estimated home value in your Financial Profile to see equity progress.</p>
                      {onNavigateToProfile && (
                        <button onClick={() => onNavigateToProfile('housing')} className="text-sm font-semibold text-accent mt-2">
                          Update Housing Info →
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {/* Payoff Year Slider */}
                <PayoffYearSlider
                  adjustedBalance={adjustedBalance}
                  monthlyPI={pi}
                  monthlyRate={monthlyRate}
                  remainingMonths={standardSchedule.months}
                  totalInterestRemaining={standardSchedule.totalInterest}
                  payoffDate={standardSchedule.payoffDate}
                  state={state}
                  setState={setState}
                />

                {/* CFP Indicators */}
                {(() => {
                  const totalMonthly = payment;
                  const analyzerHousingRatio = grossMonthlyIncome > 0 ? totalMonthly / grossMonthlyIncome : 0;
                  const analyzerHousingOk = analyzerHousingRatio <= 0.28;
                  const debts = Array.isArray(financialProfile?.debts) ? financialProfile.debts as any[] : [];
                  const totalDebtPayments = debts.reduce((s: number, d: any) => s + (Number(d.monthlyPayment) || 0), 0);
                  const totalDti = grossMonthlyIncome > 0 ? (totalMonthly + totalDebtPayments) / grossMonthlyIncome : 0;
                  const dtiTone = totalDti <= 0.36
                    ? { card: 'bg-green-50 border-green-200 dark:bg-green-950/30 dark:border-green-800', text: 'text-green-600 dark:text-green-400' }
                    : totalDti <= 0.43
                      ? { card: 'bg-amber-50 border-amber-200 dark:bg-amber-950/30 dark:border-amber-800', text: 'text-amber-600 dark:text-amber-400' }
                      : { card: 'bg-red-50 border-red-200 dark:bg-red-950/30 dark:border-red-800', text: 'text-red-600 dark:text-red-400' };
                  return (
                    <div className="px-6 mt-5 space-y-3">
                      <p className="text-sm font-semibold text-foreground">CFP® Guideline Indicators</p>
                      <div className={`rounded-xl p-4 border ${analyzerHousingOk ? 'bg-green-50 border-green-200 dark:bg-green-950/30 dark:border-green-800' : 'bg-red-50 border-red-200 dark:bg-red-950/30 dark:border-red-800'}`}>
                        <div className="flex justify-between items-center">
                          <div>
                            <p className="text-sm font-semibold text-foreground">Housing Ratio</p>
                            <p className="text-xs text-muted-foreground mt-0.5">Total housing ÷ gross income (guideline: ≤ 28%)</p>
                          </div>
                          <span className={`text-lg font-bold ${analyzerHousingOk ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                            {hasProfile ? pct(analyzerHousingRatio) : '—'}
                          </span>
                        </div>
                      </div>
                      <div className={`rounded-xl p-4 border ${dtiTone.card}`}>
                        <div className="flex justify-between items-center">
                          <div>
                            <p className="text-sm font-semibold text-foreground">Total Debt-to-Income Ratio</p>
                            <p className="text-xs text-muted-foreground mt-0.5">(Housing + all debt) ÷ gross income (guideline: ≤ 36%)</p>
                          </div>
                          <span className={`text-lg font-bold ${dtiTone.text}`}>
                            {hasProfile ? pct(totalDti) : '—'}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })()}

                {/* AI Insights */}
                <MortgageInsightsSection
                  householdId={householdId}
                  homePrice={0}
                  loanAmount={adjustedBalance}
                  downPayment={0}
                  downPaymentPct={0}
                  interestRate={rate}
                  loanTermYears={30}
                  monthlyPI={pi}
                  monthlyTax={escrow}
                  monthlyInsurance={0}
                  totalHousing={payment}
                  housingRatio={grossMonthlyIncome > 0 ? payment / grossMonthlyIncome : 0}
                  dtiRatio={0}
                  otherDebt={0}
                  selectedState={state.selectedState}
                  financialProfile={financialProfile}
                  mortgageMode={'existing'}
                />
              </>
            )}
          </>
        )}
      </div>
    );
  }

  // ═══════════════════════════════════════════
  // SHOPPING MODE (Calculators)
  // ═══════════════════════════════════════════
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
            <div className="flex items-baseline justify-between">
              <p className="text-xs text-muted-foreground">Gross Monthly Income</p>
              {onNavigateToProfile && (
                <button onClick={() => onNavigateToProfile('income')} className="text-[11px] font-semibold text-accent">
                  From Financial Profile →
                </button>
              )}
            </div>
            <p className="text-lg font-bold text-foreground mt-0.5">{fmt(grossMonthlyIncome)}</p>
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
        <Label className="text-xs text-muted-foreground">State</Label>
        <Select value={state.selectedState} onValueChange={handleStateChange}>
          <SelectTrigger className="mt-1"><SelectValue placeholder="Select state…" /></SelectTrigger>
          <SelectContent className="max-h-60">
            {STATE_OPTIONS.map(s => (
              <SelectItem key={s.code} value={s.code}>{s.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Shopping Inputs */}
      <div className="px-6 mt-4 space-y-4">
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

        <RateField
          label="Property Tax"
          mode={state.propertyTaxMode as 'percent' | 'dollar'}
          rateValue={state.propertyTaxRate}
          dollarValue={state.propertyTaxAmt}
          homePrice={parseFloat(state.homePrice) || 0}
          onModeChange={m => setState({ propertyTaxMode: m })}
          onRateChange={v => setState({ propertyTaxRate: v, propertyTaxAmt: String(((parseFloat(v) || 0) / 100 * (parseFloat(state.homePrice) || 0) / 12).toFixed(0)) })}
          onDollarChange={v => {
            const price = parseFloat(state.homePrice) || 1;
            setState({ propertyTaxAmt: v, propertyTaxRate: String(((parseFloat(v) || 0) * 12 / price * 100).toFixed(2)) });
          }}
          estimateLoading={taxEstLoading}
          onEstimate={() => fetchAiEstimate('tax')}
          caption={taxEstCaption}
          hasState={!!state.selectedState}
        />

        <RateField
          label="Insurance"
          mode={state.insuranceMode as 'percent' | 'dollar'}
          rateValue={state.insuranceRate}
          dollarValue={state.insuranceAmt}
          homePrice={parseFloat(state.homePrice) || 0}
          onModeChange={m => setState({ insuranceMode: m })}
          onRateChange={v => setState({ insuranceRate: v, insuranceAmt: String(((parseFloat(v) || 0) / 100 * (parseFloat(state.homePrice) || 0) / 12).toFixed(0)) })}
          onDollarChange={v => {
            const price = parseFloat(state.homePrice) || 1;
            setState({ insuranceAmt: v, insuranceRate: String(((parseFloat(v) || 0) * 12 / price * 100).toFixed(2)) });
          }}
          estimateLoading={insEstLoading}
          onEstimate={() => fetchAiEstimate('insurance')}
          caption={insEstCaption}
          hasState={!!state.selectedState}
        />
      </div>

      {/* Shopping Results */}
      <div className="px-6 mt-6">
        <div className="bg-card rounded-xl shadow-sm border border-border overflow-hidden">
          <div className="p-4 border-b border-border">
            <p className="text-xs text-muted-foreground font-medium tracking-wide">Monthly Payment Breakdown</p>
          </div>
          <div className="divide-y divide-border">
            <Row label="Loan Amount" value={fmt(shoppingCalc.loanAmount)} />
            <Row label="Principal & Interest" value={fmt(shoppingCalc.monthlyPI)} />
            <Row label="Property Tax" value={fmt(shoppingCalc.monthlyTax)} sub={state.propertyTaxMode === 'percent' ? `${state.propertyTaxRate}% of home value/yr` : `${fmt(shoppingCalc.monthlyTax * 12)}/yr`} />
            <Row label="Insurance" value={fmt(shoppingCalc.monthlyInsurance)} sub={state.insuranceMode === 'percent' ? `${state.insuranceRate}% of home value/yr` : `${fmt(shoppingCalc.monthlyInsurance * 12)}/yr`} />
            <div className="flex justify-between items-center p-4 bg-primary/5">
              <p className="text-sm font-bold text-foreground">Total Monthly Housing</p>
              <p className="text-sm font-bold text-foreground">{fmt(shoppingCalc.totalHousing)}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Shopping Extra Payment */}
      <ExtraPaymentSection
        extraPayment={state.extraPayment}
        onExtraPaymentChange={v => setState({ extraPayment: v })}
        standardMonths={shoppingCalc.numPayments}
        totalInterestStandard={shoppingCalc.totalInterestStandard}
        monthsWithExtra={shoppingCalc.monthsWithExtra}
        totalInterestExtra={shoppingCalc.totalInterestExtra}
        interestSaved={shoppingCalc.interestSaved}
        monthsSaved={shoppingCalc.monthsSaved}
      />

      {/* CFP Indicators */}
      <div className="px-6 mt-5 space-y-3">
        <p className="text-xs text-muted-foreground font-medium tracking-wide">Certified Financial Planner (CFP) Guideline Indicators</p>

        <div className={`rounded-xl p-4 border ${housingOk ? 'bg-green-50 border-green-200 dark:bg-green-950/30 dark:border-green-800' : 'bg-red-50 border-red-200 dark:bg-red-950/30 dark:border-red-800'}`}>
          <div className="flex justify-between items-center">
            <div>
              <p className="text-sm font-semibold text-foreground">Housing Ratio</p>
              <p className="text-xs text-muted-foreground mt-0.5">Total housing ÷ gross income (guideline: ≤ 28%)</p>
            </div>
            <span className={`text-lg font-bold ${housingOk ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
              {hasProfile ? pct(shoppingCalc.housingRatio) : '—'}
            </span>
          </div>
        </div>

        <div className={`rounded-xl p-4 border ${dtiOk ? 'bg-green-50 border-green-200 dark:bg-green-950/30 dark:border-green-800' : 'bg-red-50 border-red-200 dark:bg-red-950/30 dark:border-red-800'}`}>
          <div className="flex justify-between items-start">
            <div className="flex-1">
              <p className="text-sm font-semibold text-foreground">Debt-to-Income Ratio</p>
              <p className="text-xs text-muted-foreground mt-0.5">(Housing + other debt) ÷ gross income (guideline: ≤ 36%)</p>
              <div className="mt-2">
                <div className="flex items-baseline justify-between max-w-[260px]">
                  <Label className="text-xs text-muted-foreground">Other Monthly Debt Payments</Label>
                  {onNavigateToProfile && (
                    <button onClick={() => onNavigateToProfile('debts')} className="text-[11px] font-semibold text-accent">
                      From Financial Profile →
                    </button>
                  )}
                </div>
                <div className="mt-1 max-w-[180px] h-8 px-3 flex items-center rounded-md border border-input bg-muted text-sm font-semibold text-foreground tabular-nums">
                  {fmt(parseFloat(state.otherDebtPayments) || 0)}
                </div>
                <p className="text-[10px] text-muted-foreground mt-1">Total non-housing debt payments from your Debts tab.</p>
              </div>
            </div>
            <span className={`text-lg font-bold ${dtiOk ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
              {hasProfile ? pct(shoppingCalc.dtiRatio) : '—'}
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
                ? 'This home fits comfortably within standard financial planning guidelines.'
                : 'Consider a lower price, larger down payment, or paying down existing debt.'}
          </p>
        </div>
      </div>

      {/* AI Insights */}
      <MortgageInsightsSection
        householdId={householdId}
        homePrice={parseFloat(state.homePrice) || 0}
        loanAmount={shoppingCalc.loanAmount}
        downPayment={shoppingCalc.dp}
        downPaymentPct={shoppingCalc.dpPct}
        interestRate={parseFloat(state.interestRate) || 0}
        loanTermYears={parseInt(state.loanTermYears) || 30}
        monthlyPI={shoppingCalc.monthlyPI}
        monthlyTax={shoppingCalc.monthlyTax}
        monthlyInsurance={shoppingCalc.monthlyInsurance}
        totalHousing={shoppingCalc.totalHousing}
        housingRatio={shoppingCalc.housingRatio}
        dtiRatio={shoppingCalc.dtiRatio}
        otherDebt={shoppingCalc.otherDebt}
        selectedState={state.selectedState}
        financialProfile={financialProfile}
        mortgageMode={'shopping'}
      />
    </div>
  );
}

/* ── Sub-components ────────────────────────────── */

function DetailCell({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] text-muted-foreground tracking-wide">{label}</p>
      <p className="text-sm font-semibold text-foreground mt-0.5">{value}</p>
    </div>
  );
}


function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between items-center py-2">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="text-sm font-semibold text-foreground">{value}</p>
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
                <p className="text-[10px] font-semibold text-muted-foreground tracking-wide mb-2">Standard</p>
                <div className="space-y-1.5">
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">Term</span>
                    <span className="font-medium text-foreground">{Math.floor(standardMonths / 12)}y {standardMonths % 12}m</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">Total Interest</span>
                    <span className="font-medium text-foreground">{fmt(totalInterestStandard)}</span>
                  </div>
                </div>
              </div>

              <div className={`bg-card rounded-lg shadow-sm p-3 border ${extra > 0 ? 'border-green-300 dark:border-green-700' : 'border-border'}`}>
                <p className="text-[10px] font-semibold text-muted-foreground tracking-wide mb-2">With Extra</p>
                <div className="space-y-1.5">
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">Term</span>
                    <span className="font-medium text-foreground">{Math.floor(monthsWithExtra / 12)}y {monthsWithExtra % 12}m</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">Total Interest</span>
                    <span className="font-medium text-foreground">{fmt(totalInterestExtra)}</span>
                  </div>
                </div>
              </div>
            </div>

            {extra > 0 && interestSaved > 0 && (
              <div className="bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 rounded-lg p-3">
                <p className="text-sm font-semibold text-green-700 dark:text-green-300">
                  Paying an extra {fmt(extra)}/mo saves {fmt(interestSaved)} in interest and pays off your mortgage {Math.floor(monthsSaved / 12) > 0 ? `${Math.floor(monthsSaved / 12)} year${Math.floor(monthsSaved / 12) !== 1 ? 's' : ''} ` : ''}{monthsSaved % 12 > 0 ? `${monthsSaved % 12} month${monthsSaved % 12 !== 1 ? 's' : ''} ` : ''}early.
                </p>
              </div>
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

function RateField({
  label, mode, rateValue, dollarValue, homePrice,
  onModeChange, onRateChange, onDollarChange,
  estimateLoading, onEstimate, caption, hasState,
}: {
  label: string;
  mode: 'percent' | 'dollar';
  rateValue: string;
  dollarValue: string;
  homePrice: number;
  onModeChange: (m: 'percent' | 'dollar') => void;
  onRateChange: (v: string) => void;
  onDollarChange: (v: string) => void;
  estimateLoading: boolean;
  onEstimate: () => void;
  caption: string;
  hasState: boolean;
}) {
  return (
    <div>
      <div className="flex items-center gap-2">
        <Label className="text-xs text-muted-foreground flex-1">{label} ({mode === 'percent' ? '%/yr' : '$/mo'})</Label>
        {hasState && (
          <button
            onClick={onEstimate}
            disabled={estimateLoading}
            className="flex items-center gap-1 text-[10px] font-semibold text-accent bg-accent/10 hover:bg-accent/20 rounded px-2 py-0.5 disabled:opacity-50 transition-colors"
          >
            {estimateLoading ? <Loader2 size={10} className="animate-spin" /> : <Sparkles size={10} />}
            Estimate
          </button>
        )}
      </div>
      <div className="flex gap-2 mt-1">
        <Input
          type="number"
          step={mode === 'percent' ? '0.01' : '1'}
          value={mode === 'percent' ? rateValue : dollarValue}
          onChange={e => mode === 'percent' ? onRateChange(e.target.value) : onDollarChange(e.target.value)}
          className="flex-1"
        />
        <Select value={mode} onValueChange={(v: 'percent' | 'dollar') => onModeChange(v)}>
          <SelectTrigger className="w-16"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="percent">%</SelectItem>
            <SelectItem value="dollar">$</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {caption && <p className="text-[10px] text-muted-foreground mt-1 leading-snug">{caption}</p>}
    </div>
  );
}
