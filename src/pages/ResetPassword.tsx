import { useEffect, useState, FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";

export default function ResetPassword() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [tokenError, setTokenError] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    // Supabase puts the recovery token in the URL hash and exchanges it on load
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") setReady(true);
    });
    // Also check session
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setReady(true);
      else setTimeout(() => {
        supabase.auth.getSession().then(({ data: d2 }) => {
          if (d2.session) setReady(true);
          else setTokenError("This reset link is invalid or has expired.");
        });
      }, 800);
    });
    return () => subscription.unsubscribe();
  }, []);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    if (password.length < 8) { setError("At least 8 characters"); return; }
    if (password !== confirm) { setError("Passwords do not match"); return; }
    setLoading(true);
    const { error: updErr } = await supabase.auth.updateUser({ password });
    if (updErr) {
      setLoading(false);
      setError(updErr.message);
      return;
    }
    setLoading(false);
    setDone(true);
    setTimeout(() => navigate("/"), 2000);
  };

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-2xl bg-primary flex items-center justify-center mx-auto mb-4 shadow-lg">
            <span className="text-primary-foreground font-display text-2xl font-bold">K</span>
          </div>
          <h1 className="font-display text-2xl font-bold text-foreground">Set a new password</h1>
        </div>

        <div className="bg-card rounded-2xl shadow-sm p-6">
          {tokenError ? (
            <>
              <p className="text-sm text-destructive text-center">{tokenError}</p>
              <Link to="/forgot-password" className="block text-center text-xs text-accent mt-4">Request a new link</Link>
            </>
          ) : done ? (
            <p className="text-sm text-foreground text-center">Password updated. Redirecting…</p>
          ) : !ready ? (
            <p className="text-xs text-muted-foreground text-center">Validating link…</p>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">New password</label>
                <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="new-password" className="auth-input mt-1" />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Confirm password</label>
                <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required autoComplete="new-password" className="auth-input mt-1" />
              </div>
              {error && <p className="text-xs text-destructive text-center">{error}</p>}
              <button type="submit" disabled={loading}
                className="w-full py-3 rounded-xl bg-accent text-accent-foreground font-semibold text-sm active:scale-[0.98] transition-transform shadow-sm disabled:opacity-50">
                {loading ? "Updating…" : "Update password"}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
