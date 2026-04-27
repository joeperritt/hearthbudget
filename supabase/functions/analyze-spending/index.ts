import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { callGemini } from "../_shared/gemini.ts";
import { INTENT_LABEL } from "../_shared/plaid-keeper-categories.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const STEWARDSHIP_PROMPT = `You are a Certified Financial Planner (CFP) and Certified Kingdom Advisor (CKA) reviewing a household's actual spending against their monthly take-home pay. Your job is to suggest realistic monthly budget targets per category based on the last 90 days of real activity, informed by CFP percentage-of-income guidelines and stewardship principles (giving first, then saving, then living).

Use the user-provided "monthly_take_home" as the denominator for every percentage. For each category, compare actual_monthly_avg as a % of take-home against typical CFP guidelines (rough anchors: housing ≤28%, transportation ≤15%, food/groceries ≤12%, food out ≤5%, giving 10%, saving 10–15%, personal/discretionary ≤10% combined). When a category is well over guideline, suggest a dollar amount that brings it closer to the guideline %. When in line, suggest something near the actual_monthly_avg.

Tone: warm, encouraging, never shaming. Frame giving/saving below guideline as a direction to grow toward. Use plain language. Reference categories by what they represent ("eating out", "personal misc", "hosting and gifts") rather than internal slugs or codes. Do not use overtly devotional vocabulary.

For each category in the input, return:
- "suggested": a realistic monthly target dollar amount (number, no $)
- "commentary": one short sentence (max 20 words) referencing the % of take-home if it's notably high or low

Also return an "overall_summary": 2–3 sentences describing the overall picture and the most important opportunity to focus on next month.

Stay strictly within budgeting guidance. Do not recommend specific securities, give tax advice, or suggest insurance products.`;

const STANDARD_PROMPT = `You are a Certified Financial Planner (CFP) reviewing a household's actual spending against their monthly take-home pay. Suggest realistic monthly budget targets per category based on the last 90 days of real activity, informed by CFP percentage-of-income guidelines.

Use the user-provided "monthly_take_home" as the denominator for every percentage. For each category, compare actual_monthly_avg as a % of take-home against typical CFP guidelines (rough anchors: housing ≤28%, transportation ≤15%, food/groceries ≤12%, food out ≤5%, saving 15%+, personal/discretionary ≤10% combined). When a category is well over guideline, suggest a dollar amount that brings it closer to the guideline %. When in line, suggest something near the actual_monthly_avg.

Tone: neutral, professional, direct. Use plain language. Reference categories by what they represent ("eating out", "personal misc", "hosting and gifts") rather than internal slugs or codes. No faith framing.

For each category in the input, return:
- "suggested": a realistic monthly target dollar amount (number, no $)
- "commentary": one short sentence (max 20 words) referencing the % of take-home if it's notably high or low

Also return an "overall_summary": 2–3 sentences describing the overall picture and the most important opportunity to focus on next month.

