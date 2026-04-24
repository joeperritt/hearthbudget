import { useEffect, useState } from 'react';
import { ShieldAlert, X } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';

const DISMISS_KEY = 'keeper.adminMfaBannerDismissed';
const GRACE_PERIOD_DAYS = 14;

interface Props {
  /** Pass true on the Security route to suppress the banner there. */
  hidden?: boolean;
  /** Navigate the user to Settings → Security */
  onOpenSecurity: () => void;
}

interface BannerState {
  shouldShow: boolean;
  inGrace: boolean;
}

/**
 * Renders an enforcement banner for admin accounts (system_admin / household_admin)
 * that have NOT yet enrolled a verified TOTP factor.
 *
 * - Only renders for admin roles (member-level users are unaffected).
 * - During the first 14 days after profiles.created_at, the banner is
 *   suppressed (Settings → Security shows a softer prompt instead, which is
 *   handled inside that view itself).
 * - Dismissible per browser-session via sessionStorage; reappears next login.
 *   The grace period is timestamp-based, NOT extended by dismissals.
 */
export function AdminMfaBanner({ hidden, onOpenSecurity }: Props) {
  const { user, isAdmin, profile } = useAuth();
  const [state, setState] = useState<BannerState>({ shouldShow: false, inGrace: false });
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    setDismissed(sessionStorage.getItem(DISMISS_KEY) === '1');
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function evaluate() {
      if (!user || !isAdmin || !profile) {
        setState({ shouldShow: false, inGrace: false });
        return;
      }

      // 1. Already enrolled? Banner stays off forever for this account.
      const { data: factors } = await supabase.auth.mfa.listFactors();
      const enrolled = (factors?.totp ?? []).some((f) => f.status === 'verified');
      if (enrolled) {
        if (!cancelled) setState({ shouldShow: false, inGrace: false });
        return;
      }

      // 2. Grace-period check based on profile creation timestamp.
      // We re-fetch from the server so this can't be tampered with client-side.
      const { data: profileRow } = await supabase
        .from('profiles')
        .select('created_at')
        .eq('user_id', user.id)
        .maybeSingle();

      const createdAt = profileRow?.created_at ? new Date(profileRow.created_at) : null;
      const cutoff = createdAt
        ? new Date(createdAt.getTime() + GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000)
        : null;
      const inGrace = cutoff ? Date.now() < cutoff.getTime() : true;

      if (!cancelled) {
        setState({ shouldShow: !inGrace, inGrace });
      }
    }
    void evaluate();
    return () => {
      cancelled = true;
    };
  }, [user, isAdmin, profile]);

  if (hidden || dismissed || !state.shouldShow) return null;

  return (
    <div className="bg-primary text-primary-foreground px-4 py-3 border-b border-primary/40">
      <div className="max-w-3xl mx-auto flex items-start gap-3">
        <div className="w-8 h-8 rounded-full bg-accent/20 flex items-center justify-center shrink-0 mt-0.5">
          <ShieldAlert size={18} className="text-accent" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-display text-sm font-semibold leading-tight">
            Two-factor authentication is required for admin accounts.
          </p>
          <p className="text-xs opacity-90 mt-1 leading-relaxed">
            Set up 2FA to protect your household's financial data.
          </p>
          <button
            onClick={onOpenSecurity}
            className="mt-2 inline-flex items-center gap-1.5 bg-accent text-accent-foreground hover:bg-accent/90 text-xs font-semibold rounded-md px-3 py-1.5 transition"
          >
            Set up now
          </button>
        </div>
        <button
          onClick={() => {
            sessionStorage.setItem(DISMISS_KEY, '1');
            setDismissed(true);
          }}
          className="opacity-70 hover:opacity-100 transition"
          aria-label="Dismiss for this session"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
}

/** Helper for SecurityView to show a softer in-grace prompt. */
export function useAdminMfaGraceState() {
  const { user, isAdmin } = useAuth();
  const [inGrace, setInGrace] = useState(false);
  const [needsMfa, setNeedsMfa] = useState(false);
  const [daysRemaining, setDaysRemaining] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!user || !isAdmin) {
        setInGrace(false);
        setNeedsMfa(false);
        setDaysRemaining(null);
        return;
      }
      const { data: factors } = await supabase.auth.mfa.listFactors();
      const enrolled = (factors?.totp ?? []).some((f) => f.status === 'verified');
      if (enrolled) {
        if (!cancelled) {
          setInGrace(false);
          setNeedsMfa(false);
          setDaysRemaining(null);
        }
        return;
      }
      const { data: profileRow } = await supabase
        .from('profiles')
        .select('created_at')
        .eq('user_id', user.id)
        .maybeSingle();
      const createdAt = profileRow?.created_at ? new Date(profileRow.created_at) : null;
      const cutoff = createdAt
        ? new Date(createdAt.getTime() + GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000)
        : null;
      const grace = cutoff ? Date.now() < cutoff.getTime() : true;
      const remaining = cutoff
        ? Math.max(0, Math.ceil((cutoff.getTime() - Date.now()) / (24 * 60 * 60 * 1000)))
        : null;
      if (!cancelled) {
        setNeedsMfa(true);
        setInGrace(grace);
        setDaysRemaining(remaining);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [user, isAdmin]);

  return { inGrace, needsMfa, daysRemaining };
}
