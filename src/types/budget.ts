export type AccountSource = 'joe-amex' | 'katie-amex' | 'checking';

export type TransactionType = 'expense' | 'budget-adjustment' | 'income';

// Special category slug for income/credits that should be excluded from all budget tracking
export const INCOME_CATEGORY = 'ignore-income';

export interface Transaction {
  id: string;
  date: string;
  description: string;
  notes: string;
  amount: number;
  categoryId: string;
  account: AccountSource;
  isTransferToSavings: boolean;
  transactionType: TransactionType;
  enteredBy?: string | null;
}

// A split transaction creates multiple TransactionSplit entries under one parent
export interface TransactionSplit {
  categoryId: string;
  amount: number;
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

export interface BudgetTransfer {
  id: string;
  date: string;
  fromCategoryId: string;
  toCategoryId: string;
  amount: number;
}

export interface MonthlyBudget {
  month: string; // YYYY-MM
  categories: BudgetCategory[];
  fixedExpenses: FixedExpense[];
  transactions: Transaction[];
}

export type TabId = 'dashboard' | 'variable' | 'transactions' | 'more';

// Categories that require notes
export const NOTES_REQUIRED_CATEGORIES = ['random', 'gifts', 'hosting-gifts'];

// The Hosting/Gifts/Random category ID — rolls up into giving totals
export const GIVING_VARIABLE_CATEGORY = 'hosting-gifts';
