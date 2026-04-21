import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SYSTEM_PROMPT = `You are a transaction categorization assistant for a household budgeting app called Keeper. Your job is to suggest the most likely category for an unassigned transaction based on the merchant name, amount, and the user's past categorization history.

You will receive:
- The transaction to categorize (merchant name, amount, date, account)
- The user's variable budget categories (with names and IDs)
- The user's fixed expenses (with names, IDs, and monthly amounts)
- Recent history of how the user categorized transactions from the same or similar merchants

Based on this data, return a JSON object with:
- "type": one of "variable", "fixed", "deposit", "cc-payment", or "ignore"
- "subtype": if type is "ignore", one of "income", "transfer", "prior-month"; otherwise null
- "categoryId": the ID of the suggested category (for variable or fixed types), or null
- "categoryName": the display name of the suggested category, or null
- "confidence": "high", "medium", or "low"
- "reason": a one-line explanation (e.g. "Matches your monthly Netflix fixed bill" or "You've categorized Amazon as Household 4 times recently")

Rules:
- If the user has consistently categorized this merchant the same way in history, confidence should be "high"
- If there's a partial pattern (e.g. 2 out of 3 times same category), confidence should be "medium"
- If there's no history and you're guessing based on merchant name alone, confidence should be "low"
- For deposits/credits (negative amounts on checking), suggest "deposit" type
- For CC payments, suggest "cc-payment" type
- Match fixed expenses by comparing merchant names to fixed expense names (e.g. "NETFLIX" matches "Netflix" fixed expense)
- Always return valid JSON with all fields present`;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { transaction, categories, fixedExpenses, merchantHistory } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const userPrompt = `Categorize this transaction:

Transaction:
- Merchant: "${transaction.description}"
- Amount: $${Math.abs(transaction.amount).toFixed(2)} (${transaction.amount < 0 ? 'credit/inflow' : 'debit/outflow'})
- Date: ${transaction.date}
- Account: ${transaction.account}

Variable Categories:
${categories.map((c: any) => `- "${c.name}" (ID: ${c.id})`).join('\n')}

Fixed Expenses:
${fixedExpenses.map((e: any) => `- "${e.name}" (ID: ${e.id}, $${e.amount}/mo, group: ${e.group})`).join('\n')}

Recent merchant history (how user categorized similar transactions):
${merchantHistory.length > 0
  ? merchantHistory.map((h: any) => `- "${h.description}" → ${h.categoryName} (${h.type}) on ${h.date}`).join('\n')
  : 'No prior history for this merchant.'}

Return a single JSON object with: type, subtype, categoryId, categoryName, confidence, reason`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash-lite",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
        stream: false,
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limited" }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "Credits exhausted" }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const t = await response.text();
      console.error("AI gateway error:", response.status, t);
      return new Response(JSON.stringify({ error: "AI service error" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || "";

    // Parse the JSON from the AI response
    let suggestion;
    try {
      // Strip markdown code fences if present
      const cleaned = content.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
      suggestion = JSON.parse(cleaned);
    } catch {
      console.error("Failed to parse AI suggestion:", content);
      return new Response(JSON.stringify({ error: "Failed to parse suggestion" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ suggestion }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("categorize-transaction error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
