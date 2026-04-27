import { useEffect, useMemo, useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Sparkles, Loader2, ArrowLeft, ChevronDown, ChevronRight, Info, ArrowRight, AlertCircle } from "lucide-react";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { BudgetCategory } from "@/types/budget";

const LOADING_MESSAGES = [
  "Pulling your transaction history…",
  "Rolling categories into CFP buckets…",
  "Comparing each bucket to its guideline %…",
  "Looking for reallocation opportunities…",
  "Building your suggested targets…",
];

interface MemberCategory {
  slug: string;
  name: string;
  group: string;
  current_budget: number;
  actual_monthly_avg: number;
}

interface BucketResult {
  key: string;
  label: string;
  guideline_pct: number;
  guideline_kind: "max" | "min" | "target";
  guideline_source: string;
  role: "variable" | "fixed";
  member_categories: MemberCategory[];
  bucket_current_budget: number;
  bucket_actual_monthly_avg: number;
  bucket_pct_of_income: number;
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
  unmatched_categories: MemberCategory[];
  reallocation_hints: Array<{ from_bucket: string; to_bucket: string; amount: number; rationale: string }>;
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
  return new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD", minimumFractionDigits: 2,
  }).format(n || 0);
}

function pct(n: number, denom: number): string {
  if (!denom) return "";
  return `${Math.round((n / denom) * 100)}%`;
}

