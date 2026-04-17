import { useState, useMemo, useEffect, useCallback } from 'react';
import { ArrowLeft, Sparkles, Loader2, Info, RefreshCw, Users, ChevronDown, AlertTriangle } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { supabase } from '@/integrations/supabase/client';
import { useToolState } from '@/hooks/useToolState';
import { formatDistanceToNow } from 'date-fns';
import { ageFromDob, yearsUntilAge } from '@/lib/ageUtils';
import { EducationCostEstimator, EducationDependent } from './EducationCostEstimator';
import { AIInsightsList, parseAIInsights, AIInsight } from './AIInsightsList';

function fmt(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);
}

interface LifeInsuranceAnalysisProps {
  onBack: () => void;
  householdId: string | null;
  onNavigateToProfile?: (tab?: string) => void;
}

interface Policy {
  id: string;
  type: 'term' | 'whole' | 'group_employer';
  coverage: number;
  premium: number;
  termLength?: string;
  startYear?: number;
  cashValue?: number;
  primaryBeneficiaries?: any[];
  contingentBeneficiaries?: any[];
}

interface MemberInsurance {
  name: string;
  annualIncome: number;
  policies: Policy[];
  totalCoverage: number;
}

interface LIState {
  yearsUntilIndependent: string;
  educationPerChild: string;
}

const defaultState: LIState = {
  yearsUntilIndependent: '',
  educationPerChild: '100000',
};

const POLICY_LABELS: Record<string, string> = { term: 'Term', whole: 'Whole', group_employer: 'Group' };

function policyExpiry(p: Policy): number | null {
  if (p.type !== 'term') return null;
  if (!p.termLength || !p.startYear) return null;
  const len = parseInt(p.termLength) || 0;
  if (!len) return null;
  return p.startYear + len;
}

function summarizeCoverageType(policies: Policy[]): string {
  if (!policies.length) return 'No Coverage';
  const counts: Record<string, number> = {};
  policies.forEach(p => { counts[p.type] = (counts[p.type] || 0) + 1; });
  const parts = Object.entries(counts).map(([type, n]) =>
    n > 1 ? `${POLICY_LABELS[type] || type} (${n} policies)` : POLICY_LABELS[type] || type
  );
  return parts.join(' + ');
}

function hasNamedBeneficiary(p: Policy): boolean {
  const list = p.primaryBeneficiaries || [];
  return Array.isArray(list) && list.length > 0;
}

