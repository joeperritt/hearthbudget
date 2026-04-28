// Analyze Spending — CFP bucket commentary edge function.
//
// Input model: the user has manually mapped each of their budget categories
// (and fixed expenses) to a CFP bucket via the bucket-mapping UI. This
// function rolls actual spending up by bucket using those user-owned
// mappings, computes % vs guideline, and asks Gemini for verdicts +
// reallocation hints.
//
// No AI categorization. No merchant cache. Mapping is deterministic and
// owned by the user.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { callGemini } from "../_shared/gemini.ts";
import { CFP_BUCKETS, VARIABLE_BUCKET_KEYS, ALL_BUCKET_KEYS } from "../_shared/cfp-buckets.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const STEWARDSHIP_PROMPT = `You are a Certified Financial Planner (CFP) and Certified Kingdom Advisor (CKA) reviewing a household's spending rolled up into standard CFP buckets. The user provides their monthly take-home pay; use it as the denominator for every percentage.

For EACH variable bucket in the input, return:
- "verdict": one of "under" | "in_line" | "over" — relative to the bucket's guideline_pct (kind: max means over=spending more than guideline; min means under=spending less than guideline; target means within ~1pp is in_line).
- "suggested_bucket_total": a realistic monthly target dollar amount (number, no $).
  - If "over": suggest a number that meaningfully moves toward the guideline %, not a token nudge.
  - If "under" on a max-kind bucket: affirm with a number near the actual; do NOT inflate spending.
  - If "under" on a min-kind bucket (giving, saving): suggest growth using headroom from elsewhere.
- "commentary": one short sentence (max 25 words) referencing the bucket's % of take-home in plain language.

Also return:
- "reallocation_hints": ARRAY of { "from_bucket", "to_bucket", "amount", "rationale" } showing cross-bucket moves. In stewardship mode, surplus headroom should preferentially flow to Giving and Saving when those are below their min guidelines.
- "overall_summary": 2–3 warm, encouraging sentences (no shaming, no overtly devotional vocabulary).

Stay strictly within budgeting guidance. Do not recommend specific securities, give tax advice, or suggest insurance products.`;

const STANDARD_PROMPT = `You are a Certified Financial Planner (CFP) reviewing a household's spending rolled up into standard CFP buckets. The user provides their monthly take-home pay; use it as the denominator for every percentage.

For EACH variable bucket in the input, return verdict ("under"|"in_line"|"over"), suggested_bucket_total (number), and one short plain-language commentary (max 25 words). When "over", suggest a number that meaningfully moves toward the guideline %; when "under" on a max bucket, affirm without inflating spend; when "under" on a min bucket (saving), suggest growth using headroom from elsewhere.

Also return reallocation_hints (array of {from_bucket, to_bucket, amount, rationale}) and a 2–3 sentence overall_summary. Headroom in under-spent max buckets should preferentially fund Saving when Saving is below guideline.

