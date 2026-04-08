/**
 * 2025 Tax Estimation Engine
 * Federal brackets, FICA, and state income tax rates for all 50 states + DC.
 */

export type FilingStatus = 'single' | 'married_jointly' | 'married_separately' | 'head_of_household';
export type IncomeType = 'w2' | 'self_employed' | 'scorp' | 'mixed';

// 2025 Federal Tax Brackets
interface TaxBracket { min: number; max: number; rate: number }

const FEDERAL_BRACKETS: Record<FilingStatus, TaxBracket[]> = {
  single: [
    { min: 0, max: 11925, rate: 0.10 },
    { min: 11925, max: 48475, rate: 0.12 },
    { min: 48475, max: 103350, rate: 0.22 },
    { min: 103350, max: 197300, rate: 0.24 },
    { min: 197300, max: 250525, rate: 0.32 },
    { min: 250525, max: 626350, rate: 0.35 },
    { min: 626350, max: Infinity, rate: 0.37 },
  ],
  married_jointly: [
    { min: 0, max: 23850, rate: 0.10 },
    { min: 23850, max: 96950, rate: 0.12 },
    { min: 96950, max: 206700, rate: 0.22 },
    { min: 206700, max: 394600, rate: 0.24 },
    { min: 394600, max: 501050, rate: 0.32 },
    { min: 501050, max: 751600, rate: 0.35 },
    { min: 751600, max: Infinity, rate: 0.37 },
  ],
  married_separately: [
    { min: 0, max: 11925, rate: 0.10 },
    { min: 11925, max: 48475, rate: 0.12 },
    { min: 48475, max: 103350, rate: 0.22 },
    { min: 103350, max: 197300, rate: 0.24 },
    { min: 197300, max: 250525, rate: 0.32 },
    { min: 250525, max: 375800, rate: 0.35 },
    { min: 375800, max: Infinity, rate: 0.37 },
  ],
  head_of_household: [
    { min: 0, max: 17000, rate: 0.10 },
    { min: 17000, max: 64850, rate: 0.12 },
    { min: 64850, max: 103350, rate: 0.22 },
    { min: 103350, max: 197300, rate: 0.24 },
    { min: 197300, max: 250500, rate: 0.32 },
    { min: 250500, max: 626350, rate: 0.35 },
    { min: 626350, max: Infinity, rate: 0.37 },
  ],
};

// Standard deduction 2025
const STANDARD_DEDUCTION: Record<FilingStatus, number> = {
  single: 15000,
  married_jointly: 30000,
  married_separately: 15000,
  head_of_household: 22500,
};

export function estimateFederalTax(annualGross: number, filingStatus: FilingStatus): number {
  const taxableIncome = Math.max(0, annualGross - STANDARD_DEDUCTION[filingStatus]);
  const brackets = FEDERAL_BRACKETS[filingStatus];
  let tax = 0;
  for (const b of brackets) {
    if (taxableIncome <= b.min) break;
    const taxable = Math.min(taxableIncome, b.max) - b.min;
    tax += taxable * b.rate;
  }
  return tax;
}

// FICA 2025
const SS_WAGE_BASE = 176100;
const SS_RATE = 0.062;
const MEDICARE_RATE = 0.0145;
const ADDITIONAL_MEDICARE_THRESHOLD = 200000;
const ADDITIONAL_MEDICARE_RATE = 0.009;

export function estimateFICA(annualGross: number, incomeType: IncomeType): { ss: number; medicare: number; total: number; note?: string } {
  // For S-Corp owners, FICA only applies to W-2 wage portion
  const isSelfEmployed = incomeType === 'self_employed';
  const isScorp = incomeType === 'scorp';

  const ssWages = Math.min(annualGross, SS_WAGE_BASE);
  let ss = ssWages * SS_RATE;
  let medicare = annualGross * MEDICARE_RATE;

  if (annualGross > ADDITIONAL_MEDICARE_THRESHOLD) {
    medicare += (annualGross - ADDITIONAL_MEDICARE_THRESHOLD) * ADDITIONAL_MEDICARE_RATE;
  }

  // Self-employed pay both halves
  if (isSelfEmployed) {
    ss *= 2;
    medicare *= 2;
  }

  let note: string | undefined;
  if (isScorp) {
    note = 'S-Corp: FICA applies only to your W-2 wage portion, not distributions. Enter your reasonable salary here.';
  }
  if (isSelfEmployed) {
    note = 'Self-employed: Includes both employee and employer portions of FICA (15.3% total).';
  }

  return { ss, medicare, total: ss + medicare, note };
}

