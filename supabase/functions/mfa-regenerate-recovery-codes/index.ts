// Regenerate MFA recovery codes.
// - Authenticates the caller via JWT
// - Generates 10 cryptographically-random codes
// - Bcrypt-hashes each code and replaces all existing rows for the user
// - Returns plaintext codes ONCE in the response
// - Writes an audit log row (recovery_codes_regenerated)
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import bcrypt from "npm:bcryptjs@2.4.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Generates a 10-character base32-style code (no ambiguous chars), formatted XXXXX-XXXXX
function generateRecoveryCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < 10; i++) out += alphabet[bytes[i] % alphabet.length];
  return `${out.slice(0, 5)}-${out.slice(5)}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing Authorization header" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Validate the user's JWT
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userRes, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userRes.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = userRes.user.id;

    // Service-role client for write operations (RLS blocks direct inserts on these tables)
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Generate 10 codes and hash them
    const plaintext: string[] = [];
    const rows: { user_id: string; code_hash: string }[] = [];
    for (let i = 0; i < 10; i++) {
      const code = generateRecoveryCode();
      plaintext.push(code);
      const hash = await bcrypt.hash(code, 10);
      rows.push({ user_id: userId, code_hash: hash });
    }

    // Replace any existing codes (consumed or not) atomically: delete then insert.
    const { error: delErr } = await admin
      .from("user_mfa_recovery_codes")
      .delete()
      .eq("user_id", userId);
    if (delErr) throw delErr;

    const { error: insErr } = await admin.from("user_mfa_recovery_codes").insert(rows);
    if (insErr) throw insErr;

    // Audit log
    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      req.headers.get("cf-connecting-ip") ||
      null;
    const ua = req.headers.get("user-agent") || null;
    await admin.from("mfa_audit_log").insert({
      user_id: userId,
      event: "recovery_codes_regenerated",
      ip_address: ip,
      user_agent: ua,
      metadata: { count: plaintext.length },
    });

    return new Response(JSON.stringify({ codes: plaintext }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("mfa-regenerate-recovery-codes error", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Internal error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
