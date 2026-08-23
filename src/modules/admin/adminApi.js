import { supabase } from '../../lib/supabase.js';

/**
 * Every function here assumes RLS is the real gate — `is_admin()` (0002_admin.sql)
 * enforces it independently of anything this file does. A non-admin calling
 * any of these gets back an empty result, not an error, which is why the UI
 * layer only needs to branch on "did I get an admin role back", not on
 * per-query permission errors.
 */

export async function fetchMyRole(userId) {
  if (!supabase || !userId) return 'user';
  const { data, error } = await supabase.from('user_roles').select('role').eq('user_id', userId).maybeSingle();
  if (error) return 'user';
  return data?.role ?? 'user';
}

export async function fetchOverview() {
  if (!supabase) return [];
  const { data, error } = await supabase.rpc('admin_user_overview');
  if (error) throw error;
  return data ?? [];
}

export async function fetchDaily(days = 90) {
  if (!supabase) return [];
  const { data, error } = await supabase.from('admin_daily').select('*').limit(days);
  if (error) throw error;
  return data ?? [];
}

export async function fetchAuthEvents({ limit = 200, userId } = {}) {
  if (!supabase) return [];
  let q = supabase.from('auth_events').select('*').order('created_at', { ascending: false }).limit(limit);
  if (userId) q = q.eq('user_id', userId);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

export async function fetchAiUsage({ limit = 1000, userId } = {}) {
  if (!supabase) return [];
  let q = supabase.from('ai_usage').select('*').order('created_at', { ascending: false }).limit(limit);
  if (userId) q = q.eq('user_id', userId);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

export async function fetchUserDetail(userId) {
  if (!supabase) return { sessions: [], keyStats: [], problems: [] };
  const [sessionsRes, keyStatsRes, problemsRes] = await Promise.all([
    supabase.from('sessions').select('*').eq('user_id', userId).order('ts', { ascending: false }).limit(100),
    supabase.from('key_stats').select('*').eq('user_id', userId),
    supabase.from('problem_progress').select('*').eq('user_id', userId),
  ]);
  for (const r of [sessionsRes, keyStatsRes, problemsRes]) if (r.error) throw r.error;
  return {
    sessions: sessionsRes.data ?? [],
    keyStats: keyStatsRes.data ?? [],
    problems: problemsRes.data ?? [],
  };
}

/** PRD 05 §8: admin access is itself auditable. Best-effort, like every other
 * event write — a logging failure must never block the page it's logging. */
export async function logAdminView(adminId) {
  if (!supabase || !adminId) return;
  try {
    await supabase.from('auth_events').insert({ user_id: adminId, event: 'admin_view' });
  } catch {
    /* advisory only */
  }
}
