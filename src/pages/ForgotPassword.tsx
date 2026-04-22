import { useState, FormEvent } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { getPublicOrigin } from "@/lib/publicOrigin";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    // Always succeed silently to prevent enumeration
    await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${getPublicOrigin()}/reset-password`,
    });
    setLoading(false);
    setDone(true);
  };

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-2xl bg-primary flex items-center justify-center mx-auto mb-4 shadow-lg">
            <span className="text-primary-foreground font-display text-2xl font-bold">K</span>
          </div>
          <h1 className="font-display text-2xl font-bold text-foreground">Reset password</h1>
        </div>

        <div className="bg-card rounded-2xl shadow-sm p-6">
          {done ? (
            <p className="text-sm text-foreground text-center">
              If an account exists for that email, a password reset link has been sent.
            </p>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Email</label>
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email"
                  className="auth-input mt-1" placeholder="you@example.com" />
              </div>
              <button type="submit" disabled={loading}
                className="w-full py-3 rounded-xl bg-accent text-accent-foreground font-semibold text-sm active:scale-[0.98] transition-transform shadow-sm disabled:opacity-50">
                {loading ? "Sending…" : "Send reset link"}
              </button>
            </form>
          )}
          <Link to="/" className="block text-center text-xs text-accent mt-6">Back to login</Link>
        </div>
      </div>
    </div>
  );
}
