import { useState, useMemo, useEffect } from 'react';
import { ArrowLeft, ChevronDown, ChevronUp } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { supabase } from '@/integrations/supabase/client';
import { useToolState } from '@/hooks/useToolState';
import { RetirementInsightsSection } from './RetirementInsightsSection';

function fmt(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);
}
function fmtDec(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(n);
}
function pct(n: number, decimals = 1) {
  return (n * 100).toFixed(decimals) + '%';
}

interface RetirementPlannerProps {
  onBack: () => void;
  householdId: string | null;
}

export function RetirementPlanner({ onBack, householdId }: RetirementPlannerProps) {
  const [financialProfile, setFinancialProfile] = useState<any>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [taxWithholdingState, setTaxWithholdingState] = useState<any>(null);

  const { state, setState, loaded: toolStateLoaded } = useToolState(householdId, 'retirement-planner', {
    retirementAge: '65',
    expectedReturn: '7',
    inflationRate: '3',
    monthlyExpenses: '',
    monthlyContributions: '',
    showAdvanced: false,
    showSocialSecurity: false,
    memberAges: {} as Record<string, string>,
    ssBenefits: {} as Record<string, string>,
    ssClaimingAges: {} as Record<string, string>,
  });

  // Load financial profile and tax withholding state in parallel
  useEffect(() => {
    if (!householdId) { setProfileLoading(false); return; }
    Promise.all([
      supabase.from('financial_profiles').select('*').eq('household_id', householdId).maybeSingle(),
      supabase.from('tool_states' as any).select('state_json').eq('household_id', householdId).eq('tool_name', 'tax-withholding').maybeSingle(),
    ]).then(([profileRes, taxRes]) => {
      if (profileRes.data) setFinancialProfile(profileRes.data);
      if ((taxRes.data as any)?.state_json) setTaxWithholdingState((taxRes.data as any).state_json);
      setProfileLoading(false);
    });
  }, [householdId]);

  // Members from profile
  const members: { name: string; gross_income: number; age?: number }[] = useMemo(() => {
    if (!financialProfile?.member_incomes) return [];
    const raw = financialProfile.member_incomes as any[];
    return raw.filter((m: any) => m.name).map((m: any) => ({
      name: m.name,
      gross_income: Number(m.gross_income) || 0,
      age: m.age ? Number(m.age) : undefined,
    }));
  }, [financialProfile]);

  // Auto-populate ages from profile on first load
  const [initialized, setInitialized] = useState(false);
  useEffect(() => {
    if (!toolStateLoaded || !financialProfile || initialized) return;
    const updates: any = {};

    // Pre-populate ages from profile if not set
    if (members.length > 0) {
      const ages: Record<string, string> = { ...state.memberAges };
      let changed = false;
      members.forEach(m => {
        if (!ages[m.name] && m.age) {
          ages[m.name] = String(m.age);
          changed = true;
        }
      });
      if (changed) updates.memberAges = ages;
    }

    // Pre-populate monthly contributions from tax withholding if available
    if (!state.monthlyContributions && taxWithholdingState?.retirementDeduction) {
      const perPaycheck = Number(taxWithholdingState.retirementDeduction) || 0;
      const freq = taxWithholdingState.payFrequency || 'biweekly';
      const periods: Record<string, number> = { weekly: 52, biweekly: 26, semimonthly: 24, monthly: 12 };
      const annual = perPaycheck * (periods[freq] || 26);
      updates.monthlyContributions = String(Math.round(annual / 12));
    }

    // Default SS claiming ages
    if (members.length > 0 && Object.keys(state.ssClaimingAges).length === 0) {
      const claimingAges: Record<string, string> = {};
      members.forEach(m => { claimingAges[m.name] = '67'; });
      updates.ssClaimingAges = claimingAges;
    }

    if (Object.keys(updates).length) setState(updates);
    setInitialized(true);
  }, [toolStateLoaded, financialProfile, members, initialized, taxWithholdingState]);

  // Parsed values
  const retirementAge = Number(state.retirementAge) || 65;
  const expectedReturn = (Number(state.expectedReturn) || 7) / 100;
  const inflationRate = (Number(state.inflationRate) || 3) / 100;
  const realReturn = expectedReturn - inflationRate;
  const monthlyContributions = Number(state.monthlyContributions) || 0;
  const monthlyExpenses = Number(state.monthlyExpenses) || 0;

  const currentPreTax = Number(financialProfile?.retirement_balance) || 0;
  const currentRoth = Number(financialProfile?.roth_retirement_balance) || 0;
  const currentTotal = currentPreTax + currentRoth;

  // Use the youngest member's age as the planning age (conservative)
  const currentAge = useMemo(() => {
    const ages = members.map(m => Number(state.memberAges?.[m.name]) || 0).filter(a => a > 0);
    return ages.length > 0 ? Math.min(...ages) : 0;
  }, [members, state.memberAges]);

  const yearsToRetirement = Math.max(0, retirementAge - currentAge);
  const monthsToRetirement = yearsToRetirement * 12;

  // Combined gross income
  const combinedGrossIncome = members.reduce((s, m) => s + m.gross_income, 0);
  const annualContributions = monthlyContributions * 12;

  // Future value calculation
  const monthlyReturn = expectedReturn / 12;
  const fvBalance = currentTotal * Math.pow(1 + monthlyReturn, monthsToRetirement);
  const fvContributions = monthlyContributions > 0 && monthlyReturn > 0
    ? monthlyContributions * ((Math.pow(1 + monthlyReturn, monthsToRetirement) - 1) / monthlyReturn)
    : monthlyContributions * monthsToRetirement;
  const projectedPortfolio = fvBalance + fvContributions;

  // Roth/PreTax projected split (proportional to current)
  const rothRatio = currentTotal > 0 ? currentRoth / currentTotal : 0.5;
  const projectedRoth = projectedPortfolio * rothRatio;
  const projectedPreTax = projectedPortfolio * (1 - rothRatio);

  // Monthly income from portfolio (4% rule)
  const annualWithdrawal = projectedPortfolio * 0.04;
  const monthlyFromPortfolio = annualWithdrawal / 12;

  // Social Security
  const showSS = state.showSocialSecurity;
  const totalSSBenefit = useMemo(() => {
    if (!showSS) return 0;
    return members.reduce((sum, m) => {
      const benefit = Number(state.ssBenefits?.[m.name]) || 0;
      const claimAge = Number(state.ssClaimingAges?.[m.name]) || 67;
      // Simple adjustment: -6.67% per year before 67, +8% per year after 67 (up to 70)
      let adjustment = 1;
      if (claimAge < 67) adjustment = 1 - (67 - claimAge) * 0.0667;
      else if (claimAge > 67) adjustment = 1 + Math.min(claimAge - 67, 3) * 0.08;
      return sum + benefit * adjustment;
    }, 0);
  }, [showSS, members, state.ssBenefits, state.ssClaimingAges]);

  const totalMonthlyIncome = monthlyFromPortfolio + totalSSBenefit;
  const monthlyGap = totalMonthlyIncome - monthlyExpenses;

  // If gap exists, calculate additional savings needed
  const additionalMonthlyNeeded = useMemo(() => {
    if (monthlyGap >= 0 || monthsToRetirement <= 0) return 0;
    const annualShortfall = Math.abs(monthlyGap) * 12;
    const lumpSumNeeded = annualShortfall / 0.04;
    const portfolioGap = lumpSumNeeded - projectedPortfolio;
    if (portfolioGap <= 0) return 0;
    if (monthlyReturn <= 0) return portfolioGap / monthsToRetirement;
    return portfolioGap / ((Math.pow(1 + monthlyReturn, monthsToRetirement) - 1) / monthlyReturn);
  }, [monthlyGap, monthsToRetirement, monthlyReturn, projectedPortfolio]);

  const lumpSumNeeded = useMemo(() => {
    if (monthlyGap >= 0) return 0;
    const annualShortfall = Math.abs(monthlyGap) * 12;
    return annualShortfall / 0.04;
  }, [monthlyGap]);

  // CFP Guidelines
  const savingsRate = combinedGrossIncome > 0 ? annualContributions / combinedGrossIncome : 0;
  const savingsRateOk = savingsRate >= 0.15;

  const finalSalary = combinedGrossIncome * Math.pow(1 + inflationRate, yearsToRetirement);
  const salaryMultiple = finalSalary > 0 ? projectedPortfolio / finalSalary : 0;
  const onTrackFor10x = salaryMultiple >= 10;

  const rothPct = currentTotal > 0 ? currentRoth / currentTotal : 0;
  const rothSkewed = rothPct < 0.2 || rothPct > 0.8;

  const impliedWithdrawalRate = projectedPortfolio > 0 ? (monthlyExpenses * 12) / projectedPortfolio : 0;
  const withdrawalRateSafe = impliedWithdrawalRate <= 0.04;

  // Retirement picture payload for AI
  const retirementPicture = useMemo(() => ({
    members: members.map(m => ({
      name: m.name,
      age: Number(state.memberAges?.[m.name]) || 0,
      gross_income: m.gross_income,
    })),
    retirementAge,
    yearsToRetirement,
    currentPreTax,
    currentRoth,
    currentTotal,
    monthlyContributions,
    annualContributions,
    expectedReturn,
    inflationRate,
    projectedPortfolio,
    projectedPreTax,
    projectedRoth,
    monthlyFromPortfolio,
    socialSecurityEnabled: showSS,
    totalSSBenefit,
    totalMonthlyIncome,
    monthlyExpenses,
    monthlyGap,
    savingsRate,
    salaryMultiple,
    rothPct,
    impliedWithdrawalRate,
    additionalMonthlyNeeded,
  }), [members, state.memberAges, retirementAge, yearsToRetirement, currentPreTax, currentRoth, currentTotal,
    monthlyContributions, annualContributions, expectedReturn, inflationRate, projectedPortfolio,
    projectedPreTax, projectedRoth, monthlyFromPortfolio, showSS, totalSSBenefit,
    totalMonthlyIncome, monthlyExpenses, monthlyGap, savingsRate, salaryMultiple, rothPct, impliedWithdrawalRate, additionalMonthlyNeeded]);

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
          <h1 className="font-display text-xl font-bold text-foreground">Retirement Planner</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Are you on track to retire?</p>
        </div>
      </div>

      {/* Inputs */}
      <div className="px-6 mt-4 space-y-3">
        {/* Member ages */}
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Current Ages</p>
          <div className={`grid gap-3 ${members.length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}>
            {members.map(m => (
              <div key={m.name}>
                <Label className="text-xs text-muted-foreground">{members.length > 1 ? m.name : 'Your Age'}</Label>
                <Input
                  type="number"
                  className="mt-1"
                  value={state.memberAges?.[m.name] || ''}
                  onChange={e => setState({ memberAges: { ...state.memberAges, [m.name]: e.target.value } })}
                  placeholder="e.g. 35"
                />
              </div>
            ))}
          </div>
        </div>

        <div>
          <Label className="text-xs text-muted-foreground">Target Retirement Age</Label>
          <Input
            type="number"
            className="mt-1"
            value={state.retirementAge}
            onChange={e => setState({ retirementAge: e.target.value })}
          />
        </div>

        {/* Current Balances (read-only from profile) */}
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Current Retirement Balances</p>
          <div className="bg-card rounded-xl shadow-sm p-3 space-y-1.5">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Pre-Tax (401k/IRA)</span>
              <span className="font-semibold text-foreground">{fmt(currentPreTax)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Roth</span>
              <span className="font-semibold text-foreground">{fmt(currentRoth)}</span>
            </div>
            <div className="flex justify-between text-sm border-t border-border pt-1.5">
              <span className="text-muted-foreground font-semibold">Combined</span>
              <span className="font-bold text-foreground">{fmt(currentTotal)}</span>
            </div>
          </div>
          <p className="text-[10px] text-muted-foreground mt-1">From your Financial Profile</p>
        </div>

        <div>
          <Label className="text-xs text-muted-foreground">Combined Monthly Retirement Contributions</Label>
          <div className="relative mt-1">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
            <Input
              type="number"
              className="pl-7"
              value={state.monthlyContributions}
              onChange={e => setState({ monthlyContributions: e.target.value })}
              placeholder="0"
            />
          </div>
          {taxWithholdingState?.retirementDeduction && (
            <p className="text-[10px] text-muted-foreground mt-1">Pre-populated from Tax Withholding tool</p>
          )}
        </div>

        <div>
          <Label className="text-xs text-muted-foreground">Expected Annual Return: {state.expectedReturn}%</Label>
          <Slider
            value={[Number(state.expectedReturn) || 7]}
            onValueChange={([v]) => setState({ expectedReturn: String(v) })}
            min={1}
            max={12}
            step={0.5}
            className="mt-2"
          />
        </div>

        <div>
          <Label className="text-xs text-muted-foreground">Estimated Monthly Retirement Expenses</Label>
          <div className="relative mt-1">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
            <Input
              type="number"
              className="pl-7"
              value={state.monthlyExpenses}
              onChange={e => setState({ monthlyExpenses: e.target.value })}
              placeholder="0"
            />
          </div>
        </div>

        {/* Advanced */}
        <Collapsible open={state.showAdvanced} onOpenChange={v => setState({ showAdvanced: v })}>
          <CollapsibleTrigger className="flex items-center gap-1 text-xs text-accent font-medium">
            {state.showAdvanced ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            Advanced Settings
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-2 space-y-3">
            <div>
              <Label className="text-xs text-muted-foreground">Inflation Rate: {state.inflationRate}%</Label>
              <Slider
                value={[Number(state.inflationRate) || 3]}
                onValueChange={([v]) => setState({ inflationRate: String(v) })}
                min={1}
                max={6}
                step={0.5}
                className="mt-2"
              />
            </div>
          </CollapsibleContent>
        </Collapsible>

        {/* Social Security */}
        <div>
          <div className="flex items-center justify-between">
            <Label className="text-xs text-muted-foreground">Social Security</Label>
            <div className="flex bg-muted rounded-full p-0.5">
              <button
                onClick={() => setState({ showSocialSecurity: false })}
                className={`text-xs font-medium px-3 py-1 rounded-full transition-colors ${
                  !state.showSocialSecurity ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground'
                }`}
              >Off</button>
              <button
                onClick={() => setState({ showSocialSecurity: true })}
                className={`text-xs font-medium px-3 py-1 rounded-full transition-colors ${
                  state.showSocialSecurity ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground'
                }`}
              >On</button>
            </div>
          </div>

          {state.showSocialSecurity && (
            <div className="mt-3 space-y-3">
              {members.map(m => (
                <div key={m.name} className="bg-card rounded-xl shadow-sm p-3 space-y-2">
                  {members.length > 1 && (
                    <p className="text-xs font-semibold text-foreground">{m.name}</p>
                  )}
                  <div>
                    <Label className="text-[11px] text-muted-foreground">Estimated Monthly SS Benefit</Label>
                    <div className="relative mt-1">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
                      <Input
                        type="number"
                        className="pl-7"
                        value={state.ssBenefits?.[m.name] || ''}
                        onChange={e => setState({ ssBenefits: { ...state.ssBenefits, [m.name]: e.target.value } })}
                        placeholder="0"
                      />
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      Find your estimate at <span className="text-accent">ssa.gov/myaccount</span>
                    </p>
                  </div>
                  <div>
                    <Label className="text-[11px] text-muted-foreground">Claiming Age</Label>
                    <Input
                      type="number"
                      className="mt-1"
                      value={state.ssClaimingAges?.[m.name] || '67'}
                      onChange={e => setState({ ssClaimingAges: { ...state.ssClaimingAges, [m.name]: e.target.value } })}
                    />
                    {(() => {
                      const ca = Number(state.ssClaimingAges?.[m.name]) || 67;
                      if (ca < 67) return <p className="text-[10px] text-yellow-600 mt-0.5">Claiming early reduces your benefit by ~6.7% per year before age 67</p>;
                      if (ca > 67) return <p className="text-[10px] text-green-600 mt-0.5">Delaying adds ~8% per year after 67 (up to age 70)</p>;
                      return null;
                    })()}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Output Section */}
      {currentAge > 0 && (
        <div className="px-6 mt-6">
          <h2 className="font-display text-base font-bold text-foreground mb-3">Your Retirement Picture</h2>

          {/* Timeline bar */}
          <div className="bg-card rounded-xl shadow-sm p-4 mb-3">
            <div className="flex items-center justify-between text-[10px] text-muted-foreground mb-1">
              <span>Today ({currentAge})</span>
              <span>Retire ({retirementAge})</span>
              <span>Age 90</span>
            </div>
            <div className="relative h-3 bg-muted rounded-full overflow-hidden">
              {(() => {
                const totalSpan = 90 - currentAge;
                const retirePct = totalSpan > 0 ? (yearsToRetirement / totalSpan) * 100 : 50;
                return (
                  <>
                    <div className="absolute inset-y-0 left-0 bg-primary/30 rounded-full" style={{ width: `${retirePct}%` }} />
                    <div className="absolute inset-y-0 rounded-full bg-accent/40" style={{ left: `${retirePct}%`, right: '0%' }} />
                    <div className="absolute top-0 bottom-0 w-0.5 bg-primary" style={{ left: `${retirePct}%` }} />
                  </>
                );
              })()}
            </div>
            <p className="text-xs text-muted-foreground text-center mt-1.5">
              <span className="font-semibold text-foreground">{yearsToRetirement}</span> years to retirement
            </p>
          </div>

          {/* Projections */}
          <div className="bg-card rounded-xl shadow-sm p-4 mb-3">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Projected Portfolio at Retirement</p>
            <div className="space-y-1.5">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Pre-Tax (401k/IRA)</span>
                <span className="font-semibold text-foreground">{fmt(projectedPreTax)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Roth</span>
                <span className="font-semibold text-foreground">{fmt(projectedRoth)}</span>
              </div>
              <div className="flex justify-between text-sm border-t border-border pt-1.5">
                <span className="text-muted-foreground font-semibold">Total Projected</span>
                <span className="font-bold text-foreground">{fmt(projectedPortfolio)}</span>
              </div>
            </div>
          </div>

          {/* Monthly Income */}
          <div className="bg-card rounded-xl shadow-sm p-4 mb-3">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Projected Monthly Retirement Income</p>
            <div className="space-y-1.5">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Portfolio (4% rule)</span>
                <span className="font-semibold text-foreground">{fmt(monthlyFromPortfolio)}</span>
              </div>
              {showSS && (
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Social Security</span>
                  <span className="font-semibold text-foreground">{fmt(totalSSBenefit)}</span>
                </div>
              )}
              <div className="flex justify-between text-sm border-t border-border pt-1.5">
                <span className="text-muted-foreground font-semibold">Total Monthly Income</span>
                <span className="font-bold text-foreground">{fmt(totalMonthlyIncome)}</span>
              </div>
            </div>
          </div>

          {/* Gap / Surplus */}
          {monthlyExpenses > 0 && (
            <div className="bg-card rounded-xl shadow-sm p-4 mb-3">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Retirement Income vs. Expenses</p>
              <div className="space-y-1.5">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Monthly Income</span>
                  <span className="font-semibold text-foreground">{fmt(totalMonthlyIncome)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Monthly Expenses</span>
                  <span className="font-semibold text-foreground">{fmt(monthlyExpenses)}</span>
                </div>
                <div className="flex justify-between text-sm border-t border-border pt-1.5">
                  <span className="font-semibold text-foreground">{monthlyGap >= 0 ? 'Surplus' : 'Gap'}</span>
                  <span className={`font-bold ${monthlyGap >= 0 ? 'text-green-600' : 'text-destructive'}`}>
                    {monthlyGap >= 0 ? '+' : '-'}{fmt(Math.abs(monthlyGap))}/mo
                  </span>
                </div>
              </div>
              {monthlyGap < 0 && (
                <div className="mt-3 bg-muted/50 rounded-lg p-3 space-y-1">
                  <p className="text-xs text-muted-foreground">
                    <span className="font-semibold">To close the gap:</span> save an additional <span className="font-semibold text-foreground">{fmt(additionalMonthlyNeeded)}/mo</span>, or accumulate <span className="font-semibold text-foreground">{fmt(lumpSumNeeded)}</span> total by retirement.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* CFP Guidelines */}
          <div className="bg-card rounded-xl shadow-sm p-4 mb-3">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
              Certified Financial Planner (CFP) Guidelines
            </p>
            <div className="space-y-3">
              {/* Savings Rate */}
              <div className="flex items-start gap-2">
                <div className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${savingsRateOk ? 'bg-green-500' : 'bg-yellow-500'}`} />
                <div>
                  <p className={`text-sm font-semibold ${savingsRateOk ? 'text-green-600' : 'text-yellow-600'}`}>
                    Savings Rate: {pct(savingsRate)}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {savingsRateOk
                      ? 'You\'re meeting the ≥15% guideline — great stewardship!'
                      : `Guideline is ≥15% of gross income (including employer match). You need ${fmt((combinedGrossIncome * 0.15 - annualContributions) / 12)} more per month.`}
                  </p>
                </div>
              </div>

              {/* 10x Salary Rule */}
              <div className="flex items-start gap-2">
                <div className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${salaryMultiple >= 8 ? 'bg-green-500' : salaryMultiple >= 5 ? 'bg-yellow-500' : 'bg-destructive'}`} />
                <div>
                  <p className={`text-sm font-semibold ${salaryMultiple >= 8 ? 'text-green-600' : salaryMultiple >= 5 ? 'text-yellow-600' : 'text-destructive'}`}>
                    {salaryMultiple >= 10 ? 'On Track' : salaryMultiple >= 8 ? 'Nearly There' : 'Behind Pace'} — {salaryMultiple.toFixed(1)}x final salary
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Rule of thumb: 10x your final salary by retirement. Projected {fmt(projectedPortfolio)} vs {fmt(finalSalary)} salary.
                  </p>
                </div>
              </div>

              {/* Roth vs Pre-Tax */}
              <div className="flex items-start gap-2">
                <div className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${rothSkewed ? 'bg-yellow-500' : 'bg-green-500'}`} />
                <div>
                  <p className={`text-sm font-semibold ${rothSkewed ? 'text-yellow-600' : 'text-green-600'}`}>
                    Tax Diversification: {pct(rothRatio)} Roth
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {rothSkewed
                      ? currentTotal === 0 ? 'Start building both pre-tax and Roth balances for tax flexibility in retirement.'
                        : rothPct < 0.2
                          ? 'Consider adding Roth contributions for tax-free income in retirement — especially if you expect to be in a similar or higher bracket later.'
                          : 'Consider some pre-tax contributions to reduce your current tax burden and diversify your retirement income sources.'
                      : 'Good tax diversification — a mix of pre-tax and Roth gives you flexibility in retirement.'}
                  </p>
                </div>
              </div>

              {/* 4% Rule Sustainability */}
              {monthlyExpenses > 0 && (
                <div className="flex items-start gap-2">
                  <div className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${withdrawalRateSafe ? 'bg-green-500' : 'bg-destructive'}`} />
                  <div>
                    <p className={`text-sm font-semibold ${withdrawalRateSafe ? 'text-green-600' : 'text-destructive'}`}>
                      Withdrawal Rate: {pct(impliedWithdrawalRate)}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {withdrawalRateSafe
                        ? 'Your projected expenses are sustainable under the 4% safe withdrawal rate.'
                        : `A ${pct(impliedWithdrawalRate)} withdrawal rate exceeds the 4% guideline — your portfolio may not last through retirement. Consider reducing expenses or increasing savings.`}
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* AI Insights */}
      {currentAge > 0 && (
        <RetirementInsightsSection
          householdId={householdId}
          retirementPicture={retirementPicture}
          financialProfile={financialProfile}
        />
      )}

      <div className="h-8" />
    </div>
  );
}