Stay strictly within budgeting guidance. Do not recommend specific securities, give tax advice, or suggest insurance products.`;

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

    const body = (await req.json().catch(() => ({}))) as { stewardshipMode?: boolean; lookbackDays?: number; monthlyIncome?: number };
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

    const [{ data: cats }, { data: txns }, { data: hh }] = await Promise.all([
      service.from("budget_categories").select("slug,name,budgeted,group")
        .eq("household_id", householdId).order("sort_order"),
      service.from("transactions").select("date,amount,category_slug,transaction_type")
        .eq("household_id", householdId).gte("date", sinceDate),
      service.from("financial_profiles").select("annual_gross_income,member_incomes,filing_status,state")
        .eq("household_id", householdId).maybeSingle(),
    ]);

    const categories = (cats || []) as DbCategory[];
    const transactions = (txns || []) as DbTxn[];

    if (categories.length === 0) {
      return new Response(JSON.stringify({ error: "No budget categories yet" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Determine months observed (calendar months touched by any txn)
    const monthsTouched = new Set<string>();
    for (const t of transactions) monthsTouched.add(t.date.slice(0, 7));
    const monthsObserved = Math.max(monthsTouched.size, 1);

    if (transactions.length < 30 || monthsObserved < 2) {
      return new Response(JSON.stringify({
        error: "insufficient_history",
        message: "Need at least 30 transactions across 2+ months to analyze. Check back in a few weeks.",
        transactionCount: transactions.length,
        monthsObserved,
      }), {
        status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Any ignore-* slug or unassigned should never count as spending.
    const isIgnored = (slug: string) =>
      !slug || slug === "unassigned" || slug.startsWith("ignore-");

    // Spending grouped by category slug (skip ignore-* and unassigned)
    const spentBySlug = new Map<string, number>();
    for (const t of transactions) {
      if (t.transaction_type !== "expense") continue;
      if (isIgnored(t.category_slug)) continue;
      const amt = Math.abs(Number(t.amount));
      spentBySlug.set(t.category_slug, (spentBySlug.get(t.category_slug) || 0) + amt);
    }

    // Build per-category payload for AI — only include categories that exist in the household
    const perCategory = categories.map(c => {
      const total = spentBySlug.get(c.slug) || 0;
      const actualAvg = total / monthsObserved;
      return {
        slug: c.slug,
        display_name: c.name,                  // for UI
        plain_language: prettyName(c.name),    // for AI commentary
        group: c.group,
        current_budget: Number(c.budgeted),
        actual_monthly_avg: round2(actualAvg),
      };
    });

    const profileBits = (hh as { annual_gross_income?: number; filing_status?: string; state?: string } | null) || {};

    const aiPayload = {
      months_observed: monthsObserved,
      monthly_take_home: round2(monthlyIncome),
      annual_gross_income_on_file: profileBits.annual_gross_income ?? null,
      filing_status: profileBits.filing_status ?? null,
      state: profileBits.state ?? null,
      categories: perCategory,
      intent_vocabulary: Object.values(INTENT_LABEL),
    };

    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
    if (!GEMINI_API_KEY) {
      return new Response(JSON.stringify({ error: "GEMINI_API_KEY not configured" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const sys = stewardshipMode ? STEWARDSHIP_PROMPT : STANDARD_PROMPT;
    const userMsg = `Household data (last ${lookbackDays} days, ${monthsObserved} months observed):\n${JSON.stringify(aiPayload, null, 2)}\n\nReturn ONLY a JSON object with this exact shape:\n{\n  "by_category": [{"slug": "...", "suggested": 0, "commentary": "..."}],\n  "overall_summary": "..."\n}\nInclude one entry in by_category for each input category. Do not include slugs that were not in the input. Do not echo internal slug strings in commentary; refer to categories by what they represent.`;

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

    // Merge AI suggestions back into per-category rows
    const byCatMap = new Map<string, { suggested: number; commentary: string }>();
    for (const row of parsed.by_category || []) {
      if (typeof row?.slug === "string") {
        byCatMap.set(row.slug, {
          suggested: Number(row.suggested) || 0,
          commentary: stripMarkdown(String(row.commentary || "")),
        });
      }
    }

    const merged = perCategory.map(c => ({
      slug: c.slug,
      name: c.display_name,
      group: c.group,
      current_budget: c.current_budget,
      actual_monthly_avg: c.actual_monthly_avg,
      suggested: byCatMap.get(c.slug)?.suggested ?? c.actual_monthly_avg,
      commentary: byCatMap.get(c.slug)?.commentary ?? "",
    }));

    return new Response(JSON.stringify({
      monthly_take_home: round2(monthlyIncome),
      months_observed: monthsObserved,
      lookback_days: lookbackDays,
      transaction_count: transactions.length,
      categories: merged,
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

function prettyName(name: string): string {
  // Heuristic: expand Joe & Katie's compact slugs so AI commentary reads natural
  const map: Record<string, string> = {
    "j-eo": "Joe's eating out",
    "k-eo": "Katie's eating out",
    "j-misc": "Joe's personal misc",
    "k-misc": "Katie's personal misc",
    "k-sc": "Katie's self-care",
  };
  const k = name.toLowerCase().trim();
  return map[k] || name;
}

function parseAiJson(s: string): { by_category?: Array<{ slug?: string; suggested?: unknown; commentary?: unknown }>; overall_summary?: unknown } | null {
  const cleaned = s.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "").trim();
  try { return JSON.parse(cleaned); } catch { /* fallthrough */ }
  // Try to extract first {...} block
  const m = cleaned.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch { /* nope */ } }
  return null;
}
