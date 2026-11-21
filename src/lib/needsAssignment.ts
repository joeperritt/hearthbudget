import type { Transaction } from '@/types/budget';

type Tx = Pick<Transaction, 'categoryId' | 'transactionType' | 'account' | 'description' | 'isTransferToSavings'>;
type Acct = { id: string; type: string };

/** Card payment credits stay hidden/excluded exactly as before. */
const CARD_PAYMENT = /(MOBILE PAYMENT|AUTOPAY|PAYMENT RECEIVED|ONLINE PAYMENT|PAYMENT\s*-\s*THANK YOU)/i;
export const isCardPaymentDescription = (d: string | null | undefined) => CARD_PAYMENT.test(d || '');

export const creditCardIds = (accounts: Acct[]) => new Set(accounts.filter(a => a.type === 'credit_card').map(a => a.id));

/** An unassigned credit on a credit card that isn't a card payment. */
export function isUnassignedRefund(t: Tx, cardIds: Set<string>) {
  return t.transactionType === 'deposit' && t.categoryId === 'unassigned' && !t.isTransferToSavings
    && cardIds.has(t.account) && !isCardPaymentDescription(t.description);
}

const EXCLUDED_TYPES = new Set(['income', 'deposit', 'cc-payment', 'transfer']);

/** Single source of truth for "shows in Unassigned / counts toward to assign". */
export function needsAssignment(t: Tx, cardIds: Set<string>) {
  if (t.categoryId !== 'unassigned' || t.isTransferToSavings) return false;
  return !EXCLUDED_TYPES.has(t.transactionType) || isUnassignedRefund(t, cardIds);
}
