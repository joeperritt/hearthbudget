import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { seedHouseholdDefaults } from "../_shared/seed-defaults.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface SignupBody {
  email: string;
  password: string;
  first_name: string;
  last_name: string;
  invite_code?: string;
  captcha_token?: string;
  stewardship_mode?: boolean;
  has_kids?: boolean;
  has_pets?: boolean;
}

async function verifyTurnstile(token: string, ip: string | null): Promise<boolean> {
  const secret = Deno.env.get("TURNSTILE_SECRET_KEY");
  if (!secret) {
    console.error("TURNSTILE_SECRET_KEY not configured");
    return false;
  }
  try {
    const form = new FormData();
    form.append("secret", secret);
    form.append("response", token);
    if (ip) form.append("remoteip", ip);
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body: form,
    });
    const data = await res.json();
    return Boolean(data?.success);
  } catch (e) {
    console.error("Turnstile verify failed", e);
    return false;
  }
}

// Welcome email is sent by send-welcome-email after email verification.

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const publishableKey =
      Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ??
      Deno.env.get("SUPABASE_ANON_KEY");
    const admin = createClient(supabaseUrl, serviceKey);

    if (!publishableKey) {
      throw new Error("Missing Supabase publishable key");
    }

    const publicClient = createClient(supabaseUrl, publishableKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    const body: SignupBody = await req.json();
    const { email, password, first_name, last_name, invite_code, captcha_token } = body;

    if (!email || !password || !first_name) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verify Turnstile CAPTCHA only if a secret is configured (allows staged rollout).
    if (Deno.env.get("TURNSTILE_SECRET_KEY")) {
      if (!captcha_token) {
        return new Response(JSON.stringify({ error: "Please complete the security check." }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const ip = req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
      const ok = await verifyTurnstile(captcha_token, ip);
      if (!ok) {
        return new Response(JSON.stringify({ error: "Security check failed. Please try again." }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const emailAddress = email.trim().toLowerCase();
    // Always route confirmation links to the public production domain — preview/lovable hosts
    // require Lovable login and break end-user verification flows.
    const siteUrl = "https://keeperbudget.com";

    // Check signup mode
    const { data: cfg } = await admin.from("app_config").select("signup_mode").eq("id", 1).single();
    const mode = cfg?.signup_mode ?? "invite_only";

    if (mode === "admin_only") {
      return new Response(JSON.stringify({
        error: "Keeper is currently invite-only. Contact your household admin for access.",
      }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    let inviteRow: any = null;
    let targetHouseholdId: string | null = null;

    if (mode === "invite_only") {
      if (!invite_code) {
        return new Response(JSON.stringify({ error: "An invite code is required." }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { data: inv } = await admin.from("invites").select("*").eq("code", invite_code).maybeSingle();
      if (!inv) return new Response(JSON.stringify({ error: "Invalid invite code." }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
      if (inv.revoked_at) return new Response(JSON.stringify({ error: "This invite has been revoked." }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
      if (inv.used_at) return new Response(JSON.stringify({ error: "This invite has already been used." }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
      if (new Date(inv.expires_at) < new Date()) return new Response(JSON.stringify({ error: "This invite has expired." }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
      if (inv.email && inv.email.toLowerCase() !== emailAddress) {
        return new Response(JSON.stringify({ error: "This invite is locked to a different email address." }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      inviteRow = inv;
      targetHouseholdId = inv.household_id; // null = create their own
    }

    // Admin user creation does not send a confirmation email, so we trigger it explicitly below.
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email: emailAddress,
      password,
      email_confirm: false,
      user_metadata: { first_name, last_name },
    });
    if (createErr || !created.user) {
      return new Response(JSON.stringify({ error: createErr?.message ?? "Could not create account" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = created.user.id;
    const display_name = `${first_name}${last_name ? " " + last_name : ""}`.trim();
    const avatar_initial = (first_name?.[0] ?? "U").toUpperCase();

    // Resolve household: join existing or create new.
    // Track everything we create so we can roll back if any step fails.
    let householdId = targetHouseholdId;
    let role: "household_admin" | "household_member" =
      targetHouseholdId ? "household_member" : "household_admin";
    let createdHouseholdId: string | null = null;
    let createdProfile = false;
    let createdRole = false;

    const rollback = async () => {
      try {
        if (createdRole) {
          await admin.from("user_roles").delete().eq("user_id", userId);
        }
        if (createdProfile) {
          await admin.from("profiles").delete().eq("user_id", userId);
        }
        if (createdHouseholdId) {
          await admin.from("budget_categories").delete().eq("household_id", createdHouseholdId);
          await admin.from("fixed_expenses").delete().eq("household_id", createdHouseholdId);
          await admin.from("households").delete().eq("id", createdHouseholdId);
        }
        await admin.auth.admin.deleteUser(userId);
      } catch (e) {
        console.error("rollback failed", e);
      }
    };

    try {
      if (!householdId) {
        const { data: hh, error: hhErr } = await admin
          .from("households")
          .insert({ name: `${first_name}'s Household` })
          .select()
          .single();
        if (hhErr || !hh) throw new Error(hhErr?.message ?? "Could not create household");
        householdId = hh.id;
        createdHouseholdId = hh.id;
        await seedHouseholdDefaults(admin, householdId);
      }

      const { error: profErr } = await admin.from("profiles").insert({
        user_id: userId,
        household_id: householdId,
        display_name,
        avatar_initial,
      });
      if (profErr) throw new Error(`Profile insert failed: ${profErr.message}`);
      createdProfile = true;

      const { error: roleErr } = await admin.from("user_roles").insert({
        user_id: userId,
        role,
        household_id: householdId,
      });
      if (roleErr) throw new Error(`Role insert failed: ${roleErr.message}`);
      createdRole = true;

      if (inviteRow) {
        const { error: invErr } = await admin.from("invites").update({
          used_at: new Date().toISOString(),
          used_by: userId,
        }).eq("id", inviteRow.id);
        if (invErr) throw new Error(`Invite update failed: ${invErr.message}`);
      }
    } catch (txErr) {
      console.error("signup transaction failed, rolling back", txErr);
      await rollback();
      return new Response(JSON.stringify({ error: String(txErr) }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { error: resendErr } = await publicClient.auth.resend({
      type: "signup",
      email: emailAddress,
      options: {
        emailRedirectTo: siteUrl,
      },
    });

    if (resendErr) {
      console.error("signup confirmation resend failed", resendErr);
      return new Response(JSON.stringify({
        error: resendErr.message ?? "Could not send confirmation email",
      }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Welcome email is sent later, after the user verifies their email
    // (via the on_auth_user_email_confirmed trigger -> send-welcome-email function).

    return new Response(JSON.stringify({
      success: true,
      user_id: userId,
      household_id: householdId,
      role,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
