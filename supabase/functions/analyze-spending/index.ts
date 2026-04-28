import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { callGemini } from "../_shared/gemini.ts";
import {
  CFP_BUCKETS,
  VARIABLE_BUCKET_KEYS,
  normalizeMerchant,
} from "../_shared/cfp-buckets.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ---------------------------------------------------------------------------
// Stage-2 prompt: same shape as the prior version, just sees richer payloads.
// ---------------------------------------------------------------------------

const STEWARDSHIP_PROMPT = `You are a Certified Financial Planner (CFP) and Certified Kingdom Advisor (CKA) reviewing a household's spending rolled up into standard CFP buckets. The user provides their monthly take-home pay; use it as the denominator for every percentage.

For EACH variable bucket in the input, return:
- "verdict": one of "under" | "in_line" | "over" — relative to the bucket's guideline_pct (with kind: max means over=spending more than guideline, min means under=spending less than guideline, target means within ~1pp is in_line).
- "suggested_bucket_total": a realistic monthly target dollar amount for the whole bucket (number, no $).
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

// ---------------------------------------------------------------------------
// Stage-1 merchant categorization prompt (single tool call, all uncached
// merchants at once).
// ---------------------------------------------------------------------------

const MERCHANT_CATEGORIZER_PROMPT = `You categorize merchants into standard CFP budgeting buckets for a household budget app. You will be given a list of merchants, each with: a normalized merchant name, the original Plaid description, total dollars spent in the lookback window, the number of transactions, and (when available) Plaid's primary and detailed personal-finance categories.

Return one assignment per merchant. Each assignment has:
- "merchant": the exact normalized merchant name from input.
- "bucket_key": one of the variable bucket keys provided.
- "confidence": "high" | "medium" | "low".
- "split": OPTIONAL array of { "bucket_key", "pct" } summing to 100, ONLY when a merchant clearly serves multiple buckets (classic case: Costco/Target/Walmart split between groceries and personal/household). Omit when single-bucket.

