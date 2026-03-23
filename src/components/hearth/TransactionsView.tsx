import { useState, useEffect } from 'react';
import { Transaction, BudgetCategory, AccountSource, DESCRIPTION_REQUIRED_CATEGORIES } from '@/types/budget';
import { supabase } from '@/integrations/supabase/client';

import { Plus, Trash2 } from 'lucide-react';
import { format } from 'date-fns';

function formatCurrency(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(n);
}

type Filter = 'all' | AccountSource;

interface ProfileInfo {
  user_id: string;
  display_name: string;
  avatar_initial: string;
}

interface TransactionsViewProps {
  transactions: Transaction[];
  categories: BudgetCategory[];
  monthLabel: string;
  onAddTransaction: () => void;
  onDeleteTransaction: (id: string) => void;
}

const ACCOUNT_LABELS: Record<AccountSource, string> = {
  'joe-amex': "Joe's Amex",
  'katie-amex': "Katie's Amex",
  'checking': 'Checking',
};

export function TransactionsView({
  transactions, categories, monthLabel, onAddTransaction, onDeleteTransaction,
}: TransactionsViewProps) {
  const [filter, setFilter] = useState<Filter>('all');
  const [profiles, setProfiles] = useState<ProfileInfo[]>([]);

  useEffect(() => {
    supabase.from('profiles').select('user_id, display_name, avatar_initial').then(({ data }) => {
      if (data) setProfiles(data as ProfileInfo[]);
    });
  }, []);

  const profileMap = Object.fromEntries(profiles.map(p => [p.user_id, p]));
  const catMap = Object.fromEntries(categories.map(c => [c.id, c]));

  const filtered = filter === 'all' ? transactions : transactions.filter(t => t.account === filter);
  const sorted = [...filtered].sort((a, b) => b.date.localeCompare(a.date));

  const filters: { id: Filter; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'joe-amex', label: "Joe's Amex" },
    { id: 'katie-amex', label: "Katie's Amex" },
    { id: 'checking', label: 'Checking' },
  ];

  return (
    <div className="max-w-lg mx-auto">
      <div className="px-6 pt-12 pb-4 safe-top">
        <h1 className="font-display text-xl font-bold text-foreground">{monthLabel} Budget</h1>
      </div>

      <div className="px-6 flex gap-2 mb-4 overflow-x-auto no-scrollbar">
        {filters.map(f => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors active:scale-95 whitespace-nowrap ${
              filter === f.id
                ? 'bg-primary text-primary-foreground'
                : 'bg-card text-muted-foreground'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="px-6 pb-6">
        {sorted.length === 0 ? (
          <div className="text-center py-16 animate-fade-in">
            <p className="text-muted-foreground text-sm mb-3">No transactions yet</p>
            <button
              onClick={onAddTransaction}
              className="inline-flex items-center gap-1.5 text-accent text-sm font-medium active:scale-95 transition-transform"
            >
              <Plus size={16} /> Add your first transaction
            </button>
          </div>
        ) : (
          <div className="bg-card rounded-lg shadow-sm divide-y divide-border overflow-hidden">
            {sorted.map((t, i) => {
              const isDescCat = DESCRIPTION_REQUIRED_CATEGORIES.includes(t.categoryId);
              return (
                <div
                  key={t.id}
                  className="flex items-center gap-3 px-4 py-3 animate-fade-up"
                  style={{ animationDelay: `${i * 30}ms`, animationFillMode: 'both' }}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between items-baseline">
                      <span className="text-sm font-medium text-foreground truncate">
                        {isDescCat && t.description ? t.description : t.description || '(no description)'}
                        {t.isTransferToSavings && (
                          <span className="ml-1.5 text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full">savings</span>
                        )}
                      </span>
                      <span className="text-sm font-medium tabular-nums text-foreground ml-2">
                        {formatCurrency(t.amount)}
                      </span>
                    </div>
                    <div className="flex justify-between text-[11px] text-muted-foreground mt-0.5">
                      <span>{catMap[t.categoryId]?.name || 'Unknown'} · {ACCOUNT_LABELS[t.account]}</span>
                      <span>{format(new Date(t.date), 'MMM d')}</span>
                    </div>
                  </div>
                  <button
                    onClick={() => onDeleteTransaction(t.id)}
                    className="p-1.5 text-muted-foreground/40 hover:text-destructive active:scale-95 transition-all"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <button
        onClick={onAddTransaction}
        className="fixed bottom-24 right-6 w-14 h-14 rounded-full bg-accent text-accent-foreground shadow-lg flex items-center justify-center active:scale-95 transition-transform z-40"
      >
        <Plus size={24} strokeWidth={2.5} />
      </button>
    </div>
  );
}
