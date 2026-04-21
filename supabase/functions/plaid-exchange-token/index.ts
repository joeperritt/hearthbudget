import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await supabase.auth.getClaims(token);
    if (claimsError || !claimsData?.claims) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { public_token, institution_name, accounts } = await req.json();

    if (!public_token) {
      return new Response(JSON.stringify({ error: "public_token is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const PLAID_CLIENT_ID = Deno.env.get("PLAID_CLIENT_ID");
    const PLAID_SECRET = Deno.env.get("PLAID_SECRET");
    const PLAID_ENV = Deno.env.get("PLAID_ENV") || "production";

    if (!PLAID_CLIENT_ID || !PLAID_SECRET) {
      return new Response(JSON.stringify({ error: "Plaid credentials not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const plaidBaseUrl =
      PLAID_ENV === "sandbox"
        ? "https://sandbox.plaid.com"
        : PLAID_ENV === "development"
        ? "https://development.plaid.com"
        : "https://production.plaid.com";

    // Exchange public token for access token
    const exchangeRes = await fetch(`${plaidBaseUrl}/item/public_token/exchange`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: PLAID_CLIENT_ID,
        secret: PLAID_SECRET,
        public_token,
      }),
    });

    const exchangeData = await exchangeRes.json();

    if (!exchangeRes.ok) {
      console.error("Plaid exchange error:", exchangeData);
      return new Response(
        JSON.stringify({ error: exchangeData.error_message || "Failed to exchange token" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { access_token, item_id } = exchangeData;

    // Get household_id using the service role to insert into plaid_items
    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Get household_id for this user
    const { data: profile } = await serviceClient
      .from("profiles")
      .select("household_id")
      .eq("user_id", claimsData.claims.sub)
      .single();

    if (!profile) {
      return new Response(JSON.stringify({ error: "Profile not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Store the Plaid item (without access_token — that goes to plaid_tokens)
    const { data: plaidItem, error: insertError } = await serviceClient
      .from("plaid_items")
      .insert({
        household_id: profile.household_id,
        item_id,
        institution_name: institution_name || "",
      })
      .select()
      .single();

    if (insertError) {
      console.error("Insert plaid_items error:", insertError);
      return new Response(JSON.stringify({ error: "Failed to save bank connection" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Store access token in secure plaid_tokens table (service-role only access)
    const { error: tokenInsertError } = await serviceClient
      .from("plaid_tokens")
      .insert({
        plaid_item_id: plaidItem.id,
        access_token,
      });

    if (tokenInsertError) {
      console.error("Insert plaid_tokens error:", tokenInsertError);
      // Roll back the plaid_items row to avoid an orphan
      await serviceClient.from("plaid_items").delete().eq("id", plaidItem.id);
      return new Response(JSON.stringify({ error: "Failed to save bank connection token" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Store the accounts from Plaid
    if (accounts && Array.isArray(accounts)) {
      const accountRows = accounts.map((acc: Record<string, string>) => ({
        plaid_item_id: plaidItem.id,
        household_id: profile.household_id,
        plaid_account_id: acc.id,
        name: acc.name || "",
        official_name: acc.official_name || null,
        type: acc.type || "",
        subtype: acc.subtype || null,
        mask: acc.mask || null,
      }));

      await serviceClient.from("plaid_accounts").insert(accountRows);
    }

    return new Response(
      JSON.stringify({
        success: true,
        item_id: plaidItem.id,
        accounts: accounts || [],
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error exchanging token:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