Rules:
- Only assign to the variable buckets listed. Do NOT assign to fixed buckets — those are handled outside this call.
- If a merchant is genuinely ambiguous and you have no signal, default to "personal" with confidence "low".
- Never invent merchants. Return one entry per input merchant.`;

interface DbCategory { slug: string; name: string; budgeted: number; group: string }
interface DbFixed { slug: string; name: string; amount: number; group: string }
interface DbTxn {
  id: string; date: string; amount: number; category_slug: string;
  transaction_type: string; description: string; account: string;
  plaid_transaction_id: string | null;
}
interface CacheRow {
  id: string; merchant_normalized: string; merchant_display: string;
  bucket_key: string; split: Array<{ bucket_key: string; pct: number }>;
  source: "ai" | "user"; confidence: "low" | "medium" | "high";
  sample_count: number;
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
      stewardshipMode?: boolean; lookbackDays?: number; monthlyIncome?: number;
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

    const [{ data: cats }, { data: fixedRows }, { data: txns }, { data: cacheRows }] =
      await Promise.all([
        service.from("budget_categories").select("slug,name,budgeted,group")
          .eq("household_id", householdId).order("sort_order"),
        service.from("fixed_expenses").select("slug,name,amount,group")
          .eq("household_id", householdId).order("sort_order"),
        service.from("transactions")
          .select("id,date,amount,category_slug,transaction_type,description,account,plaid_transaction_id")
          .eq("household_id", householdId).gte("date", sinceDate),
        service.from("merchant_bucket_cache")
          .select("id,merchant_normalized,merchant_display,bucket_key,split,source,confidence,sample_count")
          .eq("household_id", householdId),
      ]);

    const categories = (cats || []) as DbCategory[];
    const fixedExpenses = (fixedRows || []) as DbFixed[];
    const transactions = (txns || []) as DbTxn[];
    const cache = (cacheRows || []) as CacheRow[];
    const cacheByMerchant = new Map<string, CacheRow>();
    for (const c of cache) cacheByMerchant.set(c.merchant_normalized, c);

    const monthsTouched = new Set<string>();
    for (const t of transactions) monthsTouched.add(t.date.slice(0, 7));
    const monthsObserved = Math.max(monthsTouched.size, 1);

    if (transactions.length < 30 || monthsObserved < 2) {
      return jsonResponse({
        error: "insufficient_history",
        message: "Need at least 30 transactions across 2+ months to analyze. Check back in a few weeks.",
        transactionCount: transactions.length, monthsObserved,
      }, 422);
    }

    // -----------------------------------------------------------------------
    // Bucket-eligible transactions = expenses, not unassigned, not ignore-*.
    // -----------------------------------------------------------------------
    const isIgnored = (slug: string) =>
      !slug || slug === "unassigned" || slug.startsWith("ignore-");

    // Build group-by-slug map for structural shortcuts.
    const slugToGroup = new Map<string, string>();
    for (const c of categories) slugToGroup.set(c.slug, (c.group || "").toLowerCase());

    // Structural totals: dollars routed to giving/saving from the user's
    // intentional category structure. These sidestep the AI entirely.
    let givingFromTxns = 0;
    let savingFromTxns = 0;

    // Variable transactions to be merchant-bucketed.
    interface VariableTxn { id: string; merchantRaw: string; merchantNormalized: string; amount: number; }
    const variableTxns: VariableTxn[] = [];

    for (const t of transactions) {
      if (t.transaction_type !== "expense") continue;
      const amt = Math.abs(Number(t.amount) || 0);
      if (amt <= 0) continue;
      if (isIgnored(t.category_slug)) continue;

      const grp = slugToGroup.get(t.category_slug);
      if (grp === "tithe" || grp === "giving") { givingFromTxns += amt; continue; }
      if (grp === "savings" || grp === "saving") { savingFromTxns += amt; continue; }

      // Everything else gets merchant-categorized.
      const raw = (t.description || "").trim();
      const norm = normalizeMerchant(raw);
      if (!norm) continue; // can't bucket what we can't name
      variableTxns.push({
        id: t.id, merchantRaw: raw, merchantNormalized: norm, amount: amt,
      });
    }

    // -----------------------------------------------------------------------
    // Group variable transactions by merchant.
    // -----------------------------------------------------------------------
    interface MerchantAgg {
      merchant_normalized: string; merchant_display: string;
      total: number; count: number;
    }
    const merchants = new Map<string, MerchantAgg>();
    for (const vt of variableTxns) {
      const cur = merchants.get(vt.merchantNormalized);
      if (cur) { cur.total += vt.amount; cur.count += 1; }
      else {
        merchants.set(vt.merchantNormalized, {
          merchant_normalized: vt.merchantNormalized,
          merchant_display: vt.merchantRaw.slice(0, 60),
          total: vt.amount, count: 1,
        });
      }
    }

    // -----------------------------------------------------------------------
    // Stage 1: AI-categorize uncached merchants.
    // -----------------------------------------------------------------------
    const uncached: MerchantAgg[] = [];
    for (const m of merchants.values()) {
      if (!cacheByMerchant.has(m.merchant_normalized)) uncached.push(m);
    }

    let aiAssignmentCount = 0;
    if (uncached.length > 0) {
      const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
      if (!GEMINI_API_KEY) return jsonResponse({ error: "GEMINI_API_KEY not configured" }, 500);

      // Cap per-call to keep token usage predictable. Process in batches of 80.
      const BATCH = 80;
      for (let i = 0; i < uncached.length; i += BATCH) {
        const slice = uncached.slice(i, i + BATCH);
        const payload = {
          variable_buckets: CFP_BUCKETS.filter(b => b.role === "variable").map(b => ({
            key: b.key, label: b.label, hint: b.ai_hint,
          })),
          merchants: slice.map(m => ({
            merchant: m.merchant_normalized,
            display: m.merchant_display,
            total_dollars: round2(m.total),
            transaction_count: m.count,
          })),
        };
        const userMsg = `Categorize these merchants into the listed variable buckets. Return ONLY a JSON object:\n{\n  "assignments": [\n    {"merchant": "...", "bucket_key": "...", "confidence": "high|medium|low", "split": [{"bucket_key": "...", "pct": 70}, ...]}\n  ]\n}\nInput:\n${JSON.stringify(payload)}`;

        const result = await callGemini({
          model: "gemini-2.5-flash",
          messages: [
            { role: "system", content: MERCHANT_CATEGORIZER_PROMPT },
            { role: "user", content: userMsg },
          ],
          apiKey: GEMINI_API_KEY,
        });

        if (!result.ok) {
          console.error("Gemini stage-1 error", result.status, result.errorBody);
          if (result.status === 429) {
            return jsonResponse({ error: "ai_failed", status: 429,
              message: "AI is rate-limited. Try again in a moment." }, 429);
          }
          // For partial failure, fall through — uncategorized merchants will
          // default to "personal" below.
          continue;
        }

        const parsed = parseAiJson(result.content || "");
        const assignments = (parsed?.assignments || []) as Array<{
          merchant?: string; bucket_key?: string; confidence?: string;
          split?: Array<{ bucket_key?: string; pct?: number }>;
        }>;

        const validKeys = new Set(VARIABLE_BUCKET_KEYS);
        const cacheInserts: Array<Record<string, unknown>> = [];
        for (const a of assignments) {
          if (typeof a?.merchant !== "string") continue;
          const merchantKey = a.merchant.trim();
          const merchant = merchants.get(merchantKey);
          if (!merchant) continue;
          let bucketKey = String(a.bucket_key || "").trim();
          if (!validKeys.has(bucketKey)) bucketKey = "personal";
          const conf = ["high", "medium", "low"].includes(String(a.confidence))
            ? String(a.confidence) : "medium";
          const split = Array.isArray(a.split)
            ? a.split
                .map(s => ({
                  bucket_key: String(s?.bucket_key || ""),
                  pct: Math.max(0, Math.min(100, Number(s?.pct) || 0)),
                }))
                .filter(s => validKeys.has(s.bucket_key) && s.pct > 0)
            : [];
          // If split provided but doesn't sum to 100, normalize.
          let normalizedSplit = split;
          if (split.length > 0) {
            const sum = split.reduce((a, b) => a + b.pct, 0);
            if (sum > 0) normalizedSplit = split.map(s => ({ ...s, pct: round2((s.pct / sum) * 100) }));
            else normalizedSplit = [];
          }

          cacheInserts.push({
            household_id: householdId,
            merchant_normalized: merchantKey,
            merchant_display: merchant.merchant_display,
            bucket_key: bucketKey,
            split: normalizedSplit,
            source: "ai",
            confidence: conf,
            sample_count: merchant.count,
          });
          // Update in-memory cache for the rollup below.
          cacheByMerchant.set(merchantKey, {
            id: "", merchant_normalized: merchantKey,
            merchant_display: merchant.merchant_display,
            bucket_key: bucketKey, split: normalizedSplit,
            source: "ai", confidence: conf as "low" | "medium" | "high",
            sample_count: merchant.count,
          });
          aiAssignmentCount += 1;
        }

        if (cacheInserts.length > 0) {
          const { error: insertErr } = await service
            .from("merchant_bucket_cache")
            .upsert(cacheInserts, { onConflict: "household_id,merchant_normalized" });
          if (insertErr) console.error("merchant_bucket_cache upsert error:", insertErr);
        }
      }
    }

    // Any merchant still without a cache entry (e.g. AI batch failed) defaults
    // to "personal" with low confidence so the analysis still completes.
    for (const m of merchants.values()) {
      if (!cacheByMerchant.has(m.merchant_normalized)) {
        cacheByMerchant.set(m.merchant_normalized, {
          id: "", merchant_normalized: m.merchant_normalized,
          merchant_display: m.merchant_display,
          bucket_key: "personal", split: [],
          source: "ai", confidence: "low", sample_count: m.count,
        });
      }
    }

    // -----------------------------------------------------------------------
    // Roll merchants up into variable buckets, honoring per-merchant splits.
    // -----------------------------------------------------------------------
    interface BucketMerchant {
      merchant: string; display: string; amount: number;
      assumed_pct: number; confidence: string; source: string; has_split: boolean;
    }
    const variableBucketTotals = new Map<string, number>();
    const variableBucketMerchants = new Map<string, BucketMerchant[]>();
    for (const k of VARIABLE_BUCKET_KEYS) {
      variableBucketTotals.set(k, 0);
      variableBucketMerchants.set(k, []);
    }

    for (const m of merchants.values()) {
      const c = cacheByMerchant.get(m.merchant_normalized)!;
      const splits = (c.split && c.split.length > 0)
        ? c.split
        : [{ bucket_key: c.bucket_key, pct: 100 }];
      for (const s of splits) {
        const portion = m.total * (s.pct / 100);
        variableBucketTotals.set(s.bucket_key,
          (variableBucketTotals.get(s.bucket_key) || 0) + portion);
        variableBucketMerchants.get(s.bucket_key)!.push({
          merchant: m.merchant_normalized,
          display: m.merchant_display,
          amount: round2(portion),
          assumed_pct: s.pct,
          confidence: c.confidence,
          source: c.source,
          has_split: splits.length > 1,
        });
      }
    }

    // -----------------------------------------------------------------------
    // Build all bucket rollups (variable + fixed).
    // Fixed buckets:
    //   - giving:    sum of giving/tithe transactions (structural)
    //   - saving:    sum of savings transactions     (structural)
    //   - housing/utilities/insurance/debt: from fixed_expenses.amount
    // -----------------------------------------------------------------------
    interface FixedExpenseSummary { name: string; amount: number; group: string; slug: string; }
    const fixedByBucket = new Map<string, FixedExpenseSummary[]>();
    const groupToBucket = (group: string, name: string): string | null => {
      const g = (group || "").toLowerCase();
      const n = (name || "").toLowerCase();
      if (g === "savings" || g === "saving") return "saving";
      if (g === "tithe" || g === "giving") return "giving";
      // "Bills" group: dispatch by name keywords.
      if (n.includes("mortgage") || n.includes("rent") || n.includes("hoa") || n.includes("lawn")
        || n.includes("home") || n.includes("house")) return "housing";
      if (n.includes("electric") || n.includes("water") || n.includes("gas")
        || n.includes("internet") || n.includes("spectrum") || n.includes("phone")
        || n.includes("cell") || n.includes("trash") || n.includes("dominion")
        || n.includes("utility") || n.includes("utilities")) return "utilities";
      if (n.includes("insurance") || n.includes("ltd") || n.includes("disability")
        || n.includes("policy") || n.includes("term life")) return "insurance";
      if (n.includes("loan") || n.includes("debt") || n.includes("perritt")
        || n.includes("tahoe") || n.includes("clark") || n.includes("payoff")) return "debt";
      // Subscriptions or other recurring items billed as fixed sit in their
      // variable bucket so we don't inflate "Insurance" with Netflix.
      return null;
    };

    for (const f of fixedExpenses) {
      const key = groupToBucket(f.group, f.name);
      if (!key) continue;
      const arr = fixedByBucket.get(key) || [];
      arr.push({ name: f.name, amount: Number(f.amount) || 0, group: f.group, slug: f.slug });
      fixedByBucket.set(key, arr);
    }

    // Compute average monthly observed for giving/saving from txns.
    const givingObservedAvg = givingFromTxns / monthsObserved;
    const savingObservedAvg = savingFromTxns / monthsObserved;

    const bucketRollups = CFP_BUCKETS.map(b => {
      let actual = 0;
      let memberDescription: string[] = [];
      let merchantList: BucketMerchant[] = [];

      if (b.role === "variable") {
        actual = (variableBucketTotals.get(b.key) || 0) / monthsObserved;
        merchantList = (variableBucketMerchants.get(b.key) || [])
          .map(m => ({ ...m, amount: round2(m.amount / monthsObserved) }))
          .sort((a, b) => b.amount - a.amount);
      } else if (b.key === "giving") {
        actual = givingObservedAvg;
        memberDescription = (fixedByBucket.get("giving") || []).map(f => f.name);
      } else if (b.key === "saving") {
        actual = savingObservedAvg;
        memberDescription = (fixedByBucket.get("saving") || []).map(f => f.name);
      } else {
        // housing/utilities/insurance/debt — trust fixed_expenses.amount.
        const items = fixedByBucket.get(b.key) || [];
        actual = items.reduce((s, f) => s + f.amount, 0);
        memberDescription = items.map(f => f.name);
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
        member_descriptions: memberDescription,
        merchants: merchantList,
      };
    });

    const variableRollups = bucketRollups.filter(b => b.role === "variable");
    const fixedRollups = bucketRollups.filter(b => b.role === "fixed");
    const fixedTotal = fixedRollups.reduce((s, b) => s + b.bucket_actual_monthly_avg, 0);
    const fixedPctOfIncome = round2((fixedTotal / monthlyIncome) * 100);

    // -----------------------------------------------------------------------
    // Stage 2: AI verdicts + reallocation hints + summary on variable buckets.
    // -----------------------------------------------------------------------
    const aiPayload = {
      months_observed: monthsObserved,
      monthly_take_home: round2(monthlyIncome),
      stewardship_mode: stewardshipMode,
      structural_context: {
        fixed_buckets_total: round2(fixedTotal),
        fixed_buckets_pct_of_income: fixedPctOfIncome,
        note: "Fixed bills (housing, utilities, insurance, debt, giving, saving) are sourced from the household's fixed expenses and savings/giving transactions. Use them as context only.",
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
        top_merchants: b.merchants.slice(0, 5).map(m => ({ display: m.display, amount: m.amount })),
      })),
    };

    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
    if (!GEMINI_API_KEY) return jsonResponse({ error: "GEMINI_API_KEY not configured" }, 500);

    const sys = stewardshipMode ? STEWARDSHIP_PROMPT : STANDARD_PROMPT;
    const userMsg = `Household data (last ${lookbackDays} days, ${monthsObserved} months):\n${JSON.stringify(aiPayload, null, 2)}\n\nReturn ONLY:\n{\n  "by_bucket": [{"key": "...", "verdict": "under|in_line|over", "suggested_bucket_total": 0, "commentary": "..."}],\n  "reallocation_hints": [{"from_bucket": "...", "to_bucket": "...", "amount": 0, "rationale": "..."}],\n  "overall_summary": "..."\n}\nInclude one entry in by_bucket for each VARIABLE bucket. Reallocation hints may target the fixed Giving or Saving buckets when surplus exists.`;

    const result = await callGemini({
      model: "gemini-2.5-flash",
      messages: [
        { role: "system", content: sys },
        { role: "user", content: userMsg },
      ],
      apiKey: GEMINI_API_KEY,
    });

    if (!result.ok) {
      console.error("Gemini stage-2 error", result.status, result.errorBody);
      return jsonResponse({
        error: "ai_failed", status: result.status,
        message: "Couldn't analyze right now. Try again in a moment.",
      }, result.status === 429 ? 429 : 502);
    }

    const parsed = parseAiJson(result.content || "");
    if (!parsed) {
      console.error("Failed to parse stage-2 AI JSON:", result.content?.slice(0, 500));
      return jsonResponse({
        error: "ai_parse_failed",
        message: "AI response was not valid JSON. Try again.",
      }, 502);
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
        merchant_count: merchants.size,
        ai_categorized_this_run: aiAssignmentCount,
        cached_merchant_count: cache.length,
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
  assignments?: Array<Record<string, unknown>>;
} | null {
  const cleaned = s.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "").trim();
  try { return JSON.parse(cleaned); } catch { /* fallthrough */ }
  const m = cleaned.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch { /* nope */ } }
  return null;
}
