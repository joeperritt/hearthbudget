import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDisabled: () => void;
}

export function DisableMfaDialog({ open, onOpenChange, onDisabled }: Props) {
  const { toast } = useToast();
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setPassword('');
    setCode('');
    setError(null);
    setSubmitting(false);
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const canSubmit = password.length > 0 && code.length === 6 && !submitting;

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    const { data, error: invokeErr } = await supabase.functions.invoke('mfa-disable', {
      body: { password, code },
    });
    setSubmitting(false);

    if (invokeErr) {
      // FunctionsHttpError carries server response in .context
      const ctx = (invokeErr as { context?: Response }).context;
      let serverMsg: string | null = null;
      if (ctx && typeof (ctx as Response).json === 'function') {
        try {
          const body = await (ctx as Response).clone().json();
          serverMsg = body?.error ?? null;
          if (body?.locked) {
            setError(`Too many failed attempts. Try again in ${body.retry_after_minutes ?? 15} minutes.`);
            setCode('');
            return;
          }
        } catch {
          /* ignore */
        }
      }
      setError(serverMsg ?? 'Could not disable two-factor. Please try again.');
      setCode('');
      return;
    }

    if (data?.ok) {
      toast({
        title: 'Two-factor disabled',
        description: 'Your account no longer requires a code at sign-in.',
      });
      reset();
      onOpenChange(false);
      onDisabled();
      return;
    }

    setError('Unexpected response. Please try again.');
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display">Disable two-factor authentication?</DialogTitle>
          <DialogDescription>
            Confirm with your password and a current 6-digit code from your authenticator. This deletes
            your recovery codes and turns off the second sign-in step.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          <div>
            <label className="text-xs font-semibold text-foreground block mb-1.5">Password</label>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={submitting}
              className="w-full px-3 py-2 rounded-md border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              placeholder="Re-enter your password"
            />
          </div>

          <div>
            <label className="text-xs font-semibold text-foreground block mb-1.5">
              6-digit authenticator code
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

          {error && (
            <p className="text-xs text-destructive text-center" role="alert">
              {error}
            </p>
          )}

          <div className="bg-muted rounded-md p-3 text-xs text-muted-foreground leading-relaxed">
            <strong className="text-foreground">Lost your authenticator?</strong> Sign in with a recovery
            code, then set up a new authenticator on your current device before disabling.
          </div>

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
              disabled={!canSubmit}
              className="flex-1 px-4 py-2 rounded-md bg-destructive text-destructive-foreground text-sm font-medium hover:bg-destructive/90 disabled:opacity-60 flex items-center justify-center gap-2"
            >
              {submitting ? <Loader2 size={14} className="animate-spin" /> : null}
              Disable
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
