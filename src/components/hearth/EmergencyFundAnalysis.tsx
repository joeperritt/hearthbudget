import { useState, useMemo, useEffect, useCallback } from 'react';
import { ArrowLeft, Shield, Sparkles, Loader2, Info, CheckCircle2, AlertTriangle, RefreshCw } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { useToolState } from '@/hooks/useToolState';
import { formatDistanceToNow } from 'date-fns';
import { AIInsightsList, parseAIInsights, type AIInsight } from './AIInsightsList';

function fmt(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);
}

interface EmergencyFundAnalysisProps {
  onBack: () => void;
  householdId: string | null;
}

type IncomeStability = 'very-stable' | 'stable' | 'variable' | 'self-employed';

interface EFState {
  householdType: 'single' | 'dual';
  nonEssentialBackout: string;
  currentBalance: string;
  primaryStability: IncomeStability;
  secondaryStability: IncomeStability;
  dependents: string;
}

const defaultState: EFState = {
  householdType: 'single',
  nonEssentialBackout: '0',
  currentBalance: '',
  primaryStability: 'stable',
  secondaryStability: 'stable',
  dependents: '0',
};

function getRecommendedMonths(s: EFState): [number, number] {
  const deps = Math.max(0, (parseInt(s.dependents) || 0) - 2);
  const extra = deps > 0 ? deps : 0;

  if (s.householdType === 'single') {
    const isVariable = s.primaryStability === 'variable' || s.primaryStability === 'self-employed';
    if (isVariable) return [9 + extra, 12 + extra];
    return [6 + extra, 6 + extra];
  }

  const p = s.primaryStability;
  const sec = s.secondaryStability;
  const bothStable = (p === 'very-stable' || p === 'stable') && (sec === 'very-stable' || sec === 'stable');
  const bothVariable = (p === 'variable' || p === 'self-employed') && (sec === 'variable' || sec === 'self-employed');
  const oneVariable = !bothStable && !bothVariable;

  if (bothStable) return [3 + extra, 4 + extra];
  if (oneVariable) return [5 + extra, 6 + extra];
  return [6 + extra, 9 + extra];
}

