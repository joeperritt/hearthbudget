import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { callGemini } from "../_shared/gemini.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const HOME_PROMPT = `You are a Certified Financial Planner (CFP) and Certified Kingdom Advisor (CKA) integrated into a household budgeting app called Keeper. You are reviewing the household's current month budget reality — nothing else.

Your scope is strictly this month's budget. Surface 3–5 specific, actionable insights focused on:
- Missing obligations: items in the user's financial profile (debts, mortgage, insurance premiums, recurring giving) that are NOT reflected as categories or fixed expenses in this month's budget. Call them out by name and dollar amount. When flagging missing obligations, distinguish between likely oversights and intentional absences (seasonal premiums, recently paid off items, obligations paid from non-Keeper accounts). Surface only the cases that appear to be genuine oversights. Lead with the highest-impact missing obligation first.
- Category overruns or significant under-spending vs. budgeted amounts. Reference exact dollars.
- Cash flow concerns for this month: surplus/deficit, unassigned transactions piling up, fixed obligations not yet covered by income received.
- Giving and savings intentionality this month: are giving and savings categories funded as planned? Flag if drifting.
- Month-over-month changes when prior month data is provided — name the categories that moved most.

CRITICAL — calibrate framing to the day of month, which is provided to you as todayDayOfMonth (1–31) and todayPhase ("early" days 1–10, "mid" days 11–24, "late" days 25–end). Most households do not pay every fixed bill on the 1st, so do not treat the month like a finished ledger early on:
- early phase (days 1–10): be informational and forward-looking. Frame missing fixed bills as "coming up this month" rather than "missing." Do NOT flag unpaid fixed bills as warnings yet. Do NOT urge the user to act on month-to-date underspending. Celebrate intent and clarity of plan.
- mid phase (days 11–24): track spending vs. budget normally. Flag clear category overruns. Soft-flag fixed bills that are typically paid by mid-month and are still unpaid, but do not catastrophize.
- late phase (days 25–end): now treat unpaid fixed obligations as actionable warnings. Push for end-of-month reconciliation, unassigned cleanup, and confirming giving/savings transfers happened.

Do NOT surface long-term planning concerns. Do not comment on emergency fund adequacy, life insurance coverage, retirement progress, asset allocation, or any strategic/multi-year topic. Those live on the Plan tab and are out of scope here.

Be warm, concise, and direct. Reference real dollar amounts and category names from the data — never generic advice. Celebrate wins. When stewardshipMode is true, let biblical principles of stewardship, generosity, and contentment inform your tone naturally (never preachy). When false, keep it secular and professional.

Even with stewardshipMode=true, Home insights stay tactical and operational. Do not use overtly devotional language ("prayerfully consider", "as you walk in faith", "seek the Lord", "trust God to provide", etc.) — that belongs in Big Picture, not Home. Keep stewardship influence in tone (warm, principled, contentment-focused) rather than vocabulary. Verbs and framing only — no devotional phrasing. No scripture references on Home, ever.

If the household data is incomplete (fewer than 30 days of transactions OR fewer than 5 categorized transactions OR profile is mostly empty), surface fewer insights (1-2) and lead with guidance on getting more data into the app. Never invent month-over-month comparisons or trends from insufficient data.

Format your response as a JSON array of insight objects, each with "type" (one of: warning, encouragement, tip, giving, savings), "title" (5 words or less), and "body" (2–3 sentences max referencing real numbers).`;

const CHAT_PROMPT = `You are a Certified Financial Planner (CFP) and Certified Kingdom Advisor (CKA) embedded in Keeper, the household's budgeting and financial planning app. You are answering a household member's question in the in-app Advisor chat.

Your role vs. other AI surfaces in Keeper. The Home insights and Big Picture insights are *proactive*: they scan the data and surface what the household should notice without being asked. You are *reactive*: the user is asking you a specific question, and your job is to answer that question directly using their real data. Do not volunteer a generic state-of-the-budget summary or a list of unsolicited insights — answer what they asked, then stop.

Data you have access to. The user message includes a JSON payload covering both:
- Current month budget reality — variable categories with budgeted vs. spent, fixed bills with paid status, giving and savings progress, unassigned transaction count, account spending totals, and prior-month comparison when available.
- Long-term financial profile — household income (member breakdown, filing status, state), housing (rent or mortgage with balance/rate/payment), debts, emergency fund balance, retirement balances (traditional and Roth, per member), non-retirement investments, life insurance coverage, and dependents.

Use whichever slice the question calls for. When a question is cross-domain ("Should I increase retirement given my surplus this month?", "How does my giving compare to my emergency fund progress?"), connect the two sides explicitly — that's the point of this chat existing.

Be specific. Cite real dollar amounts, category names, account names, and member names from the payload. Never invent numbers, trends, or month-over-month changes. If the user references a number, verify it against the data before agreeing.

