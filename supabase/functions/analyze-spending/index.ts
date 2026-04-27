import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { callGemini } from "../_shared/gemini.ts";
import { CFP_BUCKETS, assignBucket } from "../_shared/cfp-buckets.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const STEWARDSHIP_PROMPT = `You are a Certified Financial Planner (CFP) and Certified Kingdom Advisor (CKA) reviewing a household's spending rolled up into standard CFP buckets. The user provides their monthly take-home pay; use it as the denominator for every percentage.

For EACH bucket in the input, return:
- "verdict": one of "under" | "in_line" | "over" — relative to the bucket's guideline_pct (with kind: max means over=spending more than guideline, min means under=spending less than guideline, target means within ~1pp is in_line).
- "suggested_bucket_total": a realistic monthly target dollar amount for the whole bucket (number, no $).
  - If verdict is "over": suggest a number that meaningfully moves toward the guideline %, not a token nudge.
  - If verdict is "under" on a max-kind bucket: affirm with a number near the actual; do NOT inflate spending.
  - If verdict is "under" on a min-kind bucket (giving, saving): suggest a number that grows toward guideline if reallocation hints provide headroom from elsewhere.
- "commentary": one short sentence (max 25 words). Reference the bucket's % of take-home and what's notable. Plain language. Reference categories by what they represent, not internal slugs.

Also return:
- "reallocation_hints": an ARRAY of cross-bucket suggestions. Each entry: { "from_bucket": "...", "to_bucket": "...", "amount": 0, "rationale": "..." }. The actual CFP value is in this cross-bucket logic — when one bucket has headroom (well under a max guideline) and another is over, recommend moving funds. In stewardship mode, surplus headroom should preferentially flow to Giving and Saving when those are below their min guidelines.
- "overall_summary": 2–3 sentences describing the overall picture and the most important reallocation to focus on next month. Warm, encouraging, never shaming. No overtly devotional vocabulary.

Stay strictly within budgeting guidance. Do not recommend specific securities, give tax advice, or suggest insurance products.`;

const STANDARD_PROMPT = `You are a Certified Financial Planner (CFP) reviewing a household's spending rolled up into standard CFP buckets. The user provides their monthly take-home pay; use it as the denominator for every percentage.

For EACH bucket in the input, return:
- "verdict": one of "under" | "in_line" | "over" relative to the bucket's guideline_pct.
- "suggested_bucket_total": a realistic monthly target dollar amount for the whole bucket (number, no $).
  - If "over": suggest a number that meaningfully moves toward the guideline %, not a token nudge.
  - If "under" on a max-kind bucket: affirm with a number near the actual; do NOT inflate spending.
  - If "under" on a min-kind bucket (saving): suggest growth toward guideline using headroom from over- or under-utilized buckets.
- "commentary": one short sentence (max 25 words). Reference the bucket's % of take-home. Plain language, no internal slugs.

Also return:
- "reallocation_hints": ARRAY of { "from_bucket", "to_bucket", "amount", "rationale" } showing cross-bucket moves. Headroom in under-spent max buckets should preferentially fund Saving when Saving is below guideline.
- "overall_summary": 2–3 sentences, neutral and direct.

