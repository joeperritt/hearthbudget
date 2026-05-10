import { useState } from 'react';
import { ShieldCheck, KeyRound, Mail, Loader2, ChevronRight, Check } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { EmailMfaEnrollDialog } from '@/components/auth/EmailMfaEnrollDialog';
import { EnrollPanel, RecoveryCodesPanel } from './SecurityView';

interface Props {
  onDone: () => void;
}

type State =
  | { kind: 'choice' }
  | { kind: 'totp-enrolling' }
  | { kind: 'totp-pending'; factorId: string; qr: string; secret: string; code: string; verifying: boolean; error: string | null }
  | { kind: 'codes'; codes: string[] }
  | { kind: 'enrolled-no-codes' };

async function logAudit(event: string, metadata: Record<string, unknown> = {}) {
  try {
    await supabase.functions.invoke('mfa-audit-log', { body: { event, metadata } });
  } catch (e) {
    console.warn('audit log failed', e);
  }
}

export function MfaSetupStep({ onDone }: Props) {
  const { user, profile } = useAuth();
  const { toast } = useToast();
  const [state, setState] = useState<State>({ kind: 'choice' });
  const [emailOpen, setEmailOpen] = useState(false);
  const [copiedAll, setCopiedAll] = useState(false);

  const startTotp = async () => {
    setState({ kind: 'totp-enrolling' });
    const { data: list } = await supabase.auth.mfa.listFactors();
    for (const f of list?.totp ?? []) {
      if (f.status !== 'verified') await supabase.auth.mfa.unenroll({ factorId: f.id });
    }
    const { data, error } = await supabase.auth.mfa.enroll({
      factorType: 'totp',
      issuer: 'Keeper',
      friendlyName: `Keeper (${user?.email ?? profile?.display_name ?? 'account'})`,
    });
    if (error || !data) {
      setState({ kind: 'choice' });
      toast({ title: 'Could not start enrollment', description: error?.message ?? 'Unknown error', variant: 'destructive' });
      return;
    }
    void logAudit('enroll_started', { factor_id: data.id, source: 'onboarding' });
    setState({
      kind: 'totp-pending',
      factorId: data.id,
      qr: data.totp.qr_code,
      secret: data.totp.secret,
      code: '',
      verifying: false,
      error: null,
    });
  };

  const cancelTotp = async () => {
    if (state.kind !== 'totp-pending') return;
    await supabase.auth.mfa.unenroll({ factorId: state.factorId });
    setState({ kind: 'choice' });
  };

  const verifyTotp = async () => {
    if (state.kind !== 'totp-pending' || state.code.length !== 6) return;
    setState({ ...state, verifying: true, error: null });
    const { data: chal, error: chalErr } = await supabase.auth.mfa.challenge({ factorId: state.factorId });
    if (chalErr || !chal) {
      setState({ ...state, verifying: false, error: chalErr?.message ?? 'Could not start challenge' });
      return;
    }
    const { error: vErr } = await supabase.auth.mfa.verify({
      factorId: state.factorId, challengeId: chal.id, code: state.code,
    });
    if (vErr) {
      setState({ ...state, verifying: false, code: '', error: 'Invalid code, try again' });
      return;
    }
    void logAudit('enroll_verified', { factor_id: state.factorId, source: 'onboarding' });
    const { data: regenData, error: regenErr } = await supabase.functions.invoke(
      'mfa-regenerate-recovery-codes', { body: {} },
    );
    if (regenErr || !regenData?.codes) {
      await supabase.auth.mfa.unenroll({ factorId: state.factorId });
      toast({
        title: 'Could not enable two-factor',
        description: 'Recovery codes failed to generate. Please try again.',
        variant: 'destructive',
      });
      setState({ kind: 'choice' });
      return;
    }
    setState({ kind: 'codes', codes: regenData.codes });
  };

  const copyAllCodes = async (codes: string[]) => {
    try {
      await navigator.clipboard.writeText(codes.join('\n'));
      setCopiedAll(true);
      setTimeout(() => setCopiedAll(false), 2000);
    } catch { /* noop */ }
  };
  const downloadCodes = (codes: string[]) => {
    const blob = new Blob(
      [`Keeper recovery codes for ${user?.email ?? 'your account'}\n`,
       `Generated: ${new Date().toISOString()}\n\n`,
       ...codes.map(c => `${c}\n`),
       `\nEach code can be used once. Store them somewhere safe.\n`],
      { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'keeper-recovery-codes.txt'; a.click();
    URL.revokeObjectURL(url);
  };

  if (state.kind === 'totp-pending') {
    return (
      <div>
        <h2 className="font-display text-2xl font-bold tracking-tight text-foreground">Set up authenticator app</h2>
        <p className="text-sm text-muted-foreground mt-1.5 mb-6">
          Scan with Google Authenticator, 1Password, Authy, or similar.
        </p>
        <EnrollPanel
          qr={state.qr} secret={state.secret} code={state.code}
          verifying={state.verifying} error={state.error}
          accountLabel={user?.email ?? 'Keeper'}
          onCodeChange={(v) => state.kind === 'totp-pending' && setState({ ...state, code: v })}
          onVerify={verifyTotp}
          onCancel={cancelTotp}
        />
      </div>
    );
  }

  if (state.kind === 'codes') {
    return (
      <div>
        <h2 className="font-display text-2xl font-bold tracking-tight text-foreground">Save your recovery codes</h2>
        <p className="text-sm text-muted-foreground mt-1.5 mb-6">
          Two-factor is enabled. Save these codes somewhere safe.
        </p>
        <RecoveryCodesPanel
          codes={state.codes}
          copiedAll={copiedAll}
          onCopyAll={() => copyAllCodes(state.codes)}
          onDownload={() => downloadCodes(state.codes)}
          onDone={onDone}
        />
      </div>
    );
  }

  if (state.kind === 'enrolled-no-codes') {
    return (
      <div>
        <div className="w-16 h-16 rounded-3xl bg-accent flex items-center justify-center mb-5">
          <Check size={28} className="text-accent-foreground" />
        </div>
        <h2 className="font-display text-2xl font-bold tracking-tight text-foreground">Email codes enabled</h2>
        <p className="text-sm text-muted-foreground mt-1.5">
          We'll email a 6-digit code at sign-in. You can switch to an authenticator app
          anytime from Profile → Security.
        </p>
        <button
          onClick={onDone}
          className="mt-8 w-full bg-primary text-primary-foreground font-semibold py-3.5 rounded-xl active:scale-[0.98] transition shadow-md flex items-center justify-center gap-2"
        >
          Continue <ChevronRight size={18} />
        </button>
      </div>
    );
  }

  // choice
  return (
    <div>
      <div className="w-16 h-16 rounded-3xl bg-accent flex items-center justify-center mb-5">
        <ShieldCheck size={28} className="text-accent-foreground" />
      </div>
      <h2 className="font-display text-2xl font-bold tracking-tight text-foreground">Protect your account</h2>
      <p className="text-sm text-muted-foreground mt-1.5">
        Add a second step at sign-in. Optional, but it stops most account takeovers.
        You can always set this up later in Profile → Security.
      </p>

      <div className="mt-8 space-y-3">
        <button
          onClick={startTotp}
          disabled={state.kind === 'totp-enrolling'}
          className="w-full flex items-center gap-4 bg-card rounded-xl shadow-sm p-4 text-left active:scale-[0.98] transition border border-border disabled:opacity-60"
        >
          <div className="w-10 h-10 rounded-full bg-accent/10 flex items-center justify-center shrink-0">
            {state.kind === 'totp-enrolling'
              ? <Loader2 size={20} className="text-accent animate-spin" />
              : <KeyRound size={20} className="text-accent" />}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-foreground">
              Authenticator app <span className="text-[10px] uppercase tracking-wide text-accent ml-1">Recommended</span>
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">Strongest — codes generated on your device.</p>
          </div>
          <ChevronRight size={18} className="text-muted-foreground shrink-0" />
        </button>

        <button
          onClick={() => setEmailOpen(true)}
          className="w-full flex items-center gap-4 bg-card rounded-xl shadow-sm p-4 text-left active:scale-[0.98] transition border border-border"
        >
          <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
            <Mail size={20} className="text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-foreground">Email codes</p>
            <p className="text-xs text-muted-foreground mt-0.5">Send a 6-digit code to your email at sign-in.</p>
          </div>
          <ChevronRight size={18} className="text-muted-foreground shrink-0" />
        </button>
      </div>

      <button
        onClick={onDone}
        className="mt-8 w-full text-sm text-muted-foreground font-medium hover:text-foreground py-2 active:scale-95 transition"
      >
        Skip for now
      </button>

      <EmailMfaEnrollDialog
        open={emailOpen}
        onOpenChange={setEmailOpen}
        currentEmail={user?.email ?? ''}
        hasExistingFactor={false}
        onEnrolled={(codes) => {
          if (codes && codes.length > 0) setState({ kind: 'codes', codes });
          else setState({ kind: 'enrolled-no-codes' });
        }}
      />
    </div>
  );
}
