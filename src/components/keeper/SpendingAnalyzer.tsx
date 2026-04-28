import { useEffect, useMemo, useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Sparkles, Loader2, ArrowLeft, ChevronDown, ChevronRight, Info, ArrowRight } from "lucide-react";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { BudgetCategory } from "@/types/budget";

const LOADING_MESSAGES = [
  "Pulling your transaction history…",
  "Grouping spending by merchant…",
  "Checking the merchant bucket cache…",
  "Asking the AI about new merchants…",
  "Comparing each bucket to its guideline %…",
  "Looking for reallocation opportunities…",
];

interface BucketMerchant {
  merchant: string;
  display: string;
  amount: number;
  assumed_pct: number;
  confidence: "low" | "medium" | "high";
  source: "ai" | "user";
  has_split: boolean;
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
  merchants: BucketMerchant[];
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
    merchant_count: number;
    ai_categorized_this_run: number;
    cached_merchant_count: number;
  };
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
  const [expandedBuckets, setExpandedBuckets] = useState<Record<string, boolean>>({});
  const [reassigning, setReassigning] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (open) {
      setPhase("intake");
      setResult(null);
      setBucketTargets({});
      setExpandedBuckets({});
      setIncome("");
    }
  }, [open]);

  useEffect(() => {
    if (phase !== "loading") return;
    const t = setInterval(() => setLoadingIdx(i => (i + 1) % LOADING_MESSAGES.length), 1800);
    return () => clearInterval(t);
  }, [phase]);

  const incomeNum = Number(income);
  const incomeValid = Number.isFinite(incomeNum) && incomeNum > 0;

  const variableBucketOptions = useMemo(() => {
    if (!result) return [] as Array<{ key: string; label: string }>;
    return result.buckets.filter(b => b.role === "variable").map(b => ({ key: b.key, label: b.label }));
  }, [result]);

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
      const targets: Record<string, number> = {};
      for (const b of r.buckets) {
        if (b.role !== "variable") continue;
        targets[b.key] = b.suggested_bucket_total;
      }
      setBucketTargets(targets);
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

  const updateBucketTarget = (key: string, newTotal: number) => {
    setBucketTargets(t => ({ ...t, [key]: newTotal }));
  };

  // Reassign a merchant to a different bucket. The cache learns this and
  // future analyses will respect it. We refresh the merchant locally so the
  // UI updates immediately, then prompt a re-run to recompute totals.
  const reassignMerchant = async (merchant: BucketMerchant, newBucketKey: string) => {
    if (!result || newBucketKey === resolveCurrentBucketForMerchant(merchant)) return;
    setReassigning(s => ({ ...s, [merchant.merchant]: true }));
    try {
      const { error } = await supabase.functions.invoke("analyze-spending", {
        body: {
          action: "reassign_merchant",
          merchant_normalized: merchant.merchant,
          bucket_key: newBucketKey,
        },
      });
      if (error) throw error;
      toast({ title: "Merchant reassigned", description: "Re-run analysis to see updated totals." });
      // Locally move the merchant between buckets so the user sees the change
      // without waiting on a re-run, even though the totals won't recompute
      // until they click again.
      setResult(prev => {
        if (!prev) return prev;
        const buckets = prev.buckets.map(b => {
          if (b.role !== "variable") return b;
          let merchants = b.merchants.filter(m => m.merchant !== merchant.merchant);
          if (b.key === newBucketKey) {
            merchants = [...merchants, { ...merchant, source: "user", confidence: "high", has_split: false, assumed_pct: 100 }];
          }
          return { ...b, merchants };
        });
        return { ...prev, buckets };
      });
    } catch (e) {
      toast({
        title: "Couldn't save",
        description: e instanceof Error ? e.message : "Try again.",
        variant: "destructive",
      });
    } finally {
      setReassigning(s => ({ ...s, [merchant.merchant]: false }));
    }
  };

  const resolveCurrentBucketForMerchant = (merchant: BucketMerchant): string => {
    if (!result) return "";
    for (const b of result.buckets) {
      if (b.role === "variable" && b.merchants.some(m => m.merchant === merchant.merchant)) {
        return b.key;
      }
    }
    return "";
  };

  const totalSelected = useMemo(() => {
    if (!result) return 0;
    const variable = result.buckets
      .filter(b => b.role === "variable")
      .reduce((sum, b) => sum + (bucketTargets[b.key] || 0), 0);
    const fixed = result.buckets
      .filter(b => b.role === "fixed")
      .reduce((sum, b) => sum + b.bucket_actual_monthly_avg, 0);
    return variable + fixed;
  }, [result, bucketTargets]);

  // Apply step: maps each variable bucket's chosen total back to the user's
  // existing categories. Uses prior-period spend to weight the split. If a
  // user has no categories tied to a bucket, we skip — defer to the
  // onboarding seed flow (PR 3) for that case.
  const apply = async () => {
    if (!result) return;
    setApplying(true);
    try {
      // We don't have category-level spend in the response anymore (the AI
      // bucket from raw merchants), so for the apply-back step we keep each
      // user's current category budgets and only adjust them proportionally
      // when a bucket has multiple matching categories. Heuristic mapping:
      // categories whose group is "savings" → saving bucket; "tithe" → giving;
      // otherwise we leave them alone. (Designed to drop in cleanly later.)
      // For now this is a no-op apply; the user gets a toast and we close.
      toast({
        title: "Targets noted",
        description: "Bucket-to-category mapping ships in the next update. Use these targets as guidance for now.",
      });
      onOpenChange(false);
      // Touch onApply to keep the prop wired even though no changes commit yet.
      void onApply(categories);
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

            <div className="rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">Heads up: </span>
              Cash spending and Venmo-as-name transactions don't show up in your
              bank feed, so they won't be in this analysis. Recurring bills
              (mortgage, tithe, etc.) come from your fixed expenses, not Plaid.
            </div>

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
            <p className="text-xs text-muted-foreground/70 text-center max-w-xs">
              First analysis can take 10–20 seconds while we categorize your
              merchants. Future runs are much faster — we cache what we learn.
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
                rolled up by merchant into the standard CFP framework.
                {result.diagnostics && (
                  <> {result.diagnostics.merchant_count} merchants
                    {result.diagnostics.ai_categorized_this_run > 0
                      ? `, ${result.diagnostics.ai_categorized_this_run} newly categorized this run`
                      : ", all from cache"}.</>
                )}
              </p>
              <p className="text-[11px] text-muted-foreground/80 mt-1 italic">
                Cash and Venmo-as-name transactions aren't included.
              </p>
            </div>

            {/* Variable bucket cards (editable) */}
            <div className="px-5 pt-4 pb-1">
              <div className="text-xs uppercase tracking-wide text-muted-foreground font-semibold">
                Variable spending
              </div>
            </div>
            <div className="px-5 py-2 space-y-3">
              {result.buckets.filter(b => b.role === "variable").map(b => {
                const expanded = expandedBuckets[b.key] ?? false;
                const target = bucketTargets[b.key] ?? b.suggested_bucket_total;
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
                              updateBucketTarget(b.key, Number.isFinite(v) ? v : 0);
                            }}
                            className="w-28 pl-5 pr-2 py-1 text-sm font-semibold tabular-nums bg-background border border-border rounded-md outline-none focus:border-amber-400"
                          />
                        </div>
                      </div>

                      {b.merchants.length > 0 && (
                        <>
                          <button
                            type="button"
                            onClick={() => setExpandedBuckets(s => ({ ...s, [b.key]: !expanded }))}
                            className="mt-2 w-full flex items-center justify-between text-xs text-muted-foreground hover:text-foreground py-1"
                          >
                            <span className="flex items-center gap-1">
                              {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                              {b.merchants.length} merchant{b.merchants.length === 1 ? "" : "s"} · tap to review
                            </span>
                          </button>

                          {expanded && (
                            <div className="mt-2 space-y-1.5 border-t border-border pt-2">
                              {b.merchants.map(m => (
                                <div
                                  key={m.merchant}
                                  className="flex items-center justify-between gap-2 py-1"
                                >
                                  <div className="min-w-0 flex-1">
                                    <div className="text-sm text-foreground truncate" title={m.display}>
                                      {m.display}
                                    </div>
                                    <div className="text-[11px] text-muted-foreground tabular-nums flex items-center gap-1 flex-wrap">
                                      <span>avg {fmt(m.amount)}/mo</span>
                                      {m.assumed_pct < 100 && (
                                        <span className="text-amber-700 dark:text-amber-400">
                                          · {Math.round(m.assumed_pct)}% to {b.label}
                                        </span>
                                      )}
                                      {m.confidence === "low" && (
                                        <span className="text-rose-600 dark:text-rose-400">· low confidence</span>
                                      )}
                                      {m.source === "user" && (
                                        <span className="text-emerald-700 dark:text-emerald-400">· you set this</span>
                                      )}
                                    </div>
                                  </div>
                                  <Select
                                    value={b.key}
                                    disabled={!!reassigning[m.merchant]}
                                    onValueChange={(v) => reassignMerchant(m, v)}
                                  >
                                    <SelectTrigger className="w-32 h-7 text-xs">
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {variableBucketOptions.map(opt => (
                                        <SelectItem key={opt.key} value={opt.key} className="text-xs">
                                          {opt.label}
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                </div>
                              ))}
                              <p className="text-[11px] text-muted-foreground italic pt-1">
                                Reassign a merchant once and we'll remember it. Re-run the
                                analysis to see updated totals.
                              </p>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Fixed buckets — informational, not editable here */}
            {result.buckets.some(b => b.role === "fixed") && (
              <>
                <div className="px-5 pt-5 pb-1">
                  <div className="text-xs uppercase tracking-wide text-muted-foreground font-semibold">
                    Fixed structure
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Sourced from your fixed expenses and savings/giving categories.
                    Shown so the framework adds up to your take-home pay.
                  </p>
                </div>
                <div className="px-5 py-2 space-y-2">
                  {result.buckets.filter(b => b.role === "fixed").map(b => {
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
