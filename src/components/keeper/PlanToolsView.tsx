import { useEffect, useState } from 'react';
import {
  ArrowLeft, ChevronRight, Lock, User as UserIcon, Shield, PiggyBank, Home,
  TrendingDown, Heart, Target, Pencil,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

export type PlanToolId =
  | 'financial-profile'
  | 'emergency-fund'
  | 'savings-goals'
  | 'retirement'
  | 'mortgage-analyzer'
  | 'debt-payoff'
  | 'life-insurance';

interface PlanToolDef {
  id: PlanToolId;
  title: string;
  subtitle: string;
  icon: typeof Heart;
  requirement: (fp: any) => { missingLabel: string; profileTab: string } | null;
}

function hasIncome(fp: any) {
  if (!fp) return false;
  const incomes = Array.isArray(fp.member_incomes) ? fp.member_incomes : [];
  return incomes.some((m: any) => (Number(m.gross_income) || 0) > 0);
}
function hasDebts(fp: any) { return !!fp && Array.isArray(fp.debts) && fp.debts.length > 0; }
function hasHousing(fp: any) { return !!fp?.housing_type; }
function hasDependents(fp: any) {
  return !!fp && Array.isArray(fp.dependents) && fp.dependents.length > 0;
}
function hasFilingStatus(fp: any) { return !!fp?.filing_status && !!fp?.state; }

const PLAN_TOOLS: PlanToolDef[] = [
  {
    id: 'emergency-fund', title: 'Emergency Fund Analysis',
    subtitle: 'Are you prepared for the unexpected?', icon: Shield,
    requirement: (fp) => {
      if (!hasIncome(fp)) return { missingLabel: 'Income', profileTab: 'income' };
      if (!hasHousing(fp)) return { missingLabel: 'Housing', profileTab: 'housing' };
      return null;
    },
  },
  {
    id: 'retirement', title: 'Retirement Planner',
    subtitle: 'Are you on track to retire?', icon: PiggyBank,
    requirement: (fp) => {
      if (!hasIncome(fp)) return { missingLabel: 'Income', profileTab: 'income' };
      if (!hasFilingStatus(fp)) return { missingLabel: 'Filing status', profileTab: 'profile' };
      return null;
    },
  },
  {
    id: 'mortgage-analyzer', title: 'Mortgage Analyzer',
    subtitle: 'Analyze your current mortgage', icon: Home,
    requirement: (fp) => {
      if (!hasHousing(fp)) return { missingLabel: 'Housing', profileTab: 'housing' };
      if (fp?.housing_type !== 'own') return { missingLabel: 'Housing (own)', profileTab: 'housing' };
      if (!(Number(fp?.mortgage_balance) > 0 && Number(fp?.mortgage_payment) > 0)) {
        return { missingLabel: 'Mortgage details', profileTab: 'housing' };
      }
      return null;
    },
  },
  {
    id: 'debt-payoff', title: 'Debt Payoff Analyzer',
    subtitle: 'See your path to debt freedom', icon: TrendingDown,
    requirement: (fp) => hasDebts(fp) ? null : { missingLabel: 'Debts', profileTab: 'debts' },
  },
  {
    id: 'life-insurance', title: 'Life Insurance Analysis',
    subtitle: 'Is your family protected?', icon: Heart,
    requirement: (fp) => {
      if (!hasIncome(fp)) return { missingLabel: 'Income', profileTab: 'income' };
      if (!hasDependents(fp)) return { missingLabel: 'Dependents', profileTab: 'profile' };
      return null;
    },
  },
  {
    id: 'savings-goals', title: 'Non-Retirement Goals',
    subtitle: 'Plan and track non-retirement savings goals', icon: Target,
    requirement: () => null,
  },
];

interface Props {
  householdId: string | null;
  onBack: () => void;
  onSelect: (toolId: PlanToolId, profileTabHint?: string) => void;
}

export function PlanToolsView({ householdId, onBack, onSelect }: Props) {
  const [fp, setFp] = useState<any>(null);
  useEffect(() => {
    if (!householdId) return;
    let cancelled = false;
    supabase.from('financial_profiles').select('*').eq('household_id', householdId).maybeSingle()
      .then(({ data }) => { if (!cancelled) setFp(data); });
    return () => { cancelled = true; };
  }, [householdId]);

  return (
    <div className="max-w-lg mx-auto pb-12">
      <div className="px-6 pt-12 safe-top flex items-center gap-3">
        <button onClick={onBack} className="p-2 -ml-2 rounded-full active:bg-muted transition-colors">
          <ArrowLeft size={20} className="text-foreground" />
        </button>
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">Personal Financial Planning Tools</h1>
          <p className="text-xs text-muted-foreground">Profile-driven tools for the long-term picture</p>
        </div>
      </div>

      <div className="px-6 mt-6 space-y-3">
        {/* Prominent Edit Financial Profile entry */}
        <button
          onClick={() => onSelect('financial-profile')}
          className="w-full flex items-center gap-3 bg-primary/5 border border-primary/20 rounded-xl p-4 text-left active:scale-[0.98] transition-transform"
        >
          <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
            <Pencil size={18} className="text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-primary">Edit Financial Profile →</p>
            <p className="text-xs text-muted-foreground">Income, housing, debts, accounts, insurance — unlocks every tool below</p>
          </div>
        </button>

        <div className="space-y-2 pt-2">
          {PLAN_TOOLS.map(tool => {
            const req = tool.requirement(fp);
            const locked = !!req;
            return (
              <PlanTile
                key={tool.id}
                icon={tool.icon}
                title={tool.title}
                subtitle={locked ? `Complete ${req!.missingLabel} to unlock` : tool.subtitle}
                locked={locked}
                onClick={() => {
                  if (locked) onSelect('financial-profile', req!.profileTab);
                  else onSelect(tool.id);
                }}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

function PlanTile({
  icon: Icon, title, subtitle, locked, onClick,
}: {
  icon: typeof Heart;
  title: string;
  subtitle: string;
  locked?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-4 bg-card rounded-lg p-4 shadow-sm text-left active:scale-[0.98] transition-transform border-l-4 border-primary ${locked ? 'opacity-55' : ''}`}
    >
      <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
        <Icon size={20} className="text-primary" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-foreground">{title}</p>
        <p className="text-xs text-muted-foreground">{subtitle}</p>
      </div>
      {locked
        ? <Lock size={14} className="text-muted-foreground shrink-0" />
        : <ChevronRight size={16} className="text-muted-foreground shrink-0" />}
    </button>
  );
}
