import { useState, useMemo, useEffect, useCallback } from 'react';
import { ArrowLeft, ChevronDown, ChevronUp, Sparkles, Loader2, Info, Plus, Trash2 } from 'lucide-react';
import { ageFromDob } from '@/lib/ageUtils';
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

interface OtherIncome {
  id: string;
  name: string;
  monthlyAmount: string;
  startMode: 'retirement' | 'year'; // "At Retirement" or specific year
  startYear: string;                 // used when startMode === 'year'
  endMode: 'lifetime' | 'year';
  endYear: string;
  inflationAdjusted: boolean;
  expanded: boolean;
}

function newOtherIncome(retirementYear: number): OtherIncome {
  return {
    id: crypto.randomUUID(),
    name: '',
    monthlyAmount: '',
    startMode: 'retirement',
    startYear: String(retirementYear),
    endMode: 'lifetime',
    endYear: String(retirementYear + 20),
    inflationAdjusted: false,
    expanded: true,
  };
}

interface RetirementPlannerProps {
  onBack: () => void;
  householdId: string | null;
  onNavigateToProfile?: (tab?: string) => void;
}

export function RetirementPlanner({ onBack, householdId, onNavigateToProfile }: RetirementPlannerProps) {
  const [financialProfile, setFinancialProfile] = useState<any>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [taxWithholdingState, setTaxWithholdingState] = useState<any>(null);
  const [budgetTotal, setBudgetTotal] = useState(0);
  const [showExpenseEstimator, setShowExpenseEstimator] = useState(false);
  const [aiEstimatingMember, setAiEstimatingMember] = useState<string | null>(null);
  const [showLongevityInfo, setShowLongevityInfo] = useState(false);
  const [showWhyFourPercent, setShowWhyFourPercent] = useState(false);
  const [collapsedPhases, setCollapsedPhases] = useState<Record<number, boolean>>({});
  const [cfpCollapsed, setCfpCollapsed] = useState(false);

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
    longevityAge: '90',
    memberAges: {} as Record<string, string>,
    ssBenefits: {} as Record<string, string>,
    ssClaimingAges: {} as Record<string, string>,
    otherIncomes: [] as OtherIncome[],
    // Section collapse state
    sectionAccountsOpen: true,
    sectionExpensesOpen: true,
    sectionIncomeOpen: true,
    sectionDetailedOpen: false,
  });

  const otherIncomes: OtherIncome[] = Array.isArray(state.otherIncomes) ? state.otherIncomes : [];

  const updateOtherIncome = useCallback((id: string, updates: Partial<OtherIncome>) => {
    const updated = otherIncomes.map(o => o.id === id ? { ...o, ...updates } : o);
    setState({ otherIncomes: updated });
  }, [otherIncomes, setState]);

  const addOtherIncome = useCallback(() => {
    const ry = Number(state.retirementYear) || (currentYear + 25);
    setState({ otherIncomes: [...otherIncomes, newOtherIncome(ry)] });
  }, [otherIncomes, state.retirementYear, currentYear, setState]);

  const removeOtherIncome = useCallback((id: string) => {
    setState({ otherIncomes: otherIncomes.filter(o => o.id !== id) });
  }, [otherIncomes, setState]);

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
      age: m.dob ? ageFromDob(m.dob) : (m.age ? Number(m.age) : undefined),
      income_type: m.income_type || 'W-2',
    }));
  }, [financialProfile]);

  // Debts from profile
  const totalMonthlyDebt = useMemo(() => {
    if (!financialProfile?.debts || !Array.isArray(financialProfile.debts)) return 0;
    return (financialProfile.debts as any[]).reduce((s, d) => s + (Number(d.monthly_payment || d.minimum_payment) || 0), 0);
  }, [financialProfile]);

  // Compute retirement-directed contributions from Financial Profile
  const profileContributions = useMemo(() => {
    if (!financialProfile?.monthly_additions_per_key) return null;
    const additions = financialProfile.monthly_additions_per_key as Record<string, number>;
    let preTax = 0, roth = 0, nqRetirement = 0;
    Object.entries(additions).forEach(([key, val]) => {
      const v = Number(val) || 0;
      if (key.startsWith('pretax_')) preTax += v;
      else if (key.startsWith('roth_')) roth += v;
      else if (key.endsWith('_retirement')) nqRetirement += v;
    });
    return { preTax, roth, nqRetirement };
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

    // Pre-populate contributions from Financial Profile
    if (profileContributions) {
      if (!state.preTaxContrib && profileContributions.preTax > 0) {
        updates.preTaxContrib = String(profileContributions.preTax);
      } else if (!state.preTaxContrib && taxWithholdingState?.retirementDeduction) {
        const perPaycheck = Number(taxWithholdingState.retirementDeduction) || 0;
        const freq = taxWithholdingState.payFrequency || 'biweekly';
        const periods: Record<string, number> = { weekly: 52, biweekly: 26, semimonthly: 24, monthly: 12 };
        const annual = perPaycheck * (periods[freq] || 26);
        updates.preTaxContrib = String(Math.round(annual / 12));
      }
      if (!state.rothContrib && profileContributions.roth > 0) {
        updates.rothContrib = String(profileContributions.roth);
      }
      if (!state.nonQualContrib && profileContributions.nqRetirement > 0) {
        updates.nonQualContrib = String(profileContributions.nqRetirement);
      }
    }

    if (members.length > 0 && Object.keys(state.ssClaimingAges).length === 0) {
      const claimingAges: Record<string, string> = {};
      members.forEach(m => { claimingAges[m.name] = '67'; });
      updates.ssClaimingAges = claimingAges;
    }

    if (Object.keys(updates).length) setState(updates);
    setInitialized(true);
  }, [toolStateLoaded, financialProfile, members, initialized, taxWithholdingState, profileContributions]);

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

  // 4% safe withdrawal rate
  const safeWithdrawalRate = 0.04;
  const monthlyPortfolioDraw = (projectedPortfolio * safeWithdrawalRate) / 12;
  const monthlyFromPortfolio = monthlyPortfolioDraw;

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

  // Longevity benchmark (user-configurable)
  const longevityAge = Math.max(80, Math.min(100, Number(state.longevityAge) || 90));

  // Resolved Other Income sources (start/end years computed; inflation applied if flagged)
  const resolvedOtherIncomes = useMemo(() => {
    return otherIncomes
      .filter(oi => Number(oi.monthlyAmount) > 0)
      .map(oi => {
        const startYr = oi.startMode === 'retirement' ? retirementYear : (Number(oi.startYear) || retirementYear);
        const endYr = oi.endMode === 'lifetime' ? Infinity : (Number(oi.endYear) || retirementYear);
        const baseAmount = Number(oi.monthlyAmount) || 0;
        // If inflation-adjusted, inflate today's $ to start year. If not, stay flat (nominal).
        const startAmount = oi.inflationAdjusted
          ? baseAmount * Math.pow(1 + inflationRate, Math.max(0, startYr - currentYear))
          : baseAmount;
        return { id: oi.id, name: oi.name || 'Other Income', startYr, endYr, startAmount, inflationAdjusted: oi.inflationAdjusted };
      });
  }, [otherIncomes, retirementYear, inflationRate, currentYear]);

  // Sum of other income active during a given calendar year (use mid-phase year)
  const otherIncomeAt = useCallback((year: number) => {
    return resolvedOtherIncomes
      .filter(oi => year >= oi.startYr && year <= oi.endYr)
      .reduce((s, oi) => {
        // If inflation-adjusted, grow from startYr to current year
        const amt = oi.inflationAdjusted
          ? oi.startAmount * Math.pow(1 + inflationRate, Math.max(0, year - oi.startYr))
          : oi.startAmount;
        return s + amt;
      }, 0);
  }, [resolvedOtherIncomes, inflationRate]);

  // Phase-based income projection using fixed 4% safe withdrawal rate
  const incomePhases = useMemo(() => {
    const retireAge = retirementAge;
    const totalRetirementYears = Math.max(1, longevityAge - retireAge);
    const endYear = retirementYear + totalRetirementYears;

    // Collect all transition years: retirement, SS claim years (when SS on), other income start/end years
    const transitionsSet = new Set<number>([retirementYear]);
    if (showSS) {
      ssDetails.perMember
        .filter(m => m.inflatedAdjusted > 0)
        .forEach(m => transitionsSet.add(Math.max(m.claimYear, retirementYear)));
    }
    resolvedOtherIncomes.forEach(oi => {
      if (oi.startYr >= retirementYear && oi.startYr <= endYear) transitionsSet.add(oi.startYr);
      if (isFinite(oi.endYr) && oi.endYr + 1 >= retirementYear && oi.endYr + 1 <= endYear) {
        transitionsSet.add(oi.endYr + 1); // phase boundary just after end
      }
    });
    const transitions = [...transitionsSet].filter(y => y >= retirementYear && y <= endYear).sort((a, b) => a - b);

    return transitions.map((start, i) => {
      const end = i < transitions.length - 1 ? transitions[i + 1] : endYear;
      const phaseYear = start; // SS/other income evaluated at phase start
      const activeSS = showSS
        ? ssDetails.perMember.filter(m => m.inflatedAdjusted > 0 && m.claimYear <= start)
        : [];
      const ssIncome = activeSS.reduce((s, m) => s + m.inflatedAdjusted, 0);
      const otherIncome = otherIncomeAt(phaseYear);
      const activeOther = resolvedOtherIncomes.filter(oi => phaseYear >= oi.startYr && phaseYear <= oi.endYr);
      const allSSActive = !showSS || ssDetails.perMember.filter(m => m.inflatedAdjusted > 0).every(m => m.claimYear <= start);

      // Build label
      let label: string;
      const isFinalPhase = i === transitions.length - 1;
      const range = isFinalPhase ? `${start}+` : `${start}–${end - 1}`;
      const tags: string[] = [];
      if (showSS && ssDetails.perMember.filter(m => m.inflatedAdjusted > 0).length > 0) {
        if (activeSS.length === 0) tags.push('pre-Social Security');
        else if (allSSActive) tags.push('with Social Security');
        else tags.push(`${activeSS.map(m => m.name).join(' + ')} SS`);
      }
      if (activeOther.length > 0) {
        tags.push(`+ ${activeOther.map(o => o.name).join(', ')}`);
      } else if (resolvedOtherIncomes.length > 0) {
        tags.push('portfolio + SS only');
      }
      label = tags.length > 0 ? `${range} (${tags.join(', ')})` : range;

      const totalIncome = monthlyPortfolioDraw + ssIncome + otherIncome;

      return {
        label,
        startYear: start,
        endYear: isFinalPhase ? null : end,
        durationYears: end - start,
        portfolioIncome: monthlyPortfolioDraw,
        ssIncome,
        otherIncome,
        otherIncomeBreakdown: activeOther.map(oi => ({
          name: oi.name,
          amount: oi.inflationAdjusted
            ? oi.startAmount * Math.pow(1 + inflationRate, Math.max(0, phaseYear - oi.startYr))
            : oi.startAmount,
        })),
        totalIncome,
        withdrawalRate: safeWithdrawalRate,
      };
    });
  }, [showSS, ssDetails, retirementYear, monthlyPortfolioDraw, retirementAge, longevityAge, resolvedOtherIncomes, otherIncomeAt, inflationRate]);


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
      const monthlyNeedFromPortfolio = Math.max(0, monthlyExpenses - phase.ssIncome - (phase.otherIncome || 0));
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
  // For withdrawal rate check, use the worst-phase (highest draw) rate
  const maxPhaseWithdrawalRate = incomePhases.reduce((max, p) => Math.max(max, p.withdrawalRate), 0);
  // But also check: is the phased plan sustainable? (lumpSumNeeded === 0 means yes)
  const withdrawalSustainable = lumpSumNeeded <= 0;
  const impliedWithdrawalRate = projectedPortfolio > 0 ? (monthlyExpenses * 12) / projectedPortfolio : 0;

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
    const debtSub = estDebtFree ? (estDebtOverride !== '' ? Number(estDebtOverride) : totalMonthlyDebt) : 0;
    const contribSub = estNoRetSavings ? (estContribOverride !== '' ? Number(estContribOverride) : monthlyContributions) : 0;
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
    incomePhases: incomePhases.map(p => ({ label: p.label, totalIncome: p.totalIncome, ssIncome: p.ssIncome, otherIncome: p.otherIncome || 0, otherIncomeBreakdown: p.otherIncomeBreakdown || [], portfolioIncome: p.portfolioIncome, withdrawalRate: p.withdrawalRate, durationYears: p.durationYears })),
    otherIncomeSources: resolvedOtherIncomes.map(oi => ({ name: oi.name, startYr: oi.startYr, endYr: isFinite(oi.endYr) ? oi.endYr : 'lifetime', startAmount: oi.startAmount, inflationAdjusted: oi.inflationAdjusted })),
    totalMonthlyIncome, monthlyExpenses, monthlyGap: totalMonthlyIncome - monthlyExpenses, savingsRate, salaryMultiple,
    rothPct, impliedWithdrawalRate, maxPhaseWithdrawalRate, withdrawalSustainable, additionalMonthlyNeeded, lumpSumNeeded,
  }), [memberRetirementInfo, members, retirementYear, retirementAge, yearsToRetirement, currentPreTax, currentRoth, currentNonQual, currentTotal,
    preTaxContrib, rothContrib, nonQualContrib, monthlyContributions, annualContributions, expectedReturn, inflationRate, projectedPortfolio,
    projectedPreTax, projectedRoth, projectedNonQual, monthlyFromPortfolio, showSS, ssDetails.total, incomePhases,
    totalMonthlyIncome, monthlyExpenses, savingsRate, salaryMultiple, rothPct, impliedWithdrawalRate, maxPhaseWithdrawalRate, withdrawalSustainable, additionalMonthlyNeeded, lumpSumNeeded]);

  // Reusable collapsible section component
  const Section = ({ title, summary, open, onOpenChange, defaultOpen, children }: {
    title: string;
    summary?: React.ReactNode;
    open?: boolean;
    onOpenChange?: (v: boolean) => void;
    defaultOpen?: boolean;
    children: React.ReactNode;
  }) => {
    const isOpen = open !== undefined ? open : defaultOpen;
    return (
      <Collapsible open={isOpen} onOpenChange={onOpenChange}>
        <div className="bg-card rounded-xl shadow-sm overflow-hidden">
          <CollapsibleTrigger className="w-full px-4 py-3 flex items-center gap-2 text-left active:opacity-70">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-foreground">{title}</p>
              {summary && <p className="text-[11px] text-muted-foreground truncate mt-0.5">{summary}</p>}
            </div>
            {isOpen ? <ChevronUp size={16} className="text-muted-foreground shrink-0" /> : <ChevronDown size={16} className="text-muted-foreground shrink-0" />}
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="px-4 pb-4 pt-1 border-t border-border">
              {children}
            </div>
          </CollapsibleContent>
        </div>
      </Collapsible>
    );
  };

  // Section summaries
  const incomeSourceCount = (showSS ? ssDetails.perMember.filter(m => m.inflatedAdjusted > 0).length : 0)
    + resolvedOtherIncomes.length;
  const fullSSPhase = incomePhases[incomePhases.length - 1];
  const fullSSIncome = fullSSPhase?.totalIncome || 0;

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
          <p className="text-sm text-muted-foreground mt-0.5">Will your savings sustain your lifestyle in retirement?</p>
        </div>
      </div>

      {/* Inputs */}
      <div className="px-6 mt-4 space-y-3">
        {/* === SECTION 1: Your Situation (always visible) === */}
        <div className="bg-card rounded-xl shadow-sm p-4 space-y-4">
          <p className="text-sm font-semibold text-foreground">Your Situation</p>
          {/* Member ages */}
          <div>
            <p className="text-[11px] text-muted-foreground mb-1.5">Current Ages</p>
            <div className={`grid gap-3 ${members.length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}>
              {members.map(m => {
                const age = state.memberAges?.[m.name];
                return (
                  <div key={m.name}>
                    <p className="text-[11px] text-muted-foreground">{members.length > 1 ? m.name : 'Your Age'}</p>
                    <p className="text-sm font-semibold text-foreground mt-0.5">{age ? `${age}` : '—'}</p>
                  </div>
                );
              })}
            </div>
            <button
              onClick={() => onNavigateToProfile ? onNavigateToProfile('profile') : onBack()}
              className="text-[11px] text-accent font-semibold mt-1.5 active:opacity-70"
            >
              From Financial Profile →
            </button>
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
        </div>

        {/* === SECTION 2: Retirement Accounts === */}
        <Section
          title="Retirement Accounts"
          summary={`${fmt(currentTotal)} balance · ${fmt(monthlyContributions)}/mo`}
          open={!!state.sectionAccountsOpen}
          onOpenChange={v => setState({ sectionAccountsOpen: v })}
        >
          <div className="space-y-4 pt-3">
            {/* Current Balances */}
            <div>
              <p className="text-[11px] text-muted-foreground mb-1.5">Current Retirement Balances</p>
              <div className="space-y-1.5">
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
              <button
                onClick={() => onNavigateToProfile ? onNavigateToProfile('accounts') : onBack()}
                className="text-[11px] text-accent font-semibold mt-1.5 active:opacity-70"
              >
                From Financial Profile →
              </button>
            </div>

            {/* Monthly contributions */}
            <div>
              <p className="text-[11px] text-muted-foreground mb-1.5">Monthly Retirement Contributions</p>
              <div className="space-y-1.5">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-[11px] text-muted-foreground">Pre-Tax</p>
                    <p className="text-sm font-semibold text-foreground mt-0.5">{fmt(preTaxContrib)}</p>
                  </div>
                  <div>
                    <p className="text-[11px] text-muted-foreground">Roth</p>
                    <p className="text-sm font-semibold text-foreground mt-0.5">{fmt(rothContrib)}</p>
                  </div>
                </div>
                <div className="pt-1">
                  <p className="text-[11px] text-muted-foreground">Non-Qualified (Brokerage/Taxable)</p>
                  <p className="text-sm font-semibold text-foreground mt-0.5">{fmt(nonQualContrib)}</p>
                </div>
                <div className="flex justify-between text-sm border-t border-border pt-1.5">
                  <span className="text-muted-foreground font-semibold">Combined Monthly</span>
                  <span className="font-bold text-foreground">{fmt(monthlyContributions)}</span>
                </div>
              </div>
              <button
                onClick={() => onNavigateToProfile ? onNavigateToProfile('accounts') : onBack()}
                className="text-[11px] text-accent font-semibold mt-1.5 active:opacity-70"
              >
                From Financial Profile →
              </button>
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

            {/* Inflation rate (advanced) */}
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
          </div>
        </Section>

        {/* === SECTION 3: Retirement Expenses === */}
        <Section
          title="Retirement Expenses"
          summary={monthlyExpenses > 0 ? `${fmt(monthlyExpenses)}/mo (in ${retirementYear} dollars)` : 'Not set'}
          open={!!state.sectionExpensesOpen}
          onOpenChange={v => setState({ sectionExpensesOpen: v })}
        >
          <div className="pt-3">
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
        </Section>

        {/* === SECTION 4: Retirement Income === */}
        <Section
          title="Retirement Income"
          summary={incomeSourceCount > 0
            ? `${incomeSourceCount} source${incomeSourceCount === 1 ? '' : 's'} · ${fmt(fullSSIncome)}/mo at full SS`
            : 'No additional income sources'}
          open={!!state.sectionIncomeOpen}
          onOpenChange={v => setState({ sectionIncomeOpen: v })}
        >
          <div className="space-y-4 pt-3">
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
                      <div key={m.name} className="bg-muted/40 rounded-xl p-3 space-y-2">
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
                          <div className="relative text-[10px] text-muted-foreground mt-0.5 h-3">
                            <span className="absolute left-0">62</span>
                            <span className="absolute" style={{ left: `${((67 - 62) / (70 - 62)) * 100}%`, transform: 'translateX(-50%)' }}>67</span>
                            <span className="absolute right-0">70</span>
                          </div>
                          <p className={`text-[10px] mt-0.5 ${note.color}`}>{note.text}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Other Retirement Income */}
            <div>
              <Label className="text-xs text-muted-foreground">Other Retirement Income</Label>
              <p className="text-[10px] text-muted-foreground mt-0.5">Pensions, rental income, part-time work, etc.</p>
              <div className="mt-2 space-y-2">
                {otherIncomes.map(oi => (
                  <Collapsible key={oi.id} open={oi.expanded} onOpenChange={(open) => updateOtherIncome(oi.id, { expanded: open })}>
                    <div className="bg-muted/40 rounded-xl overflow-hidden">
                      <CollapsibleTrigger className="w-full px-3 py-2.5 flex items-center gap-2 text-left">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold text-foreground truncate">{oi.name || 'Other Income'}</p>
                          <p className="text-[10px] text-muted-foreground truncate">
                            {fmt(Number(oi.monthlyAmount) || 0)}/mo · {oi.startMode === 'retirement' ? 'At retirement' : oi.startYear}–{oi.endMode === 'lifetime' ? 'Lifetime' : oi.endYear}
                            {oi.inflationAdjusted ? ' · inflation-adjusted' : ''}
                          </p>
                        </div>
                        {oi.expanded ? <ChevronUp size={14} className="text-muted-foreground shrink-0" /> : <ChevronDown size={14} className="text-muted-foreground shrink-0" />}
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <div className="px-3 pb-3 space-y-2.5 border-t border-border pt-2.5">
                          <div>
                            <Label className="text-[11px] text-muted-foreground">Source Name</Label>
                            <Input value={oi.name} onChange={e => updateOtherIncome(oi.id, { name: e.target.value })} placeholder="e.g. Joe's Pension" className="h-9 text-sm mt-1" />
                          </div>
                          <div>
                            <Label className="text-[11px] text-muted-foreground">Monthly Amount</Label>
                            <div className="relative mt-1">
                              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
                              <Input type="number" value={oi.monthlyAmount} onChange={e => updateOtherIncome(oi.id, { monthlyAmount: e.target.value })} placeholder="0" className="h-9 text-sm pl-7" />
                            </div>
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <Label className="text-[11px] text-muted-foreground">Start</Label>
                              <div className="flex bg-muted rounded-full p-0.5 mt-1">
                                <button type="button" onClick={() => updateOtherIncome(oi.id, { startMode: 'retirement' })} className={`flex-1 text-[10px] font-medium px-2 py-1 rounded-full ${oi.startMode === 'retirement' ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground'}`}>At Retirement</button>
                                <button type="button" onClick={() => updateOtherIncome(oi.id, { startMode: 'year' })} className={`flex-1 text-[10px] font-medium px-2 py-1 rounded-full ${oi.startMode === 'year' ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground'}`}>Year</button>
                              </div>
                              {oi.startMode === 'year' && (
                                <Input type="number" value={oi.startYear} onChange={e => updateOtherIncome(oi.id, { startYear: e.target.value })} className="h-8 text-xs mt-1" min={currentYear} max={currentYear + 60} />
                              )}
                            </div>
                            <div>
                              <Label className="text-[11px] text-muted-foreground">End</Label>
                              <div className="flex bg-muted rounded-full p-0.5 mt-1">
                                <button type="button" onClick={() => updateOtherIncome(oi.id, { endMode: 'lifetime' })} className={`flex-1 text-[10px] font-medium px-2 py-1 rounded-full ${oi.endMode === 'lifetime' ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground'}`}>Lifetime</button>
                                <button type="button" onClick={() => updateOtherIncome(oi.id, { endMode: 'year' })} className={`flex-1 text-[10px] font-medium px-2 py-1 rounded-full ${oi.endMode === 'year' ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground'}`}>Year</button>
                              </div>
                              {oi.endMode === 'year' && (
                                <Input type="number" value={oi.endYear} onChange={e => updateOtherIncome(oi.id, { endYear: e.target.value })} className="h-8 text-xs mt-1" min={currentYear} max={currentYear + 80} />
                              )}
                            </div>
                          </div>
                          <div className="flex items-center justify-between">
                            <Label className="text-[11px] text-muted-foreground">Inflation-Adjusted (3%/yr)</Label>
                            <Switch checked={oi.inflationAdjusted} onCheckedChange={(v) => updateOtherIncome(oi.id, { inflationAdjusted: v })} />
                          </div>
                          <div className="flex justify-end">
                            <button type="button" onClick={() => removeOtherIncome(oi.id)} className="flex items-center gap-1 text-[11px] text-destructive active:opacity-70">
                              <Trash2 size={11} /> Remove
                            </button>
                          </div>
                        </div>
                      </CollapsibleContent>
                    </div>
                  </Collapsible>
                ))}
                <button type="button" onClick={addOtherIncome} className="w-full flex items-center justify-center gap-1.5 py-2 rounded-xl border-2 border-dashed border-border text-xs font-semibold text-muted-foreground hover:border-accent hover:text-accent transition-colors active:scale-[0.98]">
                  <Plus size={14} /> Add Income Source
                </button>
              </div>
            </div>
          </div>
        </Section>
      </div>

      {/* === SECTION 5: Your Retirement Picture (always visible) === */}
      {currentAge > 0 && (
        <div className="px-6 mt-6">
          <h2 className="font-display text-base font-bold text-foreground mb-3">Your Retirement Picture</h2>

          {/* Summary Card */}
          {monthlyExpenses > 0 && (() => {
            const finalPhase = incomePhases[incomePhases.length - 1];
            const summaryIncome = finalPhase.totalIncome;
            const surplus = summaryIncome - monthlyExpenses;
            const onTrack = surplus >= 0 && lumpSumNeeded <= 0;
            return (
              <div className={`rounded-xl shadow-sm p-4 mb-3 border-2 ${onTrack ? 'border-green-500/30 bg-green-50/50 dark:bg-green-950/20' : 'border-destructive/30 bg-red-50/50 dark:bg-red-950/20'}`}>
                <div className="space-y-1.5">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Projected Monthly Income</span>
                    <span className="font-semibold text-foreground">{fmt(summaryIncome)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Estimated Monthly Expenses</span>
                    <span className="font-semibold text-foreground">{fmt(monthlyExpenses)}</span>
                  </div>
                  <div className="flex justify-between text-sm border-t border-border pt-1.5">
                    <span className="text-muted-foreground font-semibold">Monthly {surplus >= 0 ? 'Surplus' : 'Gap'}</span>
                    <span className={`font-bold ${surplus >= 0 ? 'text-green-600' : 'text-destructive'}`}>
                      {surplus >= 0 ? '+' : '-'}{fmt(Math.abs(surplus))}/mo
                    </span>
                  </div>
                </div>
                <div className={`flex items-center gap-2 mt-3 pt-2 border-t border-border`}>
                  <span className={`text-lg ${onTrack ? '' : ''}`}>{onTrack ? '✅' : '🚩'}</span>
                  <p className={`text-sm font-semibold ${onTrack ? 'text-green-600' : 'text-destructive'}`}>
                    {onTrack ? 'On Track for Retirement' : 'Retirement Gap Detected'}
                  </p>
                </div>
              </div>
            );
          })()}

          {/* Timeline bar */}
          <div className="bg-card rounded-xl shadow-sm p-4 mb-3">
            <div className="flex items-center justify-between text-[10px] text-muted-foreground mb-1">
              <span>Today ({currentAge})</span>
              <span>Retire ({retirementYear})</span>
              <span className="flex items-center gap-0.5">
                Age {longevityAge}
                <button
                  onClick={() => setShowLongevityInfo(v => !v)}
                  className="text-accent active:opacity-70"
                >
                  <Info size={10} />
                </button>
              </span>
            </div>
            {showLongevityInfo && (
              <div className="bg-muted/60 rounded-lg p-3 mb-2 text-[11px] text-muted-foreground leading-relaxed">
                <p>We use age {longevityAge} as a planning benchmark because average life expectancy continues to rise, and a Certified Financial Planner (CFP) best practice is to plan for a longer-than-average retirement to avoid outliving your savings. If you retire at {retirementAge}, your plan needs to sustain roughly {longevityAge - retirementAge} years of withdrawals. Planning to age {longevityAge} gives you a meaningful buffer. If longevity runs in your family, consider extending this benchmark to 95 or even 100 — your Retirement Planner will show you how the math changes.</p>
                <button onClick={() => setShowLongevityInfo(false)} className="text-accent font-semibold mt-1.5">Got it</button>
              </div>
            )}
            <div className="relative h-3 bg-muted rounded-full overflow-hidden">
              {(() => {
                const totalSpan = longevityAge - currentAge;
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
            <div className="flex items-center gap-2 mt-2">
              <Label className="text-[10px] text-muted-foreground whitespace-nowrap">Longevity Benchmark</Label>
              <Slider
                value={[longevityAge]}
                onValueChange={([v]) => setState({ longevityAge: String(v) })}
                min={80}
                max={100}
                step={1}
                className="flex-1"
              />
              <span className="text-xs font-semibold text-foreground w-6 text-right">{longevityAge}</span>
            </div>
          </div>

          {/* Projections */}
          <div className="bg-card rounded-xl shadow-sm p-4 mb-3">
            <p className="text-sm font-semibold text-foreground mb-2">Projected Portfolio at Retirement</p>
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
            <p className="text-sm font-semibold text-foreground mb-2">Projected Monthly Retirement Income</p>
            <p className="text-[10px] text-muted-foreground mb-3">All amounts in {retirementYear} dollars (inflation-adjusted)</p>
            {incomePhases.map((phase, i) => {
              const phaseGap = phase.totalIncome - monthlyExpenses;
              const isCollapsed = !!collapsedPhases[i];
              return (
                <Collapsible
                  key={i}
                  open={!isCollapsed}
                  onOpenChange={(open) => setCollapsedPhases(prev => ({ ...prev, [i]: !open }))}
                >
                  <div className={`${i > 0 ? 'mt-3 pt-3 border-t border-border' : ''}`}>
                    <CollapsibleTrigger className="w-full flex items-center justify-between mb-1.5 active:opacity-70">
                      <div className="flex items-center gap-1.5 min-w-0">
                        {isCollapsed ? <ChevronDown size={12} className="text-muted-foreground shrink-0" /> : <ChevronUp size={12} className="text-muted-foreground shrink-0" />}
                        <p className="text-[11px] font-semibold text-muted-foreground truncate text-left">{phase.label}</p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-xs font-bold text-foreground">{fmt(phase.totalIncome)}</span>
                        {monthlyExpenses > 0 && (
                          <span className={`text-[11px] font-semibold ${phaseGap >= 0 ? 'text-green-600' : 'text-destructive'}`}>
                            {phaseGap >= 0 ? '+' : '-'}{fmt(Math.abs(phaseGap))}
                          </span>
                        )}
                      </div>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <div className="space-y-1">
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">
                            Portfolio draw
                            <span className="ml-1 text-[10px] text-muted-foreground">
                              ({pct(safeWithdrawalRate)}/yr)
                            </span>
                            {monthlyExpenses > 0 && phaseGap < 0 && (() => {
                              const impliedRate = projectedPortfolio > 0 ? ((monthlyExpenses - phase.ssIncome - (phase.otherIncome || 0)) * 12) / projectedPortfolio : 0;
                              return (
                                <span className="ml-1 text-[10px] text-yellow-600">
                                  — would need {pct(impliedRate)}/yr
                                </span>
                              );
                            })()}
                          </span>
                          <span className="font-semibold text-foreground">{fmt(phase.portfolioIncome)}</span>
                        </div>
                        {i === 0 && (
                          <div>
                            <button
                              onClick={() => setShowWhyFourPercent(v => !v)}
                              className="text-[10px] font-semibold text-accent active:opacity-70"
                            >
                              {showWhyFourPercent ? 'Hide' : 'Why 4%?'}
                            </button>
                            {showWhyFourPercent && (
                              <div className="bg-muted/60 rounded-lg p-2.5 mt-1 text-[11px] text-muted-foreground leading-relaxed">
                                The 4% rule comes from the Trinity Study, a landmark 1994 research study that analyzed historical market returns. It found that retirees who withdrew 4% of their portfolio in year one — then adjusted for inflation annually — had a very high probability of their money lasting 30 years across various market conditions, including downturns. It has become the standard Certified Financial Planner (CFP) benchmark for sustainable retirement income. Some planners use 3.5% for longer retirements or uncertain markets, and up to 5% for shorter ones.
                              </div>
                            )}
                          </div>
                        )}
                        {phase.ssIncome > 0 && (
                          <div className="flex justify-between text-sm">
                            <span className="text-muted-foreground">Social Security</span>
                            <span className="font-semibold text-foreground">{fmt(phase.ssIncome)}</span>
                          </div>
                        )}
                        {phase.otherIncomeBreakdown && phase.otherIncomeBreakdown.map((oi, j) => (
                          <div key={j} className="flex justify-between text-sm">
                            <span className="text-muted-foreground">{oi.name}</span>
                            <span className="font-semibold text-foreground">{fmt(oi.amount)}</span>
                          </div>
                        ))}
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
                    </CollapsibleContent>
                  </div>
                </Collapsible>
              );
            })}
            {showSS && incomePhases.length > 1 && (
              <p className="text-[10px] text-muted-foreground mt-3 italic">
                Portfolio draw uses a fixed 4% safe withdrawal rate. Income increases when Social Security begins.
              </p>
            )}
          </div>

          {/* Gap / Surplus summary */}
          {monthlyExpenses > 0 && lumpSumNeeded > 0 && (
            <div className="bg-card rounded-xl shadow-sm p-4 mb-3">
              <p className="text-sm font-semibold text-foreground mb-2">Closing the Income Gap</p>
              <div className="bg-muted/50 rounded-lg p-3 space-y-1">
                <p className="text-xs text-muted-foreground">
                  To fully fund all phases through age {longevityAge}: save an additional <span className="font-semibold text-foreground">{fmt(additionalMonthlyNeeded)}/mo</span>, or accumulate <span className="font-semibold text-foreground">{fmt(lumpSumNeeded)}</span> more by retirement.
                </p>
              </div>
            </div>
          )}

          {/* CFP Guidelines */}
          {(() => {
            const checks = [
              savingsRateOk,
              salaryMultiple >= 10,
              !rothSkewed,
              yearsToRetirement >= 30,
              ...(monthlyExpenses > 0 ? [withdrawalSustainable] : []),
            ];
            const onTrackCount = checks.filter(Boolean).length;
            const totalCount = checks.length;
            return (
              <Collapsible open={!cfpCollapsed} onOpenChange={(open) => setCfpCollapsed(!open)}>
                <div className="bg-card rounded-xl shadow-sm p-4 mb-3">
                  <CollapsibleTrigger className="w-full flex items-center justify-between active:opacity-70">
                    <p className="text-sm font-semibold text-foreground text-left">
                      Certified Financial Planner (CFP®) Guidelines
                    </p>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className={`text-xs font-semibold ${onTrackCount === totalCount ? 'text-green-600' : onTrackCount >= totalCount - 1 ? 'text-yellow-600' : 'text-destructive'}`}>
                        {onTrackCount} of {totalCount} on track
                      </span>
                      {cfpCollapsed ? <ChevronDown size={14} className="text-muted-foreground" /> : <ChevronUp size={14} className="text-muted-foreground" />}
                    </div>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="space-y-3 mt-3">
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
                    Rule of thumb: 10x your projected final salary ({fmt(finalSalary)}) = {fmt(finalSalary * 10)} benchmark. Your projected portfolio: {fmt(projectedPortfolio)}.
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

              {/* Investment Approach based on time horizon */}
              {(() => {
                let horizonLabel: string;
                let horizonBody: string;
                let dotColor: string;
                if (yearsToRetirement >= 30) {
                  horizonLabel = 'Long Time Horizon';
                  horizonBody = 'Generally, longer runways allow for more growth-oriented investing. Short-term volatility matters less when retirement is decades away.';
                  dotColor = 'bg-green-500';
                } else if (yearsToRetirement >= 10) {
                  horizonLabel = 'Mid-Range Horizon';
                  horizonBody = 'A balanced approach that tilts toward growth while beginning to think about protecting what you\'ve built may be appropriate as retirement draws closer.';
                  dotColor = 'bg-yellow-500';
                } else if (yearsToRetirement >= 5) {
                  horizonLabel = 'Approaching Retirement';
                  horizonBody = 'Many planners suggest gradually shifting toward a more conservative mix as retirement nears to reduce sequence-of-returns risk.';
                  dotColor = 'bg-yellow-500';
                } else {
                  horizonLabel = 'Near Retirement';
                  horizonBody = 'Protecting accumulated wealth typically becomes a priority. This is a critical time to review your allocation with a professional.';
                  dotColor = 'bg-destructive';
                }
                return (
                  <div className="flex items-start gap-2">
                    <div className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${dotColor}`} />
                    <div>
                      <p className="text-sm font-semibold text-foreground">
                        Investment Approach: {horizonLabel}
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">{horizonBody}</p>
                      <p className="text-[10px] text-muted-foreground/60 mt-1 italic">
                        Asset allocation is highly personal. A Certified Financial Planner (CFP®) can help you determine the right approach for your specific situation.
                      </p>
                    </div>
                  </div>
                );
              })()}

              {monthlyExpenses > 0 && (
                <div className="flex items-start gap-2">
                  <div className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${withdrawalSustainable ? 'bg-green-500' : 'bg-destructive'}`} />
                  <div>
                    <p className={`text-sm font-semibold ${withdrawalSustainable ? 'text-green-600' : 'text-destructive'}`}>
                      {showSS && incomePhases.length > 1
                        ? `Phased Withdrawal: ${pct(maxPhaseWithdrawalRate)} peak`
                        : `Withdrawal Rate: ${pct(impliedWithdrawalRate)}`}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {withdrawalSustainable
                        ? showSS && incomePhases.length > 1
                          ? `Your phased plan is sustainable — higher draws pre-SS (${pct(maxPhaseWithdrawalRate)}) drop once Social Security kicks in.`
                          : 'Your projected expenses are sustainable under the 4% safe withdrawal rate.'
                        : showSS && incomePhases.length > 1
                          ? `Even with phased withdrawals accounting for SS, your portfolio may not last through age 90. Consider increasing contributions.`
                          : `A ${pct(impliedWithdrawalRate)} withdrawal rate exceeds the 4% guideline — your portfolio may not last through retirement.`}
                    </p>
                  </div>
                </div>
              )}
                    </div>
                  </CollapsibleContent>
                </div>
              </Collapsible>
            );
          })()}
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
                  {totalMonthlyDebt > 0 && (
                    <p className="text-[10px] text-muted-foreground mt-1">
                      Based on {fmt(totalMonthlyDebt)}/mo in debt payments from Financial Profile.
                    </p>
                  )}
                  <div className="flex justify-between text-xs text-muted-foreground mt-1">
                    <span>Subtotal after debt</span>
                    <span className="font-semibold text-foreground">{fmt(budgetTotal - (estDebtOverride !== '' ? Number(estDebtOverride) : totalMonthlyDebt))}</span>
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
                  {monthlyContributions > 0 && (
                    <p className="text-[10px] text-muted-foreground mt-1">
                      Based on {fmt(monthlyContributions)}/mo in retirement contributions from Financial Profile.
                    </p>
                  )}
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
