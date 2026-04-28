import { useEffect, useMemo, useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Sparkles, Loader2, Info, ArrowRight } from "lucide-react";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

const LOADING_MESSAGES = [
  "Reading your category-to-bucket mappings…",
  "Summing planned amounts per bucket…",
  "Comparing each bucket to its CFP guideline…",
  "Generating commentary and reallocation ideas…",
];

interface BucketMember {
  slug: string;
  name: string;
  amount: number;
}

interface BucketResult {
  key: string;
  label: string;
  guideline_pct: number;
  guideline_kind: "max" | "min" | "target";
  guideline_source: string;
  role: "variable" | "fixed";
  bucket_actual_monthly_avg: number;
  bucket_pct_of_income: number;
  member_descriptions: string[];
  members: BucketMember[];
  verdict: "under" | "in_line" | "over";
  suggested_bucket_total: number;
  commentary: string;
}

interface AnalyzeResult {
  monthly_take_home: number;
  months_observed: number;
  lookback_days: number;
  transaction_count: number;
  buckets: BucketResult[];
  reallocation_hints: Array<{ from_bucket: string; to_bucket: string; amount: number; rationale: string }>;
  overall_summary: string;
  stewardship_mode: boolean;
  diagnostics?: {
    total_categories: number;
    mapped_categories: number;
  };
}

interface SpendingAnalyzerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  stewardshipMode?: boolean;
  defaultIncome?: number;
}

function fmt(n: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD", minimumFractionDigits: 2,
  }).format(n || 0);
}

