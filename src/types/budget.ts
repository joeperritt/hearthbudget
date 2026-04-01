export type AccountSource = 'joe-amex' | 'katie-amex' | 'checking';

export type TransactionType = 'expense' | 'budget-adjustment' | 'income' | 'deposit' | 'cc-payment';

// Special category slug for income/credits that should be excluded from all budget tracking
export const INCOME_CATEGORY = 'ignore-income';
export const DEPOSIT_CATEGORY = 'ignore-deposit';
export const TRANSFER_CATEGORY = 'ignore-transfer';
export const CC_PAYMENT_CATEGORY = 'cc-payment';
export const PRIOR_MONTH_CATEGORY = 'ignore-prior-month';

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
  budgetMonth: string;
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
  notesRequired: boolean;
}

/** Check if a category requires notes (works for both variable and fixed categories) */
export function categoryRequiresNotes(categoryId: string, categories: BudgetCategory[]): boolean {
  return categories.some(c => c.id === categoryId && c.notesRequired);
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
