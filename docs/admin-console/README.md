# TypeForge admin console

`/admin` — an operator command centre over the platform: eight modules, one
permission model, every mutation audited.

## What it is built on

| Layer | Where |
|---|---|
| Schema, RBAC, RPCs | `supabase/migrations/0014_admin_console.sql` |
| Bootstrap owner | `supabase/migrations/0015_seed_console_owner.sql` |
| Retention fix | `supabase/migrations/0016_retention_shows_empty_cohorts.sql` |
| Suspension revokes access | `supabase/migrations/0017_suspension_revokes_console.sql` |
| Suspension notice (end user) | `src/modules/auth/SuspendedNotice.jsx`, `src/lib/accountStatus.js` |
| Data access | `src/modules/admin/api/console.js` |
| Component kit | `src/modules/admin/kit/` |
| Shell, strip, module registry | `src/modules/admin/console/` |
| The eight modules | `src/modules/admin/views/` |
| Build rules for new views | `docs/admin-console/BUILD-CONTRACT.md` |

The access gate is `src/modules/admin/AdminPanel.jsx`. It resolves the caller's
scope set once via `admin_scopes()` and hands it to the shell — so every control
the UI enables is derived from the same function the database consults before
accepting the action behind it. A visible button and a rejected RPC cannot
disagree.

## Getting in

### 1. Apply the migration

```bash
supabase db push                 # against the linked project
# or, to check it locally first:
supabase start                   # needs Docker running
```

It depends on 0001 (profiles/sessions), 0002 (user_roles, is_admin, ai_usage),
0009 (battlefield), 0010 (shadow) and 0011 (forge). It is additive: no existing
table is dropped, no existing policy is replaced, and the `app_role` enum is left
alone deliberately.

### 2. Promote the first owner

`0015_seed_console_owner.sql` does this, keyed on an email address so the same
file works against any environment. Edit the address in that file and re-run
`supabase db push` to hand ownership to someone else. If the account has not
signed up yet the migration is a no-op and says so rather than failing.

To do it by hand instead:

```sql
insert into public.user_roles (user_id, role, admin_tier)
values ('<your-auth-user-uuid>', 'admin', 'owner')
on conflict (user_id) do update
  set role = 'admin', admin_tier = 'owner';
```

An existing admin from before this migration keeps working — a `NULL`
`admin_tier` is read as `admin`. Only an `owner` can grant tiers to anyone else,
and nobody can change their own, so a project cannot end up with zero owners.

### 3. Enable Realtime (optional)

The Arena's live board pushes on change when Realtime is on for
`battle_rooms`, `battle_players`, `shadow_rooms` and `shadow_players`. It also
polls every 5s, so leaving Realtime off degrades the freshness, not the
correctness.

## Permission model

Access is a **scope set**, not a role. `is_admin()` from 0002 is unchanged and
every policy written against it still works; `admin_can('users.write')` is the
finer gate on everything that mutates.

| Tier | Grants |
|---|---|
| `owner` | Everything, including `roles.write` |
| `admin` | Everything except `roles.write` |
| `analyst` | Read-only across every module |
| `support` | Read, plus `users.write` and `content.moderate` |

Scopes: `analytics.read`, `users.read`, `users.write`, `users.delete`,
`ai.read`, `ai.write`, `content.read`, `content.moderate`, `config.write`,
`audit.read`, `roles.write`.

`public.admin_tier_scopes()` is authoritative.
`src/modules/admin/console/scopes.js` mirrors it for display only, and
`scopes.test.js` parses the migration and fails the build if the two drift.

**Reads never throw on permission** — a caller without the scope gets an empty
result, following 0002's convention. **Writes always throw** (Postgres 42501),
surfaced as "Your admin tier does not include this action."

## Suspension

Suspension is a `profiles.status` flag, not a GoTrue ban, so it is reversible
and the app can explain itself.

