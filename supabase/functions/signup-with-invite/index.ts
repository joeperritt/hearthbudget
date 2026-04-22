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
}

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const FROM = "Keeper <hello@keeperbudget.com>";

async function sendWelcomeEmail(to: string, firstName: string) {
  if (!RESEND_API_KEY) {
    console.warn("RESEND_API_KEY not set, skipping welcome email");
    return;
  }
  const html = `
<!doctype html><html><body style="margin:0;padding:0;background:#F5F1EA;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F5F1EA;padding:40px 20px;">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;max-width:560px;">
        <tr><td style="background:#1A2332;padding:32px;text-align:center;">
          <div style="display:inline-block;width:48px;height:48px;border-radius:10px;background:#fff;line-height:48px;color:#1A2332;font-family:Georgia,serif;font-weight:700;font-size:24px;">K</div>
        </td></tr>
        <tr><td style="padding:40px 32px;color:#1A2332;">
          <h1 style="font-family:Georgia,serif;font-size:26px;margin:0 0 16px;">Welcome to Keeper, ${firstName}.</h1>
          <p style="font-size:15px;line-height:1.6;color:#3a4759;margin:0 0 16px;">Your household is ready. We've seeded a starter budget — categories, fixed expenses, savings buckets, and giving items — so you can dive in immediately.</p>
          <p style="font-size:15px;line-height:1.6;color:#3a4759;margin:0 0 24px;">Open Keeper, head to the Budget tab, and tailor it to your family's life. We're glad you're here.</p>
          <a href="https://keeperbudget.com" style="display:inline-block;background:#C9A84C;color:#1A2332;text-decoration:none;font-weight:600;padding:12px 24px;border-radius:8px;font-size:14px;">Open Keeper</a>
        </td></tr>
        <tr><td style="padding:24px 32px;border-top:1px solid #eee;text-align:center;font-size:12px;color:#8a93a3;">
          Keeper · Budgeting together.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: FROM,
        to: [to],
        subject: "Welcome to Keeper",
        html,
        text: `Welcome to Keeper, ${firstName}. Your household is ready with a starter budget. Open https://keeperbudget.com to get started.\n\nKeeper · Budgeting together.`,
      }),
    });
  } catch (e) {
    console.error("welcome email failed", e);
  }
}

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
    const { email, password, first_name, last_name, invite_code } = body;

    if (!email || !password || !first_name) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const emailAddress = email.trim().toLowerCase();
    const siteUrl = req.headers.get("origin") ?? "https://keeperbudget.com";

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

    // Resolve household: join existing or create new
    let householdId = targetHouseholdId;
    let role: "admin" | "member" = "member";
    if (!householdId) {
      const { data: hh, error: hhErr } = await admin
        .from("households")
        .insert({ name: `${first_name}'s Household` })
        .select()
        .single();
      if (hhErr || !hh) {
        return new Response(JSON.stringify({ error: "Could not create household" }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      householdId = hh.id;
      role = "admin";
      await seedHouseholdDefaults(admin, householdId);
    }

    await admin.from("profiles").insert({
      user_id: userId,
      household_id: householdId,
      display_name,
      avatar_initial,
    });
    await admin.from("user_roles").insert({ user_id: userId, role });

    // Mark invite used
    if (inviteRow) {
      await admin.from("invites").update({
        used_at: new Date().toISOString(),
        used_by: userId,
      }).eq("id", inviteRow.id);
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

    // Send welcome email after the confirmation email is queued.
    await sendWelcomeEmail(emailAddress, first_name);

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
