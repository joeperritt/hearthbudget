import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const FROM = "Keeper <hello@keeperbudget.com>";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user?.email) return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

    if (!RESEND_API_KEY) {
      return new Response(JSON.stringify({ ok: true, skipped: "no_resend_key" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
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
          <h1 style="font-family:Georgia,serif;font-size:24px;margin:0 0 16px;">Your password was changed</h1>
          <p style="font-size:15px;line-height:1.6;color:#3a4759;margin:0 0 16px;">This is a security notice that your Keeper password was just changed.</p>
          <p style="font-size:15px;line-height:1.6;color:#3a4759;margin:0 0 16px;"><strong>If this was you</strong>, no action is needed.</p>
          <p style="font-size:15px;line-height:1.6;color:#b91c1c;margin:0 0 24px;"><strong>If this wasn't you</strong>, reset your password immediately and contact us.</p>
        </td></tr>
        <tr><td style="padding:24px 32px;border-top:1px solid #eee;text-align:center;font-size:12px;color:#8a93a3;">
          Keeper · Budgeting together.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: FROM,
        to: [user.email],
        subject: "Your Keeper password was changed",
        html,
        text: "Your Keeper password was just changed. If this wasn't you, reset your password immediately.\n\nKeeper · Budgeting together.",
      }),
    });

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
