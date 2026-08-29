# Forge AI — Implementation Plan

**Status:** plan only · not implemented
**Version:** 1.0 (2026-08-28)
**Target stack:** Supabase Edge Functions (Deno) + Postgres 17.6 + pgvector 0.8.2
**Reads:** [PRD.md](./PRD.md) · [ARCHITECTURE.md](./ARCHITECTURE.md)
**Companion:** [RESOURCES.md](./RESOURCES.md)

---

## 0. Verified project state

Checked live against project `kavfjyvsvgvcjiuwwfbw` (ap-south-1) on 2026-08-28.

| Check | Result |
|---|---|
| Postgres | **17.6** |
| pgvector available | **0.8.2** — `halfvec` (≥0.7) and iterative scan (≥0.8) both supported |
| pgvector installed | **No** — `installed_version: null`. Phase 1 step 1. |
| Public tables | 16 + `_schema_migrations` |
| Applied migrations | **0001–0009** (9 rows) |
| `public.is_admin()` | Present |
| `battle_*` functions | 17 present — `0009_battlefield` fully applied |
| `shadow_*` tables | **0** |
| Edge Functions deployed | **0** |
| `auth.users` | **0 rows** |
| Row counts, all tables | 0 — clean project |

### Three things to resolve before Phase 1

> **Status: B-1 and B-2 resolved. B-3 partly — anonymous verified, Google not.**

> **✅ B-1 · RESOLVED · `0010_shadow_battle.sql` is not applied.** The repo has it; the
> database has none of its tables. The Shadow Battle code in `src/lib/shadow/`
> will fail against this project. Forge AI's migration is numbered `0011` and
> depends on nothing in `0010`, but shipping `0011` over a database missing
> `0010` leaves the migration ledger permanently ambiguous. **Apply `0010`
> first**, or renumber Forge AI to `0010` and delete the Shadow Battle
> migration. Decide before writing any SQL.
>
> *Resolved by applying `0010`. It could never have applied as written: it
> referenced `profiles.avatar_url`, but `0007` creates that column as
> `avatar`. Three occurrences fixed, then applied clean.*

> **✅ B-2 · RESOLVED · `public._schema_migrations` has RLS disabled.** It is reachable by
> the `anon` and `authenticated` roles, so anyone holding the publishable key
> can read — and write — your migration ledger. The fix is one statement, but
> enabling RLS with no policy blocks all access, so confirm nothing in
> `scripts/migrate-supabase.mjs` reads it through PostgREST first:
>
> ```sql
> alter table public._schema_migrations enable row level security;
> -- no policy: service role only, which is what the migrate script uses
> ```

> **🟡 B-3 · PARTLY RESOLVED · Auth providers could not be verified.** `auth.users` is empty, so
> there is no identity row to confirm Google or anonymous sign-in is actually
> wired. Both are claimed configured. Verify by hand in the dashboard before
> Phase 2, because the whole gate depends on it: sign in with Google once, and
> call `signInAnonymously()` once, then re-check `select count(*) from
> auth.users`.
>
> *Anonymous is verified: 5 anonymous users exist and both `forge-chat` and
> `forge-generate` have answered live on anonymous session tokens. Google is
> still unverified — `auth.identities` has 0 rows with `provider = 'google'`,
> so nobody has completed that flow yet. It needs one real sign-in through a
> browser; no server-side check can substitute for it.*

---

## 1. What changes versus ARCHITECTURE.md

The architecture doc recommended Vercel Functions and left the host as open
question #1. **That is now answered: Supabase Edge Functions.** The router,
schema, streaming grammar, caching ladder and identity clamp are unchanged. The
runtime is not, and it brings five hard constraints that reshape the plan.

| Constraint | Value | Consequence |
|---|---|---|
| **CPU time** | **2 s per request** | The hard one. CPU excludes async I/O, so waiting on a provider is free — but per-frame regex, JSON parsing and hashing are not. The identity filter runs on the delta plus a short carry, never on the accumulated answer. |
| **Wall clock** | 150 s free · 400 s paid | Fine for the 60 s `long` lane. The worker is shared: it stays alive across requests and background tasks. |
| **Memory** | 256 MB | Never buffer a whole response. Stream through. |
| **Idle timeout** | 150 s | No response before this → 504. |
| **EarlyDrop** | Isolate retires when the response has returned *and* every `waitUntil` promise has resolved | A stream forwarded without `EdgeRuntime.waitUntil()` **gets cut mid-answer**. This is documented Scenario 4 in Supabase's own troubleshooting guide. |
| **Bundle size** | 20 MB after bundling | Fine — no heavy dependencies. |