Stay strictly within budgeting guidance. No securities, no tax advice, no insurance product recs.`;

interface DbCategory { slug: string; name: string; budgeted: number; group: string }
interface DbFixed { slug: string; name: string; amount: number; group: string }
interface DbTxn {
  id: string; date: string; amount: number; category_slug: string;
  transaction_type: string;
}
interface DbMapRow { category_slug: string; bucket_key: string; category_kind: string }

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
      lookbackDays?: number;
      monthlyIncome?: number;
    };

    const stewardshipMode = body.stewardshipMode !== false;
    const lookbackDays = Math.min(Math.max(body.lookbackDays ?? 90, 30), 180);
    const monthlyIncome = Number(body.monthlyIncome);
    if (!Number.isFinite(monthlyIncome) || monthlyIncome <= 0) {
      return jsonResponse({
        error: "missing_income",
        message: "Monthly take-home pay is required.",
      }, 400);
    }

    const sinceDate = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000)
      .toISOString().slice(0, 10);

    const [{ data: cats }, { data: fixedRows }, { data: txns }, { data: mapRows }] =
      await Promise.all([
        service.from("budget_categories").select("slug,name,budgeted,group")
          .eq("household_id", householdId).order("sort_order"),
        service.from("fixed_expenses").select("slug,name,amount,group")
          .eq("household_id", householdId).order("sort_order"),
        service.from("transactions")
          .select("id,date,amount,category_slug,transaction_type")
          .eq("household_id", householdId).gte("date", sinceDate),
        service.from("category_bucket_map").select("category_slug,bucket_key,category_kind")
          .eq("household_id", householdId),
      ]);

    const categories = (cats || []) as DbCategory[];
    const fixedExpenses = (fixedRows || []) as DbFixed[];
    const transactions = (txns || []) as DbTxn[];
    const userMap = (mapRows || []) as DbMapRow[];

    // Build slug → bucket lookup. Only user-defined mappings count — we no
    // longer auto-route group='savings'/'tithe' because many "savings"
    // categories are sinking funds for delayed expenses (vacation, car taxes,
    // pet costs) and shouldn't inflate the Saving bucket. The user maps each.
    const slugToBucket = new Map<string, string>();
    for (const m of userMap) slugToBucket.set(m.category_slug, m.bucket_key);

    const validBucketKeys = new Set(ALL_BUCKET_KEYS);

    // Months observed (for averaging variable spend).
    const monthsTouched = new Set<string>();
    for (const t of transactions) {
      if (t.date) monthsTouched.add(t.date.slice(0, 7));
    }
    const monthsObserved = Math.max(monthsTouched.size, 1);

    // ---------------------------------------------------------------------
    // Variable bucket totals from transactions.
    // ---------------------------------------------------------------------
    const isIgnored = (slug: string) =>
      !slug || slug === "unassigned" || slug.startsWith("ignore-");

    interface VariableMember { slug: string; name: string; total: number; bucketKey: string; }
    const memberBySlug = new Map<string, VariableMember>();
    const slugToCat = new Map<string, DbCategory>();
    for (const c of categories) slugToCat.set(c.slug, c);

    for (const t of transactions) {
      if (t.transaction_type !== "expense") continue;
      const amt = Math.abs(Number(t.amount) || 0);
      if (amt <= 0) continue;
      if (isIgnored(t.category_slug)) continue;
      const bucketKey = slugToBucket.get(t.category_slug);
      if (!bucketKey || !validBucketKeys.has(bucketKey)) continue; // unmapped — skipped
      const cat = slugToCat.get(t.category_slug);
      const entry = memberBySlug.get(t.category_slug);
      if (entry) entry.total += amt;
      else memberBySlug.set(t.category_slug, {
        slug: t.category_slug,
        name: cat?.name || t.category_slug,
        total: amt,
        bucketKey,
      });
    }

    // ---------------------------------------------------------------------
    // Build bucket rollups (variable from txns avg/month, fixed from
    // fixed_expenses + structural giving/saving categories).
    // ---------------------------------------------------------------------
    interface BucketMember { slug: string; name: string; amount: number; }
    const variableMembersByBucket = new Map<string, BucketMember[]>();
    const variableTotalByBucket = new Map<string, number>();
    for (const k of VARIABLE_BUCKET_KEYS) {
      variableMembersByBucket.set(k, []);
      variableTotalByBucket.set(k, 0);
    }

    for (const m of memberBySlug.values()) {
      const arr = variableMembersByBucket.get(m.bucketKey);
      if (!arr) continue; // mapped to a fixed bucket — handled below as structural
      const monthly = m.total / monthsObserved;
      arr.push({ slug: m.slug, name: m.name, amount: round2(monthly) });
      variableTotalByBucket.set(m.bucketKey, (variableTotalByBucket.get(m.bucketKey) || 0) + monthly);
    }

    // Sort variable members by amount desc.
    for (const arr of variableMembersByBucket.values()) {
      arr.sort((a, b) => b.amount - a.amount);
    }

    // Structural giving / saving from variable categories mapped to those buckets.
    let givingFromCategories = 0;
    let savingFromCategories = 0;
    for (const m of memberBySlug.values()) {
      const monthly = m.total / monthsObserved;
      if (m.bucketKey === "giving") givingFromCategories += monthly;
      if (m.bucketKey === "saving") savingFromCategories += monthly;
    }

    // Fixed expenses grouped by bucket. Only user-mapped fixed expenses count.
    interface FixedSummary { name: string; amount: number; slug: string; }
    const fixedByBucket = new Map<string, FixedSummary[]>();
    for (const f of fixedExpenses) {
      const bucketKey = slugToBucket.get(f.slug);
      if (!bucketKey || !validBucketKeys.has(bucketKey)) continue;
      const arr = fixedByBucket.get(bucketKey) || [];
      arr.push({ name: f.name, amount: Number(f.amount) || 0, slug: f.slug });
      fixedByBucket.set(bucketKey, arr);
    }

    const bucketRollups = CFP_BUCKETS.map(b => {
      let actual = 0;
      const memberDescriptions: string[] = [];
      let memberList: BucketMember[] = [];

      if (b.role === "variable") {
        actual = variableTotalByBucket.get(b.key) || 0;
        memberList = variableMembersByBucket.get(b.key) || [];
      } else {
        // Fixed buckets: fixed_expenses + (for giving/saving) structural txns.
        const fixedItems = fixedByBucket.get(b.key) || [];
        actual = fixedItems.reduce((s, f) => s + f.amount, 0);
        memberDescriptions.push(...fixedItems.map(f => f.name));
        if (b.key === "giving") {
          actual += givingFromCategories;
          for (const m of memberBySlug.values()) {
            if (m.bucketKey === "giving") memberDescriptions.push(m.name);
          }
        }
        if (b.key === "saving") {
          actual += savingFromCategories;
          for (const m of memberBySlug.values()) {
            if (m.bucketKey === "saving") memberDescriptions.push(m.name);
          }
        }
      }

      return {
        key: b.key,
        label: b.label,
        guideline_pct: b.guideline_pct,
        guideline_kind: b.guideline_kind,
        guideline_source: b.guideline_source,
        role: b.role,
        bucket_actual_monthly_avg: round2(actual),
        bucket_pct_of_income: round2((actual / monthlyIncome) * 100),
        member_descriptions: memberDescriptions,
        members: memberList,
      };
    });

    const variableRollups = bucketRollups.filter(b => b.role === "variable");
    const fixedRollups = bucketRollups.filter(b => b.role === "fixed");
    const fixedTotal = fixedRollups.reduce((s, b) => s + b.bucket_actual_monthly_avg, 0);
    const fixedPctOfIncome = round2((fixedTotal / monthlyIncome) * 100);

    // Unbudgeted: take-home that isn't accounted for by any bucket. CFP planners
    // treat unassigned money as the #1 leak — it almost always becomes
    // discretionary spending. We surface it as a synthetic "bucket" so it gets
    // flagged in the results, with a guideline of 0% (any positive amount is a
    // plan gap to close).
    const accountedFor = bucketRollups.reduce((s, b) => s + b.bucket_actual_monthly_avg, 0);
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
    // AI commentary call (one shot).
    // ---------------------------------------------------------------------
    const aiPayload = {
      months_observed: monthsObserved,
      monthly_take_home: round2(monthlyIncome),
      stewardship_mode: stewardshipMode,
      structural_context: {
        fixed_buckets_total: round2(fixedTotal),
        fixed_buckets_pct_of_income: fixedPctOfIncome,
        note: "Fixed bills (housing, utilities, insurance, debt, giving, saving) are sourced from the household's fixed expenses and intentional giving/saving categories. Use them as context only.",
        fixed_summary: fixedRollups.map(b => ({
          key: b.key, label: b.label,
          actual_monthly_avg: b.bucket_actual_monthly_avg,
          pct_of_income: b.bucket_pct_of_income,
        })),
      },
      buckets: variableRollups.map(b => ({
        key: b.key,
        label: b.label,
        guideline_pct: b.guideline_pct,
        guideline_kind: b.guideline_kind,
        bucket_actual_monthly_avg: b.bucket_actual_monthly_avg,
        bucket_pct_of_income: b.bucket_pct_of_income,
        top_members: b.members.slice(0, 5).map(m => ({ name: m.name, amount: m.amount })),
      })),
    };

    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
    if (!GEMINI_API_KEY) return jsonResponse({ error: "GEMINI_API_KEY not configured" }, 500);

    const sys = stewardshipMode ? STEWARDSHIP_PROMPT : STANDARD_PROMPT;
    const userMsg = `Household data (last ${lookbackDays} days, ${monthsObserved} months):\n${JSON.stringify(aiPayload, null, 2)}\n\nReturn ONLY:\n{\n  "by_bucket": [{"key": "...", "verdict": "under|in_line|over", "suggested_bucket_total": 0, "commentary": "..."}],\n  "reallocation_hints": [{"from_bucket": "...", "to_bucket": "...", "amount": 0, "rationale": "..."}],\n  "overall_summary": "..."\n}\nInclude one entry in by_bucket for each VARIABLE bucket. Reallocation hints may target the fixed Giving or Saving buckets when surplus exists.`;

    // Try gemini-2.5-flash first; on 503 (high demand) or 429, retry once with
    // a short backoff and finally fall back to gemini-2.5-flash-lite.
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
      // Return 200 with an error envelope so supabase-js surfaces it via `data`
      // (functions.invoke treats non-2xx as a thrown FunctionsHttpError and
      // hides the body). The client checks `data.error` and shows a toast.
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
        verdict: ai?.verdict ?? "in_line",
        suggested_bucket_total: round2(suggested),
        commentary: ai?.commentary ?? "",
      };
    });

    const reallocationHints = (parsed.reallocation_hints || []).map((h: {
      from_bucket?: unknown; to_bucket?: unknown; amount?: unknown; rationale?: unknown;
    }) => ({
      from_bucket: String(h?.from_bucket || ""),
      to_bucket: String(h?.to_bucket || ""),
      amount: Number(h?.amount) || 0,
      rationale: stripMarkdown(String(h?.rationale || "")),
    })).filter((h: { from_bucket: string; to_bucket: string }) => h.from_bucket && h.to_bucket);

    // Diagnostics for the UI.
    const totalCategories = categories.length + fixedExpenses.length;
    const mappedCategoriesCount = (() => {
      let n = 0;
      for (const c of categories) if (slugToBucket.has(c.slug)) n++;
      for (const f of fixedExpenses) if (slugToBucket.has(f.slug)) n++;
      return n;
    })();

    return jsonResponse({
      monthly_take_home: round2(monthlyIncome),
      months_observed: monthsObserved,
      lookback_days: lookbackDays,
      transaction_count: transactions.length,
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
