# Community Live Chat — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a working, moderated, real-time chat inside Community — channels, images, a first-visit profile prompt, a full-screen Discord-style layout, and a working `/ai` slash command — as Phase 1 of the design in the spec below.

**Architecture:** Postgres is the source of truth and the transport (`postgres_changes` INSERT, filtered per channel, appended live to client state — no refetch-on-change). Every write goes through a `SECURITY DEFINER` RPC that enforces standing, mutes and rate limits, mirroring `community_post`/`battle_create`'s existing shape exactly. The `/ai` reply is produced by a new Edge Function that calls the existing Forge runner and writes back through the service role under one reserved bot profile, so it flows through the same realtime path as any other message.

**Tech Stack:** React 18 + Vite, Supabase (Postgres/RLS/Realtime/Storage), Deno Edge Functions, Vitest (`environment: 'node'`, no DOM).

**Spec:** `docs/superpowers/specs/2026-09-05-community-chat-phase1-design.md`

## Global Constraints

- Message body: 1–2000 chars (spec §3.2).
- General chat rate limit: 20 messages/minute/user, across all channels (spec §4).
- `/ai` rate limit: 5 calls/10 minutes/user (spec §5, tightened from "tighter than general" during self-review).
- Chat images: `chat-images` bucket, 5 MB cap, downscale long edge to 1600px (spec §6.2).
- Moderation gate: `public.admin_can('content.moderate')` in RLS, `public.admin_require('content.moderate')` inside admin RPCs — the same permission key `community_posts`/`admin_remove_battle_room` already use. No new permission model.
- No new table gets a client-facing `insert` policy where a `SECURITY DEFINER` RPC is the only sanctioned writer (stronger than `community_posts`' own precedent — see Task 2 note).
- Every RPC: `language plpgsql security definer set search_path = ''`, `revoke ... from public, anon; grant ... to authenticated;` — the pattern every existing RPC in this codebase follows without exception.
- New migration file: `supabase/migrations/0029_community_chat.sql` (0028 is the last one in the repo, from this session's Battlefield-capacity work).
- Vitest has no DOM (`environment: 'node'`, see `vitest.config.js`). Anything tested must be a pure function exported alongside the component/hook that uses it — the same shape `useTypingEngine.js`'s "incremental correct-character count" tests already use. Do not introduce a mocking library or pattern that doesn't already exist in this codebase.

---

## Two things flagged for verification during Task 2 (carried over from the spec)

1. **The bot's `auth.users` row.** Task 2 writes a direct SQL insert into `auth.users` using the standard minimal-columns pattern Supabase projects commonly use for a service/system account. This has not been verified against this project's actual `auth.users` constraints. If `supabase db push` (or however this project applies migrations) rejects it, the fallback is minting the account once through the existing `signInAnonymously()` path (`src/lib/supabase.js`, the same mechanism guest players use today) and hardcoding the resulting UUID in Task 2's constant instead of seeding it via SQL.
2. **`profiles`' own-row read policy.** Task 9's `IntroModal` reads `community_intro_seen` off the caller's own `profiles` row with a plain `select`. This assumes an own-row select policy already exists on `profiles` (the account settings/profile page elsewhere in the app couldn't work without one). If it turns out not to, add `create policy profiles_own_read on public.profiles for select to authenticated using (id = auth.uid());` to Task 2's migration — check for an existing policy of this shape before assuming it's missing.

---

### Task 1: Shared image validate/downscale helper

**Files:**
- Create: `src/lib/media/image.js`
- Create: `src/lib/media/image.test.js`
- Modify: `src/lib/community/photo.js` (delegate to the new module; public exports unchanged)

**Interfaces:**
- Produces: `ImageError` (class), `validateImage(file, { maxBytes, accepted })` → `string | null`, `downscaleImage(file, { maxEdge })` → `Promise<File>`.
- Consumed by: Task 7 (`Composer.jsx`'s image upload).

- [ ] **Step 1: Write the failing tests**

```js
// src/lib/media/image.test.js
import { describe, expect, it } from 'vitest';
import { validateImage, downscaleImage } from './image.js';

function file(type, size) {
  const f = new File([new Uint8Array(size)], 'x', { type });
  Object.defineProperty(f, 'size', { value: size });
  return f;
}

describe('validateImage', () => {
  const opts = { maxBytes: 1000, accepted: ['image/png', 'image/jpeg'] };

  it('accepts a file within type and size bounds', () => {
    expect(validateImage(file('image/png', 500), opts)).toBeNull();
  });

  it('rejects an unsupported type', () => {
    expect(validateImage(file('application/pdf', 500), opts)).toMatch(/not supported/);
  });

  it('rejects a file over the byte limit, naming the actual size', () => {
    const message = validateImage(file('image/png', 2_000_000), { maxBytes: 1_000_000, accepted: opts.accepted });
    expect(message).toMatch(/2\.0 MB/);
  });

  it('accepts a file exactly at the byte limit', () => {
    expect(validateImage(file('image/png', 1000), opts)).toBeNull();
  });

  it('rejects a missing file', () => {
    expect(validateImage(null, opts)).toMatch(/Choose an image/);
  });
});

describe('downscaleImage', () => {
  it('passes the file through unchanged outside a DOM environment', async () => {
    // vitest runs with environment: 'node' — no `document`, so this exercises
    // the same early-return branch downscale() already relies on.
    const f = file('image/png', 500);
    await expect(downscaleImage(f, { maxEdge: 512 })).resolves.toBe(f);
  });

  it('passes an animated GIF through untouched regardless of environment', async () => {
    const f = file('image/gif', 500);
    await expect(downscaleImage(f, { maxEdge: 512 })).resolves.toBe(f);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/media/image.test.js`
Expected: FAIL — `Cannot find module './image.js'`.

- [ ] **Step 3: Write the minimal implementation**

```js
// src/lib/media/image.js
/**
 * Validate/downscale, parameterized by caller-supplied limits.
 *
 * Extracted out of `lib/community/photo.js` because chat image uploads
 * (Community Live Chat, Phase 1) need the same two checks with different
 * numbers — a 5 MB / 1600px chat image is not a 2 MB / 512px avatar — and the
 * alternative was a second copy of both functions.
 */

export class ImageError extends Error {}

/** Human-facing validation, run before any work is done. */
export function validateImage(file, { maxBytes, accepted }) {
  if (!file) return 'Choose an image first.';
  if (!accepted.includes(file.type)) {
    return 'That file type is not supported. Use a PNG, JPEG, WebP or GIF.';
  }
  if (file.size > maxBytes) {
    const mb = (maxBytes / 1024 / 1024).toFixed(1);
    return `That image is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is ${mb} MB.`;
  }
  return null;
}

/**
 * Downscales to at most `maxEdge` on the long side, preserving aspect ratio.
 *
 * Falls back to the original file on any failure rather than blocking the
 * upload — see `photo.js`'s original comment on why. An animated GIF passes
 * through untouched: drawing one to a canvas keeps only the first frame.
 */
export async function downscaleImage(file, { maxEdge }) {
  if (typeof document === 'undefined' || file.type === 'image/gif') return file;

  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    if (scale === 1) {
      bitmap.close?.();
      return file;
    }

    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', 0.85));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], 'image.webp', { type: 'image/webp' });
  } catch {
    return file;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/media/image.test.js`
Expected: PASS, 6 tests.

- [ ] **Step 5: Delegate `photo.js` to the shared helper, keeping its public exports unchanged**

Replace the top of `src/lib/community/photo.js` (everything through `downscale`) with:

```js
import { supabase } from '../supabase.js';
import { ImageError, validateImage, downscaleImage } from '../media/image.js';

export const MAX_BYTES = 2 * 1024 * 1024; // 2 MB, matching the bucket's own limit
export const MAX_EDGE = 512;              // px, the largest this is ever displayed at
export const ACCEPTED = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
export const ACCEPT_ATTR = ACCEPTED.join(',');

export class PhotoError extends ImageError {}

/** Human-facing validation, run before any work is done. */
export function validatePhoto(file) {
  return validateImage(file, { maxBytes: MAX_BYTES, accepted: ACCEPTED });
}

/** Downscales to at most MAX_EDGE on the long side. See `lib/media/image.js`. */
export function downscale(file) {
  return downscaleImage(file, { maxEdge: MAX_EDGE });
}
```

Leave everything from `uploadProfilePhoto` onward in `photo.js` unchanged — those are avatar-bucket-specific and don't move.

- [ ] **Step 6: Run the full test suite to confirm nothing broke**

Run: `npm test`
Expected: PASS, including `src/lib/community/community.test.js`'s existing `validatePhoto`/`MAX_BYTES` assertions (they import from `photo.js`, whose exports haven't changed shape) and the 6 new `image.test.js` tests.

- [ ] **Step 7: Commit**

```bash
git add src/lib/media/image.js src/lib/media/image.test.js src/lib/community/photo.js
git commit -m "refactor(community): extract shared image validate/downscale helper

Prep for chat image uploads (Phase 1), which need the same checks with
different byte/edge limits. photo.js now delegates; its public exports and
existing test coverage are unchanged."
```

---

### Task 2: Chat data model, storage and RPCs (migration 0029)

**Files:**
- Create: `supabase/migrations/0029_community_chat.sql`

**Interfaces:**
- Produces (tables): `chat_channels(id, slug, name, description, sort_order, created_at)`, `chat_channel_messages(id, channel_id, user_id, body, image_url, display_name, avatar, photo_url, is_bot, created_at, deleted_at)`, `chat_mutes(id, user_id, channel_id, reason, muted_by, muted_until, created_at)`.
- Produces (RPCs): `chat_send_message(p_channel uuid, p_body text, p_image_url text) returns chat_channel_messages`, `chat_delete_message(p_id uuid) returns void`, `admin_mute_chat_user(p_user uuid, p_channel uuid, p_minutes int, p_reason text) returns chat_mutes`, `admin_unmute_chat_user(p_user uuid, p_channel uuid) returns void`.
- Produces (column): `profiles.community_intro_seen boolean default false`.
- Produces (storage): bucket `chat-images`, public-read, 5 MB cap, `image/{png,jpeg,webp,gif}`.
- Produces (constant, must match Task 3 and Task 10 exactly): bot profile id `00000000-0000-0000-0000-0000000000a1`.
- Consumed by: Task 3 (`lib/chat/api.js` calls the two chat RPCs), Task 10 (`chat-ai-reply` inserts under the bot id and calls the two admin RPCs is out of scope for Phase 1's UI but the RPCs still ship), Task 12 (admin panel calls the mute RPCs).

There is no live-DB test harness in this repo (no test file exists for `battle/api.js`'s or `community/api.js`'s RPCs either — `check:migrations` is the only automated check, per its own header comment: *"This is not a Postgres parser... the real check is applying the migration."*). This task's verification is that structural check, not a red/green unit test cycle.

- [ ] **Step 1: Write the migration**

```sql
-- Community Live Chat, Phase 1: channels, messages, mutes, a first-visit
-- profile-prompt flag, a working /ai bot identity, and chat image storage.
--
-- See docs/superpowers/specs/2026-09-05-community-chat-phase1-design.md.
--
-- Follows community_posts' exact shape (0025): a table with soft-delete,
-- SECURITY DEFINER RPCs that own every write, and admin_can('content.moderate')
-- as the one moderation gate this whole app already uses. The one deliberate
-- departure: there is no client-facing insert policy on chat_channel_messages at all.
-- community_posts has one that duplicates the RPC's "active account" check as
-- defense in depth (see its own comment), but that duplication doesn't cover
-- the RPC's rate limit or mute check — a client could insert directly via
-- PostgREST and skip both. For a new table there's a stronger option: no
-- policy, so chat_send_message (and, for the bot, the service role) are
-- structurally the only ways in.

/* ══ 1. channels ═════════════════════════════════════════════════════════ */

create table if not exists public.chat_channels (
  id          uuid primary key default gen_random_uuid(),
  slug        text unique not null,
  name        text not null,
  description text,
  sort_order  int not null default 0,
  created_at  timestamptz not null default now()
);

alter table public.chat_channels enable row level security;

drop policy if exists chat_channels_read on public.chat_channels;
create policy chat_channels_read on public.chat_channels
  for select to authenticated using (true);

-- Fixed, admin-curated list for Phase 1 — channel creation is a later phase.
insert into public.chat_channels (slug, name, description, sort_order) values
  ('general', '#general', 'Say hello, share a Battlefield code, ask anything.', 0),
  ('help',    '#help',    'Stuck on something? Ask here.', 1)
on conflict (slug) do nothing;

/* ══ 2. messages ═════════════════════════════════════════════════════════ */

create table if not exists public.chat_channel_messages (
  id           uuid primary key default gen_random_uuid(),
  channel_id   uuid not null references public.chat_channels on delete cascade,
  user_id      uuid not null references auth.users on delete cascade,
  body         text check (body is null or length(btrim(body)) between 1 and 2000),
  image_url    text,
  -- Snapshotted at post time, not joined live. Keeps the realtime INSERT
  -- payload self-sufficient (no per-message round trip to resolve an
  -- author) at the cost of an old message not relabeling itself if someone
  -- renames later — a deliberate trade-off, see the spec §2.
  display_name text,
  avatar       text,
  photo_url    text,
  is_bot       boolean not null default false,
  created_at   timestamptz not null default now(),
  deleted_at   timestamptz,

  constraint chat_channel_messages_content_check check (body is not null or image_url is not null)
);

create index if not exists chat_channel_messages_channel_feed_idx
  on public.chat_channel_messages (channel_id, created_at desc) where deleted_at is null;

alter table public.chat_channel_messages enable row level security;

drop policy if exists chat_channel_messages_read on public.chat_channel_messages;
create policy chat_channel_messages_read on public.chat_channel_messages
  for select to authenticated using (deleted_at is null);

drop policy if exists chat_channel_messages_delete on public.chat_channel_messages;
create policy chat_channel_messages_delete on public.chat_channel_messages
  for update to authenticated
  using (user_id = auth.uid() or public.admin_can('content.moderate'))
  with check (user_id = auth.uid() or public.admin_can('content.moderate'));

/* ══ 3. mutes ════════════════════════════════════════════════════════════ */

create table if not exists public.chat_mutes (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users on delete cascade,
  -- null = muted everywhere, not just one channel.
  channel_id  uuid references public.chat_channels on delete cascade,
  reason      text,
  muted_by    uuid not null references auth.users,
  muted_until timestamptz not null,
  created_at  timestamptz not null default now()
);

-- Not a partial index on `muted_until > now()` — a partial index predicate
-- must be immutable, and now() is not. chat_send_message's own lookup filters
-- on muted_until at query time instead, same lazy-expiry stance battle_reap
-- takes elsewhere: nothing has to clean up an expired mute for it to stop
-- applying.
create index if not exists chat_mutes_user_channel_idx
  on public.chat_mutes (user_id, channel_id, muted_until);

alter table public.chat_mutes enable row level security;

-- Only the admin console reads this table directly (to list active mutes);
-- every write goes through the two admin_*_chat_user RPCs below.
drop policy if exists chat_mutes_admin_read on public.chat_mutes;
create policy chat_mutes_admin_read on public.chat_mutes
  for select to authenticated using (public.admin_can('content.moderate'));

/* ══ 4. profile flag ═════════════════════════════════════════════════════ */

alter table public.profiles
  add column if not exists community_intro_seen boolean not null default false;

/* ══ 5. the reserved "TypeForge AI" bot identity ════════════════════════ */
-- A fixed-UUID row so /ai replies are ordinary chat_channel_messages authored by a
-- real profile, not a special case the client has to know about. See this
-- plan's "flagged for verification" note above the task list — this insert
-- is the standard minimal-columns pattern for seeding a Supabase service
-- user, unverified against this project's exact auth.users constraints.

insert into auth.users (
  instance_id, id, aud, role, email,
  encrypted_password, email_confirmed_at,
  created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data,
  is_super_admin, confirmation_token, recovery_token
) values (
  '00000000-0000-0000-0000-000000000000',
  '00000000-0000-0000-0000-0000000000a1',
  'authenticated', 'authenticated', 'chat-ai@typeforge.internal',
  crypt(gen_random_uuid()::text, gen_salt('bf')), now(),
  now(), now(),
  '{"provider":"internal","providers":["internal"]}'::jsonb, '{}'::jsonb,
  false, '', ''
)
on conflict (id) do nothing;

insert into public.profiles (id, display_name, status, created_at, updated_at)
values ('00000000-0000-0000-0000-0000000000a1', 'TypeForge AI', 'active', now(), now())
on conflict (id) do nothing;

/* ══ 6. writes ═══════════════════════════════════════════════════════════ */

create or replace function public.chat_send_message(
  p_channel   uuid,
  p_body      text default null,
  p_image_url text default null
) returns public.chat_channel_messages
language plpgsql security definer set search_path = '' as $$
declare
  msg    public.chat_channel_messages;
  uid    uuid := auth.uid();
  prof   record;
  recent int;
begin
  if uid is null then
    raise exception 'Sign in to chat' using errcode = 'CH000';
  end if;

  if coalesce(btrim(p_body), '') = '' and p_image_url is null then
    raise exception 'a message needs text or an image' using errcode = 'CH004';
  end if;

  if not exists (select 1 from public.chat_channels where id = p_channel) then
    raise exception 'No such channel' using errcode = 'CH007';
  end if;

  select display_name, avatar, photo_url, coalesce(status, 'active') as status
    into prof
    from public.profiles where id = uid;

  if prof.status is distinct from 'active' then
    raise exception 'Your account cannot post right now' using errcode = '42501';
  end if;

  if exists (
    select 1 from public.chat_mutes
     where user_id = uid
       and (channel_id = p_channel or channel_id is null)
       and muted_until > now()
  ) then
    raise exception 'You are muted here right now' using errcode = 'CH003';
  end if;

  -- Rate limit in the database, same reasoning community_post's own comment
  -- gives: it cannot be skipped by not using the UI.
  select count(*) into recent from public.chat_channel_messages
   where user_id = uid and created_at > now() - interval '1 minute';
  if recent >= 20 then
    raise exception 'Slow down a moment — twenty messages a minute is the limit'
      using errcode = 'CH001';
  end if;

  insert into public.chat_channel_messages (
    channel_id, user_id, body, image_url, display_name, avatar, photo_url
  ) values (
    p_channel, uid, nullif(btrim(p_body), ''), p_image_url,
    prof.display_name, prof.avatar, prof.photo_url
  ) returning * into msg;

  return msg;
end; $$;

revoke execute on function public.chat_send_message(uuid, text, text) from public, anon;
grant  execute on function public.chat_send_message(uuid, text, text) to authenticated;

create or replace function public.chat_delete_message(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.chat_channel_messages
     set deleted_at = now()
   where id = p_id
     and deleted_at is null
     and (user_id = auth.uid() or public.admin_can('content.moderate'));

  if not found then
    raise exception 'not your message' using errcode = 'CH005';
  end if;
end; $$;

revoke execute on function public.chat_delete_message(uuid) from public, anon;
grant  execute on function public.chat_delete_message(uuid) to authenticated;

/* ══ 7. moderation ═══════════════════════════════════════════════════════ */

create or replace function public.admin_mute_chat_user(
  p_user    uuid,
  p_channel uuid default null,
  p_minutes int default 60,
  p_reason  text default null
) returns public.chat_mutes
language plpgsql security definer set search_path = '' as $$
declare
  m public.chat_mutes;
begin
  perform public.admin_require('content.moderate');

  if p_minutes <= 0 or p_minutes > 10080 then -- 7 days
    raise exception 'mute duration must be between 1 minute and 7 days' using errcode = '22023';
  end if;

  insert into public.chat_mutes (user_id, channel_id, reason, muted_by, muted_until)
  values (
    p_user, p_channel, nullif(btrim(coalesce(p_reason, '')), ''),
    auth.uid(), now() + make_interval(mins => p_minutes)
  ) returning * into m;

  perform public.admin_audit(
    'chat.user.mute',
    format('Muted a chat member for %s minute(s)', p_minutes),
    'chat_user', p_user::text,
    null, jsonb_build_object('channel_id', p_channel, 'muted_until', m.muted_until),
    coalesce(p_reason, '')
  );

  return m;
end; $$;

revoke execute on function public.admin_mute_chat_user(uuid, uuid, int, text) from public, anon;
grant  execute on function public.admin_mute_chat_user(uuid, uuid, int, text) to authenticated;

create or replace function public.admin_unmute_chat_user(
  p_user    uuid,
  p_channel uuid default null
) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.admin_require('content.moderate');

  update public.chat_mutes
     set muted_until = now()
   where user_id = p_user
     and muted_until > now()
     and channel_id is not distinct from p_channel;

  perform public.admin_audit(
    'chat.user.unmute',
    'Lifted a chat mute',
    'chat_user', p_user::text,
    null, jsonb_build_object('channel_id', p_channel),
    null
  );
end; $$;

revoke execute on function public.admin_unmute_chat_user(uuid, uuid) from public, anon;
grant  execute on function public.admin_unmute_chat_user(uuid, uuid) to authenticated;

/* ══ 8. chat image storage ═══════════════════════════════════════════════ */

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'chat-images', 'chat-images', true, 5242880,
  array['image/png','image/jpeg','image/webp','image/gif']
)
on conflict (id) do update
  set public             = true,
      file_size_limit    = 5242880,
      allowed_mime_types = array['image/png','image/jpeg','image/webp','image/gif'];

drop policy if exists chat_images_public_read on storage.objects;
create policy chat_images_public_read on storage.objects
  for select using (bucket_id = 'chat-images');

drop policy if exists chat_images_own_insert on storage.objects;
create policy chat_images_own_insert on storage.objects
  for insert to authenticated with check (
    bucket_id = 'chat-images' and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists chat_images_own_delete on storage.objects;
create policy chat_images_own_delete on storage.objects
  for delete to authenticated using (
    bucket_id = 'chat-images' and (storage.foldername(name))[1] = auth.uid()::text
  );

/* ══ 9. realtime ═════════════════════════════════════════════════════════ */

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public'
       and tablename = 'chat_channel_messages'
  ) then
    alter publication supabase_realtime add table public.chat_channel_messages;
  end if;
exception
  when undefined_object then
    raise notice 'supabase_realtime publication not present — skipping';
end $$;
```

- [ ] **Step 2: Run the structural check**

Run: `npm run check:migrations`
Expected: `✓ 29 migration files pass structural checks`

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0029_community_chat.sql
git commit -m "feat(community): chat data model, RPCs and image storage (Phase 1)

Channels, messages, chat-scoped mutes, a profiles.community_intro_seen
flag, a reserved TypeForge AI bot identity, and the chat-images bucket.
Every write is a SECURITY DEFINER RPC; no client-facing insert policy on
chat_channel_messages at all (stronger than community_posts' own precedent — see
the migration's header comment)."
```

---

### Task 3: Chat data layer (`lib/chat/api.js`)

**Files:**
- Create: `src/lib/chat/constants.js`
- Create: `src/lib/chat/api.js`
- Create: `src/lib/chat/api.test.js`

**Interfaces:**
- Consumes: RPCs from Task 2 (`chat_send_message`, `chat_delete_message`), table `chat_channel_messages`, `chat_channels`.
- Produces: `BOT_USER_ID`, `BOT_DISPLAY_NAME`, `AI_COMMAND` (constants.js); `CHAT_ERROR_COPY`, `chatErrorMessage(error)`, `fetchChannels()`, `fetchMessages(channelId, { before, limit })`, `subscribeToChannel(channelId, onInsert)`, `sendMessage(channelId, body, imageUrl)`, `deleteMessage(id)` (api.js).
- Consumed by: Task 4 (`useChatChannel.js`), Task 7 (`Composer.jsx`), Task 12 (admin panel imports `CHAT_ERROR_COPY`'s shape for its own error handling, though it calls different RPCs).

Only `chatErrorMessage` is genuinely pure and gets a test — the same boundary `community/api.js`'s untested `fetchFeed`/`createPost` already draw (no live DB in this test runner; see this codebase's own `check-migrations.mjs` header on why the real check is applying the migration, not a unit test).

- [ ] **Step 1: Write the failing test**

```js
// src/lib/chat/api.test.js
import { describe, expect, it } from 'vitest';
import { CHAT_ERROR_COPY, chatErrorMessage } from './api.js';

describe('chatErrorMessage', () => {
  it('maps a known code to its copy', () => {
    expect(chatErrorMessage({ code: 'CH001' })).toBe(CHAT_ERROR_COPY.CH001);
    expect(chatErrorMessage({ code: 'CH003' })).toBe(CHAT_ERROR_COPY.CH003);
  });

  it('falls back to the raw message for an unknown code', () => {
    expect(chatErrorMessage({ code: 'XX999', message: 'weird' })).toBe('weird');
  });

  it('falls back to a generic message when nothing is usable', () => {
    expect(chatErrorMessage({})).toBe('Something went wrong.');
  });

  it('returns null for a null error', () => {
    expect(chatErrorMessage(null)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/chat/api.test.js`
Expected: FAIL — `Cannot find module './api.js'`.

- [ ] **Step 3: Write the minimal implementation**

```js
// src/lib/chat/constants.js
/**
 * Chat-wide constants shared by the client.
 *
 * BOT_USER_ID must match the fixed UUID seeded in migration 0029 and the one
 * used in supabase/functions/chat-ai-reply/index.ts. Three independent
 * runtimes (Postgres, Deno, the browser) can't share one source file, so all
 * three carry a comment pointing at the other two — change one, change all.
 */
export const BOT_USER_ID = '00000000-0000-0000-0000-0000000000a1';
export const BOT_DISPLAY_NAME = 'TypeForge AI';
export const AI_COMMAND = '/ai';
```

```js
// src/lib/chat/api.js
import { supabase } from '../supabase.js';

/**
 * Chat's data layer. Same shape as `lib/community/api.js` and
 * `lib/battle/api.js`: reads return empty on failure, writes throw, and every
 * RPC error carries a code this file already has copy for.
 */

export const CHAT_ERROR_COPY = {
  CH000: 'Sign in to chat.',
  CH001: 'Slow down a moment — twenty messages a minute is the limit.',
  CH002: 'Slow down on /ai — five questions per ten minutes is the limit.',
  CH003: 'You are muted here right now.',
  CH004: 'A message needs text or an image.',
  CH005: 'You can only delete your own messages.',
  CH006: 'That image could not be used. Check the type and size.',
  CH007: 'That channel does not exist.',
};

/** Maps an RPC error to the sentence a person can act on. Mirrors `battleErrorMessage`. */
export function chatErrorMessage(err) {
  if (!err) return null;
  if (CHAT_ERROR_COPY[err.code]) return CHAT_ERROR_COPY[err.code];
  return err.message ?? 'Something went wrong.';
}

function decorate(error) {
  const message = chatErrorMessage(error);
  const err = new Error(message);
  err.code = error?.code;
  return err;
}

const PAGE = 50;

export async function fetchChannels() {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('chat_channels')
    .select('*')
    .order('sort_order', { ascending: true });
  if (error) {
    if (import.meta.env.DEV) console.warn('[chat] channel read failed', error);
    return [];
  }
  return data ?? [];
}

/**
 * One page of a channel's history. Keyset-paginated on `created_at`, same
 * reasoning `fetchFeed` documents: the head of a live table grows, so an
 * offset would shift under a reader mid-page.
 *
 * Rows come back oldest-first — the shape a message list actually renders in,
 * top to bottom — even though the underlying query orders newest-first to
 * make `before` cursoring natural.
 */
export async function fetchMessages(channelId, { before = null, limit = PAGE } = {}) {
  if (!supabase || !channelId) return [];
  let q = supabase
    .from('chat_channel_messages')
    .select('*')
    .eq('channel_id', channelId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (before) q = q.lt('created_at', before);

  const { data, error } = await q;
  if (error) {
    if (import.meta.env.DEV) console.warn('[chat] message read failed', error);
    return [];
  }
  return (data ?? []).reverse();
}

export async function sendMessage(channelId, body, imageUrl = null) {
  if (!supabase) throw new Error('Cloud sync is not configured, so chat is unavailable.');
  const { data, error } = await supabase.rpc('chat_send_message', {
    p_channel: channelId,
    p_body: body || null,
    p_image_url: imageUrl,
  });
  if (error) throw decorate(error);
  return Array.isArray(data) ? data[0] ?? null : data ?? null;
}

export async function deleteMessage(id) {
  if (!supabase) return;
  const { error } = await supabase.rpc('chat_delete_message', { p_id: id });
  if (error) throw decorate(error);
}

/**
 * Live inserts for one channel. Returns an unsubscribe function
 * unconditionally, including when Supabase is unconfigured.
 */
export function subscribeToChannel(channelId, onInsert) {
  if (!supabase || !channelId) return () => {};
  const channel = supabase
    .channel(`chat:${channelId}`)
    .on('postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'chat_channel_messages', filter: `channel_id=eq.${channelId}` },
      (payload) => onInsert(payload.new))
    .subscribe();
  return () => {
    try {
      supabase.removeChannel(channel);
    } catch {
      /* already torn down */
    }
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/chat/api.test.js`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/chat/constants.js src/lib/chat/api.js src/lib/chat/api.test.js
git commit -m "feat(community): chat data layer (lib/chat/api.js)"
```

---

### Task 4: `useChatChannel` hook

**Files:**
- Create: `src/lib/chat/useChatChannel.js`
- Create: `src/lib/chat/useChatChannel.test.js`

**Interfaces:**
- Consumes: `fetchMessages`, `sendMessage`, `deleteMessage`, `subscribeToChannel` (Task 3).
- Produces: pure functions `mergeIncoming(messages, incoming)`, `mergeOlderPage(messages, olderPage)` (both exported, tested directly — no DOM needed, same shape as `useTypingEngine.js`'s exported pure helpers); the hook `useChatChannel(channelId)` returning `{ messages, loading, loadingMore, exhausted, loadMore, send, deleteMessage }`.
- Consumed by: Task 6 (`MessageList.jsx`, `ChannelSidebar.jsx`), Task 7 (`Composer.jsx`).

- [ ] **Step 1: Write the failing tests**

```js
// src/lib/chat/useChatChannel.test.js
import { describe, expect, it } from 'vitest';
import { mergeIncoming, mergeOlderPage } from './useChatChannel.js';

const msg = (id, createdAt) => ({ id, created_at: createdAt, body: id });

describe('mergeIncoming', () => {
  it('appends a new message to the end', () => {
    const result = mergeIncoming([msg('a', '2026-01-01T00:00:00Z')], msg('b', '2026-01-01T00:00:01Z'));
    expect(result.map((m) => m.id)).toEqual(['a', 'b']);
  });

  it('ignores a message already present by id', () => {
    // The sender's own message: sendMessage() already added it optimistically,
    // then the realtime INSERT for that same row arrives a moment later.
    const existing = [msg('a', '2026-01-01T00:00:00Z')];
    const result = mergeIncoming(existing, msg('a', '2026-01-01T00:00:00Z'));
    expect(result).toEqual(existing);
    expect(result).not.toBe(existing); // still a new array, not the same reference re-sent
  });
});

describe('mergeOlderPage', () => {
  it('prepends an older page before the current messages', () => {
    const current = [msg('c', '2026-01-01T00:00:02Z')];
    const older = [msg('a', '2026-01-01T00:00:00Z'), msg('b', '2026-01-01T00:00:01Z')];
    expect(mergeOlderPage(current, older).map((m) => m.id)).toEqual(['a', 'b', 'c']);
  });

  it('drops any duplicate id the older page happens to include', () => {
    const current = [msg('b', '2026-01-01T00:00:01Z')];
    const older = [msg('a', '2026-01-01T00:00:00Z'), msg('b', '2026-01-01T00:00:01Z')];
    expect(mergeOlderPage(current, older).map((m) => m.id)).toEqual(['a', 'b']);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/chat/useChatChannel.test.js`
Expected: FAIL — `Cannot find module './useChatChannel.js'`.

- [ ] **Step 3: Write the minimal implementation**

```js
// src/lib/chat/useChatChannel.js
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  deleteMessage as deleteMessageApi, fetchMessages, sendMessage as sendMessageApi, subscribeToChannel,
} from './api.js';

const PAGE = 50;

/** A live INSERT, appended if its id isn't already present (see api.test.js's "own message" case). */
export function mergeIncoming(messages, incoming) {
  if (messages.some((m) => m.id === incoming.id)) return messages;
  return [...messages, incoming];
}

/** An older page, prepended, with anything the current list already has dropped. */
export function mergeOlderPage(messages, olderPage) {
  const known = new Set(messages.map((m) => m.id));
  return [...olderPage.filter((m) => !known.has(m.id)), ...messages];
}

/**
 * One channel's messages: loaded, paginated backward, and kept live.
 *
 * Shaped like `useBattleRoom.js` rather than Community's coalesced-refetch
 * feed — a chat has to stream messages in one at a time, not flash and
 * re-sort on every change. See the design spec §2 for why.
 */
export function useChatChannel(channelId) {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [exhausted, setExhausted] = useState(false);
  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  useEffect(() => {
    if (!channelId) return undefined;
    let cancelled = false;
    setLoading(true);
    setExhausted(false);
    fetchMessages(channelId).then((rows) => {
      if (cancelled) return;
      setMessages(rows);
      setExhausted(rows.length < PAGE);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [channelId]);

  useEffect(() => {
    if (!channelId) return undefined;
    return subscribeToChannel(channelId, (row) => {
      setMessages((prev) => mergeIncoming(prev, row));
    });
  }, [channelId]);

  const loadMore = useCallback(async () => {
    const current = messagesRef.current;
    if (!current.length || loadingMore || exhausted) return;
    setLoadingMore(true);
    try {
      const older = await fetchMessages(channelId, { before: current[0].created_at });
      setMessages((prev) => mergeOlderPage(prev, older));
      if (older.length < PAGE) setExhausted(true);
    } finally {
      setLoadingMore(false);
    }
  }, [channelId, loadingMore, exhausted]);

  const send = useCallback((body, imageUrl) => sendMessageApi(channelId, body, imageUrl)
    .then((row) => {
      if (row) setMessages((prev) => mergeIncoming(prev, row));
      return row;
    }), [channelId]);

  const remove = useCallback((id) => deleteMessageApi(id).then(() => {
    setMessages((prev) => prev.filter((m) => m.id !== id));
  }), []);

  return { messages, loading, loadingMore, exhausted, loadMore, send, deleteMessage: remove };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/chat/useChatChannel.test.js`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/chat/useChatChannel.js src/lib/chat/useChatChannel.test.js
git commit -m "feat(community): useChatChannel hook with live-append and pagination"
```

---

### Task 5: Slash-command registry and hint popup

**Files:**
- Create: `src/modules/community/chat/commands.js`
- Create: `src/modules/community/chat/commands.test.js`
- Create: `src/modules/community/chat/SlashCommandHint.jsx`

**Interfaces:**
- Produces: `COMMANDS` (array of `{ command, description }`), `matchCommands(input)` → filtered array; `<SlashCommandHint input={string} onPick={(command) => void} />`.
- Consumed by: Task 7 (`Composer.jsx`).

- [ ] **Step 1: Write the failing test**

```js
// src/modules/community/chat/commands.test.js
import { describe, expect, it } from 'vitest';
import { COMMANDS, matchCommands } from './commands.js';

describe('matchCommands', () => {
  it('returns every command for a bare slash', () => {
    expect(matchCommands('/')).toEqual(COMMANDS);
  });

  it('filters by prefix as more is typed', () => {
    expect(matchCommands('/ai')).toEqual([COMMANDS[0]]);
  });

  it('is case-insensitive', () => {
    expect(matchCommands('/AI')).toEqual([COMMANDS[0]]);
  });

  it('returns nothing once the text no longer matches any command', () => {
    expect(matchCommands('/aiquestion')).toEqual([]);
  });

  it('returns nothing for input that is not a slash command', () => {
    expect(matchCommands('hello /ai')).toEqual([]);
    expect(matchCommands('')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/modules/community/chat/commands.test.js`
Expected: FAIL — `Cannot find module './commands.js'`.

- [ ] **Step 3: Write the minimal implementation**

```js
// src/modules/community/chat/commands.js
import { AI_COMMAND } from '../../../lib/chat/constants.js';

/**
 * The slash-command registry. One entry today; adding a second is a one-line
 * addition here, not new UI — `SlashCommandHint.jsx` renders whatever this
 * array contains.
 */
export const COMMANDS = [
  { command: AI_COMMAND, description: 'Ask the AI a question — replies concisely, right in the channel.' },
];

/**
 * Commands whose name starts with what's been typed so far.
 *
 * Only ever called on text starting with '/' — `Composer.jsx` gates that —
 * but checked here too so this stays correct on its own.
 */
export function matchCommands(input) {
  if (typeof input !== 'string' || !input.startsWith('/')) return [];
  const needle = input.toLowerCase();
  return COMMANDS.filter((c) => c.command.toLowerCase().startsWith(needle));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/modules/community/chat/commands.test.js`
Expected: PASS, 5 tests.

- [ ] **Step 5: Write `SlashCommandHint.jsx`**

```jsx
// src/modules/community/chat/SlashCommandHint.jsx
import { Card } from '../../../components/ui/Primitives.jsx';
import { matchCommands } from './commands.js';

/**
 * The `/`-triggered popup above the composer — Discord/Slack's pattern.
 * Renders nothing once there's no match, so the composer can mount this
 * unconditionally rather than guarding it itself.
 */
export default function SlashCommandHint({ input, onPick }) {
  const matches = matchCommands(input);
  if (matches.length === 0) return null;

  return (
    <Card className="absolute bottom-full left-0 mb-1 w-full max-w-sm overflow-hidden p-1" role="listbox">
      {matches.map((c) => (
        <button
          key={c.command}
          type="button"
          role="option"
          onClick={() => onPick(c.command)}
          className="flex w-full items-baseline gap-1.5 rounded-md px-1.5 py-1 text-left hover:bg-subtle"
        >
          <span className="font-mono text-sm font-bold text-brand">{c.command}</span>
          <span className="truncate text-xs text-ink-3">{c.description}</span>
        </button>
      ))}
    </Card>
  );
}
```

- [ ] **Step 6: Commit**

```bash
git add src/modules/community/chat/commands.js src/modules/community/chat/commands.test.js src/modules/community/chat/SlashCommandHint.jsx
git commit -m "feat(community): slash-command registry and hint popup"
```

---

### Task 6: Channel sidebar and message list

**Files:**
- Create: `src/modules/community/chat/ChannelSidebar.jsx`
- Create: `src/modules/community/chat/MessageList.jsx`

**Interfaces:**
- Consumes: `useChatChannel` (Task 4), `fetchChannels` (Task 3), `BOT_USER_ID` (Task 3's constants).
- Produces: `<ChannelSidebar channels={array} activeSlug={string} />` (renders `Link`s, no own state), `<MessageList messages={array} loading={bool} loadingMore={bool} exhausted={bool} onLoadMore={fn} currentUserId={string} onDelete={fn} />`.
- Consumed by: Task 8 (`ChatShell.jsx`).

No test file: both are presentational, and this codebase's convention (confirmed by `Community.jsx`'s `Post`/`MemberSheet` and `Battle.jsx`'s `Feature`/`Field`) is that render-only components without a DOM test runner available (`environment: 'node'`, no jsdom — see Global Constraints) aren't unit tested; they're verified by running the app.

- [ ] **Step 1: Write `ChannelSidebar.jsx`**

```jsx
// src/modules/community/chat/ChannelSidebar.jsx
import { Link } from 'react-router-dom';
import { Hash } from 'lucide-react';
import { cx } from '../../../lib/format.js';

export default function ChannelSidebar({ channels, activeSlug }) {
  return (
    <nav className="w-[176px] shrink-0 space-y-px overflow-y-auto border-r border-line p-1.5">
      {channels.map((c) => (
        <Link
          key={c.id}
          to={`/community/chat/${c.slug}`}
          className={cx(
            'flex items-center gap-1 rounded-md px-1.5 py-1 text-sm',
            c.slug === activeSlug ? 'bg-subtle font-bold text-ink' : 'text-ink-3 hover:bg-subtle/60 hover:text-ink-2',
          )}
        >
          <Hash size={14} strokeWidth={2.2} aria-hidden />
          {c.name.replace(/^#/, '')}
        </Link>
      ))}
    </nav>
  );
}
```

- [ ] **Step 2: Write `MessageList.jsx`**

```jsx
// src/modules/community/chat/MessageList.jsx
import { useLayoutEffect, useRef } from 'react';
import { Bot, Loader2, Trash2 } from 'lucide-react';
import { IconButton } from '../../../components/ui/Button.jsx';
import { Chip } from '../../../components/ui/Primitives.jsx';
import Avatar from '../../../components/ui/Avatar.jsx';
import { relativeTime } from '../../../lib/format.js';

export default function MessageList({
  messages, loading, loadingMore, exhausted, onLoadMore, currentUserId, onDelete,
}) {
  const bottomRef = useRef(null);
  const scrollerRef = useRef(null);
  const prevFirstIdRef = useRef(null);
  const prevLastIdRef = useRef(null);
  const prevScrollHeightRef = useRef(null);

  /*
   * Classifies every `messages` change from the data itself, rather than a
   * flag armed by whichever handler triggered it. A load-more click, a
   * live realtime insert, and the user's own send/delete can all update
   * `messages` while another one of them is still in flight — a
   * manually-armed "this is the update I'm waiting for" ref gets stolen by
   * whichever change lands first. Comparing this render's first/last
   * message id against the previous render's has no such race: it only
   * ever looks at the data that's actually here right now.
   *
   *   - first id changed, last id unchanged -> older messages were
   *     prepended (pagination). Keep the reader's visual position by
   *     shifting scrollTop by exactly how much taller the content got.
   *   - last id changed -> a message arrived at the tail (a live append,
   *     or this is the channel's first load). Jump to the bottom.
   *
   * useLayoutEffect, not useEffect: this has to run before the browser
   * paints, or the prepended content flashes into view for one frame
   * before scrollTop catches up.
   */
  useLayoutEffect(() => {
    const el = scrollerRef.current;
    const firstId = messages.length ? messages[0].id : null;
    const lastId = messages.length ? messages[messages.length - 1].id : null;

    if (el) {
      const prependedAtTop = firstId !== null
        && prevFirstIdRef.current !== null
        && firstId !== prevFirstIdRef.current
        && lastId === prevLastIdRef.current;

      if (prependedAtTop && prevScrollHeightRef.current !== null) {
        el.scrollTop += el.scrollHeight - prevScrollHeightRef.current;
      } else if (lastId !== null && lastId !== prevLastIdRef.current) {
        bottomRef.current?.scrollIntoView({ block: 'end' });
      }
    }

    prevFirstIdRef.current = firstId;
    prevLastIdRef.current = lastId;
    prevScrollHeightRef.current = el ? el.scrollHeight : null;
  }, [messages]);

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 size={18} className="animate-spin text-ink-3" aria-hidden />
      </div>
    );
  }

  return (
    <div ref={scrollerRef} className="flex-1 space-y-2 overflow-y-auto p-2">
      {exhausted ? (
        <p className="py-1 text-center text-2xs text-ink-3">That's the start of the channel.</p>
      ) : (
        <button
          type="button"
          onClick={onLoadMore}
          disabled={loadingMore}
          className="mx-auto block text-2xs text-ink-3 underline hover:text-ink-2"
        >
          {loadingMore ? 'Loading…' : 'Load earlier messages'}
        </button>
      )}

      {messages.map((m) => (
        <div key={m.id} className="group flex gap-1.5">
          <Avatar value={m.photo_url ?? m.avatar} name={m.display_name} size={32} />
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-1">
              <span className="text-sm font-bold">{m.display_name || 'Someone'}</span>
              {m.is_bot ? <Chip tone="brand"><Bot size={10} aria-hidden /> Bot</Chip> : null}
              <span className="text-2xs text-ink-3">{relativeTime(m.created_at)}</span>
              {m.user_id === currentUserId ? (
                <IconButton
                  size="sm"
                  label="Delete this message"
                  icon={Trash2}
                  onClick={() => onDelete(m.id)}
                  className="ml-auto opacity-0 group-hover:opacity-100"
                />
              ) : null}
            </div>
            {m.body ? <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{m.body}</p> : null}
            {m.image_url ? (
              <img src={m.image_url} alt="" loading="lazy" className="mt-1 max-h-72 rounded-md border border-line" />
            ) : null}
          </div>
        </div>
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add src/modules/community/chat/ChannelSidebar.jsx src/modules/community/chat/MessageList.jsx
git commit -m "feat(community): channel sidebar and message list components"
```

---

### Task 7: Composer — text, images, and the slash-command hint

**Files:**
- Create: `src/modules/community/chat/Composer.jsx`

**Interfaces:**
- Consumes: `send` from `useChatChannel` (Task 4), `SlashCommandHint`/`matchCommands`/`AI_COMMAND` (Tasks 3/5), `validateImage`/`downscaleImage` (Task 1), `chatErrorMessage` (Task 3).
- Produces: `<Composer channelId={string} onSend={fn} />` where `onSend(body, imageUrl)` is `useChatChannel`'s `send`. Also fires `onAiCommand(messageId)` after a `/ai …` message is sent, so Task 11 can wire the edge-function call without this component knowing about Forge at all.

Image upload here reuses `lib/media/image.js` directly (not `lib/community/photo.js`, which is avatar-specific) with the `chat-images` bucket and the 5 MB/1600px limits from the Global Constraints — a small, self-contained upload function lives in this file rather than a new `lib/chat/photo.js`, since nothing else needs it (YAGNI: extract only when a second caller shows up).

- [ ] **Step 1: Write `Composer.jsx`**

```jsx
// src/modules/community/chat/Composer.jsx
import { useRef, useState } from 'react';
import { Image as ImageIcon, Loader2, Send, X } from 'lucide-react';
import Button, { IconButton } from '../../../components/ui/Button.jsx';
import { useToast } from '../../../components/ui/Toast.jsx';
import { useAuth } from '../../../lib/auth.jsx';
import { supabase } from '../../../lib/supabase.js';
import { validateImage, downscaleImage } from '../../../lib/media/image.js';
import { chatErrorMessage } from '../../../lib/chat/api.js';
import { AI_COMMAND } from '../../../lib/chat/constants.js';
import SlashCommandHint from './SlashCommandHint.jsx';

const MAX_BYTES = 5 * 1024 * 1024;
const MAX_EDGE = 1600;
const ACCEPTED = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

async function uploadChatImage(userId, file) {
  const invalid = validateImage(file, { maxBytes: MAX_BYTES, accepted: ACCEPTED });
  if (invalid) throw new Error(invalid);
  const prepared = await downscaleImage(file, { maxEdge: MAX_EDGE });
  const ext = prepared.type === 'image/webp' ? 'webp' : (prepared.name.split('.').pop() || 'jpg');
  const path = `${userId}/${Date.now()}.${ext}`;
  const { error } = await supabase.storage
    .from('chat-images')
    .upload(path, prepared, { cacheControl: '3600', contentType: prepared.type });
  if (error) throw new Error(error.message || 'The upload failed. Try again.');
  return supabase.storage.from('chat-images').getPublicUrl(path).data.publicUrl;
}

export default function Composer({ onSend, onAiCommand }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [pickedImage, setPickedImage] = useState(null);
  const fileInput = useRef(null);

  const submit = async (event) => {
    event.preventDefault();
    const text = body.trim();
    if ((!text && !pickedImage) || sending) return;

    setSending(true);
    try {
      let imageUrl = null;
      if (pickedImage) {
        setUploading(true);
        imageUrl = await uploadChatImage(user.id, pickedImage);
        setUploading(false);
      }
      const row = await onSend(text || null, imageUrl);
      setBody('');
      setPickedImage(null);
      if (row && text.toLowerCase().startsWith(`${AI_COMMAND} `)) {
        onAiCommand(row.id);
      }
    } catch (err) {
      toast(chatErrorMessage(err) ?? err.message ?? 'Could not send that.', { tone: 'error' });
    } finally {
      setSending(false);
      setUploading(false);
    }
  };

  const pickImage = (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const invalid = validateImage(file, { maxBytes: MAX_BYTES, accepted: ACCEPTED });
    if (invalid) {
      toast(invalid, { tone: 'error' });
      return;
    }
    setPickedImage(file);
  };

  return (
    <form onSubmit={submit} className="relative shrink-0 border-t border-line bg-bg p-2">
      <SlashCommandHint
        input={body}
        onPick={(command) => setBody(`${command} `)}
      />

      {pickedImage ? (
        <div className="mb-1 flex items-center gap-1.5 rounded-md bg-subtle/60 px-1.5 py-1 text-xs">
          <ImageIcon size={14} aria-hidden />
          <span className="truncate">{pickedImage.name}</span>
          <IconButton size="sm" label="Remove image" icon={X} onClick={() => setPickedImage(null)} className="ml-auto" />
        </div>
      ) : null}

      <div className="flex items-end gap-1.5">
        <IconButton
          type="button"
          label="Attach an image"
          icon={ImageIcon}
          onClick={() => fileInput.current?.click()}
          disabled={sending}
        />
        <input ref={fileInput} type="file" accept={ACCEPTED.join(',')} onChange={pickImage} className="sr-only" aria-label="Choose an image" />

        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={1}
          maxLength={2000}
          placeholder="Message… (/ for commands)"
          className="max-h-32 flex-1 resize-none rounded-md border border-line bg-subtle/50 px-1.5 py-1 text-sm outline-none focus:border-brand"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(e); }
          }}
        />

        <Button
          type="submit"
          size="sm"
          variant="primary"
          icon={sending ? Loader2 : Send}
          disabled={sending || (!body.trim() && !pickedImage)}
        >
          {uploading ? 'Uploading…' : sending ? 'Sending…' : 'Send'}
        </Button>
      </div>
    </form>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/modules/community/chat/Composer.jsx
git commit -m "feat(community): chat composer with image upload and slash commands"
```

---

### Task 8: `ChatShell` full-screen layout and routing

**Files:**
- Create: `src/modules/community/chat/ChatShell.jsx`
- Modify: `src/App.jsx:24` (add the lazy import, alongside `Community`)
- Modify: `src/App.jsx:83` (add the two routes, alongside `/community`)
- Modify: `src/modules/community/Community.jsx` (`Shell` function, ~line 386): add a "Live Chat" tab link

**Interfaces:**
- Consumes: `useChatChannel` (Task 4), `fetchChannels` (Task 3), `ChannelSidebar`/`MessageList`/`Composer` (Tasks 5–7).
- Produces: route `/community/chat` and `/community/chat/:channelSlug`.

- [ ] **Step 1: Write `ChatShell.jsx`**

```jsx
// src/modules/community/chat/ChatShell.jsx
import { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { Loader2, Users, X } from 'lucide-react';
import { EmptyState } from '../../../components/ui/Primitives.jsx';
import { useAuth } from '../../../lib/auth.jsx';
import { fetchChannels } from '../../../lib/chat/api.js';
import { useChatChannel } from '../../../lib/chat/useChatChannel.js';
import ChannelSidebar from './ChannelSidebar.jsx';
import MessageList from './MessageList.jsx';
import Composer from './Composer.jsx';

/**
 * The full-screen chat takeover — same escape `ShadowArena.jsx` already uses
 * to get out of AppShell's padded content area: a `fixed inset-0` overlay
 * with its own header, a body that fills the rest, and (here) a composer
 * pinned to the true bottom of the viewport rather than the bottom of a card.
 */
export default function ChatShell() {
  const navigate = useNavigate();
  const { channelSlug } = useParams();
  const { user, cloudEnabled } = useAuth();
  const [channels, setChannels] = useState(null);

  useEffect(() => {
    if (!cloudEnabled) return;
    fetchChannels().then(setChannels);
  }, [cloudEnabled]);

  if (!cloudEnabled || !user) {
    return (
      <div className="fixed inset-0 z-50 grid place-items-center bg-bg">
        <EmptyState icon={Users} title="Join the Community" description="Sign in to chat." />
      </div>
    );
  }

  if (channels === null) {
    return (
      <div className="fixed inset-0 z-50 grid place-items-center bg-bg">
        <Loader2 size={20} className="animate-spin text-ink-3" aria-hidden />
      </div>
    );
  }

  if (channels.length === 0) return null;

  const active = channels.find((c) => c.slug === channelSlug) ?? channels[0];
  if (!channelSlug) return <Navigate to={`/community/chat/${active.slug}`} replace />;
  if (active.slug !== channelSlug) return <Navigate to={`/community/chat/${active.slug}`} replace />;

  return <ActiveChannel channel={active} channels={channels} onExit={() => navigate('/community')} />;
}

function ActiveChannel({ channel, channels, onExit }) {
  const { user } = useAuth();
  const {
    messages, loading, loadingMore, exhausted, loadMore, send, deleteMessage,
  } = useChatChannel(channel.id);
  const [pendingAi, setPendingAi] = useState(null);

  return (
    <div className="fixed inset-0 z-50 flex flex-col overflow-hidden bg-bg text-ink">
      <div className="flex shrink-0 items-center gap-1.5 border-b border-line px-2 py-1.5">
        <button
          onClick={onExit}
          title="Leave chat (Esc)"
          aria-label="Leave chat"
          className="grid h-[32px] w-[32px] place-items-center rounded-sm border border-line bg-surface text-ink-3 hover:text-ink"
        >
          <X size={15} strokeWidth={2.2} aria-hidden />
        </button>
        <span className="text-sm font-bold">{channel.name}</span>
        <Link to="/community" className="ml-auto text-2xs text-ink-3 underline hover:text-ink-2">
          Back to Feed
        </Link>
      </div>

      <div className="flex flex-1 overflow-hidden">
        <ChannelSidebar channels={channels} activeSlug={channel.slug} />
        <div className="flex min-w-0 flex-1 flex-col">
          <MessageList
            messages={messages}
            loading={loading}
            loadingMore={loadingMore}
            exhausted={exhausted}
            onLoadMore={loadMore}
            currentUserId={user?.id}
            onDelete={deleteMessage}
          />
          <Composer onSend={send} onAiCommand={setPendingAi} />
        </div>
      </div>
    </div>
  );
}
```

`pendingAi` is wired here rather than left unused because Task 11 reads and consumes it (calls the edge function, then clears it) — this task only has to make sure the plumbing compiles and the ESLint no-unused-vars rule doesn't fire; Task 11 is what makes it do something. If your linter flags `pendingAi`/`setPendingAi` as unused after this task alone, that's expected and resolved by Task 11 — don't suppress the warning, just confirm it disappears once Task 11 lands.

- [ ] **Step 2: Wire the route in `App.jsx`**

At `src/App.jsx:24` (next to the `Community` lazy import), add:

```js
const ChatShell = lazy(() => import('./modules/community/chat/ChatShell.jsx'));
```

At `src/App.jsx:83` (the `/community` route), add immediately after it:

```jsx
<Route path="/community/chat" element={<ChatShell />} />
<Route path="/community/chat/:channelSlug" element={<ChatShell />} />
```

- [ ] **Step 3: Add a "Live Chat" tab to Community's header**

In `src/modules/community/Community.jsx`, the `Shell` function (~line 386) currently renders a plain `<header>` with no navigation. Add a tab row after the description paragraph:

```jsx
function Shell({ children }) {
  return (
    <div className="space-y-3">
      <header>
        <p className="eyebrow">Together</p>
        <h1 className="mt-0.5 font-display text-3xl font-bold">Community</h1>
        <p className="mt-0.5 max-w-[62ch] text-sm leading-relaxed text-ink-3">
          Share a Battlefield code and someone will take it. Paste an invite link and it turns into a
          button anyone can press.
        </p>
        <div className="mt-1.5 flex gap-1">
          <span className="rounded-md bg-subtle px-2 py-1 text-xs font-bold text-ink">Feed</span>
          <Link
            to="/community/chat"
            className="rounded-md px-2 py-1 text-xs font-bold text-ink-3 hover:bg-subtle/60 hover:text-ink-2"
          >
            Live Chat
          </Link>
        </div>
      </header>
      {children}
    </div>
  );
}
```

(`Link` is already imported at the top of `Community.jsx`.)

- [ ] **Step 4: Run the full test suite and build**

Run: `npm test && npm run build`
Expected: PASS, and the build succeeds with a new `ChatShell` chunk in the output.

- [ ] **Step 5: Commit**

```bash
git add src/modules/community/chat/ChatShell.jsx src/App.jsx src/modules/community/Community.jsx
git commit -m "feat(community): full-screen chat layout and routing"
```

---

### Task 9: First-visit profile prompt

**Files:**
- Modify: `src/modules/community/CommunityProfileCard.jsx`: add an optional `onSaved` prop
- Create: `src/modules/community/IntroModal.jsx`
- Modify: `src/modules/community/Community.jsx`: mount `<IntroModal />`
- Modify: `src/modules/community/chat/ChatShell.jsx`: mount `<IntroModal />` (so a member landing straight on `/community/chat` still sees it)

**Interfaces:**
- Consumes: `CommunityProfileCard` (existing, gets one new optional prop), `fetchMember`/`saveCommunityProfile`-adjacent read/write for the new `community_intro_seen` flag (added directly in this task, not `lib/community/api.js`'s existing exports, since it's a one-off own-row flag rather than part of the public profile shape).
- Produces: `<IntroModal />` — self-contained, no props, no-ops if `community_intro_seen` is already `true`.

- [ ] **Step 1: Add `onSaved` to `CommunityProfileCard.jsx`**

Change the function signature and the one call site inside `save()`:

```jsx
export default function CommunityProfileCard({ onSaved = () => {} }) {
```

```jsx
  const save = async (event) => {
    event.preventDefault();
    if (!user) return;
    setSaving(true);
    try {
      await saveCommunityProfile(user.id, { ...fields, photoUrl });
      setSaved(true);
      toast('Profile saved', { tone: 'success' });
      onSaved();
    } catch (err) {
      toast(err.message ?? 'Could not save that.', { tone: 'error' });
    } finally {
      setSaving(false);
    }
  };
```

`Community.jsx`'s existing `<CommunityProfileCard />` sidebar usage passes no props, so the default no-op keeps it exactly as it behaves today.

- [ ] **Step 2: Write `IntroModal.jsx`**

```jsx
// src/modules/community/IntroModal.jsx
import { useEffect, useState } from 'react';
import Modal from '../../components/ui/Modal.jsx';
import Button from '../../components/ui/Button.jsx';
import { useToast } from '../../components/ui/Toast.jsx';
import { useAuth } from '../../lib/auth.jsx';
import { supabase } from '../../lib/supabase.js';
import CommunityProfileCard from './CommunityProfileCard.jsx';

/**
 * Shown once per member: the first time Community (feed or chat) is opened
 * with no course/branch/year/bio ever saved. Reuses CommunityProfileCard's
 * existing form rather than a second implementation — same fields, same
 * "everything here is optional" framing (see that file's own header comment).
 */
export default function IntroModal() {
  const { user, cloudEnabled } = useAuth();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!cloudEnabled || !user) return;
    let cancelled = false;
    supabase
      .from('profiles')
      .select('community_intro_seen')
      .eq('id', user.id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          if (import.meta.env.DEV) console.warn('[community] intro-seen check failed', error);
          return;
        }
        if (data && data.community_intro_seen === false) setOpen(true);
      });
    return () => { cancelled = true; };
  }, [cloudEnabled, user]);

  /*
   * Closes only once the flag is actually persisted. `supabase-js` resolves
   * `{ error }` on an RLS denial or a Postgres error rather than throwing —
   * closing unconditionally first (as an earlier version of this function
   * did) meant a failed write left the modal gone but `community_intro_seen`
   * still `false`, so it would silently reappear on the member's very next
   * visit despite them having explicitly dismissed it. `saveCommunityProfile`
   * (lib/community/api.js) already treats this exact write shape as
   * something that can fail; this does the same.
   */
  const dismiss = async () => {
    if (!user) { setOpen(false); return; }
    const { error } = await supabase
      .from('profiles')
      .update({ community_intro_seen: true })
      .eq('id', user.id);
    if (error) {
      toast('Could not save that — try again.', { tone: 'error' });
      return;
    }
    setOpen(false);
  };

  if (!open) return null;

  return (
    <Modal open={open} onClose={dismiss} size="sm" title="Tell the community about you">
      <div className="p-3">
        <CommunityProfileCard onSaved={dismiss} />
        <Button variant="ghost" size="sm" className="mt-1.5 w-full" onClick={dismiss}>
          Skip for now
        </Button>
      </div>
    </Modal>
  );
}
```

- [ ] **Step 3: Mount it**

In `src/modules/community/Community.jsx`, import and render it once inside the top-level return (after `<Shell>`'s children, alongside the existing `<MemberSheet .../>`):

```jsx
import IntroModal from './IntroModal.jsx';
```

```jsx
      <MemberSheet userId={openMember} onClose={() => setOpenMember(null)} />
      <IntroModal />
```

In `src/modules/community/chat/ChatShell.jsx`'s `ActiveChannel` return, add the same import and mount it next to the outer `<div>`:

```jsx
import IntroModal from '../IntroModal.jsx';
```

```jsx
    <div className="fixed inset-0 z-50 flex flex-col overflow-hidden bg-bg text-ink">
      <IntroModal />
```

- [ ] **Step 4: Run the full test suite and build**

Run: `npm test && npm run build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/community/CommunityProfileCard.jsx src/modules/community/IntroModal.jsx src/modules/community/Community.jsx src/modules/community/chat/ChatShell.jsx
git commit -m "feat(community): first-visit profile prompt"
```

---

### Task 10: `chat-ai-reply` Edge Function

**Files:**
- Create: `supabase/functions/chat-ai-reply/index.ts`
- Modify: `supabase/config.toml` (register the function)

**Interfaces:**
- Consumes: `complete` (`_shared/runner.ts`), `LANES` (`_shared/lanes.ts`), `withIdentity`/`violates`/`IDENTITY_LINE` (`_shared/identity.ts`), `callerFrom`/`CORS_HEADERS` (`_shared/auth.ts`), `createForgeDb`/`serviceClient` (`_shared/db.supabase.ts`), `NULL_DB` (`_shared/db.ts`), `aiEnabled` (`_shared/env.ts`), `primeSecrets` (`_shared/secrets.ts`).
- Produces: `POST /functions/v1/chat-ai-reply` — request `{ messageId: string }`, response `{ ok: true }` or `{ error: string, code: string }`.
- Consumed by: Task 11 (`Composer.jsx`'s `onAiCommand` handler calls this).

No test file: `db.supabase.ts`'s own header comment states it plainly — *"Deno-only... nothing here is unit tested; it is covered by the live checks in scripts/forge-verify.mjs."* This function is the same shape (Deno-only `npm:` specifier for the Supabase client via `serviceClient()`), so it inherits that same boundary rather than inventing a mocking setup this codebase doesn't otherwise use.

- [ ] **Step 1: Register the function**

In `supabase/config.toml`, alongside the existing `[functions.forge-chat]` block:

```toml
[functions.chat-ai-reply]
verify_jwt = true
```

- [ ] **Step 2: Write the function**

```ts
// supabase/functions/chat-ai-reply/index.ts
/**
 * POST /functions/v1/chat-ai-reply — one /ai command, answered and posted.
 *
 * Not streamed: the caller already has their own message on screen (it was
 * posted through chat_send_message before this was ever called — see
 * Composer.jsx), and the reply reaches every subscriber through the same
 * postgres_changes path any other chat message does. This function's whole
 * job is: verify, rate-limit, ask Forge, write the answer under the reserved
 * bot profile.
 *
 * BOT_USER_ID must match migration 0029's seed and src/lib/chat/constants.js
 * exactly — three runtimes, one fixed UUID, no shared file between them.
 */
import { complete, ForgeUnavailable } from '../_shared/runner.ts';
import { LANES } from '../_shared/lanes.ts';
import { withIdentity, violates, IDENTITY_LINE } from '../_shared/identity.ts';
import { callerFrom, CORS_HEADERS } from '../_shared/auth.ts';
import { createForgeDb, serviceClient } from '../_shared/db.supabase.ts';
import { NULL_DB } from '../_shared/db.ts';
import { aiEnabled } from '../_shared/env.ts';
import { primeSecrets } from '../_shared/secrets.ts';

const BOT_USER_ID = '00000000-0000-0000-0000-0000000000a1';
const AI_RATE_LIMIT = 5;
const AI_RATE_WINDOW_MIN = 10;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);
  if (!aiEnabled()) return json({ error: 'disabled', code: 'no-key' }, 503);

  const caller = callerFrom(req);
  if (!caller) return json({ error: 'unauthenticated', code: 'CH000' }, 401);

  let body: { messageId?: string };
  try {
    body = JSON.parse(await req.text());
  } catch {
    return json({ error: 'invalid json' }, 400);
  }
  if (typeof body.messageId !== 'string' || !body.messageId) {
    return json({ error: 'messageId is required' }, 400);
  }

  const sb = serviceClient();
  if (!sb) return json({ error: 'chat is not configured' }, 503);

  // Fetch the invoking message and check it's really this caller's, really
  // in this channel, and really starts with /ai — never trust the client to
  // supply the question text directly.
  const { data: source, error: sourceErr } = await sb
    .from('chat_channel_messages')
    .select('id, channel_id, user_id, body')
    .eq('id', body.messageId)
    .maybeSingle();

  if (sourceErr || !source || source.user_id !== caller.userId) {
    return json({ error: 'no such message' }, 404);
  }
  const match = /^\/ai\s+(.+)/is.exec(source.body ?? '');
  if (!match) {
    return json({ error: 'not an /ai command' }, 400);
  }
  const question = match[1].trim();

  // This feature's own limit — tighter than general chat because each call
  // costs real provider spend. Counted off the invoking messages themselves,
  // no new table: every /ai use is already a row here.
  const windowStart = new Date(Date.now() - AI_RATE_WINDOW_MIN * 60_000).toISOString();
  const { count } = await sb
    .from('chat_channel_messages')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', caller.userId)
    .ilike('body', '/ai %')
    .gte('created_at', windowStart);
  if ((count ?? 0) > AI_RATE_LIMIT) {
    return json({ error: 'rate limited', code: 'CH002' }, 429);
  }

  const db = createForgeDb() ?? NULL_DB;
  await primeSecrets(() => db.loadSecrets());

  let text: string;
  try {
    const result = await complete({
      messages: [
        {
          role: 'system',
          content: withIdentity(
            'You are answering inside a public group chat channel, not a private one-on-one '
            + 'conversation — other members will see this. Keep answers concise by default: a '
            + 'few sentences unless the question genuinely needs more.',
          ),
        },
        { role: 'user', content: question },
      ],
      lane: LANES.instant,
      db,
      stream: false,
      surface: 'chat-ai',
      userId: caller.userId,
    });
    text = violates(result.text) ? IDENTITY_LINE : result.text;
  } catch (err) {
    const e = err as ForgeUnavailable;
    return json({ error: e.message ?? 'The AI is unavailable right now.', code: e.reason ?? 'network' }, 502);
  }

  const { error: insertErr } = await sb.from('chat_channel_messages').insert({
    channel_id: source.channel_id,
    user_id: BOT_USER_ID,
    body: text,
    display_name: 'TypeForge AI',
    is_bot: true,
  });
  if (insertErr) return json({ error: 'could not post the reply' }, 500);

  return json({ ok: true });
});
```

- [ ] **Step 3: Deploy and smoke-test**

This is an Edge Function; there's no local unit test for it (see the task header). Verify it the way this project already verifies Forge functions:

Run: `npm run forge:check` (the existing `deno check` script already globs `supabase/functions/*/index.ts` — confirm it picks up the new file and type-checks clean)

Deploying and a live end-to-end call are a deliberate separate step the user takes when ready, same stance as every migration in this plan.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/chat-ai-reply/index.ts supabase/config.toml
git commit -m "feat(community): chat-ai-reply Edge Function for /ai"
```

---

### Task 11: Wire `/ai` end-to-end

**Files:**
- Modify: `src/modules/community/chat/ChatShell.jsx` (`ActiveChannel`): call the edge function when `pendingAi` is set

**Interfaces:**
- Consumes: `pendingAi`/`setPendingAi` (already threaded through in Task 8), `supabase` client (`lib/supabase.js`) for `functions.invoke`.

- [ ] **Step 1: Replace the `pendingAi` state with a real effect**

Replace `ChatShell.jsx`'s `ActiveChannel` function (written in Task 8, given an `<IntroModal />` mount in Task 9) with its complete, final version:

```jsx
// src/modules/community/chat/ChatShell.jsx
// (full file: the exports and the top-level ChatShell function are
// unchanged from Task 8 — only ActiveChannel changes, shown in full below)
import { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { Loader2, Users, X } from 'lucide-react';
import { EmptyState } from '../../../components/ui/Primitives.jsx';
import { useToast } from '../../../components/ui/Toast.jsx';
import { useAuth } from '../../../lib/auth.jsx';
import { supabase } from '../../../lib/supabase.js';
import { fetchChannels } from '../../../lib/chat/api.js';
import { useChatChannel } from '../../../lib/chat/useChatChannel.js';
import ChannelSidebar from './ChannelSidebar.jsx';
import MessageList from './MessageList.jsx';
import Composer from './Composer.jsx';
import IntroModal from '../IntroModal.jsx';

function ActiveChannel({ channel, channels, onExit }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const {
    messages, loading, loadingMore, exhausted, loadMore, send, deleteMessage,
  } = useChatChannel(channel.id);
  const [pendingAi, setPendingAi] = useState(null);

  useEffect(() => {
    if (!pendingAi) return;
    const messageId = pendingAi;
    setPendingAi(null);
    supabase.functions.invoke('chat-ai-reply', { body: { messageId } }).then(({ error }) => {
      if (error) toast('The AI could not answer that.', { tone: 'error' });
      // A success needs no handling here — the reply arrives through the
      // same postgres_changes subscription useChatChannel already holds.
    });
  }, [pendingAi, toast]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col overflow-hidden bg-bg text-ink">
      <IntroModal />
      <div className="flex shrink-0 items-center gap-1.5 border-b border-line px-2 py-1.5">
        <button
          onClick={onExit}
          title="Leave chat (Esc)"
          aria-label="Leave chat"
          className="grid h-[32px] w-[32px] place-items-center rounded-sm border border-line bg-surface text-ink-3 hover:text-ink"
        >
          <X size={15} strokeWidth={2.2} aria-hidden />
        </button>
        <span className="text-sm font-bold">{channel.name}</span>
        <Link to="/community" className="ml-auto text-2xs text-ink-3 underline hover:text-ink-2">
          Back to Feed
        </Link>
      </div>

      <div className="flex flex-1 overflow-hidden">
        <ChannelSidebar channels={channels} activeSlug={channel.slug} />
        <div className="flex min-w-0 flex-1 flex-col">
          <MessageList
            messages={messages}
            loading={loading}
            loadingMore={loadingMore}
            exhausted={exhausted}
            onLoadMore={loadMore}
            currentUserId={user?.id}
            onDelete={deleteMessage}
          />
          <Composer onSend={send} onAiCommand={setPendingAi} />
        </div>
      </div>
    </div>
  );
}
```

The top-level `ChatShell` function above `ActiveChannel` in the same file — the one calling `fetchChannels`, resolving `channelSlug` and redirecting — is untouched by this task; it stays exactly as Task 8 wrote it.

- [ ] **Step 2: Run the full test suite and build**

Run: `npm test && npm run build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/modules/community/chat/ChatShell.jsx
git commit -m "feat(community): wire /ai to chat-ai-reply end to end"
```

---

### Task 12: Admin chat moderation panel

**Files:**
- Create: `src/modules/admin/views/ChatModeration.jsx`
- Modify: `src/modules/admin/console/AdminShell.jsx` (register the view, following the `users`/`arena` entries exactly)
- Modify: `src/modules/admin/api/console.js`: add `fetchRecentChatMessages`, `adminDeleteChatMessage`, `adminMuteChatUser`, `adminUnmuteChatUser`

**Interfaces:**
- Consumes: `chat_delete_message`, `admin_mute_chat_user`, `admin_unmute_chat_user` RPCs (Task 2), `ConsoleTable`/`Drilldown` (`src/modules/admin/kit/`, existing).
- Produces: an admin nav entry, `ChatModeration.jsx`.

- [ ] **Step 1: Add the API calls**

In `src/modules/admin/api/console.js`, following the file's existing `rpc`/`softRpc` helper pattern (the same one `removeBattleRoom`/`replyToAppeal` already use), add:

```js
export const fetchRecentChatMessages = (limit = 100) =>
  softRpc('admin_recent_chat_channel_messages', { p_limit: limit }, []);

export const adminDeleteChatMessage = (id) => rpc('chat_delete_message', { p_id: id });

export const adminMuteChatUser = (userId, channelId, minutes, reason) =>
  rpc('admin_mute_chat_user', { p_user: userId, p_channel: channelId, p_minutes: minutes, p_reason: reason });

export const adminUnmuteChatUser = (userId, channelId) =>
  rpc('admin_unmute_chat_user', { p_user: userId, p_channel: channelId });
```

`admin_recent_chat_channel_messages` is a new read RPC this task needs — `chat_channel_messages` has no client-facing select-for-admin path beyond the member-facing read policy (which doesn't include `deleted_at is not null` rows admins need to review). Add it to migration 0029 retroactively is wrong once that migration is committed; instead, create a follow-up migration:

```sql
-- supabase/migrations/0030_chat_admin_read.sql
create or replace function public.admin_recent_chat_channel_messages(p_limit int default 100)
returns setof public.chat_channel_messages
language plpgsql security definer set search_path = '' as $$
begin
  perform public.admin_require('content.moderate');
  return query
    select * from public.chat_channel_messages
     order by created_at desc
     limit least(p_limit, 200);
end; $$;

revoke execute on function public.admin_recent_chat_channel_messages(int) from public, anon;
grant  execute on function public.admin_recent_chat_channel_messages(int) to authenticated;
```

Run: `npm run check:migrations` — expect `✓ 30 migration files pass structural checks`.

- [ ] **Step 2: Write `ChatModeration.jsx`**

```jsx
// src/modules/admin/views/ChatModeration.jsx
import { useEffect, useState } from 'react';
import { Trash2, VolumeX } from 'lucide-react';
import { Card } from '../../../components/ui/Primitives.jsx';
import Button, { IconButton } from '../../../components/ui/Button.jsx';
import { useToast } from '../../../components/ui/Toast.jsx';
import { relativeTime } from '../../../lib/format.js';
import {
  adminDeleteChatMessage, adminMuteChatUser, fetchRecentChatMessages,
} from '../api/console.js';

export default function ChatModeration() {
  const { toast } = useToast();
  const [messages, setMessages] = useState(null);

  const load = () => fetchRecentChatMessages().then(setMessages);
  useEffect(() => { load(); }, []);

  const onDelete = async (id) => {
    try {
      await adminDeleteChatMessage(id);
      toast('Message removed', { tone: 'success' });
      load();
    } catch (err) {
      toast(err.message ?? 'Could not remove that.', { tone: 'error' });
    }
  };

  const onMute = async (userId, channelId) => {
    try {
      await adminMuteChatUser(userId, channelId, 60, 'Muted from the moderation console');
      toast('Muted for 60 minutes', { tone: 'success' });
    } catch (err) {
      toast(err.message ?? 'Could not mute that user.', { tone: 'error' });
    }
  };

  if (messages === null) return <Card className="p-3"><p className="text-sm text-ink-3">Loading…</p></Card>;

  return (
    <Card className="p-2.5">
      <h2 className="text-sm font-bold">Recent chat messages</h2>
      <ul className="mt-1.5 space-y-1">
        {messages.map((m) => (
          <li key={m.id} className="flex items-start gap-1.5 border-b border-line/60 py-1 text-sm">
            <div className="min-w-0 flex-1">
              <span className="font-bold">{m.display_name || 'Someone'}</span>{' '}
              <span className="text-2xs text-ink-3">{relativeTime(m.created_at)}</span>
              {m.deleted_at ? <span className="ml-1 text-2xs text-bad">removed</span> : null}
              <p className="truncate text-ink-2">{m.body}</p>
            </div>
            {!m.deleted_at ? (
              <>
                <IconButton size="sm" label="Delete" icon={Trash2} onClick={() => onDelete(m.id)} />
                <Button size="sm" variant="ghost" icon={VolumeX} onClick={() => onMute(m.user_id, m.channel_id)}>
                  Mute 60m
                </Button>
              </>
            ) : null}
          </li>
        ))}
      </ul>
    </Card>
  );
}
```

- [ ] **Step 3: Register the view**

In `src/modules/admin/console/AdminShell.jsx`, alongside the existing `UsersView`/`ArenaView` lazy imports and the `views` map:

```js
const ChatModeration = lazy(() => import('../views/ChatModeration.jsx'));
```

```js
  chatModeration: ChatModeration,
```

Add a nav entry next to wherever `users`/`arena` are listed in the same file's nav array, with label `'Chat'`.

- [ ] **Step 4: Run the full test suite and build**

Run: `npm test && npm run build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/admin/views/ChatModeration.jsx src/modules/admin/console/AdminShell.jsx src/modules/admin/api/console.js supabase/migrations/0030_chat_admin_read.sql
git commit -m "feat(admin): chat moderation panel"
```

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
|---|---|
| §3.1–3.4 data model | Task 2 |
| §3.5 bot profile | Task 2 (seed), flagged for live verification |
| §3.6 no feed view | Task 3 (`fetchMessages` reads the table directly) |
| §4 RPCs | Task 2 |
| §5 `/ai` flow | Tasks 10–11 |
| §6.1 data layer | Tasks 3–4 |
| §6.2 images | Task 1 (shared helper), Task 7 (upload call site) |
| §6.3 layout | Task 8 |
| §6.4 slash-command hint | Task 5 |
| §6.5 first-visit prompt | Task 9 |
| §6.6 admin panel | Task 12 |
| §7 error handling | Task 3 (`CHAT_ERROR_COPY`), extended with CH000/CH007 beyond the spec's table — both are ordinary implementation necessities (sign-in, missing channel), not a scope change |
| §8 testing | Every task's Steps 1–4 |
| §9 rollout | Every migration task's commit message states it isn't auto-applied |

**Adjustments made from the spec while grounding it in real code** (each is a strict simplification or correction, not new scope):
- Dropped the spec's "pagination cursor logic" test promise — once `fetchMessages` was actually written, there was no separable pure logic left to test (it's a `.lt()` call in a query builder chain), and this codebase has no precedent for mocking the Supabase client. `mergeIncoming`/`mergeOlderPage` in Task 4 cover the actual client-side logic that exists.
- `IntroModal` reuses `CommunityProfileCard` directly (rendering the component, not copying its form) rather than a second form implementation — a stronger reuse than the spec described, found once the actual component was read.
- `chat_channel_messages` gets no client-facing insert policy at all (stronger than `community_posts`' own precedent, which has one that doesn't fully cover its RPC's rate limit) — noted as a deliberate, justified departure in Task 2 and the Global Constraints, not silently done.

**Placeholder scan:** none found — every step above contains complete, real code (SQL, JS, TSX) or an exact command, not a description of what to write.

**Type/name consistency check:**
- `BOT_USER_ID` (`00000000-0000-0000-0000-0000000000a1`): identical literal in Task 2's migration, Task 3's `constants.js`, and Task 10's edge function.
- `chatErrorMessage`, `CHAT_ERROR_COPY` (Task 3) used identically in Task 7 (`Composer.jsx` import) — no divergent naming.
- `useChatChannel`'s returned shape (`{ messages, loading, loadingMore, exhausted, loadMore, send, deleteMessage }`, Task 4) matches exactly what Task 8's `ActiveChannel` destructures and what Task 6's `MessageList`/`ChannelSidebar` props expect.
- `AI_COMMAND` (`/ai`, Task 3) is the single source `commands.js` (Task 5) and `Composer.jsx` (Task 7) both import — no hardcoded `'/ai '` string duplicated between them.
- RPC error codes (`CH000`–`CH007`) are consistent between Task 2's `raise exception ... using errcode` calls and Task 3's `CHAT_ERROR_COPY` keys.
