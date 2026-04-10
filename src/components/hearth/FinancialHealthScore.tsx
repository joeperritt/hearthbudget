import { useState, useMemo, useEffect, useCallback } from 'react';
import { ArrowLeft, Shield, PiggyBank, TrendingDown, Landmark, Heart, Target, Sparkles, AlertTriangle, CheckCircle2, Lightbulb, RefreshCw, Info } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToolState } from '@/hooks/useToolState';
import { ProgressBar } from './ProgressBar';
import { formatDistanceToNow } from 'date-fns';

function fmt(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);
}
function pct(n: number) {
  return (n * 100).toFixed(1) + '%';
}

interface FinancialHealthScoreProps {
  onBack: () => void;
  householdId: string | null;
}

interface CategoryScore {
  name: string;
  icon: typeof Shield;
  score: number;
  max: number;
  metric: string;
  color: 'red' | 'gold' | 'green';
  note: string;
}

function scoreColor(score: number): string {
  if (score < 50) return 'text-destructive';
  if (score < 70) return 'text-accent';
  if (score < 85) return 'text-primary';
  return 'text-green-600';
}
function scoreLabel(score: number): string {
  if (score < 50) return 'Needs Work';
  if (score < 70) return 'Getting There';
  if (score < 85) return 'Strong';
  return 'Excellent';
}
function scoreBg(score: number): string {
  if (score < 50) return 'stroke-destructive';
  if (score < 70) return 'stroke-accent';
  if (score < 85) return 'stroke-primary';
  return 'stroke-green-600';
}
function dotColor(c: 'red' | 'gold' | 'green'): string {
  if (c === 'red') return 'bg-destructive';
  if (c === 'gold') return 'bg-accent';
  return 'bg-green-600';
}

// Scoring functions
function emergencyFundScore(efBalance: number, monthlyExpenses: number): { score: number; months: number } {
  if (monthlyExpenses <= 0) return { score: 8, months: 0 };
  const months = efBalance / monthlyExpenses;
  let score = 0;
  if (months >= 6) score = 17;
  else if (months >= 3) score = 14;
  else if (months >= 2) score = 10;
  else if (months >= 1) score = 5;
  return { score, months };
}

function debtLoadScore(totalDebtPayments: number, grossMonthlyIncome: number): { score: number; dti: number } {
  if (grossMonthlyIncome <= 0) return { score: 8, dti: 0 };
  const dti = totalDebtPayments / grossMonthlyIncome;
  let score = 0;
  if (dti < 0.20) score = 17;
  else if (dti < 0.28) score = 14;
  else if (dti < 0.36) score = 10;
  else if (dti <= 0.43) score = 5;
  return { score, dti };
}

function retirementSavingsScore(monthlyContributions: number, grossMonthlyIncome: number): { score: number; rate: number } {
  if (grossMonthlyIncome <= 0) return { score: 0, rate: 0 };
  const rate = monthlyContributions / grossMonthlyIncome;
  let score = 0;
  if (rate >= 0.20) score = 17;
  else if (rate >= 0.15) score = 14;
  else if (rate >= 0.10) score = 10;
  else if (rate >= 0.05) score = 5;
  return { score, rate };
}

function insuranceCoverageScore(totalCoverage: number, annualGrossIncome: number): { score: number; multiple: number } {
  if (annualGrossIncome <= 0) return { score: 0, multiple: 0 };
  const multiple = totalCoverage / annualGrossIncome;
  let score = 0;
  if (totalCoverage <= 0) score = 0;
  else if (multiple >= 10) score = 17;
  else if (multiple >= 5) score = 12;
  else score = 8;
  return { score, multiple };
}

