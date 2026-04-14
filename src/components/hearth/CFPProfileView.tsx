import { useState, useEffect, useCallback, useRef } from 'react';
import { ArrowLeft, Plus, Trash2, Shield, Check, Info } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { formatDistanceToNow } from 'date-fns';
import { ageFromDob, ageToDobApprox, formatDob } from '@/lib/ageUtils';

function fmt(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);
}

interface Debt {
  type: string;
  balance: number;
  interestRate: number;
  monthlyPayment: number;
  extraPayment: number;
}

interface Dependent {
  name: string;
  age: number | null;
  dob?: string | null;
}

interface MemberCoverage {
  profile_id: string;
  name: string;
  coverage: number;
  coverageType: 'term' | 'whole' | 'mixed' | 'none';
  mixedTermPct: number;
}

interface IncomeSource {
  type: string;
  amount: number;
}

interface MemberIncome {
  profile_id: string;
  name: string;
  gross_income: number;
  income_type: string;
  income_sources?: IncomeSource[];
  dob?: string | null;
  age?: number;
  pay_frequency: string;
  mixed_breakdown?: { w2: number; k1: number; '1099': number; scorp: number };
}

interface ProfileData {
  member_incomes: MemberIncome[];
  dependents: Dependent[];
  filing_status: string;
  state: string;
  housing_type: string;
  mortgage_balance: number;
  mortgage_rate: number;
  mortgage_payment: number;
  mortgage_pi: number;
  mortgage_escrow: number;
  mortgage_extra: number;
  mortgage_statement_month: string;
  mortgage_breakdown_enabled: boolean;
  monthly_rent: number;
  debts: Debt[];
  non_retirement_investments: number;
  retirement_balance: number;
  retirement_balance_per_member: Record<string, number>;
  roth_retirement_balance: number;
  roth_balance_per_member: Record<string, number>;
  emergency_fund_balance: number;
  savings_balance: number;
  has_life_insurance: boolean;
  life_insurance_coverage: number;
  life_insurance_coverages: MemberCoverage[];
  dependent_life_insurance: boolean;
  dependent_life_coverage: number;
}

const DEFAULT_PROFILE: ProfileData = {
  member_incomes: [],
  dependents: [],
  filing_status: 'single',
  state: '',
  housing_type: 'rent',
  mortgage_balance: 0,
  mortgage_rate: 0,
  mortgage_payment: 0,
  mortgage_pi: 0,
  mortgage_escrow: 0,
  mortgage_extra: 0,
  mortgage_statement_month: '',
  mortgage_breakdown_enabled: false,
  monthly_rent: 0,
  debts: [],
  non_retirement_investments: 0,
  retirement_balance: 0,
  retirement_balance_per_member: {},
  roth_retirement_balance: 0,
  roth_balance_per_member: {},
  emergency_fund_balance: 0,
  savings_balance: 0,
  has_life_insurance: false,
  life_insurance_coverage: 0,
  life_insurance_coverages: [],
  dependent_life_insurance: false,
  dependent_life_coverage: 0,
};

const INCOME_GRID_TYPES = [
  { value: 'w2', label: 'W-2 / Salary' },
  { value: '1099', label: '1099 / Self-Employed' },
  { value: 'k1', label: 'K-1 / S-Corp' },
  { value: 'rental', label: 'Rental' },
  { value: 'other', label: 'Other' },
];

const INCOME_SOURCE_TOOLTIPS: Record<string, string> = {
  w2: 'Wages or salary from an employer. You receive a W-2 form at tax time. This is the most common income type.',
  '1099': 'Self-employment, freelance, or contract income. You receive a 1099 form and are responsible for paying self-employment taxes.',
  k1: 'Income from a partnership or S-Corporation where you are an owner. You receive a Schedule K-1 at tax time. This differs from 1099 in that it reflects ownership distributions rather than payments for services rendered.',
  rental: 'Income from rental properties you own.',
  other: 'Any other taxable income not covered above.',
};

const PAY_FREQUENCIES = [
  { value: 'weekly', label: 'Weekly' },
  { value: 'biweekly', label: 'Bi-Weekly' },
  { value: 'semimonthly', label: 'Semi-Monthly' },
  { value: 'monthly', label: 'Monthly' },
];

const FILING_STATUSES = [
  { value: 'single', label: 'Single' },
  { value: 'married_jointly', label: 'Married Filing Jointly' },
  { value: 'married_separately', label: 'Married Filing Separately' },
  { value: 'head_of_household', label: 'Head of Household' },
];

const US_STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','DC','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME',
  'MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI',
  'SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY',
];

const STATE_NAMES: Record<string, string> = {
  AL:'Alabama',AK:'Alaska',AZ:'Arizona',AR:'Arkansas',CA:'California',CO:'Colorado',CT:'Connecticut',
  DE:'Delaware',DC:'District of Columbia',FL:'Florida',GA:'Georgia',HI:'Hawaii',ID:'Idaho',IL:'Illinois',
  IN:'Indiana',IA:'Iowa',KS:'Kansas',KY:'Kentucky',LA:'Louisiana',ME:'Maine',MD:'Maryland',MA:'Massachusetts',
  MI:'Michigan',MN:'Minnesota',MS:'Mississippi',MO:'Missouri',MT:'Montana',NE:'Nebraska',NV:'Nevada',
  NH:'New Hampshire',NJ:'New Jersey',NM:'New Mexico',NY:'New York',NC:'North Carolina',ND:'North Dakota',
  OH:'Ohio',OK:'Oklahoma',OR:'Oregon',PA:'Pennsylvania',RI:'Rhode Island',SC:'South Carolina',SD:'South Dakota',
  TN:'Tennessee',TX:'Texas',UT:'Utah',VT:'Vermont',VA:'Virginia',WA:'Washington',WV:'West Virginia',
  WI:'Wisconsin',WY:'Wyoming',
};