function verdictPill(v: BucketResult["verdict"]) {
  if (v === "over") return { text: "Over guideline", cls: "bg-rose-100 text-rose-800 dark:bg-rose-950/40 dark:text-rose-200" };
  if (v === "under") return { text: "Under guideline", cls: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200" };
  return { text: "In line", cls: "bg-muted text-muted-foreground" };
}

export function SpendingAnalyzer({
  open, onOpenChange, categories, onApply, stewardshipMode = true,
}: SpendingAnalyzerProps) {
  const [phase, setPhase] = useState<"intake" | "loading" | "results">("intake");
  const [loadingIdx, setLoadingIdx] = useState(0);
  const [result, setResult] = useState<AnalyzeResult | null>(null);
  const [income, setIncome] = useState("");
  const [applying, setApplying] = useState(false);

  // Per-bucket: target total chosen by user (defaults to AI suggested)
  const [bucketTargets, setBucketTargets] = useState<Record<string, number>>({});
  // Per-member: dollar amount user has split out of bucket total. Default proportional to actual.
  const [memberAmounts, setMemberAmounts] = useState<Record<string, number>>({});
  const [expandedBuckets, setExpandedBuckets] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (open) {
      setPhase("intake");
      setResult(null);
      setBucketTargets({});
      setMemberAmounts({});
      setExpandedBuckets({});
      setIncome("");
    }
  }, [open]);

  useEffect(() => {
    if (phase !== "loading") return;
    const t = setInterval(() => setLoadingIdx(i => (i + 1) % LOADING_MESSAGES.length), 1600);
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
      // Seed per-bucket target = AI suggestion (variable only — fixed buckets
      // are informational and not editable here).
      const targets: Record<string, number> = {};
      const members: Record<string, number> = {};
      for (const b of r.buckets) {
        if (b.role !== "variable") continue;
        targets[b.key] = b.suggested_bucket_total;
        const actualSum = b.member_categories.reduce((s, m) => s + m.actual_monthly_avg, 0);
        for (const m of b.member_categories) {
          const share = actualSum > 0
            ? (m.actual_monthly_avg / actualSum) * b.suggested_bucket_total
            : b.suggested_bucket_total / Math.max(b.member_categories.length, 1);
          members[m.slug] = Math.round(share * 100) / 100;
        }
      }
      setBucketTargets(targets);
      setMemberAmounts(members);
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

  // When user changes a bucket total, redistribute proportionally based on current member shares.
  const updateBucketTarget = (bucket: BucketResult, newTotal: number) => {
    setBucketTargets(t => ({ ...t, [bucket.key]: newTotal }));
    setMemberAmounts(prev => {
      const next = { ...prev };
      const currentSum = bucket.member_categories.reduce((s, m) => s + (prev[m.slug] || 0), 0);
      if (currentSum > 0) {
        for (const m of bucket.member_categories) {
          const share = (prev[m.slug] || 0) / currentSum;
          next[m.slug] = Math.round(share * newTotal * 100) / 100;
        }
      } else {
        const equal = newTotal / Math.max(bucket.member_categories.length, 1);
        for (const m of bucket.member_categories) next[m.slug] = Math.round(equal * 100) / 100;
      }
      return next;
    });
  };

  const updateMemberAmount = (slug: string, val: number) => {
    setMemberAmounts(m => ({ ...m, [slug]: val }));
  };

  const totalSelected = useMemo(() => {
    if (!result) return 0;
    // Selected = user-picked variable totals + the (uneditable) fixed actuals.
    const variable = result.buckets
      .filter(b => b.role === "variable")
      .reduce((sum, b) => sum + (bucketTargets[b.key] || 0), 0);
    const fixed = result.buckets
      .filter(b => b.role === "fixed")
      .reduce((sum, b) => sum + b.bucket_actual_monthly_avg, 0);
    return variable + fixed;
  }, [result, bucketTargets]);

  const apply = async () => {
    if (!result) return;
    setApplying(true);
    try {
      const updated = categories.map(c => {
        const v = memberAmounts[c.id];
        if (typeof v !== "number") return c;
        return { ...c, budgeted: Math.round(v * 100) / 100 };
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
            Analyze My Spending
          </SheetTitle>
        </SheetHeader>

        {phase === "intake" && (
          <div className="px-5 py-8 space-y-6 max-w-md mx-auto">
            <p className="text-sm text-muted-foreground text-center">
              We'll roll your last 90 days of spending into standard Certified Financial
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

            <p className="text-xs text-muted-foreground text-center">
              Your manual category assignments and ignored transactions are respected.
              Nothing changes until you review and apply.
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
                Based on {result.transaction_count} transactions across {result.months_observed} months,
                rolled up into {result.buckets.length} CFP buckets.
              </p>
            </div>

            {/* Bucket cards */}
            <div className="px-5 py-3 space-y-3">
              {result.buckets.map(b => {
                const expanded = expandedBuckets[b.key] ?? false;
                const target = bucketTargets[b.key] ?? b.suggested_bucket_total;
                const memberSum = b.member_categories.reduce(
                  (s, m) => s + (memberAmounts[m.slug] || 0), 0,
                );
                const splitDelta = Math.round((memberSum - target) * 100) / 100;
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
                        <p className="text-xs italic text-muted-foreground leading-snug mb-3">
                          {b.commentary}
                        </p>
                      )}

                      {/* Suggested bucket total — editable */}
                      <div className="flex items-center justify-between gap-2 bg-muted/50 rounded-lg p-2.5">
                        <label className="text-xs text-muted-foreground" htmlFor={`bt-${b.key}`}>
                          Suggested bucket total
                        </label>
                        <div className="relative">
                          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground text-xs">$</span>
                          <input
                            id={`bt-${b.key}`}
                            type="text"
                            inputMode="decimal"
                            value={target.toFixed(2)}
                            onChange={e => {
                              const v = Number(e.target.value.replace(/[^0-9.]/g, ""));
                              updateBucketTarget(b, Number.isFinite(v) ? v : 0);
                            }}
                            className="w-28 pl-5 pr-2 py-1 text-sm font-semibold tabular-nums bg-background border border-border rounded-md outline-none focus:border-amber-400"
                          />
                        </div>
                      </div>

                      {/* Expand to split across member categories */}
                      <button
                        type="button"
                        onClick={() => setExpandedBuckets(s => ({ ...s, [b.key]: !expanded }))}
                        className="mt-2 w-full flex items-center justify-between text-xs text-muted-foreground hover:text-foreground py-1"
                      >
                        <span className="flex items-center gap-1">
                          {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                          Split across {b.member_categories.length} of your categories
                        </span>
                        {Math.abs(splitDelta) >= 0.01 && (
                          <span className={splitDelta > 0 ? "text-rose-600" : "text-amber-600"}>
                            {splitDelta > 0 ? "+" : ""}{fmt(splitDelta)} vs total
                          </span>
                        )}
                      </button>

                      {expanded && (
                        <div className="mt-2 space-y-1.5 border-t border-border pt-2">
                          {b.member_categories.map(m => (
                            <div key={m.slug} className="flex items-center justify-between gap-2">
                              <div className="min-w-0 flex-1">
                                <div className="text-sm text-foreground truncate">{m.name}</div>
                                <div className="text-[11px] text-muted-foreground tabular-nums">
                                  Actual avg {fmt(m.actual_monthly_avg)}
                                </div>
                              </div>
                              <div className="relative">
                                <span className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground text-xs">$</span>
                                <input
                                  type="text"
                                  inputMode="decimal"
                                  value={(memberAmounts[m.slug] ?? 0).toFixed(2)}
                                  onChange={e => {
                                    const v = Number(e.target.value.replace(/[^0-9.]/g, ""));
                                    updateMemberAmount(m.slug, Number.isFinite(v) ? v : 0);
                                  }}
                                  className="w-24 pl-5 pr-2 py-1 text-sm tabular-nums bg-background border border-border rounded-md outline-none focus:border-amber-400"
                                />
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

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

            {/* Unmatched categories */}
            {result.unmatched_categories.length > 0 && (
              <div className="mx-5 my-4 p-4 rounded-xl border border-amber-300 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/20">
                <div className="text-sm font-semibold text-foreground mb-1 flex items-center gap-1.5">
                  <AlertCircle className="w-4 h-4 text-amber-600" />
                  Categories without a CFP bucket
                </div>
                <p className="text-xs text-muted-foreground mb-2">
                  These didn't fit any standard bucket. They were left out of this analysis —
                  consider renaming, merging into an existing category, or telling us which bucket they belong in.
                </p>
                <ul className="text-xs text-foreground space-y-1">
                  {result.unmatched_categories.map(m => (
                    <li key={m.slug} className="flex items-center justify-between gap-2">
                      <span>{m.name}</span>
                      <span className="text-muted-foreground tabular-nums">
                        avg {fmt(m.actual_monthly_avg)}
                      </span>
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
            <div className="fixed bottom-0 left-0 right-0 bg-background/95 backdrop-blur border-t border-border px-5 py-3 flex items-center justify-between gap-3">
              <div className="text-xs">
                <div className="text-muted-foreground">Selected total</div>
                <div className="font-semibold tabular-nums text-foreground">
                  {fmt(totalSelected)}
                  <span className="text-muted-foreground font-normal ml-1">
                    ({pct(totalSelected, result.monthly_take_home)})
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
