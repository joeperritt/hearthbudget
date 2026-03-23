import { useState, useEffect } from 'react';
import { Transaction, BudgetCategory, AccountSource } from '@/types/budget';
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
              return (
              <div
                  key={t.id}
                  className="flex items-center gap-3 px-4 py-3 animate-fade-up"
                  style={{ animationDelay: `${i * 30}ms`, animationFillMode: 'both' }}
                >
                  {/* Avatar badge — large */}
                  {t.enteredBy && profileMap[t.enteredBy] ? (
                    <div className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold shrink-0 ${
                      profileMap[t.enteredBy].avatar_initial === 'J'
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-accent text-accent-foreground'
                    }`}>
                      {profileMap[t.enteredBy].avatar_initial}
                    </div>
                  ) : (
                    <div className="w-9 h-9 rounded-full bg-muted flex items-center justify-center text-sm font-bold text-muted-foreground shrink-0">?</div>
                  )}

                  {/* Center — category + entered by + description */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">
                      {catMap[t.categoryId]?.name || 'Unknown'}
                      {t.isTransferToSavings && (
                        <span className="ml-1.5 text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full align-middle">savings</span>
                      )}
                    </p>
                    <p className="text-[11px] text-muted-foreground truncate mt-0.5">
                      {t.enteredBy && profileMap[t.enteredBy]
                        ? `Entered by ${profileMap[t.enteredBy].display_name}`
                        : 'Entered by unknown'}
                      {t.description ? ` · ${t.description}` : ''}
                    </p>
                  </div>

                  {/* Right — amount, date, account pill */}
                  <div className="text-right shrink-0 flex flex-col items-end gap-0.5">
                    <span className="text-sm font-medium tabular-nums text-foreground">
                      {formatCurrency(t.amount)}
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                      {format(new Date(t.date), 'MMM d')}
                    </span>
                    <span className="text-[9px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full mt-0.5">
                      {ACCOUNT_LABELS[t.account]}
                    </span>
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
