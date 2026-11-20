import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { clearSnapshots, readSnapshot, writeSnapshot } from '@/lib/snapshot';

interface Profile {
  id: string;
  user_id: string;
  household_id: string;
  display_name: string;
  avatar_initial: string;
}

interface AuthContextType {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  isAdmin: boolean;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  const fetchProfile = async (userId: string) => {
    const { data } = await supabase.from('profiles').select('*').eq('user_id', userId).single();
    if (data) { setProfile(data as Profile); writeSnapshot(userId, 'auth-profile', data); }
  };

  const checkAdmin = async (userId: string) => {
    const { data } = await supabase.from('user_roles').select('role').eq('user_id', userId);
    if (!data) return;
    const admin = data.some(r => r.role === 'household_admin' || r.role === 'system_admin');
    setIsAdmin(admin);
    writeSnapshot(userId, 'auth-admin', admin);
  };

  /** Seed profile/admin from this user's snapshot so screens can render before the network answers. */
  const seedFromSnapshot = (userId: string) => {
    const p = readSnapshot<Profile>(userId, 'auth-profile');
    if (p && p.user_id === userId && typeof p.household_id === 'string') {
      setProfile(cur => (cur && cur.user_id === userId ? cur : p));
      const a = readSnapshot<boolean>(userId, 'auth-admin');
      if (typeof a === 'boolean') setIsAdmin(a);
      return true;
    }
    return false;
  };

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (event === 'SIGNED_OUT') clearSnapshots();
      if (session?.user) {
        seedFromSnapshot(session.user.id);
        setTimeout(async () => {
          await Promise.all([fetchProfile(session.user.id), checkAdmin(session.user.id)]);
          supabase.from('profiles')
            .update({ last_seen_at: new Date().toISOString() } as any)
            .eq('user_id', session.user.id).then(() => {});
        }, 0);
      } else {
        setProfile(null);
        setIsAdmin(false);
      }
      setLoading(false);
    });

    supabase.auth.getSession().then(async ({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        const fresh = Promise.all([fetchProfile(session.user.id), checkAdmin(session.user.id)]);
        // With a saved snapshot, show the app now and let the profile refresh in the background.
        if (!seedFromSnapshot(session.user.id)) await fresh;
      }
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error ? error.message : null };
  };

  const signOut = async () => {
    clearSnapshots();
    await supabase.auth.signOut();
    clearSnapshots();
    setProfile(null);
    setIsAdmin(false);
  };

  return (
    <AuthContext.Provider value={{ user, session, profile, isAdmin, loading, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
