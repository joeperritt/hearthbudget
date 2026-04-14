import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const adminClient = createClient(supabaseUrl, supabaseServiceKey);

    // Check if household already exists
    const { data: existingHouseholds } = await adminClient
      .from("households")
      .select("id")
      .limit(1);

    if (existingHouseholds && existingHouseholds.length > 0) {
      return new Response(
        JSON.stringify({ message: "Already seeded", household_id: existingHouseholds[0].id }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const body = await req.json();
    const { joe_email, joe_password, katie_email, katie_password } = body;

    // Create household
    const { data: household, error: hhError } = await adminClient
      .from("households")
      .insert({ name: "Perritt Family" })
      .select()
      .single();

    if (hhError) throw hhError;

    // Create Joe (admin)
    const { data: joeAuth, error: joeError } =
      await adminClient.auth.admin.createUser({
        email: joe_email,
        password: joe_password,
        email_confirm: true,
      });
    if (joeError) throw joeError;

    await adminClient.from("profiles").insert({
      user_id: joeAuth.user.id,
      household_id: household.id,
      display_name: "Joe",
      avatar_initial: "J",
    });
    await adminClient.from("user_roles").insert({
      user_id: joeAuth.user.id,
      role: "admin",
    });

    // Create Katie (member)
    const { data: katieAuth, error: katieError } =
      await adminClient.auth.admin.createUser({
        email: katie_email,
        password: katie_password,
        email_confirm: true,
      });
    if (katieError) throw katieError;

    await adminClient.from("profiles").insert({
      user_id: katieAuth.user.id,
      household_id: household.id,
      display_name: "Katie",
      avatar_initial: "K",
    });
    await adminClient.from("user_roles").insert({
      user_id: katieAuth.user.id,
      role: "member",
    });

    // Seed default budget categories
    const categories = [
      { slug: "car-gas", name: "Car/Gas", budgeted: 375, group: "shared", sort_order: 0 },
      { slug: "groceries", name: "Groceries", budgeted: 700, group: "shared", sort_order: 1 },
      { slug: "household", name: "Household", budgeted: 100, group: "shared", sort_order: 2 },
      { slug: "kids", name: "Kids", budgeted: 500, group: "shared", sort_order: 3 },
      { slug: "dates", name: "Dates", budgeted: 450, group: "shared", sort_order: 4 },
      { slug: "dog", name: "Dog", budgeted: 75, group: "shared", sort_order: 5 },
      { slug: "gifts", name: "Gifts", budgeted: 100, group: "shared", sort_order: 6 },
      { slug: "random", name: "Random", budgeted: 150, group: "shared", sort_order: 7 },
      { slug: "hosting-gifts", name: "Hosting/Gifts/Random", budgeted: 800, group: "shared", sort_order: 8 },
      { slug: "j-eating", name: "J-EO", budgeted: 100, group: "joe", sort_order: 0 },
      { slug: "j-misc", name: "J-Misc", budgeted: 250, group: "joe", sort_order: 1 },
      { slug: "k-eating", name: "K-EO", budgeted: 100, group: "katie", sort_order: 0 },
      { slug: "k-misc", name: "K-Misc", budgeted: 200, group: "katie", sort_order: 1 },
      { slug: "k-selfcare", name: "K-SC", budgeted: 100, group: "katie", sort_order: 2 },
    ].map((c) => ({ ...c, household_id: household.id }));

    await adminClient.from("budget_categories").insert(categories);

    // Seed default fixed expenses
    const expenses = [
      { slug: "mortgage", name: "Mortgage", amount: 3611.5, group: "bills", sort_order: 0 },
      { slug: "tahoe", name: "Tahoe", amount: 512.15, group: "bills", sort_order: 1 },
      { slug: "perritts", name: "To Perritts", amount: 80.02, group: "bills", sort_order: 2 },
      { slug: "dominion", name: "Dominion", amount: 269.0, group: "bills", sort_order: 3 },
      { slug: "water", name: "Water", amount: 150.0, group: "bills", sort_order: 4 },
      { slug: "spectrum", name: "Spectrum", amount: 40.0, group: "bills", sort_order: 5 },
      { slug: "clarks", name: "Clarks", amount: 64.2, group: "bills", sort_order: 6 },
      { slug: "lpl-ltd", name: "LPL LTD", amount: 53.33, group: "bills", sort_order: 7 },
      { slug: "jp-haircut", name: "JP Haircut", amount: 30.69, group: "bills", sort_order: 8 },
      { slug: "take5", name: "Take5", amount: 48.0, group: "bills", sort_order: 9 },
      { slug: "claude", name: "Claude", amount: 21.4, group: "bills", sort_order: 10 },
      { slug: "ymca", name: "YMCA", amount: 59.72, group: "bills", sort_order: 11 },
      { slug: "spotify", name: "Spotify", amount: 5.0, group: "bills", sort_order: 12 },
      { slug: "miguel", name: "Miguel", amount: 150.0, group: "bills", sort_order: 13 },
      { slug: "nuuly", name: "Nuuly", amount: 104.86, group: "bills", sort_order: 14 },
      { slug: "seed-inc", name: "Seed Inc", amount: 53.49, group: "bills", sort_order: 15 },
      { slug: "groomer", name: "Groomer", amount: 95.0, group: "bills", sort_order: 16 },
      { slug: "pets-best", name: "Pet's Best", amount: 53.36, group: "bills", sort_order: 17 },
      { slug: "cars-savings", name: "Cars", amount: 500, group: "savings", sort_order: 0 },
      { slug: "vacations", name: "Vacations", amount: 400, group: "savings", sort_order: 1 },
      { slug: "trash", name: "Trash", amount: 30, group: "savings", sort_order: 2 },
      { slug: "dog-savings", name: "Dog", amount: 50, group: "savings", sort_order: 3 },
      { slug: "hoa", name: "HOA", amount: 285, group: "savings", sort_order: 4 },
      { slug: "radius", name: "Radius", amount: 1100, group: "tithe", sort_order: 0 },
      { slug: "ccc", name: "CCC", amount: 700, group: "tithe", sort_order: 1 },
      { slug: "od", name: "OD", amount: 300, group: "tithe", sort_order: 2 },
      { slug: "co-ef", name: "CO-EF", amount: 100, group: "tithe", sort_order: 3 },
    ].map((e) => ({ ...e, household_id: household.id }));

    await adminClient.from("fixed_expenses").insert(expenses);

    return new Response(
      JSON.stringify({
        success: true,
        household_id: household.id,
        joe_id: joeAuth.user.id,
        katie_id: katieAuth.user.id,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
