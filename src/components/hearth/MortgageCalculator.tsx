import { useState, useMemo, useEffect, useCallback } from 'react';
import { ArrowLeft, Sparkles, Loader2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { useToolState } from '@/hooks/useToolState';
import { STATE_DEFAULTS, STATE_OPTIONS } from '@/data/stateDefaults';
import { MortgageInsightsSection } from './MortgageInsightsSection';

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
  const [taxEstCaption, setTaxEstCaption] = useState('');
  const [insEstCaption, setInsEstCaption] = useState('');
  const [taxEstLoading, setTaxEstLoading] = useState(false);
  const [insEstLoading, setInsEstLoading] = useState(false);

  const { state, setState, loaded: toolStateLoaded } = useToolState(householdId, 'mortgage-calculator', {
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

  // Auto-populate state from profile and debt payments
  useEffect(() => {
    if (!financialProfile || !toolStateLoaded) return;
    if (state.otherDebtPayments === '') {
      const debts = Array.isArray(financialProfile.debts) ? financialProfile.debts as any[] : [];
      const total = debts.reduce((s: number, d: any) => s + (Number(d.monthlyPayment) || 0), 0);
      if (total > 0) setState({ otherDebtPayments: String(total) });
    }
    if (state.selectedState === '' && financialProfile.state) {
      const st = financialProfile.state.toUpperCase();
      if (STATE_DEFAULTS[st]) {
        setState({
          selectedState: st,
          propertyTaxRate: String(STATE_DEFAULTS[st].tax),
          insuranceRate: String(STATE_DEFAULTS[st].insurance),
        });
      }
    }
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

    return { loanAmount, dp, dpPct, monthlyPI, monthlyTax, monthlyInsurance, totalHousing, housingRatio, dtiRatio, otherDebt };
  }, [state, grossMonthlyIncome]);

  const fetchAiEstimate = useCallback(async (field: 'tax' | 'insurance') => {
    const setLoading = field === 'tax' ? setTaxEstLoading : setInsEstLoading;
    const setCaption = field === 'tax' ? setTaxEstCaption : setInsEstCaption;
    setLoading(true);
    setCaption('');
    try {
      const prompt = field === 'tax'
        ? `For a home in ${STATE_DEFAULTS[state.selectedState]?.label || state.selectedState}, valued at $${state.homePrice}, what is a realistic effective property tax rate? Return JSON: {"rate": <number as percent like 0.57>, "explanation": "<one sentence>"}`
        : `For a home in ${STATE_DEFAULTS[state.selectedState]?.label || state.selectedState}, valued at $${state.homePrice} with a $${calc.loanAmount} loan, what is a realistic annual homeowners insurance rate? Return JSON: {"rate": <number as percent like 0.75>, "explanation": "<one sentence>"}`;

      const { data, error } = await supabase.functions.invoke('budget-insights', {
        body: {
          budgetSummary: { context: 'rate_estimate', state: state.selectedState, homePrice: state.homePrice, loanAmount: calc.loanAmount },
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
  }, [state.selectedState, state.homePrice, calc.loanAmount, setState]);

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

      {/* Inputs */}
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

        {/* Property Tax with %/$ toggle and AI Estimate */}
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

        {/* Insurance with %/$ toggle and AI Estimate */}
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

      {/* Results */}
      <div className="px-6 mt-6">
        <div className="bg-card rounded-xl shadow-sm border border-border overflow-hidden">
          <div className="p-4 border-b border-border">
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Monthly Payment Breakdown</p>
          </div>
          <div className="divide-y divide-border">
            <Row label="Loan Amount" value={fmt(calc.loanAmount)} />
            <Row label="Principal & Interest" value={fmt(calc.monthlyPI)} />
            <Row label="Property Tax" value={fmt(calc.monthlyTax)} sub={state.propertyTaxMode === 'percent' ? `${state.propertyTaxRate}% of home value/yr` : `${fmt(calc.monthlyTax * 12)}/yr`} />
            <Row label="Insurance" value={fmt(calc.monthlyInsurance)} sub={state.insuranceMode === 'percent' ? `${state.insuranceRate}% of home value/yr` : `${fmt(calc.monthlyInsurance * 12)}/yr`} />
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

      {/* AI Insights */}
      <MortgageInsightsSection
        householdId={householdId}
        homePrice={parseFloat(state.homePrice) || 0}
        loanAmount={calc.loanAmount}
        downPayment={calc.dp}
        downPaymentPct={calc.dpPct}
        interestRate={parseFloat(state.interestRate) || 0}
        loanTermYears={parseInt(state.loanTermYears) || 30}
        monthlyPI={calc.monthlyPI}
        monthlyTax={calc.monthlyTax}
        monthlyInsurance={calc.monthlyInsurance}
        totalHousing={calc.totalHousing}
        housingRatio={calc.housingRatio}
        dtiRatio={calc.dtiRatio}
        otherDebt={calc.otherDebt}
        selectedState={state.selectedState}
        financialProfile={financialProfile}
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
