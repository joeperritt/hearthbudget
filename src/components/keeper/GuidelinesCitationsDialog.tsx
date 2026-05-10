import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Info } from "lucide-react";

const ROWS: { category: string; guideline: string; source: string }[] = [
  { category: "Giving", guideline: "10%", source: "Ron Blue, Master Your Money (2004); Howard Dayton, Your Money Counts (1996)" },
  { category: "Saving", guideline: "15%", source: "Fidelity Investments, How Much Should I Save? (2024); CFP Board Financial Planning Competency Handbook" },
  { category: "Housing", guideline: "33%", source: "FHA lending guidelines (28% front-end ratio); CFP Board housing affordability guidance" },
  { category: "Transportation", guideline: "10%", source: "U.S. Bureau of Labor Statistics, Consumer Expenditure Survey (2023)" },
  { category: "Groceries", guideline: "12%", source: "USDA Thrifty Food Plan (2023); BLS Consumer Expenditure Survey (2023)" },
  { category: "Eating Out", guideline: "5%", source: "U.S. Bureau of Labor Statistics, Consumer Expenditure Survey (2023)" },
  { category: "Lifestyle", guideline: "12%", source: "U.S. Bureau of Labor Statistics, Consumer Expenditure Survey (2023)" },
  { category: "Kids", guideline: "10%", source: "USDA, Expenditures on Children by Families (2017, most recent full report); BLS Consumer Expenditure Survey (2023)" },
  { category: "Pets", guideline: "2%", source: "U.S. Bureau of Labor Statistics, Consumer Expenditure Survey (2023)" },
  { category: "Non-Housing Debt", guideline: "15%", source: "FHA total debt-to-income guideline (36%); CFP Board debt management guidance" },
  { category: "Medical", guideline: "5%", source: "U.S. Bureau of Labor Statistics, Consumer Expenditure Survey (2023)" },
  { category: "Travel", guideline: "5%", source: "U.S. Bureau of Labor Statistics, Consumer Expenditure Survey (2023)" },
  { category: "Insurance", guideline: "3%", source: "Kingdom Advisors stewardship framework; CFP Board risk management guidance" },
];

interface Props {
  /** Optional custom trigger. Defaults to a small inline info icon button. */
  trigger?: React.ReactNode;
  ariaLabel?: string;
}

export function GuidelinesCitationsDialog({ trigger, ariaLabel = "About these guidelines" }: Props) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        {trigger ?? (
          <button
            type="button"
            aria-label={ariaLabel}
            className="inline-flex items-center justify-center text-muted-foreground hover:text-foreground"
          >
            <Info className="w-3.5 h-3.5" />
          </button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display">About these guidelines</DialogTitle>
        </DialogHeader>

        <div className="mt-2 border border-border rounded-lg overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left font-semibold px-2.5 py-2">Category</th>
                <th className="text-left font-semibold px-2.5 py-2 w-16">Guideline</th>
                <th className="text-left font-semibold px-2.5 py-2">Source</th>
              </tr>
            </thead>
            <tbody>
              {ROWS.map((r) => (
                <tr key={r.category} className="border-t border-border align-top">
                  <td className="px-2.5 py-2 font-medium text-foreground whitespace-nowrap">{r.category}</td>
                  <td className="px-2.5 py-2 tabular-nums text-foreground">{r.guideline}</td>
                  <td className="px-2.5 py-2 text-muted-foreground leading-snug">{r.source}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="text-[11px] text-muted-foreground leading-relaxed mt-3">
          These are recommended maximums per category, not a rigid budget that sums to 100%.
          When Stewardship Mode is off or a category does not apply to your household, unused
          allowances simply give you more flexibility elsewhere. There is no automatic reallocation.
        </p>
      </DialogContent>
    </Dialog>
  );
}
