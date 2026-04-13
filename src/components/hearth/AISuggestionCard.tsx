import { useState, useEffect, useRef } from 'react';
import { Sparkles, X } from 'lucide-react';
import { Transaction, BudgetCategory, FixedExpense } from '@/types/budget';
import { supabase } from '@/integrations/supabase/client';

interface AISuggestion {
  type: 'variable' | 'fixed' | 'deposit' | 'cc-payment' | 'ignore';
  subtype: string | null;
  categoryId: string | null;
  categoryName: string | null;
  confidence: 'high' | 'medium' | 'low';
  reason: string;
}

interface AISuggestionCardProps {
  transaction: Transaction;
  categories: BudgetCategory[];
  fixedExpenses: FixedExpense[];
  allTransactions: Transaction[];
  onUseSuggestion: (suggestion: AISuggestion) => void;
  onDismiss: () => void;
}

export function AISuggestionCard({
  transaction,
  categories,
  fixedExpenses,
  allTransactions,
  onUseSuggestion,
  onDismiss,
}: AISuggestionCardProps) {
  const [suggestion, setSuggestion] = useState<AISuggestion | null>(null);
  const [loading, setLoading] = useState(true);
  const [hidden, setHidden] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    abortRef.current = controller;

    // 3-second timeout
    timeoutRef.current = setTimeout(() => {
      controller.abort();
      setHidden(true);
    }, 3000);

    fetchSuggestion(controller.signal);

    return () => {
      controller.abort();
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [transaction.id]);

  const fetchSuggestion = async (signal: AbortSignal) => {
    try {
      // Build merchant history from last 3 months of similar transactions
      const merchantName = transaction.description.toLowerCase();
      const merchantHistory = allTransactions
        .filter(t =>
          t.id !== transaction.id &&
          t.categoryId !== 'unassigned' &&
          t.description.toLowerCase().includes(merchantName.split(' ')[0]) // Match first word
        )
        .slice(0, 10)
        .map(t => {
          const cat = categories.find(c => c.id === t.categoryId);
          const fixed = fixedExpenses.find(e => e.id === t.categoryId);
          return {
            description: t.description,
            categoryName: cat?.name || fixed?.name || t.categoryId,
            type: t.transactionType,
            date: t.date,
          };
        });

      const { data, error } = await supabase.functions.invoke('categorize-transaction', {
        body: {
          transaction: {
            description: transaction.description,
            amount: transaction.amount,
            date: transaction.date,
            account: transaction.account,
          },
          categories: categories.map(c => ({ id: c.id, name: c.name })),
          fixedExpenses: fixedExpenses.map(e => ({ id: e.id, name: e.name, amount: e.amount, group: e.group })),
          merchantHistory,
        },
      });

      if (signal.aborted) return;
      if (timeoutRef.current) clearTimeout(timeoutRef.current);

      if (error || !data?.suggestion) {
        setHidden(true);
        return;
      }

      const s = data.suggestion as AISuggestion;

      // Only show if medium or high confidence
      if (s.confidence === 'low') {
        setHidden(true);
        return;
      }

      setSuggestion(s);
      setLoading(false);
    } catch {
      setHidden(true);
    }
  };

  if (hidden) return null;

  if (loading) {
    return (
      <div className="mx-0 mb-3 rounded-lg border border-accent/30 bg-accent/5 p-3 animate-pulse">
        <div className="flex items-center gap-2">
          <Sparkles size={14} className="text-accent animate-spin" style={{ animationDuration: '2s' }} />
          <div className="h-3 w-32 bg-accent/20 rounded" />
        </div>
        <div className="mt-2 h-3 w-48 bg-accent/10 rounded" />
      </div>
    );
  }

  if (!suggestion) return null;

  const typeLabel = suggestion.type === 'variable' ? 'Variable' :
    suggestion.type === 'fixed' ? 'Fixed' :
    suggestion.type === 'deposit' ? 'Deposit' :
    suggestion.type === 'cc-payment' ? 'CC Payment' :
    `Ignore (${suggestion.subtype || 'income'})`;

  return (
    <div className="mx-0 mb-3 rounded-lg border border-accent/30 bg-accent/5 p-3 animate-fade-up">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <Sparkles size={14} className="text-accent shrink-0" />
          <span className="text-xs font-semibold text-accent uppercase tracking-wide">AI Suggestion</span>
        </div>
        <button onClick={() => { setHidden(true); onDismiss(); }} className="text-muted-foreground/50 hover:text-muted-foreground p-0.5">
          <X size={14} />
        </button>
      </div>

      <div className="mt-2 space-y-1">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold text-accent bg-accent/15 px-1.5 py-0.5 rounded-full">{typeLabel}</span>
          {suggestion.categoryName && (
            <span className="text-sm font-medium text-foreground">{suggestion.categoryName}</span>
          )}
        </div>
        <p className="text-[11px] text-muted-foreground leading-relaxed">{suggestion.reason}</p>
      </div>

      <div className="flex gap-2 mt-3">
        <button
          onClick={() => onUseSuggestion(suggestion)}
          className="flex-1 py-1.5 rounded-lg bg-accent text-accent-foreground text-xs font-semibold active:scale-95 transition-transform"
        >
          Use This
        </button>
        <button
          onClick={() => { setHidden(true); onDismiss(); }}
          className="flex-1 py-1.5 rounded-lg bg-muted text-muted-foreground text-xs font-semibold active:scale-95 transition-transform"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
