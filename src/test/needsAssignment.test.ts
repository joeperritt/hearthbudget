import { describe, it, expect } from 'vitest';
import { needsAssignment, creditCardIds } from '@/lib/needsAssignment';

const cards = creditCardIds([{ id: 'joe-amex', type: 'credit_card' }, { id: 'katie-amex', type: 'credit_card' }, { id: 'checking', type: 'checking' }]);
const tx = (o: Record<string, unknown>) => ({ categoryId: 'unassigned', transactionType: 'deposit', account: 'katie-amex', description: 'Amazon', isTransferToSavings: false, amount: -10.05, ...o }) as never;

describe('needs assignment', () => {
  it('an unassigned card refund needs assignment', () => {
    expect(needsAssignment(tx({}), cards)).toBe(true);
    expect(needsAssignment(tx({ account: 'joe-amex', description: 'BOING US HOLDCO, INCCENTENNIAL CO' }), cards)).toBe(true);
  });
  it('card payments stay excluded', () => {
    for (const d of ['MOBILE PAYMENT - THANK YOU', 'AUTOPAY PAYMENT', 'PAYMENT RECEIVED', 'ONLINE PAYMENT'])
      expect(needsAssignment(tx({ account: 'joe-amex', description: d }), cards)).toBe(false);
  });
  it('checking deposits are unchanged (still excluded)', () => {
    expect(needsAssignment(tx({ account: 'checking', description: 'PAYROLL' }), cards)).toBe(false);
  });
  it('unassigned expenses still count; categorized refunds do not', () => {
    expect(needsAssignment(tx({ transactionType: 'expense', amount: 5 }), cards)).toBe(true);
    expect(needsAssignment(tx({ categoryId: 'groceries' }), cards)).toBe(false);
  });
});