function savingsGoalsScore(goals: any[]): { score: number; pctOnTrack: number; noGoals: boolean } {
  if (!goals || goals.length === 0) return { score: 8, pctOnTrack: 0, noGoals: true };
  const now = new Date();
  let onTrack = 0;
  goals.forEach((g: any) => {
    const target = Number(g.targetAmount) || 0;
    const current = Number(g.currentSavings) || 0;
    const monthly = Number(g.monthlyContribution) || 0;
    if (target <= 0) return;
    let remainMonths = 0;
    if (g.useDate && g.targetDate) {
      const [y, m] = g.targetDate.split('-').map(Number);
      if (y && m) {
        const to = new Date(y, m - 1);
        remainMonths = Math.max(0, (to.getFullYear() - now.getFullYear()) * 12 + (to.getMonth() - now.getMonth()));
      }
    } else {
      remainMonths = Math.max(0, (Number(g.targetMonths) || 0));
    }
    const projected = current + monthly * remainMonths;
    if (projected >= target) onTrack++;
  });
  const fraction = onTrack / goals.length;
  let score = 0;
  if (fraction >= 1) score = 17;
  else if (fraction >= 0.50) score = 13;
  else if (fraction > 0) score = 8;
  return { score, pctOnTrack: fraction, noGoals: false };
}

function givingRateScore(monthlyGiving: number, grossMonthlyIncome: number): { score: number; rate: number } {
  if (grossMonthlyIncome <= 0) return { score: 0, rate: 0 };
  const rate = monthlyGiving / grossMonthlyIncome;
  let score = 0;
  if (rate >= 0.05) score = 17;
  else if (rate >= 0.03) score = 14;
  else if (rate >= 0.01) score = 10;
  else if (rate > 0) score = 5;
  return { score, rate };
}

function catColor(score: number, max: number): 'red' | 'gold' | 'green' {
  const pct = score / max;
  if (pct < 0.4) return 'red';
  if (pct < 0.75) return 'gold';
  return 'green';
}

// AI Insights
interface Insight {
  type: 'warning' | 'encouragement' | 'tip' | 'savings';
  title: string;
  body: string;
}

const iconMap: Record<string, { icon: typeof AlertTriangle; color: string; border: string }> = {
  warning: { icon: AlertTriangle, color: 'text-yellow-600', border: 'border-l-destructive' },
  encouragement: { icon: CheckCircle2, color: 'text-green-600', border: 'border-l-green-500' },
  tip: { icon: Lightbulb, color: 'text-accent', border: 'border-l-accent' },
  savings: { icon: PiggyBank, color: 'text-primary', border: 'border-l-primary' },
};