### Consequences

1. **Streaming must be wrapped in `EdgeRuntime.waitUntil()`.** The canonical
   pattern from the Supabase docs:

   ```ts
   const { readable, writable } = new TransformStream()
   EdgeRuntime.waitUntil(pump(upstream.body, writable))   // keeps the isolate alive
   return new Response(readable, { headers: { 'Content-Type': 'text/event-stream' } })
   ```

   Forge needs a transforming pump (parse → filter → re-emit), not a raw
   `pipeTo`, but the `waitUntil` wrapper is identical and mandatory.

2. **The client cannot use `supabase.functions.invoke()`.** It parses the whole
   response before returning. Streaming requires raw `fetch` against
   `https://kavfjyvsvgvcjiuwwfbw.supabase.co/functions/v1/<name>` and
   `response.body.getReader()`.

3. **Write-back moves out of the request.** `waitUntil` prevents early
   retirement but does **not** extend the wall clock, and the embedding call
   plus insert would burn CPU inside a request that is trying to stay under
   2 s. Instead the request enqueues to **pgmq**, and a `pg_cron`-scheduled
   drain function does the embedding and the insert. This is Supabase's own
   documented pattern for automated embedding generation.

4. **JWT verification is local.** `SUPABASE_JWKS` is injected into every
   function's environment, identical to the JWKS served at
   `/auth/v1/.well-known/jwks.json`. Verify against it in-process — no network
   round trip in the latency budget.

5. **New API keys go in the `apikey` header, not `Authorization`.**
   `sb_publishable_...` and `sb_secret_...` are not JWTs; sending one as a
   bearer token fails both the platform check and your handler. The client
   sends both headers: `apikey: sb_publishable_…` and
   `Authorization: Bearer <user-jwt>`.

---

## Phase 1 — Database, RLS, pgvector

**Goal:** `0011_forge_ai.sql` applied, indexed, and provably queryable.

### Steps

1. Resolve **B-1** (apply `0010` or renumber). Resolve **B-2**.
2. `create extension if not exists vector with schema extensions;`
   Confirm it lands at 0.8.2 — below 0.8 the iterative-scan settings must be
   dropped from `forge_match()`.
