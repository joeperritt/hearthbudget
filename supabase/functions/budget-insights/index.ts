import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SYSTEM_PROMPT = `You are a CFP (Certified Financial Planner) and CKA (Certified Kingdom Advisor) integrated into a household budgeting app called Hearth. You give warm, practical, faith-informed financial guidance. You have access to the user's real budget and transaction data for the current month. Your job is to surface 3-5 specific, actionable insights based on their actual numbers — not generic advice. Be concise, encouraging, and direct. Reference specific dollar amounts and category names from their data. Flag anything that needs attention. Celebrate wins. Frame spending and saving in the context of stewardship. Never be preachy but let biblical principles of generosity, planning, and contentment inform your tone naturally. When prior month data is provided in priorMonth, reference specific month over month changes in your insights — call out categories that increased or decreased significantly by name and dollar amount. Lead with the most notable change. If no prior month data is provided, focus only on current month patterns. Format your response as a JSON array of insight objects, each with a "type" field (one of: warning, encouragement, tip, giving, savings), a "title" field (5 words or less), and a "body" field (2-3 sentences max referencing real numbers from their data).`;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { budgetSummary, chatMessages } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const isChat = chatMessages && chatMessages.length > 0;

    const messages = isChat
      ? [
          { role: "system", content: SYSTEM_PROMPT.replace('Format your response as a JSON array of insight objects, each with a "type" field (one of: warning, encouragement, tip, giving, savings), a "title" field (5 words or less), and a "body" field (2-3 sentences max referencing real numbers from their data).', 'When answering follow-up questions, respond conversationally and specifically using the budget data provided. Be concise and helpful.') },
          { role: "user", content: `The current active budget month is ${budgetSummary.currentMonth}. Here is the budget data for ${budgetSummary.currentMonth}:\n${JSON.stringify(budgetSummary, null, 2)}` },
          ...chatMessages,
        ]
      : [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: `The current active budget month is ${budgetSummary.currentMonth}. Here is the budget data for ${budgetSummary.currentMonth}:\n${JSON.stringify(budgetSummary, null, 2)}` },
        ];

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages,
        stream: false,
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limited, please try again shortly." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted. Add funds in workspace settings." }), {
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

    return new Response(JSON.stringify({ content }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("budget-insights error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