export function FinancialHealthScore({ onBack, householdId }: FinancialHealthScoreProps) {
  const [financialProfile, setFinancialProfile] = useState<any>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [budgetData, setBudgetData] = useState<{ monthlyExpenses: number; monthlyGiving: number; retirementContributions: number }>({ monthlyExpenses: 0, monthlyGiving: 0, retirementContributions: 0 });
  const [goalsState, setGoalsState] = useState<any>(null);

  const { state, setState, loaded } = useToolState<{ lastViewed: string }>(householdId, 'financial-health-score', { lastViewed: '' });

  // Insights state
  const [insights, setInsights] = useState<Insight[]>([]);
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [insightsError, setInsightsError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  // Load financial profile
  useEffect(() => {
    if (!householdId) { setProfileLoading(false); return; }
    supabase.from('financial_profiles').select('*').eq('household_id', householdId).maybeSingle()
      .then(({ data }) => { if (data) setFinancialProfile(data); setProfileLoading(false); });
  }, [householdId]);

  // Load budget data (current month expenses, giving, retirement contributions)
  useEffect(() => {
    if (!householdId) return;
    const currentMonth = new Date().toISOString().slice(0, 7);
    Promise.all([
      supabase.from('budget_categories' as any).select('id, budgeted, group').eq('household_id', householdId),
      supabase.from('fixed_expenses' as any).select('id, amount, group').eq('household_id', householdId),
      supabase.from('transactions' as any).select('amount, category_slug, transaction_type').eq('household_id', householdId).eq('budget_month', currentMonth),
    ]).then(([catRes, fixedRes, txRes]) => {
      const cats = (catRes.data || []) as any[];
      const fixed = (fixedRes.data || []) as any[];
      const txs = (txRes.data || []) as any[];

      // Total monthly budget as proxy for monthly expenses
      const totalBudget = cats.reduce((s: number, c: any) => s + (Number(c.budgeted) || 0), 0) + fixed.reduce((s: number, e: any) => s + (Number(e.amount) || 0), 0);

      // Giving: fixed expenses in 'tithe' group + variable categories in 'giving' group
      const givingFixedIds = new Set(fixed.filter((e: any) => e.group === 'tithe').map((e: any) => e.id));
      const givingVarIds = new Set(cats.filter((c: any) => c.group === 'giving').map((c: any) => c.id));
      const givingFixed = fixed.filter((e: any) => e.group === 'tithe').reduce((s: number, e: any) => s + (Number(e.amount) || 0), 0);
      const givingVar = cats.filter((c: any) => c.group === 'giving').reduce((s: number, c: any) => s + (Number(c.budgeted) || 0), 0);

      // Retirement contributions: look for savings-group fixed expenses that include 'retirement' or '401k' or 'ira'
      const retirementFixed = fixed.filter((e: any) => e.group === 'savings' && /retirement|401k|ira|roth/i.test(e.id || '')).reduce((s: number, e: any) => s + (Number(e.amount) || 0), 0);

      setBudgetData({
        monthlyExpenses: totalBudget,
        monthlyGiving: givingFixed + givingVar,
        retirementContributions: retirementFixed,
      });
    });
  }, [householdId]);

  // Load goals planner state
  useEffect(() => {
    if (!householdId) return;
    supabase.from('tool_states' as any).select('state_json').eq('household_id', householdId).eq('tool_name', 'goals-planner').maybeSingle()
      .then(({ data }: any) => { if (data?.state_json) setGoalsState(data.state_json); });
  }, [householdId]);

  // Save last viewed
  useEffect(() => {
    if (loaded && householdId) {
      setState({ lastViewed: new Date().toISOString() });
    }
  }, [loaded, householdId]);

  // Compute scores
  const scores = useMemo(() => {
    const fp = financialProfile;
    const members = Array.isArray(fp?.member_incomes) ? fp.member_incomes : [];
    const annualGross = members.reduce((s: number, m: any) => s + (Number(m.gross_income) || 0), 0) || (Number(fp?.annual_gross_income) || 0);
    const monthlyGross = annualGross / 12;

    // 1. Emergency Fund
    const efBalance = Number(fp?.emergency_fund_balance) || 0;
    const ef = emergencyFundScore(efBalance, budgetData.monthlyExpenses);

    // 2. Debt Load
    const debts = Array.isArray(fp?.debts) ? fp.debts : [];
    const mortgagePayment = Number(fp?.mortgage_payment) || 0;
    const totalDebtPayments = debts.reduce((s: number, d: any) => s + (Number(d.minimum_payment) || 0), 0) + mortgagePayment;
    const dl = debtLoadScore(totalDebtPayments, monthlyGross);

    // 3. Retirement Savings
    // Look for retirement contributions in budget savings categories or tool state
    const retirementContribs = budgetData.retirementContributions || 0;
    // Also check for savings-group fixed expenses from budget
    const rs = retirementSavingsScore(retirementContribs, monthlyGross);

    // 4. Insurance Coverage
    const coverages = Array.isArray(fp?.life_insurance_coverages) ? fp.life_insurance_coverages : [];
    const totalCoverage = coverages.reduce((s: number, c: any) => s + (Number(c.coverage) || 0), 0) || (Number(fp?.life_insurance_coverage) || 0);
    const ic = insuranceCoverageScore(totalCoverage, annualGross);

    // 5. Savings Goals
    const goals = goalsState?.goals || [];
    const sg = savingsGoalsScore(goals);

    // 6. Giving Rate
    const gr = givingRateScore(budgetData.monthlyGiving, monthlyGross);

    const categories: CategoryScore[] = [
      {
        name: 'Emergency Fund',
        icon: Shield,
        score: ef.score,
        max: 17,
        metric: budgetData.monthlyExpenses > 0 ? `${ef.months.toFixed(1)} months expenses` : `${fmt(efBalance)} saved`,
        color: catColor(ef.score, 17),
        note: ef.score >= 17 ? 'Excellent — you have a solid safety net covering 6+ months.' : ef.score >= 14 ? 'Good progress — aim for 6 months of expenses for full protection.' : ef.score >= 10 ? 'Building up — target 3–6 months of expenses.' : 'Priority area — even $50/mo builds your safety net.',
      },
      {
        name: 'Debt Load',
        icon: TrendingDown,
        score: dl.score,
        max: 17,
        metric: `${pct(dl.dti)} DTI ratio`,
        color: catColor(dl.score, 17),
        note: dl.score >= 17 ? 'Excellent — your debt-to-income ratio is well below guidelines.' : dl.score >= 14 ? 'Healthy ratio — continue paying down debt for even more flexibility.' : dl.score >= 10 ? 'Manageable — focus on highest-rate debts first.' : 'High debt load — consider a payoff strategy to free up cash flow.',
      },
      {
        name: 'Retirement Savings',
        icon: Landmark,
        score: rs.score,
        max: 17,
        metric: `${pct(rs.rate)} savings rate`,
        color: catColor(rs.score, 17),
        note: rs.score >= 17 ? 'Outstanding \u2014 saving 20%+ toward retirement.' : rs.score >= 14 ? 'Strong \u2014 increasing to 20% would maximize your future security.' : rs.score >= 10 ? 'Good start \u2014 try to increase by 1% each year.' : 'Critical to start \u2014 even 5% with employer match makes a big difference.',
      },
      {
        name: 'Insurance Coverage',
        icon: Shield,
        score: ic.score,
        max: 17,
        metric: totalCoverage > 0 ? `${ic.multiple.toFixed(1)}x income coverage` : 'No coverage',
        color: catColor(ic.score, 17),
        note: ic.score >= 17 ? 'Well protected — your coverage meets the 10x income benchmark.' : ic.score >= 12 ? 'Good coverage — consider increasing to 10x income for full protection.' : ic.score >= 8 ? 'Some coverage — CFPs recommend 10x annual income.' : 'No life insurance — this is a key protection gap for your household.',
      },
      {
        name: 'Savings Goals',
        icon: Target,
        score: sg.score,
        max: 17,
        metric: sg.noGoals ? 'No goals set' : `${Math.round(sg.pctOnTrack * 100)}% on track`,
        color: catColor(sg.score, 17),
        note: sg.noGoals ? 'Set specific savings goals to track your progress.' : sg.score >= 17 ? 'All goals on track — great discipline and planning!' : sg.score >= 13 ? 'Most goals progressing — review any that need adjustment.' : 'Some goals need attention — consider adjusting contributions.',
      },
      {
        name: 'Generosity',
        icon: Heart,
        score: gr.score,
        max: 17,
        metric: `${pct(gr.rate)} giving rate`,
        color: catColor(gr.score, 17),
        note: gr.score >= 17 ? 'Generous spirit \u2014 your giving exceeds 5% of income.' : gr.score >= 14 ? 'Meaningful giving \u2014 making a real impact.' : gr.score >= 10 ? 'Good start \u2014 even small increases honor your values.' : 'Consider starting with a giving goal that aligns with your values.',
      },
    ];

    const totalScore = categories.reduce((s, c) => s + c.score, 0);

    return { categories, totalScore, annualGross, monthlyGross };
  }, [financialProfile, budgetData, goalsState]);

  // Top opportunities (lowest scoring)
  const opportunities = useMemo(() => {
    const sorted = [...scores.categories].sort((a, b) => a.score - b.score);
    return sorted.slice(0, 3).filter(c => c.score < 17).map(c => {
      let suggestion = '';
      if (c.name === 'Emergency Fund') {
        const needed = budgetData.monthlyExpenses * 6;
        const efBal = Number(financialProfile?.emergency_fund_balance) || 0;
        const gap = Math.max(0, needed - efBal);
        suggestion = gap > 0 ? `Adding ${fmt(Math.ceil(gap / 12))}/mo to your emergency fund would reach 6 months coverage in one year.` : 'Continue maintaining your emergency fund at current levels.';
      } else if (c.name === 'Debt Load') {
        suggestion = 'Focus extra payments on your highest-rate debt to reduce your DTI ratio faster.';
      } else if (c.name === 'Retirement Savings') {
        const currentRate = scores.monthlyGross > 0 ? (budgetData.retirementContributions / scores.monthlyGross) : 0;
        const nextTier = currentRate < 0.05 ? '5%' : currentRate < 0.10 ? '10%' : currentRate < 0.15 ? '15%' : '20%';
        suggestion = `Increasing your retirement savings rate to ${nextTier} would significantly improve your long-term financial security.`;
      } else if (c.name === 'Insurance Coverage') {
        suggestion = `CFPs recommend life insurance coverage of 10x your annual income (${fmt(scores.annualGross * 10)}). Consider getting quotes for term life insurance.`;
      } else if (c.name === 'Savings Goals') {
        suggestion = 'Set specific savings goals with target dates to track your progress and stay motivated.';
      } else if (c.name === 'Generosity') {
        suggestion = 'Starting with even 1% of income toward giving builds a habit of generosity aligned with your values.';
      }
      return { ...c, suggestion };
    });
  }, [scores, budgetData, financialProfile]);

  // AI Insights
  const fetchInsights = useCallback(async () => {
    setInsightsLoading(true);
    setInsightsError(null);
    try {
      const payload = {
        currentMonth: new Date().toISOString().slice(0, 7),
        context: 'financial_health_score',
        totalScore: scores.totalScore,
        categories: scores.categories.map(c => ({ name: c.name, score: c.score, max: c.max, metric: c.metric })),
        annualGrossIncome: scores.annualGross,
        ...(financialProfile ? {
          financialProfile: {
            member_incomes: Array.isArray(financialProfile.member_incomes) ? financialProfile.member_incomes : [],
            filing_status: financialProfile.filing_status,
            debts: Array.isArray(financialProfile.debts) ? financialProfile.debts : [],
            emergency_fund_balance: Number(financialProfile.emergency_fund_balance) || 0,
            retirement_balance: Number(financialProfile.retirement_balance) || 0,
            non_retirement_investments: Number(financialProfile.non_retirement_investments) || 0,
            housing_type: financialProfile.housing_type,
            mortgage_balance: Number(financialProfile.mortgage_balance) || 0,
            mortgage_payment: Number(financialProfile.mortgage_payment) || 0,
            has_life_insurance: financialProfile.has_life_insurance,
          },
        } : {}),
        budgetData,
      };

      const systemPrompt = `You are a Certified Financial Planner (CFP®) and Certified Kingdom Advisor (CKA®) reviewing a household's Financial Health Score of ${scores.totalScore}/100 ("${scoreLabel(scores.totalScore)}"). The score is based on six categories: ${scores.categories.map(c => `${c.name}: ${c.score}/${c.max} (${c.metric})`).join(', ')}. Provide 2-3 specific, actionable insights: 1) An overall health assessment tied to the score, 2) The biggest opportunity area with a specific suggestion, 3) Encouragement on the strongest category. Be warm, stewardship-framed, and specific with numbers from the data. Format as JSON array of objects with "type" (warning/encouragement/tip/savings), "title" (5 words max), "body" (2-3 sentences with specific numbers).`;

      const { data, error: fnError } = await supabase.functions.invoke('budget-insights', {
        body: {
          budgetSummary: payload,
          chatMessages: [{ role: 'system', content: systemPrompt }],
        },
      });

      if (fnError) throw new Error(fnError.message);
      const content = data?.content || '';
      const jsonMatch = content.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        setInsights(JSON.parse(jsonMatch[0]) as Insight[]);
        setLastUpdated(new Date());
      } else {
        throw new Error('Could not parse insights');
      }
    } catch (e: any) {
      setInsightsError(e?.message || 'Failed to generate insights');
    } finally {
      setInsightsLoading(false);
    }
  }, [scores, financialProfile, budgetData]);

  if (profileLoading) {
    return (
      <div className="max-w-lg mx-auto px-6 pt-12 safe-top">
        <div className="flex items-center gap-3 mb-8">
          <button onClick={onBack} className="p-1.5 -ml-1.5 rounded-lg hover:bg-muted"><ArrowLeft size={20} /></button>
          <h1 className="font-display text-xl font-bold text-foreground">Financial Health Score</h1>
        </div>
        <div className="flex justify-center"><div className="w-32 h-32 rounded-full bg-muted animate-pulse" /></div>
      </div>
    );
  }

  const { totalScore, categories: catScores } = scores;
  const radius = 58;
  const circumference = 2 * Math.PI * radius;
  const progress = (totalScore / 100) * circumference;

  return (
    <div className="max-w-lg mx-auto pb-32">
      <div className="px-6 pt-12 safe-top flex items-center gap-3">
        <button onClick={onBack} className="p-1.5 -ml-1.5 rounded-lg hover:bg-muted">
          <ArrowLeft size={20} className="text-foreground" />
        </button>
        <div>
          <h1 className="font-display text-xl font-bold text-foreground">Financial Health Score</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Based on your Financial Profile and tool data</p>
        </div>
      </div>

      {/* Score Gauge */}
      <div className="flex flex-col items-center mt-8">
        <div className="relative w-40 h-40">
          <svg className="w-full h-full -rotate-90" viewBox="0 0 128 128">
            <circle cx="64" cy="64" r={radius} fill="none" strokeWidth="8" className="stroke-muted" />
            <circle
              cx="64" cy="64" r={radius} fill="none" strokeWidth="8"
              strokeLinecap="round"
              className={scoreBg(totalScore)}
              strokeDasharray={circumference}
              strokeDashoffset={circumference - progress}
              style={{ transition: 'stroke-dashoffset 1s ease-out' }}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className={`text-4xl font-display font-bold ${scoreColor(totalScore)}`}>{totalScore}</span>
            <span className="text-xs text-muted-foreground font-medium">out of 100</span>
          </div>
        </div>
        <p className={`text-lg font-display font-bold mt-2 ${scoreColor(totalScore)}`}>{scoreLabel(totalScore)}</p>
      </div>

      {/* Category Breakdown */}
      <div className="px-6 mt-8">
        <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Score Breakdown</h2>
        <div className="space-y-2">
          {catScores.map((cat) => {
            const Icon = cat.icon;
            return (
              <div key={cat.name} className="bg-card rounded-lg shadow-sm p-3.5">
                <div className="flex items-center gap-3">
                  <div className={`w-2 h-2 rounded-full ${dotColor(cat.color)} flex-shrink-0`} />
                  <Icon size={16} className="text-muted-foreground flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-semibold text-foreground">{cat.name}</p>
                      <span className="text-xs font-bold text-muted-foreground">{cat.score}/{cat.max}</span>
                    </div>
                    <ProgressBar value={cat.score} max={cat.max} className="mt-1.5" />
                    <p className="text-[11px] text-muted-foreground mt-1">{cat.metric}</p>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground mt-2 pl-9 leading-relaxed">{cat.note}</p>
              </div>
            );
          })}
        </div>
      </div>

      {/* Top Opportunities */}
      {opportunities.length > 0 && (
        <div className="px-6 mt-6">
          <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">What Would Move Your Score</h2>
          <div className="space-y-2">
            {opportunities.map((opp) => {
              const Icon = opp.icon;
              return (
                <div key={opp.name} className="bg-card rounded-lg shadow-sm p-3.5 border-l-[3px] border-l-accent">
                  <div className="flex items-start gap-2.5">
                    <Icon size={16} className="text-accent mt-0.5 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-foreground font-display">{opp.name}</p>
                      <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{opp.suggestion}</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* AI Insights */}
      <div className="px-6 mt-6">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-1.5">
            <Sparkles size={14} className="text-accent" />
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">AI Insights</h3>
          </div>
          <button onClick={fetchInsights} disabled={insightsLoading} className="flex items-center gap-1 text-xs text-accent font-medium active:opacity-70 disabled:opacity-50">
            <RefreshCw size={12} className={insightsLoading ? 'animate-spin' : ''} />
            {insightsLoading ? 'Loading…' : insights.length > 0 ? 'Refresh' : 'Generate'}
          </button>
        </div>

        {insightsLoading && insights.length === 0 ? (
          <div className="space-y-2">
            {[1, 2].map(i => (
              <div key={i} className="bg-card rounded-lg shadow-sm p-4 animate-pulse">
                <div className="h-3 bg-muted rounded w-1/3 mb-2" />
                <div className="h-2 bg-muted rounded w-full mb-1" />
                <div className="h-2 bg-muted rounded w-2/3" />
              </div>
            ))}
          </div>
        ) : insightsError ? (
          <div className="bg-card rounded-lg shadow-sm px-4 py-4 border-l-[3px] border-l-destructive">
            <div className="flex items-start gap-2.5">
              <AlertTriangle size={16} className="text-destructive mt-0.5 shrink-0" />
              <div className="min-w-0">
                <p className="text-sm font-semibold text-foreground">Insights unavailable</p>
                <p className="text-xs text-muted-foreground mt-0.5">{insightsError}</p>
              </div>
            </div>
          </div>
        ) : insights.length === 0 ? (
          <div className="bg-card rounded-lg shadow-sm px-4 py-6 flex flex-col items-center">
            <Sparkles size={20} className="text-muted-foreground/30 mb-2" />
            <p className="text-sm text-muted-foreground">Tap Generate for personalized health insights</p>
          </div>
        ) : (
          <div className="space-y-2">
            {insights.map((insight, i) => {
              const config = iconMap[insight.type] || iconMap.tip;
              const Icon = config.icon;
              return (
                <div key={i} className={`bg-card rounded-lg shadow-sm p-3.5 border-l-[3px] ${config.border}`}>
                  <div className="flex items-start gap-2.5">
                    <Icon size={16} className={`${config.color} mt-0.5 shrink-0`} />
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-foreground font-display">{insight.title}</p>
                      <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{insight.body}</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {lastUpdated && !insightsError && (
          <p className="text-[10px] text-muted-foreground/60 mt-1.5 text-center">
            Updated {formatDistanceToNow(lastUpdated, { addSuffix: true })}
          </p>
        )}
      </div>

      {/* Disclaimer */}
      <div className="px-6 mt-6 flex gap-2">
        <Info size={14} className="text-muted-foreground shrink-0 mt-0.5" />
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          Your Financial Health Score is a general educational tool based on common Certified Financial Planner (CFP®) benchmarks. It does not constitute financial advice. For a comprehensive financial plan tailored to your situation, consult a Certified Financial Planner (CFP®) professional.
        </p>
      </div>
    </div>
  );
}
