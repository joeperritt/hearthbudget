import { useState } from 'react';
import { BudgetCategory, BudgetTransfer } from '@/types/budget';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';

interface MoveFundsSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  categories: BudgetCategory[];
  fromCategoryId: string;
  onMove: (transfer: Omit<BudgetTransfer, 'id'>) => void;
}

export function MoveFundsSheet({ open, onOpenChange, categories, fromCategoryId, onMove }: MoveFundsSheetProps) {
  const [toCategoryId, setToCategoryId] = useState('');
  const [amount, setAmount] = useState('');

  const otherCats = categories.filter(c => c.id !== fromCategoryId);
  const fromCat = categories.find(c => c.id === fromCategoryId);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const amt = parseFloat(amount);
    if (!toCategoryId || !amt || amt <= 0) return;
    onMove({
      date: new Date().toISOString().slice(0, 10),
      fromCategoryId,
      toCategoryId,
      amount: amt,
    });
    setAmount('');
    setToCategoryId('');
    onOpenChange(false);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="rounded-t-2xl max-w-lg mx-auto bg-background">
        <SheetHeader>
          <SheetTitle className="font-display text-lg">Move Funds</SheetTitle>
        </SheetHeader>
        <form onSubmit={handleSubmit} className="space-y-4 mt-4 pb-8">
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">From</label>
            <div className="w-full mt-1 px-3 py-2.5 rounded-lg bg-muted/50 border border-border text-sm text-foreground">
              {fromCat?.name || 'Unknown'}
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">To</label>
            <select
              value={toCategoryId}
              onChange={e => setToCategoryId(e.target.value)}
              className="w-full mt-1 px-3 py-2.5 rounded-lg bg-card border border-border text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent/30"
            >
              <option value="">Select category…</option>
              {otherCats.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Amount</label>
            <input
              type="number"
              step="0.01"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              placeholder="$0.00"
              className="w-full mt-1 px-3 py-2.5 rounded-lg bg-card border border-border text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-accent/30 tabular-nums"
            />
          </div>
          <button
            type="submit"
            className="w-full py-3 rounded-xl bg-accent text-accent-foreground font-semibold text-sm active:scale-[0.98] transition-transform shadow-sm"
          >
            Move Funds
          </button>
        </form>
      </SheetContent>
    </Sheet>
  );
}
