import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
// React Native's JS engine doesn't ship a full URL implementation, which
// @supabase/supabase-js relies on — this patches `global.URL` before the
// client is created. Must be imported before `createClient` runs.
import 'react-native-url-polyfill/auto';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY. ' +
      'Copy .env.example to .env and fill in your Supabase project values, then restart the dev server.'
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    // AsyncStorage persists the session across app restarts — without this,
    // React Native falls back to in-memory storage and users get logged out
    // every time the app is closed. See:
    // https://supabase.com/docs/guides/auth/quickstarts/react-native
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    // Only relevant for the web OAuth redirect flow, which this app doesn't use.
    detectSessionInUrl: false,
  },
});
