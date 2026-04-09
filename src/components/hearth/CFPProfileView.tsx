import { useState, useEffect } from 'react';
import { ArrowLeft, Plus, Trash2, Shield } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

function fmt(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);
}

interface Debt {
  type: string;
  balance: number;
  interestRate: number;
  monthlyPayment: number;
}

interface ProfileData {
  annual_gross_income: number;
  income_type: string;
  housing_type: string;
  mortgage_balance: number;
  mortgage_rate: number;
  mortgage_payment: number;
  monthly_rent: number;
  debts: Debt[];
  total_investment_balance: number;
  retirement_balance: number;
  emergency_fund_balance: number;
  has_life_insurance: boolean;
  life_insurance_coverage: number;
}

const DEFAULT_PROFILE: ProfileData = {
  annual_gross_income: 0,
  income_type: 'w2',
  housing_type: 'rent',
  mortgage_balance: 0,
  mortgage_rate: 0,
  mortgage_payment: 0,
  monthly_rent: 0,
  debts: [],
  total_investment_balance: 0,
  retirement_balance: 0,
  emergency_fund_balance: 0,
  has_life_insurance: false,
  life_insurance_coverage: 0,
};

const INCOME_TYPES = [
  { value: 'w2', label: 'W-2 Employee' },
  { value: 'self_employed', label: 'Self-Employed / 1099' },
  { value: 'scorp', label: 'S-Corp Owner' },
  { value: 'mixed', label: 'Mixed' },
];

const DEBT_TYPES = ['Student Loan', 'Auto Loan', 'Credit Card', 'Personal Loan', 'Medical Debt', 'Other'];

interface CFPProfileViewProps {
  onBack: () => void;
  householdId: string | null;
}