3. `create extension if not exists pgmq;` and `pg_cron` (needed by Phase 6).
4. Write `supabase/migrations/0011_forge_ai.sql` from
   [ARCHITECTURE.md §4](./ARCHITECTURE.md#4-database-schema):
   `forge_generations`, `forge_generation_serves`, `forge_model_health`,
   `forge_budget`; the `ai_usage` column additions; all indexes; RLS on every
   table; `forge_match()` as `security definer`.
5. Add `forge_request_log` (see §Phase 8) and the `forge_embed_queue` pgmq
   queue.
6. Apply through the existing `scripts/migrate-supabase.mjs` so the ledger stays
   consistent — not through the dashboard SQL editor.

### Verification (each can fail)

```sql
-- V1.1 extension present at the version the plan assumes
select extversion from pg_extension where extname = 'vector';        -- 0.8.2

-- V1.2 the halfvec column and its HNSW index actually exist
select a.attname, format_type(a.atttypid, a.atttypmod)
from pg_attribute a where a.attrelid = 'public.forge_generations'::regclass
  and a.attname = 'embedding';                                        -- halfvec(2048)
select indexdef from pg_indexes
where tablename = 'forge_generations' and indexname like '%embedding%';

-- V1.3 the index is USED, not just present — the whole point of halfvec
set local hnsw.ef_search = 40;
explain (analyze, buffers)
select id from public.forge_generations
order by embedding <=> (select embedding from forge_generations limit 1) limit 5;
-- must show "Index Scan using forge_generations_embedding_idx", never "Seq Scan"

-- V1.4 RLS denies what it should
set role authenticated;
insert into public.forge_generations (kind, category, word_count, body)
  values ('passage','practice',10,'nope');                            -- must FAIL
reset role;
```

**Exit:** V1.1–V1.4 pass. `npx supabase db lint` clean. `get_advisors` reports
no new `rls_disabled` or `security_definer_view` findings.

---

## Phase 2 — Secure provider and model router

**Goal:** a shared Deno module that picks a model, fails over, and never leaks
a key. No HTTP surface yet — this phase is testable in isolation.

### Steps

1. `supabase/functions/_shared/` (underscore-prefixed → not deployable as a
   function, importable by all of them):
   - `providers.ts` — the four-provider table from
     [ARCHITECTURE.md §5.1](./ARCHITECTURE.md#51-provider-table-server-only),
     keys from `Deno.env.get('FORGE_*')`. A provider with no key is absent from
     every ladder.
   - `lanes.ts` — the seven lanes and their ladders, verbatim from §5.2. All
     39 model ids were confirmed live; re-run the reconciliation in Phase 9
     before shipping.
   - `runner.ts` — port `src/lib/ai-runner.js`. Keep the staggered hedge, the
     per-attempt `AbortController`, abort-all-on-winner, the
     `bad-request → auth → rate-limit → bad-response → timeout → network`
     error priority, and the "an abort after settling is not a failure" rule.
   - `breaker.ts` — read/write `forge_model_health`. Open set cached 5 s in
     module scope; the isolate is reused across requests, so this survives.
   - `budget.ts` — `forge_budget` counters. OpenRouter `day_limit = 50`.
2. Port `ai-runner.js` **as a port, not a rewrite.** Its comments record real
   incidents (the `temperature: 1.1` 400, the StrictMode double-mount, the
   hedge-cancelled-is-not-a-failure rule). Carry them across.
3. Secrets: `supabase secrets set --env-file supabase/.env.forge`, with that
   file gitignored.

### CPU budget note

The runner is I/O-bound and costs almost no CPU. The two CPU costs to watch are
SSE line-splitting and `JSON.parse` per frame. Split on `\n` with `indexOf`
rather than a regex, and skip `JSON.parse` entirely for frames that do not
start with `data: {`.

### Verification

```bash
deno test supabase/functions/_shared/          # unit: planner, breaker, budget

# V2.1 ladder ids all resolve upstream (this is the check that caught 8 dead
# ids in the current config.js)
deno run -A supabase/functions/_shared/scripts/reconcile.ts
# exits non-zero if any configured id is absent from a live /v1/models

# V2.2 no key can reach a client bundle
npm run build && ! grep -rEq "sk-or-v1-|nvapi-|kira_|sk-[A-Za-z0-9]{32}" dist/
```

**Exit:** unit tests green; `reconcile.ts` exits 0; a fake provider forced to
fail three times is absent from the next plan.

---

## Phase 3 — Streaming generation API

**Goal:** `forge-chat` deployed, streaming SSE, surviving a 60 s answer without
being cut.

### Steps

1. `supabase/functions/forge-chat/index.ts`:
   ```ts
   Deno.serve(async (req) => {
     const user = await verifyJwt(req)                  // local, via SUPABASE_JWKS
     const { readable, writable } = new TransformStream()
     EdgeRuntime.waitUntil(runLane(req, user, writable))  // ← mandatory
     return new Response(readable, {
       headers: {
         'Content-Type': 'text/event-stream',
         'Cache-Control': 'no-cache',
         'Connection': 'keep-alive',
       },
     })
   })
   ```
2. `_shared/sse.ts` — the Forge event grammar from
   [ARCHITECTURE.md §3.3](./ARCHITECTURE.md#33-wire-protocol): `meta`,
   `thinking`, `token`, `tool`, `done`, `error`. No `model`, no `provider`, no
   upstream id.
3. `_shared/identity.ts` — the clamp's layers 1 and 2. Layer 2 runs on
   `delta + carry` only, never the accumulated answer, and skips its regex
   entirely while inside a fenced code block. Layer 3 is free: the grammar has
   no field to leak through.
4. 10 s `: keepalive` comment frames, so an intermediary does not close a
   connection that is streaming `reasoning_content` and no `content` yet.
5. Client disconnect → `req.signal` → abort every in-flight provider attempt.
   On a 50/day allowance an abandoned tab must not keep spending.
6. `src/lib/forge/client.ts` — `fetch` + `body.getReader()` over the Forge
   grammar, exposing exactly the `onToken` / `onThinking` / `signal` surface
   `useStreamingChat.js` already consumes. **Not** `functions.invoke()`.
7. `supabase/config.toml`: `[functions.forge-chat] verify_jwt = true`.

### Verification

```bash
# V3.1 real SSE, incremental, not buffered
curl -N -X POST "$FN/forge-chat" \
  -H "apikey: $SB_PUBLISHABLE" -H "Authorization: Bearer $USER_JWT" \
  -H "Content-Type: application/json" \
  -d '{"lane":"instant","messages":[{"role":"user","content":"count to 30"}]}'
# frames must arrive progressively, not in one burst at the end

# V3.2 a long answer is not cut — the EarlyDrop regression test
#      ask for ~50 s of output, assert an `event: done` frame arrives
deno test supabase/functions/tests/stream_longevity_test.ts

# V3.3 no identity leak, and no vendor field on the wire
deno test supabase/functions/tests/identity_test.ts   # 10 probes + split-frame case
curl -N ... | grep -Ei "nemotron|deepseek|openrouter|nvidia|hcnsec|\"model\"" && exit 1
```

**Exit:** V3.1–V3.3 pass. Function logs show no `EarlyDrop`, `CPUTime` or
`WallClockTime` shutdown reasons across a 50-request soak.

---

## Phase 4 — Agent / orchestrator

**Goal:** the bounded pipeline from
[ARCHITECTURE.md §3.1](./ARCHITECTURE.md#31-the-agent-loop) — gate, key, race,
tools, stream, learn — with tool calls capped.

### Steps

1. `_shared/orchestrator.ts`, implementing the six stages. Bounded by design:
   a fixed pipeline with one optional tool excursion, capped at **2 rounds**.
   Unbounded loops are what make latency unpredictable, and the 2 s CPU ceiling
   makes that fatal rather than merely annoying.
2. **The race** (§3.2): dispatch lookup and generation in the same tick; abort
   the generation only if the lookup wins inside 120 ms. Skip speculation when
   the facet bucket is known dense (per-bucket counts cached in module scope).
3. `_shared/tools.ts` — the six plugin definitions as JSON Schema. Every
   executor validates its own arguments before running, so a model cannot make
   `stats_lens` read another user's rows: the executor only ever reads the
   caller's aggregates.
4. Retrieved library rows enter as delimited reference content, never as
   instructions (PRD S-5).

### Verification

```bash
# V4.1 tool rounds are actually capped
deno test supabase/functions/tests/orchestrator_test.ts
# a mock model that emits tool_calls forever must be forced to answer at round 2

# V4.2 the race aborts the loser
#      seeded cache hit → assert zero provider requests reach the mock upstream

# V4.3 injection containment
#      library row containing "ignore previous instructions" must not change behaviour
```

**Exit:** V4.1–V4.3 pass. p95 CPU time per request, read from function logs,
is under 1 200 ms — a 40 % margin on the 2 s ceiling.

---

## Phase 5 — Paragraph and code generation

**Goal:** `forge-generate` replaces the direct provider calls behind
`generatePassage()` and `generateSnippet()`, with the offline fallbacks intact.

### Steps

1. `supabase/functions/forge-generate/index.ts` — same streaming skeleton as
   `forge-chat`, but lane-selected by `kind`: `instant` for passage / drill /
   quote, `code` for snippet.
2. Move the prompt templates out of `src/lib/ai.js` into
   `_shared/prompts/`. Carry the hard-won details: no markdown, no line breaks,
   spaces never tabs, lines under 72 chars, the variation seed, and the
   `temperature: 1` clamp that HCNSec enforces with a 400.
3. `_shared/contracts.ts` — the quality gate (PRD R-12). Same shape validation
   `ai.js` applies today: parseable JSON, length in range, no markdown in a
   passage, no tabs in a snippet. A failure still streams to the requester and
   is **not** written to the library.
4. Client: `ai.js` keeps its public API (`generatePassage`, `generateSnippet`,
   `analyseCode`, `coachInsight`) and its `CACHE` / `inflight` maps — including
   the "a failed join must not poison the joiner" behaviour. Only the transport
   underneath changes.
5. `battle/passage.js` keeps host-generates-once, but the host now writes to the
   library and the other seven players read it back.

### Verification

```bash
npm test                                   # existing suite, must stay green
deno test supabase/functions/tests/contracts_test.ts

# V5.1 every mode × difficulty produces contract-valid output
deno run -A supabase/functions/tests/matrix.ts   # 6 modes × 4 difficulties
# V5.2 every language produces a snippet that Prism can tokenise
deno run -A supabase/functions/tests/snippets.ts # 11 languages
# V5.3 with all four keys unset, /practice and /code still render bundled content
```

**Exit:** V5.1–V5.3 pass, `npm test` green, and a keyless deploy still serves a
working app.

---

## Phase 6 — Save, reuse, search

**Goal:** the library fills itself and starts answering.

### Steps

1. **Write-back, out of band.** On a validated generation the request enqueues
   `{generation_id}` to the `forge_embed_queue` pgmq queue and returns. It does
   not embed inline — that is a network call plus a 2048-float parse inside a
   2 s CPU budget.
2. `supabase/functions/forge-embed-drain/index.ts` — reads a batch of up to 32
   messages, calls `nvidia/nemotron-3-embed-1b` with `input_type: "passage"`,
   writes `embedding`, archives the messages.
3. `pg_cron` every 30 s → `pg_net` POST to `forge-embed-drain`. This is
   Supabase's documented pgmq + pg_net + pg_cron + Edge Function pattern.

   **Built with two corrections to this step** (`0013_forge_embed_cron.sql`):

   - *Not* the secret key on `apikey`. pg_net persists request headers in
     `net.http_request_queue`, so the header is written to a table; the
     service_role key there would be a full-DB credential sitting in storage.
     The job sends `forge_cron_secret` instead — minted with
     `gen_random_bytes` inside Postgres, held in Vault, scoped to this one
     endpoint, and rotatable without touching anything else.
   - *Not* an unconditional POST. `forge_drain_tick()` checks queue depth
     first — a local count costing microseconds against a billed invocation.
     Measured over the first 6 ticks: 6 runs, **1** HTTP call, the one where
     work existed. Unconditional firing would have cost ~86k invocations a
     month to mostly find an empty queue.
4. **Read path**, wired into the orchestrator's race:
   - exact `content_hash` — sub-10 ms, one unique-index probe;
   - `forge_match()` with `input_type: "query"`, facets, and
     `p_exclude_user` for novelty;
   - thresholds: **0.55 serve · 0.20 anchor** — not the 0.86/0.78 planned
     here. Measured on real rows, relevant matches scored 0.193–0.385 and
     irrelevant ones topped out at 0.239, so the two ranges overlap and no
     single cutoff separates them. Serve is set above everything observed so
     it never fires wrongly; anchoring is where retrieval actually earns its
     keep. Reproduce with `npm run forge:calibrate`.
5. Cache replay: chunk the stored body into ~200-char `token` frames paced
   ~8 ms apart, so hit and miss share one client rendering path.
6. Record `forge_generation_serves` on every serve; feed `completion_count` /
   `abandon_count` from the typing engine's existing end-of-session signal.

### Verification

```sql
-- V6.1 the queue actually drains
select count(*) from pgmq.q_forge_embed_queue;                 -- trends to 0
select count(*) from forge_generations where embedding is null; -- trends to 0
```

```bash
# V6.2 exact hit: same request twice → second makes zero provider calls
# V6.3 semantic hit: reworded request → ai_usage.cache = 'semantic'
# V6.4 novelty: same user, same facets, twice → two different bodies
deno test supabase/functions/tests/library_test.ts
```

**Exit:** V6.1–V6.4 pass. After a 200-request seed, hit rate on the passage
lane is measurable and non-zero.

---

## Phase 7 — FAP chatbot integration

> **Correction found by driving the app, not by tests.**
>
> Moving the provider key server-side made an auth session mandatory where
> none had been. The old transport called the provider straight from the
> browser, so a first-time visitor got an answer without an account; every
> Forge call now needs a JWT. Nothing minted one, so the first browser run
> showed *"Forge needs you signed in"* with Send disabled and the coach card
> reading OFFLINE — every AI surface dead for signed-out visitors, which is
> most people on a first visit.
>
> The build was clean, 517 tests passed and the bundle audit passed through
> all of it. No server-side check could have caught this: each endpoint was
> verified with a hand-minted token, which is precisely the thing the app was
> failing to obtain.
>
> Fixed in `src/lib/forge/client.js` by minting a guest on demand —
> `signInAnonymously`, the same mechanism Battlefield, Shadow Battle and
> onboarding already use. Concurrent callers share one in-flight sign-in;
> without that the home page's two simultaneous calls mint two `auth.users`
> rows and the second orphans the first one's history. Covered by
> `src/lib/forge/client.test.js` (5 tests, race case verified against a
> deliberately broken guard).


**Goal:** the Forge AI coach surface — depth control, model picker, plugins —
on the existing chat UI, with the identity clamp holding.

The mascot work already in the tree (`ForgeAvatar.jsx`, `public/forge-ai.gif`,
`chatSession.js`, `coachPrompts.js`) is the visual half of this and is
uncommitted. Commit it before starting, so this phase's diff is behaviour only.

### Steps

1. `src/lib/forge/catalogue.js` — the Forge-named picker. **No vendor string
   appears in this file.** Lane ids are the only link to server config:
   ```
   ⚡ Fast      Forge Instant · Forge Feather
   ⚖ Everyday  Forge Balanced
   🧠 Thinking Forge Reason · Forge Deep
   ⌨ Code      Forge Code
   📜 Long      Forge Ledger
   ```
2. Depth control `Quick · Balanced · Deep` in the composer → lane +
   `reasoning_effort` where the model supports it (verified on `inkling`,
   `glm-5.2`, `nemotron-3-super`, `nemotron-3-ultra`, `openrouter/free`).
3. `Deep` renders `reasoning_content` through the existing `AgentTrace`
   component — it already exists in `AIChat.jsx` and already handles a live
   thinking tail.
4. Plugin toggles (Drill Forge, Snippet Forge, Passage Forge, Stats Lens, Code
   Lens, Library), persisted per thread, surfaced in the trace when they fire.
5. `chat_messages` sync keeps working; `chatStore.js` and `chatSession.js` are
   untouched. The floating panel and `/chat` stay one conversation.
6. **Do not touch `useStreamingChat.js`.** The rAF coalescing, partial/settled
   split, memoised bubbles and scroll anchor all work against the Forge stream
   unchanged. If this phase needs to edit that file, the client adapter in
   Phase 3 got its interface wrong.

### Verification

```bash
# V7.1 no vendor name anywhere in the client
grep -rEi "nemotron|deepseek|glm-|kimi|gemma|minimax|qwen|laguna|inkling|\
openrouter|nvidia|hcnsec|kira|moonshot|poolside|cohere" src/ && exit 1

# V7.2 identity probes, through the real UI path
deno test supabase/functions/tests/identity_test.ts   # 10 probes, all lanes

# V7.3 a cache hit does not flash an empty AgentTrace
# V7.4 plugins fire and appear in the trace
npm test
```

**Exit:** V7.1–V7.4 pass. A manual pass over `/chat`, the floating panel,
`/code` sidebar and the `/home` + `/dashboard` coach shows no regression.

---

## Phase 8 — Errors, fallback, rate limits, caching

**Goal:** nothing user-visible breaks when a provider, the database, or the
budget does.

### Steps

1. **Error mapping.** Forge `error` frames reuse the existing
   `AI_REASON_COPY` keys exactly (`rate-limit`, `auth`, `network`, `timeout`,
   `no-key`, `bad-response`, `bad-request`), so client error handling needs no
   change.
2. **Fallback ladder**, each rung already implemented in `ai.js`:
   library hit → generation → another provider → `localAnalysis` /
   `localCoach` / `localQuestions` → bundled `content.js` and `snippets/`.
3. **Rate limiting** (`_shared/ratelimit.ts`): 20 req/min and 200/day per user,
   60/min per IP; anonymous users half. Counters in `forge_request_log`,
   read through one indexed count.
4. **Budget guard**: OpenRouter drops out of every ladder at 90 % of its
   50/day allowance unless it is the last provider standing.
5. **Circuit breaker** wired live: 3 consecutive failures → 60 s open, doubling
   to a 15 min ceiling; `auth` opens for 15 min immediately; `bad-request`
   never opens, because it is our bug and opening the model would hide it.
6. **Caching**, four layers: L0 in-flight dedupe and L1 session memo stay in
   `ai.js` unchanged; L2 hot-bucket map in Edge Function module scope (the
   isolate is reused, so this survives between requests); L3 is the library.
7. **Shutdown telemetry.** Log `reason`, `cpu_time_used`, `memory_used` and
   `execution_id` from every `ShutdownEvent`. Alert on any `CPUTime` or
   `EarlyDrop` — both mean a user's answer was cut.

### Verification

```bash
# V8.1 kill each provider in turn (bad key) → app still answers
# V8.2 kill all four → bundled content renders, no error dialog
# V8.3 exceed the per-user limit → 429 with a `rate-limit` frame, not a crash
# V8.4 breaker opens after 3 forced failures and closes after backoff
# V8.5 budget guard drops OpenRouter at 45/50
deno test supabase/functions/tests/resilience_test.ts

# V8.6 database unavailable → generation still streams (cache is not a dependency)
```

**Exit:** V8.1–V8.6 pass. Zero `CPUTime` shutdown events in a 500-request soak.

---

## Phase 9 — Testing and performance

**Goal:** the PRD's numbers, measured rather than asserted.

### Steps

1. **Load test** — 200 concurrent streams, mixed lanes, 10 min. Record
   time-to-first-token, CPU per request, shutdown reasons.
2. **Latency budgets** from [ARCHITECTURE.md §9](./ARCHITECTURE.md#9-performance-plan),
   re-measured through Edge Functions rather than Vercel — ap-south-1 to
   NVIDIA/OpenRouter is a different network path than the one that measured
   580 ms. **Expect this number to move.** If TTFT lands above 900 ms, the
   lever is lane ladder order, not architecture.
3. **HNSW tuning**: sweep `ef_search` 20/40/80 against a seeded 10 k-row
   library; pick the lowest value holding recall ≥ 0.95.
4. **Index sizing check** at 100 k rows: ~410 MB of vectors plus ~600 MB of
   HNSW graph. Confirm it fits the instance's shared buffers, or schedule the
   pruning rule (`quality_score < 0.25 and serve_count = 0`, older than 90
   days).
5. **Nightly reconciliation** — `pg_cron` runs `reconcile.ts` against all four
   `/v1/models` endpoints. Any configured id that has vanished is skipped,
   logged, and surfaced in the admin panel. Six HCNSec ids died in roughly
   three weeks; this is not a hypothetical.
6. **Admin**: `AiUsageTab` gains lane, cache outcome and failover depth; a new
   library tab over `forge_generations`.
7. **Drop the client insert policy on `ai_usage`** — the last one-way step, and
   only once the server is provably the only writer.

### Verification

```sql
-- V9.1 hit rate by facet
select kind, cache, count(*) from ai_usage
where created_at > now() - interval '7 days' group by 1,2;

-- V9.2 failover depth: how often does attempt 0 win?
select attempt_index, count(*) from ai_usage where ok group by 1 order by 1;

-- V9.3 nothing is sequentially scanning the library
explain (analyze) select * from forge_match(...);   -- Index Scan, always
```

```bash
# V9.4 the reconciliation catches a dead id
# V9.5 p50 TTFT <= 900 ms, p95 CPU <= 1200 ms, over the load test
```

**Exit:** every PRD §12 acceptance criterion passes.

---

## Sequencing

```
B-1, B-2, B-3  ──▶ 1 ──▶ 2 ──▶ 3 ──▶ 4 ──┬──▶ 5 ──▶ 6 ──▶ 7 ──▶ 9
                                          └──▶ 8 ──────────────┘
```

Phases 1–4 are strictly serial. Phase 8 can run beside 5–7 once the
orchestrator exists. Phase 9 needs everything.

**Phase 0 from the PRD — correcting the eight dead model ids in
`src/lib/config.js` — is independent of all of this and should ship first.**
It is a live bug: six of eight HCNSec models and two of four OpenRouter models
in the committed config no longer exist upstream.

---

## Rollback

Every phase is reversible except the last step of Phase 9.

| Phase | Reverse by |
|---|---|
| 1 | Migration is additive. `drop table forge_*` and the `ai_usage` columns. |
| 2–4 | `supabase functions delete forge-chat`; the client falls back to `ai.js`'s existing path. |
| 5 | Flag `FORGE_GENERATE=off` → client calls the old path. |
| 6 | Flag `FORGE_LIBRARY=off` → skip reads and writes; generation is unaffected. |
| 7 | Per-feature flags on picker, depth, plugins. |
| 8 | Guards are additive; disabling them restores Phase 4 behaviour. |
| 9 | **Dropping the `ai_usage` client insert policy is one-way.** Do it last, and only after V9 passes. |

At every point the worst case is the app behaving as it does today with no keys
configured: bundled content, local fallbacks, no errors.

---

## Security carry-forward

Unchanged from the PRD, plus two items specific to this host:

- **Rotate every credential pasted into the planning thread**: the four
  provider keys, the Supabase secret key, and the **direct connection string —
  which contains the database password in plaintext**. None of them are written
  into this repository, and none should be.
- **`sb_secret_...` never reaches the browser.** It belongs in Edge Function
  secrets only. The client gets `sb_publishable_...`, on the `apikey` header.
