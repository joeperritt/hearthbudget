import { useState, useMemo, useEffect, useCallback } from 'react';
import { ArrowLeft, ChevronDown, ChevronUp, Sparkles, Loader2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { supabase } from '@/integrations/supabase/client';
import { useToolState } from '@/hooks/useToolState';
import { RetirementInsightsSection } from './RetirementInsightsSection';

function fmt(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);
}
function pct(n: number, decimals = 1) {
  return (n * 100).toFixed(decimals) + '%';
}

// SSA adjustment factors relative to FRA 67
function ssaAdjustment(claimAge: number): number {
  if (claimAge <= 62) return 0.70;
  if (claimAge === 63) return 0.75;
  if (claimAge === 64) return 0.8;
  if (claimAge === 65) return 0.8667;
  if (claimAge === 66) return 0.9333;
  if (claimAge === 67) return 1.0;
  if (claimAge === 68) return 1.08;
  if (claimAge === 69) return 1.16;
  return 1.24; // 70
}

function ssClaimingNote(age: number): { text: string; color: string } {
  if (age === 62) return { text: 'Early claiming — benefit reduced by ~30%', color: 'text-destructive' };
  if (age >= 63 && age <= 66) return { text: 'Reduced benefit — increases ~6–8% per year you wait', color: 'text-yellow-600' };
  if (age === 67) return { text: 'Full retirement age — 100% benefit', color: 'text-green-600' };
  if (age >= 68 && age <= 69) return { text: 'Delayed — benefit increased ~8%/yr above full retirement age', color: 'text-green-600' };
  return { text: 'Maximum benefit — 124% of full retirement age amount', color: 'text-green-600' };
}

interface RetirementPlannerProps {
  onBack: () => void;
  householdId: string | null;
}

