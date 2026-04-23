import { useEffect, useMemo, useRef, useState, FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Turnstile, TurnstileInstance } from "@marsidev/react-turnstile";
import { supabase } from "@/integrations/supabase/client";
import { isPasswordPwned, validatePassword } from "@/lib/passwordSecurity";
import { PasswordStrengthMeter } from "@/components/auth/PasswordStrengthMeter";

const TURNSTILE_SITE_KEY = "0x4AAAAAADB5OO8QdBIkaJ9K";

type SignupMode = "admin_only" | "invite_only" | "open";

export default function Signup() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const inviteFromUrl = params.get("invite") ?? "";

  const [mode, setMode] = useState<SignupMode | null>(null);
  const [inviteCode, setInviteCode] = useState(inviteFromUrl);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);
  const [captchaToken, setCaptchaToken] = useState("");
  const turnstileRef = useRef<TurnstileInstance | null>(null);

  useEffect(() => {
    supabase.from("app_config").select("signup_mode").eq("id", 1).single()
      .then(({ data }) => setMode((data?.signup_mode as SignupMode) ?? "invite_only"));
  }, []);

  const passwordCheck = useMemo(() => validatePassword(password), [password]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");

    if (!passwordCheck.ok) { setError(passwordCheck.issues[0]); return; }
    if (password !== confirm) { setError("Passwords do not match"); return; }

    setLoading(true);
    const pwned = await isPasswordPwned(password);
    if (pwned) {
      setLoading(false);
      setError("This password has appeared in a known data breach. Please choose another.");
      return;
    }

    const { data, error: invokeErr } = await supabase.functions.invoke("signup-with-invite", {
      body: {
        email: email.trim(),
        password,
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        invite_code: inviteCode.trim() || undefined,
      },
    });
    setLoading(false);
    if (invokeErr || (data as any)?.error) {
      setError((data as any)?.error ?? invokeErr?.message ?? "Signup failed");
      return;
    }
    setDone(true);
  };

  if (mode === "admin_only") {
    return (
      <Shell>
        <p className="text-sm text-foreground text-center">
          Keeper is currently invite-only. Contact your household admin for access.
        </p>
        <Link to="/" className="block text-center text-xs text-accent mt-4">Back to login</Link>
      </Shell>
    );
  }

  if (done) {
    return (
      <Shell>
        <h2 className="font-display text-xl text-foreground text-center">Check your email</h2>
        <p className="text-sm text-muted-foreground text-center mt-3">
          We sent a verification link to <strong>{email}</strong>. Click it to activate your account.
        </p>
        <Link to="/" className="block text-center text-xs text-accent mt-6">Back to login</Link>
      </Shell>
    );
  }

  return (
    <Shell>
      <form onSubmit={handleSubmit} className="space-y-4">
        {mode === "invite_only" && (
          <Field label="Invite code">
            <input value={inviteCode} onChange={(e) => setInviteCode(e.target.value)} required
              className="auth-input" placeholder="Enter your invite code" />
          </Field>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="First name">
            <input value={firstName} onChange={(e) => setFirstName(e.target.value)} required className="auth-input" />
          </Field>
          <Field label="Last name">
            <input value={lastName} onChange={(e) => setLastName(e.target.value)} className="auth-input" />
          </Field>
        </div>
        <Field label="Email">
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" className="auth-input" />
        </Field>
        <Field label="Password">
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="new-password" className="auth-input" />
          <PasswordStrengthMeter password={password} />
        </Field>
        <Field label="Confirm password">
          <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required autoComplete="new-password" className="auth-input" />
        </Field>

        {error && <p className="text-xs text-destructive text-center">{error}</p>}

        <button type="submit" disabled={loading}
          className="w-full py-3 rounded-xl bg-accent text-accent-foreground font-semibold text-sm active:scale-[0.98] transition-transform shadow-sm disabled:opacity-50">
          {loading ? "Creating account…" : "Create account"}
        </button>
        <p className="text-center text-xs text-muted-foreground">
          Already have an account? <Link to="/" className="text-accent">Log in</Link>
        </p>
      </form>
    </Shell>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{label}</label>
      <div className="mt-1">{children}</div>
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-6 py-10">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-2xl bg-primary flex items-center justify-center mx-auto mb-4 shadow-lg">
            <span className="text-primary-foreground font-display text-2xl font-bold">K</span>
          </div>
          <h1 className="font-display text-3xl font-bold text-foreground">Keeper</h1>
          <p className="text-muted-foreground text-sm mt-1.5">Create your household</p>
        </div>
        <div className="bg-card rounded-2xl shadow-sm p-6">{children}</div>
      </div>
    </div>
  );
}
