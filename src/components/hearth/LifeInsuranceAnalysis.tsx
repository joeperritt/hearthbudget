import { useState, useMemo, useEffect, useCallback } from 'react';
import { ArrowLeft, Shield, Sparkles, Loader2, Info, CheckCircle2, AlertTriangle, RefreshCw, Users } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { supabase } from '@/integrations/supabase/client';
import { useToolState } from '@/hooks/useToolState';
import { formatDistanceToNow } from 'date-fns';

function fmt(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);
}

interface LifeInsuranceAnalysisProps {
  onBack: () => void;
  householdId: string | null;
  onNavigateToProfile?: (tab?: string) => void;
}

interface MemberInsurance {
  name: string;
  annualIncome: number;
  currentCoverage: number;
  coverageType: string;
}

interface LIState {
  yearsUntilIndependent: string;
  educationPerChild: string;
}

const defaultState: LIState = {
  yearsUntilIndependent: '',
  educationPerChild: '100000',
};

export function LifeInsuranceAnalysis({ onBack, householdId, onNavigateToProfile }: LifeInsuranceAnalysisProps) {
  const { state, setState, loaded } = useToolState<LIState>(householdId, 'life-insurance', defaultState);
  const [profileLoading, setProfileLoading] = useState(true);
  const [members, setMembers] = useState<MemberInsurance[]>([]);
  const [totalDebt, setTotalDebt] = useState(0);
  const [mortgageBalance, setMortgageBalance] = useState(0);
  const [dependents, setDependents] = useState<{ name: string; age: number | null }[]>([]);

  // AI
  const [aiInsights, setAiInsights] = useState<string[]>([]);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiLastUpdated, setAiLastUpdated] = useState<Date | null>(null);

  useEffect(() => {
    if (!householdId) { setProfileLoading(false); return; }
    supabase.from('financial_profiles').select('*').eq('household_id', householdId).maybeSingle()
      .then(({ data: fp }) => {
        if (!fp) { setProfileLoading(false); return; }
        const memberIncomes = Array.isArray(fp.member_incomes) ? fp.member_incomes : [];
        const coverages = Array.isArray(fp.life_insurance_coverages) ? fp.life_insurance_coverages : [];

        const parsedMembers: MemberInsurance[] = memberIncomes.map((m: any, i: number) => {
          const cov: any = coverages.find((c: any) => c.name === m.name) || coverages[i];
          return {
            name: m.name || `Member ${i + 1}`,
            annualIncome: Number(m.gross_income) || 0,
            currentCoverage: cov ? Number((cov as any).coverage || 0) : 0,
            coverageType: cov ? ((cov as any).coverageType || 'none') : 'none',
          };
        });
        setMembers(parsedMembers);

        const debts: any[] = Array.isArray(fp.debts) ? (fp.debts as any[]) : [];
        setTotalDebt(debts.reduce((s: number, d: any) => s + (Number(d.balance) || 0), 0));
        setMortgageBalance(Number(fp.mortgage_balance) || 0);

        // Parse dependents from profile
        // dependents may be stored in the profile data
        const profileDeps = Array.isArray((fp as any).dependents) ? (fp as any).dependents : [];
        setDependents(profileDeps);

        // Auto-calculate years until independent from youngest dependent
        if (!state.yearsUntilIndependent && profileDeps.length > 0) {
          const ages = profileDeps.map((d: any) => Number(d.age) || 0).filter((a: number) => a > 0);
          if (ages.length > 0) {
            const youngest = Math.min(...ages);
            const yearsLeft = Math.max(0, 22 - youngest);
            setState({ yearsUntilIndependent: String(yearsLeft) });
          }
        }

        setProfileLoading(false);
      });
  }, [householdId]);

  const deps = dependents.length;
  const yearsIndep = parseInt(state.yearsUntilIndependent) || 18;
  const eduPerChild = Number(state.educationPerChild) || 100000;

  const memberAnalysis = useMemo(() => {
    return members.map(m => {
      const income = m.annualIncome;
      const coverage = m.currentCoverage;

      const irLow = income * 10;
      const irHigh = income * 12;
      const dime = totalDebt + (yearsIndep * income) + mortgageBalance + (deps * eduPerChild);

      const recLow = Math.min(irLow, dime);
      const recHigh = Math.max(irHigh, dime);
      const gap = Math.max(0, recLow - coverage);
      const surplus = coverage > recHigh ? coverage - recHigh : 0;

      let verdict: 'adequate' | 'underinsured' | 'overinsured' | 'none' = 'none';
      if (m.coverageType === 'none' || coverage === 0) verdict = income > 0 ? 'underinsured' : 'none';
      else if (coverage >= recLow) verdict = surplus > 0 ? 'overinsured' : 'adequate';
      else verdict = 'underinsured';

      return { ...m, income, coverage, irLow, irHigh, dime, recLow, recHigh, gap, surplus, verdict };
    });
  }, [members, totalDebt, mortgageBalance, deps, yearsIndep, eduPerChild]);

  const fetchInsights = useCallback(async () => {
    if (!householdId) return;
    setAiLoading(true);
    try {
      const memberSummary = memberAnalysis.map(m =>
        `${m.name}: Income ${fmt(m.income)}, Coverage ${fmt(m.coverage)} (${m.coverageType}), Recommended ${fmt(m.recLow)}–${fmt(m.recHigh)}, ${m.verdict}`
      ).join('\n');

      const prompt = `You are a Certified Financial Planner (CFP®) and Certified Kingdom Advisor (CKA®). Analyze this household's life insurance:
${memberSummary}
- Total debt: ${fmt(totalDebt)}
- Mortgage: ${fmt(mortgageBalance)}
- Dependents: ${deps}
- Years until independent: ${yearsIndep}

Provide exactly 3 short insights (2-3 sentences each). Cover: 1) Coverage adequacy per member, 2) Which calculation method suggests higher need and why, 3) Encouragement to review with a professional. Warm, stewardship-framed, specific. No markdown formatting.`;

      const { data } = await supabase.functions.invoke('budget-insights', {
        body: { prompt, householdId },
      });
      if (data?.insights) {
        const parsed = Array.isArray(data.insights) ? data.insights : data.insights.split('\n\n').filter(Boolean);
        setAiInsights(parsed.slice(0, 3));
      }
      setAiLastUpdated(new Date());
    } catch (e) {
      console.error('AI insights error:', e);
    }
    setAiLoading(false);
  }, [householdId, memberAnalysis, totalDebt, mortgageBalance, deps, yearsIndep]);

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
          <h1 className="font-display text-xl font-bold text-foreground">Life Insurance Analysis</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Is your family protected?</p>
        </div>
      </div>

      {/* Important Disclaimer */}
      <div className="px-6 mt-6">
        <div className="bg-accent/10 border border-accent/30 rounded-xl p-4">
          <div className="flex gap-2">
            <Info size={16} className="text-accent shrink-0 mt-0.5" />
            <p className="text-xs text-foreground leading-relaxed">
              This tool analyzes life insurance coverage only. It does not evaluate disability insurance, long-term care insurance, or property and casualty coverage (home, auto, umbrella). A comprehensive insurance review with a Certified Financial Planner (CFP®) professional is strongly recommended to assess your complete coverage needs.
            </p>
          </div>
        </div>
      </div>

      {/* Household Details — Read-only from profile */}
      <div className="px-6 mt-4">
        <div className="bg-card rounded-xl p-4 shadow-sm space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-foreground">Household Details</p>
            {onNavigateToProfile && (
              <button onClick={() => onNavigateToProfile('debts')} className="text-xs font-semibold text-accent">
                From Financial Profile →
              </button>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <ReadOnlyField label="Total Non-Mortgage Debt" value={fmt(totalDebt)} />
            <ReadOnlyField label="Mortgage Balance" value={fmt(mortgageBalance)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <ReadOnlyField label="Dependents" value={String(deps)} />
            <div>
              <Label className="text-xs text-muted-foreground">Years to Independent</Label>
              <Input type="number" className="mt-1" value={state.yearsUntilIndependent} onChange={e => setState({ yearsUntilIndependent: e.target.value })} min="0" placeholder="18" />
            </div>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Education $/Child</Label>
            <div className="relative mt-1">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
              <Input type="number" className="pl-7" value={state.educationPerChild} onChange={e => setState({ educationPerChild: e.target.value })} />
            </div>
          </div>
        </div>
      </div>

      {/* Per Member — Read-only from profile */}
      {members.map((member, i) => {
        const analysis = memberAnalysis[i];
        return (
          <div key={i} className="px-6 mt-4">
            <div className="bg-card rounded-xl p-4 shadow-sm space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Users size={16} className="text-primary" />
                  <p className="text-sm font-semibold text-foreground">{member.name}</p>
                </div>
                <div className="flex items-center gap-2">
                  {analysis.income > 0 && (
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                      analysis.verdict === 'adequate' ? 'bg-green-100 text-green-700' :
                      analysis.verdict === 'overinsured' ? 'bg-accent/10 text-accent' :
                      analysis.verdict === 'underinsured' ? 'bg-red-100 text-destructive' :
                      'bg-muted text-muted-foreground'
                    }`}>
                      {analysis.verdict === 'adequate' ? 'Adequate' :
                       analysis.verdict === 'overinsured' ? 'Overinsured' :
                       analysis.verdict === 'underinsured' ? 'Underinsured' : 'N/A'}
                    </span>
                  )}
                  {onNavigateToProfile && (
                    <button onClick={() => onNavigateToProfile('insurance')} className="text-[10px] font-semibold text-accent">
                      Profile →
                    </button>
                  )}
                </div>
              </div>

              {/* Read-only fields */}
              <div className="grid grid-cols-2 gap-3">
                <ReadOnlyField label="Annual Income" value={fmt(member.annualIncome)} />
                <ReadOnlyField label="Current Coverage" value={fmt(member.currentCoverage)} />
              </div>
              <ReadOnlyField label="Coverage Type" value={member.coverageType === 'none' ? 'No Coverage' : member.coverageType.charAt(0).toUpperCase() + member.coverageType.slice(1)} />

              {/* Analysis for this member */}
              {analysis.income > 0 && (
                <div className="border-t border-border pt-3 space-y-3">
                  <p className="text-xs font-semibold text-muted-foreground">Two CFP® Approaches</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-muted/50 rounded-lg p-3">
                      <p className="text-[11px] font-semibold text-foreground">Income Replacement</p>
                      <p className="text-[10px] text-muted-foreground">10–12× annual income</p>
                      <p className="text-sm font-bold text-primary mt-1">{fmt(analysis.irLow)}–{fmt(analysis.irHigh)}</p>
                    </div>
                    <div className="bg-muted/50 rounded-lg p-3">
                      <p className="text-[11px] font-semibold text-foreground">DIME Method</p>
                      <p className="text-[10px] text-muted-foreground">Debt+Income+Mortgage+Education</p>
                      <p className="text-sm font-bold text-primary mt-1">{fmt(analysis.dime)}</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <div>
                      <p className="text-muted-foreground">Current</p>
                      <p className="font-bold text-foreground">{fmt(analysis.coverage)}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Recommended</p>
                      <p className="font-bold text-foreground">{fmt(analysis.recLow)}–{fmt(analysis.recHigh)}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">{analysis.gap > 0 ? 'Gap' : 'Surplus'}</p>
                      <p className={`font-bold ${analysis.gap > 0 ? 'text-destructive' : 'text-green-600'}`}>
                        {analysis.gap > 0 ? fmt(analysis.gap) : fmt(analysis.surplus)}
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        );
      })}

      {members.length === 0 && (
        <div className="px-6 mt-4">
          <div className="bg-card rounded-xl p-8 shadow-sm border border-border text-center">
            <p className="text-sm text-muted-foreground">No member data found. Set up your Financial Profile to use this tool.</p>
            {onNavigateToProfile && (
              <button onClick={() => onNavigateToProfile('insurance')} className="text-sm font-semibold text-accent mt-3">
                Go to Financial Profile →
              </button>
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
            <p className="text-xs text-muted-foreground">Tap Generate for personalized life insurance insights.</p>
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

function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm font-semibold text-foreground mt-0.5">{value}</p>
    </div>
  );
}