Stay strictly within budgeting guidance. Do not recommend securities, give tax advice, or suggest insurance products.`;

interface DbCategory { slug: string; name: string; budgeted: number; group: string }
interface DbTxn { date: string; amount: number; category_slug: string; transaction_type: string }

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const service = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } },
    );

    const { data: profile } = await service
      .from("profiles").select("household_id").eq("user_id", user.id).single();
    const householdId = (profile as { household_id?: string } | null)?.household_id;
    if (!householdId) {
      return new Response(JSON.stringify({ error: "No household" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = (await req.json().catch(() => ({}))) as {
      stewardshipMode?: boolean; lookbackDays?: number; monthlyIncome?: number;
    };
    const stewardshipMode = body.stewardshipMode !== false;
    const lookbackDays = Math.min(Math.max(body.lookbackDays ?? 90, 30), 180);
    const monthlyIncome = Number(body.monthlyIncome);
    if (!Number.isFinite(monthlyIncome) || monthlyIncome <= 0) {
      return new Response(JSON.stringify({
        error: "missing_income",
        message: "Monthly take-home pay is required.",
      }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const sinceDate = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000)
      .toISOString().slice(0, 10);

    const [{ data: cats }, { data: txns }] = await Promise.all([
      service.from("budget_categories").select("slug,name,budgeted,group")
        .eq("household_id", householdId).order("sort_order"),
      service.from("transactions").select("date,amount,category_slug,transaction_type")
        .eq("household_id", householdId).gte("date", sinceDate),
    ]);

    const categories = (cats || []) as DbCategory[];
    const transactions = (txns || []) as DbTxn[];

    if (categories.length === 0) {
      return new Response(JSON.stringify({ error: "No budget categories yet" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const monthsTouched = new Set<string>();
    for (const t of transactions) monthsTouched.add(t.date.slice(0, 7));
    const monthsObserved = Math.max(monthsTouched.size, 1);

    if (transactions.length < 30 || monthsObserved < 2) {
      return new Response(JSON.stringify({
        error: "insufficient_history",
        message: "Need at least 30 transactions across 2+ months to analyze. Check back in a few weeks.",
        transactionCount: transactions.length,
        monthsObserved,
      }), { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const isIgnored = (slug: string) =>
      !slug || slug === "unassigned" || slug.startsWith("ignore-");

    // Spend by slug
    const spentBySlug = new Map<string, number>();
    for (const t of transactions) {
      if (t.transaction_type !== "expense") continue;
      if (isIgnored(t.category_slug)) continue;
      const amt = Math.abs(Number(t.amount));
      spentBySlug.set(t.category_slug, (spentBySlug.get(t.category_slug) || 0) + amt);
    }

    // Roll up into buckets. Track unmatched explicitly — do NOT bucket as "other".
    interface MemberRow {
      slug: string; name: string; group: string;
      current_budget: number; actual_monthly_avg: number;
    }
    const bucketMembers = new Map<string, MemberRow[]>();
    const unmatchedMembers: MemberRow[] = [];

    for (const c of categories) {
      const total = spentBySlug.get(c.slug) || 0;
      const row: MemberRow = {
        slug: c.slug,
        name: c.name,
        group: c.group,
        current_budget: Number(c.budgeted),
        actual_monthly_avg: round2(total / monthsObserved),
      };
      const { bucket_key } = assignBucket(c.slug, c.name);
      if (!bucket_key) {
        unmatchedMembers.push(row);
      } else {
        const arr = bucketMembers.get(bucket_key) || [];
        arr.push(row);
        bucketMembers.set(bucket_key, arr);
      }
    }

    const bucketRollups = CFP_BUCKETS
      .map(b => {
        const members = bucketMembers.get(b.key) || [];
        const bucket_actual = members.reduce((s, m) => s + m.actual_monthly_avg, 0);
        const bucket_current_budget = members.reduce((s, m) => s + m.current_budget, 0);
        return {
          key: b.key,
          label: b.label,
          guideline_pct: b.guideline_pct,
          guideline_kind: b.guideline_kind,
          guideline_source: b.guideline_source,
          member_categories: members,
          bucket_current_budget: round2(bucket_current_budget),
          bucket_actual_monthly_avg: round2(bucket_actual),
          bucket_pct_of_income: round2((bucket_actual / monthlyIncome) * 100),
        };
      })
      .filter(b => b.member_categories.length > 0);

    const aiPayload = {
      months_observed: monthsObserved,
      monthly_take_home: round2(monthlyIncome),
      stewardship_mode: stewardshipMode,
      buckets: bucketRollups.map(b => ({
        key: b.key,
        label: b.label,
        guideline_pct: b.guideline_pct,
        guideline_kind: b.guideline_kind,
        bucket_actual_monthly_avg: b.bucket_actual_monthly_avg,
        bucket_pct_of_income: b.bucket_pct_of_income,
        member_categories: b.member_categories.map(m => ({
          name: m.name, actual_monthly_avg: m.actual_monthly_avg,
        })),
      })),
    };

    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
    if (!GEMINI_API_KEY) {
      return new Response(JSON.stringify({ error: "GEMINI_API_KEY not configured" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const sys = stewardshipMode ? STEWARDSHIP_PROMPT : STANDARD_PROMPT;
    const userMsg = `Household data (last ${lookbackDays} days, ${monthsObserved} months observed):\n${JSON.stringify(aiPayload, null, 2)}\n\nReturn ONLY a JSON object with this exact shape:\n{\n  "by_bucket": [{"key": "...", "verdict": "under|in_line|over", "suggested_bucket_total": 0, "commentary": "..."}],\n  "reallocation_hints": [{"from_bucket": "...", "to_bucket": "...", "amount": 0, "rationale": "..."}],\n  "overall_summary": "..."\n}\nInclude one entry in by_bucket for each input bucket key. Do not echo internal slugs in commentary.`;

    const result = await callGemini({
      model: "gemini-2.5-flash",
      messages: [
        { role: "system", content: sys },
        { role: "user", content: userMsg },
      ],
      apiKey: GEMINI_API_KEY,
    });

    if (!result.ok) {
      console.error("Gemini error", result.status, result.errorBody);
      return new Response(JSON.stringify({
        error: "ai_failed",
        status: result.status,
        message: "Couldn't analyze right now. Try again in a moment.",
      }), {
        status: result.status === 429 ? 429 : 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const parsed = parseAiJson(result.content || "");
    if (!parsed) {
      console.error("Failed to parse AI JSON:", result.content?.slice(0, 500));
      return new Response(JSON.stringify({
        error: "ai_parse_failed",
        message: "AI response was not valid JSON. Try again.",
      }), { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
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

    const mergedBuckets = bucketRollups.map(b => {
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

    return new Response(JSON.stringify({
      monthly_take_home: round2(monthlyIncome),
      months_observed: monthsObserved,
      lookback_days: lookbackDays,
      transaction_count: transactions.length,
      buckets: mergedBuckets,
      unmatched_categories: unmatchedMembers,
      reallocation_hints: reallocationHints,
      overall_summary: stripMarkdown(String(parsed.overall_summary || "")),
      stewardship_mode: stewardshipMode,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("analyze-spending error:", e);
    return new Response(JSON.stringify({
      error: "internal",
      message: e instanceof Error ? e.message : "Unknown error",
    }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

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