export function CFPProfileView({ onBack, householdId }: CFPProfileViewProps) {
  const [profile, setProfile] = useState<ProfileData>(DEFAULT_PROFILE);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [existingId, setExistingId] = useState<string | null>(null);

  useEffect(() => {
    if (!householdId) return;
    async function fetch() {
      const { data } = await supabase
        .from('financial_profiles')
        .select('*')
        .eq('household_id', householdId)
        .maybeSingle();
      if (data) {
        setExistingId(data.id);
        setProfile({
          annual_gross_income: Number(data.annual_gross_income) || 0,
          income_type: data.income_type || 'w2',
          housing_type: data.housing_type || 'rent',
          mortgage_balance: Number(data.mortgage_balance) || 0,
          mortgage_rate: Number(data.mortgage_rate) || 0,
          mortgage_payment: Number(data.mortgage_payment) || 0,
          monthly_rent: Number(data.monthly_rent) || 0,
          debts: Array.isArray(data.debts) ? (data.debts as unknown as Debt[]) : [],
          total_investment_balance: Number(data.total_investment_balance) || 0,
          retirement_balance: Number(data.retirement_balance) || 0,
          emergency_fund_balance: Number(data.emergency_fund_balance) || 0,
          has_life_insurance: !!data.has_life_insurance,
          life_insurance_coverage: Number(data.life_insurance_coverage) || 0,
        });
      }
      setLoading(false);
    }
    fetch();
  }, [householdId]);

  const save = async () => {
    if (!householdId) return;
    setSaving(true);
    const payload = {
      household_id: householdId,
      annual_gross_income: profile.annual_gross_income,
      income_type: profile.income_type,
      housing_type: profile.housing_type,
      mortgage_balance: profile.mortgage_balance,
      mortgage_rate: profile.mortgage_rate,
      mortgage_payment: profile.mortgage_payment,
      monthly_rent: profile.monthly_rent,
      debts: profile.debts as any,
      total_investment_balance: profile.total_investment_balance,
      retirement_balance: profile.retirement_balance,
      emergency_fund_balance: profile.emergency_fund_balance,
      has_life_insurance: profile.has_life_insurance,
      life_insurance_coverage: profile.life_insurance_coverage,
    };

    if (existingId) {
      const { error } = await supabase.from('financial_profiles').update(payload).eq('id', existingId);
      if (error) { toast.error('Failed to save profile'); setSaving(false); return; }
    } else {
      const { data, error } = await supabase.from('financial_profiles').insert(payload).select().single();
      if (error) { toast.error('Failed to save profile'); setSaving(false); return; }
      if (data) setExistingId(data.id);
    }
    toast.success('Financial profile saved');
    setSaving(false);
  };

  const update = (field: keyof ProfileData, value: any) => setProfile(p => ({ ...p, [field]: value }));

  const addDebt = () => {
    setProfile(p => ({ ...p, debts: [...p.debts, { type: 'Credit Card', balance: 0, interestRate: 0, monthlyPayment: 0 }] }));
  };

  const updateDebt = (index: number, field: keyof Debt, value: any) => {
    setProfile(p => ({
      ...p,
      debts: p.debts.map((d, i) => i === index ? { ...d, [field]: value } : d),
    }));
  };

  const removeDebt = (index: number) => {
    setProfile(p => ({ ...p, debts: p.debts.filter((_, i) => i !== index) }));
  };

  if (loading) {
    return (
      <div className="max-w-lg mx-auto flex items-center justify-center py-20">
        <div className="w-8 h-8 rounded-full border-2 border-accent border-t-transparent animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto pb-8">
      <div className="px-6 pt-12 safe-top flex items-center gap-3">
        <button onClick={onBack} className="p-1.5 -ml-1.5 rounded-lg hover:bg-muted">
          <ArrowLeft size={20} className="text-foreground" />
        </button>
        <div>
          <h1 className="font-display text-xl font-bold text-foreground">Financial Profile</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Required for personalized insights</p>
        </div>
      </div>

      <div className="px-6 mt-6 space-y-6">
        {/* Income */}
        <section>
          <h2 className="font-display text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
            <Shield size={14} className="text-accent" /> Income
          </h2>
          <div className="bg-card rounded-xl shadow-sm p-4 space-y-3">
            <div>
              <label className="text-xs text-muted-foreground">Household Annual Gross Income *</label>
              <div className="flex items-center gap-1 mt-1">
                <span className="text-sm text-muted-foreground">$</span>
                <input type="number" value={profile.annual_gross_income || ''} onChange={e => update('annual_gross_income', parseFloat(e.target.value) || 0)}
                  placeholder="0" className="flex-1 px-2 py-1.5 rounded bg-background border border-border text-sm tabular-nums text-foreground focus:outline-none focus:ring-2 focus:ring-accent/30" />
              </div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Income Type</label>
              <div className="grid grid-cols-2 gap-1.5 mt-1">
                {INCOME_TYPES.map(t => (
                  <button key={t.value} onClick={() => update('income_type', t.value)}
                    className={`py-2 px-3 rounded-lg text-xs font-medium transition-colors ${
                      profile.income_type === t.value ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
                    }`}>
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* Housing */}
        <section>
          <h2 className="font-display text-sm font-semibold text-foreground mb-3">Housing</h2>
          <div className="bg-card rounded-xl shadow-sm p-4 space-y-3">
            <div className="flex gap-2">
              {['own', 'rent'].map(t => (
                <button key={t} onClick={() => update('housing_type', t)}
                  className={`flex-1 py-2 rounded-lg text-xs font-medium transition-colors ${
                    profile.housing_type === t ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
                  }`}>
                  {t === 'own' ? 'Own' : 'Rent'}
                </button>
              ))}
            </div>
            {profile.housing_type === 'own' ? (
              <div className="space-y-2">
                <NumField label="Mortgage Balance" value={profile.mortgage_balance} onChange={v => update('mortgage_balance', v)} prefix="$" />
                <NumField label="Interest Rate" value={profile.mortgage_rate} onChange={v => update('mortgage_rate', v)} suffix="%" step="0.01" />
                <NumField label="Monthly Payment" value={profile.mortgage_payment} onChange={v => update('mortgage_payment', v)} prefix="$" />
              </div>
            ) : (
              <NumField label="Monthly Rent" value={profile.monthly_rent} onChange={v => update('monthly_rent', v)} prefix="$" />
            )}
          </div>
        </section>

        {/* Debts */}
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
                    <NumField label="Payment" value={debt.monthlyPayment} onChange={v => updateDebt(i, 'monthlyPayment', v)} prefix="$" compact />
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Investments */}
        <section>
          <h2 className="font-display text-sm font-semibold text-foreground mb-3">Investments</h2>
          <div className="bg-card rounded-xl shadow-sm p-4 space-y-2">
            <NumField label="Total Investment Balance" value={profile.total_investment_balance} onChange={v => update('total_investment_balance', v)} prefix="$" />
            <NumField label="Retirement Portion" value={profile.retirement_balance} onChange={v => update('retirement_balance', v)} prefix="$" />
          </div>
        </section>

        {/* Emergency Fund */}
        <section>
          <h2 className="font-display text-sm font-semibold text-foreground mb-3">Emergency Fund</h2>
          <div className="bg-card rounded-xl shadow-sm p-4">
            <NumField label="Current Balance" value={profile.emergency_fund_balance} onChange={v => update('emergency_fund_balance', v)} prefix="$" />
          </div>
        </section>

        {/* Insurance */}
        <section>
          <h2 className="font-display text-sm font-semibold text-foreground mb-3">Insurance</h2>
          <div className="bg-card rounded-xl shadow-sm p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-foreground">Life Insurance</span>
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
            {profile.has_life_insurance && (
              <NumField label="Coverage Amount" value={profile.life_insurance_coverage} onChange={v => update('life_insurance_coverage', v)} prefix="$" />
            )}
          </div>
        </section>

        {/* Save */}
        <button
          onClick={save}
          disabled={saving}
          className="w-full py-3 rounded-xl bg-accent text-accent-foreground font-semibold text-sm active:scale-[0.98] transition-transform disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save Profile'}
        </button>
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
        {prefix && <span className="text-xs text-muted-foreground">{prefix}</span>}
        <input type="number" step={step || '1'} value={value || ''} onChange={e => onChange(parseFloat(e.target.value) || 0)}
          placeholder="0"
          className={`flex-1 px-2 py-1 rounded bg-background border border-border tabular-nums text-foreground focus:outline-none focus:ring-1 focus:ring-accent/30 ${compact ? 'text-xs' : 'text-sm'}`} />
        {suffix && <span className="text-xs text-muted-foreground">{suffix}</span>}
      </div>
    </div>
  );
}
