// D:\Laporan Online\dashboard-keuangan\js\auth.js
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export async function requireSession() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    window.location.href = 'login.html';
    return null;
  }
  return session;
}

export async function login(email, password) {
  return supabase.auth.signInWithPassword({ email, password });
}

export async function logout() {
  await supabase.auth.signOut();
  window.location.href = 'login.html';
}