- **The suspended person is told.** `SuspendedNotice` blocks the app with the
  operator's own reason, the date it was applied, and a
  three-day appeal window (`APPEAL_WINDOW_DAYS` in `src/lib/accountStatus.js`).
  Sign-out stays available — locking someone out of the sign-out button traps
  a shared device on their session.
- **A suspended operator loses the console.** `admin_scopes()` returns nothing
  unless the caller's profile is `active` (0017). This was a real gap: before
  it, suspending a rogue admin left them with every scope including
  `users.delete`. `is_admin()` is deliberately unchanged — the role is still
  held; what it can *do* is what scopes answer.
- **Removal is reversible.** `status = 'deleted'` drops an account out of the
  default roster; the Removed filter brings it back and an operator can
  reactivate it. Purging the `auth.users` record itself is a separate
  service-role operation and is not wired to the console.

## API keys

No key passes through the console, ever.

- `ai_providers.secret_ref` stores the **name** of an Edge Function secret.
- `key_present` and `key_tail` are written server-side by the function that can
  actually read the secret.
- `admin_upsert_provider` rejects a `secret_ref` that is not a
  `SCREAMING_SNAKE_CASE` environment variable name, so the column cannot be
  repurposed to smuggle a value.
- No admin RPC takes a key parameter. `scopes.test.js` asserts this.

To set or rotate one:

```bash
supabase secrets set <SECRET_NAME>=…
supabase functions deploy
```

`npm run check:bundle` fails the build if a provider key **or a vendor
identifier** reaches `dist/`. The console's own copy therefore never names a
provider — the examples it shows are built from the row's own `secret_ref` at
runtime.

## Audit

Every mutation writes an `admin_audit_log` row **in the same transaction as the
change it describes**. If the audit insert fails, the change rolls back. The
table has a select policy and no insert, update or delete policy at all — rows
arrive only via `admin_audit()`, which is `SECURITY DEFINER` and granted to
nobody.

Destructive actions require a reason (the RPC rejects an empty one), and
irreversible ones additionally require the operator to type the record's own
identifier.

## What is deliberately not measured

**Revenue.** TypeForge has no billing system, so `admin_kpis` returns SQL
`NULL` and the Reports module says "not instrumented" rather than `$0`.
Instrumenting it needs a payments provider, an entitlements table keyed to
`auth.users`, and a webhook that records charges.

**Model cost without a rate.** `ai_models.input_cost_per_1k` and
`output_cost_per_1k` are nullable and `NULL` is not zero — it means unrated.
The AI module reports unrated call counts alongside every spend estimate. This
is the same contract `src/modules/admin/costs.js` has always held.

**WAU and MAU are approximations.** `admin_timeseries` returns distinct users
per day; the rolling sums in Reports count a person once per day they appeared,
not once per window. The panel says so.

## Adding a module

1. Add a row to `src/modules/admin/console/modules.js` (path, id, label, icon,
   scope, description, keywords).
2. Add a lazy import and a `VIEWS` entry in `console/AdminShell.jsx`.
3. Write the view against `docs/admin-console/BUILD-CONTRACT.md`.

The strip, the route table, the ⌘K entries and the scope gating all derive from
that one registry row, so they cannot fall out of step.

## Adding a setting

`insert into public.platform_config (key, value, category, label, description, schema)`.
The Settings module generates its editor from the `schema` column, so a new
knob needs no UI change at all.

## Verification

```bash
npm run verify     # vite build + bundle secret scan + vitest
```

`scopes.test.js` additionally checks, by parsing the migration:

- every tier's scope list matches `admin_tier_scopes()`
- `roles.write` belongs to `owner` alone
- the `analyst` tier holds no write scope
- every mutation RPC calls both `admin_require()` and `admin_audit()`
- every mutation RPC is `SECURITY DEFINER` with a pinned `search_path`
- no admin function takes a key parameter and `ai_providers` has no column that
  could hold one