export function EmergencyFundAnalysis({ onBack, householdId }: EmergencyFundAnalysisProps) {
  const { state, setState, loaded } = useToolState<EFState>(householdId, 'emergency-fund', defaultState);
  const [profileLoading, setProfileLoading] = useState(true);
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [totalBudget, setTotalBudget] = useState(0);

  // AI Insights
  const [aiInsights, setAiInsights] = useState<AIInsight[]>([]);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiLastUpdated, setAiLastUpdated] = useState<Date | null>(null);

  // Load financial profile & budget
  useEffect(() => {
    if (!householdId || profileLoaded) return;
    Promise.all([
      supabase.from('financial_profiles').select('*').eq('household_id', householdId).maybeSingle(),
      supabase.from('budget_categories').select('budgeted').eq('household_id', householdId),
      supabase.from('fixed_expenses').select('amount').eq('household_id', householdId),
    ]).then(([fpRes, catRes, feRes]) => {
      const fp = fpRes.data;
      const updates: Partial<EFState> = {};

      if (fp) {
        const members = Array.isArray(fp.member_incomes) ? fp.member_incomes : [];
        if (members.length >= 2) updates.householdType = 'dual';
        else updates.householdType = 'single';

        if ((fp.emergency_fund_balance || 0) > 0 && !state.currentBalance) {
          updates.currentBalance = String(fp.emergency_fund_balance);
        }
      }

      const catTotal = (catRes.data || []).reduce((s: number, c: any) => s + (Number(c.budgeted) || 0), 0);
      const feTotal = (feRes.data || []).reduce((s: number, e: any) => s + (Number(e.amount) || 0), 0);
      const budget = Math.round(catTotal + feTotal);
      setTotalBudget(budget);

      if (Object.keys(updates).length > 0) setState(updates);
      setProfileLoading(false);
      setProfileLoaded(true);
    });
  }, [householdId, profileLoaded]);

  const nonEssential = Number(state.nonEssentialBackout) || 0;
  const adjustedExpenses = Math.max(0, totalBudget - nonEssential);
  const balance = Number(state.currentBalance) || 0;
  const [recLow, recHigh] = useMemo(() => getRecommendedMonths(state), [state]);
  const targetLow = adjustedExpenses * recLow;
  const targetHigh = adjustedExpenses * recHigh;
  const coverageMonths = adjustedExpenses > 0 ? balance / adjustedExpenses : 0;
  const shortfall = Math.max(0, targetLow - balance);
  const surplus = balance > targetHigh ? balance - targetHigh : 0;
  const onTrack = balance >= targetLow;
  const monthly12 = shortfall > 0 ? Math.ceil(shortfall / 12) : 0;
  const monthly24 = shortfall > 0 ? Math.ceil(shortfall / 24) : 0;

  // AI Insights
  const fetchInsights = useCallback(async () => {
    if (!householdId) return;
    setAiLoading(true);
    try {
      const prompt = `You are a Certified Financial Planner (CFP®) and Certified Kingdom Advisor (CKA®). Analyze this household's emergency fund:
- Current balance: ${fmt(balance)}
- Monthly essential expenses: ${fmt(adjustedExpenses)}
- Coverage: ${coverageMonths.toFixed(1)} months
- Recommended: ${recLow}–${recHigh} months
- ${onTrack ? 'ON TRACK' : `SHORTFALL of ${fmt(shortfall)}`}
- Household type: ${state.householdType} income
- Primary stability: ${state.primaryStability}
${state.householdType === 'dual' ? `- Secondary stability: ${state.secondaryStability}` : ''}
- Dependents: ${state.dependents}

Provide exactly 3 short insights covering: 1) Emergency fund adequacy assessment, 2) Where to keep it (HYSA recommendation — educational only), 3) How it connects to overall financial stability. Be warm, stewardship-framed, and specific. Format as a JSON array of objects with "type" (warning/encouragement/tip/savings), "title" (5 words max), "body" (2-3 sentences with specific numbers). Do NOT use markdown formatting.`;

      const { data, error: fnError } = await supabase.functions.invoke('budget-insights', {
        body: { prompt, householdId },
      });
      if (fnError) {
        console.error('AI insights function error:', fnError);
        throw new Error(fnError.message || 'Edge function call failed');
      }
      if (data?.error) {
        console.error('AI insights returned error:', data.error);
        throw new Error(data.error);
      }
      const raw = data?.insights ?? data?.content ?? '';
      const parsed = parseAIInsights(raw);
      setAiInsights(parsed.slice(0, 3));
      setAiLastUpdated(new Date());
    } catch (e) {
      console.error('AI insights error:', e);
    }
    setAiLoading(false);
  }, [householdId, balance, adjustedExpenses, coverageMonths, recLow, recHigh, onTrack, shortfall, state]);

  if (!loaded || profileLoading) {
    return (
      <div className="max-w-lg mx-auto px-6 pt-12 safe-top">
        <div className="animate-pulse space-y-4">
          <div className="h-6 bg-muted rounded w-1/2" />
          <div className="h-40 bg-muted rounded-xl" />
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
          <h1 className="font-display text-xl font-bold text-foreground">Emergency Fund Analysis</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Are you prepared for the unexpected?</p>
        </div>
      </div>

      {/* Verdict */}
      <div className="px-6 mt-6">
        <div className={`rounded-xl p-5 ${onTrack ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'}`}>
          <div className="flex items-center gap-3">
            {onTrack ? <CheckCircle2 size={24} className="text-green-600" /> : <AlertTriangle size={24} className="text-destructive" />}
            <div>
              <p className={`font-display font-bold ${onTrack ? 'text-green-700' : 'text-destructive'}`}>
                {onTrack ? (surplus > 0 ? 'Excellent — Well Funded' : 'On Track') : 'Needs Attention'}
              </p>
              <p className="text-sm text-muted-foreground mt-0.5">
                {coverageMonths.toFixed(1)} months of essential expenses covered
              </p>
            </div>
          </div>
          <div className="mt-4">
            <div className="flex justify-between text-xs text-muted-foreground mb-1">
              <span>{fmt(balance)} saved</span>
              <span>{fmt(targetLow)}–{fmt(targetHigh)} target</span>
            </div>
            <div className="h-3 bg-white/60 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${onTrack ? 'bg-green-500' : 'bg-destructive'}`}
                style={{ width: `${Math.min(100, targetHigh > 0 ? (balance / targetHigh) * 100 : 0)}%` }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Essential Expenses Calculator */}
      <div className="px-6 mt-6">
        <div className="bg-card rounded-xl p-4 shadow-sm space-y-4">
          <p className="text-sm font-semibold text-foreground">Essential Expenses Calculator</p>

          {/* Read-only budget total */}
          <div>
            <Label className="text-xs text-muted-foreground">Current Monthly Budget (from budget)</Label>
            <div className="mt-1 bg-muted/50 rounded-lg px-3 py-2.5">
              <p className="text-sm font-semibold text-foreground">{fmt(totalBudget)}</p>
            </div>
          </div>

          {/* Non-essential subtraction */}
          <div>
            <Label className="text-xs text-muted-foreground">Non-Essential Expenses to Back Out ($)</Label>
            <p className="text-[10px] text-muted-foreground mt-0.5 mb-1">
              Enter the total of any non-essential spending you expect to eliminate in retirement or during an emergency.
            </p>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
              <Input
                type="number"
                className="pl-7"
                value={state.nonEssentialBackout}
                onChange={e => setState({ nonEssentialBackout: e.target.value })}
                placeholder="0"
              />
            </div>
          </div>

          {/* Adjusted essential expenses */}
          <div>
            <Label className="text-xs text-muted-foreground">Adjusted Essential Monthly Expenses</Label>
            <div className="mt-1 bg-primary/5 rounded-lg px-3 py-2.5 border border-primary/10">
              <p className="text-sm font-bold text-foreground">{fmt(adjustedExpenses)}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Inputs */}
      <div className="px-6 mt-4 space-y-4">
        <div className="bg-card rounded-xl p-4 shadow-sm space-y-4">
          <p className="text-sm font-semibold text-foreground">Your Situation</p>

          {/* Household Type */}
          <div>
            <Label className="text-xs text-muted-foreground">Household Type</Label>
            <div className="flex mt-1 bg-muted rounded-lg p-0.5">
              {(['single', 'dual'] as const).map(t => (
                <button
                  key={t}
                  onClick={() => setState({ householdType: t })}
                  className={`flex-1 py-2 text-xs font-semibold rounded-md transition-colors ${
                    state.householdType === t ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'
                  }`}
                >
                  {t === 'single' ? 'Single Income' : 'Dual Income'}
                </button>
              ))}
            </div>
          </div>

          {/* Current Balance */}
          <div>
            <Label className="text-xs text-muted-foreground">Current Emergency Fund Balance</Label>
            <div className="relative mt-1">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
              <Input
                type="number"
                className="pl-7"
                value={state.currentBalance}
                onChange={e => setState({ currentBalance: e.target.value })}
                placeholder="0"
              />
            </div>
          </div>

          {/* Income Stability - Primary */}
          <div>
            <Label className="text-xs text-muted-foreground">
              {state.householdType === 'dual' ? 'Primary Earner Stability' : 'Income Stability'}
            </Label>
            <Select value={state.primaryStability} onValueChange={(v: IncomeStability) => setState({ primaryStability: v })}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="very-stable">Very Stable (Government, Tenured)</SelectItem>
                <SelectItem value="stable">Stable (Salaried, W-2)</SelectItem>
                <SelectItem value="variable">Variable (Commission, Contract)</SelectItem>
                <SelectItem value="self-employed">Self-Employed</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Income Stability - Secondary */}
          {state.householdType === 'dual' && (
            <div>
              <Label className="text-xs text-muted-foreground">Second Earner Stability</Label>
              <Select value={state.secondaryStability} onValueChange={(v: IncomeStability) => setState({ secondaryStability: v })}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="very-stable">Very Stable (Government, Tenured)</SelectItem>
                  <SelectItem value="stable">Stable (Salaried, W-2)</SelectItem>
                  <SelectItem value="variable">Variable (Commission, Contract)</SelectItem>
                  <SelectItem value="self-employed">Self-Employed</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Dependents */}
          <div>
            <Label className="text-xs text-muted-foreground">Number of Dependents</Label>
            <Input
              type="number"
              className="mt-1"
              value={state.dependents}
              onChange={e => setState({ dependents: e.target.value })}
              min="0"
            />
          </div>
        </div>
      </div>

      {/* Recommendation Explanation */}
      <div className="px-6 mt-4">
        <div className="bg-card rounded-xl p-4 shadow-sm">
          <p className="text-sm font-semibold text-foreground mb-2">CFP® Recommendation: {recLow === recHigh ? `${recLow} months` : `${recLow}–${recHigh} months`}</p>
          <div className="space-y-2 text-xs text-muted-foreground leading-relaxed">
            {state.householdType === 'dual' && (
              <p className="text-xs bg-accent/10 border border-accent/20 rounded-lg p-3">
                With two income streams, the household can absorb one job loss while the other income continues. The Certified Financial Planner (CFP®) Board generally considers 3–6 months appropriate for stable dual-income households.
              </p>
            )}
            <div className="grid grid-cols-2 gap-3 mt-2">
              <div className="bg-muted/50 rounded-lg p-3">
                <p className="font-semibold text-foreground">Low Target</p>
                <p className="text-lg font-bold text-primary mt-1">{fmt(targetLow)}</p>
                <p className="text-[11px]">{recLow} months × {fmt(adjustedExpenses)}</p>
              </div>
              <div className="bg-muted/50 rounded-lg p-3">
                <p className="font-semibold text-foreground">High Target</p>
                <p className="text-lg font-bold text-primary mt-1">{fmt(targetHigh)}</p>
                <p className="text-[11px]">{recHigh} months × {fmt(adjustedExpenses)}</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Calculated Output */}
      {adjustedExpenses > 0 && (
        <div className="px-6 mt-4">
          <div className="bg-card rounded-xl p-4 shadow-sm space-y-3">
            <p className="text-sm font-semibold text-foreground">Analysis</p>
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <p className="text-muted-foreground">Coverage</p>
                <p className="font-bold text-foreground text-base">{coverageMonths.toFixed(1)} months</p>
              </div>
              <div>
                <p className="text-muted-foreground">{onTrack ? 'Surplus' : 'Shortfall'}</p>
                <p className={`font-bold text-base ${onTrack ? 'text-green-600' : 'text-destructive'}`}>
                  {onTrack ? fmt(surplus > 0 ? surplus : 0) : fmt(shortfall)}
                </p>
              </div>
            </div>
            {shortfall > 0 && (
              <div className="border-t border-border pt-3 space-y-2">
                <p className="text-xs text-muted-foreground font-medium">Monthly contribution to reach target:</p>
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div className="bg-muted/50 rounded-lg p-3">
                    <p className="text-muted-foreground">In 12 months</p>
                    <p className="font-bold text-foreground text-sm">{fmt(monthly12)}/mo</p>
                  </div>
                  <div className="bg-muted/50 rounded-lg p-3">
                    <p className="text-muted-foreground">In 24 months</p>
                    <p className="font-bold text-foreground text-sm">{fmt(monthly24)}/mo</p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* AI Insights */}
      <div className="px-6 mt-4">
        <div className="bg-card rounded-xl p-4 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Sparkles size={16} className="text-accent" />
              <p className="text-sm font-semibold text-foreground">AI Insights</p>
            </div>
            <button onClick={fetchInsights} disabled={aiLoading} className="flex items-center gap-1 text-xs text-accent font-semibold">
              {aiLoading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
              {aiInsights.length > 0 ? 'Refresh' : 'Generate'}
            </button>
          </div>
          {aiInsights.length > 0 ? (
            <div className="space-y-3">
              {aiInsights.map((insight, i) => (
                <p key={i} className="text-xs text-muted-foreground leading-relaxed">{insight}</p>
              ))}
              {aiLastUpdated && (
                <p className="text-[10px] text-muted-foreground/50">Updated {formatDistanceToNow(aiLastUpdated, { addSuffix: true })}</p>
              )}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">Tap Generate for personalized emergency fund insights.</p>
          )}
        </div>
      </div>

      {/* Disclaimer */}
      <div className="px-6 mt-6 mb-8 flex gap-2">
        <Info size={14} className="text-muted-foreground shrink-0 mt-0.5" />
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          These tools provide general financial estimates powered by AI and standard planning guidelines. Results are for educational purposes only and may not reflect your complete financial picture. For personalized advice, consult a Certified Financial Planner (CFP®) professional or CPA.
        </p>
      </div>
    </div>
  );
}
