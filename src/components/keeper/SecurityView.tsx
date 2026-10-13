import { useState } from 'react';
import { ArrowLeft, LogOut, Loader2, Lock } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { ChangePasswordDialog } from '@/components/auth/ChangePasswordDialog';

interface SecurityViewProps {
  onBack: () => void;
}

export function SecurityView({ onBack }: SecurityViewProps) {
  const { toast } = useToast();
  const [changePwOpen, setChangePwOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  const signOutOthers = async () => {
    setSigningOut(true);
    const { error } = await supabase.auth.signOut({ scope: 'others' });
    setSigningOut(false);
    setConfirmOpen(false);
    if (error) toast({ title: 'Could not sign out other devices', description: error.message, variant: 'destructive' });
    else toast({ title: 'Signed out of all other devices' });
  };

  return (
    <div className="max-w-lg mx-auto pb-12">
      <div className="px-6 pt-12 safe-top flex items-center gap-3">
        <button onClick={onBack} className="p-2 -ml-2 rounded-full active:bg-muted transition-colors">
          <ArrowLeft size={20} className="text-foreground" />
        </button>
        <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">Security</h1>
      </div>

      <div className="px-6 mt-6 space-y-8">
        <section>
          <h2 className="font-display text-lg font-semibold text-foreground mb-2">Password</h2>
          <button
            onClick={() => setChangePwOpen(true)}
            className="w-full flex items-center gap-4 bg-card rounded-lg p-4 shadow-sm text-left active:scale-[0.98] transition-transform border border-border"
          >
            <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
              <Lock size={20} className="text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-foreground">Change password</p>
              <p className="text-xs text-muted-foreground mt-0.5">Requires your current password.</p>
            </div>
          </button>
        </section>

        <section>
          <h2 className="font-display text-lg font-semibold text-foreground mb-2">Other devices</h2>
          <button
            onClick={() => setConfirmOpen(true)}
            disabled={signingOut}
            className="w-full flex items-center gap-4 bg-card rounded-lg p-4 shadow-sm text-left active:scale-[0.98] transition-transform border border-border disabled:opacity-60"
          >
            <div className="w-10 h-10 rounded-full bg-destructive/10 flex items-center justify-center shrink-0">
              {signingOut ? <Loader2 size={20} className="text-destructive animate-spin" /> : <LogOut size={20} className="text-destructive" />}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-destructive">Sign out of all other devices</p>
              <p className="text-xs text-muted-foreground mt-0.5">You'll stay signed in here</p>
            </div>
          </button>
        </section>
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display">Sign out of all other devices?</AlertDialogTitle>
            <AlertDialogDescription>Every other device signed in to your account will be signed out.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={signingOut}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={signOutOthers} disabled={signingOut}>Sign out</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ChangePasswordDialog open={changePwOpen} onOpenChange={setChangePwOpen} />
    </div>
  );
}