export function LifeInsuranceAnalysis({ onBack, householdId, onNavigateToProfile }: LifeInsuranceAnalysisProps) {
  const { state, setState, loaded } = useToolState<LIState>(householdId, 'life-insurance', defaultState);
  const [profileLoading, setProfileLoading] = useState(true);
  const [members, setMembers] = useState<MemberInsurance[]>([]);
  const [totalDebt, setTotalDebt] = useState(0);
  const [mortgageBalance, setMortgageBalance] = useState(0);
  const [dependents, setDependents] = useState<{ name: string; age: number | null; dob?: string | null }[]>([]);
  const [expandedPolicies, setExpandedPolicies] = useState<Record<string, boolean>>({});
  const [autoYearsApplied, setAutoYearsApplied] = useState(false);

  const [aiInsights, setAiInsights] = useState<string[]>([]);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiLastUpdated, setAiLastUpdated] = useState<Date | null>(null);

  useEffect(() => {
    if (!householdId) { setProfileLoading(false); return; }
    supabase.from('financial_profiles').select('*').eq('household_id', householdId).maybeSingle()
      .then(({ data: fp }) => {
        if (!fp) { setProfileLoading(false); return; }
        const memberIncomes: any[] = Array.isArray(fp.member_incomes) ? (fp.member_incomes as any[]) : [];
        const coverages: any[] = Array.isArray(fp.life_insurance_coverages) ? (fp.life_insurance_coverages as any[]) : [];

        const parsedMembers: MemberInsurance[] = memberIncomes.map((m: any, i: number) => {
          const cov: any = coverages.find((c: any) => c.profile_id === m.profile_id)
            || coverages.find((c: any) => c.name === m.name)
            || coverages[i];
          const policies: Policy[] = Array.isArray(cov?.policies) ? cov.policies : [];
          const totalCoverage = policies.reduce((s, p) => s + (Number(p.coverage) || 0), 0);
          return {
            name: m.name || `Member ${i + 1}`,
            annualIncome: Number(m.gross_income) || 0,
            policies,
            totalCoverage,
          };
        });
        setMembers(parsedMembers);

        const debts: any[] = Array.isArray(fp.debts) ? (fp.debts as any[]) : [];
        setTotalDebt(debts.reduce((s: number, d: any) => s + (Number(d.balance) || 0), 0));
        setMortgageBalance(Number(fp.mortgage_balance) || 0);

        const profileDeps: any[] = Array.isArray((fp as any).dependents) ? (fp as any).dependents : [];
        setDependents(profileDeps);
        setProfileLoading(false);
      });
  }, [householdId]);

  // Auto-calculate years until independent based on youngest dependent
  const youngestDependent = useMemo(() => {
    if (!dependents.length) return null;
    let youngest = dependents[0];
    let youngestAge = Infinity;
    for (const d of dependents) {
      const a = d.dob ? ageFromDob(d.dob) : (d.age ?? null);
      const ageVal = a ?? 99;
      if (ageVal < youngestAge) {
        youngestAge = ageVal;
        youngest = d;
      }
    }
    return { ...youngest, currentAge: youngestAge === Infinity ? null : youngestAge };
  }, [dependents]);

  useEffect(() => {
    if (!loaded || autoYearsApplied) return;
    if (state.yearsUntilIndependent) { setAutoYearsApplied(true); return; }
    if (youngestDependent && youngestDependent.currentAge !== null) {
      const years = Math.max(0, 18 - (youngestDependent.currentAge as number));
      setState({ yearsUntilIndependent: String(years) });
      setAutoYearsApplied(true);
    }
  }, [loaded, youngestDependent, state.yearsUntilIndependent, autoYearsApplied, setState]);

  const deps = dependents.length;
  const yearsIndep = state.yearsUntilIndependent === '' ? 18 : (parseInt(state.yearsUntilIndependent) || 0);
  const eduPerChild = Number(state.educationPerChild) || 0;

  const memberAnalysis = useMemo(() => {
    return members.map(m => {
      const income = m.annualIncome;
      const coverage = m.totalCoverage;
      const irLow = income * 10;
      const irHigh = income * 12;
      const dime = totalDebt + (yearsIndep * income) + mortgageBalance + (deps * eduPerChild);
      const recLow = Math.min(irLow || 0, dime || 0) || Math.max(irLow, dime);
      const recHigh = Math.max(irHigh, dime);
      const gap = Math.max(0, recLow - coverage);
      const surplus = coverage > recHigh ? coverage - recHigh : 0;

      let verdict: 'adequate' | 'underinsured' | 'none' = 'none';
      if (coverage === 0) verdict = income > 0 ? 'underinsured' : 'none';
      else if (coverage >= recLow) verdict = 'adequate';
      else verdict = 'underinsured';

      return { ...m, income, coverage, irLow, irHigh, dime, recLow, recHigh, gap, surplus, verdict };
    });
  }, [members, totalDebt, mortgageBalance, deps, yearsIndep, eduPerChild]);

  // Coverage Timeline: stepped breakdown by expiry year
  const coverageTimeline = useMemo(() => {
    const allPolicies: { coverage: number; expiry: number | null }[] = [];
    members.forEach(m => m.policies.forEach(p => {
      allPolicies.push({ coverage: Number(p.coverage) || 0, expiry: policyExpiry(p) });
    }));
    const today = members.reduce((s, m) => s + m.totalCoverage, 0);
    if (today === 0) return [];

    // Collect distinct future expiry years
    const currentYear = new Date().getFullYear();
    const expiryYears = Array.from(new Set(
      allPolicies.map(p => p.expiry).filter((y): y is number => !!y && y > currentYear)
    )).sort((a, b) => a - b);

    const steps: { label: string; total: number; note?: string }[] = [
      { label: 'Today', total: today },
    ];
    for (const year of expiryYears) {
      const remaining = allPolicies
        .filter(p => !p.expiry || p.expiry > year)
        .reduce((s, p) => s + p.coverage, 0);
      const expiringThisYear = allPolicies
        .filter(p => p.expiry === year)
        .reduce((s, p) => s + p.coverage, 0);
      steps.push({
        label: `After ${year}`,
        total: remaining,
        note: `${fmt(expiringThisYear)} of term coverage expires`,
      });
    }
    return steps;
  }, [members]);

  const fetchInsights = useCallback(async () => {
    if (!householdId) return;
    setAiLoading(true);
    setAiError(null);
    try {
      const memberSummary = memberAnalysis.map(m => {
        const policyDetail = m.policies.map(p => {
          const exp = policyExpiry(p);
          return `${POLICY_LABELS[p.type] || p.type} ${fmt(Number(p.coverage) || 0)}${exp ? ` expires ${exp}` : ''}`;
        }).join('; ') || 'no policies';
        return `${m.name}: Income ${fmt(m.income)}, Coverage ${fmt(m.coverage)} [${policyDetail}], Recommended ${fmt(m.recLow)}–${fmt(m.recHigh)}, ${m.verdict}`;
      }).join('\n');

      const timelineSummary = coverageTimeline.map(s => `${s.label}: ${fmt(s.total)}`).join(' → ');

      const prompt = `You are a Certified Financial Planner (CFP®) and Certified Kingdom Advisor (CKA®). Analyze this household's life insurance coverage:

${memberSummary}

Household context:
- Total non-mortgage debt: ${fmt(totalDebt)}
- Mortgage balance: ${fmt(mortgageBalance)}
- Dependents: ${deps}
- Years until youngest dependent independent: ${yearsIndep}
- Education savings target per child: ${fmt(eduPerChild)}

Coverage timeline (how total household coverage steps down as term policies expire):
${timelineSummary || 'No coverage in force.'}

Provide exactly 3 short insights (2-3 sentences each). Cover: 1) Coverage adequacy per member with specific dollar gaps if any, 2) Whether the coverage timeline aligns with the family's protection window (children at home, mortgage payoff), 3) A stewardship-framed encouragement to review with a Certified Financial Planner. Reference real numbers. No markdown, no asterisks, no headings — plain prose paragraphs separated by blank lines.`;

      const { data, error } = await supabase.functions.invoke('budget-insights', {
        body: { prompt },
      });
      if (error) {
        console.error('AI insights edge function error:', error);
        setAiError(error.message || 'Failed to generate insights.');
        setAiLoading(false);
        return;
      }
      const content: string = data?.content || '';
      if (!content) {
        console.error('AI insights returned no content. Response:', data);
        setAiError('No insights returned.');
        setAiLoading(false);
        return;
      }
      // Split by blank lines into paragraphs, take first 3
      const parsed = content
        .split(/\n\s*\n/)
        .map(s => s.replace(/\*\*/g, '').replace(/^\s*\d+[\.\)]\s*/, '').trim())
        .filter(Boolean)
        .slice(0, 3);
      setAiInsights(parsed);
      setAiLastUpdated(new Date());
    } catch (e) {
      console.error('AI insights error:', e);
      setAiError(e instanceof Error ? e.message : 'Unknown error');
    }
    setAiLoading(false);
  }, [householdId, memberAnalysis, totalDebt, mortgageBalance, deps, yearsIndep, eduPerChild, coverageTimeline]);

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

  const togglePolicy = (key: string) => setExpandedPolicies(prev => ({ ...prev, [key]: !prev[key] }));

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

      {/* Disclaimer */}
      <div className="px-6 mt-6">
        <div className="bg-accent/10 border border-accent/30 rounded-xl p-4">
          <div className="flex gap-2">
            <Info size={16} className="text-accent shrink-0 mt-0.5" />
            <p className="text-xs text-foreground leading-relaxed">
              This tool analyzes life insurance coverage only. Disability insurance, long-term care coverage, and property and casualty coverage (home, auto, umbrella) are critical components of a complete protection plan. We strongly encourage meeting with a Certified Financial Planner (CFP®) to discuss these additional protections.
            </p>
          </div>
        </div>
      </div>

      {/* Household Details */}
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
              <Input
                type="number"
                className="mt-1"
                value={state.yearsUntilIndependent}
                onChange={e => setState({ yearsUntilIndependent: e.target.value })}
                min="0"
                placeholder="18"
              />
              {youngestDependent && youngestDependent.currentAge !== null && (
                <p className="text-[10px] text-muted-foreground mt-1">
                  Based on {youngestDependent.name || 'youngest dependent'}, age {youngestDependent.currentAge}
                </p>
              )}
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

      {/* Coverage Timeline */}
      {coverageTimeline.length > 0 && (
        <div className="px-6 mt-4">
          <div className="bg-card rounded-xl p-4 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-semibold text-foreground">Coverage Timeline</p>
              <span className="text-[10px] text-muted-foreground">As term policies expire</span>
            </div>
            <div className="space-y-2">
              {coverageTimeline.map((step, idx) => {
                const maxTotal = coverageTimeline[0].total || 1;
                const pct = (step.total / maxTotal) * 100;
                const isZero = step.total === 0;
                return (
                  <div key={idx} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium text-foreground">{step.label}</span>
                      <span className={`font-semibold tabular-nums ${isZero ? 'text-destructive' : 'text-primary'}`}>
                        {fmt(step.total)}
                      </span>
                    </div>
                    <div className="h-2 bg-muted/50 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${isZero ? 'bg-destructive/30' : 'bg-primary'}`}
                        style={{ width: `${Math.max(pct, isZero ? 4 : 8)}%` }}
                      />
                    </div>
                    {step.note && (
                      <p className="text-[10px] text-muted-foreground">{step.note}</p>
                    )}
                  </div>
                );
              })}
            </div>
            <p className="text-[10px] text-muted-foreground mt-3 leading-relaxed">
              Term policies provide coverage for a fixed period. Make sure your coverage spans the years your family depends on it most — while children are at home and the mortgage is outstanding.
            </p>
          </div>
        </div>
      )}

      {/* Per Member */}
      {memberAnalysis.map((member, i) => {
        const policyCount = member.policies.length;
        const missingBeneficiaries = member.policies.filter(p => !hasNamedBeneficiary(p)).length;
        return (
          <div key={i} className="px-6 mt-4">
            <div className="bg-card rounded-xl p-4 shadow-sm space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Users size={16} className="text-primary" />
                  <p className="text-sm font-semibold text-foreground">{member.name}</p>
                </div>
                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                  member.coverage === 0 ? 'bg-destructive/15 text-destructive' :
                  member.verdict === 'adequate' ? 'bg-green-100 text-green-700' :
                  member.verdict === 'underinsured' ? 'bg-destructive/15 text-destructive' :
                  'bg-muted text-muted-foreground'
                }`}>
                  {member.coverage === 0 ? 'No Coverage' :
                   member.verdict === 'adequate' ? 'Adequately Covered' :
                   member.verdict === 'underinsured' ? 'Underinsured' : 'N/A'}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <ReadOnlyField label="Annual Income" value={fmt(member.annualIncome)} />
                <ReadOnlyField label="Current Coverage" value={fmt(member.totalCoverage)} />
              </div>
              <ReadOnlyField label="Coverage Type" value={summarizeCoverageType(member.policies)} />

              {/* Your Policies */}
              {policyCount > 0 ? (
                <div className="border-t border-border pt-3">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs font-semibold text-muted-foreground">Your Policies ({policyCount})</p>
                    {onNavigateToProfile && (
                      <button onClick={() => onNavigateToProfile('insurance')} className="text-[10px] font-semibold text-accent">
                        From Financial Profile →
                      </button>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    {member.policies.map((policy, pi) => {
                      const key = `${i}_${policy.id || pi}`;
                      const isExpanded = !!expandedPolicies[key];
                      const expiry = policyExpiry(policy);
                      return (
                        <div key={key} className="bg-muted/30 rounded-lg border border-border/50 overflow-hidden">
                          <button
                            type="button"
                            onClick={() => togglePolicy(key)}
                            className="w-full flex items-center gap-2 px-3 py-2 text-left"
                          >
                            <span className={`px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wider shrink-0 ${
                              policy.type === 'term' ? 'bg-primary/10 text-primary' :
                              policy.type === 'whole' ? 'bg-accent/10 text-accent' :
                              'bg-muted text-muted-foreground'
                            }`}>
                              {POLICY_LABELS[policy.type] || policy.type}
                            </span>
                            <span className="text-xs font-semibold text-foreground tabular-nums">{fmt(Number(policy.coverage) || 0)}</span>
                            <span className="text-[10px] text-muted-foreground tabular-nums">{fmt(Number(policy.premium) || 0)}/yr</span>
                            <span className="text-[10px] text-muted-foreground flex-1 text-right truncate">
                              {expiry ? `Expires ${expiry}` : ''}
                            </span>
                            <ChevronDown size={14} className={`text-muted-foreground transition-transform shrink-0 ${isExpanded ? 'rotate-180' : ''}`} />
                          </button>
                          {isExpanded && (
                            <div className="px-3 pb-3 pt-1 border-t border-border/50 grid grid-cols-2 gap-2 text-[11px]">
                              <div>
                                <p className="text-muted-foreground">Coverage</p>
                                <p className="font-semibold text-foreground tabular-nums">{fmt(Number(policy.coverage) || 0)}</p>
                              </div>
                              <div>
                                <p className="text-muted-foreground">Annual Premium</p>
                                <p className="font-semibold text-foreground tabular-nums">{fmt(Number(policy.premium) || 0)}</p>
                              </div>
                              {policy.type === 'term' && (
                                <>
                                  <div>
                                    <p className="text-muted-foreground">Term Length</p>
                                    <p className="font-semibold text-foreground">{policy.termLength || '—'}</p>
                                  </div>
                                  <div>
                                    <p className="text-muted-foreground">Expires</p>
                                    <p className="font-semibold text-foreground tabular-nums">{expiry || '—'}</p>
                                  </div>
                                </>
                              )}
                              {policy.type === 'whole' && policy.cashValue ? (
                                <div>
                                  <p className="text-muted-foreground">Cash Value</p>
                                  <p className="font-semibold text-foreground tabular-nums">{fmt(Number(policy.cashValue) || 0)}</p>
                                </div>
                              ) : null}
                              <div className="col-span-2">
                                <p className="text-muted-foreground">Primary Beneficiary</p>
                                <p className="font-semibold text-foreground">
                                  {hasNamedBeneficiary(policy) ? `${(policy.primaryBeneficiaries || []).length} named` : 'Not named'}
                                </p>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className="border-t border-border pt-3 flex items-center justify-between">
                  <p className="text-xs text-muted-foreground">No policies on file.</p>
                  {onNavigateToProfile && (
                    <button onClick={() => onNavigateToProfile('insurance')} className="text-[10px] font-semibold text-accent">
                      Add in Financial Profile →
                    </button>
                  )}
                </div>
              )}

              {/* CFP Approaches */}
              {member.income > 0 && (
                <div className="border-t border-border pt-3 space-y-3">
                  <p className="text-xs font-semibold text-muted-foreground">Two CFP® Approaches</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-muted/50 rounded-lg p-3">
                      <p className="text-[11px] font-semibold text-foreground">Income Replacement</p>
                      <p className="text-[10px] text-muted-foreground">10–12× annual income</p>
                      <p className="text-sm font-bold text-primary mt-1 tabular-nums">{fmt(member.irLow)}–{fmt(member.irHigh)}</p>
                    </div>
                    <div className="bg-muted/50 rounded-lg p-3">
                      <p className="text-[11px] font-semibold text-foreground">DIME Method</p>
                      <p className="text-[10px] text-muted-foreground">Debt + Income + Mortgage + Education</p>
                      <p className="text-sm font-bold text-primary mt-1 tabular-nums">{fmt(member.dime)}</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <div>
                      <p className="text-muted-foreground">Current</p>
                      <p className="font-bold text-foreground tabular-nums">{fmt(member.coverage)}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Recommended</p>
                      <p className="font-bold text-foreground tabular-nums">{fmt(member.recLow)}–{fmt(member.recHigh)}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">{member.gap > 0 ? 'Gap' : 'Surplus'}</p>
                      <p className={`font-bold tabular-nums ${member.gap > 0 ? 'text-destructive' : 'text-green-600'}`}>
                        {member.gap > 0 ? fmt(member.gap) : fmt(member.surplus)}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Beneficiary status */}
              {policyCount > 0 && (
                <div className="border-t border-border pt-3">
                  <p className="text-xs font-semibold text-muted-foreground mb-1.5">Beneficiary Status</p>
                  {missingBeneficiaries === 0 ? (
                    <p className="text-[11px] text-foreground leading-relaxed">
                      All {policyCount} {policyCount === 1 ? 'policy has' : 'policies have'} a named primary beneficiary.
                    </p>
                  ) : (
                    <div className="flex items-start gap-1.5">
                      <AlertTriangle size={12} className="text-destructive shrink-0 mt-0.5" />
                      <p className="text-[11px] text-destructive leading-relaxed">
                        {missingBeneficiaries} of {policyCount} {policyCount === 1 ? 'policy is' : 'policies are'} missing a named beneficiary.{' '}
                        {onNavigateToProfile && (
                          <button onClick={() => onNavigateToProfile('insurance')} className="font-semibold underline underline-offset-2">
                            Review in Financial Profile →
                          </button>
                        )}
                      </p>
                    </div>
                  )}
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
            <button onClick={fetchInsights} disabled={aiLoading} className="flex items-center gap-1 text-xs text-accent font-semibold disabled:opacity-50">
              {aiLoading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
              {aiInsights.length > 0 ? 'Refresh' : 'Generate'}
            </button>
          </div>
          {aiError && (
            <p className="text-xs text-destructive mb-2">{aiError}</p>
          )}
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
            !aiError && <p className="text-xs text-muted-foreground">Tap Generate for personalized life insurance insights.</p>
          )}
        </div>
      </div>

      {/* Footer disclaimer */}
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