// State income tax data — simplified marginal rate structures for all 50 states + DC
// States with no income tax return 0

export interface StateInfo {
  name: string;
  abbr: string;
  hasIncomeTax: boolean;
  brackets?: TaxBracket[];
  flatRate?: number;
}

export const STATES: StateInfo[] = [
  { name: 'Alabama', abbr: 'AL', hasIncomeTax: true, brackets: [{ min: 0, max: 500, rate: 0.02 }, { min: 500, max: 3000, rate: 0.04 }, { min: 3000, max: Infinity, rate: 0.05 }] },
  { name: 'Alaska', abbr: 'AK', hasIncomeTax: false },
  { name: 'Arizona', abbr: 'AZ', hasIncomeTax: true, flatRate: 0.025 },
  { name: 'Arkansas', abbr: 'AR', hasIncomeTax: true, brackets: [{ min: 0, max: 4400, rate: 0.02 }, { min: 4400, max: 8800, rate: 0.04 }, { min: 8800, max: Infinity, rate: 0.044 }] },
  { name: 'California', abbr: 'CA', hasIncomeTax: true, brackets: [{ min: 0, max: 10412, rate: 0.01 }, { min: 10412, max: 24684, rate: 0.02 }, { min: 24684, max: 38959, rate: 0.04 }, { min: 38959, max: 54081, rate: 0.06 }, { min: 54081, max: 68350, rate: 0.08 }, { min: 68350, max: 349137, rate: 0.093 }, { min: 349137, max: 418961, rate: 0.103 }, { min: 418961, max: 698271, rate: 0.113 }, { min: 698271, max: 1000000, rate: 0.123 }, { min: 1000000, max: Infinity, rate: 0.133 }] },
  { name: 'Colorado', abbr: 'CO', hasIncomeTax: true, flatRate: 0.044 },
  { name: 'Connecticut', abbr: 'CT', hasIncomeTax: true, brackets: [{ min: 0, max: 10000, rate: 0.02 }, { min: 10000, max: 50000, rate: 0.045 }, { min: 50000, max: 100000, rate: 0.055 }, { min: 100000, max: 200000, rate: 0.06 }, { min: 200000, max: 250000, rate: 0.065 }, { min: 250000, max: 500000, rate: 0.069 }, { min: 500000, max: Infinity, rate: 0.0699 }] },
  { name: 'Delaware', abbr: 'DE', hasIncomeTax: true, brackets: [{ min: 0, max: 2000, rate: 0.0 }, { min: 2000, max: 5000, rate: 0.022 }, { min: 5000, max: 10000, rate: 0.039 }, { min: 10000, max: 20000, rate: 0.048 }, { min: 20000, max: 25000, rate: 0.052 }, { min: 25000, max: 60000, rate: 0.0555 }, { min: 60000, max: Infinity, rate: 0.066 }] },
  { name: 'Florida', abbr: 'FL', hasIncomeTax: false },
  { name: 'Georgia', abbr: 'GA', hasIncomeTax: true, flatRate: 0.0549 },
  { name: 'Hawaii', abbr: 'HI', hasIncomeTax: true, brackets: [{ min: 0, max: 2400, rate: 0.014 }, { min: 2400, max: 4800, rate: 0.032 }, { min: 4800, max: 9600, rate: 0.055 }, { min: 9600, max: 14400, rate: 0.064 }, { min: 14400, max: 19200, rate: 0.068 }, { min: 19200, max: 24000, rate: 0.072 }, { min: 24000, max: 36000, rate: 0.076 }, { min: 36000, max: 48000, rate: 0.079 }, { min: 48000, max: 150000, rate: 0.0825 }, { min: 150000, max: 175000, rate: 0.09 }, { min: 175000, max: 200000, rate: 0.10 }, { min: 200000, max: Infinity, rate: 0.11 }] },
  { name: 'Idaho', abbr: 'ID', hasIncomeTax: true, flatRate: 0.058 },
  { name: 'Illinois', abbr: 'IL', hasIncomeTax: true, flatRate: 0.0495 },
  { name: 'Indiana', abbr: 'IN', hasIncomeTax: true, flatRate: 0.0305 },
  { name: 'Iowa', abbr: 'IA', hasIncomeTax: true, flatRate: 0.038 },
  { name: 'Kansas', abbr: 'KS', hasIncomeTax: true, brackets: [{ min: 0, max: 15000, rate: 0.031 }, { min: 15000, max: 30000, rate: 0.0525 }, { min: 30000, max: Infinity, rate: 0.057 }] },
  { name: 'Kentucky', abbr: 'KY', hasIncomeTax: true, flatRate: 0.04 },
  { name: 'Louisiana', abbr: 'LA', hasIncomeTax: true, flatRate: 0.03 },
  { name: 'Maine', abbr: 'ME', hasIncomeTax: true, brackets: [{ min: 0, max: 24500, rate: 0.058 }, { min: 24500, max: 58050, rate: 0.0675 }, { min: 58050, max: Infinity, rate: 0.0715 }] },
  { name: 'Maryland', abbr: 'MD', hasIncomeTax: true, brackets: [{ min: 0, max: 1000, rate: 0.02 }, { min: 1000, max: 2000, rate: 0.03 }, { min: 2000, max: 3000, rate: 0.04 }, { min: 3000, max: 100000, rate: 0.0475 }, { min: 100000, max: 125000, rate: 0.05 }, { min: 125000, max: 150000, rate: 0.0525 }, { min: 150000, max: 250000, rate: 0.055 }, { min: 250000, max: Infinity, rate: 0.0575 }] },
  { name: 'Massachusetts', abbr: 'MA', hasIncomeTax: true, flatRate: 0.05 },
  { name: 'Michigan', abbr: 'MI', hasIncomeTax: true, flatRate: 0.0425 },
  { name: 'Minnesota', abbr: 'MN', hasIncomeTax: true, brackets: [{ min: 0, max: 30070, rate: 0.0535 }, { min: 30070, max: 98760, rate: 0.068 }, { min: 98760, max: 183340, rate: 0.0785 }, { min: 183340, max: Infinity, rate: 0.0985 }] },
  { name: 'Mississippi', abbr: 'MS', hasIncomeTax: true, brackets: [{ min: 0, max: 10000, rate: 0.0 }, { min: 10000, max: Infinity, rate: 0.047 }] },
  { name: 'Missouri', abbr: 'MO', hasIncomeTax: true, flatRate: 0.048 },
  { name: 'Montana', abbr: 'MT', hasIncomeTax: true, brackets: [{ min: 0, max: 20500, rate: 0.047 }, { min: 20500, max: Infinity, rate: 0.059 }] },
  { name: 'Nebraska', abbr: 'NE', hasIncomeTax: true, brackets: [{ min: 0, max: 3700, rate: 0.0246 }, { min: 3700, max: 22170, rate: 0.0351 }, { min: 22170, max: 35730, rate: 0.0501 }, { min: 35730, max: Infinity, rate: 0.0584 }] },
  { name: 'Nevada', abbr: 'NV', hasIncomeTax: false },
  { name: 'New Hampshire', abbr: 'NH', hasIncomeTax: false },
  { name: 'New Jersey', abbr: 'NJ', hasIncomeTax: true, brackets: [{ min: 0, max: 20000, rate: 0.014 }, { min: 20000, max: 35000, rate: 0.0175 }, { min: 35000, max: 40000, rate: 0.035 }, { min: 40000, max: 75000, rate: 0.05525 }, { min: 75000, max: 500000, rate: 0.0637 }, { min: 500000, max: 1000000, rate: 0.0897 }, { min: 1000000, max: Infinity, rate: 0.1075 }] },
  { name: 'New Mexico', abbr: 'NM', hasIncomeTax: true, brackets: [{ min: 0, max: 5500, rate: 0.017 }, { min: 5500, max: 11000, rate: 0.032 }, { min: 11000, max: 16000, rate: 0.047 }, { min: 16000, max: 210000, rate: 0.049 }, { min: 210000, max: Infinity, rate: 0.059 }] },
  { name: 'New York', abbr: 'NY', hasIncomeTax: true, brackets: [{ min: 0, max: 8500, rate: 0.04 }, { min: 8500, max: 11700, rate: 0.045 }, { min: 11700, max: 13900, rate: 0.0525 }, { min: 13900, max: 80650, rate: 0.0585 }, { min: 80650, max: 215400, rate: 0.0625 }, { min: 215400, max: 1077550, rate: 0.0685 }, { min: 1077550, max: 5000000, rate: 0.0965 }, { min: 5000000, max: 25000000, rate: 0.103 }, { min: 25000000, max: Infinity, rate: 0.109 }] },
  { name: 'North Carolina', abbr: 'NC', hasIncomeTax: true, flatRate: 0.045 },
  { name: 'North Dakota', abbr: 'ND', hasIncomeTax: true, flatRate: 0.0195 },
  { name: 'Ohio', abbr: 'OH', hasIncomeTax: true, brackets: [{ min: 0, max: 26050, rate: 0.0 }, { min: 26050, max: 100000, rate: 0.0275 }, { min: 100000, max: Infinity, rate: 0.035 }] },
  { name: 'Oklahoma', abbr: 'OK', hasIncomeTax: true, brackets: [{ min: 0, max: 1000, rate: 0.0025 }, { min: 1000, max: 2500, rate: 0.0075 }, { min: 2500, max: 3750, rate: 0.0175 }, { min: 3750, max: 4900, rate: 0.0275 }, { min: 4900, max: 7200, rate: 0.0375 }, { min: 7200, max: Infinity, rate: 0.0475 }] },
  { name: 'Oregon', abbr: 'OR', hasIncomeTax: true, brackets: [{ min: 0, max: 4050, rate: 0.0475 }, { min: 4050, max: 10200, rate: 0.0675 }, { min: 10200, max: 125000, rate: 0.0875 }, { min: 125000, max: Infinity, rate: 0.099 }] },
  { name: 'Pennsylvania', abbr: 'PA', hasIncomeTax: true, flatRate: 0.0307 },
  { name: 'Rhode Island', abbr: 'RI', hasIncomeTax: true, brackets: [{ min: 0, max: 73450, rate: 0.0375 }, { min: 73450, max: 166950, rate: 0.0475 }, { min: 166950, max: Infinity, rate: 0.0599 }] },
  { name: 'South Carolina', abbr: 'SC', hasIncomeTax: true, brackets: [{ min: 0, max: 3460, rate: 0.0 }, { min: 3460, max: 17330, rate: 0.03 }, { min: 17330, max: Infinity, rate: 0.064 }] },
  { name: 'South Dakota', abbr: 'SD', hasIncomeTax: false },
  { name: 'Tennessee', abbr: 'TN', hasIncomeTax: false },
  { name: 'Texas', abbr: 'TX', hasIncomeTax: false },
  { name: 'Utah', abbr: 'UT', hasIncomeTax: true, flatRate: 0.0465 },
  { name: 'Vermont', abbr: 'VT', hasIncomeTax: true, brackets: [{ min: 0, max: 45400, rate: 0.0335 }, { min: 45400, max: 110050, rate: 0.066 }, { min: 110050, max: 229550, rate: 0.076 }, { min: 229550, max: Infinity, rate: 0.0875 }] },
  { name: 'Virginia', abbr: 'VA', hasIncomeTax: true, brackets: [{ min: 0, max: 3000, rate: 0.02 }, { min: 3000, max: 5000, rate: 0.03 }, { min: 5000, max: 17000, rate: 0.05 }, { min: 17000, max: Infinity, rate: 0.0575 }] },
  { name: 'Washington', abbr: 'WA', hasIncomeTax: false },
  { name: 'West Virginia', abbr: 'WV', hasIncomeTax: true, brackets: [{ min: 0, max: 10000, rate: 0.0236 }, { min: 10000, max: 25000, rate: 0.0315 }, { min: 25000, max: 40000, rate: 0.0354 }, { min: 40000, max: 60000, rate: 0.0472 }, { min: 60000, max: Infinity, rate: 0.0512 }] },
  { name: 'Wisconsin', abbr: 'WI', hasIncomeTax: true, brackets: [{ min: 0, max: 14320, rate: 0.035 }, { min: 14320, max: 28640, rate: 0.044 }, { min: 28640, max: 315310, rate: 0.053 }, { min: 315310, max: Infinity, rate: 0.0765 }] },
  { name: 'Wyoming', abbr: 'WY', hasIncomeTax: false },
  { name: 'District of Columbia', abbr: 'DC', hasIncomeTax: true, brackets: [{ min: 0, max: 10000, rate: 0.04 }, { min: 10000, max: 40000, rate: 0.06 }, { min: 40000, max: 60000, rate: 0.065 }, { min: 60000, max: 250000, rate: 0.085 }, { min: 250000, max: 500000, rate: 0.0925 }, { min: 500000, max: 1000000, rate: 0.0975 }, { min: 1000000, max: Infinity, rate: 0.1075 }] },
];

export function estimateStateTax(annualGross: number, stateAbbr: string): number {
  const state = STATES.find(s => s.abbr === stateAbbr);
  if (!state || !state.hasIncomeTax) return 0;

  if (state.flatRate !== undefined) {
    return annualGross * state.flatRate;
  }

  if (state.brackets) {
    let tax = 0;
    for (const b of state.brackets) {
      if (annualGross <= b.min) break;
      const taxable = Math.min(annualGross, b.max) - b.min;
      tax += taxable * b.rate;
    }
    return tax;
  }

  return 0;
}