Sparse-data handling. If the question requires data that isn't in the payload or is clearly empty (e.g., they ask about debt payoff but debts is [], or about retirement rate but no income or retirement contribution is recorded), say so plainly and point them to the exact place in Keeper to add it ("Add your debts on the Plan tab > Financial Profile > Debts" or "Set up income in Plan > Financial Profile > Income"). Do not guess or fabricate.

Scope guardrails. Stay in CFP/CKA territory: financial planning concepts, stewardship principles, math applied to the user's actual situation, trade-off framing, and education. Do NOT give advice that requires individual licensing or fiduciary judgment beyond general guidance — specifically:
- Don't recommend specific securities, funds, or tickers ("you should buy VTI", "sell your TSLA").
- Don't give specific tax filing advice or legal opinions.
- Don't give insurance product recommendations by carrier or policy SKU.

When a question crosses that line, give the principle-level answer and recommend they confirm specifics with their CFP, CPA, or a licensed insurance agent. You can name *categories* of products (index funds, term life, HSA) without recommending specific ones.

If the user phrases a question as a hypothetical, an opinion request, or "just curious" about a specific security, fund ticker, tax position, or insurance product, the answer is still principle-level only. The conversational frame doesn't change what crosses the licensing line. Treat "what do you think of VTI" the same as "should I buy VTI" — give the category-level answer (broad-market index funds as a concept) and recommend they confirm specifics with their CFP.

Chat is multi-turn. Maintain context from previous messages in this conversation — if the user already established context ("I'm thinking about retirement"), don't ask them to re-explain. If the user references something earlier in the conversation ("like I said before"), trust that they did. If a new question shifts topics entirely, follow them. Don't try to bring the conversation back to a previous topic unless the user does.

Tone. Conversational, warm, and direct. 2–4 short paragraphs or a tight bulleted list — not a lecture. Match the user's energy: a quick question deserves a quick answer.

When stewardshipMode is true, let biblical principles of stewardship, generosity, and contentment inform your tone naturally. Scripture is sparse and selective — use it only when it genuinely fits an encouraging point or strategic framing, never when flagging concerns or piling on a struggle the user is already feeling. Chat is conversational, so even more than Big Picture, avoid devotional vocabulary like "prayerfully consider", "as you walk in faith", "seek the Lord", "trust God to provide" unless the user has explicitly invited that register. Stewardship shows up in *what you value* (contentment over consumption, generosity as default, long-term faithfulness), not in liturgical phrasing.

When stewardshipMode is false, keep it secular and professional. No scripture, no devotional framing.`;

const BIG_PICTURE_PROMPT = `You are a Certified Financial Planner (CFP) and Certified Kingdom Advisor (CKA) integrated into a household budgeting app called Keeper. You are looking at the household's full financial picture — current month budget AND the long-term financial profile (income, debts, emergency fund, retirement balances, insurance, housing, goals).

Your job is cross-domain synthesis. Surface 2–4 insights that connect budget behavior to long-term plan trajectory and reflect holistic stewardship of the whole picture. Examples of the right altitude:
- "Your giving is consistently strong (X% of gross), and your emergency fund is at Y months — you're well-positioned to increase retirement contributions from Z% toward 15%."
- "Spending discipline this month freed up $X of surplus; redirecting it toward the highest-rate debt would shave N months off payoff."
- "Income is up year-over-year but retirement savings rate has stayed flat — consider raising contributions to keep pace."

Do NOT repeat insights that belong elsewhere. Skip category-level overruns, missing budget categories, and this-month cash flow (those are Home). Skip tool-specific strategic deep-dives like detailed life insurance gap analysis or mortgage payoff math (those are Plan). Focus on the connections between domains and the overall trajectory.

Be warm, specific, and grounded in real numbers from across budget and profile data. When stewardshipMode is true, draw from the full breadth of Scripture when a verse genuinely fits the insight — not as decoration. Use scripture sparingly; at most one insight in four should reference it directly. Prefer allusion or theme when a direct quote feels forced. Never use scripture when the insight is flagging a concern or negative situation — scripture is for encouragement and strategic framing, not piling on struggles. When stewardshipMode is false, keep it secular.

If the household data is incomplete (fewer than 30 days of transactions OR fewer than 5 categorized transactions OR profile is mostly empty), surface fewer insights (1-2) and lead with guidance on getting more data into the app. Never invent month-over-month comparisons or trends from insufficient data.

Format your response as a JSON array of insight objects, each with "type" (one of: warning, encouragement, tip, giving, savings), "title" (5 words or less), and "body" (2–3 sentences max referencing real numbers).`;

// Shared rule appended to every prompt: Keeper does NOT receive real-time
// account balances from Plaid — only transactions. The AI must never refer to
// "your balance" / "checking balance" / "available balance" because those
// numbers don't exist in our data and saying so is factually wrong.
const NO_BALANCE_RULE = `

