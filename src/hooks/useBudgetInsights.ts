import { useState, useCallback, useRef, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { BudgetCategory, FixedExpense, GIVING_VARIABLE_CATEGORY, Transaction } from '@/types/budget';
import { differenceInDays, startOfMonth, addMonths, format } from 'date-fns';

export interface Insight {
  type: 'warning' | 'encouragement' | 'tip' | 'giving' | 'savings';
  title: string;
  body: string;
}

interface CategoryChange {
  name: string;
  slug: string;
  currentSpent: number;
  priorSpent: number;
  dollarChange: number;
  percentChange: number;
}

interface PriorMonthData {
  month: string;
  spentByCategory: Record<string, number>;
}

interface BudgetSummary {
  currentMonthKey: string;
  currentMonth: string;
  daysRemaining: number;
  totalBudget: number;
  totalCommitted: number;
  variableCategories: { name: string; budgeted: number; spent: number; percentUsed: number }[];
  fixedBills: { name: string; amount: number; paid: boolean; amountPaid: number }[];
  totalGiving: number;
  totalGivingBudgeted: number;
  givingBreakdown: { name: string; budgeted: number; spent: number; type: 'fixed' | 'variable' }[];
  givingPercentOfSpending: number;
  savingsBuckets: { name: string; amount: number; contributed: number }[];
  accountTotals: { label: string; amount: number }[];
  unassignedCount: number;
  priorMonth?: PriorMonthData;
  categoryChanges?: CategoryChange[];
  incomeData?: {
    netIncome?: number;
    incomeType?: string;
    filingStatus?: string;
    stateCode?: string;
    annualGrossIncome?: number;
    grossIncome?: number;
    retirementContribution?: number;
    retirementRate?: number;
    partnerAnnualGrossIncome?: number;
    partnerGrossIncome?: number;
    partnerNetPay?: number;
    partnerRetirementContribution?: number;
    partnerRetirementRate?: number;
    combinedAnnualGrossIncome?: number;
    combinedGrossIncome?: number;
    combinedNetPay?: number;
    combinedRetirementContribution?: number;
  };
  financialProfile?: {
    member_incomes: { name: string; gross_income: number; income_type: string }[];
    filing_status: string;
    state: string | null;
    housing_type: string;
    mortgage_balance: number;
    mortgage_payment: number;
    mortgage_rate: number;
    monthly_rent: number;
    debts: any[];
    non_retirement_investments: number;
    retirement_balance: number;
    roth_retirement_balance: number;
    emergency_fund_balance: number;
    has_life_insurance: boolean;
    life_insurance_coverage: number;
    life_insurance_coverages: { name: string; coverage: number }[];
  };
}

async function buildBudgetSummary(
  activeMonth: string,
  categories: BudgetCategory[],
  fixedExpenses: FixedExpense[],
  monthTransactions: Transaction[],
  spentByCategory: Record<string, number>,
  transferAdjustments: Record<string, number>,
  accountSpending: { label: string; amount: number }[],
  unassignedCount: number,
  totalBudget: number,
  householdId: string,
  planningData: Record<string, string>,
): Promise<BudgetSummary> {
  const today = new Date();
  const nextMonth = startOfMonth(addMonths(today, 1));
  const daysRemaining = differenceInDays(nextMonth, today);

  const variableCategories = categories.map(c => {
    const raw = spentByCategory[c.id] || 0;
    const adj = transferAdjustments[c.id] || 0;
    const spent = raw;
    const effectiveBudget = c.budgeted + adj;
    return {
      name: c.name,
      budgeted: effectiveBudget,
      spent,
      percentUsed: effectiveBudget > 0 ? Math.round((spent / effectiveBudget) * 100) : 0,
    };
  });

  const fixedBills = fixedExpenses.map(e => {
    const spent = spentByCategory[e.id] || 0;
    return {
      name: e.name,
      amount: e.amount,
      paid: spent >= e.amount * 0.95,
      amountPaid: spent,
    };
  });

  const givingCats = categories.filter(c => c.group === 'giving' || c.id === GIVING_VARIABLE_CATEGORY);
  const givingFixed = fixedExpenses.filter(e => e.group === 'tithe');
  const totalGivingSpent = [...givingCats, ...givingFixed].reduce((s, c) => s + (spentByCategory[c.id] || 0), 0);
  const totalGivingBudgeted = givingCats.reduce((s, c) => s + c.budgeted, 0) + givingFixed.reduce((s, e) => s + e.amount, 0);
  const totalSpent = Object.values(spentByCategory).reduce((s, v) => s + v, 0);

  const savingsBuckets = fixedExpenses.filter(e => e.group === 'savings').map(e => ({
    name: e.name,
    amount: e.amount,
    contributed: spentByCategory[e.id] || 0,
  }));

  const givingBreakdown = [
    ...givingFixed.map(e => ({ name: e.name, budgeted: e.amount, spent: spentByCategory[e.id] || 0, type: 'fixed' as const })),
    ...givingCats.map(c => ({ name: c.name, budgeted: c.budgeted, spent: spentByCategory[c.id] || 0, type: 'variable' as const })),
  ];

  let priorMonth: PriorMonthData | undefined;
  let categoryChanges: CategoryChange[] | undefined;

  if (householdId) {
    const { data: snapData } = await supabase
      .from('budget_month_snapshots')
      .select('month, transactions_summary')
      .eq('household_id', householdId)
      .lt('month', activeMonth)
      .order('month', { ascending: false })
      .limit(1);

    if (snapData && snapData.length > 0) {
      const snap = snapData[0];
      const summary = snap.transactions_summary as Record<string, unknown> | null;
      const priorSpent = (summary?.spentByCategory as Record<string, number>) || {};
      const priorTotal = Object.values(priorSpent).reduce((s, v) => s + v, 0);

      if (priorTotal > 0) {
        const d = new Date(snap.month + '-01T00:00:00');
        priorMonth = {
          month: format(d, 'MMMM yyyy'),
          spentByCategory: priorSpent,
        };

        const nameMap: Record<string, string> = {};
        categories.forEach(c => { nameMap[c.id] = c.name; });
        fixedExpenses.forEach(e => { nameMap[e.id] = e.name; });

        const allSlugs = new Set([...Object.keys(spentByCategory), ...Object.keys(priorSpent)]);
        const changes: CategoryChange[] = [];
        for (const slug of allSlugs) {
          const cur = spentByCategory[slug] || 0;
          const prev = priorSpent[slug] || 0;
          const dollarChange = cur - prev;
          if (Math.abs(dollarChange) > 10) {
            changes.push({
              name: nameMap[slug] || slug,
              slug,
              currentSpent: cur,
              priorSpent: prev,
              dollarChange,
              percentChange: prev > 0 ? Math.round((dollarChange / prev) * 100) : (cur > 0 ? 100 : 0),
            });
          }
        }
        changes.sort((a, b) => Math.abs(b.dollarChange) - Math.abs(a.dollarChange));
        categoryChanges = changes;
      }
    }
  }

  const incomeMode = planningData.incomeMode || 'net';
  const netIncome = parseFloat(planningData.netIncome || '0') || 0;
  const incomeTypeVal = planningData.incomeType || 'w2';
  const filingStatusVal = planningData.filingStatus || 'single';
  const stateCodeVal = planningData.stateCode || '';

  const freqMultipliers: Record<string, number> = { monthly: 1, semimonthly: 2, biweekly: 26 / 12, weekly: 52 / 12 };
  const freqPeriods: Record<string, number> = { monthly: 12, semimonthly: 24, biweekly: 26, weekly: 52 };
  const primaryFreq = planningData.payFrequency || 'monthly';
  const partnerFreq = planningData.partnerPayFrequency || 'monthly';
  const primaryMult = freqMultipliers[primaryFreq] || 1;
  const partnerMult = freqMultipliers[partnerFreq] || 1;
  const primaryPeriods = freqPeriods[primaryFreq] || 12;
  const partnerPeriods = freqPeriods[partnerFreq] || 12;

  const primaryAnnualGross = parseFloat(planningData.grossPay || '0') || 0;
  const primaryMonthlyGross = primaryAnnualGross / 12;
  const primaryPerPaycheckGross = primaryAnnualGross / primaryPeriods;
  const primaryRetirement = (parseFloat(planningData.retirementAmt || '0') || 0) * primaryMult;
  const primarySavingsDed = (parseFloat(planningData.savingsDeductions || '0') || 0) * primaryMult;
  const primaryOtherDed = (parseFloat(planningData.otherDeductions || '0') || 0) * primaryMult;
  const primaryFedTax = (parseFloat(planningData.fedTaxAmt || '0') || 0) * primaryMult;
  const primarySsTax = (parseFloat(planningData.ssTaxAmt || '0') || 0) * primaryMult;
  const primaryMedicare = (parseFloat(planningData.medicareAmt || '0') || 0) * primaryMult;
  const primaryStateTax = (parseFloat(planningData.stateTaxAmt || '0') || 0) * primaryMult;
  const primaryNetPay = primaryMonthlyGross - primaryFedTax - primarySsTax - primaryMedicare - primaryStateTax - primaryRetirement - primarySavingsDed - primaryOtherDed;

  const partnerEnabled = planningData.partnerEnabled === 'true';
  const partnerAnnualGross = parseFloat(planningData.partnerGrossPay || '0') || 0;
  const partnerMonthlyGross = partnerAnnualGross / 12;
  const partnerRetirement = (parseFloat(planningData.partnerRetirementAmt || '0') || 0) * partnerMult;
  const partnerSavingsDed = (parseFloat(planningData.partnerSavingsDeductions || '0') || 0) * partnerMult;
  const partnerOtherDed = (parseFloat(planningData.partnerOtherDeductions || '0') || 0) * partnerMult;
  const partnerFedTax = (parseFloat(planningData.partnerFedTaxAmt || '0') || 0) * partnerMult;
  const partnerSsTax = (parseFloat(planningData.partnerSsTaxAmt || '0') || 0) * partnerMult;
  const partnerMedicare = (parseFloat(planningData.partnerMedicareAmt || '0') || 0) * partnerMult;
  const partnerStateTax = (parseFloat(planningData.partnerStateTaxAmt || '0') || 0) * partnerMult;
  const partnerNetPay = partnerMonthlyGross - partnerFedTax - partnerSsTax - partnerMedicare - partnerStateTax - partnerRetirement - partnerSavingsDed - partnerOtherDed;

  const incomeData: BudgetSummary['incomeData'] = {};
  if (netIncome > 0) incomeData.netIncome = netIncome;
  incomeData.incomeType = incomeTypeVal;
  incomeData.filingStatus = filingStatusVal;
  if (stateCodeVal) incomeData.stateCode = stateCodeVal;
  if (primaryAnnualGross > 0) {
    incomeData.annualGrossIncome = primaryAnnualGross;
    incomeData.grossIncome = primaryMonthlyGross;

    if (partnerEnabled && partnerAnnualGross > 0) {
      incomeData.partnerAnnualGrossIncome = partnerAnnualGross;
      incomeData.partnerGrossIncome = partnerMonthlyGross;
      incomeData.combinedAnnualGrossIncome = primaryAnnualGross + partnerAnnualGross;
      incomeData.combinedGrossIncome = primaryMonthlyGross + partnerMonthlyGross;
    }

    if (incomeMode === 'gross') {
      incomeData.retirementContribution = primaryRetirement;
      incomeData.retirementRate = primaryMonthlyGross > 0 ? (primaryRetirement / primaryMonthlyGross) * 100 : 0;

      if (partnerEnabled && partnerAnnualGross > 0) {
        incomeData.partnerNetPay = partnerNetPay;
        incomeData.partnerRetirementContribution = partnerRetirement;
        incomeData.partnerRetirementRate = partnerMonthlyGross > 0 ? (partnerRetirement / partnerMonthlyGross) * 100 : 0;
        incomeData.combinedNetPay = primaryNetPay + partnerNetPay;
        incomeData.combinedRetirementContribution = primaryRetirement + partnerRetirement;
      }
    }
  }

  let financialProfile: BudgetSummary['financialProfile'] | undefined;
  if (householdId) {
    const { data: fpData } = await supabase
      .from('financial_profiles')
      .select('*')
      .eq('household_id', householdId)
      .maybeSingle();
    if (fpData) {
      financialProfile = {
        member_incomes: Array.isArray(fpData.member_incomes)
          ? (fpData.member_incomes as any[]).map((m: any) => ({ name: m.name, gross_income: m.gross_income, income_type: m.income_type }))
          : [],
        filing_status: (fpData as any).filing_status || 'single',
        state: (fpData as any).state || null,
        housing_type: fpData.housing_type,
        mortgage_balance: Number(fpData.mortgage_balance) || 0,
        mortgage_payment: Number(fpData.mortgage_payment) || 0,
        mortgage_rate: Number(fpData.mortgage_rate) || 0,
        monthly_rent: Number(fpData.monthly_rent) || 0,
        debts: Array.isArray(fpData.debts) ? fpData.debts : [],
        non_retirement_investments: Number((fpData as any).non_retirement_investments) || 0,
        retirement_balance: Number(fpData.retirement_balance) || 0,
        roth_retirement_balance: Number((fpData as any).roth_retirement_balance) || 0,
        emergency_fund_balance: Number(fpData.emergency_fund_balance) || 0,
        has_life_insurance: !!fpData.has_life_insurance,
        life_insurance_coverage: Number(fpData.life_insurance_coverage) || 0,
        life_insurance_coverages: Array.isArray((fpData as any).life_insurance_coverages)
          ? ((fpData as any).life_insurance_coverages as any[]).map((c: any) => ({ name: c.name, coverage: c.coverage }))
          : [],
      };
    }
  }

  return {
    currentMonthKey: activeMonth,
    currentMonth: format(new Date(activeMonth + '-01'), 'MMMM yyyy'),
    daysRemaining,
    totalBudget,
    totalCommitted: totalSpent,
    variableCategories,
    fixedBills,
    totalGiving: totalGivingSpent,
    totalGivingBudgeted,
    givingBreakdown,
    givingPercentOfSpending: totalSpent > 0 ? Math.round((totalGivingSpent / totalSpent) * 100) : 0,
    savingsBuckets,
    accountTotals: accountSpending,
    unassignedCount,
    priorMonth,
    categoryChanges,
    ...(Object.keys(incomeData).length > 0 ? { incomeData } : {}),
    ...(financialProfile ? { financialProfile } : {}),
  };
}

function parseInsights(content: unknown): Insight[] {
  if (Array.isArray(content)) return content as Insight[];
  if (typeof content !== 'string') return [];
  const cleaned = content.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
  const match = cleaned.match(/\[[\s\S]*\]/);
  if (!match) return [];
  try {
    return JSON.parse(match[0]) as Insight[];
  } catch {
    return [];
  }
}

export function useBudgetInsights(
  activeMonth: string,
  categories: BudgetCategory[],
  fixedExpenses: FixedExpense[],
  monthTransactions: Transaction[],
  spentByCategory: Record<string, number>,
  transferAdjustments: Record<string, number>,
  accountSpending: { label: string; amount: number }[],
  unassignedCount: number,
  totalBudget: number,
  householdId: string,
  planningData: Record<string, string>,
) {
  const [insights, setInsights] = useState<Insight[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [hasCached, setHasCached] = useState(false);

  const [bigPictureInsights, setBigPictureInsights] = useState<Insight[]>([]);
  const [bigPictureLoading, setBigPictureLoading] = useState(false);
  const [bigPictureError, setBigPictureError] = useState<string | null>(null);
  const [bigPictureLastUpdated, setBigPictureLastUpdated] = useState<Date | null>(null);
  const [bigPictureHasCached, setBigPictureHasCached] = useState(false);

  const [chatMessages, setChatMessages] = useState<{ role: 'user' | 'assistant'; content: string }[]>([]);
  const [chatLoading, setChatLoading] = useState(false);
  const insightsRef = useRef<Insight[]>([]);

  // Load cached insights on mount / household / activeMonth change. NO auto-generation.
  // Home insights are scoped to the active month; big_picture is household-wide.
  useEffect(() => {
    if (!householdId || !activeMonth) return;
    let cancelled = false;
    (async () => {
      const [homeRes, bpRes] = await Promise.all([
        supabase
          .from('ai_insights_cache')
          .select('insights, generated_at')
          .eq('household_id', householdId)
          .eq('kind', 'home')
          .eq('month', activeMonth)
          .maybeSingle(),
        supabase
          .from('ai_insights_cache')
          .select('insights, generated_at')
          .eq('household_id', householdId)
          .eq('kind', 'big_picture')
          .eq('month', '')
          .maybeSingle(),
      ]);
      if (cancelled) return;
      const homeRow = homeRes.data as { insights: unknown; generated_at: string } | null;
      const bpRow = bpRes.data as { insights: unknown; generated_at: string } | null;
      if (homeRow) {
        const parsed = parseInsights(homeRow.insights);
        setInsights(parsed);
        insightsRef.current = parsed;
        setLastUpdated(new Date(homeRow.generated_at));
        setHasCached(true);
      } else {
        setInsights([]);
        insightsRef.current = [];
        setLastUpdated(null);
        setHasCached(false);
      }
      if (bpRow) {
        const parsed = parseInsights(bpRow.insights);
        setBigPictureInsights(parsed);
        setBigPictureLastUpdated(new Date(bpRow.generated_at));
        setBigPictureHasCached(true);
      } else {
        setBigPictureHasCached(false);
      }
    })();
    return () => { cancelled = true; };
  }, [householdId, activeMonth]);

  const getSummary = useCallback(() => buildBudgetSummary(
    activeMonth, categories, fixedExpenses, monthTransactions,
    spentByCategory, transferAdjustments, accountSpending, unassignedCount, totalBudget, householdId, planningData,
  ), [activeMonth, categories, fixedExpenses, monthTransactions, spentByCategory, transferAdjustments, accountSpending, unassignedCount, totalBudget, householdId, planningData]);

  // Always an explicit user-triggered call now.
  const generateInsights = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const summaryData = await getSummary();
      const { data, error: fnError } = await supabase.functions.invoke('budget-insights', {
        body: {
          budgetSummary: summaryData,
          mode: 'home',
          month: activeMonth,
          stewardshipMode: true,
          forceRefresh: true,
        },
      });

      if (fnError) throw new Error(fnError.message || 'Edge function error');
      if (!data) throw new Error('No data returned from edge function');

      const content = data?.content || '';
      const parsed = parseInsights(content);
      if (parsed.length === 0) throw new Error('Could not parse insights from response');

      setInsights(parsed);
      insightsRef.current = parsed;
      setLastUpdated(data?.generatedAt ? new Date(data.generatedAt) : new Date());
      setHasCached(true);
    } catch (e: any) {
      const msg = e?.message || 'Unknown error generating insights';
      console.error('[Insights] Failed:', msg, e);
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [getSummary]);

  const generateBigPicture = useCallback(async () => {
    setBigPictureLoading(true);
    setBigPictureError(null);
    try {
      const summaryData = await getSummary();
      const { data, error: fnError } = await supabase.functions.invoke('budget-insights', {
        body: {
          budgetSummary: summaryData,
          mode: 'big_picture',
          stewardshipMode: true,
          forceRefresh: true,
        },
      });
      if (fnError) throw new Error(fnError.message || 'Edge function error');
      if (!data) throw new Error('No data returned from edge function');

      const content = data?.content || '';
      const parsed = parseInsights(content);
      if (parsed.length === 0) throw new Error('Could not parse insights from response');

      setBigPictureInsights(parsed);
      setBigPictureLastUpdated(data?.generatedAt ? new Date(data.generatedAt) : new Date());
      setBigPictureHasCached(true);
    } catch (e: any) {
      const msg = e?.message || 'Unknown error generating big picture';
      console.error('[BigPicture] Failed:', msg, e);
      setBigPictureError(msg);
    } finally {
      setBigPictureLoading(false);
    }
  }, [getSummary]);

  const sendChatMessage = useCallback(async (message: string) => {
    const userMsg = { role: 'user' as const, content: message };
    const newMessages = [...chatMessages, userMsg];
    setChatMessages(newMessages);
    setChatLoading(true);

    try {
      const summaryData = await getSummary();
      const { data, error: fnError } = await supabase.functions.invoke('budget-insights', {
        body: { budgetSummary: summaryData, chatMessages: newMessages, stewardshipMode: true },
      });
      if (fnError) throw fnError;
      const content = data?.content || 'Sorry, I couldn\'t generate a response.';
      setChatMessages(prev => [...prev, { role: 'assistant', content }]);
    } catch (e) {
      console.error('Chat error:', e);
      setChatMessages(prev => [...prev, { role: 'assistant', content: 'Something went wrong. Please try again.' }]);
    } finally {
      setChatLoading(false);
    }
  }, [chatMessages, getSummary]);

  return {
    insights,
    loading,
    error,
    lastUpdated,
    hasCached,
    generateInsights,
    bigPictureInsights,
    bigPictureLoading,
    bigPictureError,
    bigPictureLastUpdated,
    bigPictureHasCached,
    generateBigPicture,
    chatMessages,
    chatLoading,
    sendChatMessage,
    clearChat: () => setChatMessages([]),
  };
}
