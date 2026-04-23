import { useState } from 'react';
import { ArrowLeft, ShieldCheck, LogOut, Loader2 } from 'lucide-react';
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

interface SecurityViewProps {
  onBack: () => void;
}

export function SecurityView({ onBack }: SecurityViewProps) {
  const { profile } = useAuth();
  const { toast } = useToast();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  const handleSignOutOthers = async () => {
    setSigningOut(true);
    const { error } = await supabase.auth.signOut({ scope: 'others' });
    setSigningOut(false);
    setConfirmOpen(false);
    if (error) {
      toast({
        title: 'Could not sign out other devices',
        description: error.message,
        variant: 'destructive',
      });
    } else {
      toast({
        title: 'Other devices signed out',
        description: 'All sessions except this one have been revoked.',
      });
    }
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
          <h1 className="font-display text-2xl lg:text-3xl font-bold tracking-tight text-foreground">
            Security
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">Manage account access</p>
        </div>
      </div>

      <div className="px-6 mt-8 space-y-6">
        {/* Current session card */}
        <div className="bg-card rounded-lg p-5 shadow-sm border border-border">
          <div className="flex items-start gap-4">
            <div className="w-10 h-10 rounded-full bg-accent/10 flex items-center justify-center shrink-0">
              <ShieldCheck size={20} className="text-accent" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-foreground">This device</p>
              <p className="text-xs text-muted-foreground mt-0.5 break-words">
                Signed in as {profile?.display_name || 'you'}. To sign out of this device,
                use the Log Out button on the More tab.
              </p>
            </div>
          </div>
        </div>

        {/* Other devices section */}
        <div>
          <h2 className="font-display text-lg font-semibold text-foreground mb-2">
            Other devices
          </h2>
          <p className="text-xs text-muted-foreground mb-4 leading-relaxed">
            If you've signed in from a shared computer, lost a device, or suspect someone
            else has access to your account, sign out of all other devices below. You'll
            stay signed in here.
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
              <p className="text-sm font-semibold text-destructive">
                Sign out of all other devices
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Revokes every session except this one
              </p>
            </div>
          </button>
        </div>

        {/* Note about per-device list */}
        <div className="text-xs text-muted-foreground leading-relaxed px-1">
          <p>
            A per-device session list isn't currently available. This is the most reliable
            way to immediately cut off any other active session on your account.
          </p>
        </div>
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display">
              Sign out of all other devices?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Every other browser, phone, or tablet currently signed in to your account
              will be signed out. You'll stay signed in on this device. This cannot be
              undone.
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
    </div>
  );
}
