# Forge AI — Required Resources

**Status:** checklist · nothing provisioned
**Version:** 1.0 (2026-08-28)
**Companion:** [IMPLEMENTATION_PLAN.md](./IMPLEMENTATION_PLAN.md) · [PRD.md](./PRD.md) · [ARCHITECTURE.md](./ARCHITECTURE.md)

---

## 1. Supabase project

| Field | Value |
|---|---|
| Project name | TypeForge |
| Project ref | `kavfjyvsvgvcjiuwwfbw` |
| Region | `ap-south-1` (Mumbai) |
| Project URL | `https://kavfjyvsvgvcjiuwwfbw.supabase.co` |
| Functions base | `https://kavfjyvsvgvcjiuwwfbw.supabase.co/functions/v1/` |
| Postgres | **17.6** (verified) |
| pgvector | **0.8.2 available, not yet installed** (verified) |

**Region note.** ap-south-1 to NVIDIA NIM, OpenRouter and HCNSec is a different
network path from the one that measured 580 ms during research. Re-measure in
Phase 9 before treating the 900 ms TTFT target as met.

### 1.1 Verified state, 2026-08-28

| Check | Result |
|---|---|
| Applied migrations | `0001`–`0009` |
| `0010_shadow_battle.sql` | **Not applied** — 0 `shadow_*` tables |
| Public tables | 16 + `_schema_migrations` |
| `public.is_admin()` | Present |
| `battle_*` functions | 17 |
| Edge Functions deployed | **0** |
| `auth.users` | **0 rows** |

### 1.2 Platform features used

| Feature | Used for | Status |
|---|---|---|
| Auth (anonymous) | Guest quota, `signInAnonymously()` | Claimed configured — **unverified**, 0 users |
| Auth (Google OAuth) | Sign-in | Claimed configured — **unverified**, 0 users |
| Postgres + RLS | Everything | Live |
| Edge Functions | The whole server tier | To provision |
| Database Webhooks | Not used | — |
| Realtime | Battlefield / Shadow only, unchanged | Live |
| Storage | Not used by Forge AI | — |

> **Verify auth before Phase 2.** With `auth.users` empty there is no identity
> row proving either provider is wired. Sign in once with Google, call
> `signInAnonymously()` once, then confirm `select count(*) from auth.users`
> is 2 and `auth.identities` shows both providers.

---

## 2. Postgres extensions

| Extension | Version | Installed | Needed for |
|---|---|:--:|---|
| `vector` | 0.8.2 | **No** | `halfvec(2048)`, HNSW, `hnsw.iterative_scan` |
| `pgmq` | 1.5.1 | **No** | `forge_embed_queue` — out-of-band embedding |
| `pg_cron` | 1.6.4 | **No** | Drain the queue; nightly model reconciliation |
| `pg_net` | 0.20.4 | **No** | Cron → Edge Function HTTP call |
| `pgcrypto` | 1.3 | Yes | `gen_random_uuid()`, hashing |
| `uuid-ossp` | 1.1 | Yes | Existing |
| `pg_stat_statements` | 1.11 | Yes | Phase 9 query profiling |
| `index_advisor` | 0.2.0 | No | Optional, Phase 9 |
| `hypopg` | 1.4.1 | No | Optional, Phase 9 index sizing |

`vector` must land at **≥ 0.8.0**. Below that, drop the `hnsw.iterative_scan`
settings from `forge_match()`; below 0.7.0, `halfvec` does not exist at all and
the design does not work.

---

## 3. Edge Functions

All under `supabase/functions/`. Underscore-prefixed directories are shared
modules, not deployable functions.

| Function | Method | JWT | Streams | Purpose |
|---|---|:--:|:--:|---|
| `forge-chat` | POST | ✅ | SSE | Conversational turn — chat page, floating panel, code sidebar, coach |
| `forge-generate` | POST | ✅ | SSE | Passage · snippet · drill · quote |
| `forge-embed` | POST | secret | — | Single embedding, server-internal |
| `forge-embed-drain` | POST | secret | — | pgmq batch drain, called by `pg_cron` |
| `forge-moderate` | POST | ✅ | — | `guard` lane over user-supplied text |
| `forge-models` | GET | ✅ | — | The Forge-named picker catalogue. **Returns no vendor ids.** |
| `forge-reconcile` | POST | secret | — | Nightly `/v1/models` check across all four providers |

### 3.1 Shared modules (`supabase/functions/_shared/`)

