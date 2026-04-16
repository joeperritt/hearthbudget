import { useState, useEffect, useCallback, useRef } from 'react';
import { ArrowLeft, Plus, Trash2, Shield, Check, Info, ChevronDown } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { ageFromDob, ageToDobApprox, formatDob } from '@/lib/ageUtils';

function fmt(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);
}

function formatSavedTimestamp(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 30) return 'Saved just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `Saved ${diffMin} minute${diffMin === 1 ? '' : 's'} ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `Saved ${diffHr} hour${diffHr === 1 ? '' : 's'} ago`;
  const diffDay = Math.floor(diffHr / 24);
  return `Saved ${diffDay} day${diffDay === 1 ? '' : 's'} ago`;
}

interface Debt {
  name: string;
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

interface Beneficiary {
  name: string;
  percentage: number;
  household_member_id?: string;
}

interface InsurancePolicy {
  id: string;
  type: 'term' | 'whole' | 'group_employer';
  coverage: number;
  premium: number;
  termLength?: string;
  startYear?: number;
  cashValue?: number;
  primaryBeneficiaries: Beneficiary[];
  contingentBeneficiaries: Beneficiary[];
  beneficiaryLastConfirmed?: string;
}

interface MemberCoverage {
  profile_id: string;
  name: string;
  policies: InsurancePolicy[];
  // Legacy fields kept for migration only
  coverage?: number;
  coverageType?: string;
  mixedTermPct?: number;
  termPolicies?: any[];
  wholePolicies?: any[];
  termCoverage?: number;
  termPremium?: number;
  termLength?: string;
  termStartYear?: number;
  wholeCoverage?: number;
  wholePremium?: number;
  wholeCashValue?: number;
  wholeStartYear?: number;
  employerCoverage?: number;
  beneficiaryConfirmed?: boolean;
  beneficiaryName?: string;
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
  mortgage_loan_type: string;
  estimated_home_value: number;
  monthly_rent: number;
  renters_insurance: boolean;
  renters_insurance_premium: number;
  lease_end_date: string;
  debts: Debt[];
  non_retirement_investments: number;
  non_retirement_per_member: Record<string, number>;
  retirement_balance: number;
  retirement_balance_per_member: Record<string, number>;
  roth_retirement_balance: number;
  roth_balance_per_member: Record<string, number>;
  monthly_additions_per_key: Record<string, number>;
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
  mortgage_loan_type: '30-year-fixed',
  estimated_home_value: 0,
  monthly_rent: 0,
  renters_insurance: false,
  renters_insurance_premium: 0,
  lease_end_date: '',
  debts: [],
  non_retirement_investments: 0,
  non_retirement_per_member: {},
  monthly_additions_per_key: {},
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

const DEBT_TYPES = [
  'Mortgage',
  'Auto Loan',
  'Student Loan',
  'Credit Card',
  'Personal Loan',
  'HELOC',
  'Medical Debt',
  'Business Buy-In / Partnership Investment',
  'Other',
];

const HOUSING_TYPES = [
  { value: 'own_no_mortgage', label: 'Own — No Mortgage' },
  { value: 'own', label: 'Own — Mortgage' },
  { value: 'rent', label: 'Rent' },
];

const TERM_LENGTHS = ['10-Year', '15-Year', '20-Year', '25-Year', '30-Year'];

type ProfileTab = 'profile' | 'income' | 'housing' | 'debts' | 'accounts' | 'insurance';

interface HouseholdMember {
  id: string;
  display_name: string;
}

interface CFPProfileViewProps {
  onBack: () => void;
  householdId: string | null;
  initialTab?: ProfileTab;
  onNavigateToTool?: (toolId: string) => void;
}

export function CFPProfileView({ onBack, householdId, initialTab, onNavigateToTool }: CFPProfileViewProps) {
  const [profile, setProfile] = useState<ProfileData>(DEFAULT_PROFILE);
  const [loading, setLoading] = useState(true);
  const [existingId, setExistingId] = useState<string | null>(null);
  const [members, setMembers] = useState<HouseholdMember[]>([]);
  const [activeProfileTab, setActiveProfileTab] = useState<ProfileTab>(initialTab || 'profile');
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [saving, setSaving] = useState(false);
  const [, setTick] = useState(0);

  // Tick every 30s to update timestamp display
  useEffect(() => {
    const interval = setInterval(() => setTick(t => t + 1), 30000);
    return () => clearInterval(interval);
  }, []);

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
          if (!base.income_sources || base.income_sources.length === 0) {
            if (base.gross_income > 0) {
              const typeMap: Record<string, string> = { self_employed: '1099', mixed: 'w2' };
              const srcType = typeMap[base.income_type] || base.income_type || 'w2';
              base.income_sources = [{ type: srcType, amount: base.gross_income }];
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
          if (existing) {
            // Migrate from old separate termPolicies/wholePolicies to unified policies array
            if (!Array.isArray(existing.policies)) {
              existing.policies = [];
              // Migrate term policies
              const termArr = Array.isArray(existing.termPolicies) ? existing.termPolicies : [];
              if (termArr.length === 0 && (existing.termCoverage || 0) > 0) {
                termArr.push({ id: crypto.randomUUID(), coverage: existing.termCoverage || 0, premium: existing.termPremium || 0, termLength: existing.termLength || '', startYear: existing.termStartYear || 0 });
              }
              for (const tp of termArr) {
                existing.policies.push({ id: tp.id || crypto.randomUUID(), type: 'term', coverage: tp.coverage || 0, premium: tp.premium || 0, termLength: tp.termLength || '', startYear: tp.startYear || 0, primaryBeneficiaries: [], contingentBeneficiaries: [] });
              }
              // Migrate whole policies
              const wholeArr = Array.isArray(existing.wholePolicies) ? existing.wholePolicies : [];
              if (wholeArr.length === 0 && (existing.wholeCoverage || 0) > 0) {
                wholeArr.push({ id: crypto.randomUUID(), coverage: existing.wholeCoverage || 0, premium: existing.wholePremium || 0, cashValue: existing.wholeCashValue || 0, startYear: existing.wholeStartYear || 0 });
              }
              for (const wp of wholeArr) {
                existing.policies.push({ id: wp.id || crypto.randomUUID(), type: 'whole', coverage: wp.coverage || 0, premium: wp.premium || 0, cashValue: wp.cashValue || 0, startYear: wp.startYear || 0, primaryBeneficiaries: [], contingentBeneficiaries: [] });
              }
              // Migrate employer coverage
              if ((existing.employerCoverage || 0) > 0) {
                existing.policies.push({ id: crypto.randomUUID(), type: 'group_employer', coverage: existing.employerCoverage || 0, premium: 0, primaryBeneficiaries: [], contingentBeneficiaries: [] });
              }
              // Migrate old single coverage field
              if (existing.policies.length === 0 && (existing.coverage || 0) > 0 && existing.coverageType !== 'none') {
                existing.policies.push({ id: crypto.randomUUID(), type: 'term', coverage: existing.coverage || 0, premium: 0, primaryBeneficiaries: [], contingentBeneficiaries: [] });
              }
              // Migrate beneficiary name into first policy
              if (existing.beneficiaryName && existing.policies.length > 0) {
                existing.policies[0].primaryBeneficiaries = [{ name: existing.beneficiaryName, percentage: 100 }];
              }
            }
            return { profile_id: existing.profile_id, name: existing.name, policies: existing.policies };
          }
          return { profile_id: m.id, name: m.display_name, policies: [] };
        });
        if (savedCoverages.length === 0 && Number(data.life_insurance_coverage) > 0 && coverages.length > 0) {
          coverages[0].policies = [{
            id: crypto.randomUUID(), type: 'term', coverage: Number(data.life_insurance_coverage), premium: 0, primaryBeneficiaries: [], contingentBeneficiaries: [],
          }];
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
          mortgage_loan_type: savedProfile.mortgage_loan_type || '30-year-fixed',
          estimated_home_value: Number(savedProfile.estimated_home_value) || 0,
          monthly_rent: Number(savedProfile.monthly_rent) || 0,
          renters_insurance: !!savedProfile.renters_insurance,
          renters_insurance_premium: Number(savedProfile.renters_insurance_premium) || 0,
          lease_end_date: savedProfile.lease_end_date || '',
          debts: Array.isArray(savedProfile.debts) ? (savedProfile.debts as unknown as Debt[]).map(d => ({
            ...d, extraPayment: Number((d as any).extraPayment) || 0,
          })) : [],
          non_retirement_investments: Number(savedProfile.non_retirement_investments) || 0,
          non_retirement_per_member: savedProfile.non_retirement_per_member || {},
          retirement_balance: Number(savedProfile.retirement_balance) || 0,
          retirement_balance_per_member: savedProfile.retirement_balance_per_member || {},
          roth_retirement_balance: Number(savedProfile.roth_retirement_balance) || 0,
          roth_balance_per_member: savedProfile.roth_balance_per_member || {},
          monthly_additions_per_key: savedProfile.monthly_additions_per_key || {},
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
          life_insurance_coverages: membersList.map(m => ({ profile_id: m.id, name: m.display_name, policies: [] })),
        }));
      }
      setLoading(false);
    }
    load();
  }, [householdId]);

  const save = useCallback(async (profileData: ProfileData) => {
    if (!householdId) return;
    setSaving(true);
    const membersWithTotals = profileData.member_incomes.map(m => ({
      ...m,
      gross_income: (m.income_sources || []).reduce((s, src) => s + src.amount, 0),
      income_type: (m.income_sources || []).length === 1 ? m.income_sources![0].type : (m.income_sources || []).length > 1 ? 'mixed' : 'w2',
    }));
    const combinedGross = membersWithTotals.reduce((s, m) => s + m.gross_income, 0);
    const primaryIncomeType = membersWithTotals[0]?.income_type || 'w2';

    // Compute total coverage from unified policies
    const totalCoverage = profileData.life_insurance_coverages.reduce((s, c) => {
      return s + (c.policies || []).reduce((ps, p) => ps + (p.coverage || 0), 0);
    }, 0);
    }, 0);

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
      mortgage_statement_month: profileData.mortgage_statement_month || '',
      mortgage_pi: profileData.mortgage_pi,
      mortgage_escrow: profileData.mortgage_escrow,
      mortgage_extra: profileData.mortgage_extra,
      mortgage_breakdown_enabled: profileData.mortgage_breakdown_enabled,
      mortgage_loan_type: profileData.mortgage_loan_type,
      estimated_home_value: profileData.estimated_home_value,
      monthly_rent: profileData.monthly_rent,
      renters_insurance: profileData.renters_insurance,
      renters_insurance_premium: profileData.renters_insurance_premium,
      lease_end_date: profileData.lease_end_date || null,
      debts: profileData.debts,
      non_retirement_investments: profileData.non_retirement_investments,
      non_retirement_per_member: profileData.non_retirement_per_member,
      total_investment_balance: profileData.non_retirement_investments + profileData.retirement_balance + profileData.roth_retirement_balance,
      retirement_balance: profileData.retirement_balance,
      roth_retirement_balance: profileData.roth_retirement_balance,
      monthly_additions_per_key: profileData.monthly_additions_per_key,
      emergency_fund_balance: profileData.emergency_fund_balance,
      has_life_insurance: profileData.has_life_insurance,
      life_insurance_coverage: totalCoverage,
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
      const updated = { ...p, debts: [...p.debts, { name: '', type: 'Auto Loan', balance: 0, interestRate: 0, monthlyPayment: 0, extraPayment: 0 }] };
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

  const updateCoverage = (index: number, fields: Partial<MemberCoverage>) => {
    setProfile(p => {
      const updated = {
        ...p,
        life_insurance_coverages: p.life_insurance_coverages.map((c, ci) => {
          if (ci !== index) return c;
          const merged = { ...c, ...fields };
          // Recompute legacy coverage field from policy arrays
          const termTotal = (merged.termPolicies || []).reduce((s, tp) => s + (tp.coverage || 0), 0);
          const wholeTotal = (merged.wholePolicies || []).reduce((s, wp) => s + (wp.coverage || 0), 0);
          if (merged.coverageType === 'term') merged.coverage = termTotal;
          else if (merged.coverageType === 'whole') merged.coverage = wholeTotal;
          else if (merged.coverageType === 'mixed') merged.coverage = termTotal + wholeTotal;
          else merged.coverage = 0;
          return merged;
        }),
      };
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
                {saving ? 'Saving…' : formatSavedTimestamp(lastSaved)}
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

              {/* Own — No Mortgage */}
              {profile.housing_type === 'own_no_mortgage' && (
                <div className="space-y-3 pt-2">
                  <NumField label="Estimated Home Value (optional)" value={profile.estimated_home_value} onChange={v => update('estimated_home_value', v)} prefix="$" />
                </div>
              )}

              {/* Own — Mortgage */}
              {profile.housing_type === 'own' && (
                <div className="space-y-3 pt-2">
                  <NumField label="Estimated Home Value (optional)" value={profile.estimated_home_value} onChange={v => update('estimated_home_value', v)} prefix="$" />
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-xs text-muted-foreground">Statement Month</label>
                      <input type="month" value={profile.mortgage_statement_month}
                        onChange={e => update('mortgage_statement_month', e.target.value)}
                        className="w-full mt-0.5 px-2 py-1.5 rounded bg-background border border-border text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-accent/30" />
                    </div>
                    <NumField label="Current Balance" value={profile.mortgage_balance} onChange={v => update('mortgage_balance', v)} prefix="$" />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <NumField label="Interest Rate" value={profile.mortgage_rate} onChange={v => update('mortgage_rate', v)} suffix="%" step="0.01" />
                    <div>
                      <label className="text-xs text-muted-foreground">Loan Type</label>
                      <select value={profile.mortgage_loan_type} onChange={e => update('mortgage_loan_type', e.target.value)}
                        className="w-full mt-0.5 px-2 py-1.5 rounded bg-background border border-border text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-accent/30">
                        <option value="30-year-fixed">30-Year Fixed</option>
                        <option value="20-year-fixed">20-Year Fixed</option>
                        <option value="15-year-fixed">15-Year Fixed</option>
                        <option value="10-year-fixed">10-Year Fixed</option>
                        <option value="5-1-arm">5/1 ARM</option>
                        <option value="7-1-arm">7/1 ARM</option>
                        <option value="other">Other</option>
                      </select>
                    </div>
                  </div>
                  {(profile.mortgage_loan_type === '5-1-arm' || profile.mortgage_loan_type === '7-1-arm') && (
                    <p className="text-[10px] text-muted-foreground leading-tight">
                      Adjustable rate mortgages have variable interest rates — projections assume your current rate remains fixed, which may not reflect actual future payments.
                    </p>
                  )}
                  <NumField label="Monthly Minimum Payment" value={profile.mortgage_payment} onChange={v => update('mortgage_payment', v)} prefix="$" />

                  <div className="space-y-2 bg-muted/50 rounded-lg p-3">
                    <div className="flex items-center gap-1 mb-1">
                      <label className="text-xs text-muted-foreground">Principal & Interest</label>
                      <TooltipIcon text="The portion of your payment that goes toward paying down your loan balance (principal) and the cost of borrowing (interest). This is the core of your mortgage payment." />
                    </div>
                    <NumField label="" value={profile.mortgage_pi} onChange={v => update('mortgage_pi', v)} prefix="$" compact />
                    <div className="flex items-center gap-1 mb-1 mt-2">
                      <label className="text-xs text-muted-foreground">Escrow</label>
                      <TooltipIcon text="The portion collected by your lender to pay property taxes, homeowners insurance, and PMI on your behalf. It is held in an escrow account and paid out when bills are due." />
                    </div>
                    <NumField label="" value={profile.mortgage_escrow} onChange={v => update('mortgage_escrow', v)} prefix="$" compact />
                    <div className="pt-1 border-t border-border mt-2">
                      <div className="flex justify-between items-center">
                        <span className="text-xs text-muted-foreground">Total</span>
                        <span className="text-xs font-semibold text-foreground">{fmt(profile.mortgage_pi + profile.mortgage_escrow)}</span>
                      </div>
                    </div>
                    {profile.mortgage_payment > 0 && (profile.mortgage_pi > 0 || profile.mortgage_escrow > 0) && (
                      <div className="pt-1">
                        {Math.abs((profile.mortgage_pi + profile.mortgage_escrow) - profile.mortgage_payment) < 0.01 ? (
                          <div className="flex items-center gap-1.5">
                            <Check size={12} className="text-green-600 dark:text-green-400" />
                            <span className="text-[11px] text-green-600 dark:text-green-400 font-medium">Amounts match</span>
                          </div>
                        ) : (
                          <p className="text-[11px] text-destructive font-medium">
                            Missing {fmt(Math.abs(profile.mortgage_payment - (profile.mortgage_pi + profile.mortgage_escrow)))} — P&I + Escrow should equal your minimum payment
                          </p>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-1 mb-1">
                    <label className="text-xs text-muted-foreground">Extra Toward Principal (optional)</label>
                    <TooltipIcon text="Any amount you pay above your minimum payment that goes directly toward reducing your loan balance. This can significantly reduce your total interest paid and shorten your loan term." />
                  </div>
                  <NumField label="" value={profile.mortgage_extra} onChange={v => update('mortgage_extra', v)} prefix="$" />
                </div>
              )}

              {/* Rent */}
              {profile.housing_type === 'rent' && (
                <div className="space-y-3 pt-2">
                  <NumField label="Monthly Rent" value={profile.monthly_rent} onChange={v => update('monthly_rent', v)} prefix="$" />
                  
                  {/* Renters Insurance */}
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-foreground">Renters Insurance</span>
                    <div className="flex gap-2">
                      {[true, false].map(v => (
                        <button key={String(v)} onClick={() => update('renters_insurance', v)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                            profile.renters_insurance === v ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
                          }`}>
                          {v ? 'Yes' : 'No'}
                        </button>
                      ))}
                    </div>
                  </div>
                  {profile.renters_insurance && (
                    <NumField label="Annual Premium" value={profile.renters_insurance_premium} onChange={v => update('renters_insurance_premium', v)} prefix="$" />
                  )}
                  
                  {/* Lease End Date */}
                  <div>
                    <label className="text-xs text-muted-foreground">Lease End Date (optional)</label>
                    <input type="date" value={profile.lease_end_date || ''}
                      onChange={e => update('lease_end_date', e.target.value || '')}
                      className="w-full mt-0.5 px-2 py-1.5 rounded bg-background border border-border text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-accent/30" />
                  </div>
                </div>
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
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={debt.name || ''}
                        onChange={e => updateDebt(i, 'name', e.target.value)}
                        placeholder="Debt name"
                        className="flex-1 min-w-0 text-sm font-medium text-foreground bg-transparent border-b border-border/50 outline-none placeholder:text-muted-foreground/50 py-0.5"
                      />
                      <div className="relative">
                        <select value={debt.type} onChange={e => updateDebt(i, 'type', e.target.value)}
                          className="text-xs text-muted-foreground bg-transparent border-b border-border/50 outline-none py-0.5 pr-5">
                          {DEBT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                        </select>
                        {debt.type === 'Business Buy-In / Partnership Investment' && (
                          <InfoPopover text="Debt taken to purchase equity in a business or partnership. This is treated differently from consumer debt in the Debt Payoff Analyzer because it's backed by an investment with its own return profile." />
                        )}
                      </div>
                      <button onClick={() => removeDebt(i)} className="text-destructive/60 hover:text-destructive active:scale-90 transition-all shrink-0">
                        <Trash2 size={14} />
                      </button>
                    </div>
                    {debt.type === 'Mortgage' && (
                      <p className="text-[10px] text-muted-foreground">For a second mortgage or HELOC not captured in your Housing tab.</p>
                    )}
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
          <AccountsTab profile={profile} update={update} members={profile.member_incomes} />
        )}

        {/* Insurance Tab */}
        {activeProfileTab === 'insurance' && (
          <InsuranceTab
            profile={profile}
            update={update}
            updateCoverage={updateCoverage}
            onNavigateToTool={onNavigateToTool}
          />
        )}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════
   Insurance Tab Component
   ═══════════════════════════════════════════ */

function InsuranceTab({ profile, update, updateCoverage, onNavigateToTool }: {
  profile: ProfileData;
  update: (field: keyof ProfileData, value: any) => void;
  updateCoverage: (index: number, fields: Partial<MemberCoverage>) => void;
  onNavigateToTool?: (toolId: string) => void;
}) {
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({});
  const toggle = (key: string) => setOpenSections(prev => ({ ...prev, [key]: !prev[key] }));
  const isOpen = (key: string) => !!openSections[key];

  const currentYear = new Date().getFullYear();

  const getMemberTotals = (mc: MemberCoverage) => {
    const termCov = (mc.termPolicies || []).reduce((s, p) => s + (p.coverage || 0), 0);
    const termPrem = (mc.termPolicies || []).reduce((s, p) => s + (p.premium || 0), 0);
    const wholeCov = (mc.wholePolicies || []).reduce((s, p) => s + (p.coverage || 0), 0);
    const wholePrem = (mc.wholePolicies || []).reduce((s, p) => s + (p.premium || 0), 0);
    let totalCoverage = mc.employerCoverage || 0;
    let totalPremium = 0;
    if (mc.coverageType === 'term') { totalCoverage += termCov; totalPremium = termPrem; }
    else if (mc.coverageType === 'whole') { totalCoverage += wholeCov; totalPremium = wholePrem; }
    else if (mc.coverageType === 'mixed') { totalCoverage += termCov + wholeCov; totalPremium = termPrem + wholePrem; }
    return { totalCoverage, totalPremium };
  };

  const getTermYearsRemaining = (p: TermPolicy) => {
    if (!p.termLength || !p.startYear) return null;
    const years = parseInt(p.termLength) || 0;
    const remaining = (p.startYear + years) - currentYear;
    return remaining > 0 ? remaining : 0;
  };

  const getTermExpiry = (p: TermPolicy) => {
    if (!p.termLength || !p.startYear) return null;
    return p.startYear + (parseInt(p.termLength) || 0);
  };

  // Helpers for modifying policy arrays
  const addTermPolicy = (memberIdx: number, mc: MemberCoverage) => {
    const newPolicy: TermPolicy = { id: crypto.randomUUID(), coverage: 0, premium: 0, termLength: '', startYear: 0 };
    updateCoverage(memberIdx, { termPolicies: [...(mc.termPolicies || []), newPolicy] });
  };

  const updateTermPolicy = (memberIdx: number, mc: MemberCoverage, policyId: string, fields: Partial<TermPolicy>) => {
    const updated = (mc.termPolicies || []).map(p => p.id === policyId ? { ...p, ...fields } : p);
    updateCoverage(memberIdx, { termPolicies: updated });
  };

  const removeTermPolicy = (memberIdx: number, mc: MemberCoverage, policyId: string) => {
    updateCoverage(memberIdx, { termPolicies: (mc.termPolicies || []).filter(p => p.id !== policyId) });
  };

  const addWholePolicy = (memberIdx: number, mc: MemberCoverage) => {
    const newPolicy: WholePolicy = { id: crypto.randomUUID(), coverage: 0, premium: 0, cashValue: 0, startYear: 0 };
    updateCoverage(memberIdx, { wholePolicies: [...(mc.wholePolicies || []), newPolicy] });
  };

  const updateWholePolicy = (memberIdx: number, mc: MemberCoverage, policyId: string, fields: Partial<WholePolicy>) => {
    const updated = (mc.wholePolicies || []).map(p => p.id === policyId ? { ...p, ...fields } : p);
    updateCoverage(memberIdx, { wholePolicies: updated });
  };

  const removeWholePolicy = (memberIdx: number, mc: MemberCoverage, policyId: string) => {
    updateCoverage(memberIdx, { wholePolicies: (mc.wholePolicies || []).filter(p => p.id !== policyId) });
  };

  // When switching to term/mixed and no policies exist, seed one empty
  const handleCoverageTypeChange = (memberIdx: number, mc: MemberCoverage, newType: MemberCoverage['coverageType']) => {
    const updates: Partial<MemberCoverage> = { coverageType: newType };
    if ((newType === 'term' || newType === 'mixed') && (mc.termPolicies || []).length === 0) {
      updates.termPolicies = [{ id: crypto.randomUUID(), coverage: 0, premium: 0, termLength: '', startYear: 0 }];
    }
    if ((newType === 'whole' || newType === 'mixed') && (mc.wholePolicies || []).length === 0) {
      updates.wholePolicies = [{ id: crypto.randomUUID(), coverage: 0, premium: 0, cashValue: 0, startYear: 0 }];
    }
    updateCoverage(memberIdx, updates);
  };

  return (
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
        </div>
      </section>

      {/* No insurance — friendly empty state */}
      {!profile.has_life_insurance && (
        <div className="bg-card rounded-xl shadow-sm px-4 py-6 text-center space-y-2">
          <Shield size={28} className="mx-auto text-accent" />
          <p className="text-sm text-foreground font-medium">Life insurance is one of the most important protections for your family.</p>
          <p className="text-xs text-muted-foreground leading-relaxed">
            It provides a financial safety net if something unexpected happens. Even a basic term policy can make a significant difference.
          </p>
          {onNavigateToTool && (
            <button onClick={() => onNavigateToTool('life-insurance')} className="text-xs text-accent font-medium mt-1 underline underline-offset-2">
              Explore the Life Insurance Analysis →
            </button>
          )}
        </div>
      )}

      {/* Has insurance — per-member collapsible cards */}
      {profile.has_life_insurance && (
        <div className="space-y-2">
          {profile.life_insurance_coverages.map((mc, i) => {
            const totals = getMemberTotals(mc);
            return (
              <div key={mc.profile_id} className="bg-card rounded-xl shadow-sm overflow-hidden">
                {/* Collapsed row */}
                <button
                  type="button"
                  onClick={() => toggle(`ins_${mc.profile_id}`)}
                  className="w-full flex items-center justify-between px-4 py-3 text-left"
                >
                  <span className="text-sm font-medium text-foreground">{mc.name}</span>
                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <p className="text-[10px] text-muted-foreground">Coverage</p>
                      <p className="text-sm font-semibold text-foreground tabular-nums">{fmt(totals.totalCoverage)}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-[10px] text-muted-foreground">Annual</p>
                      <p className="text-sm font-semibold text-foreground tabular-nums">{fmt(totals.totalPremium)}/yr</p>
                    </div>
                    <ChevronDown size={16} className={`text-muted-foreground transition-transform ${isOpen(`ins_${mc.profile_id}`) ? 'rotate-180' : ''}`} />
                  </div>
                </button>

                {isOpen(`ins_${mc.profile_id}`) && (
                  <div className="px-4 pb-4 pt-1 border-t border-border space-y-4">
                    {/* Coverage Type pills */}
                    <div>
                      <label className="text-xs text-muted-foreground">Coverage Type</label>
                      <div className="grid grid-cols-4 gap-1 mt-1">
                        {(['term', 'whole', 'mixed', 'none'] as const).map(t => (
                          <button key={t} onClick={() => handleCoverageTypeChange(i, mc, t)}
                            className={`py-1.5 rounded-lg text-[10px] font-medium capitalize transition-colors ${
                              mc.coverageType === t ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
                            }`}>
                            {t}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Term Policies List */}
                    {(mc.coverageType === 'term' || mc.coverageType === 'mixed') && (
                      <div className="space-y-2">
                        {mc.coverageType === 'mixed' && (
                          <h3 className="text-xs font-semibold text-foreground">Term Policies</h3>
                        )}
                        {(mc.termPolicies || []).map((tp) => {
                          const expiry = getTermExpiry(tp);
                          const yrsRemaining = getTermYearsRemaining(tp);
                          const policyKey = `term_${mc.profile_id}_${tp.id}`;
                          return (
                            <div key={tp.id} className="bg-muted/30 rounded-lg overflow-hidden border border-border/50">
                              <button type="button" onClick={() => toggle(policyKey)}
                                className="w-full flex items-center justify-between px-3 py-2 text-left">
                                <div className="flex items-center gap-2 min-w-0">
                                  <span className="text-xs font-medium text-foreground truncate">
                                    {tp.coverage > 0 ? fmt(tp.coverage) : 'New Policy'}
                                  </span>
                                  {tp.premium > 0 && <span className="text-[10px] text-muted-foreground">• {fmt(tp.premium)}/yr</span>}
                                  {expiry && <span className="text-[10px] text-muted-foreground">• Expires {expiry}</span>}
                                </div>
                                <div className="flex items-center gap-1 shrink-0">
                                  <button type="button" onClick={(e) => { e.stopPropagation(); removeTermPolicy(i, mc, tp.id); }}
                                    className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors">
                                    <Trash2 size={12} />
                                  </button>
                                  <ChevronDown size={14} className={`text-muted-foreground transition-transform ${isOpen(policyKey) ? 'rotate-180' : ''}`} />
                                </div>
                              </button>
                              {isOpen(policyKey) && (
                                <div className="px-3 pb-3 pt-1 border-t border-border/50 space-y-2">
                                  <div className="grid grid-cols-2 gap-2">
                                    <div>
                                      <label className="text-[10px] text-muted-foreground">Coverage Amount</label>
                                      <CurrencyInput value={tp.coverage || 0} onChange={v => updateTermPolicy(i, mc, tp.id, { coverage: v })} />
                                    </div>
                                    <div>
                                      <label className="text-[10px] text-muted-foreground">Annual Premium</label>
                                      <CurrencyInput value={tp.premium || 0} onChange={v => updateTermPolicy(i, mc, tp.id, { premium: v })} />
                                    </div>
                                  </div>
                                  <div className="grid grid-cols-2 gap-2">
                                    <div>
                                      <label className="text-[10px] text-muted-foreground">Term Length</label>
                                      <select value={tp.termLength || ''} onChange={e => updateTermPolicy(i, mc, tp.id, { termLength: e.target.value })}
                                        className="w-full mt-0.5 px-2 py-1 rounded bg-background border border-border text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-accent/30">
                                        <option value="">Select…</option>
                                        {TERM_LENGTHS.map(tl => <option key={tl} value={tl}>{tl}</option>)}
                                      </select>
                                    </div>
                                    <div>
                                      <label className="text-[10px] text-muted-foreground">Policy Start Year</label>
                                      <input type="number" value={tp.startYear || ''} onChange={e => updateTermPolicy(i, mc, tp.id, { startYear: parseInt(e.target.value) || 0 })}
                                        placeholder={String(currentYear)}
                                        className="w-full mt-0.5 px-2 py-1 rounded bg-background border border-border text-xs tabular-nums text-foreground focus:outline-none focus:ring-1 focus:ring-accent/30" />
                                    </div>
                                  </div>
                                  {tp.termLength && tp.startYear ? (
                                    <p className="text-[10px] text-muted-foreground">
                                      Years Remaining: <span className="font-semibold text-foreground">{yrsRemaining}</span>
                                    </p>
                                  ) : null}
                                </div>
                              )}
                            </div>
                          );
                        })}
                        <button onClick={() => addTermPolicy(i, mc)}
                          className="flex items-center gap-1 text-xs text-accent font-medium mt-1">
                          <Plus size={14} /> Add Another Term Policy
                        </button>
                      </div>
                    )}

                    {/* Whole Life Policies List */}
                    {(mc.coverageType === 'whole' || mc.coverageType === 'mixed') && (
                      <div className="space-y-2">
                        {mc.coverageType === 'mixed' && (
                          <h3 className="text-xs font-semibold text-foreground mt-2">Whole Life Policies</h3>
                        )}
                        {(mc.wholePolicies || []).map((wp) => {
                          const policyKey = `whole_${mc.profile_id}_${wp.id}`;
                          return (
                            <div key={wp.id} className="bg-muted/30 rounded-lg overflow-hidden border border-border/50">
                              <button type="button" onClick={() => toggle(policyKey)}
                                className="w-full flex items-center justify-between px-3 py-2 text-left">
                                <div className="flex items-center gap-2 min-w-0">
                                  <span className="text-xs font-medium text-foreground truncate">
                                    {wp.coverage > 0 ? fmt(wp.coverage) : 'New Policy'}
                                  </span>
                                  {wp.premium > 0 && <span className="text-[10px] text-muted-foreground">• {fmt(wp.premium)}/yr</span>}
                                </div>
                                <div className="flex items-center gap-1 shrink-0">
                                  <button type="button" onClick={(e) => { e.stopPropagation(); removeWholePolicy(i, mc, wp.id); }}
                                    className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors">
                                    <Trash2 size={12} />
                                  </button>
                                  <ChevronDown size={14} className={`text-muted-foreground transition-transform ${isOpen(policyKey) ? 'rotate-180' : ''}`} />
                                </div>
                              </button>
                              {isOpen(policyKey) && (
                                <div className="px-3 pb-3 pt-1 border-t border-border/50 space-y-2">
                                  <div className="grid grid-cols-2 gap-2">
                                    <div>
                                      <label className="text-[10px] text-muted-foreground">Coverage Amount</label>
                                      <CurrencyInput value={wp.coverage || 0} onChange={v => updateWholePolicy(i, mc, wp.id, { coverage: v })} />
                                    </div>
                                    <div>
                                      <label className="text-[10px] text-muted-foreground">Annual Premium</label>
                                      <CurrencyInput value={wp.premium || 0} onChange={v => updateWholePolicy(i, mc, wp.id, { premium: v })} />
                                    </div>
                                  </div>
                                  <div className="grid grid-cols-2 gap-2">
                                    <div>
                                      <div className="flex items-center gap-1">
                                        <label className="text-[10px] text-muted-foreground">Cash Value (optional)</label>
                                        <InfoPopover text="The accumulated cash value of your whole life policy. This is the amount you could receive if you surrendered the policy." />
                                      </div>
                                      <CurrencyInput value={wp.cashValue || 0} onChange={v => updateWholePolicy(i, mc, wp.id, { cashValue: v })} />
                                    </div>
                                    <div>
                                      <label className="text-[10px] text-muted-foreground">Policy Start Year</label>
                                      <input type="number" value={wp.startYear || ''} onChange={e => updateWholePolicy(i, mc, wp.id, { startYear: parseInt(e.target.value) || 0 })}
                                        placeholder={String(currentYear)}
                                        className="w-full mt-0.5 px-2 py-1 rounded bg-background border border-border text-xs tabular-nums text-foreground focus:outline-none focus:ring-1 focus:ring-accent/30" />
                                    </div>
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })}
                        <button onClick={() => addWholePolicy(i, mc)}
                          className="flex items-center gap-1 text-xs text-accent font-medium mt-1">
                          <Plus size={14} /> Add Another Whole Life Policy
                        </button>
                      </div>
                    )}

                    {/* Employer-Provided Coverage */}
                    <div className="pt-2 border-t border-border">
                      <div className="flex items-center gap-1 mb-1">
                        <label className="text-xs text-muted-foreground">Employer-Provided Coverage</label>
                        <InfoPopover text="Group life coverage provided by an employer typically ends at employment separation. It's worth having personal coverage that doesn't depend on your job." />
                      </div>
                      <CurrencyInput value={mc.employerCoverage || 0} onChange={v => updateCoverage(i, { employerCoverage: v })} />
                    </div>

                    {/* Beneficiary */}
                    <div className="pt-2 border-t border-border space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-foreground">Primary Beneficiary Confirmed</span>
                        <div className="flex gap-2">
                          {[true, false].map(v => (
                            <button key={String(v)} onClick={() => updateCoverage(i, { beneficiaryConfirmed: v })}
                              className={`px-2.5 py-1 rounded-lg text-[10px] font-medium transition-colors ${
                                mc.beneficiaryConfirmed === v ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
                              }`}>
                              {v ? 'Yes' : 'No'}
                            </button>
                          ))}
                        </div>
                      </div>
                      {mc.beneficiaryConfirmed && (
                        <div>
                          <label className="text-[10px] text-muted-foreground">Primary Beneficiary Name</label>
                          <input type="text" value={mc.beneficiaryName || ''} onChange={e => updateCoverage(i, { beneficiaryName: e.target.value })}
                            placeholder="Name"
                            className="w-full mt-0.5 px-2 py-1 rounded bg-background border border-border text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-accent/30" />
                        </div>
                      )}
                      <p className="text-[10px] text-muted-foreground italic">Have you confirmed your beneficiary designations recently?</p>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Dependent Life Insurance */}
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

      {/* Disclaimer */}
      <div className="bg-muted/50 rounded-xl p-4 border border-border">
        <p className="text-[10px] text-muted-foreground leading-relaxed">
          This analysis covers life insurance only. Disability insurance and long-term care coverage are critical components of a complete protection plan and are often overlooked. We strongly encourage meeting with a Certified Financial Planner (CFP®) to discuss these additional protections for your household.
        </p>
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
  const [display, setDisplay] = useState(value ? fmtComma(value) : '');
  useEffect(() => { setDisplay(value ? fmtComma(value) : ''); }, [value]);
  return (
    <div className="flex items-center gap-1 mt-1">
      <span className="text-xs text-muted-foreground">$</span>
      <input type="text" inputMode="numeric" value={display}
        onChange={e => {
          const raw = e.target.value.replace(/[^0-9.]/g, '');
          setDisplay(raw ? parseFloat(raw).toLocaleString('en-US') : '');
          onChange(parseFloat(raw) || 0);
        }}
        onBlur={() => setDisplay(value ? fmtComma(value) : '')}
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

function AccountsTab({ profile, update, members }: { profile: ProfileData; update: (field: keyof ProfileData, value: any) => void; members: MemberIncome[] }) {
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({});
  const toggle = (key: string) => setOpenSections(prev => ({ ...prev, [key]: !prev[key] }));
  const isOpen = (key: string) => !!openSections[key];

  // Savings computed values
  const savingsBalance = profile.savings_balance || profile.emergency_fund_balance;
  const efAdditions = Number(profile.monthly_additions_per_key['savings_ef'] || 0);
  const nrGoalsAdditions = Number(profile.monthly_additions_per_key['savings_nonret'] || 0);
  const totalSavingsMonthly = efAdditions + nrGoalsAdditions;

  // Helper to compute member investment totals
  const getMemberInvestmentTotals = (pid: string) => {
    const nq = Number(profile.non_retirement_per_member[pid] || 0);
    const pretax = Number(profile.retirement_balance_per_member[pid] || 0);
    const roth = Number(profile.roth_balance_per_member[pid] || 0);
    const totalBalance = nq + pretax + roth;
    const nqRet = Number(profile.monthly_additions_per_key[`nq_${pid}_retirement`] || 0);
    const nqNonret = Number(profile.monthly_additions_per_key[`nq_${pid}_nonret`] || 0);
    const pretaxAdd = Number(profile.monthly_additions_per_key[`pretax_${pid}`] || 0);
    const rothAdd = Number(profile.monthly_additions_per_key[`roth_${pid}`] || 0);
    const totalMonthly = nqRet + nqNonret + pretaxAdd + rothAdd;
    return { nq, pretax, roth, totalBalance, nqRet, nqNonret, pretaxAdd, rothAdd, totalMonthly };
  };

  // Joint NQ
  const jointNq = Number(profile.non_retirement_per_member['joint'] || 0);
  const jointNqRet = Number(profile.monthly_additions_per_key['nq_joint_retirement'] || 0);
  const jointNqNonret = Number(profile.monthly_additions_per_key['nq_joint_nonret'] || 0);
  const jointMonthly = jointNqRet + jointNqNonret;

  // Investment member sections: joint first, then members in order
  const investmentSections: { key: string; label: string; isJoint: boolean; pid?: string }[] = [];
  if (jointNq > 0 || jointMonthly > 0 || true) {
    investmentSections.push({ key: 'joint', label: 'Joint Non-Qualified', isJoint: true });
  }
  members.forEach((m, i) => {
    investmentSections.push({ key: m.profile_id, label: m.name || `Member ${i + 1}`, isJoint: false, pid: m.profile_id });
  });

  return (
    <div className="space-y-5">
      {/* ═══ SAVINGS SECTION ═══ */}
      <div>
        <h2 className="font-display text-base font-bold text-foreground mb-2">Savings</h2>
        <div className="bg-card rounded-xl shadow-sm overflow-hidden">
          {/* Collapsed summary row */}
          <button
            type="button"
            onClick={() => toggle('savings')}
            className="w-full flex items-center justify-between px-4 py-3 text-left"
          >
            <span className="text-sm font-medium text-foreground">Savings</span>
            <div className="flex items-center gap-3">
              <div className="text-right">
                <p className="text-xs text-muted-foreground">Balance</p>
                <p className="text-sm font-semibold text-foreground tabular-nums">{fmt(savingsBalance)}</p>
              </div>
              <div className="text-right">
                <p className="text-xs text-muted-foreground">Monthly</p>
                <p className="text-sm font-semibold text-foreground tabular-nums">{fmt(totalSavingsMonthly)}/mo</p>
              </div>
              <ChevronDown size={16} className={`text-muted-foreground transition-transform ${isOpen('savings') ? 'rotate-180' : ''}`} />
            </div>
          </button>

          {isOpen('savings') && (
            <div className="px-4 pb-4 pt-1 border-t border-border space-y-3">
              <div>
                <label className="text-xs text-muted-foreground">Current Balance</label>
                <CurrencyInput value={savingsBalance} onChange={v => { update('savings_balance', v); update('emergency_fund_balance', v); }} />
              </div>
              <div>
                <label className="text-xs font-medium text-foreground mb-1 block">Monthly Additions</label>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <div className="flex items-center gap-1 mb-0.5">
                      <label className="text-[10px] text-muted-foreground">Emergency Fund</label>
                      <InfoPopover text="Amount you're actively adding to your emergency fund each month to build your safety net." />
                    </div>
                    <CurrencyInput
                      value={efAdditions}
                      onChange={v => update('monthly_additions_per_key', { ...profile.monthly_additions_per_key, savings_ef: v })}
                    />
                  </div>
                  <div>
                    <div className="flex items-center gap-1 mb-0.5">
                      <label className="text-[10px] text-muted-foreground">Non-Retirement Goals</label>
                      <InfoPopover text="Amount set aside monthly for non-retirement goals like vacations, a car, or other near-term purchases. This feeds your Non-Retirement Goals Planner." />
                    </div>
                    <CurrencyInput
                      value={nrGoalsAdditions}
                      onChange={v => update('monthly_additions_per_key', { ...profile.monthly_additions_per_key, savings_nonret: v })}
                    />
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ═══ DIVIDER ═══ */}
      <div className="border-t border-border" />

      {/* ═══ INVESTMENTS SECTION ═══ */}
      <div>
        <h2 className="font-display text-base font-bold text-foreground mb-2">Investments</h2>
        <div className="space-y-2">
          {investmentSections.map(sec => {
            if (sec.isJoint) {
              // Joint Non-Qualified row
              return (
                <div key="joint" className="bg-card rounded-xl shadow-sm overflow-hidden">
                  <button
                    type="button"
                    onClick={() => toggle('joint')}
                    className="w-full flex items-center justify-between px-4 py-3 text-left"
                  >
                    <div>
                      <span className="text-sm font-medium text-foreground">Joint Non-Qualified</span>
                      <InfoPopover text="Jointly held brokerage or taxable investment accounts shared between household members. Not tax-advantaged." />
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="text-right">
                        <p className="text-xs text-muted-foreground">Balance</p>
                        <p className="text-sm font-semibold text-foreground tabular-nums">{fmt(jointNq)}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-xs text-muted-foreground">Monthly</p>
                        <p className="text-sm font-semibold text-foreground tabular-nums">{fmt(jointMonthly)}/mo</p>
                      </div>
                      <ChevronDown size={16} className={`text-muted-foreground transition-transform ${isOpen('joint') ? 'rotate-180' : ''}`} />
                    </div>
                  </button>
                  {isOpen('joint') && (
                    <div className="px-4 pb-4 pt-1 border-t border-border space-y-3">
                      <div>
                        <label className="text-[10px] text-muted-foreground">Total Balance</label>
                        <CurrencyInput
                          value={jointNq}
                          onChange={v => {
                            const updated = { ...profile.non_retirement_per_member, joint: v };
                            const total = Object.entries(updated).reduce((s, [, x]) => s + (x as number), 0);
                            update('non_retirement_per_member', updated);
                            setTimeout(() => update('non_retirement_investments', total), 0);
                          }}
                        />
                      </div>
                      <div>
                        <label className="text-[10px] text-muted-foreground mb-1 block">Monthly Additions</label>
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="text-[10px] text-muted-foreground/70">For Retirement Goals</label>
                            <CurrencyInput value={jointNqRet} onChange={v => update('monthly_additions_per_key', { ...profile.monthly_additions_per_key, nq_joint_retirement: v })} />
                          </div>
                          <div>
                            <label className="text-[10px] text-muted-foreground/70">For Non-Retirement Goals</label>
                            <CurrencyInput value={jointNqNonret} onChange={v => update('monthly_additions_per_key', { ...profile.monthly_additions_per_key, nq_joint_nonret: v })} />
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            }

            // Per-member investment row
            const pid = sec.pid!;
            const t = getMemberInvestmentTotals(pid);
            return (
              <div key={pid} className="bg-card rounded-xl shadow-sm overflow-hidden">
                <button
                  type="button"
                  onClick={() => toggle(pid)}
                  className="w-full flex items-center justify-between px-4 py-3 text-left"
                >
                  <div>
                    <span className="text-sm font-medium text-foreground">{sec.label}</span>
                    <span className="text-[10px] text-muted-foreground ml-1.5">NQ · Pre-Tax · Roth</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <p className="text-xs text-muted-foreground">Balance</p>
                      <p className="text-sm font-semibold text-foreground tabular-nums">{fmt(t.totalBalance)}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-muted-foreground">Monthly</p>
                      <p className="text-sm font-semibold text-foreground tabular-nums">{fmt(t.totalMonthly)}/mo</p>
                    </div>
                    <ChevronDown size={16} className={`text-muted-foreground transition-transform ${isOpen(pid) ? 'rotate-180' : ''}`} />
                  </div>
                </button>
                {isOpen(pid) && (
                  <div className="px-4 pb-4 pt-1 border-t border-border space-y-4">
                    {/* Non-Qualified */}
                    <div>
                      <div className="flex items-center gap-1 mb-1">
                        <span className="text-xs font-medium text-foreground">Non-Qualified</span>
                        <InfoPopover text="Individual brokerage or taxable investment accounts. Not tax-advantaged — gains are subject to capital gains tax." />
                      </div>
                      <div>
                        <label className="text-[10px] text-muted-foreground">Total Balance</label>
                        <CurrencyInput
                          value={t.nq}
                          onChange={v => {
                            const updated = { ...profile.non_retirement_per_member, [pid]: v };
                            const jointVal = profile.non_retirement_per_member['joint'] || 0;
                            const total = Object.entries(updated).filter(([k]) => k !== 'joint').reduce((s, [, x]) => s + (x as number), 0) + (jointVal as number);
                            update('non_retirement_per_member', updated);
                            setTimeout(() => update('non_retirement_investments', total), 0);
                          }}
                        />
                      </div>
                      <label className="text-[10px] text-muted-foreground mb-1 block mt-2">Monthly Additions</label>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="text-[10px] text-muted-foreground/70">For Retirement Goals</label>
                          <CurrencyInput value={t.nqRet} onChange={v => update('monthly_additions_per_key', { ...profile.monthly_additions_per_key, [`nq_${pid}_retirement`]: v })} />
                        </div>
                        <div>
                          <label className="text-[10px] text-muted-foreground/70">For Non-Retirement Goals</label>
                          <CurrencyInput value={t.nqNonret} onChange={v => update('monthly_additions_per_key', { ...profile.monthly_additions_per_key, [`nq_${pid}_nonret`]: v })} />
                        </div>
                      </div>
                    </div>

                    {/* Pre-Tax */}
                    <div>
                      <div className="flex items-center gap-1 mb-1">
                        <span className="text-xs font-medium text-foreground">Pre-Tax</span>
                        <InfoPopover text="Tax-deferred accounts like 401(k), Traditional IRA, 403(b), or TSP. Contributions reduce taxable income; withdrawals are taxed in retirement." />
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="text-[10px] text-muted-foreground">Total Balance</label>
                          <CurrencyInput
                            value={t.pretax}
                            onChange={v => {
                              const updated = { ...profile.retirement_balance_per_member, [pid]: v };
                              const total = Object.values(updated).reduce((s, x) => s + (x as number), 0);
                              update('retirement_balance_per_member', updated);
                              setTimeout(() => update('retirement_balance', total), 0);
                            }}
                          />
                        </div>
                        <div>
                          <label className="text-[10px] text-muted-foreground">Monthly Additions</label>
                          <CurrencyInput value={t.pretaxAdd} onChange={v => update('monthly_additions_per_key', { ...profile.monthly_additions_per_key, [`pretax_${pid}`]: v })} />
                        </div>
                      </div>
                    </div>

                    {/* Roth */}
                    <div>
                      <div className="flex items-center gap-1 mb-1">
                        <span className="text-xs font-medium text-foreground">Roth</span>
                        <InfoPopover text="Roth IRA or Roth 401(k). Contributions are after-tax; qualified withdrawals in retirement are tax-free." />
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="text-[10px] text-muted-foreground">Total Balance</label>
                          <CurrencyInput
                            value={t.roth}
                            onChange={v => {
                              const updated = { ...profile.roth_balance_per_member, [pid]: v };
                              const total = Object.values(updated).reduce((s, x) => s + (x as number), 0);
                              update('roth_balance_per_member', updated);
                              setTimeout(() => update('roth_retirement_balance', total), 0);
                            }}
                          />
                        </div>
                        <div>
                          <label className="text-[10px] text-muted-foreground">Monthly Additions</label>
                          <CurrencyInput value={t.rothAdd} onChange={v => update('monthly_additions_per_key', { ...profile.monthly_additions_per_key, [`roth_${pid}`]: v })} />
                        </div>
                      </div>
                    </div>

                    {/* Member Total */}
                    <div className="pt-2 border-t border-border flex justify-between items-center">
                      <span className="text-xs font-semibold text-foreground">Total</span>
                      <div className="text-right">
                        <span className="text-sm font-semibold text-foreground tabular-nums">{fmt(t.totalBalance)}</span>
                        <span className="text-xs text-muted-foreground ml-2 tabular-nums">{fmt(t.totalMonthly)}/mo</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function InfoPopover({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-flex items-center">
      <button type="button" onClick={() => setOpen(!open)} className="text-accent"><Info size={12} /></button>
      {open && (
        <span className="absolute left-0 top-5 z-50 w-56 text-[10px] text-muted-foreground bg-card rounded-lg px-3 py-2 leading-relaxed shadow-lg border border-border">
          {text}
          <button type="button" onClick={() => setOpen(false)} className="absolute top-1 right-1.5 text-muted-foreground hover:text-foreground">✕</button>
        </span>
      )}
    </span>
  );
}

function TooltipIcon({ text }: { text: string }) {
  return <InfoPopover text={text} />;
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
