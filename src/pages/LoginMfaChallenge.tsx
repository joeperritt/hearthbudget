import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { setTrustedDeviceToken } from '@/lib/trustedDevice';

const LOCK_KEY = 'keeper.mfa.lockedUntil';
const RECOVERY_LOCK_KEY = 'keeper.mfa.recoveryLockedUntil';
const RECOVERY_FLAG_KEY = 'keeper.lastAuthMethod';

type Mode = 'totp' | 'email' | 'recovery';

export default function LoginMfaChallenge() {
  const { pendingMfa, cancelMfaChallenge, completeMfaChallenge } = useAuth();
  const hasTotp = !!pendingMfa?.totpFactorId;
  const hasEmail = !!pendingMfa?.hasEmail;
  const both = hasTotp && hasEmail;

  // Default mode: last_used_method if both, else the only enrolled method, else totp.
  const initialMode: Mode = (() => {
    if (both) return pendingMfa?.lastUsedMethod === 'email' ? 'email' : 'totp';
    if (hasTotp) return 'totp';
    if (hasEmail) return 'email';
    return 'totp';
  })();

  const [mode, setMode] = useState<Mode>(initialMode);
  const [rememberDevice, setRememberDevice] = useState(false);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [emailSentTo, setEmailSentTo] = useState<string | null>(null);
  const [emailSending, setEmailSending] = useState(false);
  const [emailCooldown, setEmailCooldown] = useState(0);
  const [emailAutoSent, setEmailAutoSent] = useState(false);
  const [lockedUntil, setLockedUntil] = useState<number | null>(() => {
    const v = localStorage.getItem(LOCK_KEY);
    return v ? Number(v) : null;
  });
  const [recoveryLockedUntil, setRecoveryLockedUntil] = useState<number | null>(() => {
    const v = localStorage.getItem(RECOVERY_LOCK_KEY);
    return v ? Number(v) : null;
  });
  const [now, setNow] = useState(Date.now());
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!lockedUntil && !recoveryLockedUntil && emailCooldown <= 0) return;
    const t = setInterval(() => {
      setNow(Date.now());
      setEmailCooldown(c => (c > 0 ? c - 1 : 0));
    }, 1000);
    return () => clearInterval(t);
  }, [lockedUntil, recoveryLockedUntil, emailCooldown]);

  useEffect(() => {
    if (lockedUntil && now >= lockedUntil) {
      localStorage.removeItem(LOCK_KEY);
      setLockedUntil(null);
    }
    if (recoveryLockedUntil && now >= recoveryLockedUntil) {
      localStorage.removeItem(RECOVERY_LOCK_KEY);
      setRecoveryLockedUntil(null);
    }
  }, [now, lockedUntil, recoveryLockedUntil]);

  useEffect(() => {
    setCode('');
    setError('');
    inputRef.current?.focus();
  }, [mode]);

  const totpLocked = !!(lockedUntil && now < lockedUntil);
  const recoveryLocked = !!(recoveryLockedUntil && now < recoveryLockedUntil);
  const isLocked = mode === 'recovery' ? recoveryLocked : totpLocked;
  const activeLockUntil = mode === 'recovery' ? recoveryLockedUntil : lockedUntil;
  const lockMinutesLeft = isLocked
    ? Math.max(1, Math.ceil((activeLockUntil! - now) / 60000))
    : 0;

  const setLock = (minutes: number) => {
    const until = Date.now() + minutes * 60 * 1000;
    localStorage.setItem(LOCK_KEY, String(until));
    setLockedUntil(until);
  };

  const setRecoveryLock = (minutes: number) => {
    const until = Date.now() + minutes * 60 * 1000;
    localStorage.setItem(RECOVERY_LOCK_KEY, String(until));
    setRecoveryLockedUntil(until);
  };

  const callLogAttempt = async (success: boolean) => {
    try {
      const { data } = await supabase.functions.invoke('mfa-log-attempt', {
        body: { success, action: 'log' },
      });
      if (data?.locked) setLock(data.retry_after_minutes ?? 15);
      if (data?.recovery_locked) setRecoveryLock(15);
    } catch (e) {
      console.error('mfa-log-attempt failed', e);
    }
  };

  const mintTrustIfChosen = async () => {
    if (!rememberDevice) return;
    try {
      const { data } = await supabase.functions.invoke('mfa-trust-device', { body: {} });
      const { data: userRes } = await supabase.auth.getUser();
      const uid = userRes.user?.id;
      if (uid && data?.token) setTrustedDeviceToken(uid, data.token);
    } catch (e) {
      console.warn('trust-device mint failed', e);
    }
  };

  const sendEmailCode = async () => {
    if (emailSending || emailCooldown > 0 || isLocked) return;
    setEmailSending(true);
    setError('');
    try {
      const { data, error: invokeErr } = await supabase.functions.invoke(
        'mfa-email-send',
        { body: { purpose: 'login' } },
      );
      if (invokeErr) {
        const ctx = (invokeErr as { context?: Response }).context;
        let msg: string | null = null;
        let retry = 0;
        if (ctx && typeof ctx.json === 'function') {
          try {
            const body = await ctx.clone().json();
            msg = body?.error ?? null;
            retry = Number(body?.retry_after_seconds ?? 0);
          } catch { /* ignore */ }
        }
        setError(msg ?? 'Could not send code.');
        if (retry > 0) setEmailCooldown(Math.min(retry, 60));
        return;
      }
      setEmailSentTo(data?.sent_to ?? pendingMfa?.emailSnapshot ?? null);
      setEmailCooldown(60);
    } finally {
      setEmailSending(false);
    }
  };

  // Auto-send the email code once when entering email mode for the first time.
  useEffect(() => {
    if (mode === 'email' && !emailAutoSent && !isLocked) {
      setEmailAutoSent(true);
      void sendEmailCode();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  const handleVerifyTotp = async () => {
    if (!pendingMfa?.totpFactorId) return;
    setSubmitting(true);
    setError('');
    try {
      const { data: challenge, error: chErr } = await supabase.auth.mfa.challenge({
        factorId: pendingMfa.totpFactorId,
      });
      if (chErr || !challenge) throw chErr ?? new Error('Could not start challenge');
      const { error: vErr } = await supabase.auth.mfa.verify({
        factorId: pendingMfa.totpFactorId,
        challengeId: challenge.id,
        code,
      });
      if (vErr) {
        await callLogAttempt(false);
        setCode('');
        setError('Invalid code. Try again.');
        const { data } = await supabase.functions.invoke('mfa-log-attempt', {
          body: { action: 'preflight' },
        });
        if (data?.locked) setLock(data.retry_after_minutes ?? 15);
        if (data?.recovery_locked) setRecoveryLock(15);
      } else {
        await callLogAttempt(true);
        localStorage.removeItem(RECOVERY_FLAG_KEY);
        // Record method preference
        try {
          await supabase.auth.getUser().then(({ data: u }) => {
            if (u.user) supabase.from('user_mfa_method_pref').upsert(
              { user_id: u.user.id, last_used_method: 'totp' },
              { onConflict: 'user_id' },
            );
          });
        } catch { /* ignore */ }
        await mintTrustIfChosen();
        await completeMfaChallenge();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Verification failed');
    } finally {
      setSubmitting(false);
    }
  };

  const handleVerifyEmail = async () => {
    setSubmitting(true);
    setError('');
    try {
      const { data, error: invokeErr } = await supabase.functions.invoke(
        'mfa-email-verify',
        { body: { code, purpose: 'login' } },
      );
      if (invokeErr || !data?.ok) {
        const ctx = (invokeErr as { context?: Response } | undefined)?.context;
        let msg: string | null = null;
        let locked = false;
        if (ctx && typeof ctx.json === 'function') {
          try {
            const body = await ctx.clone().json();
            msg = body?.error ?? null;
            if (body?.locked) {
              locked = true;
              setLock(body.retry_after_minutes ?? 15);
            }
          } catch { /* ignore */ }
        }
        if (!locked) setCode('');
        setError(msg ?? 'Invalid code. Try again.');
        return;
      }
      // Email verify succeeds at AAL1 — use the bypass mechanism
      // (same path as recovery codes) to clear the MFA gate for this session.
      (window as any).__keeperRecoveryBypass = true;
      localStorage.removeItem(RECOVERY_FLAG_KEY);
      await mintTrustIfChosen();
      await completeMfaChallenge();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Verification failed');
    } finally {
      setSubmitting(false);
    }
  };

  const handleVerifyRecovery = async () => {
    setSubmitting(true);
    setError('');
    try {
      const { data, error: fnErr } = await supabase.functions.invoke(
        'mfa-verify-recovery-code',
        { body: { code } },
      );
      if (fnErr) throw fnErr;
      if (data?.locked) {
        setRecoveryLock(data.retry_after_minutes ?? 15);
        setLock(data.retry_after_minutes ?? 15);
        setError(data.error ?? 'Too many attempts.');
      } else if (data?.ok) {
        localStorage.setItem(
          RECOVERY_FLAG_KEY,
          JSON.stringify({
            method: 'recovery_code',
            remaining: data.remaining ?? 0,
            at: Date.now(),
          }),
        );
        (window as any).__keeperRecoveryBypass = true;
        await mintTrustIfChosen();
        await completeMfaChallenge();
      } else {
        setCode('');
        setError(data?.error ?? 'Invalid code. Try again.');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Verification failed');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isLocked || submitting) return;
    if (mode === 'totp') void handleVerifyTotp();
    else if (mode === 'email') void handleVerifyEmail();
    else void handleVerifyRecovery();
  };

  const numericReady = code.length === 6;
  const recoveryReady = code.replace(/[^A-Za-z0-9]/g, '').length >= 8;
  const canSubmit =
    !submitting && !isLocked &&
    ((mode === 'totp' && numericReady) ||
     (mode === 'email' && numericReady) ||
     (mode === 'recovery' && recoveryReady));

  const staleSnapshot =
    mode === 'email' &&
    pendingMfa?.emailSnapshot &&
    pendingMfa?.currentEmail &&
    pendingMfa.emailSnapshot.toLowerCase() !== pendingMfa.currentEmail.toLowerCase();

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <div className="text-center mb-10">
          <div className="w-16 h-16 rounded-2xl bg-primary flex items-center justify-center mx-auto mb-4 shadow-lg">
            <span className="text-primary-foreground font-display text-2xl font-bold">K</span>
          </div>
          <h1 className="font-display text-3xl font-bold text-foreground">Two-factor required</h1>
          <p className="text-muted-foreground text-sm mt-1.5">
            {pendingMfa?.email ? `Signed in as ${pendingMfa.email}` : 'Verify your identity'}
          </p>
        </div>

        {both && mode !== 'recovery' && (
          <div className="bg-card rounded-xl shadow-sm p-1.5 mb-3 grid grid-cols-2 gap-1">
            <button
              type="button"
              onClick={() => setMode('totp')}
              className={`py-2 rounded-lg text-xs font-semibold transition ${
                mode === 'totp'
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-muted'
              }`}
            >
              Authenticator app
            </button>
            <button
              type="button"
              onClick={() => setMode('email')}
              className={`py-2 rounded-lg text-xs font-semibold transition ${
                mode === 'email'
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-muted'
              }`}
            >
              Email code
            </button>
          </div>
        )}

        <form onSubmit={handleSubmit} className="bg-card rounded-2xl shadow-sm p-6 space-y-4">
          {mode === 'totp' && (
            <>
              <p className="text-sm text-muted-foreground">
                Enter the 6-digit code from your authenticator app.
              </p>
              <input
                ref={inputRef}
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="000000"
                disabled={isLocked || submitting}
                className="w-full px-3 py-3 rounded-lg bg-background border border-border text-center text-2xl tracking-[0.4em] font-mono text-foreground focus:outline-none focus:ring-2 focus:ring-accent/30 disabled:opacity-50"
              />
            </>
          )}

          {mode === 'email' && (
            <>
              <p className="text-sm text-muted-foreground">
                {emailSending && !emailSentTo
                  ? 'Sending code…'
                  : emailSentTo
                    ? <>We sent a 6-digit code to <strong className="text-foreground">{emailSentTo}</strong>. It expires in 10 minutes.</>
                    : 'Tap "Send code" to receive a 6-digit code.'}
              </p>
              {staleSnapshot && (
                <div className="rounded-lg bg-accent/10 border border-accent/30 p-3 text-xs leading-relaxed flex items-start gap-2">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-accent shrink-0 mt-0.5"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z"/><line x1="12" x2="12" y1="9" y2="13"/><line x1="12" x2="12.01" y1="17" y2="17"/></svg>
                  <p className="text-foreground">
                    Codes are sent to <strong className="break-all">{pendingMfa!.emailSnapshot}</strong>.
                    Re-enroll from Security after signing in to update.
                  </p>
                </div>
              )}
              <input
                ref={inputRef}
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="000000"
                disabled={isLocked || submitting}
                className="w-full px-3 py-3 rounded-lg bg-background border border-border text-center text-2xl tracking-[0.4em] font-mono text-foreground focus:outline-none focus:ring-2 focus:ring-accent/30 disabled:opacity-50"
              />
              <button
                type="button"
                onClick={() => void sendEmailCode()}
                disabled={emailSending || emailCooldown > 0 || isLocked}
                className="text-xs text-accent w-full text-center disabled:opacity-50"
              >
                {emailSending
                  ? 'Sending…'
                  : emailCooldown > 0
                    ? `Resend code in ${emailCooldown}s`
                    : emailSentTo
                      ? 'Resend code'
                      : 'Send code'}
              </button>
            </>
          )}

          {mode === 'recovery' && (
            <>
              <p className="text-sm text-muted-foreground">
                Enter one of your saved recovery codes.
              </p>
              <input
                ref={inputRef}
                type="text"
                autoComplete="off"
                autoCapitalize="characters"
                value={code}
                onChange={e => setCode(e.target.value.toUpperCase().slice(0, 16))}
                placeholder="XXXXX-XXXXX"
                disabled={isLocked || submitting}
                className="w-full px-3 py-3 rounded-lg bg-background border border-border text-center text-lg tracking-widest font-mono text-foreground focus:outline-none focus:ring-2 focus:ring-accent/30 disabled:opacity-50"
              />
            </>
          )}

          {error && (
            <p className="text-xs text-destructive text-center">{error}</p>
          )}

          {isLocked && (
            <div className="rounded-lg bg-destructive/10 border border-destructive/20 p-3 text-center">
              <p className="text-xs text-destructive font-medium">
                Too many attempts. Try again in {lockMinutesLeft}{' '}
                {lockMinutesLeft === 1 ? 'minute' : 'minutes'}.
              </p>
              {mode !== 'recovery' && !recoveryLocked && (
                <button
                  type="button"
                  onClick={() => setMode('recovery')}
                  className="text-xs text-accent mt-2 underline"
                >
                  Use a recovery code instead
                </button>
              )}
            </div>
          )}

          <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none">
            <input
              type="checkbox"
              checked={rememberDevice}
              onChange={e => setRememberDevice(e.target.checked)}
              disabled={submitting || isLocked}
              className="w-4 h-4 rounded border-border text-accent focus:ring-accent/30"
            />
            <span>Remember this device for 30 days</span>
          </label>

          <button
            type="submit"
            disabled={!canSubmit}
            className="w-full py-3 rounded-xl bg-accent text-accent-foreground font-semibold text-sm active:scale-[0.98] transition-transform shadow-sm disabled:opacity-50"
          >
            {submitting ? 'Verifying…' : 'Verify'}
          </button>

          <div className="flex items-center justify-between text-xs pt-1">
            {mode !== 'recovery' ? (
              <button
                type="button"
                onClick={() => setMode('recovery')}
                className="text-accent"
              >
                Use a recovery code instead
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setMode(hasTotp ? 'totp' : 'email')}
                className="text-accent"
              >
                {hasTotp ? 'Use authenticator code' : 'Use email code'}
              </button>
            )}
            <button
              type="button"
              onClick={() => void cancelMfaChallenge()}
              className="text-muted-foreground"
            >
              Cancel
            </button>
          </div>
        </form>

        <p className="text-center text-[11px] text-muted-foreground/50 mt-8">
          Keeper · Two-factor authentication
        </p>
      </div>
    </div>
  );
}
