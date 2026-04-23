import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const FROM = "Keeper <hello@keeperbudget.com>";

function buildHtml(firstName: string) {
  return `
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
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { user_id } = await req.json();
    if (!user_id) {
      return new Response(JSON.stringify({ error: "Missing user_id" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: userRes, error: userErr } = await admin.auth.admin.getUserById(user_id);
    if (userErr || !userRes?.user) {
      return new Response(JSON.stringify({ error: userErr?.message ?? "User not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const user = userRes.user;
    const email = user.email!;
    const firstName = (user.user_metadata?.first_name as string | undefined)
      ?? (user.user_metadata?.full_name as string | undefined)?.split(" ")[0]
      ?? "there";

    if (!RESEND_API_KEY) {
      console.warn("RESEND_API_KEY not set, skipping welcome email");
      return new Response(JSON.stringify({ skipped: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: FROM,
        to: [email],
        subject: "Welcome to Keeper",
        html: buildHtml(firstName),
        text: `Welcome to Keeper, ${firstName}. Your household is ready with a starter budget. Open https://keeperbudget.com to get started.\n\nKeeper · Budgeting together.`,
      }),
    });

    if (!resp.ok) {
      const body = await resp.text();
      console.error("welcome email send failed", resp.status, body);
      return new Response(JSON.stringify({ error: body }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("send-welcome-email error", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
