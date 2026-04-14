import type { Transaction } from '@/types/budget';

type TransactionAmountOptions = {
  isExcluded?: boolean;
};

type TransactionAmountPresentation = {
  colorClassName: string;
  prefix: '' | '+' | '-';
  value: number;
};

export function getTransactionAmountPresentation(
  transaction: Pick<Transaction, 'account' | 'amount' | 'transactionType'>,
  options: TransactionAmountOptions = {}
): TransactionAmountPresentation {
  const value = Math.abs(transaction.amount);

  if (transaction.account === 'checking') {
    // CC payments are always outflows from checking regardless of amount sign
    if (transaction.transactionType === 'cc-payment') {
      return { colorClassName: 'text-destructive', prefix: '-', value };
    }

    // Checking convention: negative amount = inbound credit, positive = outbound debit
    // Amount sign is the source of truth — ignore transactionType for color/prefix
    if (transaction.amount < 0) {
      return { colorClassName: 'text-success', prefix: '+', value };
    }

    if (transaction.amount > 0) {
      return { colorClassName: 'text-destructive', prefix: '-', value };
    }
  }

  if (options.isExcluded) {
    return { colorClassName: 'text-success', prefix: '+', value };
  }

  return { colorClassName: 'text-foreground', prefix: '', value };
}