# Community Live Chat — Phase 1 (Foundation)

Status: approved for planning
Author: pairing session, 2026-09-05

## 1. Context

Community today is a single shared feed (`community_posts` / `community_feed`,
migration 0025) plus post-pinning (0027): people post text, optionally share a
Battlefield PIN that becomes a join button, and see a profile card per member
(`community_profiles`, a narrow projection over `profiles` — see 0025 §24).
There is no real-time messaging surface; every update is a debounced refetch
of the whole feed.

The ask is a Discord/Telegram-shaped live chat, sitting *alongside* the
existing feed (the feed is not touched). Full scope — channels, images, link
previews, threads, reactions, mentions, presence, a `/ai` bot, and a full
moderation suite with reports and filters — is too large for one pass. This
spec covers **Phase 1 only**: the smallest version of this that is a real,
usable, moderated chat. Phases 2–4 (link previews, threads, reactions,
mentions/presence, the full reports-and-filters moderation suite) get their
own specs once Phase 1 is live and its actual usage is known.

### Non-goals for Phase 1

- User-created channels. The channel list is fixed and admin-curated
  (seeded by migration). Channel management UI is a later phase.
- Link previews, threaded replies, emoji reactions, @mentions, typing
  indicators, presence. Explicitly deferred to Phase 2.
- A reports queue, word/link filters, or admin-tunable rate limits. Phase 1
  ships fixed rate limits and delete/mute only; the full moderation suite is
  Phase 4.
- Generic file attachments. Images only, matching the existing avatar-upload
  precedent (`lib/community/photo.js`) rather than opening up arbitrary file
  types.
- Retroactively updating a message's author name/avatar if the member
  changes theirs later (see §3.2 trade-off).

## 2. Decisions

Recorded here because each one was a real fork, not the only option.