const DEBT_TYPES = ['Auto Loan', 'Student Loan', 'Credit Card', 'Personal Loan', 'Medical', 'Other'];
const HOUSING_TYPES = [
  { value: 'own_no_mortgage', label: 'Own — No Mortgage' },
  { value: 'own', label: 'Own — Mortgage' },
  { value: 'rent', label: 'Rent' },
];

type ProfileTab = 'profile' | 'income' | 'housing' | 'debts' | 'accounts' | 'insurance';

interface HouseholdMember {
  id: string;
  display_name: string;
}

interface CFPProfileViewProps {
  onBack: () => void;
  householdId: string | null;
  initialTab?: ProfileTab;
}

export function CFPProfileView({ onBack, householdId, initialTab }: CFPProfileViewProps) {
  const [profile, setProfile] = useState<ProfileData>(DEFAULT_PROFILE);
  const [loading, setLoading] = useState(true);
  const [existingId, setExistingId] = useState<string | null>(null);
  const [members, setMembers] = useState<HouseholdMember[]>([]);
  const [activeProfileTab, setActiveProfileTab] = useState<ProfileTab>(initialTab || 'profile');
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!householdId) return;
    async function load() {
      const [membersRes, profileRes] = await Promise.all([
        supabase.from('profiles').select('id, display_name').eq('household_id', householdId),
        supabase.from('financial_profiles').select('*').eq('household_id', householdId).maybeSingle(),
      ]);

      const membersList = membersRes.data || [];
      setMembers(membersList);

      const data = profileRes.data;
      if (data) {
        setExistingId(data.id);
        const savedIncomes = Array.isArray(data.member_incomes) ? (data.member_incomes as unknown as MemberIncome[]) : [];
        const incomes: MemberIncome[] = membersList.map(m => {
          const existing = savedIncomes.find(i => i.profile_id === m.id);
          const base = existing || { profile_id: m.id, name: m.display_name, gross_income: 0, income_type: 'w2', dob: null, pay_frequency: 'biweekly' };
          // Migrate: if no income_sources yet but has gross_income, create one source
          if (!base.income_sources || base.income_sources.length === 0) {
            if (base.gross_income > 0) {
              const typeMap: Record<string, string> = { self_employed: '1099', mixed: 'w2' };
              const srcType = typeMap[base.income_type] || base.income_type || 'w2';
              base.income_sources = [{ type: srcType, amount: base.gross_income }];
              // If mixed, create multiple sources from breakdown
              if (base.income_type === 'mixed' && base.mixed_breakdown) {
                const bd = base.mixed_breakdown;
                base.income_sources = [];
                if (bd.w2 > 0) base.income_sources.push({ type: 'w2', amount: bd.w2 });
                if (bd['1099'] > 0) base.income_sources.push({ type: '1099', amount: bd['1099'] });
                if (bd.k1 > 0) base.income_sources.push({ type: 'k1', amount: bd.k1 });
                if (bd.scorp > 0) base.income_sources.push({ type: 'scorp', amount: bd.scorp });
                if (base.income_sources.length === 0) base.income_sources = [{ type: 'w2', amount: base.gross_income }];
              }
            } else {
              base.income_sources = [];
            }
          }
          return base;
        });
        if (savedIncomes.length === 0 && Number(data.annual_gross_income) > 0 && incomes.length > 0 && (!incomes[0].income_sources || incomes[0].income_sources.length === 0)) {
          const srcType = data.income_type === 'self_employed' ? '1099' : (data.income_type || 'w2');
          incomes[0].gross_income = Number(data.annual_gross_income);
          incomes[0].income_type = data.income_type || 'w2';
          incomes[0].income_sources = [{ type: srcType, amount: Number(data.annual_gross_income) }];
        }

        const savedCoverages = Array.isArray((data as any).life_insurance_coverages) ? ((data as any).life_insurance_coverages as unknown as MemberCoverage[]) : [];
        const coverages: MemberCoverage[] = membersList.map(m => {
          const existing = savedCoverages.find(c => c.profile_id === m.id);
          return existing || { profile_id: m.id, name: m.display_name, coverage: 0, coverageType: 'none', mixedTermPct: 50 };
        });
        if (savedCoverages.length === 0 && Number(data.life_insurance_coverage) > 0 && coverages.length > 0) {
          coverages[0].coverage = Number(data.life_insurance_coverage);
          coverages[0].coverageType = 'term';
        }

        const savedProfile = data as any;
        setProfile({
          member_incomes: incomes,
          dependents: Array.isArray(savedProfile.dependents) ? savedProfile.dependents : [],
          filing_status: savedProfile.filing_status || 'single',
          state: savedProfile.state || '',
          housing_type: savedProfile.housing_type || 'rent',
          mortgage_balance: Number(savedProfile.mortgage_balance) || 0,
          mortgage_rate: Number(savedProfile.mortgage_rate) || 0,
          mortgage_payment: Number(savedProfile.mortgage_payment) || 0,
          mortgage_pi: Number(savedProfile.mortgage_pi) || 0,
          mortgage_escrow: Number(savedProfile.mortgage_escrow) || 0,
          mortgage_extra: Number(savedProfile.mortgage_extra) || 0,
          mortgage_statement_month: savedProfile.mortgage_statement_month || '',
          mortgage_breakdown_enabled: !!savedProfile.mortgage_breakdown_enabled,
          monthly_rent: Number(savedProfile.monthly_rent) || 0,
          debts: Array.isArray(savedProfile.debts) ? (savedProfile.debts as unknown as Debt[]).map(d => ({
            ...d, extraPayment: Number((d as any).extraPayment) || 0,
          })) : [],
          non_retirement_investments: Number(savedProfile.non_retirement_investments) || 0,
          retirement_balance: Number(savedProfile.retirement_balance) || 0,
          retirement_balance_per_member: savedProfile.retirement_balance_per_member || {},
          roth_retirement_balance: Number(savedProfile.roth_retirement_balance) || 0,
          roth_balance_per_member: savedProfile.roth_balance_per_member || {},
          emergency_fund_balance: Number(savedProfile.emergency_fund_balance) || 0,
          savings_balance: Number(savedProfile.savings_balance) || 0,
          has_life_insurance: !!savedProfile.has_life_insurance,
          life_insurance_coverage: Number(savedProfile.life_insurance_coverage) || 0,
          life_insurance_coverages: coverages,
          dependent_life_insurance: !!savedProfile.dependent_life_insurance,
          dependent_life_coverage: Number(savedProfile.dependent_life_coverage) || 0,
        });
        setLastSaved(new Date(savedProfile.updated_at || savedProfile.created_at));
      } else {
        setProfile(p => ({
          ...p,
          member_incomes: membersList.map(m => ({ profile_id: m.id, name: m.display_name, gross_income: 0, income_type: 'w2', income_sources: [], dob: null, pay_frequency: 'biweekly' })),
          life_insurance_coverages: membersList.map(m => ({ profile_id: m.id, name: m.display_name, coverage: 0, coverageType: 'none' as const, mixedTermPct: 50 })),
        }));
      }
      setLoading(false);
    }
    load();
  }, [householdId]);

  const save = useCallback(async (profileData: ProfileData) => {
    if (!householdId) return;
    setSaving(true);
    // Compute gross_income from income_sources for each member before saving
    const membersWithTotals = profileData.member_incomes.map(m => ({
      ...m,
      gross_income: (m.income_sources || []).reduce((s, src) => s + src.amount, 0),
      income_type: (m.income_sources || []).length === 1 ? m.income_sources![0].type : (m.income_sources || []).length > 1 ? 'mixed' : 'w2',
    }));
    const combinedGross = membersWithTotals.reduce((s, m) => s + m.gross_income, 0);
    const primaryIncomeType = membersWithTotals[0]?.income_type || 'w2';

    const payload: any = {
      household_id: householdId,
      annual_gross_income: combinedGross,
      income_type: primaryIncomeType,
      member_incomes: membersWithTotals,
      filing_status: profileData.filing_status,
      state: profileData.state || null,
      housing_type: profileData.housing_type,
      mortgage_balance: profileData.mortgage_balance,
      mortgage_rate: profileData.mortgage_rate,
      mortgage_payment: profileData.mortgage_payment,
      monthly_rent: profileData.monthly_rent,
      debts: profileData.debts,
      non_retirement_investments: profileData.non_retirement_investments,
      total_investment_balance: profileData.non_retirement_investments + profileData.retirement_balance + profileData.roth_retirement_balance,
      retirement_balance: profileData.retirement_balance,
      roth_retirement_balance: profileData.roth_retirement_balance,
      emergency_fund_balance: profileData.emergency_fund_balance,
      has_life_insurance: profileData.has_life_insurance,
      life_insurance_coverage: profileData.life_insurance_coverages.reduce((s, c) => s + c.coverage, 0),
      life_insurance_coverages: profileData.life_insurance_coverages,
      dependents: profileData.dependents,
    };

    if (existingId) {
      await supabase.from('financial_profiles').update(payload).eq('id', existingId);
    } else {
      const { data } = await supabase.from('financial_profiles').insert(payload).select().single();
      if (data) setExistingId(data.id);
    }
    setLastSaved(new Date());
    setSaving(false);
  }, [householdId, existingId]);

  const debouncedSave = useCallback((newProfile: ProfileData) => {
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => save(newProfile), 1500);
  }, [save]);


  const update = (field: keyof ProfileData, value: any) => {
    setProfile(p => {
      const updated = { ...p, [field]: value };
      debouncedSave(updated);
      return updated;
    });
  };

  const updateMemberIncome = (index: number, field: keyof MemberIncome, value: any) => {
    setProfile(p => {
      const updated = {
        ...p,
        member_incomes: p.member_incomes.map((m, i) => i === index ? { ...m, [field]: value } : m),
      };
      debouncedSave(updated);
      return updated;
    });
  };

  const addDebt = () => {
    setProfile(p => {
      const updated = { ...p, debts: [...p.debts, { type: 'Credit Card', balance: 0, interestRate: 0, monthlyPayment: 0, extraPayment: 0 }] };
      debouncedSave(updated);
      return updated;
    });
  };

  const updateDebt = (index: number, field: keyof Debt, value: any) => {
    setProfile(p => {
      const updated = { ...p, debts: p.debts.map((d, i) => i === index ? { ...d, [field]: value } : d) };
      debouncedSave(updated);
      return updated;
    });
  };

  const removeDebt = (index: number) => {
    setProfile(p => {
      const updated = { ...p, debts: p.debts.filter((_, i) => i !== index) };
      debouncedSave(updated);
      return updated;
    });
  };

  const addDependent = () => {
    setProfile(p => {
      const updated = { ...p, dependents: [...p.dependents, { name: '', age: null }] };
      debouncedSave(updated);
      return updated;
    });
  };

  const updateDependent = (index: number, field: keyof Dependent, value: any) => {
    setProfile(p => {
      const updated = { ...p, dependents: p.dependents.map((d, i) => i === index ? { ...d, [field]: value } : d) };
      debouncedSave(updated);
      return updated;
    });
  };

  const removeDependent = (index: number) => {
    setProfile(p => {
      const updated = { ...p, dependents: p.dependents.filter((_, i) => i !== index) };
      debouncedSave(updated);
      return updated;
    });
  };

  // Completeness
  const completeness = (() => {
    const total = 6;
    let filled = 0;
    if (profile.member_incomes.some(m => (m.income_sources || []).some(s => s.amount > 0))) filled++;
    if (profile.filing_status && profile.state) filled++;
    if (profile.housing_type) filled++;
    if (profile.emergency_fund_balance > 0 || profile.retirement_balance > 0 || profile.non_retirement_investments > 0) filled++;
    if (profile.debts.length > 0 || filled >= 3) filled++;
    if (profile.has_life_insurance !== null) filled++;
    return { filled, total, pct: Math.round((filled / total) * 100) };
  })();

  const tabs: { id: ProfileTab; label: string }[] = [
    { id: 'profile', label: 'Profile' },
    { id: 'income', label: 'Income' },
    { id: 'housing', label: 'Housing' },
    { id: 'debts', label: 'Debts' },
    { id: 'accounts', label: 'Accounts' },
    { id: 'insurance', label: 'Insurance' },
  ];

  if (loading) {
    return (
      <div className="max-w-lg mx-auto flex items-center justify-center py-20">
        <div className="w-8 h-8 rounded-full border-2 border-accent border-t-transparent animate-spin" />
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
        <div className="flex-1">
          <h1 className="font-display text-xl font-bold text-foreground">Financial Profile</h1>
          <div className="flex items-center gap-2 mt-1">
            <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden max-w-[120px]">
              <div className="h-full bg-accent rounded-full transition-all" style={{ width: `${completeness.pct}%` }} />
            </div>
            <span className="text-[10px] text-muted-foreground">{completeness.filled}/{completeness.total}</span>
            {lastSaved && (
              <span className="text-[10px] text-muted-foreground ml-2">
                {saving ? 'Saving…' : `Saved ${formatDistanceToNow(lastSaved, { addSuffix: true })}`}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Tab Pills */}
      <div className="px-6 mt-4 overflow-x-auto scrollbar-hide">
        <div className="flex gap-1.5 min-w-max">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveProfileTab(tab.id)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors whitespace-nowrap ${
                activeProfileTab === tab.id
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="px-6 mt-5 space-y-4">
        {/* Profile Tab */}
        {activeProfileTab === 'profile' && (
          <div className="space-y-4">

            <section>
              <h2 className="font-display text-sm font-semibold text-foreground mb-3">Household Members</h2>
              <div className="space-y-2">
                {profile.member_incomes.map((member, i) => (
                  <div key={member.profile_id} className="bg-card rounded-xl shadow-sm p-3 flex items-center gap-3">
                    <div className="flex-1 grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[10px] text-muted-foreground">Name</label>
                        <input value={member.name} onChange={e => updateMemberIncome(i, 'name', e.target.value)}
                          placeholder="Name" className="w-full mt-0.5 px-2 py-1 rounded bg-background border border-border text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-accent/30" />
                      </div>
                      <div>
                        <label className="text-[10px] text-muted-foreground">Date of Birth</label>
                        <input type="date" value={member.dob || ''} onChange={e => updateMemberIncome(i, 'dob', e.target.value || null)}
                          className="w-full mt-0.5 px-2 py-1 rounded bg-background border border-border text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-accent/30" />
                        {member.dob && (
                          <p className="text-[10px] text-muted-foreground mt-0.5">Age: {ageFromDob(member.dob) ?? '—'}</p>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section>
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-display text-sm font-semibold text-foreground">Dependents</h2>
                <button onClick={addDependent} className="flex items-center gap-1 text-xs text-accent font-medium active:scale-95 transition-transform">
                  <Plus size={14} /> Add
                </button>
              </div>
              {profile.dependents.length === 0 ? (
                <div className="bg-card rounded-xl shadow-sm px-4 py-6 text-center">
                  <p className="text-xs text-muted-foreground">No dependents added</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {profile.dependents.map((dep, i) => (
                    <div key={i} className="bg-card rounded-xl shadow-sm p-3 flex items-center gap-3">
                      <div className="flex-1 grid grid-cols-2 gap-2">
                        <div>
                          <label className="text-[10px] text-muted-foreground">Name</label>
                          <input value={dep.name} onChange={e => updateDependent(i, 'name', e.target.value)}
                            placeholder="Name" className="w-full mt-0.5 px-2 py-1 rounded bg-background border border-border text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-accent/30" />
                        </div>
                        <div>
                          <label className="text-[10px] text-muted-foreground">Date of Birth</label>
                          <input type="date" value={dep.dob || ''} onChange={e => updateDependent(i, 'dob', e.target.value || null)}
                            className="w-full mt-0.5 px-2 py-1 rounded bg-background border border-border text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-accent/30" />
                          {dep.dob && (
                            <p className="text-[10px] text-muted-foreground mt-0.5">Age: {ageFromDob(dep.dob) ?? '—'}</p>
                          )}
                        </div>
                      </div>
                      <button onClick={() => removeDependent(i)} className="text-destructive/60 hover:text-destructive"><Trash2 size={14} /></button>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section>
              <h2 className="font-display text-sm font-semibold text-foreground mb-3">Filing Status & State</h2>
              <div className="bg-card rounded-xl shadow-sm p-4">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-muted-foreground">Filing Status</label>
                    <select value={profile.filing_status} onChange={e => update('filing_status', e.target.value)}
                      className="w-full mt-1 px-2 py-1.5 rounded bg-background border border-border text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-accent/30">
                      {FILING_STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground">State</label>
                    <select value={profile.state} onChange={e => update('state', e.target.value)}
                      className="w-full mt-1 px-2 py-1.5 rounded bg-background border border-border text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-accent/30">
                      <option value="">Select…</option>
                      {US_STATES.map(s => <option key={s} value={s}>{STATE_NAMES[s]} ({s})</option>)}
                    </select>
                  </div>
                </div>
              </div>
            </section>
          </div>
        )}

        {/* Income Tab */}
        {activeProfileTab === 'income' && (
          <IncomeTab
            members={profile.member_incomes}
            onUpdateMember={(index, member) => {
              setProfile(p => {
                const updated = {
                  ...p,
                  member_incomes: p.member_incomes.map((m, i) => i === index ? member : m),
                };
                debouncedSave(updated);
                return updated;
              });
            }}
          />
        )}

        {/* Housing Tab */}
        {activeProfileTab === 'housing' && (
          <section>
            <h2 className="font-display text-sm font-semibold text-foreground mb-3">Housing</h2>
            <div className="bg-card rounded-xl shadow-sm p-4 space-y-3">
              <div className="space-y-1.5">
                {HOUSING_TYPES.map(t => (
                  <button key={t.value} onClick={() => update('housing_type', t.value)}
                    className={`w-full py-2 px-3 rounded-lg text-xs font-medium text-left transition-colors ${
                      profile.housing_type === t.value ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
                    }`}>
                    {t.label}
                  </button>
                ))}
              </div>

              {profile.housing_type === 'own' && (
                <div className="space-y-3 pt-2">
                  <div className="flex gap-2">
                    <div className="flex-1">
                      <label className="text-xs text-muted-foreground">Statement Month</label>
                      <input type="month" value={profile.mortgage_statement_month}
                        onChange={e => update('mortgage_statement_month', e.target.value)}
                        className="w-full mt-0.5 px-2 py-1.5 rounded bg-background border border-border text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-accent/30" />
                    </div>
                    <NumField label="Current Balance" value={profile.mortgage_balance} onChange={v => update('mortgage_balance', v)} prefix="$" />
                  </div>
                  <NumField label="Interest Rate" value={profile.mortgage_rate} onChange={v => update('mortgage_rate', v)} suffix="%" step="0.01" />
                  <NumField label="Total Monthly Payment" value={profile.mortgage_payment} onChange={v => update('mortgage_payment', v)} prefix="$" />

                  <div className="flex items-center justify-between pt-1">
                    <span className="text-xs text-foreground">Break down P&I vs Escrow</span>
                    <button onClick={() => update('mortgage_breakdown_enabled', !profile.mortgage_breakdown_enabled)}
                      className={`w-10 h-5 rounded-full transition-colors relative ${profile.mortgage_breakdown_enabled ? 'bg-accent' : 'bg-muted'}`}>
                      <div className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform ${profile.mortgage_breakdown_enabled ? 'translate-x-5' : ''}`} />
                    </button>
                  </div>
                  {profile.mortgage_breakdown_enabled && (
                    <div className="space-y-2 bg-muted/50 rounded-lg p-3">
                      <NumField label="Principal & Interest" value={profile.mortgage_pi} onChange={v => update('mortgage_pi', v)} prefix="$" compact />
                      <NumField label="Escrow (Tax + Ins + PMI)" value={profile.mortgage_escrow} onChange={v => update('mortgage_escrow', v)} prefix="$" compact />
                    </div>
                  )}
                  <NumField label="Extra Toward Principal (optional)" value={profile.mortgage_extra} onChange={v => update('mortgage_extra', v)} prefix="$" />
                </div>
              )}

              {profile.housing_type === 'rent' && (
                <NumField label="Monthly Rent" value={profile.monthly_rent} onChange={v => update('monthly_rent', v)} prefix="$" />
              )}
            </div>
          </section>
        )}

        {/* Debts Tab */}
        {activeProfileTab === 'debts' && (
          <section>
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-display text-sm font-semibold text-foreground">Debts</h2>
              <button onClick={addDebt} className="flex items-center gap-1 text-xs text-accent font-medium active:scale-95 transition-transform">
                <Plus size={14} /> Add Debt
              </button>
            </div>
            {profile.debts.length === 0 ? (
              <div className="bg-card rounded-xl shadow-sm px-4 py-6 text-center">
                <p className="text-xs text-muted-foreground">No debts added — great!</p>
              </div>
            ) : (
              <div className="space-y-2">
                {profile.debts.map((debt, i) => (
                  <div key={i} className="bg-card rounded-xl shadow-sm p-4 space-y-2">
                    <div className="flex items-center justify-between">
                      <select value={debt.type} onChange={e => updateDebt(i, 'type', e.target.value)}
                        className="text-sm font-medium text-foreground bg-transparent border-none outline-none">
                        {DEBT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                      </select>
                      <button onClick={() => removeDebt(i)} className="text-destructive/60 hover:text-destructive active:scale-90 transition-all">
                        <Trash2 size={14} />
                      </button>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <NumField label="Balance" value={debt.balance} onChange={v => updateDebt(i, 'balance', v)} prefix="$" compact />
                      <NumField label="Rate" value={debt.interestRate} onChange={v => updateDebt(i, 'interestRate', v)} suffix="%" step="0.01" compact />
                      <NumField label="Min Payment" value={debt.monthlyPayment} onChange={v => updateDebt(i, 'monthlyPayment', v)} prefix="$" compact />
                    </div>
                    <NumField label="Monthly Extra Payment (optional)" value={debt.extraPayment} onChange={v => updateDebt(i, 'extraPayment', v)} prefix="$" compact />
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {/* Accounts Tab */}
        {activeProfileTab === 'accounts' && (
          <div className="space-y-4">
            <section>
              <h2 className="font-display text-sm font-semibold text-foreground mb-3">Investments</h2>
              <div className="bg-card rounded-xl shadow-sm p-4 space-y-3">
                <div>
                  <label className="text-xs text-muted-foreground">Non-Retirement Investments</label>
                  <p className="text-[10px] text-muted-foreground/70 -mt-0.5">Brokerage accounts, non-qualified</p>
                  <NumFieldInline value={profile.non_retirement_investments} onChange={v => update('non_retirement_investments', v)} />
                </div>

                {profile.member_incomes.length > 1 ? (
                  <>
                    {profile.member_incomes.map(m => (
                      <div key={`ret-${m.profile_id}`}>
                        <label className="text-xs text-muted-foreground">{m.name}'s Pre-Tax Retirement</label>
                        <p className="text-[10px] text-muted-foreground/70 -mt-0.5">401k, Traditional IRA</p>
                        <NumFieldInline value={profile.retirement_balance_per_member[m.profile_id] || 0} onChange={v => {
                          const updated = { ...profile.retirement_balance_per_member, [m.profile_id]: v };
                          const total = Object.values(updated).reduce((s, x) => s + (x as number), 0);
                          update('retirement_balance_per_member', updated);
                          setTimeout(() => update('retirement_balance', total), 0);
                        }} />
                      </div>
                    ))}
                    {profile.member_incomes.map(m => (
                      <div key={`roth-${m.profile_id}`}>
                        <label className="text-xs text-muted-foreground">{m.name}'s Roth Retirement</label>
                        <p className="text-[10px] text-muted-foreground/70 -mt-0.5">Roth IRA, Roth 401k</p>
                        <NumFieldInline value={profile.roth_balance_per_member[m.profile_id] || 0} onChange={v => {
                          const updated = { ...profile.roth_balance_per_member, [m.profile_id]: v };
                          const total = Object.values(updated).reduce((s, x) => s + (x as number), 0);
                          update('roth_balance_per_member', updated);
                          setTimeout(() => update('roth_retirement_balance', total), 0);
                        }} />
                      </div>
                    ))}
                  </>
                ) : (
                  <>
                    <div>
                      <label className="text-xs text-muted-foreground">Pre-Tax Retirement</label>
                      <p className="text-[10px] text-muted-foreground/70 -mt-0.5">401k, Traditional IRA</p>
                      <NumFieldInline value={profile.retirement_balance} onChange={v => update('retirement_balance', v)} />
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground">Roth Retirement</label>
                      <p className="text-[10px] text-muted-foreground/70 -mt-0.5">Roth IRA, Roth 401k</p>
                      <NumFieldInline value={profile.roth_retirement_balance} onChange={v => update('roth_retirement_balance', v)} />
                    </div>
                  </>
                )}
              </div>
            </section>

            <section>
              <h2 className="font-display text-sm font-semibold text-foreground mb-3">Savings</h2>
              <div className="bg-card rounded-xl shadow-sm p-4 space-y-3">
                <div>
                  <label className="text-xs text-muted-foreground">Savings & Emergency Fund</label>
                  <p className="text-[10px] text-muted-foreground/70 -mt-0.5">Combined liquid savings</p>
                  <NumFieldInline value={profile.savings_balance || profile.emergency_fund_balance} onChange={v => {
                    update('savings_balance', v);
                    update('emergency_fund_balance', v);
                  }} />
                </div>
              </div>
            </section>
          </div>
        )}

        {/* Insurance Tab */}
        {activeProfileTab === 'insurance' && (
          <div className="space-y-4">
            <section>
              <h2 className="font-display text-sm font-semibold text-foreground mb-3">Life Insurance</h2>
              <div className="bg-card rounded-xl shadow-sm p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-foreground">Has Life Insurance</span>
                  <div className="flex gap-2">
                    {[true, false].map(v => (
                      <button key={String(v)} onClick={() => update('has_life_insurance', v)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                          profile.has_life_insurance === v ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
                        }`}>
                        {v ? 'Yes' : 'No'}
                      </button>
                    ))}
                  </div>
                </div>

                {profile.has_life_insurance && profile.life_insurance_coverages.map((mc, i) => (
                  <div key={mc.profile_id} className="space-y-2 pt-2 border-t border-border">
                    <p className="text-xs font-semibold text-foreground">{mc.name}</p>
                    <NumField label="Coverage Amount" value={mc.coverage} onChange={v => {
                      setProfile(p => {
                        const updated = {
                          ...p,
                          life_insurance_coverages: p.life_insurance_coverages.map((c, ci) => ci === i ? { ...c, coverage: v } : c),
                        };
                        debouncedSave(updated);
                        return updated;
                      });
                    }} prefix="$" />
                    <div>
                      <label className="text-xs text-muted-foreground">Coverage Type</label>
                      <div className="grid grid-cols-4 gap-1 mt-1">
                        {(['term', 'whole', 'mixed', 'none'] as const).map(t => (
                          <button key={t} onClick={() => {
                            setProfile(p => {
                              const updated = {
                                ...p,
                                life_insurance_coverages: p.life_insurance_coverages.map((c, ci) => ci === i ? { ...c, coverageType: t } : c),
                              };
                              debouncedSave(updated);
                              return updated;
                            });
                          }}
                            className={`py-1.5 rounded-lg text-[10px] font-medium capitalize transition-colors ${
                              mc.coverageType === t ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
                            }`}>
                            {t}
                          </button>
                        ))}
                      </div>
                    </div>
                    {mc.coverageType === 'mixed' && (
                      <div className="bg-muted/50 rounded-lg p-3">
                        <label className="text-[10px] text-muted-foreground">Approximate % Term</label>
                        <input type="number" value={mc.mixedTermPct || 50}
                          onChange={e => {
                            const val = parseInt(e.target.value) || 50;
                            setProfile(p => {
                              const updated = {
                                ...p,
                                life_insurance_coverages: p.life_insurance_coverages.map((c, ci) => ci === i ? { ...c, mixedTermPct: val } : c),
                              };
                              debouncedSave(updated);
                              return updated;
                            });
                          }}
                          className="w-full mt-0.5 px-2 py-1 rounded bg-background border border-border text-xs tabular-nums text-foreground focus:outline-none focus:ring-1 focus:ring-accent/30" />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </section>

            <section>
              <h2 className="font-display text-sm font-semibold text-foreground mb-3">Dependent Life Insurance</h2>
              <div className="bg-card rounded-xl shadow-sm p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-foreground">Dependent Coverage</span>
                  <button onClick={() => update('dependent_life_insurance', !profile.dependent_life_insurance)}
                    className={`w-10 h-5 rounded-full transition-colors relative ${profile.dependent_life_insurance ? 'bg-accent' : 'bg-muted'}`}>
                    <div className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform ${profile.dependent_life_insurance ? 'translate-x-5' : ''}`} />
                  </button>
                </div>
                {profile.dependent_life_insurance && (
                  <NumField label="Coverage Amount" value={profile.dependent_life_coverage} onChange={v => update('dependent_life_coverage', v)} prefix="$" />
                )}
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}

function NumField({ label, value, onChange, prefix, suffix, step, compact }: {
  label: string; value: number; onChange: (v: number) => void;
  prefix?: string; suffix?: string; step?: string; compact?: boolean;
}) {
  return (
    <div>
      <label className={`text-muted-foreground ${compact ? 'text-[10px]' : 'text-xs'}`}>{label}</label>
      <div className="flex items-center gap-1 mt-0.5">
        {prefix && <span className="text-xs text-muted-foreground shrink-0">{prefix}</span>}
        <input type="number" step={step || '1'} value={value || ''} onChange={e => onChange(parseFloat(e.target.value) || 0)}
          placeholder="0"
          className={`min-w-0 flex-1 px-2 py-1 rounded bg-background border border-border tabular-nums text-foreground focus:outline-none focus:ring-1 focus:ring-accent/30 ${compact ? 'text-xs' : 'text-sm'}`} />
        {suffix && <span className="text-xs text-muted-foreground shrink-0">{suffix}</span>}
      </div>
    </div>
  );
}

function NumFieldInline({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center gap-1 mt-1">
      <span className="text-xs text-muted-foreground">$</span>
      <input type="number" value={value || ''} onChange={e => onChange(parseFloat(e.target.value) || 0)}
        placeholder="0" className="flex-1 px-2 py-1 rounded bg-background border border-border text-sm tabular-nums text-foreground focus:outline-none focus:ring-1 focus:ring-accent/30" />
    </div>
  );
}

function fmtComma(n: number): string {
  if (!n) return '';
  return n.toLocaleString('en-US');
}

function parseComma(s: string): number {
  return parseFloat(s.replace(/,/g, '')) || 0;
}

function CurrencyInput({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const [display, setDisplay] = useState(value ? fmtComma(value) : '');
  useEffect(() => { setDisplay(value ? fmtComma(value) : ''); }, [value]);
  return (
    <div className="flex items-center gap-1">
      <span className="text-xs text-muted-foreground shrink-0">$</span>
      <input
        type="text"
        inputMode="numeric"
        value={display}
        onChange={e => {
          const raw = e.target.value.replace(/[^0-9.]/g, '');
          setDisplay(raw ? parseFloat(raw).toLocaleString('en-US') : '');
          onChange(parseFloat(raw) || 0);
        }}
        onBlur={() => setDisplay(value ? fmtComma(value) : '')}
        placeholder="0"
        className="flex-1 min-w-0 px-2 py-1 rounded bg-background border border-border text-sm tabular-nums text-foreground focus:outline-none focus:ring-1 focus:ring-accent/30"
      />
    </div>
  );
}

function IncomeTab({ members, onUpdateMember }: { members: MemberIncome[]; onUpdateMember: (index: number, member: MemberIncome) => void }) {
  const [tooltipOpen, setTooltipOpen] = useState<string | null>(null);

  const getSourceAmount = (m: MemberIncome, type: string): number => {
    const src = (m.income_sources || []).find(s => s.type === type || (type === 'k1' && s.type === 'scorp'));
    return src?.amount || 0;
  };

  const setSourceAmount = (memberIdx: number, type: string, amount: number) => {
    const m = members[memberIdx];
    let sources = [...(m.income_sources || [])];
    const idx = sources.findIndex(s => s.type === type || (type === 'k1' && s.type === 'scorp'));
    if (idx >= 0) {
      sources[idx] = { type, amount };
    } else {
      sources.push({ type, amount });
    }
    sources = sources.filter(s => s.type !== 'scorp');
    const gross = sources.reduce((s, src) => s + src.amount, 0);
    onUpdateMember(memberIdx, { ...m, income_sources: sources, gross_income: gross });
  };

  const memberTotal = (m: MemberIncome) => (m.income_sources || []).reduce((s, src) => s + src.amount, 0);
  const householdTotal = members.reduce((s, m) => s + memberTotal(m), 0);
  const typeTotal = (type: string) => members.reduce((s, m) => s + getSourceAmount(m, type), 0);

  return (
    <div className="space-y-4">
      {/* Side-by-side income grid */}
      <div className="space-y-2">
        {/* Column headers */}
        <div className="flex items-center gap-2">
          <div className="w-[140px] shrink-0" />
          {members.map((m, i) => (
            <div key={m.profile_id} className="flex-1 min-w-0 text-center">
              <span className="text-xs font-semibold text-foreground">{m.name || `Member ${i + 1}`}</span>
            </div>
          ))}
        </div>

        {/* Income type rows */}
        {INCOME_GRID_TYPES.map(t => {
          const tipKey = t.value;
          return (
            <div key={t.value}>
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1 w-[140px] shrink-0">
                  <span className="text-xs font-medium text-foreground">{t.label}</span>
                  <button
                    onClick={() => setTooltipOpen(tooltipOpen === tipKey ? null : tipKey)}
                    className="text-accent"
                  >
                    <Info size={11} />
                  </button>
                </div>
                {members.map((member, i) => (
                  <CurrencyInput key={member.profile_id} value={getSourceAmount(member, t.value)} onChange={v => setSourceAmount(i, t.value, v)} />
                ))}
              </div>
              {tooltipOpen === tipKey && (
                <p className="text-[10px] text-muted-foreground bg-muted rounded-lg px-2 py-1.5 leading-relaxed mt-1 ml-[140px]">
                  {INCOME_SOURCE_TOOLTIPS[t.value] || ''}
                </p>
              )}
            </div>
          );
        })}

        {/* Total row */}
        <div className="flex items-center gap-2 pt-2 border-t border-border">
          <div className="w-[140px] shrink-0">
            <span className="text-xs font-semibold text-foreground">Total</span>
          </div>
          {members.map(m => (
            <div key={m.profile_id} className="flex-1 min-w-0 text-right">
              <span className="text-sm font-semibold text-foreground tabular-nums">{fmt(memberTotal(m))}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Household Income Summary */}
      <section>
        <h2 className="font-display text-sm font-semibold text-foreground mb-3">Household Income Summary</h2>
        <div className="bg-card rounded-xl shadow-sm p-4 space-y-2">
          {INCOME_GRID_TYPES.map(t => {
            const total = typeTotal(t.value);
            if (total <= 0) return null;
            return (
              <div key={t.value} className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">{t.label} Total</span>
                <span className="text-sm tabular-nums text-foreground">{fmt(total)}</span>
              </div>
            );
          })}
          <div className="flex items-center justify-between pt-2 border-t border-border">
            <span className="text-xs font-semibold text-foreground">Combined Household Gross</span>
            <span className="text-sm font-bold text-foreground tabular-nums">{fmt(householdTotal)}</span>
          </div>
        </div>
      </section>
    </div>
  );
}