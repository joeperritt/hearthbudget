import { useState, useEffect } from 'react';
import { Lightbulb } from 'lucide-react';
import { Transaction, BudgetCategory, FixedExpense, AccountSource, INCOME_CATEGORY, DEPOSIT_CATEGORY, TRANSFER_CATEGORY, CC_PAYMENT_CATEGORY, USER_IGNORE_CATEGORY, PRIOR_MONTH_CATEGORY, IGNORE_CATEGORY_SLUGS, categoryRequiresNotes } from '@/types/budget';
import { AISuggestionCard } from './AISuggestionCard';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { format, subMonths, addMonths } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { SplitEditor, SplitLine } from './SplitEditor';
import { CategoryBudgetMini } from './CategoryBudgetMini';
import { AppAccount } from '@/hooks/useAccounts';

type TxMode = 'variable' | 'fixed' | 'ignore';

function generateMonthOptions(current: string): { value: string; label: string }[] {
  if (!current) return [];
  const base = new Date(current + '-01T00:00:00');
  const options: { value: string; label: string }[] = [];
  for (let i = -3; i <= 1; i++) {
    const d = i < 0 ? subMonths(base, Math.abs(i)) : i > 0 ? addMonths(base, i) : base;
    options.push({ value: format(d, 'yyyy-MM'), label: format(d, 'MMM yyyy') });
  }
  return options;
}

interface EditTransactionSheetProps {
  transaction: Transaction | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  categories: BudgetCategory[];
  fixedExpenses: FixedExpense[];
  activeMonth: string;
  monthTransactions?: Transaction[];
  splitSiblings?: Transaction[];
  accounts?: AppAccount[];
  allTransactions?: Transaction[];
  transferAdjustments?: Record<string, number>;
}

function deriveMode(categoryId: string, transactionType: string, fixedExpenses: FixedExpense[]): TxMode {
  // Auto-detected or user-marked Ignore family
  if (IGNORE_CATEGORY_SLUGS.has(categoryId)) return 'ignore';
  if (transactionType === 'income' || transactionType === 'transfer' || transactionType === 'cc-payment' || transactionType === 'deposit' || transactionType === 'prior-month') {
    return 'ignore';
  }
  if (fixedExpenses.some(e => e.id === categoryId)) return 'fixed';
  return 'variable';
}

