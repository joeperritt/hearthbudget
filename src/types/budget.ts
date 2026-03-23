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

export type TabId = 'dashboard' | 'variable' | 'fixed' | 'transactions' | 'more';

// Categories that require descriptions
export const DESCRIPTION_REQUIRED_CATEGORIES = ['random', 'hosting-gifts'];

// The Hosting/Gifts/Random category ID — rolls up into giving totals
export const GIVING_VARIABLE_CATEGORY = 'hosting-gifts';
