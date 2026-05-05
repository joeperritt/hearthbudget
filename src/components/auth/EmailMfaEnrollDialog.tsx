import { useEffect, useState } from 'react';
import { Loader2, Mail } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentEmail: string;
  // True if user already has any verified MFA factor (TOTP or email).
  // When true, recovery codes will NOT be regenerated after enrollment.
  hasExistingFactor: boolean;
  // Called after enrollment succeeds. If recovery codes were generated,
  // they're passed back so the parent can show the save-codes panel.
  onEnrolled: (recoveryCodes: string[] | null) => void;
}

type Step = 'confirm' | 'verify';

export function EmailMfaEnrollDialog({
  open, onOpenChange, currentEmail, hasExistingFactor, onEnrolled,
}: Props) {
  const { toast } = useToast();
  const [step, setStep] = useState<Step>('confirm');
  const [sending, setSending] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const reset = () => {
    setStep('confirm');
    setSending(false);
    setSubmitting(false);
    setCode('');
    setError(null);
    setSentTo(null);
    setCooldown(0);
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const sendCode = async () => {
    setSending(true);
    setError(null);
    const { data, error: invokeErr } = await supabase.functions.invoke('mfa-email-send', {
      body: { purpose: 'enroll' },
    });
    setSending(false);
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
      setError(msg ?? 'Could not send code. Please try again.');
      if (retry > 0) setCooldown(retry);
      return false;
    }
    setSentTo(data?.sent_to ?? currentEmail);
    setCooldown(60);
    return true;
  };

  const startEnroll = async () => {
    const ok = await sendCode();
    if (ok) setStep('verify');
  };

  const submit = async () => {
    if (code.length !== 6) return;
    setSubmitting(true);
    setError(null);
    const { data, error: invokeErr } = await supabase.functions.invoke('mfa-email-verify', {
      body: { code, purpose: 'enroll' },
    });
    if (invokeErr || !data?.ok) {
      setSubmitting(false);
      const ctx = (invokeErr as { context?: Response } | undefined)?.context;
      let msg: string | null = null;
      if (ctx && typeof ctx.json === 'function') {
        try {
          const body = await ctx.clone().json();
          msg = body?.error ?? null;
          if (body?.locked) {
            setError(`Too many failed attempts. Try again in ${body.retry_after_minutes ?? 15} minutes.`);
            setCode('');
            return;
          }
        } catch { /* ignore */ }
      }
      setError(msg ?? 'Invalid code. Try again.');
      setCode('');
      return;
    }

    // Success. If this is the user's first factor, generate recovery codes.
    let codes: string[] | null = null;
    if (!hasExistingFactor) {
      const { data: regen, error: regenErr } = await supabase.functions.invoke(
        'mfa-regenerate-recovery-codes', { body: {} },
      );
      if (regenErr || !regen?.codes) {
        setSubmitting(false);
        toast({
          title: 'Email two-factor enabled',
          description: 'Recovery codes failed to generate — please regenerate them from Security.',
          variant: 'destructive',
        });
        reset();
        onOpenChange(false);
        onEnrolled(null);
        return;
      }
      codes = regen.codes;
    }

    setSubmitting(false);
    toast({ title: 'Email two-factor enabled' });
    reset();
    onOpenChange(false);
    onEnrolled(codes);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display">Set up email two-factor</DialogTitle>
          <DialogDescription>
            We'll email a 6-digit code each time you sign in on a new device.
          </DialogDescription>
        </DialogHeader>

        {step === 'confirm' ? (
          <div className="space-y-4 mt-2">
            <div className="bg-muted rounded-md p-3 flex items-start gap-3">
              <Mail size={16} className="text-primary shrink-0 mt-0.5" />
              <div className="text-xs leading-relaxed">
                <p className="text-foreground">We'll send a code to:</p>
                <p className="font-semibold text-foreground mt-0.5 break-all">{currentEmail}</p>
              </div>
            </div>

            {error && <p className="text-xs text-destructive text-center" role="alert">{error}</p>}

            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={() => handleOpenChange(false)}
                className="flex-1 px-4 py-2 rounded-md border border-border text-sm font-medium hover:bg-muted"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={startEnroll}
                disabled={sending}
                className="flex-1 px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {sending ? <Loader2 size={14} className="animate-spin" /> : null}
                Send code
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-4 mt-2">
            <p className="text-xs text-muted-foreground">
              {sentTo ? <>We sent a 6-digit code to <strong className="text-foreground">{sentTo}</strong>. It expires in 10 minutes.</> : 'Sending…'}
            </p>

            <div>
              <label className="text-xs font-semibold text-foreground block mb-1.5">Enter the code</label>
              <div className="flex justify-center">
                <InputOTP maxLength={6} value={code} onChange={setCode} disabled={submitting}>
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
            </div>

            {error && <p className="text-xs text-destructive text-center" role="alert">{error}</p>}

            <button
              type="button"
              onClick={sendCode}
              disabled={sending || cooldown > 0}
              className="text-xs text-primary hover:underline w-full text-center disabled:opacity-60 disabled:no-underline"
            >
              {sending ? 'Sending…' : cooldown > 0 ? `Resend code in ${cooldown}s` : 'Resend code'}
            </button>

            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={() => handleOpenChange(false)}
                disabled={submitting}
                className="flex-1 px-4 py-2 rounded-md border border-border text-sm font-medium hover:bg-muted disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submit}
                disabled={code.length !== 6 || submitting}
                className="flex-1 px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {submitting ? <Loader2 size={14} className="animate-spin" /> : null}
                Verify & enable
              </button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
