import { createContext, useContext, useEffect, useState, ReactNode, useCallback } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import {
  getTrustedDeviceToken,
  setTrustedDeviceToken,
  clearTrustedDeviceToken,
} from '@/lib/trustedDevice';

interface Profile {
  id: string;
  user_id: string;
  household_id: string;
  display_name: string;
  avatar_initial: string;
}

interface PendingMfa {
  factorId: string;
  email: string;
}

interface AuthContextType {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  isAdmin: boolean;
  loading: boolean;
  pendingMfa: PendingMfa | null;
  signIn: (email: string, password: string, captchaToken?: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  cancelMfaChallenge: () => Promise<void>;
  completeMfaChallenge: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

async function detectMfaChallenge(): Promise<PendingMfa | null> {
  // If session AAL is aal1 but the user has a verified TOTP factor, they must
  // complete the MFA challenge before any authenticated route renders — UNLESS
  // this device has a valid trusted-device token (30-day "remember this device").
  const { data: aalData } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (!aalData) return null;
  const { currentLevel, nextLevel } = aalData;
  if (currentLevel === 'aal2' || nextLevel !== 'aal2') return null;

  const { data: factorsData } = await supabase.auth.mfa.listFactors();
  const verifiedTotp = factorsData?.totp?.find(f => f.status === 'verified');
  if (!verifiedTotp) return null;

  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;

  // Trusted-device short-circuit. If a stored token validates, skip the MFA gate
  // and rotate the token. Any failure path falls through to showing the prompt.
  if (userId) {
    const token = getTrustedDeviceToken(userId);
    if (token) {
      try {
        const { data: trustData } = await supabase.functions.invoke(
          'mfa-check-trusted-device',
          { body: { token } },
        );
        if (trustData?.trusted && typeof trustData.token === 'string') {
          setTrustedDeviceToken(userId, trustData.token);
          return null; // device is trusted; bypass MFA
        }
        // Server says no — purge stale local token to avoid retry storms.
        if (trustData && trustData.trusted === false) {
          clearTrustedDeviceToken(userId);
        }
      } catch (e) {
        console.warn('trusted-device check failed', e);
        // Fail closed: still show MFA prompt.
      }
    }
  }

  return {
    factorId: verifiedTotp.id,
    email: userData.user?.email ?? '',
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [pendingMfa, setPendingMfa] = useState<PendingMfa | null>(null);
  // recoveryCodeUsed bypass: when the user authenticates via recovery code we
  // do NOT promote the GoTrue session to aal2 (no AAL upgrade is possible
  // without a TOTP code), but we still treat the MFA gate as passed for this
  // browser session. This flag is reset on signOut.
  const [recoveryBypass, setRecoveryBypass] = useState(false);

  const refreshMfaState = useCallback(async () => {
    if (recoveryBypass) {
      setPendingMfa(null);
      return;
    }
    const challenge = await detectMfaChallenge();
    setPendingMfa(challenge);
  }, [recoveryBypass]);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        setSession(session);
        setUser(session?.user ?? null);

        if (session?.user) {
          // Defer profile + MFA detection to avoid Supabase deadlock
          setTimeout(async () => {
            await fetchProfile(session.user.id);
            await checkAdmin(session.user.id);
            await refreshMfaState();
            supabase
              .from('profiles')
              .update({ last_seen_at: new Date().toISOString() } as any)
              .eq('user_id', session.user.id)
              .then(() => {});
          }, 0);
        } else {
          setProfile(null);
          setIsAdmin(false);
          setPendingMfa(null);
          setRecoveryBypass(false);
        }
        setLoading(false);
      }
    );

    supabase.auth.getSession().then(async ({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        await Promise.all([
          fetchProfile(session.user.id),
          checkAdmin(session.user.id),
        ]);
        await refreshMfaState();
      }
      setLoading(false);
    });

    return () => subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchProfile = async (userId: string) => {
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .eq('user_id', userId)
      .single();
    if (data) setProfile(data as Profile);
  };

  const checkAdmin = async (userId: string) => {
    const { data } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', userId);
    setIsAdmin(
      data?.some(r => r.role === 'household_admin' || r.role === 'system_admin') ?? false
    );
  };

  const signIn = async (email: string, password: string, captchaToken?: string) => {
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
      options: captchaToken ? { captchaToken } : undefined,
    });
    if (error) return { error: error.message };
    // onAuthStateChange will fire and refreshMfaState will detect the challenge.
    return { error: null };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setProfile(null);
    setIsAdmin(false);
    setPendingMfa(null);
    setRecoveryBypass(false);
  };

  const cancelMfaChallenge = async () => {
    // User backed out of the MFA prompt — sign them out, they need to start over.
    await signOut();
  };

  const completeMfaChallenge = async () => {
    // Called by LoginMfaChallenge after a successful TOTP verify (which natively
    // upgrades AAL) or successful recovery-code redemption. Refresh state.
    await supabase.auth.refreshSession().catch(() => {});
    await refreshMfaState();
  };

  // Special path: caller (LoginMfaChallenge) tells us recovery code succeeded.
  // We trust the existing aal1 session for this browser session only.
  const completeWithRecoveryBypass = async () => {
    setRecoveryBypass(true);
    setPendingMfa(null);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        profile,
        isAdmin,
        loading,
        pendingMfa,
        signIn,
        signOut,
        cancelMfaChallenge,
        completeMfaChallenge: async () => {
          // If recovery flag was set on window, take that path.
          if ((window as any).__keeperRecoveryBypass === true) {
            (window as any).__keeperRecoveryBypass = false;
            await completeWithRecoveryBypass();
            return;
          }
          await completeMfaChallenge();
        },
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
