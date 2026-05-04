// Self-service password change dialog.
//
// Flow:
//   Step 1 (passwords): user enters current password, new password, confirm.
//                       Submit calls change-password edge function WITHOUT mfa.
//                       - If 200: success. Sign out (revoke this session) and prompt re-login.
//                       - If 400 with mfa_required: advance to Step 2 with method picker.
//                       - If 401/429: show inline error / countdown.
//   Step 2 (mfa):       user picks TOTP or email, submits 6-digit code.
//                       Backend re-verifies current password + code in one call.
//                       (We re-send all 3 fields so the backend can perform
//                       password verification + MFA verification atomically.)
//
// Security notice is shown on both steps.

import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, ShieldAlert, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { PasswordStrengthMeter } from "@/components/auth/PasswordStrengthMeter";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type Methods = { totp: boolean; email: boolean };
type Step = "form" | "mfa" | "done";

export function ChangePasswordDialog({ open, onOpenChange }: Props) {
  const { signOut } = useAuth();
  const { toast } = useToast();

  const [step, setStep] = useState<Step>("form");
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Lockout countdown (seconds remaining)
  const [lockedSeconds, setLockedSeconds] = useState(0);

  // MFA step state
  const [methods, setMethods] = useState<Methods>({ totp: false, email: false });
  const [method, setMethod] = useState<"totp" | "email">("totp");
  const [code, setCode] = useState("");
  const [emailSending, setEmailSending] = useState(false);
  const [emailSent, setEmailSent] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);

  // Countdown ticker
  useEffect(() => {
    if (lockedSeconds <= 0) return;
    const t = setInterval(() => setLockedSeconds((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, [lockedSeconds]);
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const t = setInterval(() => setResendCooldown((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, [resendCooldown]);

  // Reset everything when dialog closes
  const resetRef = useRef<() => void>();
  resetRef.current = () => {
    setStep("form");
    setCurrent("");
    setNext("");
    setConfirm("");
    setSubmitting(false);
    setError(null);
    setLockedSeconds(0);
    setMethods({ totp: false, email: false });
    setMethod("totp");
    setCode("");
    setEmailSending(false);
    setEmailSent(false);
    setResendCooldown(0);
  };
  useEffect(() => {
    if (!open) resetRef.current?.();
  }, [open]);

  const passwordsValid = useMemo(() => {
    if (!current || !next || !confirm) return false;
    if (next.length < 12) return false;
    if (next !== confirm) return false;
    if (next === current) return false;
    return true;
  }, [current, next, confirm]);

  const formattedLockout = useMemo(() => {
    const m = Math.floor(lockedSeconds / 60);
    const s = lockedSeconds % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  }, [lockedSeconds]);

  // === Submit ===

  // Build payload (optionally including MFA), call edge function, handle response.
  const callChangePassword = async (mfa?: { method: "totp" | "email"; code: string }) => {
    setSubmitting(true);
    setError(null);
    try {
      const { data, error: invErr } = await supabase.functions.invoke("change-password", {
        body: {
          current_password: current,
          new_password: next,
          ...(mfa ? { mfa_method: mfa.method, mfa_code: mfa.code } : {}),
        },
      });

      // supabase-js folds non-2xx into invErr; the JSON body is in data when present,
      // but for non-2xx the SDK puts the parsed body on (invErr as any).context?.
      // Easiest: just look at both.
      const body =
        (data as any) ??
        (invErr && (invErr as any).context && (await safeReadJson((invErr as any).context))) ??
        null;

      if (invErr && (!body || !body.ok)) {
        const status = (invErr as any).context?.status as number | undefined;
        const msg: string = body?.error ?? invErr.message ?? "Could not change password";

        // Lockout
        if (status === 429 || body?.locked) {
          const minutes = body?.retry_after_minutes ?? 15;
          setLockedSeconds(minutes * 60);
          setError(msg);
          return;
        }

        // MFA required → switch to step 2
        if (status === 400 && body?.mfa_required) {
          setMethods({ totp: !!body.methods?.totp, email: !!body.methods?.email });
          setMethod(body.methods?.totp ? "totp" : "email");
          setStep("mfa");
          setError(null);
          return;
        }

        // MFA failed (already on step 2) — clear code, show error
        if (status === 401 && body?.mfa_failed) {
          setCode("");
          setError(msg);
          return;
        }

        setError(msg);
        // After wrong-current-password, stay on form
        return;
      }

      // Success
      setStep("done");
      toast({
        title: "Password updated",
        description: "You'll be signed out on every device. Sign in again with your new password.",
      });
      // Brief pause so the user can read the toast, then sign out.
      setTimeout(() => {
        void signOut();
      }, 1500);
    } finally {
      setSubmitting(false);
    }
  };

  const handlePasswordSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!passwordsValid || submitting || lockedSeconds > 0) return;
    void callChangePassword();
  };

  const handleMfaSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (code.length !== 6 || submitting || lockedSeconds > 0) return;
    void callChangePassword({ method, code });
  };

  // Auto-send email code when user switches to email method on step 2
  const sendEmailCode = async () => {
    setEmailSending(true);
    setError(null);
    try {
      const { data, error: err } = await supabase.functions.invoke("mfa-email-send", {
        body: { purpose: "step_up" },
      });
      if (err) {
        const ctxStatus = (err as any).context?.status as number | undefined;
        const ctxBody = (err as any).context
          ? await safeReadJson((err as any).context)
          : null;
        const msg = ctxBody?.error ?? err.message ?? "Could not send code";
        if (ctxStatus === 429 && ctxBody?.retry_after_seconds) {
          setResendCooldown(ctxBody.retry_after_seconds);
        }
        setError(msg);
      } else if (data?.cooldown_seconds) {
        setResendCooldown(data.cooldown_seconds);
        setEmailSent(true);
      } else {
        setResendCooldown(60);
        setEmailSent(true);
      }
    } finally {
      setEmailSending(false);
    }
  };

  // When the user picks email for the first time, auto-send.
  useEffect(() => {
    if (step === "mfa" && method === "email" && !emailSent && !emailSending && resendCooldown === 0) {
      void sendEmailCode();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, method]);

  const close = () => {
    if (submitting) return;
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display">Change password</DialogTitle>
          <DialogDescription>
            {step === "mfa"
              ? "Enter a code from your second factor to confirm this change."
              : "Update the password used to sign in to your account."}
          </DialogDescription>
        </DialogHeader>

        {/* Security notice */}
        <div className="rounded-md border border-accent/30 bg-accent/10 px-3 py-2.5 flex items-start gap-2">
          <ShieldAlert size={14} className="text-accent shrink-0 mt-0.5" />
          <p className="text-[11px] leading-relaxed text-foreground">
            Changing your password will sign you out of all trusted devices. You'll need to verify
            two-factor again on each device.
          </p>
        </div>

        {/* === Step 1: passwords === */}
        {step === "form" && (
          <form onSubmit={handlePasswordSubmit} className="space-y-3">
            <div>
              <Label htmlFor="current-pw" className="text-xs">Current password</Label>
              <Input
                id="current-pw"
                type="password"
                autoComplete="current-password"
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
                disabled={submitting || lockedSeconds > 0}
                className="mt-1"
              />
            </div>

            <div>
              <Label htmlFor="new-pw" className="text-xs">New password</Label>
              <Input
                id="new-pw"
                type="password"
                autoComplete="new-password"
                value={next}
                onChange={(e) => setNext(e.target.value)}
                disabled={submitting || lockedSeconds > 0}
                className="mt-1"
              />
              <PasswordStrengthMeter password={next} />
            </div>

            <div>
              <Label htmlFor="confirm-pw" className="text-xs">Confirm new password</Label>
              <Input
                id="confirm-pw"
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                disabled={submitting || lockedSeconds > 0}
                className="mt-1"
              />
              {confirm && next !== confirm && (
                <p className="text-[11px] text-destructive mt-1">Passwords don't match.</p>
              )}
              {confirm && next && next === current && (
                <p className="text-[11px] text-destructive mt-1">
                  New password must be different from current.
                </p>
              )}
            </div>

            {error && lockedSeconds === 0 && (
              <p className="text-xs text-destructive">{error}</p>
            )}
            {lockedSeconds > 0 && (
              <p className="text-xs text-destructive">
                Too many failed attempts. Try again in {formattedLockout}.
              </p>
            )}

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={close}
                disabled={submitting}
                className="flex-1 px-4 py-2 rounded-md border border-border text-sm font-medium hover:bg-muted disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!passwordsValid || submitting || lockedSeconds > 0}
                className="flex-1 px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {submitting && <Loader2 size={14} className="animate-spin" />}
                Update password
              </button>
            </div>
          </form>
        )}

        {/* === Step 2: MFA === */}
        {step === "mfa" && (
          <form onSubmit={handleMfaSubmit} className="space-y-4">
            {methods.totp && methods.email && (
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setMethod("totp")}
                  className={`px-3 py-2 rounded-md border text-xs font-semibold transition ${
                    method === "totp"
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-card border-border text-foreground hover:bg-muted"
                  }`}
                >
                  Authenticator app
                </button>
                <button
                  type="button"
                  onClick={() => setMethod("email")}
                  className={`px-3 py-2 rounded-md border text-xs font-semibold transition ${
                    method === "email"
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-card border-border text-foreground hover:bg-muted"
                  }`}
                >
                  Email code
                </button>
              </div>
            )}

            <div>
              <p className="text-xs text-muted-foreground mb-2">
                {method === "totp"
                  ? "Enter the 6-digit code from your authenticator app."
                  : emailSending
                    ? "Sending code to your email…"
                    : emailSent
                      ? "We sent a 6-digit code to your email. It expires in 10 minutes."
                      : "Tap Send code to receive a 6-digit code by email."}
              </p>
              <div className="flex justify-center">
                <InputOTP
                  maxLength={6}
                  value={code}
                  onChange={setCode}
                  disabled={submitting || lockedSeconds > 0 || (method === "email" && !emailSent)}
                >
                  <InputOTPGroup>
                    <InputOTPSlot index={0} />
                    <InputOTPSlot index={1} />
                    <InputOTPSlot index={2} />
                    <InputOTPSlot index={3} />
                    <InputOTPSlot index={4} />
                    <InputOTPSlot index={5} />
                  </InputOTPGroup>
                </InputOTP>
              </div>

              {method === "email" && (
                <div className="flex justify-center mt-2">
                  <button
                    type="button"
                    onClick={() => void sendEmailCode()}
                    disabled={emailSending || resendCooldown > 0}
                    className="text-[11px] text-primary hover:underline disabled:text-muted-foreground disabled:no-underline"
                  >
                    {emailSending
                      ? "Sending…"
                      : resendCooldown > 0
                        ? `Resend in ${resendCooldown}s`
                        : emailSent
                          ? "Resend code"
                          : "Send code"}
                  </button>
                </div>
              )}
            </div>

            {error && lockedSeconds === 0 && (
              <p className="text-xs text-destructive text-center">{error}</p>
            )}
            {lockedSeconds > 0 && (
              <p className="text-xs text-destructive text-center">
                Too many failed attempts. Try again in {formattedLockout}.
              </p>
            )}

            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={() => {
                  setStep("form");
                  setCode("");
                  setError(null);
                }}
                disabled={submitting}
                className="flex-1 px-4 py-2 rounded-md border border-border text-sm font-medium hover:bg-muted disabled:opacity-60"
              >
                Back
              </button>
              <button
                type="submit"
                disabled={code.length !== 6 || submitting || lockedSeconds > 0}
                className="flex-1 px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {submitting && <Loader2 size={14} className="animate-spin" />}
                Confirm change
              </button>
            </div>
          </form>
        )}

        {step === "done" && (
          <div className="py-4 text-center">
            <p className="text-sm text-foreground font-semibold">Password updated</p>
            <p className="text-xs text-muted-foreground mt-1">Signing you out…</p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// Best-effort parse of an error context Response (Supabase SDK FunctionsHttpError).
async function safeReadJson(ctx: any): Promise<any | null> {
  try {
    if (typeof ctx?.json === "function") return await ctx.json();
    if (typeof ctx?.text === "function") {
      const t = await ctx.text();
      try {
        return JSON.parse(t);
      } catch {
        return { error: t };
      }
    }
    return null;
  } catch {
    return null;
  }
}
