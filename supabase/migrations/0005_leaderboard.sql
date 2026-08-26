-- A real leaderboard.
--
-- `profiles` is readable only by its owner (0001) and by admins (0002), which
-- is correct — it carries goal settings and streak history nobody else should
-- see. A leaderboard therefore cannot read that table directly, and loosening
-- its policy to allow one would expose far more than a ranking needs.
--
-- This view is the narrow alternative: a display name and an XP total, and
-- nothing else. No id, no email, no settings, no streak dates. It runs with the
-- definer's rights (security_invoker stays off, the default) so it can
-- aggregate rows the caller cannot select individually — which is the whole
-- point of a view like this.

drop view if exists public.leaderboard;
create view public.leaderboard as
  select
    p.display_name,
    p.xp,
    -- Ordering is computed here rather than in the client so every device
    -- agrees on rank, including when two players are tied.
    rank() over (order by p.xp desc) as rank
  from public.profiles p
  where p.xp > 0
    -- Anonymous guests who never entered a name would all appear as blanks,
    -- which reads as broken rather than as a real board.
    and coalesce(nullif(trim(p.display_name), ''), null) is not null
  order by p.xp desc
  limit 100;

comment on view public.leaderboard is
  'Public ranking: display name and XP only. Deliberately excludes ids, emails, '
  'settings and streak data so it can be read without exposing a profile.';

grant select on public.leaderboard to anon, authenticated;
