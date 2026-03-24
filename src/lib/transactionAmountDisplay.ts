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
    const isInflowByType = transaction.transactionType === 'income' || transaction.transactionType === 'deposit';
    const isOutflowByType = transaction.transactionType === 'expense';
    const isInflow = transaction.amount > 0 || (transaction.amount === 0 && isInflowByType);
    const isOutflow = transaction.amount < 0 || (transaction.amount === 0 && isOutflowByType);

    if (isInflow) {
      return { colorClassName: 'text-success', prefix: '+', value };
    }

    if (isOutflow) {
      return { colorClassName: 'text-destructive', prefix: '-', value };
    }
  }

  if (options.isExcluded) {
    return { colorClassName: 'text-success', prefix: '+', value };
  }

  return { colorClassName: 'text-foreground', prefix: '', value };
}