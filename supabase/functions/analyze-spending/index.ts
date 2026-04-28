// Analyze Budget — CFP bucket commentary edge function.
//
// Data source: PLANNED amounts only.
//   - Variable bucket totals  = sum of budget_categories.budgeted for
//                               categories the user has mapped to that bucket.
//   - Fixed bucket totals     = sum of fixed_expenses.amount for fixed
//                               expenses the user has mapped to that bucket,
//                               PLUS any budget_categories.budgeted mapped to
//                               a fixed bucket (e.g. retirement contributions
//                               or tithe modeled as variable categories).
//   - Unbudgeted              = take_home - sum(all bucket totals). This
//                               equals the "Monthly Surplus/Deficit" shown
//                               on the Budget tab.
//
// No transactions. No 90-day averages. The Budget tab card and the analyzer
// are now reading the same numbers from the same source of truth.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { callGemini } from "../_shared/gemini.ts";
import { CFP_BUCKETS, VARIABLE_BUCKET_KEYS, ALL_BUCKET_KEYS } from "../_shared/cfp-buckets.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const STEWARDSHIP_PROMPT = `You are a Certified Financial Planner (CFP) and Certified Kingdom Advisor (CKA) reviewing a household's MONTHLY BUDGET (planned amounts) rolled up into standard CFP buckets. The user provides their monthly take-home pay; use it as the denominator for every percentage. These are PLANNED amounts, not historical spending — frame your commentary around plan structure, not behavior.

For EACH variable bucket in the input, return:
- "verdict": one of "under" | "in_line" | "over" — relative to the bucket's guideline_pct (kind: max means over=budgeting more than guideline; min means under=budgeting less than guideline; target means within ~1pp is in_line).
- "suggested_bucket_total": a realistic monthly target dollar amount (number, no $).
- "commentary": one short sentence (max 25 words) referencing the bucket's % of take-home.

Also return:
- "reallocation_hints": ARRAY of { "from_bucket", "to_bucket", "amount", "rationale" } showing cross-bucket moves. In stewardship mode, surplus headroom should preferentially flow to Giving and Saving when those are below their min guidelines.
- "overall_summary": 2–3 warm, encouraging sentences (no shaming, no overtly devotional vocabulary).

Stay strictly within budgeting guidance. Do not recommend specific securities, give tax advice, or suggest insurance products.`;

const STANDARD_PROMPT = `You are a Certified Financial Planner (CFP) reviewing a household's MONTHLY BUDGET (planned amounts) rolled up into standard CFP buckets. The user provides their monthly take-home pay; use it as the denominator for every percentage. These are PLANNED amounts, not historical spending.

For EACH variable bucket in the input, return verdict ("under"|"in_line"|"over"), suggested_bucket_total (number), and one short plain-language commentary (max 25 words).

Also return reallocation_hints (array of {from_bucket, to_bucket, amount, rationale}) and a 2–3 sentence overall_summary.

