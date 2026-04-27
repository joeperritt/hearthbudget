import { useEffect, useMemo, useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Sparkles, Loader2, ArrowLeft } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { BudgetCategory } from "@/types/budget";

const LOADING_MESSAGES = [
  "Pulling your transaction history…",
  "Comparing spending to your take-home pay…",
  "Checking against CFP guideline percentages…",
  "Building your suggested targets…",
];

interface AnalyzeResult {
  monthly_take_home: number;
  months_observed: number;
  lookback_days: number;
  transaction_count: number;
  categories: Array<{
    slug: string;
    name: string;
    group: string;
    current_budget: number;
    actual_monthly_avg: number;
    suggested: number;
    commentary: string;
  }>;
  overall_summary: string;
  stewardship_mode: boolean;
}

interface SpendingAnalyzerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  categories: BudgetCategory[];
  onApply: (updated: BudgetCategory[]) => Promise<void> | void;
  stewardshipMode?: boolean;
}

function fmt(n: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 }).format(n);
}

function pct(n: number, denom: number): string {
  if (!denom) return "";
  return `${Math.round((n / denom) * 100)}%`;
}

export function SpendingAnalyzer({
  open,
  onOpenChange,
  categories,
  onApply,
  stewardshipMode = true,
}: SpendingAnalyzerProps) {
  const [phase, setPhase] = useState<"intake" | "loading" | "results">("intake");
  const [loadingIdx, setLoadingIdx] = useState(0);
  const [result, setResult] = useState<AnalyzeResult | null>(null);
  const [income, setIncome] = useState<string>("");
  // Per-row choice: "suggested" or "actual"
  const [choices, setChoices] = useState<Record<string, "suggested" | "actual">>({});
  const [applying, setApplying] = useState(false);

  // Reset on open
  useEffect(() => {
    if (open) {
      setPhase("intake");
      setResult(null);
      setChoices({});
      setIncome("");
    }
  }, [open]);

  // Rotate loading messages every 1.6s
  useEffect(() => {
    if (phase !== "loading") return;
    const t = setInterval(() => {
      setLoadingIdx(i => (i + 1) % LOADING_MESSAGES.length);
    }, 1600);
    return () => clearInterval(t);
  }, [phase]);

  const incomeNum = Number(income);
  const incomeValid = Number.isFinite(incomeNum) && incomeNum > 0;

  const runAnalysis = async () => {
    if (!incomeValid) {
      toast({ title: "Enter your monthly take-home pay first.", variant: "destructive" });
      return;
    }
    setPhase("loading");
    setLoadingIdx(0);
    try {
      const { data, error } = await supabase.functions.invoke("analyze-spending", {
        body: { stewardshipMode, lookbackDays: 90, monthlyIncome: incomeNum },
      });
      if (error) throw error;
      const r = data as AnalyzeResult & { error?: string; message?: string };
      if (r.error) {
        toast({
          title: r.error === "insufficient_history" ? "Not enough data yet" : "Couldn't analyze",
          description: r.message || "Try again in a moment.",
          variant: "destructive",
        });
        setPhase("intake");
        return;
      }
      setResult(r);
      // Default each row to Suggested if delta > 5%, else Actual
      const next: Record<string, "suggested" | "actual"> = {};
      for (const row of r.categories) {
        const base = Math.max(row.actual_monthly_avg, 1);
        const delta = Math.abs(row.suggested - row.actual_monthly_avg) / base;
        next[row.slug] = delta > 0.05 ? "suggested" : "actual";
      }
      setChoices(next);
      setPhase("results");
    } catch (e) {
      console.error(e);
      toast({
        title: "Analysis failed",
        description: e instanceof Error ? e.message : "Try again in a moment.",
        variant: "destructive",
      });
      setPhase("intake");
    }
  };

  const totalBudget = useMemo(() => {
    if (!result) return 0;
    return result.categories.reduce((s, row) => {
      const choice = choices[row.slug] ?? "suggested";
      const v = choice === "suggested" ? row.suggested : row.actual_monthly_avg;
      return s + (Number.isFinite(v) ? v : 0);
    }, 0);
  }, [result, choices]);

  const apply = async () => {
    if (!result) return;
    setApplying(true);
    try {
      const byId = new Map(categories.map(c => [c.id, c]));
      const updated = categories.map(c => {
        const row = result.categories.find(r => r.slug === c.id);
        if (!row) return c;
        const choice = choices[c.id] ?? "suggested";
        const v = choice === "suggested" ? row.suggested : row.actual_monthly_avg;
        return { ...byId.get(c.id)!, budgeted: Math.round(v * 100) / 100 };
      });
      await onApply(updated);
      toast({ title: "Budget updated", description: "Your category targets have been saved." });
      onOpenChange(false);
    } catch (e) {
      toast({
        title: "Couldn't save",
        description: e instanceof Error ? e.message : "Try again.",
        variant: "destructive",
      });
    } finally {
      setApplying(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="h-[92vh] overflow-y-auto p-0">
        <SheetHeader className="px-5 pt-5 pb-3 border-b border-border">
          <SheetTitle className="font-display text-xl flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-amber-500" />
            Analyze My Spending
          </SheetTitle>
        </SheetHeader>

        {phase === "intake" && (
          <div className="px-5 py-8 space-y-6 max-w-md mx-auto">
            <p className="text-sm text-muted-foreground text-center">
              We'll review your last 90 days of transactions and suggest realistic
              monthly targets, comparing your spending to Certified Financial
              Planner (CFP) guideline percentages
              {stewardshipMode ? " informed by stewardship principles" : ""}.
            </p>

            <div className="space-y-2">
              <label htmlFor="take-home" className="text-sm font-medium text-foreground block">
                What's your monthly take-home pay?
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-base">$</span>
                <input
                  id="take-home"
                  type="text"
                  inputMode="decimal"
                  value={income}
                  onChange={e => setIncome(e.target.value.replace(/[^0-9.]/g, ""))}
                  placeholder="10,000"
                  autoFocus
                  className="w-full pl-7 pr-3 py-3 text-lg font-semibold tabular-nums bg-card border border-border rounded-xl outline-none focus:border-amber-400 focus:ring-1 focus:ring-amber-400 transition"
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Use what actually lands in your accounts each month after taxes,
                health insurance, and retirement contributions.
              </p>
            </div>

            <p className="text-xs text-muted-foreground text-center">
              Your manual category assignments and ignored transactions are respected.
              Nothing is changed until you review and apply.
            </p>

            <Button onClick={runAnalysis} disabled={!incomeValid} className="w-full">
              <Sparkles className="w-4 h-4 mr-2" />
              Analyze my spending
            </Button>
          </div>
        )}

        {phase === "loading" && (
          <div className="px-5 py-16 flex flex-col items-center gap-4">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground transition-opacity">
              {LOADING_MESSAGES[loadingIdx]}
            </p>
          </div>
        )}

        {phase === "results" && result && (
          <div className="pb-32">
            {/* Income header */}
            <div className="px-5 py-4 bg-card border-b border-border">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm text-muted-foreground">Monthly take-home</div>
                <div className="text-base font-semibold tabular-nums text-foreground">
                  {fmt(result.monthly_take_home)}
                </div>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Based on {result.transaction_count} transactions across {result.months_observed} months.
              </p>
            </div>

            {/* Per-category rows */}
            <div className="px-5 py-3 space-y-3">
              {result.categories.map(row => {
                const choice = choices[row.slug] ?? "suggested";
                const actualPct = pct(row.actual_monthly_avg, result.monthly_take_home);
                const suggestedPct = pct(row.suggested, result.monthly_take_home);
                return (
                  <div key={row.slug} className="bg-card rounded-xl border border-border p-3">
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <div className="font-semibold text-sm text-foreground">{row.name}</div>
                      <div className="flex rounded-full bg-muted p-0.5 text-xs">
                        <button
                          onClick={() => setChoices(c => ({ ...c, [row.slug]: "actual" }))}
                          className={`px-2.5 py-1 rounded-full transition-colors ${
                            choice === "actual" ? "bg-background shadow-sm font-medium text-foreground" : "text-muted-foreground"
                          }`}
                        >
                          Actual
                        </button>
                        <button
                          onClick={() => setChoices(c => ({ ...c, [row.slug]: "suggested" }))}
                          className={`px-2.5 py-1 rounded-full transition-colors ${
                            choice === "suggested" ? "bg-background shadow-sm font-medium text-foreground" : "text-muted-foreground"
                          }`}
                        >
                          Suggested
                        </button>
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-xs mb-2">
                      <div>
                        <div className="text-muted-foreground">Now</div>
                        <div className="font-medium tabular-nums">{fmt(row.current_budget)}</div>
                      </div>
                      <div>
                        <div className="text-muted-foreground">Actual avg</div>
                        <div className="font-medium tabular-nums">
                          {fmt(row.actual_monthly_avg)}
                          {actualPct && <span className="text-muted-foreground font-normal ml-1">({actualPct})</span>}
                        </div>
                      </div>
                      <div>
                        <div className="text-muted-foreground">Suggested</div>
                        <div className="font-medium tabular-nums text-amber-700 dark:text-amber-400">
                          {fmt(row.suggested)}
                          {suggestedPct && <span className="text-amber-700/70 dark:text-amber-400/70 font-normal ml-1">({suggestedPct})</span>}
                        </div>
                      </div>
                    </div>
                    {row.commentary && (
                      <p className="text-xs italic text-muted-foreground leading-snug">
                        {row.commentary}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Overall summary */}
            {result.overall_summary && (
              <div className={`mx-5 my-4 p-4 rounded-xl border ${
                result.stewardship_mode
                  ? "bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-900"
                  : "bg-muted border-border"
              }`}>
                <p className="text-sm leading-relaxed text-foreground">
                  {result.overall_summary}
                </p>
              </div>
            )}

            {/* Sticky footer with totals + apply */}
            <div className="fixed bottom-0 left-0 right-0 bg-background/95 backdrop-blur border-t border-border px-5 py-3 flex items-center justify-between gap-3">
              <div className="text-xs">
                <div className="text-muted-foreground">Selected total</div>
                <div className="font-semibold tabular-nums text-foreground">
                  {fmt(totalBudget)}
                  <span className="text-muted-foreground font-normal ml-1">
                    ({pct(totalBudget, result.monthly_take_home)})
                  </span>
                </div>
              </div>
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" onClick={() => setPhase("intake")}>
                  <ArrowLeft className="w-4 h-4 mr-1" /> Back
                </Button>
                <Button onClick={apply} disabled={applying}>
                  {applying ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Sparkles className="w-4 h-4 mr-1" />}
                  Apply to my budget
                </Button>
              </div>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
