import { useState } from 'react';
import { Transaction, BudgetCategory, FixedExpense, AccountSource, INCOME_CATEGORY, DEPOSIT_CATEGORY, NOTES_REQUIRED_CATEGORIES } from '@/types/budget';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { format } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

const ACCOUNTS: { id: AccountSource; label: string }[] = [
  { id: 'joe-amex', label: "Joe's Amex" },
  { id: 'katie-amex', label: "Katie's Amex" },
  { id: 'checking', label: 'Checking' },
];

const FIXED_BILL_SENTINEL = '__fixed-bill__';

interface EditTransactionSheetProps {
  transaction: Transaction | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  categories: BudgetCategory[];
  fixedExpenses: FixedExpense[];
}

export function EditTransactionSheet({ transaction, open, onOpenChange, categories, fixedExpenses }: EditTransactionSheetProps) {
  const [categoryId, setCategoryId] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [showFixedPicker, setShowFixedPicker] = useState(false);
  const [depositCategoryId, setDepositCategoryId] = useState('');

  // Sync local state when transaction changes
  const txId = transaction?.id;
  const [lastId, setLastId] = useState('');
  if (txId && txId !== lastId) {
    setLastId(txId);
    setCategoryId(transaction.categoryId);
    setNotes(transaction.notes);
    // Check if current category is a fixed expense
    setShowFixedPicker(fixedExpenses.some(e => e.id === transaction.categoryId));
  }

  if (!transaction) return null;

  const notesRequired = NOTES_REQUIRED_CATEGORIES.includes(categoryId);

  const handleCategoryChange = (value: string) => {
    if (value === FIXED_BILL_SENTINEL) {
      setShowFixedPicker(true);
      // Auto-select first fixed bill
      const firstBill = fixedExpenses.find(e => e.group === 'bills');
      if (firstBill) setCategoryId(firstBill.id);
    } else {
      setShowFixedPicker(false);
      setCategoryId(value);
    }
  };

  // Determine if current categoryId belongs to a fixed expense
  const isFixedCategory = fixedExpenses.some(e => e.id === categoryId);
  // The main dropdown value: show sentinel if in fixed mode, otherwise the actual categoryId
  const mainDropdownValue = showFixedPicker || isFixedCategory ? FIXED_BILL_SENTINEL : categoryId;

  const handleSave = async () => {
    if (notesRequired && !notes.trim()) return;
    setSaving(true);
    const isIncome = categoryId === INCOME_CATEGORY;
    const isDeposit = categoryId === DEPOSIT_CATEGORY;
    const txType = isIncome ? 'income' : isDeposit ? 'deposit' : 'expense';
    const { error } = await supabase
      .from('transactions')
      .update({
        category_slug: categoryId,
        notes,
        transaction_type: txType,
      })
      .eq('id', transaction.id);
    setSaving(false);
    if (error) {
      toast.error('Failed to update transaction');
    } else {
      toast.success('Transaction updated');
      onOpenChange(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="rounded-t-2xl max-w-lg mx-auto bg-background max-h-[90vh] overflow-y-auto">
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
                {ACCOUNTS.find(a => a.id === transaction.account)?.label}
              </span>
            </div>
          </div>

          {/* Category picker */}
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Category</label>
            <select
              value={mainDropdownValue}
              onChange={e => handleCategoryChange(e.target.value)}
              className="w-full mt-1 px-3 py-2.5 rounded-lg bg-card border border-border text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent/30"
            >
              <option value="unassigned">Unassigned</option>
              <option value={INCOME_CATEGORY}>Ignore — Income</option>
              <option value={DEPOSIT_CATEGORY}>Mark as Deposit</option>
              <option value={FIXED_BILL_SENTINEL}>Fixed Bills →</option>
              {categories.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>

          {/* Fixed bill sub-picker */}
          {showFixedPicker && (
            <div className="animate-fade-up">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Fixed Bill Category</label>
              <select
                value={categoryId}
                onChange={e => setCategoryId(e.target.value)}
                className="w-full mt-1 px-3 py-2.5 rounded-lg bg-card border border-accent/40 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent/30"
              >
                {fixedExpenses.filter(e => e.group === 'bills').length > 0 && (
                  <optgroup label="Bills">
                    {fixedExpenses.filter(e => e.group === 'bills').map(e => (
                      <option key={e.id} value={e.id}>{e.name}</option>
                    ))}
                  </optgroup>
                )}
                {fixedExpenses.filter(e => e.group === 'savings').length > 0 && (
                  <optgroup label="Savings">
                    {fixedExpenses.filter(e => e.group === 'savings').map(e => (
                      <option key={e.id} value={e.id}>{e.name}</option>
                    ))}
                  </optgroup>
                )}
                {fixedExpenses.filter(e => e.group === 'tithe').length > 0 && (
                  <optgroup label="Tithe / Giving">
                    {fixedExpenses.filter(e => e.group === 'tithe').map(e => (
                      <option key={e.id} value={e.id}>{e.name}</option>
                    ))}
                  </optgroup>
                )}
              </select>
            </div>
          )}

          {/* Notes */}
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Notes {notesRequired && <span className="text-destructive">*</span>}
            </label>
            <input
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Add a note…"
              className={`w-full mt-1 px-3 py-2.5 rounded-lg bg-card border text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-accent/30 ${
                notesRequired && !notes.trim() ? 'border-accent/60' : 'border-border'
              }`}
            />
          </div>

          <button
            onClick={handleSave}
            disabled={saving || (notesRequired && !notes.trim())}
            className="w-full py-3 rounded-xl bg-accent text-accent-foreground font-semibold text-sm active:scale-[0.98] transition-transform shadow-sm disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