export function EditTransactionSheet({ transaction, open, onOpenChange, categories, fixedExpenses, activeMonth, monthTransactions = [], splitSiblings = [], accounts = [], allTransactions = [], transferAdjustments = {} }: EditTransactionSheetProps) {
  const [mode, setMode] = useState<TxMode>('variable');
  const [variableCategoryId, setVariableCategoryId] = useState('unassigned');
  const [fixedCategoryId, setFixedCategoryId] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [isSplit, setIsSplit] = useState(false);
  const [splitLines, setSplitLines] = useState<SplitLine[]>([]);
  const [budgetMonth, setBudgetMonth] = useState('');
  const [suggestionDismissed, setSuggestionDismissed] = useState(false);

  // Preserve the original auto-detected slug + type so we can restore it when user
  // toggles Ignore on a Plaid-detected transfer/cc-payment without overriding.
  const [originalIgnoreSlug, setOriginalIgnoreSlug] = useState<string | null>(null);
  const [originalIgnoreType, setOriginalIgnoreType] = useState<string | null>(null);

  // Sync local state when transaction changes
  useEffect(() => {
    if (!transaction?.id) return;
    setSuggestionDismissed(false);
    setNotes(transaction.notes);
    setBudgetMonth(transaction.budgetMonth || activeMonth);

    if (splitSiblings.length > 1) {
      setIsSplit(true);
      setSplitLines(splitSiblings.map(s => ({ categoryId: s.categoryId, amount: s.amount.toString(), notes: s.notes || '' })));
    } else {
      setIsSplit(false);
      setSplitLines([]);
    }

    const m = deriveMode(transaction.categoryId, transaction.transactionType, fixedExpenses);
    setMode(m);

    if (m === 'variable') {
      setVariableCategoryId(transaction.categoryId || 'unassigned');
    } else if (m === 'fixed') {
      setFixedCategoryId(transaction.categoryId);
    } else if (m === 'ignore') {
      // Capture the existing routing so toggling away & back doesn't lose it
      setOriginalIgnoreSlug(IGNORE_CATEGORY_SLUGS.has(transaction.categoryId) ? transaction.categoryId : null);
      setOriginalIgnoreType(['transfer', 'cc-payment', 'deposit', 'income', 'prior-month'].includes(transaction.transactionType) ? transaction.transactionType : null);
    }
  }, [transaction?.id]);

  if (!transaction) return null;

  const isUnassigned = transaction.categoryId === 'unassigned' && transaction.transactionType === 'expense';
  const showAISuggestion = isUnassigned && !suggestionDismissed;

  const handleUseSuggestion = (suggestion: { type: string; subtype: string | null; categoryId: string | null }) => {
    const typeMap: Record<string, TxMode> = { variable: 'variable', fixed: 'fixed', deposit: 'ignore', 'cc-payment': 'ignore', ignore: 'ignore' };
    const newMode = typeMap[suggestion.type] || 'variable';
    setMode(newMode);
    if (newMode === 'variable' && suggestion.categoryId) {
      setVariableCategoryId(suggestion.categoryId);
    } else if (newMode === 'fixed' && suggestion.categoryId) {
      setFixedCategoryId(suggestion.categoryId);
    }
    setSuggestionDismissed(true);
  };

  const effectiveCategoryId = mode === 'variable' ? variableCategoryId : mode === 'fixed' ? fixedCategoryId : '';
  const notesRequired = !isSplit && categoryRequiresNotes(effectiveCategoryId, categories, fixedExpenses);

  const handleModeChange = (newMode: TxMode) => {
    setMode(newMode);
    setIsSplit(false);
    setSplitLines([]);
    if (newMode === 'fixed' && !fixedCategoryId) {
      const first = fixedExpenses[0];
      if (first) setFixedCategoryId(first.id);
    }
  };

  const handleStartSplit = () => {
    const txAmount = Math.abs(transaction.amount);
    const defaultCat = mode === 'variable' ? (variableCategoryId || 'unassigned') : (fixedCategoryId || fixedExpenses[0]?.id || '');
    const secondCat = mode === 'variable' ? 'unassigned' : (fixedExpenses[0]?.id || '');
    setSplitLines([
      { categoryId: defaultCat, amount: '' },
      { categoryId: secondCat, amount: txAmount > 0 ? txAmount.toFixed(2) : '' },
    ]);
    setIsSplit(true);
  };

  const handleSave = async () => {
    if (notesRequired && !notes.trim()) return;

    if (isSplit && (mode === 'variable' || mode === 'fixed')) {
      const totalAmount = splitSiblings.length > 1
        ? splitSiblings.reduce((s, t) => s + t.amount, 0)
        : Math.abs(transaction.amount);
      const allocated = splitLines.reduce((s, l) => s + (parseFloat(l.amount) || 0), 0);
      if (Math.abs(totalAmount - allocated) >= 0.01) return;

      const missingNotes = splitLines.some(l => parseFloat(l.amount) > 0 && categoryRequiresNotes(l.categoryId, categories, fixedExpenses) && !l.notes?.trim());
      if (missingNotes) return;

      setSaving(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setSaving(false); return; }
      const { data: profile } = await supabase.from('profiles').select('household_id').eq('user_id', user.id).single();
      if (!profile) { setSaving(false); return; }

      const splitRows = splitLines
        .filter(l => parseFloat(l.amount) > 0)
        .map(l => ({
          household_id: profile.household_id,
          date: transaction.date,
          description: transaction.description,
          notes: l.notes?.trim() || notes || '',
          amount: parseFloat(l.amount),
          category_slug: l.categoryId,
          account: transaction.account,
          is_transfer_to_savings: false,
          transaction_type: 'expense',
          entered_by: user.id,
          budget_month: budgetMonth,
        }));

      const { error: insertError } = await supabase.from('transactions').insert(splitRows as any);
      if (insertError) {
        toast.error('Failed to create split transactions');
        setSaving(false);
        return;
      }

      const idsToDelete = splitSiblings.length > 1
        ? splitSiblings.map(s => s.id)
        : [transaction.id];
      const { error: deleteError } = await supabase.from('transactions').delete().in('id', idsToDelete);
      setSaving(false);
      if (deleteError) {
        toast.error('Split created but failed to remove originals');
      } else {
        toast.success(`Split into ${splitRows.length} transactions`);
        onOpenChange(false);
      }
      return;
    }

    setSaving(true);

    let slugToSave: string;
    let txType: string;

    switch (mode) {
      case 'variable':
        slugToSave = variableCategoryId;
        txType = 'expense';
        break;
      case 'fixed':
        slugToSave = fixedCategoryId;
        txType = 'expense';
        break;
      case 'ignore':
        // Preserve auto-detect routing if this transaction was auto-classified;
        // otherwise mark as user-initiated ignore.
        if (originalIgnoreSlug && originalIgnoreType) {
          slugToSave = originalIgnoreSlug;
          txType = originalIgnoreType;
        } else {
          slugToSave = USER_IGNORE_CATEGORY;
          txType = 'expense';
        }
        break;
    }

    const updateData: Record<string, unknown> = {
      category_slug: slugToSave,
      notes,
      transaction_type: txType,
    };
    if (budgetMonth && budgetMonth !== transaction.budgetMonth) {
      updateData.budget_month = budgetMonth;
    }

    const { error } = await supabase
      .from('transactions')
      .update(updateData as any)
      .eq('id', transaction.id);
    setSaving(false);
    if (error) {
      toast.error('Failed to update transaction');
    } else {
      toast.success('Transaction updated');
      onOpenChange(false);
    }
  };

  const MODE_BUTTONS: { id: TxMode; label: string }[] = [
    { id: 'variable', label: 'Variable' },
    { id: 'fixed', label: 'Fixed' },
    { id: 'ignore', label: 'Ignore' },
  ];

  const txAmount = splitSiblings.length > 1
    ? splitSiblings.reduce((s, t) => s + t.amount, 0)
    : Math.abs(transaction.amount);
  const splitMissingNotes = isSplit && splitLines.some(l => parseFloat(l.amount) > 0 && categoryRequiresNotes(l.categoryId, categories, fixedExpenses) && !l.notes?.trim());
  const splitBalanced = isSplit && Math.abs(txAmount - splitLines.reduce((s, l) => s + (parseFloat(l.amount) || 0), 0)) < 0.01;
  const canSave = (!notesRequired || !!notes.trim()) && (!isSplit || (splitBalanced && !splitMissingNotes)) && !saving;

  const monthOptions = generateMonthOptions(activeMonth);

  // Friendly label for the ignore reason (when auto-detected)
  const ignoreReasonLabel = (() => {
    if (mode !== 'ignore') return null;
    if (originalIgnoreSlug === TRANSFER_CATEGORY || originalIgnoreType === 'transfer') return 'Auto-detected as a transfer between accounts';
    if (originalIgnoreSlug === CC_PAYMENT_CATEGORY || originalIgnoreType === 'cc-payment') return 'Auto-detected as a credit card payment';
    if (originalIgnoreSlug === INCOME_CATEGORY || originalIgnoreType === 'income') return 'Marked as income';
    if (originalIgnoreSlug === DEPOSIT_CATEGORY || originalIgnoreType === 'deposit') return 'Marked as a deposit';
    if (originalIgnoreSlug === PRIOR_MONTH_CATEGORY || originalIgnoreType === 'prior-month') return 'Belongs to a prior budget month';
    return 'Excluded from budget tracking';
  })();

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="rounded-t-2xl max-w-[560px] mx-auto bg-background max-h-[90vh] overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="font-display text-lg">Edit Transaction</SheetTitle>
        </SheetHeader>
        <div className="space-y-4 mt-4 pb-8">
          {/* Read-only details */}
          <div className="bg-card rounded-lg p-4 space-y-2">
            <div className="flex justify-between">
              <span className="text-xs text-muted-foreground uppercase">Merchant</span>
              <span className="text-sm font-medium text-foreground">{transaction.description || '—'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-xs text-muted-foreground uppercase">Amount</span>
              <span className="text-sm font-medium tabular-nums text-foreground">
                {transaction.amount < 0 ? '-' : ''}${Math.abs(transaction.amount).toFixed(2)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-xs text-muted-foreground uppercase">Date</span>
              <span className="text-sm text-foreground">{format(new Date(transaction.date), 'MMM d, yyyy')}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-xs text-muted-foreground uppercase">Account</span>
              <span className="text-sm text-foreground">
                {accounts.find(a => a.id === transaction.account)?.label || transaction.account}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-xs text-muted-foreground uppercase">Source</span>
              <span className="text-sm text-muted-foreground">
                {transaction.source === 'manual'
                  ? 'Manually added'
                  : `${accounts.find(a => a.id === transaction.account)?.label || transaction.account} (synced)`}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-xs text-muted-foreground uppercase">Budget Month</span>
              <select
                value={budgetMonth}
                onChange={e => setBudgetMonth(e.target.value)}
                className="text-sm text-foreground bg-transparent text-right border-none focus:outline-none focus:ring-0 cursor-pointer"
              >
                {monthOptions.map(m => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
            </div>
          </div>

          {/* AI Suggestion Card — only for unassigned transactions */}
          {showAISuggestion && (
            <AISuggestionCard
              transaction={transaction}
              categories={categories}
              fixedExpenses={fixedExpenses}
              allTransactions={allTransactions}
              onUseSuggestion={handleUseSuggestion}
              onDismiss={() => setSuggestionDismissed(true)}
            />
          )}

          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Type</label>
            <div className="flex gap-1.5 mt-1.5">
              {MODE_BUTTONS.map(b => (
                <button
                  key={b.id}
                  onClick={() => handleModeChange(b.id)}
                  className={`flex-1 px-2 py-2 rounded-full text-xs font-semibold transition-all active:scale-95 ${
                    mode === b.id
                      ? 'bg-accent text-accent-foreground shadow-sm'
                      : 'bg-card text-muted-foreground border border-border'
                  }`}
                >
                  {b.label}
                </button>
              ))}
            </div>
            {mode === 'variable' && (
              <p className="text-[11px] text-muted-foreground/80 mt-2 leading-relaxed">
                Counts toward a budget category — like groceries, gas, or eating out.
              </p>
            )}
            {mode === 'fixed' && (
              <p className="text-[11px] text-muted-foreground/80 mt-2 leading-relaxed">
                Recurring bills you can predict — mortgage, utilities, subscriptions.
              </p>
            )}
          </div>

          {/* Variable category */}
          {mode === 'variable' && !isSplit && (
            <div className="animate-fade-up">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Category</label>
                <button
                  type="button"
                  onClick={handleStartSplit}
                  className="text-[11px] font-medium text-accent active:scale-95 transition-transform"
                >
                  Split →
                </button>
              </div>
              <select
                value={variableCategoryId}
                onChange={e => setVariableCategoryId(e.target.value)}
                className="w-full mt-1 px-3 py-2.5 rounded-lg bg-card border border-border text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent/30"
              >
                <option value="unassigned">Unassigned</option>
                {[...categories].sort((a, b) => a.name.localeCompare(b.name)).map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              <CategoryBudgetMini categoryId={variableCategoryId} categories={categories} fixedExpenses={fixedExpenses} transactions={monthTransactions} pendingAmount={Math.abs(transaction.amount)} excludeTransactionIds={splitSiblings.length > 1 ? splitSiblings.map(s => s.id) : [transaction.id]} transferAdjustment={transferAdjustments[variableCategoryId] || 0} />
            </div>
          )}

          {/* Fixed category */}
          {mode === 'fixed' && !isSplit && (
            <div className="animate-fade-up">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Fixed Category</label>
                <button
                  type="button"
                  onClick={handleStartSplit}
                  className="text-[11px] font-medium text-accent active:scale-95 transition-transform"
                >
                  Split →
                </button>
              </div>
              <select
                value={fixedCategoryId}
                onChange={e => setFixedCategoryId(e.target.value)}
                className="w-full mt-1 px-3 py-2.5 rounded-lg bg-card border border-accent/40 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent/30"
              >
                {fixedExpenses.filter(e => e.group === 'bills').length > 0 && (
                  <optgroup label="Bills">
                    {fixedExpenses.filter(e => e.group === 'bills').sort((a, b) => a.name.localeCompare(b.name)).map(e => (
                      <option key={e.id} value={e.id}>{e.name}</option>
                    ))}
                  </optgroup>
                )}
                {fixedExpenses.filter(e => e.group === 'savings').length > 0 && (
                  <optgroup label="Savings">
                    {fixedExpenses.filter(e => e.group === 'savings').sort((a, b) => a.name.localeCompare(b.name)).map(e => (
                      <option key={e.id} value={e.id}>{e.name}</option>
                    ))}
                  </optgroup>
                )}
                {fixedExpenses.filter(e => e.group === 'tithe').length > 0 && (
                  <optgroup label="Tithe / Giving">
                    {fixedExpenses.filter(e => e.group === 'tithe').sort((a, b) => a.name.localeCompare(b.name)).map(e => (
                      <option key={e.id} value={e.id}>{e.name}</option>
                    ))}
                  </optgroup>
                )}
              </select>
              <CategoryBudgetMini categoryId={fixedCategoryId} categories={categories} fixedExpenses={fixedExpenses} transactions={monthTransactions} pendingAmount={Math.abs(transaction.amount)} excludeTransactionIds={splitSiblings.length > 1 ? splitSiblings.map(s => s.id) : [transaction.id]} transferAdjustment={transferAdjustments[fixedCategoryId] || 0} />
            </div>
          )}

          {isSplit && (mode === 'variable' || mode === 'fixed') && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Split Mode</span>
                <button
                  type="button"
                  onClick={() => { setIsSplit(false); setSplitLines([]); }}
                  className="text-[11px] font-medium text-destructive active:scale-95 transition-transform"
                >
                  Cancel Split
                </button>
              </div>
              <SplitEditor
                totalAmount={txAmount}
                mode={mode}
                categories={categories}
                fixedExpenses={fixedExpenses}
                lines={splitLines}
                onChange={setSplitLines}
                transactions={monthTransactions}
                excludeTransactionIds={splitSiblings.length > 1 ? splitSiblings.map(s => s.id) : [transaction.id]}
                transferAdjustments={transferAdjustments}
              />
            </div>
          )}

          {/* Ignore — educational copy + prominent notes */}
          {mode === 'ignore' && (
            <div className="animate-fade-up rounded-lg p-3 bg-amber-50 dark:bg-amber-950/20 border border-amber-200/60 dark:border-amber-900/40">
              <div className="flex gap-2">
                <Lightbulb size={14} className="shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" strokeWidth={2.25} />
                <p className="text-[11px] text-foreground/80 leading-relaxed">
                  {ignoreReasonLabel ? <><span className="font-medium">{ignoreReasonLabel}.</span> </> : null}
                  Common uses: paychecks coming in, transfers to and from savings, paying off credit cards. These don't belong in budget categories because they're moving money around, not spending it.
                </p>
              </div>
            </div>
          )}

          {/* Notes — surfaced prominently for Ignore so user can leave context */}
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Notes {notesRequired && <span className="text-destructive">*</span>}
              {mode === 'ignore' && <span className="text-muted-foreground/60 normal-case ml-1">(why are you ignoring this?)</span>}
            </label>
            <input
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder={mode === 'ignore' ? 'e.g. cash withdrawal, tax refund, one-off…' : 'Add a note…'}
              className={`w-full mt-1 px-3 py-2.5 rounded-lg bg-card border text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-accent/30 ${
                notesRequired && !notes.trim() ? 'border-accent/60' : 'border-border'
              }`}
            />
          </div>

          <button
            onClick={handleSave}
            disabled={!canSave}
            className="w-full py-3 rounded-xl bg-accent text-accent-foreground font-semibold text-sm active:scale-[0.98] transition-transform shadow-sm disabled:opacity-50"
          >
            {saving ? 'Saving…' : isSplit ? `Split into ${splitLines.filter(l => parseFloat(l.amount) > 0).length} Transactions` : 'Save Changes'}
          </button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