export function RetirementPlanner({ onBack, householdId }: RetirementPlannerProps) {
  const [financialProfile, setFinancialProfile] = useState<any>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [taxWithholdingState, setTaxWithholdingState] = useState<any>(null);
  const [budgetTotal, setBudgetTotal] = useState(0);
  const [showExpenseEstimator, setShowExpenseEstimator] = useState(false);
  const [aiEstimatingMember, setAiEstimatingMember] = useState<string | null>(null);

  const currentYear = new Date().getFullYear();

  const { state, setState, loaded: toolStateLoaded } = useToolState(householdId, 'retirement-planner', {
    retirementYear: String(currentYear + 25),
    expectedReturn: '7',
    inflationRate: '3',
    monthlyExpenses: '',
    preTaxContrib: '',
    rothContrib: '',
    nonQualContrib: '',
    showAdvanced: false,
    showSocialSecurity: false,
    memberAges: {} as Record<string, string>,
    ssBenefits: {} as Record<string, string>,
    ssClaimingAges: {} as Record<string, string>,
  });

  // Load financial profile, tax state, and budget totals
  useEffect(() => {
    if (!householdId) { setProfileLoading(false); return; }
    Promise.all([
      supabase.from('financial_profiles').select('*').eq('household_id', householdId).maybeSingle(),
      supabase.from('tool_states' as any).select('state_json').eq('household_id', householdId).eq('tool_name', 'tax-withholding').maybeSingle(),
      supabase.from('households').select('active_month').eq('id', householdId).single(),
    ]).then(async ([profileRes, taxRes, hhRes]) => {
      if (profileRes.data) setFinancialProfile(profileRes.data);
      if ((taxRes.data as any)?.state_json) setTaxWithholdingState((taxRes.data as any).state_json);

      const activeMonth = (hhRes.data as any)?.active_month;
      if (activeMonth) {
        const [catRes, fixRes] = await Promise.all([
          supabase.from('budget_categories').select('budgeted').eq('household_id', householdId),
          supabase.from('fixed_expenses').select('amount').eq('household_id', householdId),
        ]);
        const catTotal = (catRes.data || []).reduce((s: number, r: any) => s + (Number(r.budgeted) || 0), 0);
        const fixTotal = (fixRes.data || []).reduce((s: number, r: any) => s + (Number(r.amount) || 0), 0);
        setBudgetTotal(catTotal + fixTotal);
      }
      setProfileLoading(false);
    });
  }, [householdId]);

  // Members from profile
  const members: { name: string; gross_income: number; age?: number; income_type?: string }[] = useMemo(() => {
    if (!financialProfile?.member_incomes) return [];
    const raw = financialProfile.member_incomes as any[];
    return raw.filter((m: any) => m.name).map((m: any) => ({
      name: m.name,
      gross_income: Number(m.gross_income) || 0,
      age: m.age ? Number(m.age) : undefined,
      income_type: m.income_type || 'W-2',
    }));
  }, [financialProfile]);

  // Debts from profile
  const totalMonthlyDebt = useMemo(() => {
    if (!financialProfile?.debts || !Array.isArray(financialProfile.debts)) return 0;
    return (financialProfile.debts as any[]).reduce((s, d) => s + (Number(d.monthly_payment || d.minimum_payment) || 0), 0);
  }, [financialProfile]);

  // Auto-populate on first load
  const [initialized, setInitialized] = useState(false);
  useEffect(() => {
    if (!toolStateLoaded || !financialProfile || initialized) return;
    const updates: any = {};

    if (members.length > 0) {
      const ages: Record<string, string> = { ...state.memberAges };
      let changed = false;
      members.forEach(m => {
        if (!ages[m.name] && m.age) { ages[m.name] = String(m.age); changed = true; }
      });
      if (changed) updates.memberAges = ages;
    }

    // Pre-populate pre-tax contributions from tax withholding if available
    if (!state.preTaxContrib && taxWithholdingState?.retirementDeduction) {
      const perPaycheck = Number(taxWithholdingState.retirementDeduction) || 0;
      const freq = taxWithholdingState.payFrequency || 'biweekly';
      const periods: Record<string, number> = { weekly: 52, biweekly: 26, semimonthly: 24, monthly: 12 };
      const annual = perPaycheck * (periods[freq] || 26);
      updates.preTaxContrib = String(Math.round(annual / 12));
    }

    if (members.length > 0 && Object.keys(state.ssClaimingAges).length === 0) {
      const claimingAges: Record<string, string> = {};
      members.forEach(m => { claimingAges[m.name] = '67'; });
      updates.ssClaimingAges = claimingAges;
    }

    if (Object.keys(updates).length) setState(updates);
    setInitialized(true);
  }, [toolStateLoaded, financialProfile, members, initialized, taxWithholdingState]);

  // Parsed values
  const retirementYear = Number(state.retirementYear) || (currentYear + 25);
  const expectedReturn = (Number(state.expectedReturn) || 7) / 100;
  const inflationRate = (Number(state.inflationRate) || 3) / 100;
  const preTaxContrib = Number(state.preTaxContrib) || 0;
  const rothContrib = Number(state.rothContrib) || 0;
  const nonQualContrib = Number(state.nonQualContrib) || 0;
  const monthlyContributions = preTaxContrib + rothContrib + nonQualContrib;
  const monthlyExpenses = Number(state.monthlyExpenses) || 0;

  const currentPreTax = Number(financialProfile?.retirement_balance) || 0;
  const currentRoth = Number(financialProfile?.roth_retirement_balance) || 0;
  const currentNonQual = Number(financialProfile?.non_retirement_investments) || 0;
  const currentTotal = currentPreTax + currentRoth + currentNonQual;

  // Derive retirement ages per member from retirement year
  const memberRetirementInfo = useMemo(() => {
    return members.map(m => {
      const age = Number(state.memberAges?.[m.name]) || 0;
      const retireAge = age > 0 ? retirementYear - (currentYear - age) : 0;
      return { name: m.name, currentAge: age, retireAge };
    });
  }, [members, state.memberAges, retirementYear, currentYear]);

  // Use youngest member's age for conservative planning
  const currentAge = useMemo(() => {
    const ages = memberRetirementInfo.map(m => m.currentAge).filter(a => a > 0);
    return ages.length > 0 ? Math.min(...ages) : 0;
  }, [memberRetirementInfo]);

  const retirementAge = currentAge > 0 ? retirementYear - (currentYear - currentAge) : 65;
  const yearsToRetirement = Math.max(0, retirementYear - currentYear);
  const monthsToRetirement = yearsToRetirement * 12;

  const combinedGrossIncome = members.reduce((s, m) => s + m.gross_income, 0);
  const annualContributions = monthlyContributions * 12;

  // Future value per bucket
  const monthlyReturn = expectedReturn / 12;
  const fvFactor = Math.pow(1 + monthlyReturn, monthsToRetirement);
  const fvAnnuity = monthlyReturn > 0
    ? (fvFactor - 1) / monthlyReturn
    : monthsToRetirement;

  const projectedPreTax = currentPreTax * fvFactor + preTaxContrib * fvAnnuity;
  const projectedRoth = currentRoth * fvFactor + rothContrib * fvAnnuity;
  const projectedNonQual = currentNonQual * fvFactor + nonQualContrib * fvAnnuity;
  const projectedPortfolio = projectedPreTax + projectedRoth + projectedNonQual;

  // Baseline 4% withdrawal (used for simple display)
  const annualWithdrawal = projectedPortfolio * 0.04;
  const monthlyFromPortfolio = annualWithdrawal / 12;

  // Social Security — store FRA benefit in today's dollars, inflate to retirement year
  const showSS = state.showSocialSecurity;
  const ssDetails = useMemo(() => {
    if (!showSS) return { total: 0, perMember: [] as { name: string; fra: number; adjusted: number; inflatedAdjusted: number; claimAge: number; claimYear: number }[] };
    const perMember = members.map(m => {
      const fra = Number(state.ssBenefits?.[m.name]) || 0;
      const claimAge = Number(state.ssClaimingAges?.[m.name]) || 67;
      const adjusted = fra * ssaAdjustment(claimAge);
      // Inflate SS benefit to retirement-year dollars (SS has COLA ≈ inflation)
      const memberAge = Number(state.memberAges?.[m.name]) || 0;
      const yearsToFRA = memberAge > 0 ? Math.max(0, claimAge - memberAge) : yearsToRetirement;
      const inflatedAdjusted = adjusted * Math.pow(1 + inflationRate, yearsToFRA);
      const claimYear = memberAge > 0 ? currentYear + (claimAge - memberAge) : retirementYear;
      return { name: m.name, fra, adjusted, inflatedAdjusted, claimAge, claimYear };
    });
    return { total: perMember.reduce((s, m) => s + m.inflatedAdjusted, 0), perMember };
  }, [showSS, members, state.ssBenefits, state.ssClaimingAges, state.memberAges, currentYear, retirementYear, inflationRate, yearsToRetirement]);

  // Longevity benchmark
  const longevityAge = 90;

  // Phase-based income projection with variable withdrawal rates
  // Instead of flat 4%, compute how much portfolio can supply each phase
  // by solving for a sustainable drawdown across all phases to age 90.
  const incomePhases = useMemo(() => {
    const retireAge = retirementAge;
    const totalRetirementYears = Math.max(1, longevityAge - retireAge);
    const realReturn = (1 + expectedReturn) / (1 + inflationRate) - 1; // real return for retirement
    const monthlyRealReturn = realReturn / 12;

    if (!showSS || ssDetails.perMember.length === 0) {
      // No SS — single phase, standard 4% rule
      return [{
        label: `${retirementYear}+ (Portfolio only)`,
        startYear: retirementYear,
        endYear: null as number | null,
        durationYears: totalRetirementYears,
        portfolioIncome: monthlyFromPortfolio,
        ssIncome: 0,
        totalIncome: monthlyFromPortfolio,
        withdrawalRate: projectedPortfolio > 0 ? (monthlyFromPortfolio * 12) / projectedPortfolio : 0,
      }];
    }

    // Build distinct transition points
    const ssStartYears = [...new Set(
      ssDetails.perMember
        .filter(m => m.inflatedAdjusted > 0)
        .map(m => Math.max(m.claimYear, retirementYear))
    )].sort((a, b) => a - b);

    // If all SS starts at or before retirement, single phase
    if (ssStartYears.length === 0 || (ssStartYears.length === 1 && ssStartYears[0] <= retirementYear)) {
      const ssIncome = ssDetails.perMember.reduce((s, m) => s + m.inflatedAdjusted, 0);
      return [{
        label: `${retirementYear}+`,
        startYear: retirementYear,
        endYear: null,
        durationYears: totalRetirementYears,
        portfolioIncome: monthlyFromPortfolio,
        ssIncome,
        totalIncome: monthlyFromPortfolio + ssIncome,
        withdrawalRate: projectedPortfolio > 0 ? (monthlyFromPortfolio * 12) / projectedPortfolio : 0,
      }];
    }

    // Multi-phase: solve for sustainable portfolio income per phase
    // Key insight: during pre-SS years, the portfolio must cover more of expenses,
    // but it only needs to do so for a limited time before SS income kicks in.
    //
    // We solve: given projected portfolio, expenses, and SS schedule,
    // what's the max monthly draw from portfolio in each phase such that
    // the portfolio lasts to age 90?
    const transitions = [...new Set([retirementYear, ...ssStartYears])].sort((a, b) => a - b);
    const endYear = retirementYear + totalRetirementYears;

    // Build phase structures
    const rawPhases: { startYear: number; endYear: number; durationMonths: number; ssIncome: number; label: string }[] = [];
    for (let i = 0; i < transitions.length; i++) {
      const start = transitions[i];
      const end = i < transitions.length - 1 ? transitions[i + 1] : endYear;
      const activeSS = ssDetails.perMember.filter(m => m.inflatedAdjusted > 0 && m.claimYear <= start);
      const ssIncome = activeSS.reduce((s, m) => s + m.inflatedAdjusted, 0);
      const allSSActive = ssDetails.perMember.filter(m => m.inflatedAdjusted > 0).every(m => m.claimYear <= start);

      let label: string;
      if (activeSS.length === 0) {
        label = end < endYear ? `${start}–${end} (pre-Social Security)` : `${start}+`;
      } else if (allSSActive) {
        label = `${start}+ (with Social Security)`;
      } else {
        const activeNames = activeSS.map(m => m.name).join(' + ');
        label = end < endYear ? `${start}–${end} (${activeNames} SS only)` : `${start}+ (${activeNames} SS)`;
      }

      rawPhases.push({ startYear: start, endYear: end, durationMonths: (end - start) * 12, ssIncome, label });
    }

    // Now solve for sustainable withdrawal:
    // Portfolio must fund (expenses - ssIncome) in each phase.
    // Phase 1 draws more, Phase 2+ draws less because SS covers part.
    // We compute: what portfolio balance is needed at each transition point,
    // working backwards from age 90 (balance = 0).
    //
    // For each phase (working backward): PV of (expenses - SS) annuity
    // + PV of remaining phases at that point.
    //
    // Then the actual portfolio income per phase = expenses - ssIncome
    // (the portfolio covers the gap), and we report the effective withdrawal rate.

    if (monthlyExpenses <= 0) {
      // No expenses entered — just show flat 4% with SS
      return rawPhases.map(p => ({
        label: p.label,
        startYear: p.startYear,
        endYear: p.endYear < endYear ? p.endYear : null,
        durationYears: p.durationMonths / 12,
        portfolioIncome: monthlyFromPortfolio,
        ssIncome: p.ssIncome,
        totalIncome: monthlyFromPortfolio + p.ssIncome,
        withdrawalRate: projectedPortfolio > 0 ? (monthlyFromPortfolio * 12) / projectedPortfolio : 0,
      }));
    }

    // Compute required portfolio at retirement to fund all phases
    // Working backward: at end of last phase, portfolio should be 0
    let requiredPortfolioAtPhaseStart = 0;
    const phasePortfolioNeeds: number[] = new Array(rawPhases.length).fill(0);

    for (let i = rawPhases.length - 1; i >= 0; i--) {
      const phase = rawPhases[i];
      const monthlyDraw = Math.max(0, monthlyExpenses - phase.ssIncome);
      const n = phase.durationMonths;

      // PV of annuity (monthly draw for n months) + PV of future needs
      let pvAnnuity: number;
      if (monthlyRealReturn > 0.0001) {
        pvAnnuity = monthlyDraw * (1 - Math.pow(1 + monthlyRealReturn, -n)) / monthlyRealReturn;
      } else {
        pvAnnuity = monthlyDraw * n;
      }

      // Discount future needs back to start of this phase
      const pvFuture = requiredPortfolioAtPhaseStart / Math.pow(1 + monthlyRealReturn, n);
      requiredPortfolioAtPhaseStart = pvAnnuity + pvFuture;
      phasePortfolioNeeds[i] = requiredPortfolioAtPhaseStart;
    }

    const requiredPortfolio = requiredPortfolioAtPhaseStart;
    const fundingRatio = requiredPortfolio > 0 ? projectedPortfolio / requiredPortfolio : 1;

    // Build final phases with actual portfolio income (scaled if underfunded)
    return rawPhases.map((p, i) => {
      const idealMonthlyDraw = Math.max(0, monthlyExpenses - p.ssIncome);
      const actualMonthlyDraw = idealMonthlyDraw * Math.min(1, fundingRatio);
      const effectiveRate = projectedPortfolio > 0 ? (actualMonthlyDraw * 12) / projectedPortfolio : 0;

      return {
        label: p.label,
        startYear: p.startYear,
        endYear: p.endYear < endYear ? p.endYear : null,
        durationYears: p.durationMonths / 12,
        portfolioIncome: actualMonthlyDraw,
        ssIncome: p.ssIncome,
        totalIncome: actualMonthlyDraw + p.ssIncome,
        withdrawalRate: effectiveRate,
      };
    });
  }, [showSS, ssDetails, retirementYear, monthlyFromPortfolio, projectedPortfolio, retirementAge, expectedReturn, inflationRate, monthlyExpenses, longevityAge]);

  // Use worst-case phase for gap analysis (the phase with lowest income)
  const worstPhase = useMemo(() => {
    return incomePhases.reduce((worst, phase) => phase.totalIncome < worst.totalIncome ? phase : worst, incomePhases[0]);
  }, [incomePhases]);

  const totalMonthlyIncome = worstPhase.totalIncome;
  const monthlyGap = totalMonthlyIncome - monthlyExpenses;

  // Required additional portfolio = PV of all phase shortfalls
  const { additionalMonthlyNeeded, lumpSumNeeded } = useMemo(() => {
    if (monthlyExpenses <= 0 || monthsToRetirement <= 0) return { additionalMonthlyNeeded: 0, lumpSumNeeded: 0 };

    // Calculate total portfolio needed using phased approach
    const realReturn = (1 + expectedReturn) / (1 + inflationRate) - 1;
    const monthlyRealReturn = realReturn / 12;
    const totalRetirementMonths = Math.max(1, (longevityAge - retirementAge)) * 12;

    // Sum the PV of all phase shortfalls
    let requiredPortfolio = 0;
    let monthsElapsed = 0;
    for (const phase of incomePhases) {
      const phaseDurationMonths = phase.durationYears * 12;
      const monthlyNeedFromPortfolio = Math.max(0, monthlyExpenses - phase.ssIncome);
      let pvAnnuity: number;
      if (monthlyRealReturn > 0.0001) {
        pvAnnuity = monthlyNeedFromPortfolio * (1 - Math.pow(1 + monthlyRealReturn, -phaseDurationMonths)) / monthlyRealReturn;
      } else {
        pvAnnuity = monthlyNeedFromPortfolio * phaseDurationMonths;
      }
      // Discount to retirement date
      requiredPortfolio += pvAnnuity / Math.pow(1 + monthlyRealReturn, monthsElapsed);
      monthsElapsed += phaseDurationMonths;
    }

    const portfolioGap = requiredPortfolio - projectedPortfolio;
    if (portfolioGap <= 0) return { additionalMonthlyNeeded: 0, lumpSumNeeded: 0 };

    // Additional monthly contribution needed to close the gap
    let addlMonthly = 0;
    if (monthlyReturn > 0.0001) {
      addlMonthly = portfolioGap / ((Math.pow(1 + monthlyReturn, monthsToRetirement) - 1) / monthlyReturn);
    } else {
      addlMonthly = portfolioGap / monthsToRetirement;
    }

    return { additionalMonthlyNeeded: Math.max(0, addlMonthly), lumpSumNeeded: Math.max(0, portfolioGap) };
  }, [monthlyExpenses, monthsToRetirement, monthlyReturn, projectedPortfolio, incomePhases, expectedReturn, inflationRate, retirementAge, longevityAge]);

  // CFP Guidelines
  const savingsRate = combinedGrossIncome > 0 ? annualContributions / combinedGrossIncome : 0;
  const savingsRateOk = savingsRate >= 0.15;
  const finalSalary = combinedGrossIncome * Math.pow(1 + inflationRate, yearsToRetirement);
  const salaryMultiple = finalSalary > 0 ? projectedPortfolio / finalSalary : 0;
  const rothPct = (currentRoth + currentNonQual) > 0 && currentTotal > 0 ? currentRoth / currentTotal : 0;
  const rothSkewed = rothPct < 0.2 || rothPct > 0.8;
  const impliedWithdrawalRate = projectedPortfolio > 0 ? (monthlyExpenses * 12) / projectedPortfolio : 0;
  const withdrawalRateSafe = impliedWithdrawalRate <= 0.04;

  // AI SS Estimate
  const fetchSSEstimate = useCallback(async (memberName: string) => {
    setAiEstimatingMember(memberName);
    try {
      const member = members.find(m => m.name === memberName);
      if (!member) return;
      const memberAge = Number(state.memberAges?.[memberName]) || 0;
      const memberRetireAge = memberAge > 0 ? retirementYear - (currentYear - memberAge) : 65;

      const prompt = `Based on this person's income profile, estimate their monthly Social Security benefit at full retirement age (67) in TODAY'S DOLLARS. Return ONLY a JSON object like {"estimatedMonthlyBenefit": 2450}. Person: ${member.name}, current age: ${memberAge}, retirement age: ${memberRetireAge}, annual gross income: $${member.gross_income.toLocaleString()}, income type: ${member.income_type || 'W-2'}. Assume they've been earning at roughly this level (inflation-adjusted) throughout their career. Use SSA benefit formula approximations for someone at this income level. Return the benefit in today's dollars — we will adjust for inflation separately.`;

      const { data, error } = await supabase.functions.invoke('budget-insights', {
        body: {
          budgetSummary: { currentMonth: new Date().toISOString().slice(0, 7), context: 'ss_estimate' },
          chatMessages: [
            { role: 'system', content: 'You are a Social Security benefits estimator. Return ONLY valid JSON with the key estimatedMonthlyBenefit (a number). No other text.' },
            { role: 'user', content: prompt },
          ],
        },
      });

      if (!error && data?.content) {
        const jsonMatch = data.content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          const est = Number(parsed.estimatedMonthlyBenefit) || 0;
          if (est > 0) {
            setState({ ssBenefits: { ...state.ssBenefits, [memberName]: String(Math.round(est)) } });
          }
        }
      }
    } catch (e) {
      console.error('SS estimate error', e);
    } finally {
      setAiEstimatingMember(null);
    }
  }, [members, state.memberAges, state.ssBenefits, retirementYear, currentYear, setState]);

  // Expense estimator state
  const [estDebtFree, setEstDebtFree] = useState(false);
  const [estNoRetSavings, setEstNoRetSavings] = useState(false);
  const [estDebtOverride, setEstDebtOverride] = useState('');
  const [estContribOverride, setEstContribOverride] = useState('');

  const estimatorResult = useMemo(() => {
    let base = budgetTotal;
    const debtSub = estDebtFree ? (Number(estDebtOverride) || totalMonthlyDebt) : 0;
    const contribSub = estNoRetSavings ? (Number(estContribOverride) || monthlyContributions) : 0;
    const adjusted = Math.max(0, base - debtSub - contribSub);
    const inflated = adjusted * Math.pow(1 + inflationRate, yearsToRetirement);
    return { base, debtSub, contribSub, adjusted, inflated };
  }, [budgetTotal, estDebtFree, estDebtOverride, estNoRetSavings, estContribOverride, totalMonthlyDebt, monthlyContributions, inflationRate, yearsToRetirement]);

  // Retirement year slider label
  const retirementYearLabel = useMemo(() => {
    const parts = memberRetirementInfo
      .filter(m => m.currentAge > 0)
      .map(m => `${m.name}: ${m.retireAge}`);
    return parts.length > 0 ? `${retirementYear} — ${parts.join(', ')}` : String(retirementYear);
  }, [retirementYear, memberRetirementInfo]);

  // AI payload
  const retirementPicture = useMemo(() => ({
    members: memberRetirementInfo.map(m => ({ name: m.name, age: m.currentAge, retireAge: m.retireAge, gross_income: members.find(x => x.name === m.name)?.gross_income || 0 })),
    retirementYear, retirementAge, yearsToRetirement, currentPreTax, currentRoth, currentNonQual, currentTotal,
    preTaxContrib, rothContrib, nonQualContrib, monthlyContributions, annualContributions, expectedReturn, inflationRate,
    projectedPortfolio, projectedPreTax, projectedRoth, projectedNonQual, monthlyFromPortfolio,
    socialSecurityEnabled: showSS, totalSSBenefit: ssDetails.total,
    incomePhases: incomePhases.map(p => ({ label: p.label, totalIncome: p.totalIncome, ssIncome: p.ssIncome })),
    totalMonthlyIncome, monthlyExpenses, monthlyGap: totalMonthlyIncome - monthlyExpenses, savingsRate, salaryMultiple,
    rothPct, impliedWithdrawalRate, additionalMonthlyNeeded,
  }), [memberRetirementInfo, members, retirementYear, retirementAge, yearsToRetirement, currentPreTax, currentRoth, currentNonQual, currentTotal,
    preTaxContrib, rothContrib, nonQualContrib, monthlyContributions, annualContributions, expectedReturn, inflationRate, projectedPortfolio,
    projectedPreTax, projectedRoth, projectedNonQual, monthlyFromPortfolio, showSS, ssDetails.total, incomePhases,
    totalMonthlyIncome, monthlyExpenses, savingsRate, salaryMultiple, rothPct, impliedWithdrawalRate, additionalMonthlyNeeded]);

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

        {/* Target Retirement Year slider */}
        <div>
          <Label className="text-xs text-muted-foreground">Target Retirement Year</Label>
          <p className="text-sm font-semibold text-foreground mt-1">{retirementYearLabel}</p>
          <Slider
            value={[retirementYear]}
            onValueChange={([v]) => setState({ retirementYear: String(v) })}
            min={currentYear + 1}
            max={currentYear + 50}
            step={1}
            className="mt-2"
          />
          <div className="flex justify-between text-[10px] text-muted-foreground mt-0.5">
            <span>{currentYear + 1}</span>
            <span>{currentYear + 50}</span>
          </div>
        </div>

        {/* Current Balances */}
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
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Non-Qualified (Brokerage)</span>
              <span className="font-semibold text-foreground">{fmt(currentNonQual)}</span>
            </div>
            <div className="flex justify-between text-sm border-t border-border pt-1.5">
              <span className="text-muted-foreground font-semibold">Combined</span>
              <span className="font-bold text-foreground">{fmt(currentTotal)}</span>
            </div>
          </div>
          <p className="text-[10px] text-muted-foreground mt-1">From your Financial Profile</p>
        </div>

        {/* Three contribution buckets */}
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Monthly Retirement Contributions</p>
          <div className="space-y-2">
            <div>
              <Label className="text-[11px] text-muted-foreground">Pre-Tax (401k/Traditional IRA)</Label>
              <div className="relative mt-1">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
                <Input
                  type="number"
                  className="pl-7"
                  value={state.preTaxContrib}
                  onChange={e => setState({ preTaxContrib: e.target.value })}
                  placeholder="0"
                />
              </div>
            </div>
            <div>
              <Label className="text-[11px] text-muted-foreground">Roth (Roth 401k/Roth IRA)</Label>
              <div className="relative mt-1">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
                <Input
                  type="number"
                  className="pl-7"
                  value={state.rothContrib}
                  onChange={e => setState({ rothContrib: e.target.value })}
                  placeholder="0"
                />
              </div>
            </div>
            <div>
              <Label className="text-[11px] text-muted-foreground">Non-Qualified (Brokerage/Taxable)</Label>
              <div className="relative mt-1">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
                <Input
                  type="number"
                  className="pl-7"
                  value={state.nonQualContrib}
                  onChange={e => setState({ nonQualContrib: e.target.value })}
                  placeholder="0"
                />
              </div>
            </div>
            <div className="bg-muted/50 rounded-lg px-3 py-2 flex justify-between text-sm">
              <span className="text-muted-foreground font-medium">Combined Monthly</span>
              <span className="font-bold text-foreground">{fmt(monthlyContributions)}</span>
            </div>
          </div>
          {taxWithholdingState?.retirementDeduction && (
            <p className="text-[10px] text-muted-foreground mt-1">Pre-tax pre-populated from Tax Withholding tool</p>
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

        {/* Monthly Expenses with estimator */}
        <div>
          <div className="flex items-center justify-between">
            <Label className="text-xs text-muted-foreground">Estimated Monthly Retirement Expenses</Label>
            <button
              onClick={() => {
                setEstDebtFree(false);
                setEstNoRetSavings(false);
                setEstDebtOverride(String(totalMonthlyDebt));
                setEstContribOverride(String(monthlyContributions));
                setShowExpenseEstimator(true);
              }}
              className="text-[11px] font-semibold text-accent active:opacity-70"
            >
              Help me estimate
            </button>
          </div>
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
              {members.map(m => {
                const claimAge = Number(state.ssClaimingAges?.[m.name]) || 67;
                const note = ssClaimingNote(claimAge);
                const fraAmount = Number(state.ssBenefits?.[m.name]) || 0;
                const adjustedAmount = fraAmount * ssaAdjustment(claimAge);
                return (
                  <div key={m.name} className="bg-card rounded-xl shadow-sm p-3 space-y-2">
                    {members.length > 1 && (
                      <p className="text-xs font-semibold text-foreground">{m.name}</p>
                    )}
                    <div>
                      <div className="flex items-center justify-between">
                        <Label className="text-[11px] text-muted-foreground">Estimated Monthly SS Benefit (at FRA)</Label>
                        <button
                          onClick={() => fetchSSEstimate(m.name)}
                          disabled={aiEstimatingMember === m.name}
                          className="flex items-center gap-1 text-[11px] font-semibold text-accent active:opacity-70 disabled:opacity-50"
                        >
                          {aiEstimatingMember === m.name ? (
                            <><Loader2 size={10} className="animate-spin" /> Estimating…</>
                          ) : (
                            <><Sparkles size={10} /> AI Estimate</>
                          )}
                        </button>
                      </div>
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
                      {aiEstimatingMember === null && fraAmount > 0 && (
                        <p className="text-[10px] text-muted-foreground mt-0.5">
                          AI estimate in today's dollars — for a precise figure, visit <span className="text-accent">ssa.gov/myaccount</span>
                        </p>
                      )}
                      {fraAmount > 0 && (
                        <p className="text-[10px] text-muted-foreground mt-0.5">
                          {claimAge !== 67 ? `Adjusted for claiming at ${claimAge}: ${fmt(adjustedAmount)}/mo today → ` : ''}
                          <span className="font-semibold text-foreground">
                            {fmt(adjustedAmount * Math.pow(1 + inflationRate, Math.max(0, claimAge - (Number(state.memberAges?.[m.name]) || 0))))}/mo in {retirementYear} dollars
                          </span>
                          {' '}(inflation-adjusted via COLA)
                        </p>
                      )}
                    </div>
                    <div>
                      <Label className="text-[11px] text-muted-foreground">Claiming Age: {claimAge}</Label>
                      <Slider
                        value={[claimAge]}
                        onValueChange={([v]) => setState({ ssClaimingAges: { ...state.ssClaimingAges, [m.name]: String(v) } })}
                        min={62}
                        max={70}
                        step={1}
                        className="mt-2"
                      />
                      <div className="flex justify-between text-[10px] text-muted-foreground mt-0.5">
                        <span>62</span>
                        <span>67</span>
                        <span>70</span>
                      </div>
                      <p className={`text-[10px] mt-0.5 ${note.color}`}>{note.text}</p>
                    </div>
                  </div>
                );
              })}
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
              <span>Retire ({retirementYear})</span>
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
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Non-Qualified (Brokerage)</span>
                <span className="font-semibold text-foreground">{fmt(projectedNonQual)}</span>
              </div>
              <div className="flex justify-between text-sm border-t border-border pt-1.5">
                <span className="text-muted-foreground font-semibold">Total Projected</span>
                <span className="font-bold text-foreground">{fmt(projectedPortfolio)}</span>
              </div>
            </div>
          </div>

          {/* Monthly Income — Phase-based */}
          <div className="bg-card rounded-xl shadow-sm p-4 mb-3">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Projected Monthly Retirement Income</p>
            <p className="text-[10px] text-muted-foreground mb-3">All amounts in {retirementYear} dollars (inflation-adjusted)</p>
            {incomePhases.map((phase, i) => {
              const phaseGap = phase.totalIncome - monthlyExpenses;
              return (
                <div key={i} className={`${i > 0 ? 'mt-3 pt-3 border-t border-border' : ''}`}>
                  <div className="flex items-center justify-between mb-1.5">
                    <p className="text-[11px] font-semibold text-muted-foreground">{phase.label}</p>
                    {phase.durationYears > 0 && phase.durationYears < 50 && (
                      <span className="text-[10px] text-muted-foreground">{Math.round(phase.durationYears)} yrs</span>
                    )}
                  </div>
                  <div className="space-y-1">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">
                        Portfolio draw
                        {phase.withdrawalRate > 0 && (
                          <span className={`ml-1 text-[10px] ${phase.withdrawalRate > 0.04 ? 'text-yellow-600' : 'text-muted-foreground'}`}>
                            ({pct(phase.withdrawalRate)}/yr)
                          </span>
                        )}
                      </span>
                      <span className="font-semibold text-foreground">{fmt(phase.portfolioIncome)}</span>
                    </div>
                    {phase.ssIncome > 0 && (
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Social Security</span>
                        <span className="font-semibold text-foreground">{fmt(phase.ssIncome)}</span>
                      </div>
                    )}
                    <div className="flex justify-between text-sm border-t border-border pt-1">
                      <span className="text-muted-foreground font-semibold">Total Monthly Income</span>
                      <span className="font-bold text-foreground">{fmt(phase.totalIncome)}</span>
                    </div>
                    {monthlyExpenses > 0 && (
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">{phaseGap >= 0 ? 'Surplus' : 'Gap'} vs. expenses</span>
                        <span className={`font-bold ${phaseGap >= 0 ? 'text-green-600' : 'text-destructive'}`}>
                          {phaseGap >= 0 ? '+' : '-'}{fmt(Math.abs(phaseGap))}/mo
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
            {showSS && incomePhases.length > 1 && (
              <p className="text-[10px] text-muted-foreground mt-3 italic">
                Higher portfolio draw in pre-SS phases is sustainable because it drops once Social Security begins.
              </p>
            )}
          </div>

          {/* Gap / Surplus summary */}
          {monthlyExpenses > 0 && lumpSumNeeded > 0 && (
            <div className="bg-card rounded-xl shadow-sm p-4 mb-3">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Closing the Income Gap</p>
              <div className="bg-muted/50 rounded-lg p-3 space-y-1">
                <p className="text-xs text-muted-foreground">
                  To fully fund all phases through age {longevityAge}: save an additional <span className="font-semibold text-foreground">{fmt(additionalMonthlyNeeded)}/mo</span>, or accumulate <span className="font-semibold text-foreground">{fmt(lumpSumNeeded)}</span> more by retirement.
                </p>
              </div>
            </div>
          )}

          {/* CFP Guidelines */}
          <div className="bg-card rounded-xl shadow-sm p-4 mb-3">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
              Certified Financial Planner (CFP) Guidelines
            </p>
            <div className="space-y-3">
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

              <div className="flex items-start gap-2">
                <div className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${rothSkewed ? 'bg-yellow-500' : 'bg-green-500'}`} />
                <div>
                  <p className={`text-sm font-semibold ${rothSkewed ? 'text-yellow-600' : 'text-green-600'}`}>
                    Tax Diversification: {pct(rothPct)} Roth
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {rothSkewed
                      ? currentTotal === 0 ? 'Start building both pre-tax and Roth balances for tax flexibility in retirement.'
                        : rothPct < 0.2
                          ? 'Consider adding Roth contributions for tax-free income in retirement.'
                          : 'Consider some pre-tax contributions to reduce your current tax burden.'
                      : 'Good tax diversification — a mix of pre-tax and Roth gives you flexibility in retirement.'}
                  </p>
                </div>
              </div>

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
                        : `A ${pct(impliedWithdrawalRate)} withdrawal rate exceeds the 4% guideline — your portfolio may not last through retirement.`}
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

      {/* Expense Estimator Modal */}
      <Dialog open={showExpenseEstimator} onOpenChange={setShowExpenseEstimator}>
        <DialogContent className="max-w-sm mx-auto">
          <DialogHeader>
            <DialogTitle className="font-display text-lg">Retirement Expense Estimator</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Current Monthly Budget</span>
              <span className="font-semibold text-foreground">{fmt(budgetTotal)}</span>
            </div>

            {/* Debt-free toggle */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-sm text-foreground">I plan to be debt-free in retirement</label>
                <Switch checked={estDebtFree} onCheckedChange={setEstDebtFree} />
              </div>
              {estDebtFree && (
                <div>
                  <Label className="text-[11px] text-muted-foreground">Monthly debt payments to subtract</Label>
                  <div className="relative mt-1">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
                    <Input
                      type="number"
                      className="pl-7"
                      value={estDebtOverride}
                      onChange={e => setEstDebtOverride(e.target.value)}
                    />
                  </div>
                  <div className="flex justify-between text-xs text-muted-foreground mt-1">
                    <span>Subtotal after debt</span>
                    <span className="font-semibold text-foreground">{fmt(budgetTotal - (Number(estDebtOverride) || totalMonthlyDebt))}</span>
                  </div>
                </div>
              )}
            </div>

            {/* No retirement savings toggle */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-sm text-foreground">I won't save in retirement</label>
                <Switch checked={estNoRetSavings} onCheckedChange={setEstNoRetSavings} />
              </div>
              {estNoRetSavings && (
                <div>
                  <Label className="text-[11px] text-muted-foreground">Monthly contributions to subtract</Label>
                  <div className="relative mt-1">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
                    <Input
                      type="number"
                      className="pl-7"
                      value={estContribOverride}
                      onChange={e => setEstContribOverride(e.target.value)}
                    />
                  </div>
                  <div className="flex justify-between text-xs text-muted-foreground mt-1">
                    <span>Subtotal after contributions</span>
                    <span className="font-semibold text-foreground">{fmt(estimatorResult.adjusted)}</span>
                  </div>
                </div>
              )}
            </div>

            <div className="border-t border-border pt-3 space-y-1.5">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Adjusted monthly expenses</span>
                <span className="font-bold text-foreground">{fmt(estimatorResult.adjusted)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Inflation-adjusted in {retirementYear}</span>
                <span className="font-bold text-accent">{fmt(estimatorResult.inflated)}/mo</span>
              </div>
              <p className="text-[10px] text-muted-foreground">
                Using {state.inflationRate}% inflation through {retirementYear}
              </p>
            </div>

            <button
              onClick={() => {
                setState({ monthlyExpenses: String(Math.round(estimatorResult.inflated)) });
                setShowExpenseEstimator(false);
              }}
              className="w-full py-2.5 bg-accent text-accent-foreground rounded-xl font-semibold text-sm active:opacity-90"
            >
              Use this estimate
            </button>
          </div>
        </DialogContent>
      </Dialog>

      <div className="h-8" />
    </div>
  );
}
