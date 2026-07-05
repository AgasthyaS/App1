import type { Session, User } from '@supabase/supabase-js';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { Platform } from 'react-native';

import { isSupabaseConfigured, supabase } from './supabase';

// No-op during SSR/static export (no window); needed to close the OAuth tab.
if (typeof window !== 'undefined') {
  WebBrowser.maybeCompleteAuthSession();
}

interface AuthApi {
  /** null when signed out; the Supabase user when signed in */
  user: User | null;
  session: Session | null;
  /** true until the initial session check finishes */
  initializing: boolean;
  /** whether an account server is wired up at all */
  enabled: boolean;
  /** emails a one-tap magic link; tapping it completes sign-in */
  sendMagicLink: (email: string) => Promise<{ error: string | null }>;
  /** opens Google and completes sign-in on web or native */
  signInWithGoogle: () => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  /** permanently deletes the account: cloud garden + the login itself */
  deleteAccount: () => Promise<{ error: string | null }>;
}

const Ctx = createContext<AuthApi | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [initializing, setInitializing] = useState(true);

  useEffect(() => {
    if (!supabase) {
      setInitializing(false);
      return;
    }
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setInitializing(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const sendMagicLink = async (email: string) => {
    if (!supabase) return { error: 'Login is not configured yet.' };
    // Where the tapped link returns to: the live site on web, the app's deep
    // link on native. This must be in Supabase's allowed redirect URLs.
    const emailRedirectTo =
      Platform.OS === 'web'
        ? typeof window !== 'undefined'
          ? window.location.origin
          : undefined
        : Linking.createURL('auth-callback');
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { shouldCreateUser: true, emailRedirectTo },
    });
    return { error: error?.message ?? null };
  };

  const signInWithGoogle = async () => {
    if (!supabase) return { error: 'Login is not configured yet.' };

    if (Platform.OS === 'web') {
      // Web: full-page redirect to Google and back; the session is read from
      // the URL on return (detectSessionInUrl handles it).
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: window.location.origin },
      });
      return { error: error?.message ?? null };
    }

    // Native: open Google in a secure browser tab, then hand the returned
    // deep link back to Supabase to establish the session.
    const redirectTo = Linking.createURL('auth-callback');
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo, skipBrowserRedirect: true },
    });
    if (error) return { error: error.message };
    if (!data?.url) return { error: 'Could not start Google sign-in.' };

    const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
    if (result.type !== 'success' || !result.url) {
      return { error: null }; // user closed the tab — not an error
    }
    const { params, errorCode } = Linking.parse(result.url) as any;
    if (errorCode) return { error: String(errorCode) };
    const code = params?.code as string | undefined;
    if (code) {
      const { error: exchErr } = await supabase.auth.exchangeCodeForSession(code);
      return { error: exchErr?.message ?? null };
    }
    return { error: null };
  };

  const signOut = async () => {
    if (supabase) await supabase.auth.signOut();
    setSession(null);
  };

  const deleteAccount = async () => {
    if (!supabase) return { error: 'Login is not configured yet.' };
    const uid = session?.user?.id;
    // 1) Remove the cloud garden (RLS lets a user delete their own row).
    if (uid) await supabase.from('gardens').delete().eq('user_id', uid);
    // 2) Remove the login itself. Needs the delete_user() SQL function; if it
    //    isn't installed yet the data is still gone and we still sign out, so
    //    the practical "start fresh" result holds either way.
    const { error } = await supabase.rpc('delete_user');
    await supabase.auth.signOut();
    setSession(null);
    return { error: error?.message ?? null };
  };

  const api = useMemo<AuthApi>(
    () => ({
      user: session?.user ?? null,
      session,
      initializing,
      enabled: isSupabaseConfigured,
      sendMagicLink,
      signInWithGoogle,
      signOut,
      deleteAccount,
    }),
    [session, initializing],
  );

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthApi {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth must be used inside AuthProvider');
  return v;
}