Stay strictly within budgeting guidance. No securities, no tax advice, no insurance product recs.`;

interface DbCategory {
  slug: string; name: string; budgeted: number; group: string;
  start_month: string | null; end_month: string | null;
}
interface DbFixed {
  slug: string; name: string; amount: number; group: string;
  start_month: string | null; end_month: string | null;
}
interface DbMapRow { category_slug: string; bucket_key: string; category_kind: string }

// True if a category/expense is active in the given YYYY-MM month.
function isActiveForMonth(item: { start_month: string | null; end_month: string | null }, month: string): boolean {
  if (item.start_month && item.start_month > month) return false;
  if (item.end_month && item.end_month < month) return false;
  return true;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user) return jsonResponse({ error: "Unauthorized" }, 401);

    const service = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } },
    );

    const { data: profile } = await service
      .from("profiles").select("household_id").eq("user_id", user.id).single();
    const householdId = (profile as { household_id?: string } | null)?.household_id;
    if (!householdId) return jsonResponse({ error: "No household" }, 400);

    const body = (await req.json().catch(() => ({}))) as {
      stewardshipMode?: boolean;
      monthlyIncome?: number;
      viewMonth?: string; // YYYY-MM
      preTaxSavingsMonthly?: number; // 401k / pre-tax retirement that never hits take-home
    };

    const stewardshipMode = body.stewardshipMode !== false;
    const monthlyIncome = Number(body.monthlyIncome);
    const preTaxSavings = Math.max(0, Number(body.preTaxSavingsMonthly) || 0);
    if (!Number.isFinite(monthlyIncome) || monthlyIncome <= 0) {
      return jsonResponse({
        error: "missing_income",
        message: "Monthly take-home pay is required.",
      }, 400);
    }
    const viewMonth = typeof body.viewMonth === "string" && /^\d{4}-\d{2}$/.test(body.viewMonth)
      ? body.viewMonth
      : new Date().toISOString().slice(0, 7);

    const [{ data: cats }, { data: fixedRows }, { data: mapRows }] = await Promise.all([
      service.from("budget_categories").select("slug,name,budgeted,group,start_month,end_month")
        .eq("household_id", householdId).order("sort_order"),
      service.from("fixed_expenses").select("slug,name,amount,group,start_month,end_month")
        .eq("household_id", householdId).order("sort_order"),
      service.from("category_bucket_map").select("category_slug,bucket_key,category_kind")
        .eq("household_id", householdId),
    ]);

    const allCategories = (cats || []) as DbCategory[];
    const allFixed = (fixedRows || []) as DbFixed[];
    const userMap = (mapRows || []) as DbMapRow[];

    // Filter to items active for the requested view month — matches the
    // Budget tab's `filterForMonth` logic so totals line up exactly.
    const categories = allCategories.filter(c => isActiveForMonth(c, viewMonth));
    const fixedExpenses = allFixed.filter(f => isActiveForMonth(f, viewMonth));

    const slugToBucket = new Map<string, string>();
    for (const m of userMap) slugToBucket.set(m.category_slug, m.bucket_key);

    const validBucketKeys = new Set(ALL_BUCKET_KEYS);

    // ---------------------------------------------------------------------
    // Bucket rollups (PLANNED amounts only).
    // ---------------------------------------------------------------------
    interface BucketMember { slug: string; name: string; amount: number; }
    const membersByBucket = new Map<string, BucketMember[]>();
    const totalByBucket = new Map<string, number>();
    for (const k of ALL_BUCKET_KEYS) {
      membersByBucket.set(k, []);
      totalByBucket.set(k, 0);
    }

    // Variable categories — each carries its budgeted amount for this month.
    for (const c of categories) {
      const bucketKey = slugToBucket.get(c.slug);
      if (!bucketKey || !validBucketKeys.has(bucketKey)) continue;
      const amt = Number(c.budgeted) || 0;
      if (amt <= 0) continue;
      membersByBucket.get(bucketKey)!.push({ slug: c.slug, name: c.name, amount: round2(amt) });
      totalByBucket.set(bucketKey, (totalByBucket.get(bucketKey) || 0) + amt);
    }

    // Fixed expenses — each carries its monthly amount.
    for (const f of fixedExpenses) {
      const bucketKey = slugToBucket.get(f.slug);
      if (!bucketKey || !validBucketKeys.has(bucketKey)) continue;
      const amt = Number(f.amount) || 0;
      if (amt <= 0) continue;
      membersByBucket.get(bucketKey)!.push({ slug: f.slug, name: f.name, amount: round2(amt) });
      totalByBucket.set(bucketKey, (totalByBucket.get(bucketKey) || 0) + amt);
    }

    // Inject pre-tax retirement savings as a synthetic member of the
    // Saving & Investing bucket. Pre-tax 401(k) contributions never land in
    // take-home, so we include them in the bucket total to surface the user's
    // TRUE savings rate — but they do NOT reduce the unbudgeted pool, since
    // they were never part of the take-home denominator's "spendable" cash.
    if (preTaxSavings > 0) {
      const savingKey = "saving_investing";
      if (membersByBucket.has(savingKey)) {
        membersByBucket.get(savingKey)!.push({
          slug: "__pretax_retirement__",
          name: "Pre-tax retirement (401k, etc.)",
          amount: round2(preTaxSavings),
        });
        totalByBucket.set(savingKey, (totalByBucket.get(savingKey) || 0) + preTaxSavings);
      }
    }

    // Sort members by amount desc within each bucket.
    for (const arr of membersByBucket.values()) arr.sort((a, b) => b.amount - a.amount);

    const bucketRollups = CFP_BUCKETS.map(b => {
      const members = membersByBucket.get(b.key) || [];
      const total = totalByBucket.get(b.key) || 0;
      // Saving bucket %-of-income uses an EFFECTIVE income that includes pre-tax,
      // so the savings rate isn't artificially deflated by the pre-tax amount
      // sitting outside take-home.
      const denom = b.key === "saving_investing"
        ? monthlyIncome + preTaxSavings
        : monthlyIncome;
      return {
        key: b.key,
        label: b.label,
        guideline_pct: b.guideline_pct,
        guideline_kind: b.guideline_kind,
        guideline_source: b.guideline_source,
        role: b.role,
        bucket_actual_monthly_avg: round2(total),
        bucket_pct_of_income: round2((total / denom) * 100),
        member_descriptions: members.map(m => m.name),
        members,
      };
    });

    const variableRollups = bucketRollups.filter(b => b.role === "variable");
    const fixedRollups = bucketRollups.filter(b => b.role === "fixed");
    const fixedTotal = fixedRollups.reduce((s, b) => s + b.bucket_actual_monthly_avg, 0);
    const fixedPctOfIncome = round2((fixedTotal / monthlyIncome) * 100);

    // Unbudgeted = take_home - sum(all bucket totals from take-home).
    // Pre-tax savings is excluded from accountedFor since it never came out of take-home.
    const accountedFor = bucketRollups.reduce((s, b) => s + b.bucket_actual_monthly_avg, 0) - preTaxSavings;
    const unbudgetedAmount = Math.max(0, monthlyIncome - accountedFor);
    const unbudgetedRollup = {
      key: "unbudgeted",
      label: "Unbudgeted",
      guideline_pct: 0,
      guideline_kind: "max" as const,
      guideline_source: "Unassigned money is the #1 thing CFP planners flag — without a job, it tends to disappear into discretionary spending. Aim to give every dollar a category.",
      role: "fixed" as const,
      bucket_actual_monthly_avg: round2(unbudgetedAmount),
      bucket_pct_of_income: round2((unbudgetedAmount / monthlyIncome) * 100),
      member_descriptions: [] as string[],
      members: [] as Array<{ slug: string; name: string; amount: number }>,
    };

    // ---------------------------------------------------------------------
    // AI commentary (variable buckets only).
    // ---------------------------------------------------------------------
    const aiPayload = {
      view_month: viewMonth,
      monthly_take_home: round2(monthlyIncome),
      stewardship_mode: stewardshipMode,
      structural_context: {
        fixed_buckets_total: round2(fixedTotal),
        fixed_buckets_pct_of_income: fixedPctOfIncome,
        note: "Fixed bucket totals come from the household's planned fixed expenses and any categories mapped to fixed buckets. Use as context only.",
        fixed_summary: fixedRollups.map(b => ({
          key: b.key, label: b.label,
          planned_monthly: b.bucket_actual_monthly_avg,
          pct_of_income: b.bucket_pct_of_income,
        })),
      },
      buckets: variableRollups.map(b => ({
        key: b.key,
        label: b.label,
        guideline_pct: b.guideline_pct,
        guideline_kind: b.guideline_kind,
        planned_monthly: b.bucket_actual_monthly_avg,
        pct_of_income: b.bucket_pct_of_income,
        members: b.members.slice(0, 5).map(m => ({ name: m.name, amount: m.amount })),
      })),
    };

    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
    if (!GEMINI_API_KEY) return jsonResponse({ error: "GEMINI_API_KEY not configured" }, 500);

    const sys = stewardshipMode ? STEWARDSHIP_PROMPT : STANDARD_PROMPT;
    const userMsg = `Household budget data for ${viewMonth}:\n${JSON.stringify(aiPayload, null, 2)}\n\nReturn ONLY:\n{\n  "by_bucket": [{"key": "...", "verdict": "under|in_line|over", "suggested_bucket_total": 0, "commentary": "..."}],\n  "reallocation_hints": [{"from_bucket": "...", "to_bucket": "...", "amount": 0, "rationale": "..."}],\n  "overall_summary": "..."\n}\nInclude one entry in by_bucket for each VARIABLE bucket.`;

    const callOnce = (model: string) => callGemini({
      model,
      messages: [
        { role: "system", content: sys },
        { role: "user", content: userMsg },
      ],
      apiKey: GEMINI_API_KEY,
    });
    const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

    let result = await callOnce("gemini-2.5-flash");
    if (!result.ok && (result.status === 503 || result.status === 429)) {
      console.warn("Gemini busy, retrying in 1.5s", result.status);
      await sleep(1500);
      result = await callOnce("gemini-2.5-flash");
    }
    if (!result.ok && (result.status === 503 || result.status === 429)) {
      console.warn("Gemini still busy, falling back to gemini-2.5-flash-lite");
      result = await callOnce("gemini-2.5-flash-lite");
    }

    if (!result.ok) {
      console.error("Gemini commentary error", result.status, result.errorBody);
      return jsonResponse({
        error: "ai_failed",
        status: result.status,
        message: result.status === 503
          ? "The AI is experiencing high demand. Please try again in a minute."
          : result.status === 429
            ? "Hit the AI rate limit. Wait a moment and try again."
            : "Couldn't reach the AI right now. Try again in a moment.",
      }, 200);
    }

    const parsed = parseAiJson(result.content || "");
    if (!parsed) {
      console.error("Failed to parse AI JSON:", result.content?.slice(0, 500));
      return jsonResponse({
        error: "ai_parse_failed",
        message: "AI response was not valid JSON. Try again.",
      }, 200);
    }

    const byBucketMap = new Map<string, { verdict: string; suggested: number; commentary: string }>();
    for (const row of parsed.by_bucket || []) {
      if (typeof row?.key === "string") {
        byBucketMap.set(row.key, {
          verdict: ["under", "in_line", "over"].includes(String(row.verdict)) ? String(row.verdict) : "in_line",
          suggested: Number(row.suggested_bucket_total) || 0,
          commentary: stripMarkdown(String(row.commentary || "")),
        });
      }
    }

    const verdictFromGuideline = (
      actualPct: number, guidelinePct: number, kind: "max" | "min" | "target",
    ): "under" | "in_line" | "over" => {
      if (kind === "max") return actualPct > guidelinePct + 1 ? "over" : "in_line";
      if (kind === "min") return actualPct < guidelinePct - 1 ? "under" : "in_line";
      if (Math.abs(actualPct - guidelinePct) <= 1) return "in_line";
      return actualPct > guidelinePct ? "over" : "under";
    };

    const mergedBuckets = bucketRollups.map(b => {
      if (b.role === "fixed") {
        return {
          ...b,
          verdict: verdictFromGuideline(b.bucket_pct_of_income, b.guideline_pct, b.guideline_kind),
          suggested_bucket_total: round2(b.bucket_actual_monthly_avg),
          commentary: "",
        };
      }
      const ai = byBucketMap.get(b.key);
      const suggested = ai?.suggested ?? b.bucket_actual_monthly_avg;
      return {
        ...b,
        verdict: ai?.verdict ?? verdictFromGuideline(b.bucket_pct_of_income, b.guideline_pct, b.guideline_kind),
        suggested_bucket_total: round2(suggested),
        commentary: ai?.commentary ?? "",
      };
    });

    const unbudgetedVerdict: "under" | "in_line" | "over" =
      unbudgetedRollup.bucket_pct_of_income > 1 ? "over" : "in_line";
    mergedBuckets.push({
      ...unbudgetedRollup,
      verdict: unbudgetedVerdict,
      suggested_bucket_total: 0,
      commentary: unbudgetedVerdict === "over"
        ? "Assign this — unassigned money is the #1 thing CFP planners push on."
        : "",
    });

    const reallocationHints = (parsed.reallocation_hints || []).map((h: {
      from_bucket?: unknown; to_bucket?: unknown; amount?: unknown; rationale?: unknown;
    }) => ({
      from_bucket: String(h?.from_bucket || ""),
      to_bucket: String(h?.to_bucket || ""),
      amount: Number(h?.amount) || 0,
      rationale: stripMarkdown(String(h?.rationale || "")),
    })).filter((h: { from_bucket: string; to_bucket: string }) => h.from_bucket && h.to_bucket);

    const totalCategories = categories.length + fixedExpenses.length;
    const mappedCategoriesCount = (() => {
      let n = 0;
      for (const c of categories) if (slugToBucket.has(c.slug)) n++;
      for (const f of fixedExpenses) if (slugToBucket.has(f.slug)) n++;
      return n;
    })();

    return jsonResponse({
      monthly_take_home: round2(monthlyIncome),
      view_month: viewMonth,
      buckets: mergedBuckets,
      reallocation_hints: reallocationHints,
      overall_summary: stripMarkdown(String(parsed.overall_summary || "")),
      stewardship_mode: stewardshipMode,
      diagnostics: {
        total_categories: totalCategories,
        mapped_categories: mappedCategoriesCount,
      },
    });
  } catch (e) {
    console.error("analyze-spending error:", e);
    return jsonResponse({
      error: "internal",
      message: e instanceof Error ? e.message : "Unknown error",
    }, 500);
  }
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function round2(n: number): number { return Math.round(n * 100) / 100; }

function stripMarkdown(s: string): string {
  return s.replace(/\*\*(.+?)\*\*/g, "$1").replace(/\*(.+?)\*/g, "$1").trim();
}

function parseAiJson(s: string): {
  by_bucket?: Array<{ key?: string; verdict?: unknown; suggested_bucket_total?: unknown; commentary?: unknown }>;
  reallocation_hints?: Array<Record<string, unknown>>;
  overall_summary?: unknown;
} | null {
  const cleaned = s.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "").trim();
  try { return JSON.parse(cleaned); } catch { /* fallthrough */ }
  const m = cleaned.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch { /* nope */ } }
  return null;
}