| Module | Responsibility |
|---|---|
| `providers.ts` | Four-provider table; keys from env; a keyless provider is absent |
| `lanes.ts` | Seven lanes, ladders, timeouts, token budgets |
| `runner.ts` | Hedged failover + SSE parse — ported from `src/lib/ai-runner.js` |
| `breaker.ts` | Circuit breaker over `forge_model_health` |
| `budget.ts` | Daily counters over `forge_budget` |
| `orchestrator.ts` | Gate → key → race → tools → stream → learn |
| `library.ts` | Exact + semantic lookup, enqueue write-back |
| `embeddings.ts` | `nemotron-3-embed-1b`, 2048-d, `input_type` query/passage |
| `identity.ts` | Identity clamp layers 1 and 2 |
| `contracts.ts` | Quality gate — JSON shape validation |
| `ratelimit.ts` | Per-user and per-IP token buckets |
| `auth.ts` | Local JWT verify against `SUPABASE_JWKS` |
| `sse.ts` | Forge event grammar encode/decode |
| `prompts/` | Prompt templates moved out of `src/lib/ai.js` |

### 3.2 Runtime limits (verified, Supabase docs)

| Limit | Value |
|---|---|
| Memory | 256 MB |
| Wall clock | 150 s free · **400 s paid** |
| **CPU time** | **2 s per request** (excludes async I/O) |
| Request idle timeout | 150 s → 504 |
| Function size | 20 MB after bundling |

**The 2 s CPU ceiling is the binding constraint**, not wall clock. Waiting on a
provider is free; per-frame regex, `JSON.parse` and hashing are not.

### 3.3 Two mandatory patterns

**Keep the isolate alive for the whole stream.** An isolate is retired
(`EarlyDrop`) once the response has returned *and* every `waitUntil` promise has
resolved — which cuts a forwarded stream mid-answer.

```ts
const { readable, writable } = new TransformStream()
EdgeRuntime.waitUntil(pump(upstream.body, writable))   // mandatory
return new Response(readable, { headers: { 'Content-Type': 'text/event-stream' } })
```

`waitUntil` prevents early retirement; it does **not** extend the wall clock.

**The client cannot use `functions.invoke()`.** It parses the whole response
before returning. Streaming requires raw `fetch` + `response.body.getReader()`.

### 3.4 `supabase/config.toml`

```toml
[functions.forge-chat]
verify_jwt = true
[functions.forge-generate]
verify_jwt = true
[functions.forge-embed-drain]
verify_jwt = false     # called by pg_cron with the secret key on `apikey`
[functions.forge-reconcile]
verify_jwt = false
```

---

## 4. Database objects

### 4.1 New tables

| Table | Purpose | RLS |
|---|---|---|
| `forge_generations` | The shared library | `select` where `published and not flagged`; writes service-role only |
| `forge_generation_serves` | Per-user serve ledger → novelty | Own rows |
| `forge_model_health` | Circuit-breaker state | Deny-all; `is_admin()` read |
| `forge_budget` | Per-provider daily counters | Deny-all; `is_admin()` read |
| `forge_request_log` | Rate-limit counters | Deny-all |

### 4.2 Altered tables

| Table | Columns added |
|---|---|
| `ai_usage` | `lane`, `cache`, `request_id`, `attempt_index`, `generation_id` |
| `ai_usage` | **Policy dropped:** `"insert own"` — Phase 9, one-way |

### 4.3 Indexes

| Index | On | Type | Serves |
|---|---|---|---|
| `forge_generations_hash_idx` | `content_hash` | unique btree | Exact hit, sub-10 ms |
| `forge_generations_facet_idx` | `(kind, difficulty, language, level)` partial | btree | Facet prefilter |
| `forge_generations_request_idx` | `(request_hash, created_at desc)` | btree | Bucket density |
| `forge_generations_embedding_idx` | `embedding halfvec_cosine_ops` | **HNSW** `m=16, ef_construction=64` | Semantic hit |
| `forge_serves_user_idx` | `(user_id, served_at desc)` | btree | Novelty exclusion |
| `ai_usage_request_idx` | `request_id` | btree | Tracing one request across attempts |

**Why `halfvec` and not `vector`:** `nemotron-3-embed-1b` emits 2048 dimensions
and rejects any other value. pgvector indexes `vector` to 2 000 dimensions and
`halfvec` to 4 000. A `vector(2048)` column cannot carry an ANN index at all.

### 4.4 Functions

