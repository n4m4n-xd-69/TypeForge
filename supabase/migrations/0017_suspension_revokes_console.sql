-- Suspension must revoke console access.
--
-- Found by end-to-end testing: an operator whose account had been suspended
-- still returned all eleven scopes, `users.delete` included. 0014 built
-- `admin_scopes()` on `user_roles` alone, and suspension writes to
-- `profiles.status` — two tables that had no relationship, so the most urgent
-- reason to suspend somebody (they are acting in bad faith and hold operator
-- rights) was exactly the case suspension did not cover.
--
-- The fix belongs in `admin_scopes()` rather than in each of the twelve
-- mutation RPCs: every one of them reaches permission through `admin_require`
-- → `admin_can` → `admin_scopes`, and `admin_can` is also what the RLS
-- policies call. Closing it here closes it for reads and writes at once, and
-- leaves no path that could be added later without inheriting the check.
--
-- `is_admin()` from 0002 is deliberately NOT changed. Other migrations'
-- policies are written against it and its meaning — "this account holds the
-- admin role" — is still true of a suspended operator. What changes is what
-- that role can *do*, which is the question scopes answer.

create or replace function public.admin_scopes()
returns text[]
language sql security definer stable set search_path = ''
as $$
  select coalesce(r.scopes, public.admin_tier_scopes(r.admin_tier))
  from public.user_roles r
  join public.profiles p on p.id = r.user_id
  where r.user_id = auth.uid()
    and r.role = 'admin'
    -- A suspended or deleted operator has no scopes at all. Reactivating the
    -- account restores them, so this is reversible in the same motion that
    -- caused it.
    and p.status = 'active';
$$;

revoke all on function public.admin_scopes() from public, anon;
grant execute on function public.admin_scopes() to authenticated;
