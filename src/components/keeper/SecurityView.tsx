import { useEffect, useState } from 'react';
import { ArrowLeft, ShieldCheck, ShieldOff, LogOut, Loader2, Copy, Download, RefreshCw, KeyRound, Check, AlertTriangle, Smartphone, X, Lock, Mail } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp';
import { DisableMfaDialog } from '@/components/auth/DisableMfaDialog';
import { DisableEmailMfaDialog } from '@/components/auth/DisableEmailMfaDialog';
import { EmailMfaEnrollDialog } from '@/components/auth/EmailMfaEnrollDialog';
import { useAdminMfaGraceState } from '@/components/auth/AdminMfaBanner';
import { getTrustedDeviceToken, clearTrustedDeviceToken } from '@/lib/trustedDevice';
import { ChangePasswordDialog } from '@/components/auth/ChangePasswordDialog';

interface SecurityViewProps {
  onBack: () => void;
}

type EnrollState =
  | { status: 'idle' }
  | { status: 'enrolling' }
  | { status: 'pending'; factorId: string; qr: string; secret: string; code: string; verifying: boolean; error: string | null }
  | { status: 'codes'; codes: string[] };

async function logAudit(event: string, metadata: Record<string, unknown> = {}) {
  try {
    await supabase.functions.invoke('mfa-audit-log', { body: { event, metadata } });
  } catch (e) {
    console.warn('audit log failed', e);
  }
}

