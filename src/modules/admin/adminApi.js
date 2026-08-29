import { supabase } from '../../lib/supabase.js';

/**
 * The one admin read the *non-admin* app needs.
 *
 * AccountMenu calls this to decide whether to offer a link to the console, so
 * it loads on every page for every visitor. `api/console.js` answers the same
 * question, but it is the console's whole data layer — importing it from here
 * would pull four hundred lines of operator tooling into the main bundle to
 * render one menu item.
 *
 * Everything else this file used to export (overview, daily, auth events, AI
 * usage, user detail, admin-view logging) moved to `api/console.js` when the
 * console was rebuilt. They were left behind here as duplicates for a while,
 * which is the state where the two copies quietly drift apart.
 *
 * RLS is the real gate either way — `is_admin()` in 0002 — so a non-admin
 * calling this gets 'user' back rather than an error.
 */
export async function fetchMyRole(userId) {
  if (!supabase || !userId) return 'user';
  const { data, error } = await supabase
    .from('user_roles')
    .select('role')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) return 'user';
  return data?.role ?? 'user';
}
