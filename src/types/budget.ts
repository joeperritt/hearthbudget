export type AccountSource = 'joe-amex' | 'katie-amex' | 'checking';

export interface Transaction {
  id: string;
  date: string;
  description: string;
  amount: number;
  categoryId: string;
  account: AccountSource;
  isTransferToSavings: boolean;
}

export interface BudgetCategory {
  id: string;
  name: string;
  budgeted: number;
  group: 'shared' | 'joe' | 'katie';
}

export interface FixedExpense {
  id: string;
  name: string;
  amount: number;
  group: 'bills' | 'savings' | 'tithe';
}

export interface MonthlyBudget {
  month: string; // YYYY-MM
  categories: BudgetCategory[];
  fixedExpenses: FixedExpense[];
  transactions: Transaction[];
}

export type TabId = 'dashboard' | 'variable' | 'fixed' | 'transactions' | 'planning';
