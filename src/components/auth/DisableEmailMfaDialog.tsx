import { useEffect, useState } from 'react';
import { Loader2, Mail, Smartphone } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  hasTotp: boolean;
  verifiedEmail: string;
  onDisabled: () => void;
}

type Step = 'pick' | 'verify';

export function DisableEmailMfaDialog({ open, onOpenChange, hasTotp, verifiedEmail, onDisabled }: Props) {
  const { toast } = useToast();
  const [method, setMethod] = useState<'email' | 'totp'>(hasTotp ? 'totp' : 'email');
  const [step, setStep] = useState<Step>(hasTotp ? 'pick' : 'verify');
  const [code, setCode] = useState('');
  const [sending, setSending] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);

  const reset = () => {
    setMethod(hasTotp ? 'totp' : 'email');
    setStep(hasTotp ? 'pick' : 'verify');
    setCode('');
    setSending(false);
    setSubmitting(false);
    setError(null);
    setSentTo(null);
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  // Auto-send the email code when dialog opens directly into verify step
  // (i.e. user has email-only MFA — no method picker shown).
  useEffect(() => {
    if (open && !hasTotp && step === 'verify' && method === 'email' && !sentTo && !sending) {
      void sendCode();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const sendCode = async () => {
    setSending(true);
    setError(null);
    const { data, error: invokeErr } = await supabase.functions.invoke('mfa-email-send', {
      body: { purpose: 'disable' },
    });
    setSending(false);
    if (invokeErr || !data?.ok) {
      setError('Could not send code. Please try again.');
      return;
    }
    setSentTo(data.sent_to ?? verifiedEmail);
  };

  const proceed = async () => {
    if (method === 'email' && !sentTo) {
      await sendCode();
      return;
    }
    setStep('verify');
  };

  const submit = async () => {
    if (code.length !== 6) return;
    setSubmitting(true);
    setError(null);
    const { data, error: invokeErr } = await supabase.functions.invoke('mfa-email-disable', {
      body: { method, code },
    });
    setSubmitting(false);
    if (invokeErr) {
      const ctx = (invokeErr as { context?: Response }).context;
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
      setError(msg ?? 'Could not disable email two-factor.');
      setCode('');
      return;
    }
    if (data?.ok) {
      toast({ title: 'Email two-factor disabled', description: 'Email codes will no longer be required at sign-in.' });
      reset();
      onOpenChange(false);
      onDisabled();
    }
  };

  // Auto-send when the user picks email path with no code yet
  const handlePickContinue = async () => {
    if (method === 'email') {
      await sendCode();
      setStep('verify');
    } else {
      setStep('verify');
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display">Disable email two-factor?</DialogTitle>
          <DialogDescription>
            Confirm with a one-time code to turn off email-based two-factor authentication.
          </DialogDescription>
        </DialogHeader>

        {step === 'pick' && hasTotp ? (
          <div className="space-y-3 mt-2">
            <p className="text-xs text-muted-foreground">Choose how you want to verify:</p>
            <button
              type="button"
              onClick={() => setMethod('totp')}
              className={`w-full flex items-center gap-3 p-3 rounded-md border text-left transition ${
                method === 'totp' ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted'
              }`}
            >
              <Smartphone size={18} className="text-primary shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold">Authenticator app code</p>
                <p className="text-[11px] text-muted-foreground">Enter a current 6-digit code</p>
              </div>
            </button>
            <button
              type="button"
              onClick={() => setMethod('email')}
              className={`w-full flex items-center gap-3 p-3 rounded-md border text-left transition ${
                method === 'email' ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted'
              }`}
            >
              <Mail size={18} className="text-primary shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold">Email code</p>
                <p className="text-[11px] text-muted-foreground">Send to {verifiedEmail}</p>
              </div>
            </button>
            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => handleOpenChange(false)}
                className="flex-1 px-4 py-2 rounded-md border border-border text-sm font-medium hover:bg-muted"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handlePickContinue}
                disabled={sending}
                className="flex-1 px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {sending ? <Loader2 size={14} className="animate-spin" /> : null}
                Continue
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-4 mt-2">
            {method === 'email' && (
              <p className="text-xs text-muted-foreground">
                {sentTo ? <>We sent a 6-digit code to <strong className="text-foreground">{sentTo}</strong>.</> : 'Sending code…'}
              </p>
            )}
            <div>
              <label className="text-xs font-semibold text-foreground block mb-1.5">
                {method === 'email' ? 'Email code' : 'Authenticator code'}
              </label>
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

            {method === 'email' && (
              <button
                type="button"
                onClick={sendCode}
                disabled={sending}
                className="text-xs text-primary hover:underline w-full text-center disabled:opacity-60"
              >
                {sending ? 'Sending…' : 'Resend code'}
              </button>
            )}

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
                className="flex-1 px-4 py-2 rounded-md bg-destructive text-destructive-foreground text-sm font-medium hover:bg-destructive/90 disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {submitting ? <Loader2 size={14} className="animate-spin" /> : null}
                Disable
              </button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