| Function | Kind | Purpose |
|---|---|---|
| `forge_match(...)` | `security definer` | Facet-prefiltered ANN with novelty exclusion |
| `forge_record_serve(...)` | `security definer` | Insert serve row, bump `serve_count` |
| `forge_breaker_record(...)` | `security definer` | Upsert `forge_model_health` |
| `forge_budget_charge(...)` | `security definer` | Increment and read back a daily counter |
| `public.is_admin()` | existing | Admin gate, unchanged |

### 4.5 Queue and schedules

| Object | Kind | Cadence | Status |
|---|---|---|---|
| `forge_embed_queue` | pgmq queue | — | live |
| `forge-embed-drain` | pg_cron → `forge_drain_tick()` → pg_net | every 30 s | **live** (jobid 1) |
| `forge_nightly_reconcile` | pg_cron → pg_net → `forge-reconcile` | daily 03:00 UTC | Phase 9 |
| `forge_prune_library` | pg_cron | weekly — `quality_score < 0.25 and serve_count = 0`, older than 90 days | Phase 9 |

The drain job calls `public.forge_drain_tick()` rather than posting directly.
That function returns early when the queue is empty, so a tick on an idle
system costs one local `count(*)` instead of a billed Edge Function
invocation — measured at 1 HTTP call per 6 ticks on an idle project.

### 4.6 Vault secrets

Read by `forge_drain_tick()`; both are project-local, so a branch or preview
project points at itself by setting its own two rows. This is why
`0013_forge_embed_cron.sql` hardcodes neither and is safe to commit.

| Vault name | Purpose |
|---|---|
| `forge_functions_url` | Base Edge Function URL for this project |
| `forge_cron_secret` | 32-byte secret for the cron → drain call. **Not** the service_role key: pg_net stores request headers in `net.http_request_queue`, so whatever is sent lands in a table. Scoped to that one endpoint and independently rotatable. |

---

## 5. Environment variables and secrets

### 5.1 Edge Function secrets — set these

```bash
supabase secrets set --env-file supabase/.env.forge   # gitignore this file
```

| Name | Value | Notes |
|---|---|---|
| `FORGE_HCNSEC_KEY` | HCNSec key | **Rotate** — leaked via chat |
| `FORGE_NVIDIA_KEY` | `nvapi-…` | **Rotate** |
| `FORGE_OPENROUTER_KEY` | `sk-or-v1-…` | **Rotate** |
| `FORGE_KIRA_KEY` | KiraAI key | **Currently invalid (401)** — provider stays off until replaced |
| `FORGE_SITE_URL` | `https://<deployed origin>` | OpenRouter `HTTP-Referer` attribution |
| `FORGE_ROUTER` / `FORGE_LIBRARY` / `FORGE_SEMANTIC` / `FORGE_GENERATE` | `on` \| `off` | Rollback flags |

The `FORGE_` prefix keeps these clear of Supabase's own reserved names.

### 5.2 Injected automatically — do not set

| Name | Use in Forge AI |
|---|---|
| `SUPABASE_URL` | API gateway |
| `SUPABASE_DB_URL` | Direct Postgres connection |
| `SUPABASE_JWKS` | **Local JWT verification** — no network round trip in the gate |
| `SUPABASE_PUBLISHABLE_KEYS` | JSON dict of publishable keys |
| `SUPABASE_SECRET_KEYS` | JSON dict of secret keys — bypasses RLS, never to a browser |
| `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` | Legacy equivalents |
| `SB_REGION`, `SB_EXECUTION_ID` | Telemetry |

### 5.3 Client `.env.local` — after the migration

```ini
VITE_SUPABASE_URL=https://kavfjyvsvgvcjiuwwfbw.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_…
VITE_SITE_URL=http://localhost:5173
# VITE_AI_ENABLED=false   # build with every AI feature off
```

**Delete `VITE_HCNSEC_KEY` and `VITE_OPENROUTER_KEY`** from `.env.example`,
`.env.local`, and every host dashboard. They are the reason this project exists.

### 5.4 Header discipline

`sb_publishable_…` and `sb_secret_…` are **not JWTs**. Sending one as
`Authorization: Bearer` fails both the platform check and your handler.

```
apikey:        sb_publishable_…      ← the key, always
Authorization: Bearer <user-jwt>     ← the signed-in user, always
```

Both headers are sent together on every client call.

### 5.5 Credentials to rotate

Everything below travelled through a planning conversation and is written
nowhere in this repository:

- All four provider API keys
- Supabase secret key (`sb_secret_…`)
- **The direct connection string — it contains the database password in
  plaintext.** Rotate the password, not just the key.

