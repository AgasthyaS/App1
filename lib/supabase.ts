import 'react-native-url-polyfill/auto';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Platform } from 'react-native';

/**
 * Supabase is the app's account server + cloud database. Credentials come from
 * the environment (see .env.example). They're read at build time via Expo's
 * EXPO_PUBLIC_ convention, so the web export and native builds both pick them up.
 *
 * The anon key is a *public* client key — it's safe to ship because every table
 * is guarded by Row Level Security so a user can only ever touch their own row.
 */
const url = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

/** True once real credentials are present. Until then the app runs sign-in-free. */
export const isSupabaseConfigured = url.length > 0 && anonKey.length > 0;

// During Expo's static web export the app is pre-rendered in Node, where there
// is no `window`/`localStorage`. Supabase auto-initializes its storage on
// creation, so instantiating it during that prerender crashes. Native has no
// SSR step; only the *web* build needs to wait for a real browser.
const isWebSSR = Platform.OS === 'web' && typeof window === 'undefined';

export const supabase: SupabaseClient | null =
  isSupabaseConfigured && !isWebSSR
    ? createClient(url, anonKey, {
        auth: {
          storage: AsyncStorage,
          autoRefreshToken: true,
          persistSession: true,
          // On web the session comes back in the URL after an OAuth redirect;
          // on native we set it manually from the deep link, so leave it off.
          detectSessionInUrl: Platform.OS === 'web',
        },
      })
    : null;