function verdictPill(v: BucketResult["verdict"]) {
  if (v === "over") return { text: "Over guideline", cls: "bg-rose-100 text-rose-800 dark:bg-rose-950/40 dark:text-rose-200" };
  if (v === "under") return { text: "Under guideline", cls: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200" };
  return { text: "In line", cls: "bg-muted text-muted-foreground" };
}

export function SpendingAnalyzer({
  open, onOpenChange, stewardshipMode = true, defaultIncome,
}: SpendingAnalyzerProps) {
  const [phase, setPhase] = useState<"intake" | "loading" | "results">("intake");
  const [loadingIdx, setLoadingIdx] = useState(0);
  const [result, setResult] = useState<AnalyzeResult | null>(null);
  const [income, setIncome] = useState("");

  useEffect(() => {
    if (open) {
      setPhase("intake");
      setResult(null);
      setIncome(defaultIncome && defaultIncome > 0 ? String(defaultIncome) : "");
    }
  }, [open, defaultIncome]);

  useEffect(() => {
    if (phase !== "loading") return;
    const t = setInterval(() => setLoadingIdx(i => (i + 1) % LOADING_MESSAGES.length), 1800);
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
      // supabase-js wraps non-2xx responses in FunctionsHttpError. Try to read
      // the JSON body from the underlying response so the user sees the
      // server's actual message.
      if (error) {
        let serverMsg: string | undefined;
        const ctx = (error as { context?: Response }).context;
        if (ctx && typeof ctx.json === "function") {
          try {
            const body = await ctx.json();
            serverMsg = body?.message || body?.error;
          } catch { /* ignore */ }
        }
        toast({
          title: "Couldn't analyze",
          description: serverMsg || error.message || "Try again in a moment.",
          variant: "destructive",
        });
        setPhase("intake");
        return;
      }
      const r = data as AnalyzeResult & { error?: string; message?: string };
      if (r.error) {
        toast({
          title: "Couldn't analyze",
          description: r.message || "Try again in a moment.",
          variant: "destructive",
        });
        setPhase("intake");
        return;
      }
      setResult(r);
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

  const bucketLabelByKey = useMemo(() => {
    const m: Record<string, string> = {};
    if (result) for (const b of result.buckets) m[b.key] = b.label;
    return m;
  }, [result]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="h-[92vh] overflow-y-auto p-0">
        <SheetHeader className="px-5 pt-5 pb-3 border-b border-border">
          <SheetTitle className="font-display text-xl flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-amber-500" />
            Analyze My Budget
          </SheetTitle>
        </SheetHeader>

        {phase === "intake" && (
          <div className="px-5 py-8 space-y-6 max-w-md mx-auto">
            <p className="text-sm text-muted-foreground text-center">
              We'll roll your last 90 days of spending into your mapped Certified Financial
              Planner (CFP) buckets and compare each one to its guideline percentage
              {stewardshipMode ? ", informed by stewardship principles" : ""}.
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

            <div className="rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">How this works: </span>
              We use the CFP-bucket mappings you set on your categories. Categories
              that aren't mapped won't show up in the variable-spending rollup
              (they'll just be missing from the percentages).
            </div>

            <Button onClick={runAnalysis} disabled={!incomeValid} className="w-full">
              <Sparkles className="w-4 h-4 mr-2" />
              Run analysis
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
          <div className="pb-24">
            {/* Income header */}
            <div className="px-5 py-4 bg-card border-b border-border">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm text-muted-foreground">Monthly take-home</div>
                <div className="text-base font-semibold tabular-nums text-foreground">
                  {fmt(result.monthly_take_home)}
                </div>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Based on {result.transaction_count} transactions across {result.months_observed} months,
                rolled up using your category-to-bucket mappings.
                {result.diagnostics && result.diagnostics.mapped_categories < result.diagnostics.total_categories && (
                  <> {result.diagnostics.total_categories - result.diagnostics.mapped_categories} unmapped category
                    {result.diagnostics.total_categories - result.diagnostics.mapped_categories === 1 ? "" : "s"} were skipped.</>
                )}
              </p>
            </div>

            {/* Unbudgeted callout — surfaces unassigned take-home as the #1 plan gap */}
            {(() => {
              const ub = result.buckets.find(b => b.key === "unbudgeted");
              if (!ub || ub.bucket_actual_monthly_avg < 1) return null;
              return (
                <div className="mx-5 mt-4">
                  <div className="rounded-xl border-2 border-amber-400 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-700 p-4">
                    <div className="flex items-start justify-between gap-3 mb-1">
                      <div className="min-w-0">
                        <div className="text-xs font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">
                          Plan gap
                        </div>
                        <div className="font-semibold text-base text-foreground mt-0.5">
                          {fmt(ub.bucket_actual_monthly_avg)} unbudgeted
                          <span className="text-xs font-normal text-muted-foreground ml-1.5 tabular-nums">
                            ({ub.bucket_pct_of_income}% of take-home)
                          </span>
                        </div>
                      </div>
                      <span className="text-[11px] px-2 py-0.5 rounded-full whitespace-nowrap bg-amber-200 text-amber-900 dark:bg-amber-900/50 dark:text-amber-100">
                        Assign this
                      </span>
                    </div>
                    <p className="text-xs text-amber-900/90 dark:text-amber-100/90 leading-snug">
                      Unassigned money is the #1 thing CFP planners push on — without a job, it tends to disappear into discretionary spending. Give every dollar a category to close the gap.
                    </p>
                  </div>
                </div>
              );
            })()}

            {/* Variable bucket cards */}
            <div className="px-5 pt-4 pb-1">
              <div className="text-xs uppercase tracking-wide text-muted-foreground font-semibold">
                Variable spending
              </div>
            </div>
            <div className="px-5 py-2 space-y-3">
              {result.buckets.filter(b => b.role === "variable").map(b => {
                const pill = verdictPill(b.verdict);
                const guidelineLabel = b.guideline_kind === "max"
                  ? `≤ ${b.guideline_pct}%`
                  : b.guideline_kind === "min" ? `≥ ${b.guideline_pct}%`
                  : `~ ${b.guideline_pct}%`;
                return (
                  <div key={b.key} className="bg-card rounded-xl border border-border overflow-hidden">
                    <div className="p-3">
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <div>
                          <div className="font-semibold text-sm text-foreground">{b.label}</div>
                          <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1.5 flex-wrap">
                            <span className="tabular-nums">
                              {fmt(b.bucket_actual_monthly_avg)} ({b.bucket_pct_of_income}% of take-home)
                            </span>
                            <span>·</span>
                            <span className="flex items-center gap-1">
                              Guideline {guidelineLabel}
                              <Popover>
                                <PopoverTrigger asChild>
                                  <button
                                    type="button"
                                    aria-label="Where does this guideline come from?"
                                    className="text-muted-foreground hover:text-foreground"
                                  >
                                    <Info className="w-3 h-3" />
                                  </button>
                                </PopoverTrigger>
                                <PopoverContent className="w-72 text-xs leading-relaxed" side="top">
                                  {b.guideline_source}
                                </PopoverContent>
                              </Popover>
                            </span>
                          </div>
                        </div>
                        <span className={`text-xs px-2 py-0.5 rounded-full whitespace-nowrap ${pill.cls}`}>
                          {pill.text}
                        </span>
                      </div>

                      {b.commentary && (
                        <p className="text-xs italic text-muted-foreground leading-snug mb-2">
                          {b.commentary}
                        </p>
                      )}

                      <div className="flex items-center justify-between gap-2 bg-muted/50 rounded-lg p-2.5">
                        <span className="text-xs text-muted-foreground">Suggested target</span>
                        <span className="text-sm font-semibold tabular-nums text-foreground">
                          {fmt(b.suggested_bucket_total)}
                        </span>
                      </div>

                      {b.members.length > 0 && (
                        <div className="mt-2 text-[11px] text-muted-foreground">
                          From: {b.members.slice(0, 4).map(m => m.name).join(" · ")}
                          {b.members.length > 4 ? ` +${b.members.length - 4} more` : ""}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Fixed buckets — informational */}
            {result.buckets.some(b => b.role === "fixed" && b.key !== "unbudgeted") && (
              <>
                <div className="px-5 pt-5 pb-1">
                  <div className="text-xs uppercase tracking-wide text-muted-foreground font-semibold">
                    Fixed structure
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-1">
                    From your fixed expenses and any categories you mapped to fixed buckets. Shown so the framework adds up to your take-home pay.
                  </p>
                </div>
                <div className="px-5 py-2 space-y-2">
                  {result.buckets.filter(b => b.role === "fixed" && b.key !== "unbudgeted").map(b => {
                    const pill = verdictPill(b.verdict);
                    const guidelineLabel = b.guideline_kind === "max"
                      ? `≤ ${b.guideline_pct}%`
                      : b.guideline_kind === "min" ? `≥ ${b.guideline_pct}%`
                      : `~ ${b.guideline_pct}%`;
                    return (
                      <div key={b.key} className="bg-muted/40 rounded-lg border border-border p-2.5">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="text-sm font-medium text-foreground">{b.label}</div>
                            <div className="text-[11px] text-muted-foreground mt-0.5 flex items-center gap-1 flex-wrap">
                              <span className="tabular-nums">
                                {fmt(b.bucket_actual_monthly_avg)} ({b.bucket_pct_of_income}% of take-home)
                              </span>
                              <span>·</span>
                              <span className="flex items-center gap-1">
                                Guideline {guidelineLabel}
                                <Popover>
                                  <PopoverTrigger asChild>
                                    <button
                                      type="button"
                                      aria-label="Where does this guideline come from?"
                                      className="text-muted-foreground hover:text-foreground"
                                    >
                                      <Info className="w-3 h-3" />
                                    </button>
                                  </PopoverTrigger>
                                  <PopoverContent className="w-72 text-xs leading-relaxed" side="top">
                                    {b.guideline_source}
                                  </PopoverContent>
                                </Popover>
                              </span>
                            </div>
                            {b.member_descriptions.length > 0 && (
                              <div className="text-[11px] text-muted-foreground/80 mt-1 truncate">
                                {b.member_descriptions.slice(0, 4).join(" · ")}
                                {b.member_descriptions.length > 4 ? ` +${b.member_descriptions.length - 4} more` : ""}
                              </div>
                            )}
                          </div>
                          <span className={`text-[11px] px-2 py-0.5 rounded-full whitespace-nowrap ${pill.cls}`}>
                            {pill.text}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}

            {/* Reallocation hints */}
            {result.reallocation_hints.length > 0 && (
              <div className="mx-5 my-4 p-4 rounded-xl border border-border bg-card">
                <div className="text-sm font-semibold text-foreground mb-2 flex items-center gap-1.5">
                  <ArrowRight className="w-4 h-4 text-amber-500" />
                  Reallocation ideas
                </div>
                <ul className="space-y-2">
                  {result.reallocation_hints.map((h, i) => (
                    <li key={i} className="text-xs leading-relaxed">
                      <span className="font-medium text-foreground">
                        {bucketLabelByKey[h.from_bucket] || h.from_bucket}
                      </span>
                      <ArrowRight className="inline w-3 h-3 mx-1 text-muted-foreground" />
                      <span className="font-medium text-foreground">
                        {bucketLabelByKey[h.to_bucket] || h.to_bucket}
                      </span>
                      <span className="text-amber-700 dark:text-amber-400 tabular-nums ml-1">
                        ({fmt(h.amount)})
                      </span>
                      {h.rationale && (
                        <div className="text-muted-foreground mt-0.5">{h.rationale}</div>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}

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

            {/* Sticky footer */}
            <div className="fixed bottom-0 left-0 right-0 bg-background/95 backdrop-blur border-t border-border px-5 py-3 flex items-center justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setPhase("intake")}>
                <ArrowLeft className="w-4 h-4 mr-1" /> Back
              </Button>
              <Button size="sm" onClick={() => onOpenChange(false)}>
                Done
              </Button>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