---

## 6. Packages

### 6.1 Deno (Edge Functions) — all via `npm:` / `jsr:` specifiers

| Package | For |
|---|---|
| `npm:@supabase/supabase-js@2` | Service-role client inside functions |
| `npm:@supabase/server` | `withSupabase({ auth: 'user' \| 'secret' \| 'publishable' \| 'none' })` — declares the auth mode and hands back a pre-scoped client |
| `jsr:@std/encoding` | base64 / hex for hashing |
| `jsr:@std/assert` | `deno test` |

No LLM SDK. Every provider is OpenAI-shaped and reached with plain `fetch` —
which is also what keeps the bundle far under 20 MB and the CPU cost near zero.

### 6.2 Client (`package.json`) — no additions

Forge AI adds **no runtime dependencies**. `@supabase/supabase-js` is already
there; streaming uses the platform `fetch` and `ReadableStream`.

Dev-only, optional:

| Package | For |
|---|---|
| `supabase` (CLI) | `functions deploy`, `secrets set`, `db lint` |

### 6.3 Existing code that moves rather than being rewritten

| From | To |
|---|---|
| `src/lib/ai-runner.js` | `supabase/functions/_shared/runner.ts` |
| `src/lib/config.js` → `PROVIDERS`, `AI_TIMING` | `_shared/providers.ts`, `_shared/lanes.ts` |
| `src/lib/ai.js` → prompt templates | `_shared/prompts/` |
| `src/lib/supabase.js` → `logAiUsage()` | Deleted; the server writes `ai_usage` |

Unchanged: `useStreamingChat.js`, `chatStore.js`, `chatSession.js`,
`coachPrompts.js`, `content.js`, `snippets/`, every typing and battle module.

---

## 7. External APIs

| Provider | Base URL | Auth header | Verified |
|---|---|---|:--:|
| NVIDIA NIM | `https://integrate.api.nvidia.com/v1` | `Authorization: Bearer nvapi-…` | ✅ 83 models · chat 0.58 s |
| HCNSec | `https://api.hcnsec.cn/v1` | `Authorization: Bearer sk-…` | ✅ 18 models · chat 200 |
| OpenRouter | `https://openrouter.ai/api/v1` | `Authorization: Bearer sk-or-v1-…` | ✅ 388 models |
| KiraAI | `https://kiraai.vn/api/v1` | `Authorization: Bearer kira_…` | ⚠ models ✅ · **chat 401** |

### 7.1 Endpoints used

| Endpoint | Providers | For |
|---|---|---|
| `POST /chat/completions` | all four | Every lane; `stream: true` by default |
| `POST /embeddings` | NIM only | `nemotron-3-embed-1b`, 2048-d |
| `GET /models` | all four | Nightly reconciliation |
| `GET /key` | OpenRouter | Budget posture (`is_free_tier`) |

### 7.2 Rate limits and quotas

| Provider | Limit | Source |
|---|---|---|
| **OpenRouter free** | **20 req/min · 50 req/day** | Docs; `GET /v1/key` reports `is_free_tier: true` |
| OpenRouter, ≥10 credits | 20 req/min · 1 000 req/day | Docs |
| NVIDIA NIM | Not published per-key | Treat as unmetered; breaker handles reality |
| HCNSec | Not published | Same |
| KiraAI | Free models flagged `is_free` | Unmeasurable until the key works |

**50 requests/day is the number that shapes the whole design.** It is roughly
one user's single practice session, which is why OpenRouter sits last in every
ladder and why the library is load-bearing rather than an optimisation.

### 7.3 Provider quirks to code around

| Quirk | Provider | Handling |
|---|---|---|
| `temperature > 1` → 400 | HCNSec | `maxTemperature: 1` clamp — already in `config.js` |
| Response `model` is `""` | HCNSec | Log the *requested* id |
| `reasoning_content` on message and delta | NIM, HCNSec | Already parsed by `ai-runner.js` |
| `openrouter/free` reports the model it chose | OpenRouter | Record server-side, strip before the wire |
| `nemotron-3.5-lightning` DEGRADED | NIM + OpenRouter | Excluded from every ladder until a health probe passes |
| `dimensions` must be exactly 2048 | NIM embed | No Matryoshka truncation; forces `halfvec` |
| `/v1/models` needs no auth | KiraAI | A 200 there is **not** evidence of a working key |

### 7.4 Models — 39 ladder entries, all verified live

Grouped by Forge lane. Vendor ids appear here and in server config **only** —
never in the client, the UI, or a response body.

