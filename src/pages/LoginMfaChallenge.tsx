import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

const LOCK_KEY = 'keeper.mfa.lockedUntil';
const RECOVERY_LOCK_KEY = 'keeper.mfa.recoveryLockedUntil';
const RECOVERY_FLAG_KEY = 'keeper.lastAuthMethod';

type Mode = 'totp' | 'recovery';

export default function LoginMfaChallenge() {
  const { pendingMfa, cancelMfaChallenge, completeMfaChallenge } = useAuth();
  const [mode, setMode] = useState<Mode>('totp');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  // Unified lock — any failures (TOTP or recovery) hitting the limit. Blocks TOTP path.
  const [lockedUntil, setLockedUntil] = useState<number | null>(() => {
    const v = localStorage.getItem(LOCK_KEY);
    return v ? Number(v) : null;
  });
  // Recovery-only lock — only recovery failures count. Blocks recovery path.
  const [recoveryLockedUntil, setRecoveryLockedUntil] = useState<number | null>(() => {
    const v = localStorage.getItem(RECOVERY_LOCK_KEY);
    return v ? Number(v) : null;
  });
  const [now, setNow] = useState(Date.now());
  const inputRef = useRef<HTMLInputElement>(null);

  // Tick for countdown
  useEffect(() => {
    if (!lockedUntil && !recoveryLockedUntil) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [lockedUntil, recoveryLockedUntil]);

  // Clear locks when expired
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
    inputRef.current?.focus();
  }, [mode]);

  // TOTP path is blocked by the unified lock.
  // Recovery path is blocked ONLY by the recovery-specific lock (hybrid policy).
  const totpLocked = !!(lockedUntil && now < lockedUntil);
  const recoveryLocked = !!(recoveryLockedUntil && now < recoveryLockedUntil);
  const isLocked = mode === 'totp' ? totpLocked : recoveryLocked;
  const activeLockUntil = mode === 'totp' ? lockedUntil : recoveryLockedUntil;
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

  const handleVerifyTotp = async () => {
    if (!pendingMfa) return;
    setSubmitting(true);
    setError('');
    try {
      const { data: challenge, error: chErr } = await supabase.auth.mfa.challenge({
        factorId: pendingMfa.factorId,
      });
      if (chErr || !challenge) throw chErr ?? new Error('Could not start challenge');
      const { error: vErr } = await supabase.auth.mfa.verify({
        factorId: pendingMfa.factorId,
        challengeId: challenge.id,
        code,
      });
      if (vErr) {
        await callLogAttempt(false);
        setCode('');
        setError('Invalid code. Try again.');
        // Refetch to check if we just hit the limit
        const { data } = await supabase.functions.invoke('mfa-log-attempt', {
          body: { action: 'preflight' },
        });
        if (data?.locked) setLock(data.retry_after_minutes ?? 15);
        if (data?.recovery_locked) setRecoveryLock(15);
      } else {
        await callLogAttempt(true);
        // Clear any per-session recovery banner — user successfully used TOTP
        localStorage.removeItem(RECOVERY_FLAG_KEY);
        await completeMfaChallenge();
      }
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
        // Recovery path locked-out (5 recovery failures in 15min).
        // Recovery failures also count toward the unified lock, so block TOTP too.
        setRecoveryLock(data.retry_after_minutes ?? 15);
        setLock(data.retry_after_minutes ?? 15);
        setError(data.error ?? 'Too many attempts.');
      } else if (data?.ok) {
        // Set banner flag with remaining count
        localStorage.setItem(
          RECOVERY_FLAG_KEY,
          JSON.stringify({
            method: 'recovery_code',
            remaining: data.remaining ?? 0,
            at: Date.now(),
          }),
        );
        // Tell AuthProvider to use recovery bypass path
        (window as any).__keeperRecoveryBypass = true;
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
    else void handleVerifyRecovery();
  };

  const totpReady = mode === 'totp' && code.length === 6;
  const recoveryReady = mode === 'recovery' && code.replace(/[^A-Za-z0-9]/g, '').length >= 8;
  const canSubmit = !submitting && !isLocked && (totpReady || recoveryReady);

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

        <form onSubmit={handleSubmit} className="bg-card rounded-2xl shadow-sm p-6 space-y-4">
          {mode === 'totp' ? (
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
          ) : (
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
              {mode === 'totp' && !recoveryLocked && (
                <button
                  type="button"
                  onClick={() => {
                    setMode('recovery');
                    setCode('');
                    setError('');
                  }}
                  className="text-xs text-accent mt-2 underline"
                >
                  Use a recovery code instead
                </button>
              )}
            </div>
          )}

          <button
            type="submit"
            disabled={!canSubmit}
            className="w-full py-3 rounded-xl bg-accent text-accent-foreground font-semibold text-sm active:scale-[0.98] transition-transform shadow-sm disabled:opacity-50"
          >
            {submitting ? 'Verifying…' : 'Verify'}
          </button>

          <div className="flex items-center justify-between text-xs pt-1">
            {mode === 'totp' ? (
              <button
                type="button"
                onClick={() => {
                  setMode('recovery');
                  setCode('');
                  setError('');
                }}
                className="text-accent"
              >
                Use a recovery code instead
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setMode('totp');
                  setCode('');
                  setError('');
                }}
                className="text-accent"
              >
                Use authenticator code
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