export function SecurityView({ onBack }: SecurityViewProps) {
  const { profile, user } = useAuth();
  const { toast } = useToast();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  // MFA state
  const [mfaLoading, setMfaLoading] = useState(true);
  const [hasVerifiedFactor, setHasVerifiedFactor] = useState(false);
  const [emailFactor, setEmailFactor] = useState<{ verified_email: string } | null>(null);
  const [enroll, setEnroll] = useState<EnrollState>({ status: 'idle' });
  const [regenOpen, setRegenOpen] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [copiedAll, setCopiedAll] = useState(false);
  const [disableOpen, setDisableOpen] = useState(false);
  const [disableEmailOpen, setDisableEmailOpen] = useState(false);
  const [emailEnrollOpen, setEmailEnrollOpen] = useState(false);
  const [changePwOpen, setChangePwOpen] = useState(false);
  const grace = useAdminMfaGraceState();

  useEffect(() => {
    void refreshFactors();
  }, []);

  const refreshFactors = async () => {
    setMfaLoading(true);
    const { data, error } = await supabase.auth.mfa.listFactors();
    if (!error) {
      const verified = (data?.totp ?? []).some((f) => f.status === 'verified');
      setHasVerifiedFactor(verified);
    }
    if (user?.id) {
      const { data: ef } = await supabase
        .from('user_mfa_email_factors')
        .select('verified_email, disabled_at')
        .eq('user_id', user.id)
        .maybeSingle();
      setEmailFactor(ef && !ef.disabled_at ? { verified_email: ef.verified_email } : null);
    }
    setMfaLoading(false);
  };

  // ===== Sign-out-others =====
  const handleSignOutOthers = async () => {
    setSigningOut(true);
    const { error } = await supabase.auth.signOut({ scope: 'others' });
    setSigningOut(false);
    setConfirmOpen(false);
    if (error) {
      toast({ title: 'Could not sign out other devices', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: 'Other devices signed out', description: 'All sessions except this one have been revoked.' });
    }
  };

  // ===== Enrollment =====
  const startEnroll = async () => {
    setEnroll({ status: 'enrolling' });

    // Clean up any unverified factors left over from a prior aborted attempt.
    const { data: list } = await supabase.auth.mfa.listFactors();
    for (const f of list?.totp ?? []) {
      if (f.status !== 'verified') {
        await supabase.auth.mfa.unenroll({ factorId: f.id });
      }
    }

    const { data, error } = await supabase.auth.mfa.enroll({
      factorType: 'totp',
      issuer: 'Keeper',
      friendlyName: `Keeper (${user?.email ?? profile?.display_name ?? 'account'})`,
    });
    if (error || !data) {
      setEnroll({ status: 'idle' });
      toast({ title: 'Could not start enrollment', description: error?.message ?? 'Unknown error', variant: 'destructive' });
      return;
    }
    void logAudit('enroll_started', { factor_id: data.id });
    setEnroll({
      status: 'pending',
      factorId: data.id,
      qr: data.totp.qr_code,
      secret: data.totp.secret,
      code: '',
      verifying: false,
      error: null,
    });
  };

  const cancelEnroll = async () => {
    if (enroll.status !== 'pending') return;
    await supabase.auth.mfa.unenroll({ factorId: enroll.factorId });
    setEnroll({ status: 'idle' });
  };

  const verifyEnroll = async () => {
    if (enroll.status !== 'pending') return;
    if (enroll.code.length !== 6) return;
    setEnroll({ ...enroll, verifying: true, error: null });

    const { data: chal, error: chalErr } = await supabase.auth.mfa.challenge({ factorId: enroll.factorId });
    if (chalErr || !chal) {
      setEnroll({ ...enroll, verifying: false, error: chalErr?.message ?? 'Could not start challenge' });
      void logAudit('enroll_failed', { reason: 'challenge_error' });
      return;
    }

    const { error: verErr } = await supabase.auth.mfa.verify({
      factorId: enroll.factorId,
      challengeId: chal.id,
      code: enroll.code,
    });
    if (verErr) {
      setEnroll({ ...enroll, verifying: false, code: '', error: 'Invalid code, try again' });
      void logAudit('enroll_failed', { reason: 'invalid_code' });
      return;
    }

    void logAudit('enroll_verified', { factor_id: enroll.factorId });

    // If user already has another verified factor (email), recovery codes
    // already exist and don't need to be regenerated.
    if (emailFactor) {
      setHasVerifiedFactor(true);
      setEnroll({ status: 'idle' });
      toast({ title: 'Authenticator app enabled' });
      return;
    }

    // Generate recovery codes via edge function (first factor enrollment)
    const { data: regenData, error: regenErr } = await supabase.functions.invoke(
      'mfa-regenerate-recovery-codes',
      { body: {} },
    );
    if (regenErr || !regenData?.codes) {
      // CRITICAL: Recovery codes failed. Roll back the TOTP factor so the user
      // is NOT left with 2FA enabled and no recovery codes (lockout risk).
      const { error: unenrollErr } = await supabase.auth.mfa.unenroll({ factorId: enroll.factorId });
      void logAudit('enroll_failed', {
        reason: 'recovery_codes_failed',
        regen_error: regenErr?.message ?? null,
        unenroll_error: unenrollErr?.message ?? null,
      });
      toast({
        title: 'Could not enable two-factor',
        description:
          'Recovery codes failed to generate, so we rolled back the setup. Please try again.' +
          (unenrollErr ? ' If your authenticator app still shows a Keeper entry, please remove it.' : ''),
        variant: 'destructive',
      });
      setHasVerifiedFactor(false);
      setEnroll({ status: 'idle' });
      return;
    }

    setHasVerifiedFactor(true);
    setEnroll({ status: 'codes', codes: regenData.codes });
  };

  const regenerate = async () => {
    setRegenerating(true);
    const { data, error } = await supabase.functions.invoke('mfa-regenerate-recovery-codes', { body: {} });
    setRegenerating(false);
    setRegenOpen(false);
    if (error || !data?.codes) {
      toast({ title: 'Could not regenerate codes', description: error?.message ?? 'Unknown error', variant: 'destructive' });
      return;
    }
    setEnroll({ status: 'codes', codes: data.codes });
  };

  const copyAllCodes = async (codes: string[]) => {
    try {
      await navigator.clipboard.writeText(codes.join('\n'));
      setCopiedAll(true);
      setTimeout(() => setCopiedAll(false), 2000);
    } catch {
      toast({ title: 'Could not copy', variant: 'destructive' });
    }
  };

  const downloadCodes = (codes: string[]) => {
    const blob = new Blob(
      [
        `Keeper recovery codes for ${user?.email ?? 'your account'}\n`,
        `Generated: ${new Date().toISOString()}\n\n`,
        ...codes.map((c) => `${c}\n`),
        `\nEach code can be used once. Store them somewhere safe.\n`,
      ],
      { type: 'text/plain' },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'keeper-recovery-codes.txt';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="max-w-lg mx-auto pb-12">
      <div className="px-6 pt-12 safe-top flex items-center gap-3">
        <button
          onClick={onBack}
          aria-label="Back"
          className="w-9 h-9 rounded-full flex items-center justify-center hover:bg-muted active:scale-95 transition"
        >
          <ArrowLeft size={20} className="text-foreground" />
        </button>
        <div>
          <h1 className="font-display text-2xl lg:text-3xl font-bold tracking-tight text-foreground">Security</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Manage account access</p>
        </div>
      </div>

      <div className="px-6 mt-8 space-y-8">
        {/* ===== Two-factor section ===== */}
        <section>
          <h2 className="font-display text-lg font-semibold text-foreground mb-2">Two-factor authentication</h2>
          <p className="text-xs text-muted-foreground mb-4 leading-relaxed">
            We recommend an authenticator app (Google Authenticator, 1Password, Authy, etc.) — codes
            stay on your device and keep working even if your email is compromised. We'll also generate
            one-time recovery codes in case you lose access.
          </p>

          {grace.needsMfa && grace.inGrace && !hasVerifiedFactor && enroll.status === 'idle' && (
            <div className="mb-4 rounded-md border border-accent/30 bg-accent/10 px-4 py-3 flex items-start gap-3">
              <AlertTriangle size={16} className="text-accent shrink-0 mt-0.5" />
              <div className="text-xs leading-relaxed text-foreground">
                <p className="font-semibold">Two-factor will be required for admin accounts.</p>
                <p className="opacity-80 mt-0.5">
                  {grace.daysRemaining !== null
                    ? `You have ${grace.daysRemaining} day${grace.daysRemaining === 1 ? '' : 's'} left to set it up.`
                    : 'Set it up soon to keep access uninterrupted.'}
                </p>
              </div>
            </div>
          )}

          {mfaLoading ? (
            <div className="bg-card rounded-lg p-5 shadow-sm border border-border flex items-center gap-3">
              <Loader2 size={18} className="animate-spin text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Checking status…</span>
            </div>
          ) : enroll.status === 'pending' ? (
            <EnrollPanel
              qr={enroll.qr}
              secret={enroll.secret}
              code={enroll.code}
              verifying={enroll.verifying}
              error={enroll.error}
              onCodeChange={(v) => enroll.status === 'pending' && setEnroll({ ...enroll, code: v })}
              onVerify={verifyEnroll}
              onCancel={cancelEnroll}
              accountLabel={user?.email ?? profile?.display_name ?? 'Keeper'}
            />
          ) : enroll.status === 'codes' ? (
            <RecoveryCodesPanel
              codes={enroll.codes}
              copiedAll={copiedAll}
              onCopyAll={() => copyAllCodes(enroll.codes)}
              onDownload={() => downloadCodes(enroll.codes)}
              onDone={() => setEnroll({ status: 'idle' })}
            />
          ) : (
            <div className="space-y-3">
              {/* TOTP factor card */}
              {hasVerifiedFactor ? (
                <div className="bg-card rounded-lg p-4 shadow-sm border border-border flex items-start gap-3">
                  <div className="w-10 h-10 rounded-full bg-accent/10 flex items-center justify-center shrink-0">
                    <ShieldCheck size={20} className="text-accent" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-foreground">
                      Authenticator app <span className="text-[10px] uppercase tracking-wide text-accent ml-1">Recommended · On</span>
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">Codes generated on your device.</p>
                    <button
                      onClick={() => setDisableOpen(true)}
                      className="text-xs text-destructive font-medium mt-2 hover:underline"
                    >
                      Disable authenticator app
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={startEnroll}
                  disabled={enroll.status === 'enrolling'}
                  className="w-full flex items-center gap-4 bg-card rounded-lg p-4 shadow-sm text-left active:scale-[0.98] transition-transform border border-border disabled:opacity-60"
                >
                  <div className="w-10 h-10 rounded-full bg-accent/10 flex items-center justify-center shrink-0">
                    {enroll.status === 'enrolling' ? (
                      <Loader2 size={20} className="text-accent animate-spin" />
                    ) : (
                      <KeyRound size={20} className="text-accent" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-foreground">
                      Set up authenticator app <span className="text-[10px] uppercase tracking-wide text-accent ml-1">Recommended</span>
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">Strongest option — codes generated on your device.</p>
                  </div>
                </button>
              )}

              {/* Email factor card */}
              {emailFactor ? (
                <div className="bg-card rounded-lg p-4 shadow-sm border border-border flex items-start gap-3">
                  <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                    <Mail size={20} className="text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-foreground">
                      Email codes <span className="text-[10px] uppercase tracking-wide text-muted-foreground ml-1">Less secure · On</span>
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5 break-all">Sent to {emailFactor.verified_email}</p>
                    <button
                      onClick={() => setDisableEmailOpen(true)}
                      className="text-xs text-destructive font-medium mt-2 hover:underline"
                    >
                      Disable email codes
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setEmailEnrollOpen(true)}
                  className="w-full flex items-center gap-4 bg-card rounded-lg p-4 shadow-sm text-left active:scale-[0.98] transition-transform border border-border"
                >
                  <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                    <Mail size={20} className="text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-foreground">
                      Set up email codes <span className="text-[10px] uppercase tracking-wide text-muted-foreground ml-1">Alternative · Less secure</span>
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Use only if you can't install an authenticator app — anyone with email access can read the code.
                    </p>
                  </div>
                </button>
              )}

              {/* Recovery codes — only if any factor enrolled */}
              {(hasVerifiedFactor || emailFactor) && (
                <button
                  onClick={() => setRegenOpen(true)}
                  disabled={regenerating}
                  className="w-full flex items-center gap-4 bg-card rounded-lg p-4 shadow-sm text-left active:scale-[0.98] transition-transform border border-border disabled:opacity-60"
                >
                  <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                    {regenerating ? (
                      <Loader2 size={20} className="text-primary animate-spin" />
                    ) : (
                      <RefreshCw size={20} className="text-primary" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-foreground">Regenerate recovery codes</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Invalidates your current codes and creates 10 new ones.
                    </p>
                  </div>
                </button>
              )}
            </div>
          )}
        </section>

        {/* ===== Password section ===== */}
        <section>
          <h2 className="font-display text-lg font-semibold text-foreground mb-2">Password</h2>
          <p className="text-xs text-muted-foreground mb-4 leading-relaxed">
            Change the password used to sign in. Choose at least 12 characters with a mix of upper
            and lowercase letters and numbers. Changing your password signs you out of all trusted
            devices.
          </p>

          <button
            onClick={() => setChangePwOpen(true)}
            className="w-full flex items-center gap-4 bg-card rounded-lg p-4 shadow-sm text-left active:scale-[0.98] transition-transform border border-border"
          >
            <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
              <Lock size={20} className="text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-foreground">Change password</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Requires your current password
                {hasVerifiedFactor ? ' and a two-factor code' : ''}.
              </p>
            </div>
          </button>
        </section>

        {/* ===== Trusted devices section ===== */}
        {hasVerifiedFactor && (
          <section>
            <h2 className="font-display text-lg font-semibold text-foreground mb-2">Trusted devices</h2>
            <p className="text-xs text-muted-foreground mb-4 leading-relaxed">
              Devices where you chose "Remember this device" skip the two-factor prompt for 60 days.
              Revoke any device you no longer use or trust.
            </p>
            <TrustedDevicesSection userId={user?.id} />
          </section>
        )}

        {/* ===== Sign-out-others section (existing) ===== */}
        <section>
          <h2 className="font-display text-lg font-semibold text-foreground mb-2">Other devices</h2>
          <p className="text-xs text-muted-foreground mb-4 leading-relaxed">
            If you've signed in from a shared computer, lost a device, or suspect someone else has access to your
            account, sign out of all other devices below. You'll stay signed in here.
          </p>

          <button
            onClick={() => setConfirmOpen(true)}
            disabled={signingOut}
            className="w-full flex items-center gap-4 bg-card rounded-lg p-4 shadow-sm text-left active:scale-[0.98] transition-transform border border-border disabled:opacity-60 disabled:active:scale-100"
          >
            <div className="w-10 h-10 rounded-full bg-destructive/10 flex items-center justify-center shrink-0">
              {signingOut ? (
                <Loader2 size={20} className="text-destructive animate-spin" />
              ) : (
                <LogOut size={20} className="text-destructive" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-destructive">Sign out of all other devices</p>
              <p className="text-xs text-muted-foreground mt-0.5">Revokes every session except this one</p>
            </div>
          </button>

          <div className="text-xs text-muted-foreground leading-relaxed px-1 mt-4">
            <p>
              A per-device session list isn't currently available. This is the most reliable way to immediately cut
              off any other active session on your account.
            </p>
          </div>
        </section>
      </div>

      {/* Sign-out-others confirmation */}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display">Sign out of all other devices?</AlertDialogTitle>
            <AlertDialogDescription>
              Every other browser, phone, or tablet currently signed in to your account will be signed out. You'll
              stay signed in on this device. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={signingOut}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleSignOutOthers}
              disabled={signingOut}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {signingOut ? 'Signing out…' : 'Sign out other devices'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Regenerate confirmation */}
      <AlertDialog open={regenOpen} onOpenChange={setRegenOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display">Regenerate recovery codes?</AlertDialogTitle>
            <AlertDialogDescription>
              Your current 10 recovery codes will stop working immediately. You'll be shown 10 new codes once — make
              sure to save them somewhere safe.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={regenerating}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={regenerate} disabled={regenerating}>
              {regenerating ? 'Regenerating…' : 'Regenerate codes'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <DisableMfaDialog
        open={disableOpen}
        onOpenChange={setDisableOpen}
        onDisabled={() => {
          setHasVerifiedFactor(false);
          setEnroll({ status: 'idle' });
          void refreshFactors();
        }}
      />

      <ChangePasswordDialog open={changePwOpen} onOpenChange={setChangePwOpen} />
    </div>
  );
}

// ===== Sub-components =====

function EnrollPanel(props: {
  qr: string;
  secret: string;
  code: string;
  verifying: boolean;
  error: string | null;
  accountLabel: string;
  onCodeChange: (v: string) => void;
  onVerify: () => void;
  onCancel: () => void;
}) {
  const [copiedSecret, setCopiedSecret] = useState(false);
  const copySecret = async () => {
    await navigator.clipboard.writeText(props.secret);
    setCopiedSecret(true);
    setTimeout(() => setCopiedSecret(false), 2000);
  };

  // Supabase returns qr_code as either an SVG data URL or otpauth URI. Render the otpauth via QRCodeSVG for crispness if available.
  // The data URL form is also valid as an <img>.
  const isDataUrl = props.qr.startsWith('data:');

  return (
    <div className="bg-card rounded-lg p-5 shadow-sm border border-border space-y-4">
      <div>
        <p className="text-sm font-semibold text-foreground">Step 1 — Scan the QR code</p>
        <p className="text-xs text-muted-foreground mt-0.5">
          Open your authenticator app and scan. Keeper will appear as a new account.
        </p>
      </div>

      <div className="flex justify-center bg-background rounded-md p-4 border border-border">
        {isDataUrl ? (
          <img src={props.qr} alt="MFA QR code" width={180} height={180} />
        ) : (
          <QRCodeSVG value={props.qr} size={180} />
        )}
      </div>

      <div>
        <p className="text-xs font-semibold text-foreground mb-1">Can't scan? Enter this key manually:</p>
        <button
          onClick={copySecret}
          className="w-full font-mono text-xs bg-muted rounded-md px-3 py-2 text-left flex items-center justify-between gap-2 hover:bg-muted/70 transition"
        >
          <span className="break-all">{props.secret}</span>
          {copiedSecret ? <Check size={14} className="text-accent shrink-0" /> : <Copy size={14} className="text-muted-foreground shrink-0" />}
        </button>
      </div>

      <div>
        <p className="text-sm font-semibold text-foreground">Step 2 — Enter the 6-digit code</p>
        <p className="text-xs text-muted-foreground mt-0.5 mb-3">
          Type the current code shown in your authenticator app.
        </p>
        <div className="flex justify-center">
          <InputOTP maxLength={6} value={props.code} onChange={props.onCodeChange} disabled={props.verifying}>
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
        {props.error && <p className="text-xs text-destructive mt-2 text-center">{props.error}</p>}
      </div>

      <div className="flex gap-2 pt-2">
        <button
          onClick={props.onCancel}
          disabled={props.verifying}
          className="flex-1 px-4 py-2 rounded-md border border-border text-sm font-medium hover:bg-muted disabled:opacity-60"
        >
          Cancel
        </button>
        <button
          onClick={props.onVerify}
          disabled={props.verifying || props.code.length !== 6}
          className="flex-1 px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-60 flex items-center justify-center gap-2"
        >
          {props.verifying ? <Loader2 size={14} className="animate-spin" /> : null}
          Verify & enable
        </button>
      </div>
    </div>
  );
}

function RecoveryCodesPanel(props: {
  codes: string[];
  copiedAll: boolean;
  onCopyAll: () => void;
  onDownload: () => void;
  onDone: () => void;
}) {
  return (
    <div className="bg-card rounded-lg p-5 shadow-sm border border-border space-y-4">
      <div>
        <p className="text-sm font-semibold text-foreground">Save your recovery codes</p>
        <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
          Each code can be used once if you lose access to your authenticator. <strong>This is the only time we'll show
          them in plaintext</strong> — copy or download them now.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2 font-mono text-sm bg-muted rounded-md p-3">
        {props.codes.map((c) => (
          <div key={c} className="text-foreground">
            {c}
          </div>
        ))}
      </div>

      <div className="flex gap-2">
        <button
          onClick={props.onCopyAll}
          className="flex-1 px-4 py-2 rounded-md border border-border text-sm font-medium hover:bg-muted flex items-center justify-center gap-2"
        >
          {props.copiedAll ? <Check size={14} className="text-accent" /> : <Copy size={14} />}
          {props.copiedAll ? 'Copied' : 'Copy all'}
        </button>
        <button
          onClick={props.onDownload}
          className="flex-1 px-4 py-2 rounded-md border border-border text-sm font-medium hover:bg-muted flex items-center justify-center gap-2"
        >
          <Download size={14} />
          Download
        </button>
      </div>

      <button
        onClick={props.onDone}
        className="w-full px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90"
      >
        I've saved them — continue
      </button>
    </div>
  );
}

// ===== Trusted Devices Section =====

interface TrustedDeviceRow {
  id: string;
  device_label: string | null;
  created_at: string;
  expires_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
  token_hash: string;
}

export function TrustedDevicesSection({ userId }: { userId: string | null | undefined }) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [devices, setDevices] = useState<TrustedDeviceRow[]>([]);
  const [revokeId, setRevokeId] = useState<string | null>(null);
  const [revokingAll, setRevokingAll] = useState(false);

  const load = async () => {
    if (!userId) return;
    setLoading(true);
    const { data, error } = await supabase
      .from('mfa_trusted_devices')
      .select('id, device_label, created_at, expires_at, last_used_at, revoked_at, token_hash')
      .eq('user_id', userId)
      .is('revoked_at', null)
      .gt('expires_at', new Date().toISOString())
      .order('last_used_at', { ascending: false, nullsFirst: false });
    setLoading(false);
    if (error) {
      toast({ title: 'Could not load trusted devices', description: error.message, variant: 'destructive' });
      return;
    }
    setDevices((data ?? []) as TrustedDeviceRow[]);
  };

  useEffect(() => { void load(); /* eslint-disable-next-line */ }, [userId]);

  // SHA-256 hex of the local token, to identify which row is "this device".
  const [thisDeviceHash, setThisDeviceHash] = useState<string | null>(null);
  useEffect(() => {
    (async () => {
      if (!userId) return;
      const tok = getTrustedDeviceToken(userId);
      if (!tok) { setThisDeviceHash(null); return; }
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(tok));
      const hex = Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
      setThisDeviceHash(hex);
    })();
  }, [userId, devices.length]);

  const revoke = async (id: string) => {
    setRevokeId(null);
    const row = devices.find(d => d.id === id);
    const { error } = await supabase
      .from('mfa_trusted_devices')
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', id);
    if (error) {
      toast({ title: 'Could not revoke device', description: error.message, variant: 'destructive' });
      return;
    }
    if (row && userId && row.token_hash === thisDeviceHash) {
      clearTrustedDeviceToken(userId);
    }
    toast({ title: 'Device revoked', description: 'Two-factor will be required next time on that device.' });
    void load();
  };

  const revokeAll = async () => {
    setRevokingAll(true);
    const { error } = await supabase
      .from('mfa_trusted_devices')
      .update({ revoked_at: new Date().toISOString() })
      .eq('user_id', userId!)
      .is('revoked_at', null);
    setRevokingAll(false);
    if (error) {
      toast({ title: 'Could not revoke devices', description: error.message, variant: 'destructive' });
      return;
    }
    if (userId) clearTrustedDeviceToken(userId);
    toast({ title: 'All trusted devices revoked' });
    void load();
  };

  if (loading) {
    return (
      <div className="bg-card rounded-lg p-4 shadow-sm border border-border flex items-center gap-3">
        <Loader2 size={16} className="animate-spin text-muted-foreground" />
        <span className="text-xs text-muted-foreground">Loading trusted devices…</span>
      </div>
    );
  }

  if (devices.length === 0) {
    return (
      <div className="bg-card rounded-lg p-4 shadow-sm border border-border">
        <p className="text-xs text-muted-foreground">
          No trusted devices yet. Check "Remember this device for 60 days" the next time you sign in
          to skip the two-factor prompt on a personal device.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {devices.map(d => {
        const isThis = d.token_hash === thisDeviceHash;
        const expiresIn = Math.max(0, Math.ceil((new Date(d.expires_at).getTime() - Date.now()) / 86400000));
        return (
          <div key={d.id} className="bg-card rounded-lg p-4 shadow-sm border border-border flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
              <Smartphone size={16} className="text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-foreground truncate">
                {d.device_label || 'Unknown device'}
                {isThis && <span className="ml-2 text-[10px] uppercase tracking-wide text-accent font-bold">This device</span>}
              </p>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Expires in {expiresIn} {expiresIn === 1 ? 'day' : 'days'}
                {d.last_used_at && ` · Last used ${new Date(d.last_used_at).toLocaleDateString()}`}
              </p>
            </div>
            <button
              onClick={() => setRevokeId(d.id)}
              className="p-2 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors shrink-0"
              aria-label="Revoke device"
            >
              <X size={16} />
            </button>
          </div>
        );
      })}

      {devices.length > 1 && (
        <button
          onClick={revokeAll}
          disabled={revokingAll}
          className="w-full text-xs font-semibold text-destructive py-2 hover:bg-destructive/5 rounded-md transition-colors disabled:opacity-60"
        >
          {revokingAll ? 'Revoking…' : 'Revoke all trusted devices'}
        </button>
      )}

      <AlertDialog open={revokeId !== null} onOpenChange={o => !o && setRevokeId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display">Revoke this device?</AlertDialogTitle>
            <AlertDialogDescription>
              The next time someone signs in on that device, they'll be required to enter a two-factor code.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => revokeId && revoke(revokeId)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Revoke
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