| Lane | Provider ladder |
|---|---|
| `instant` | NIM `nemotron-3-nano-30b-a3b` · HCNSec `glm-4.5-air` · NIM `nemotron-nano-3-30b-a3b` · Kira `kira-mini-1.0` · HCNSec `sensenova-6.8-flash-lite` · OR `liquid/lfm-2.5-2.6b:free` |
| `feather` | NIM `riva-translate-4b-instruct-v2` · HCNSec `sensenova-u1.5-lite` · Kira `hy3` · OR `liquid/lfm-2.5-2.6b:free` |
| `balanced` | NIM `nemotron-3-super-120b-a12b` · HCNSec `step-3.7-flash` · NIM `google/gemma-4-31b-it` · Kira `glm-5.3-flash` · HCNSec `MiniMax-M3` · OR `openrouter/free` |
| `reasoning` | NIM `nemotron-3-nano-omni-30b-a3b-reasoning` · HCNSec `kimi-k3` · NIM `nemotron-3-super-120b-a12b` · HCNSec `DeepSeek-V4-Pro` · OR `z-ai/glm-5.2:free` |
| `deep` | NIM `nemotron-3-ultra-550b-a55b` · NIM `moonshotai/kimi-k3` · OR `thinkingmachines/inkling:free` · OR `nvidia/nemotron-3-ultra-550b-a55b:free` |
| `code` | HCNSec `kat-coder-pro-v2.5` · NIM `poolside/laguna-xs-2.1` · HCNSec `Qwen3.8-27B` · NIM `deepseek-v4-flash-0731` · Kira `deepseek-v4-flash-free` · OR `cohere/north-mini-code:free` |
| `long` | NIM `minimaxai/minimax-m3` · HCNSec `MiniMax-M3` · OR `minimax/minimax-m3:free` · OR `thinkingmachines/inkling-small:free` |
| `guard` | NIM `nemotron-3.5-content-safety` · NIM `meta/llama-guard-4-12b` · OR `nvidia/nemotron-3.5-content-safety:free` |
| `embed` | NIM `nvidia/nemotron-3-embed-1b` (2048-d) |

---

## 8. External services

| Service | Role | Required |
|---|---|:--:|
| Supabase | Database, auth, Edge Functions, queue, cron | ✅ |
| NVIDIA NIM | Lead chat provider + the only embedding provider | ✅ |
| HCNSec | Second chat provider | ✅ |
| OpenRouter | Backstop provider | ✅ |
| KiraAI | Third chat provider | Optional — off until the key works |
| Vercel | Static hosting for the Vite SPA | ✅ (existing) |
| GitHub | Source, CI for the key-leak gate | ✅ (existing) |

**Vercel's role shrinks.** With Edge Functions as the server tier, Vercel hosts
static assets only. The `vercel.json` catch-all rewrite no longer needs the
`/api` exclusion flagged in ARCHITECTURE.md §1.2 — there is no `/api` route.

---

## 9. Pre-flight checklist

**Blockers**

- [ ] **B-1** Apply `0010_shadow_battle.sql`, or renumber Forge AI to `0010`
- [ ] **B-2** Enable RLS on `public._schema_migrations`
- [ ] **B-3** Verify Google and anonymous auth by creating one user of each
- [ ] Rotate all four provider keys, the Supabase secret key, and the database password
- [ ] Obtain a working KiraAI key, or drop the provider from Phase 2

**Provisioning**

- [ ] `create extension vector` — confirm 0.8.2
- [ ] `create extension pgmq`, `pg_cron`, `pg_net`
- [ ] Install the Supabase CLI and `supabase link --project-ref kavfjyvsvgvcjiuwwfbw`
- [ ] `supabase secrets set --env-file supabase/.env.forge`
- [ ] Add `supabase/.env.forge` to `.gitignore`

**Decisions still open**

- [ ] Buy 10 OpenRouter credits? 50/day → 1 000/day changes the router's posture
- [ ] Upgrade to a paid Supabase plan? Wall clock 150 s → 400 s; the `long`
      lane needs 60 s, so free is workable but leaves little headroom
- [ ] Is a generation global on write, or only after N serves?
- [ ] Does the identity clamp apply to admins?

**Ship first, independent of everything above**

- [ ] **PRD Phase 0** — fix the eight dead model ids in `src/lib/config.js`.
      Six of eight HCNSec models and two of four OpenRouter models in the
      committed config no longer exist upstream. This is a live bug.
