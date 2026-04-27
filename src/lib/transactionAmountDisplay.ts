import type { Transaction } from '@/types/budget';

type TransactionAmountOptions = {
  isExcluded?: boolean;
};

type TransactionAmountPresentation = {
  colorClassName: string;
  prefix: '' | '+' | '-';
  value: number;
};

/**
 * Determines how a transaction amount should be displayed.
 *
 * Convention:
 *   - INFLOWS (refunds, deposits, credits): green text, "+" prefix.
 *     - Checking: stored as a negative number (credit to checking)
 *     - Credit card: stored as a negative number (refund/payment to card)
 *   - CC PAYMENTS from checking: always rendered as outflow (red, "-")
 *   - OUTFLOWS (normal expenses): neutral text, no prefix.
 *     The account-color chip already conveys debit direction; red is reserved
 *     for actual problems (e.g., over-budget).
 */
export function getTransactionAmountPresentation(
  transaction: Pick<Transaction, 'account' | 'amount' | 'transactionType'>,
  _options: TransactionAmountOptions = {}
): TransactionAmountPresentation {
  const value = Math.abs(transaction.amount);

  // CC payments are always outflows from checking regardless of amount sign
  if (transaction.transactionType === 'cc-payment' && transaction.account === 'checking') {
    return { colorClassName: 'text-destructive', prefix: '-', value };
  }

  // Inflow detection: negative stored amount means money came in (both for
  // checking credits and credit-card refunds). Show green "+" so refunds and
  // deposits stand out at a glance, even when uncategorized.
  if (transaction.amount < 0) {
    return { colorClassName: 'text-success', prefix: '+', value };
  }

  // Explicit deposit type with non-negative amount (rare but possible) — still inflow.
  if (transaction.transactionType === 'deposit') {
    return { colorClassName: 'text-success', prefix: '+', value };
  }

  // Routine outflow — neutral text, no minus prefix.
  return { colorClassName: 'text-foreground', prefix: '', value };
}
