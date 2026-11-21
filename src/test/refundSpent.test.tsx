import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CategoryBudgetMini } from '@/components/keeper/CategoryBudgetMini';

describe('categorized refund', () => {
  it('a refund assigned as a deposit reduces that category spent', () => {
    const categories = [{ id: 'groceries', name: 'Groceries', budgeted: 100 }] as never;
    const t = (o: Record<string, unknown>) => ({ id: Math.random().toString(), categoryId: 'groceries', account: 'katie-amex', date: '2026-11-16', description: 'x', isTransferToSavings: false, budgetMonth: '2026-11', ...o });
    render(<CategoryBudgetMini categoryId="groceries" categories={categories} fixedExpenses={[]}
      transactions={[t({ amount: 50, transactionType: 'expense' }), t({ amount: -10.05, transactionType: 'deposit' })] as never} />);
    // 50 spent - 10.05 refunded = 39.95 spent, 60.05 left
    expect(document.body.textContent).toContain('$60.05');
  });
});
