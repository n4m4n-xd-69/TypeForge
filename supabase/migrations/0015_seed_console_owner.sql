-- Seeds the first console owner.
--
-- 0002 deliberately left `user_roles` with no write policy and no self-service
-- path: the first operator has to be created out of band, or the "who can
-- promote an admin" question answers itself badly. This migration is that out
-- of band step, kept in version control so the answer is auditable rather than
-- living in someone's SQL editor history.
--
-- Keyed on the email rather than a UUID because a UUID is environment-specific
-- — the same file has to be able to run against a fresh project, a branch, or
-- a restored backup and land on the right person. If the account does not
-- exist yet the migration is a no-op and says so: it must never fail a deploy
-- just because the human has not signed up on that environment.
--
-- To hand ownership to someone else, change the address below and re-run.
-- To add a second operator, prefer Console → Settings → Operators, which is
-- audited; this file exists for bootstrapping only.

do $$
declare
  v_email text := 'n4m4n.op69@gmail.com';
  v_id    uuid;
begin
  select id into v_id from auth.users where lower(email) = lower(v_email);

  if v_id is null then
    raise notice 'console owner %: no such account yet — sign up, then re-run this migration', v_email;
    return;
  end if;

  insert into public.user_roles (user_id, role, admin_tier, granted_at, note)
  values (v_id, 'admin', 'owner', now(), 'bootstrap owner, 0015_seed_console_owner.sql')
  on conflict (user_id) do update
    set role       = 'admin',
        admin_tier = 'owner',
        granted_at = now(),
        note       = 'bootstrap owner, 0015_seed_console_owner.sql';

  raise notice 'console owner granted to % (%)', v_email, v_id;
end $$;
