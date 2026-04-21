import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";

export function VerifyEmailBanner() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [sending, setSending] = useState(false);

  if (!user || user.email_confirmed_at) return null;

  const resend = async () => {
    if (!user.email) return;
    setSending(true);
    const { error } = await supabase.auth.resend({ type: "signup", email: user.email });
    setSending(false);
    if (error) {
      toast({ title: "Could not resend", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Verification email sent", description: `Check ${user.email}` });
    }
  };

  return (
    <div className="bg-accent/15 border-b border-accent/30 px-4 py-2.5 text-xs text-foreground flex items-center justify-between gap-3">
      <span>Please verify your email to secure your account.</span>
      <button onClick={resend} disabled={sending}
        className="font-semibold text-accent-foreground bg-accent px-3 py-1 rounded-md disabled:opacity-50">
        {sending ? "Sending…" : "Resend"}
      </button>
    </div>
  );
}