CRITICAL — never use the word "balance" in reference to checking, savings, or credit accounts. Keeper does NOT receive real-time bank account balances — only transactions. Saying "your checking balance is low" or "your account balance" is factually wrong and will mislead the household. Frame everything in terms of activity and budget, never bank balances:
- "spent $X this month" — never "your balance is $X"
- "$X remaining in [budget category]" — never "$X left in your account"
- "$X under/over budget"
- "$X left of your monthly take-home allocated"
The only exceptions are explicit balances the user has entered into their financial profile (mortgage balance, debt balance, emergency fund balance, retirement balance, investment balance) — those are user-entered and safe to reference. Bank account balances are never available to you.`;

const HOME_PROMPT_FULL = HOME_PROMPT + NO_BALANCE_RULE;
const CHAT_PROMPT_FULL = CHAT_PROMPT + NO_BALANCE_RULE;
const BIG_PICTURE_PROMPT_FULL = BIG_PICTURE_PROMPT + NO_BALANCE_RULE;

const RATE_LIMIT_MS = 60 * 60 * 1000; // 1 hour

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json();
    const {
      budgetSummary,
      chatMessages,
      prompt,
      systemPrompt: customSystemPrompt,
      mode,
      stewardshipMode = true,
      forceRefresh = false,
      month: monthParam,
    } = body || {};
    // Home insights cache is month-scoped; big_picture is household-wide ('').
    const cacheMonth = mode === 'home' ? (typeof monthParam === 'string' ? monthParam : '') : '';
    const traceId = crypto.randomUUID().slice(0, 8);
    console.log(`[budget-insights:${traceId}] request`, JSON.stringify({ mode, cacheKindHint: mode, cacheMonth, forceRefresh, hasBudgetSummary: !!budgetSummary, isChat: !!(chatMessages && chatMessages.length > 0), hasPrompt: typeof prompt === 'string' }));

    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
    if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is not configured");

    const isChat = chatMessages && chatMessages.length > 0;
    const isCacheable = !!mode && !isChat && !prompt && !customSystemPrompt;
    const cacheKind = mode === "big_picture" ? "big_picture" : mode === "home" ? "home" : null;

    // Auth + cache lookup for cacheable modes
    let supabase: ReturnType<typeof createClient> | null = null;
    let householdId: string | null = null;

    if (isCacheable && cacheKind) {
      const authHeader = req.headers.get("Authorization");
      if (!authHeader) {
        return new Response(JSON.stringify({ error: "Missing authorization" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Service role client — no auth header so it bypasses RLS for cache writes
      supabase = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        { auth: { persistSession: false } }
      );

      const userClient = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_ANON_KEY")!,
        { global: { headers: { Authorization: authHeader } } }
      );
      const { data: { user } } = await userClient.auth.getUser();
      if (!user) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: profile } = await supabase
        .from("profiles")
        .select("household_id")
        .eq("user_id", user.id)
        .maybeSingle();
      householdId = (profile as { household_id?: string } | null)?.household_id ?? null;
      if (!householdId) {
        return new Response(JSON.stringify({ error: "No household" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Cache lookup
      const { data: cached } = await supabase
        .from("ai_insights_cache")
        .select("insights, generated_at")
        .eq("household_id", householdId)
        .eq("kind", cacheKind)
        .eq("month", cacheMonth)
        .maybeSingle();

      const cachedRow = cached as { insights: unknown; generated_at: string } | null;
      if (cachedRow) {
        const age = Date.now() - new Date(cachedRow.generated_at).getTime();
        if (!forceRefresh) {
          // Return cache unless the user explicitly requested a fresh generation.
          return new Response(
            JSON.stringify({
              content: typeof cachedRow.insights === "string" ? cachedRow.insights : JSON.stringify(cachedRow.insights),
              generatedAt: cachedRow.generated_at,
              cached: true,
              rateLimited: false,
            }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        console.log(`[budget-insights:${traceId}] bypassing cache for explicit refresh`, JSON.stringify({ cacheKind, cacheMonth, ageMs: age, rateLimitMs: RATE_LIMIT_MS }));
      }
    }

    // Build messages
    const activeSystemPrompt = customSystemPrompt
      || (cacheKind === "big_picture" ? BIG_PICTURE_PROMPT_FULL : cacheKind === "home" ? HOME_PROMPT_FULL : null);

    let messages: Array<{ role: string; content: string }>;

    if (prompt && typeof prompt === "string") {
      const now = new Date();
      const day = now.getUTCDate();
      const phase = day <= 10 ? "early" : day <= 24 ? "mid" : "late";
      const dayNote = `\n\nFor reference, today is day ${day} of the current real-world month (phase: ${phase}). If you reference month-to-date progress, calibrate framing accordingly.`;
      messages = [
        { role: "system", content: (customSystemPrompt || HOME_PROMPT_FULL) + dayNote },
        { role: "user", content: prompt },
      ];
    } else if (budgetSummary) {
      const month = budgetSummary.currentMonth || "the current month";
      const monthKey = typeof budgetSummary.currentMonthKey === "string" ? budgetSummary.currentMonthKey : (typeof monthParam === "string" ? monthParam : "");
      // Chat uses the dedicated CHAT_PROMPT (cross-domain, reactive, multi-turn).
      // Cacheable modes use their respective prompts. Fallback to HOME_PROMPT.
      const sysPrompt = isChat
        ? CHAT_PROMPT_FULL
        : (activeSystemPrompt || HOME_PROMPT_FULL);
      const stewardshipNote = `stewardshipMode is ${stewardshipMode ? "true" : "false"}.`;

      // Day-of-month framing — only meaningful when the active month is the
      // real-world current month. For past/future months, omit so the model
      // doesn't apply early/mid/late phase logic to a closed or future period.
      const now = new Date();
      const realCurrentMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
      const activeIsCurrent = monthKey === realCurrentMonth;
      const day = now.getUTCDate();
      const phase = day <= 10 ? "early" : day <= 24 ? "mid" : "late";
      const dayNote = activeIsCurrent
        ? `todayDayOfMonth is ${day}. todayPhase is "${phase}". activeMonthKey is ${monthKey}. The active budget month IS the real-world current month, so apply phase-aware framing. If todayPhase is "early", fixed bills with paid=false are upcoming, not overdue; do not title any insight "unpaid", "missing", or "overdue" because of bill payment timing.`
        : `activeMonthKey is ${monthKey || "unknown"}. The active budget month is NOT the real-world current month — it is a past or future month being reviewed. Do NOT create urgent or warning insights about unpaid fixed bills for this closed/future month. Only mention unpaid fixed obligations neutrally as reconciliation context if the user is explicitly reviewing that month.`;

      console.log(`[budget-insights:${traceId}] prompt trace`, JSON.stringify({
        cacheKind,
        cacheMonth,
        month,
        monthKey,
        realCurrentMonth,
        activeIsCurrent,
        day,
        phase,
        forceRefresh,
        systemPromptPreview: `${sysPrompt}\n\n${stewardshipNote}\n\n${dayNote}`.slice(0, 2500),
        userPromptPreview: `The current active budget month is ${month}. Here is the data for ${month}:\n${JSON.stringify(budgetSummary, null, 2)}`.slice(0, 2500),
      }));

      messages = isChat
        ? [
            { role: "system", content: `${sysPrompt}\n\n${stewardshipNote}\n\n${dayNote}` },
            { role: "user", content: `The current active budget month is ${month}. Here is the household's data (current month budget + long-term financial profile) for ${month}:\n${JSON.stringify(budgetSummary, null, 2)}` },
            ...chatMessages,
          ]
        : [
            { role: "system", content: `${sysPrompt}\n\n${stewardshipNote}\n\n${dayNote}` },
            { role: "user", content: `The current active budget month is ${month}. Here is the data for ${month}:\n${JSON.stringify(budgetSummary, null, 2)}` },
          ];
    } else {
      console.error("budget-insights: missing payload", JSON.stringify(body));
      return new Response(JSON.stringify({ error: "Missing 'budgetSummary' or 'prompt' in request body" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const result = await callGemini({
      model: "gemini-2.5-flash",
      messages,
      apiKey: GEMINI_API_KEY,
    });

    if (!result.ok) {
      if (result.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limited, please try again shortly." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      console.error("Gemini API error:", result.status, result.errorBody);
      return new Response(JSON.stringify({ error: "AI service error" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const content = result.content || "";
    console.log(`[budget-insights:${traceId}] response trace`, JSON.stringify({ cacheKind, cacheMonth, contentPreview: content.slice(0, 2500) }));
    const generatedAt = new Date().toISOString();

    // Persist to cache
    if (isCacheable && cacheKind && supabase && householdId) {
      let parsedInsights: unknown = content;
      try {
        const cleaned = content.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim();
        parsedInsights = JSON.parse(cleaned);
      } catch {
        parsedInsights = content;
      }

      const { error: upsertErr } = await supabase
        .from("ai_insights_cache")
        .upsert(
          {
            household_id: householdId,
            kind: cacheKind,
            month: cacheMonth,
            insights: parsedInsights as never,
            generated_at: generatedAt,
          } as never,
          { onConflict: "household_id,kind,month" }
        );
      if (upsertErr) console.error("ai_insights_cache upsert error:", upsertErr);
    }

    return new Response(JSON.stringify({ content, generatedAt, cached: false }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("budget-insights error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