| Decision | Chosen | Rejected alternative(s) | Why |
|---|---|---|---|
| Realtime transport | `postgres_changes` INSERT, filtered per channel, appended live to local state | Broadcast-first with async persistence (Battlefield's tick model) | Chat isn't latency-sensitive the way a 1Hz race position is; broadcast-first means dual-writing and reconciling an optimistic message against its eventual DB row/id for no real payoff. `BattleRoom.jsx`'s roster subscription is the closer precedent than Community's own coalesced-refetch, because a feed flash-and-resort reads wrong for a chat — messages must stream in one at a time. |
| Channel model | Fixed, seeded list (`#general`, `#help`) | User-created channels | YAGNI for v1; nothing here blocks adding channel management later, it's just seed data plus (eventually) a creation RPC. |
| Author identity on a message | Snapshotted at post time (`display_name`, `avatar`, `photo_url` copied onto the row) | Live join to `community_profiles` on read | Keeps the realtime INSERT payload self-sufficient (no per-message round trip to resolve the author) and matches how a chat log actually reads — old messages don't get retroactively relabeled. Trade-off: renaming yourself doesn't relabel your history. Explicit, not accidental. |
| `/ai` timing | Ships working in Phase 1, alongside the slash-command hint | Hint ships now, command works in Phase 3 | A listed command that does nothing when you use it is the same "dead command with a working keystroke" problem `CommandPalette.jsx` already documents and avoids elsewhere in this app. |
| `/ai` guardrails | Same safety posture as the rest of the app's AI, routed through the existing budget-aware path | An "unfiltered" bot with "no limitations" (as originally requested) | This is a public, shared surface — every member sees whatever the bot outputs, and it would sit directly beside the moderation this same feature ships with. An unguarded bot and a moderated chat room work against each other. |
| Moderation scope | Chat-scoped delete + time-boxed mute, reusing `admin_can('content.moderate')` | Reusing account-wide `setUserStatus` suspension for chat infractions | A mute-from-chat is a lighter, more proportionate action than suspending the whole account, and the permission check already exists — no new admin capability model needed. |
| Image handling | Images only, dedicated `chat-images` bucket, shared validate/downscale helper extracted from `photo.js` | Generic file attachments | Matches existing precedent exactly; arbitrary file types are a real, separate scope (MIME sniffing, malware surface) nobody asked for. |

## 3. Data model

New migration: `supabase/migrations/0029_community_chat.sql`.

### 3.1 `chat_channels`

```
id          uuid primary key default gen_random_uuid()
slug        text unique not null              -- 'general', 'help'
name        text not null                     -- '#general'
description text
sort_order  int not null default 0
created_at  timestamptz not null default now()
```

Seeded with two rows: `general`, `help`. Read-only to clients (no insert
policy) — creating a channel is an operator/migration action in Phase 1.

### 3.2 `chat_messages`

```
id            uuid primary key default gen_random_uuid()
channel_id    uuid not null references chat_channels on delete cascade
user_id       uuid not null references auth.users on delete cascade
body          text check (length(btrim(body)) between 1 and 2000)
image_url     text
display_name  text                            -- snapshotted, see §2
avatar        text
photo_url     text
is_bot        boolean not null default false
created_at    timestamptz not null default now()
deleted_at    timestamptz

check (body is not null or image_url is not null)   -- at least one of the two
```

2000 chars because a chat message is not a feed post (Discord's own number,
chosen for a familiar ceiling rather than an arbitrary one).

Index: `(channel_id, created_at desc) where deleted_at is null`, mirroring
`community_posts_feed_idx`.

RLS, same shape as `community_posts`:
- **read**: authenticated, `deleted_at is null`.
- **insert**: `user_id = auth.uid()`, account `status = 'active'`, and no
  live mute (see §3.3) covering this channel or globally.
- **update** (soft-delete only): `user_id = auth.uid() or admin_can('content.moderate')`.

### 3.3 `chat_mutes`

```
id          uuid primary key default gen_random_uuid()
user_id     uuid not null references auth.users on delete cascade
channel_id  uuid references chat_channels on delete cascade   -- null = global
reason      text
muted_by    uuid not null references auth.users
muted_until timestamptz not null
created_at  timestamptz not null default now()
```

A mute is "live" if `muted_until > now()`. `chat_send_message` checks this;
expired mutes are simply ignored rather than cleaned up eagerly (same
lazy-expiry stance `battle_reap` takes elsewhere in this codebase).

### 3.4 `profiles.community_intro_seen`

```
alter table public.profiles
  add column if not exists community_intro_seen boolean not null default false;
```

Set by either Save or Skip on the first-visit modal (§5.5). Durable across
devices, unlike a `localStorage` flag — consistent with this app's existing
bias toward server-owned state for anything beyond a per-viewer convenience.

### 3.5 The reserved "TypeForge AI" profile

A single, fixed-UUID row in `auth.users`/`profiles` (e.g.
`00000000-0000-0000-0000-0000000000a1`, or whatever constant the
implementation settles on — the exact value isn't load-bearing, only that
it's fixed and documented in one place, e.g. `lib/chat/constants.js`), seeded
once by the migration, with `display_name = 'TypeForge AI'` and `is_bot`
messages flowing through it like any other author.

**Flagged for verification during implementation:** I have not inspected
`auth.users`' exact column constraints in this Supabase project. Supabase
does support seeding a service/system auth user via direct SQL insert, but
the required columns (`instance_id`, `aud`, `role`, etc.) need to be checked
against this project's actual schema rather than assumed here. If a direct
insert turns out to be awkward, the fallback is minting the bot account once
via the existing `signInAnonymously` path (the same mechanism guest players
already use) and hardcoding the resulting UUID — slightly less clean, but
proven to work in this codebase already.

### 3.6 No feed view, deliberately

`community_feed` exists as a view because it joins `community_posts` to the
`community_profiles` projection. Chat doesn't need that join — §2's
snapshot decision means `chat_messages` already carries every column a
reader needs. Clients read the table directly (`select * from chat_messages
where channel_id = ... and deleted_at is null`), the same way
`fetchRoster`/`fetchRoom` in `battle/api.js` read `battle_players`/
`battle_rooms` directly with no view in between. Adding one here would be
structure with nothing behind it.

## 4. RPCs

All `security definer`, `search_path = ''`, following `community_post`'s
exact shape.

- **`chat_send_message(p_channel uuid, p_body text, p_image_url text default null)`**
  Checks: signed in, account active, not muted (channel-specific or global),
  rate limit (20 messages/minute/user across all channels — counted the same
  way `community_post` counts `CM001`, just against `chat_messages`), body/image
  present. Inserts with the caller's *current* profile fields snapshotted in.
- **`chat_delete_message(p_id uuid)`** — soft-delete; own message or
  `admin_can('content.moderate')`. Same shape as `community_delete_post`.
- **`admin_mute_chat_user(p_user uuid, p_channel uuid default null, p_minutes int, p_reason text)`**
  / **`admin_unmute_chat_user(p_user uuid, p_channel uuid default null)`** —
  gated by `admin_can('content.moderate')`, logged to the existing audit log
  the way `admin_remove_battle_room` already is.

## 5. `/ai`

1. Client detects a message body starting with `/ai ` before sending.
2. The message posts **normally** through `chat_send_message` — it stays
   visible, like any Discord or Telegram bot invocation. No hidden state.
3. Client calls a new edge function, `chat-ai-reply` (sibling to
   `forge-chat`), with `{ channelId, question }`.
4. The function:
   - Enforces its own rate limit — 5 calls per 10 minutes per user, tighter
     than general chat since each one costs real provider spend — counted by
     querying recent `chat_messages` rows from this user where
     `body ilike '/ai %'` in the last 10 minutes (no new table needed; the
     invoking message itself is the record).
   - Calls Forge through the same budget-aware path `ai.js`/`ai-runner.js`
     already uses elsewhere, so `/ai` inherits the existing daily
     provider-spend ceiling rather than a new one. System prompt: concise,
     helpful, aware it's replying in a shared public channel. Normal safety
     posture — no special "unfiltered" mode (see §2).
   - Inserts the reply into `chat_messages` under the reserved bot profile
     (§3.5), using the service-role client — this is the one place a message
     is written by someone other than its own `auth.uid()`, and it's done
     from a trusted server context, not by loosening client-facing RLS.
5. The reply reaches every subscriber through the same live-append path as
   any other message (§6.1) — no separate delivery mechanism for bot replies.
6. Rendering distinguishes `is_bot` messages with a small badge, so nobody
   mistakes the bot for a member.

## 6. Client

### 6.1 Data layer

- **`src/lib/chat/api.js`** — `fetchChannels`, `fetchMessages` (keyset
  pagination on `created_at`, same pattern as `fetchFeed`), `sendMessage`,
  `deleteMessage`.
- **`src/lib/chat/useChatChannel.js`** — shaped like `useBattleRoom.js`:
  subscribes to `postgres_changes` INSERT on `chat_messages` filtered to
  `channel_id=eq.<id>`, appends the new row directly to local state (no
  refetch — see §2). Exposes `send`, `deleteMessage`, `loadMore`.
- **`src/lib/chat/constants.js`** — the bot's fixed UUID and any other
  shared constants.

### 6.2 Images

- New bucket `chat-images`: public-read, 5 MB cap, downscale long edge to
  1600px (viewed at full size, unlike a 512px avatar).
- **`src/lib/media/image.js`** (new) — `validatePhoto`/`downscale` extracted
  out of `lib/community/photo.js` and parameterized by max bytes/edge, so
  avatar upload and chat image upload share one implementation instead of a
  copy-paste. `photo.js` becomes a thin wrapper calling the shared helper
  with avatar-sized limits, so its existing call sites (and
  `community.test.js`'s `validatePhoto` coverage) keep working unchanged.

### 6.3 Layout

- New route `/community/chat/:channelSlug?`, reachable via a tab on the
  existing Community header (Feed stays the default landing tab).
- A full-screen takeover reusing `ShadowArena.jsx`'s exact escape —
  `fixed inset-0 z-50 flex flex-col overflow-hidden` — rather than a new
  pattern: channel sidebar (left), message pane (fills remaining height,
  auto-scrolls to newest), composer pinned to the true bottom of the
  viewport.

### 6.4 Slash-command hint

- A small popup anchored above the composer, appears when the message starts
  with `/`, filters as more is typed. Backed by a plain array —
  `[{ command: '/ai', description: '...' }]` — so a second command later is
  a one-line addition, not new UI. Tab/Enter accepts, Escape dismisses.

### 6.5 First-visit profile prompt

- A `Modal` shown once per member, the first time `/community` (feed or
  chat) is opened with `community_intro_seen = false`. Reuses
  `CommunityProfileCard`'s existing form and `saveCommunityProfile` call
  rather than a second implementation — same fields, same "everything here
  is optional" framing. Both "Save" and "Skip for now" set
  `community_intro_seen = true`.

### 6.6 Admin moderation panel

- A `ChatModeration` view under the existing admin console, reusing the
  `ConsoleTable`/`Drilldown` kit already in `src/modules/admin/kit/`: a list
  of recent messages across channels with delete and mute actions.

## 7. Error handling

A `CHAT_ERROR_COPY` map in `lib/chat/api.js`, the same idiom as
`BATTLE_ERROR_COPY` / `COMMUNITY_ERROR_COPY`:

| Code | Meaning |
|---|---|
| CH001 | Rate limited (general chat) |
| CH002 | Rate limited (`/ai` specifically) |
| CH003 | Muted (channel-specific or global, with reason if the operator gave one) |
| CH004 | Empty message (no body, no image) |
| CH005 | Not your message (delete without permission) |
| CH006 | Image too large / unsupported type (surfaced by the shared image helper) |

## 8. Testing

Same boundary the rest of this codebase already draws — pure logic gets
unit tests written test-first; RPCs/RLS aren't unit-testable without a live
Postgres (no test file exists for `battle/api.js` or `community/api.js`
either) and are caught structurally by `check:migrations`, same as
Battlefield and Community today.

TDD coverage for Phase 1:
- `lib/media/image.js` — the extracted validate/downscale pair (byte/type
  bounds, downscale math), plus a regression check that `photo.js`'s
  existing avatar-sized behavior is unchanged post-extraction.
- `CHAT_ERROR_COPY` mapping (mirrors the existing `BATTLE_ERROR_COPY` test
  shape, if one exists, or establishes the pattern if not).
- Pagination cursor logic in `lib/chat/api.js`.
- Slash-command hint's filter/match logic (pure function, no DOM needed).
- `useChatChannel.js`'s message-append/dedupe logic, to whatever extent it
  can be isolated from the Supabase client the way `useBattleRoom.js`'s
  checkpoint-interval math already is.

## 9. Rollout

New migration (`0029_community_chat.sql`) is written to the repo and
reviewed like 0028 was, but — consistent with how this session has already
been operating — **not applied to the live Supabase project automatically**;
that's a deliberate, separate step the user takes when ready.
