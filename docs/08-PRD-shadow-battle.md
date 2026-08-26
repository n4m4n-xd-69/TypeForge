# TypeForge — Shadow Battle

**Product Requirements Document**
**Version:** 1.0
**Date:** 2026-08-24
**Status:** Design complete · not implemented
**Supersedes:** `01-PRD.md` §17 (*Future: 2-player stickman combat*), which reserved this mode as `[FUTURE]` and defined only its architectural preconditions (SC-A1…A5).
**Source of truth for current behaviour:** the codebase at `typeforge` @ `980d633`, read in source for this document.
**Audience:** product design · game design · frontend · backend · multiplayer · QA

---

## Reading conventions

Inherited from `01-PRD.md` so the two documents can be read together.

| Tag | Meaning |
|---|---|
| `[EXISTS]` | Verified present in the code today. A file reference is given. |
| `[REUSE]` | Exists and is consumed unchanged by this mode. |
| `[EXTEND]` | Exists; this mode adds to it without changing current behaviour. |
| `[NEW]` | Does not exist. |
| `[FUTURE]` | Deliberately not built now; architecture must accommodate it. |

Priorities: **P0** (MVP — not shippable without it), **P1** (V1, post-launch), **P2** (roadmap).

Requirement IDs are stable and quotable: `SB-<area>-<n>`.

**Nothing is claimed to exist that was not read in source.** Unverified assumptions are collected in §36, not stated as fact.

---

## 1. Executive summary

Shadow Battle is a two-player, real-time combat mode in which **typing is the only control input**. Two silhouette fighters face each other in an arena; every word a player types resolves into a strike, a guard, a parry or a heal. Nobody presses an arrow key. The fight is won by whoever types better under pressure — and "better" is deliberately not "faster".

It is the second competitive mode in TypeForge, and it is a different product from the first. Battlefield `[EXISTS]` is a race: 2–8 players type one shared passage and the finish order is the result. Shadow Battle is a duel: two players work independent prompt queues, choose between offense and defense on every card, and the result is a combat resolution. Battlefield answers *who is fastest*. Shadow Battle answers *who performs under contest*.

**The single design decision this document turns on:** every card presents **two options — a strike and a guard — and typing the first character commits you to one.** That fork is the whole game. It is why Shadow Battle is not "Battlefield with a health bar", it is what creates read-and-react play between two humans, and it is the reason a slower typist with better judgement can beat a faster one.

**The single technical decision this document turns on:** TypeForge has no game server. It is a static Vite bundle; "the server" is Postgres (`src/lib/battle/api.js:4-12`). Shadow Battle therefore models combat as a **deterministic reducer over an append-only event log**. Clients simulate locally for instant feedback; Postgres replays the identical reducer at settle time and its answer is the result. This is the same stance that makes Battlefield's timing trustworthy — `starts_at` written by Postgres, WPM recomputed server-side (`supabase/migrations/0009_battlefield.sql`) — extended from a race to a fight.

**Scope of the MVP:** play vs. bot, private rooms by code and link, public quick match, a live games browser, best-of-three combat with eight moves, five bot profiles, one fighter with four cosmetic variants, Elo-based Forge Rating, and full integration with existing XP, achievements and profile surfaces.

---

## 2. Product vision

> **Shadow Battle is where typing stops being measured and starts being contested.**

TypeForge's loop is `MEASURE → DIAGNOSE → DRILL → CONTEST → MEASURE` (`01-PRD.md` §1). The **CONTEST** stage currently has exactly one expression, and it is a time trial with other people in the room. A time trial rewards one thing: sustained rate. It has no reads, no bluffs, no moments where the correct play is to type a four-letter word instead of a twelve-letter one.

Shadow Battle exists to make the contest stage *tactical*. It introduces the only thing a typing race structurally cannot have: **a choice that costs you something.** Every card, you decide whether to spend your next 900 milliseconds attacking or defending, against an opponent making the same decision, with incomplete information about what they chose.

This matters commercially as well as aesthetically. A typing race is a thing you win or lose in about ninety seconds and then you are done. A duel with a rating attached is a thing you play eleven times in a row. Shadow Battle is the mode that turns TypeForge from a tool people visit into a product people play.

### The three-sentence pitch

> Two shadow fighters. Your keyboard is the controller. Type the strike to attack, type the guard to survive — and find out which one your opponent picked about two hundred milliseconds too late.

### What it must feel like

- **Immediate.** A character appears the frame you press the key. Nothing — no animation, no network round trip, no opponent — is ever allowed between a keystroke and its glyph.
- **Physical.** A clean word lands with weight. A critical hit is unmistakable. A parry is the best feeling in the product.
- **Legible.** At any instant you can answer "am I winning, and why" without pausing.
- **Fair.** Losses are attributable. You lost because you picked guard when they were healing, or because your chain broke on `necessary`. Never because of the server.

---

## 3. Goals

| # | Goal | Measured by |
|---|---|---|
| G1 | Give TypeForge a competitive mode with tactical depth, not just rate measurement | Lane-choice distribution stays within 60/40 across the population (§31) |
| G2 | Make typing skill legibly *cause* combat outcomes | ≥80% of surveyed players correctly explain why they lost their last round |
| G3 | Convert solo practisers into repeat competitors | ≥35% of players who finish a bot match play a PvP match within 7 days |
| G4 | Raise session depth | Median Shadow Battle session ≥ 3 matches |
| G5 | Extend the platform without destabilising it | Zero regressions in Battlefield; `0009_battlefield.sql` unmodified |
| G6 | Preserve the product's fairness reputation | Server-authoritative result on 100% of PvP matches; no client-submitted HP |
| G7 | Keep improvement the point | Every match reports WPM, accuracy and clean-word rate against the player's own baseline |

### Non-goals

| # | Non-goal | Why |
|---|---|---|
| NG1 | A fighting game with directional inputs, spacing or movement | The keyboard is a text device. Adding positional play means adding controls that are not typing, which breaks the premise. |
| NG2 | Monetisation of any kind | No payment infrastructure exists in this product and none is proposed. All unlocks are earned. |
| NG3 | Real-time frame-accurate netcode (rollback, lockstep prediction) | There is no game server. Event-log determinism gives correct outcomes at a fraction of the cost. |
| NG4 | Replacing or absorbing Battlefield | They answer different questions. Both stay. |
| NG5 | A mobile-first combat experience | See §29. A soft keyboard over a live fight is a worse product than an honest "not here". |
| NG6 | Voice, chat, friends lists, social graph | `01-PRD.md` §2: competition is the social layer. Unchanged. |
| NG7 | Character stat differentiation | §14. Cosmetic-only is a hard structural rule, not a policy. |
| NG8 | Code/symbol combat text in MVP | Par-time balance for symbol-heavy text needs its own pass. V1. |

---

## 4. Target users

Inherits the personas in `01-PRD.md` §4. Three matter here.

### 4.1 The competitive developer *(primary)*
70–110 WPM, plays Battlefield, has a rank in at least one other game. Comes for the rating, stays for the reads. **Needs:** a ladder, honest matchmaking, and losses that are explainable. **Fails if:** the mode is decided by raw WPM, because then the ladder is just a leaderboard he has already seen.

### 4.2 The plateaued improver *(primary)*
45–65 WPM, has practised for weeks, WPM has stopped moving. **Needs:** a reason to keep typing that is not a number that will not move, and pressure that exposes weaknesses drills do not. **Fails if:** matchmaking puts her against 100 WPM players, or if the bot is either trivial or impossible.

### 4.3 The curious visitor *(secondary)*
Arrives from the landing page, has never typed here. **Needs:** to be fighting something within thirty seconds, with no account. **Fails if:** the first screen is a mode taxonomy, or if the first thing asked of them is a sign-up.

> **Design consequence:** the Shadow Battle landing screen's primary action is **Fight a bot**, not **Find opponent**. Bot matches require no account, no network round trip for matchmaking, and no waiting. `signInAnonymously` (`src/lib/supabase.js:99`) already removes the account wall for PvP, so the account is never the barrier — latency and empty queues are.

---

## 5. Game concept

### 5.1 Fiction

Two shadows in a forge. TypeForge's visual language is already heat, metal and quenched steel — `--brand` is forge orange `255 122 47`, `--accent` is `79 195 247`, described in `src/index.css` as "quenched steel". Shadow Battle does not invent a new world; it puts two silhouettes in the one that already exists.

Fighters are **solid single-colour silhouettes** with no facial features, no equipment detail and no rendered interior. Two reasons, and only one of them is aesthetic:

1. A silhouette reads instantly at any size and against any backdrop, which matters when the player's eyes are on a word and the fighter is in peripheral vision.
2. A silhouette is a *path*, not a spritesheet. It animates as vector transforms on a shared skeleton, which is what makes cosmetic-only fighters structurally guaranteed (§14) and what keeps the render cheap enough to never contend with the typing path (§30).

The arena is a single flat plane with a horizon line, a heat gradient at the base, and nothing else. No parallax, no props, no particles that are not combat feedback. Everything that moves in the arena means something.

### 5.2 Originality statement

Every name, mechanic, meter, move, rank tier and visual element in this document is original to TypeForge. Nothing is derived from, references, or reproduces any existing game's characters, artwork, names, mechanics or branding. The visual direction is generated from TypeForge's own existing design tokens; the combat vocabulary (Focus, Chain, Overdrive, the Fork, strike/guard lanes) is defined here; the rank tiers derive from the product's own metallurgical brand language.

### 5.3 The mechanic in one paragraph

You are shown **two cards**: a **strike** on the left, a **guard** on the right. Each is a word. Typing the first character of one commits you to it — the other disappears. Finish the word and the move executes: damage, or defense. Finish it faster than par and it hits harder. Finish it without a single mistake and it hits harder still, and your **Chain** grows. Take too long and the card expires, your Chain breaks, and you stand exposed. Your opponent is doing exactly this, at the same time, from an identical queue. Neither of you can see which card the other committed to until their word is nearly done.

That last clause is the game.

### 5.4 How typing maps to combat — the design rule

The prompt behind this document is explicit that `WPM = damage` is the failure mode. The rule this design follows:

> **Rate determines how often you act. Precision determines how much each action is worth. Judgement determines whether the action was the right one.**

Three independent axes, three different skills:

| Axis | Typing property | Combat consequence | Can it be brute-forced? |
|---|---|---|---|
| **Tempo** | Words completed per minute | Action frequency | Yes — this is raw WPM, and it is deliberately the *weakest* of the three |
| **Precision** | Errors per word, clean-word rate | Damage multiplier, Chain, Focus generation, critical eligibility | No — accuracy under pressure does not respond to mashing |
| **Judgement** | Which lane you commit to, and when | Whether the damage lands, is halved, or is reflected back at you | No — this is read-and-react against another person |

A 95 WPM player with 88% clean-word rate and poor lane discipline loses to a 65 WPM player at 99% who parries. This is verified in §31 as a balance acceptance criterion, not left as an aspiration.

---

## 6. Core gameplay

### 6.1 The loop

The conceptual loop in the brief is 21 steps. It is correct in outline and wrong in two specifics, both of which this design changes:

- **Fighter selection does not sit between mode selection and matchmaking.** It is a cosmetic choice with no gameplay effect (§14), so putting it on the critical path adds a screen between the player and the fight for no decision value. Fighter selection lives in the Shadow Battle landing screen as a persistent preference, and can be changed in the waiting room while you wait — where the time is free.
- **"Word challenge appears → player types → attack executes" is one step, not four**, and treating it as a sequence is what would produce a turn-based game. Both fighters act continuously and asynchronously.

The corrected loop:

```
   ┌─ ENTRY ──────────────────────────────────────────────────────┐
   │  1. Open Shadow Battle          (rail item, ⌘K, or /shadow)  │
   │  2. Choose: Bot · Quick Match · Private · Live Games          │
   └───────────────────────────┬───────────────────────────────────┘
                               ▼
   ┌─ SETUP ──────────────────────────────────────────────────────┐
   │  3. Match acquisition (bot: instant · PvP: queue/room/code)   │
   │  4. Waiting room — opponent presence, fighter swap, ready     │
   │  5. Both ready → COUNTDOWN (3.5s, server-anchored)            │
   └───────────────────────────┬───────────────────────────────────┘
                               ▼
   ┌─ COMBAT — repeats until a fighter is down or the clock ends ─┐
   │                                                               │
   │        ┌──────────────────────────────────────┐               │
   │        │  Two cards presented: strike | guard │               │
   │        └──────────────────┬───────────────────┘               │
   │                           ▼                                   │
   │        ┌──────────────────────────────────────┐               │
   │        │  First keystroke COMMITS to a lane   │  ◀── the game │
   │        └──────────────────┬───────────────────┘               │
   │                           ▼                                   │
   │   ┌───────────────────────┴────────────────────────┐          │
   │   ▼                       ▼                        ▼          │
   │ COMPLETE               EXPIRE                   WHIFF         │
   │ → move resolves        → Stagger                → Focus −3    │
   │ → damage / guard       → Chain reset            → card stays  │
   │ → Focus + Chain        → 700ms exposure                       │
   │   ▼                       ▼                        ▼          │
   │   └───────────────────────┬────────────────────────┘          │
   │                           ▼                                   │
   │              Next card pair from the seeded queue             │
   │              (opponent is doing all of this too)              │
   └───────────────────────────┬───────────────────────────────────┘
                               ▼
   ┌─ RESOLUTION ─────────────────────────────────────────────────┐
   │  6. Round ends: HP ≤ 0, or 90s cap (higher HP% wins)          │
   │  7. Round card: who won, why, your typing vs. your baseline   │
   │  8. Rounds 2, 3 · sudden death if 1-1-1                       │
   │  9. Match result: rating delta, XP, achievements, records     │
   │ 10. Rematch (same opponent, new room) · Next opponent · Exit  │
   └───────────────────────────────────────────────────────────────┘
```

### 6.2 What the player is actually doing, moment to moment

At any instant, a competent player is tracking four things and the design must keep all four in peripheral vision without pulling the eye off the word:

1. **My chain** — am I on a run worth protecting? (protecting it means taking the *safe* card)
2. **Their Focus** — is an Overdrive coming? (if their Focus bar is near full, guard becomes correct even at a damage cost)
3. **The HP gap** — am I racing or surviving?
4. **The card I am on** — how far through, how much time left

§25 specifies the layout that makes this possible.

---

## 7. Game modes

Four modes ship in MVP. All four are entered from one screen (§22).

| Mode | Opponent | Account | Rated | Availability | Priority |
|---|---|---|---|---|---|
| **Trial** | Bot | No | No | Always — works fully offline | P0 |
| **Quick Match** | Random human | Guest OK | Yes | Requires cloud | P0 |
| **Private Duel** | Invited human | Guest OK | No | Requires cloud | P0 |
| **Live Games** | Human, browsed | Guest OK | Yes | Requires cloud | P0 |

Rated/unrated is a deliberate split. **Private duels are unrated** because a friend pair can trade wins to farm rating in ninety seconds; **quick match and live games are rated** because opponent selection is not under the player's control. Bot matches are unrated for the same reason. All four award XP.

### 7.1 Trial — play vs. bot · `[NEW]` · P0

**SB-BOT-1** The player selects one of five bot profiles (§13) and is in combat within 2 seconds of the selection, with no network request on the critical path.
**SB-BOT-2** Trial works with `SUPABASE_ENABLED === false` and with no network at all. The word queue derives from a locally generated seed; the bot runs locally; the result writes to the local store (`src/lib/store.jsx`) exactly as a Practice session does.
**SB-BOT-3** Difficulty is presented by *character*, not by adjective alone — each profile shows its typing signature (approximate WPM band, accuracy, aggression) so the choice is informed.
**SB-BOT-4** The last-used profile is remembered per device.
**SB-BOT-5** Trial results award XP but never Forge Rating, and are labelled `vs. bot` in match history so the record is honest.
**SB-BOT-6** A Trial match can be abandoned at any point with no penalty and no confirmation dialog beyond a single `Esc` → *Leave match?* prompt.

### 7.2 Quick Match — random opponent · `[NEW]` · P0

The matchmaking state machine:

```
IDLE ──find──▶ SEARCHING ──candidate──▶ FOUND ──both accept──▶ CONNECTING
                   │  ▲                    │                        │
             timeout│  └──decline/timeout──┘                  handshake ok
                   ▼                                                ▼
              NO_OPPONENT ◀────── all retries exhausted ──────    READY
                   │                                                │
            (offer Trial)                                    both ready
                                                                    ▼
                                                              COUNTDOWN ──▶ combat
```

| State | Duration | What the player sees | Exit |
|---|---|---|---|
| `SEARCHING` | 0–45s | Elapsed timer, current FR search band widening visibly, *Fight a bot instead* always offered | Cancel at any time |
| `FOUND` | ≤8s | Opponent name, avatar, rank tier, record. **Accept** / **Decline** | Auto-decline at 8s |
| `CONNECTING` | ≤5s | Handshake progress; clock-offset measurement | Failure → back to `SEARCHING`, no penalty |
| `READY` | ≤20s | Both fighters shown, fighter swap allowed, **Ready** | Either player not ready at 20s → cancel, both requeued |
| `COUNTDOWN` | 3.5s | Full-screen 3 · 2 · 1 · FIGHT | None — input is gated (§27) |

**SB-MM-1** Search bands widen on a schedule: ±100 FR for 0–10s, ±200 for 10–25s, ±400 for 25–45s, unbounded after 45s.
**SB-MM-2** At 45s with no opponent, the player is offered — in this order — a bot match at the closest equivalent difficulty, a private room to share, or continued waiting with a visible timer. **Never an empty screen with a spinner.**
**SB-MM-3** Declining an opponent does not return you to the back of the queue.
**SB-MM-4** Three declines in five minutes triggers a 60-second queue cooldown, to stop opponent-shopping.
**SB-MM-5** A player cannot be matched with the same opponent twice within 10 minutes unless the queue has fewer than 4 waiting players.
**SB-MM-6** Matchmaking is FR-banded only. **WPM is never a matchmaking input** — it is a component of skill, not skill, and banding on it would systematically mis-seed accurate slow players.

### 7.3 Private Duel — play with a friend · `[NEW]` · P0

**SB-PVT-1** Host creates a room and receives a **6-character code** minted by the same alphabet Battlefield uses — 30 symbols excluding `0/O`, `1/I/L` and `U` (`0009_battlefield.sql`), because those are the characters people misread aloud.
**SB-PVT-2** The code is displayed at ≥ `text-4xl` (48px) in `font-mono`, letter-spaced, with a one-tap **Copy code** control.
**SB-PVT-3** A one-tap **Copy link** control yields `https://<origin>/shadow/<CODE>`.
**SB-PVT-4** Where `navigator.share` exists, a **Share** control offers the native sheet; where it does not, the control is not rendered (not disabled).
**SB-PVT-5** Both copy controls confirm with the existing toast system (`src/components/ui/Toast.jsx`) and the existing `useCopyToClipboard` hook (`src/lib/useCopyToClipboard.js`) `[REUSE]`.
**SB-PVT-6** The host sees the opponent appear in the room within 1s of them joining, with name, avatar and rank.
**SB-PVT-7** Only the host can start. The **Start** control is disabled with the reason stated (*Waiting for an opponent*) until a second player is present and ready.
**SB-PVT-8** Rooms expire 30 minutes after creation while in lobby, matching Battlefield's reaper.
**SB-PVT-9** A host may hold at most **3** open private rooms, matching Battlefield's `BF010` cap.
**SB-PVT-10** Private duels are **unrated** and this is stated on the create screen, not discovered afterwards.
**SB-PVT-11** Joining by code is reachable from the Shadow Battle landing screen without first creating anything.

### 7.4 Live Games — public game browser · `[NEW]` · P0

A discovery surface for public rooms waiting for a second player.

**Game card contents:**

| Element | Source | Notes |
|---|---|---|
| Host name | `shadow_players.display_name` | Snapshotted at join, as Battlefield does — never a live `profiles` read |
| Host avatar | `shadow_players.avatar` | Same snapshot |
| Rank tier + FR | `shadow_ratings` | Tier name and badge; exact FR shown as a secondary figure |
| Record | `shadow_ratings` | `W–L` and current streak |
| Status | derived | `Open` · `Filling` · `In progress` · `Full` · `Expired` |
| Round | `shadow_rooms.current_round` | Only for `In progress` |
| Age | `created_at` | *2m ago* |
| Action | — | **Join** · or a disabled state with its reason |

**SB-LIVE-1 — The PIN is never in the payload.** `shadow_rooms` is member-scoped by RLS for exactly the reason `battle_rooms` is (`0009_battlefield.sql`: a client able to select by pin could walk the code space and harvest live rooms). Live Games reads a dedicated projection that exposes a room **UUID** and display fields, and joining goes through `shadow_join_public(p_room uuid)`. A public room's code is never transmitted to a non-member. See §26.4.
**SB-LIVE-2** Only rooms with `visibility = 'public'` and `status = 'lobby'` are listed as joinable.
**SB-LIVE-3** The list refreshes live via Postgres Changes on the projection, and offers a manual refresh. It never silently shows stale rooms.
**SB-LIVE-4** A room that fills while the player is looking at it transitions to `Full` in place with the Join control disabled — it does not vanish, because a card disappearing under a cursor mid-click is how players end up in rooms they did not choose.
**SB-LIVE-5** Expired rooms are removed from the list, not shown greyed out.
**SB-LIVE-6** Empty state offers Quick Match and Trial, and explains that public rooms appear here when someone opens one.
**SB-LIVE-7** A player's own rooms are shown at the top with a **Yours** marker and a **Close** action rather than a Join action.
**SB-LIVE-8** Listing is capped at 40 rooms, ordered by FR proximity to the viewer, then recency.

#### Spectators — the explicit decision

> **MVP: a public room accepts exactly one joining player and then closes. There are no spectators.** Match-in-progress rooms appear in the list as context (the arena feels alive) but are not enterable.

Rationale, stated because the brief asks for a clear answer rather than a hedge: spectating requires a third read path into live telemetry, a broadcast role with no publish rights, a spectator-safe view of state that must not leak the opponent's upcoming queue, and a fan-out design. None of that is hard, but all of it is work spent on an audience that does not exist until the mode has players. **V1** adds read-only spectators, capped at 20 per room, joining the existing Broadcast channel with a `spectator` role, with a 3-second delay to prevent stream-sniping. `[FUTURE]`

---

## 8. Combat system

This section defines how typing becomes damage. It is the specification an engineer implements the reducer from.

### 8.1 The architectural premise

TypeForge has no application server. `src/lib/battle/api.js` states it plainly: *"There is no HTTP API to wrap — the app is a static bundle with no backend, so 'the server' is Postgres."* There is no process that can run a 30Hz simulation loop and arbitrate a fight.

Shadow Battle resolves this by making combat a **pure function**:

```
combatState = reduce(initialState, sortedEventLog)
```

- Every meaningful thing a player does emits one **CombatEvent** containing only *raw typing facts* — which card, which lane, when it started, when it finished, how many keystrokes, how many were wrong, the interval histogram.
- **No client ever submits HP, damage, Focus, Chain or an outcome.** Those are all derived.
- Both clients run the reducer locally over their own events plus the opponent's events as they arrive, which is what produces instant local feedback.
- At settle time, Postgres runs the **identical reducer** over the persisted log and writes the authoritative result.

Three consequences fall out of this for free, and they are the reason for the design:

| Property | How it falls out |
|---|---|
| **Server authority** | The server's replay is the result. A tampered client changes nothing but its own screen. |
| **Reconnection** | Refetch the log, replay, resume. There is no session state to restore. |
| **Spectating (V1)** | A spectator is a client that replays the log and emits nothing. |

**SB-CMB-1** The reducer is implemented **once**, in a shared pure module with no React, no DOM and no I/O (`src/lib/shadow/combat.js`), and transliterated into plpgsql for the server replay. Both implementations are covered by the same fixture set (§37).

**SB-CMB-2** The reducer is deterministic: no `Math.random`, no `Date.now`, no floating-point accumulation order dependence. All randomness comes from the seeded queue (§9.4); all time comes from event timestamps.

**SB-CMB-3** All damage arithmetic is performed in **integer tenths of an HP point** and rounded once at the end of each move resolution. Floating-point accumulation across ~120 events in two languages will not agree; integers will.

### 8.2 The CombatEvent

```ts
type CombatEvent = {
  seq:        number;   // per-player monotonic sequence, from 0
  player:     0 | 1;    // seat index, not user id
  round:      1 | 2 | 3 | 4;      // 4 = sudden death
  cardIndex:  number;   // index into the seeded queue — server-verifiable
  lane:       'strike' | 'guard';
  outcome:    'complete' | 'expire' | 'whiff';
  tStart:     number;   // ms since round starts_at, server clock
  tEnd:       number;   // ms since round starts_at, server clock
  keystrokes: number;   // total keydowns that reached the engine
  errors:     number;   // characters ever wrong at their index
  ikiStats:   [number, number]; // [mean, stdev] of inter-keystroke intervals, ms
};
```

Roughly 60–80 bytes serialised in the compact wire form (single-letter keys, as `useBattleRoom.js` already does for Battlefield ticks). Nothing in this payload is a game outcome; every field is a fact about keys being pressed.

`ikiStats` carries a two-number summary rather than a keystroke log. A full keylog would be a privacy liability, would multiply the payload by twenty, and is not needed: the anti-cheat signal is the *shape* of the distribution (§21.2), and mean plus standard deviation captures it.

### 8.3 Par time — the normalisation that makes damage fair

The problem with rewarding raw speed is that a 4-character word is always completed faster than a 14-character word, so raw completion time cannot be the input. Every card therefore carries a **par time**:

```
parMs(card) = 60000 * (chars(card) + 1) / (5 * REF_WPM)      // REF_WPM = 60
```

The `+1` accounts for the implicit word boundary; `chars/5` is the standard word-equivalence the codebase already uses (`netWPM` in `src/lib/typing.js`).

The speed factor is **relative to par**, and clamped:

```
speed = clamp(0.60, 1.40, parMs / max(actualMs, 1))
```

So a 5-character Jab and a 14-character Crush are rewarded on the same scale: doing either 25% faster than a 60 WPM reference gives the same `1.25`. Raw WPM is *normalised out*; what remains is "how far above your par did you perform on this specific card". The clamp at 1.40 is what stops a 180 WPM player from doing 3x everyone's damage — past a point, more speed stops buying more damage and the remaining levers are precision and judgement.

### 8.4 The damage formula

```
damage = base(move)
       * speed          // 0.60 … 1.40   — tempo
       * precision      // 0.60 … 1.25   — accuracy
       * chainMul       // 1.00 … 1.50   — sustained precision
       * contest        // 0.00 … 1.50   — judgement, both players'
       * critMul        // 1.00 or 1.50  — earned, not random
```

**`base(move)`** — see §10.

**`precision`**, from `errors` on the card:

| Errors on the card | `precision` | Name |
|---|---|---|
| 0 | **1.25** | Clean |
| 1 | 1.00 | Scuffed |
| 2 | 0.80 | Loose |
| 3 or more | 0.60 | Sloppy |

An "error" is a character that was ever wrong at its index — the engine already tracks this as `everWrong` (`src/components/typing/useTypingEngine.js`). Backspacing to fix it does not un-count it. Mistakes are recoverable but never free.

**`chainMul = 1 + min(0.05 * chain, 0.50)`** — caps at chain 10. Deliberately capped: an uncapped chain makes the first mistake of a long match match-deciding, which punishes exactly the nervous newer player this mode needs to retain.

**`contest`** — the judgement term, and the only one that depends on what the *other* player did:

| Target's state when the strike resolves | `contest` | Note |
|---|---|---|
| Neutral | 1.00 | |
| Guarding | **0.50** | Guard halves it |
| Guarding, and the strike is a Shuriken | 0.85 | Shuriken pierces |
| Parrying, within the parry window | **0.00** | Damage reflected — see §10.7 |
| Exposed (failed Parry, within 600ms) | 1.25 | Punish the miss — see §10.3 |
| Committed (mid-Crush, mid-Mend, mid-Overdrive) | **1.50** | Long moves are a real risk |
| Staggered (card expired within the last 700ms) | 1.35 | Punish the miss |

Guarding, Committed and Exposed are mutually exclusive by construction. Parrying supersedes Guarding.

**`critMul`** — a hit is **Critical** when `precision == 1.25 AND speed >= 1.25`. Both axes, no randomness. Criticals are 1.50x and produce the loudest feedback in the game. There is no random crit chance anywhere in this design: a random damage roll means a player cannot attribute their loss, which violates G2.

### 8.5 Worked examples

Assume both players at a 60 WPM baseline.

| Situation | Calculation | Damage |
|---|---|---|
| Clean Slash at par, chain 0, opponent neutral | `10 * 1.00 * 1.25 * 1.00 * 1.00` | **12.5** |
| Same, but opponent is guarding | `* 0.50` | **6.3** |
| Clean Slash 30% under par, chain 6, neutral → Critical | `10 * 1.30 * 1.25 * 1.30 * 1.00 * 1.50` | **31.7** |
| Sloppy Crush, over par, opponent guarding | `16 * 0.70 * 0.60 * 1.00 * 0.50` | **3.4** |
| Clean Jab into a committed opponent | `6 * 1.00 * 1.25 * 1.00 * 1.50` | **11.3** |
| Overdrive, clean, at par, chain 10, neutral | `30 * 1.00 * 1.25 * 1.50 * 1.00` | **56.3** |
| Any strike into a successful Parry | `* 0.00`, reflected at 60% | **0** dealt, ~7.5 taken |

**Target time-to-knockout at even skill: 45–75 seconds per round.** This is a balance acceptance criterion (§37), monitored in production as a KPI (§31). A median TTK below 35s means the mode is a coin flip; above 90s means rounds are decided by the clock rather than by combat. Both are balance defects.

### 8.6 What is explicitly *not* in the model

- **No random damage variance.** Attribution beats texture.
- **No hidden information about the opponent's queue.** Both players see the same cards in the same order (§9.4). What is hidden is which lane they took and how far through they are — hidden by physics, not by a fog-of-war rule.
- **No positional state.** No distance, no corner, no movement. There is nothing to control it with.
- **No per-fighter stat differences.** §14.

---

## 9. Word system

### 9.1 Source material — reuse, do not reinvent

The audit (`07-migration-audit.md`) flags that `DIFFICULTIES` is defined three times in three shapes, and `01-PRD.md` §25 makes deduplication a P0. Shadow Battle must not add a fourth word bank.

All card text derives from existing exports in `src/lib/content.js` `[REUSE]`:

| Existing export | Contents | Used for |
|---|---|---|
| `WORD_BANKS.easy` (`COMMON`) | ~130 high-frequency English words | Jab, Guard, Parry, Mend |
| `WORD_BANKS.hard` (`HARDER`) | ~45 orthographically awkward words | Slash, Crush |
| `PUNCTUATED` (via `WORD_BANKS.expert`) | contractions, symbols, digits, brackets | Shuriken |
| `DRILLS[].keys` | per-drill key sets | V1 weakness-targeted queues |

`[NEW]` One addition: a **phrase table** of 60 two-to-four-word combinations for Crush and Overdrive, assembled from `COMMON` + `HARDER` at build time rather than hand-written, so it inherits the existing vocabulary rather than forking it.

### 9.2 Card text constraints — hard invariants

These are not style preferences; violating any of them breaks the game.

| ID | Invariant | Why |
|---|---|---|
| **SB-WRD-1** | The two cards in a pair **must not share a first character**, compared case-insensitively | The first keystroke is the lane commit (§8). Ambiguity makes the control unusable. |
| **SB-WRD-2** | ASCII printable only in MVP; no characters requiring a dead key, AltGr or IME | A player who cannot type a character cannot play the card. Internationalisation is §36-Q4. |
| **SB-WRD-3** | No homoglyph-ambiguous rendering — the mono face (JetBrains Mono) already disambiguates `1/l/I` and `0/O` (`tailwind.config.js`) | A card lost to a misread glyph is not a skill outcome |
| **SB-WRD-4** | No profanity, slurs, proper nouns, brand names or real people | It is a competitive surface shown to strangers |
| **SB-WRD-5** | Card text is never reused within a single round | Muscle memory on a repeated word is not the skill being tested |
| **SB-WRD-6** | Overdrive text is 14–24 characters and always multi-word | It must feel like a commitment |

### 9.3 Word selection per move

| Move | Length | Bank | Shape |
|---|---|---|---|
| Jab | 3–5 | `COMMON` | single word, lowercase |
| Slash | 6–9 | `COMMON` + `HARDER` | single word, lowercase |
| Crush | 10–16 | `HARDER` or phrase table | single long word or two words |
| Shuriken | 4–8 | `PUNCTUATED` | contains at least one symbol or digit |
| Guard | 2–4 | `COMMON` | single word, lowercase |
| Parry | 3–5 | `COMMON` | single word, lowercase |
| Mend | 6–8 | `COMMON` | single word, lowercase |
| Overdrive | 14–24 | phrase table | multi-word, mixed case, at least one punctuation mark |

### 9.4 Determinism — the seeded queue

**This is the mechanism that makes server replay possible, and it is load-bearing.**

```
card(seed, round, index) = derive(xorshift32(seed ^ round ^ index), WORD_TABLE[version])
```

- `shadow_rooms` stores `seed bigint` and `word_table_version int`.
- Both clients and the Postgres replay derive the *identical* card at every index. A client cannot claim it typed a word it was never shown, because `cardIndex` is verifiable.
- The PRNG is **xorshift32**, specified exactly — a named 32-bit algorithm with a written reference implementation — because "use a seeded PRNG" is not a specification. JavaScript and plpgsql must produce bit-identical streams.
- `WORD_TABLE` is versioned and immutable once shipped. A word-list edit bumps the version; old matches replay against the version they were played on.

**SB-WRD-7** Both players in a match receive the **same card sequence** but advance through it independently. Same difficulty distribution, no shared-progress coupling. This is what makes the duel fair without making it a race.

### 9.5 Difficulty scaling

Two dials, deliberately kept separate.

**Match band** — set once, from `min(FR_p0, FR_p1)` so the weaker player is never punished for their opponent's rank:

| Band | FR | Bank weighting (COMMON : HARDER : PUNCTUATED) |
|---|---|---|
| Ember | below 1200 | 75 : 20 : 5 |
| Steel | 1200–1599 | 55 : 33 : 12 |
| Damascus | 1600 and above | 35 : 45 : 20 |

For bot matches the band comes from the bot profile. For unrated private duels it comes from the host's band, disclosed on the create screen.

**Round escalation** — within a match the weighting shifts one band harder per round (R1 base, R2 +1, R3 +2, capped at Damascus). This produces a natural intensity curve without changing any combat number: round three *feels* faster because the words are harder, not because a multiplier changed. Sudden death runs at Damascus regardless of band.

**SB-WRD-8** Difficulty affects **only which words appear**. It never touches damage, HP, timers or any combat constant. A harder word is harder because it is harder to type, and its par time already accounts for its length.

### 9.6 Code-like challenges

**Not in MVP.** Symbol-dense text has par times that behave nothing like prose — `obj?.prop ?? "x"` at 18 characters is far slower than an 18-character word for most typists, so `parMs` would systematically over-reward it. Shuriken already provides symbol pressure in a balanced dose.

**V1:** a *Syntax* arena variant drawing cards from `src/lib/snippets/` at the token level, with par calibration derived from measured production data rather than from the prose reference. Separate balance pass, separate rating pool so the two are never comparable. `[FUTURE]`

---

## 10. Move system

Eight moves in MVP. The count is a budget, not an accident: the player must be able to hold the entire move set in working memory while their attention is on a word.

Every move is presented on a card with its **name**, its **lane**, and its **word**. The player never memorises a mapping — the card says what it is.

### 10.1 The move table

| Move | Lane | Base | Focus* | Word | Par band | Purpose | Risk |
|---|---|---|---|---|---|---|---|
| **Jab** | strike | 6 | +4 | 3–5 | ~0.5s | Safe chip damage, builds chain cheaply | Low ceiling |
| **Slash** | strike | 10 | +6 | 6–9 | ~0.9s | The bread-and-butter attack | Moderate exposure |
| **Crush** | strike | 16 | +8 | 10–16 | ~1.5s | Burst damage | **Committed** — incoming x1.50 |
| **Shuriken** | strike | 7 | +5 | 4–8 sym | ~0.9s | Beats a turtling opponent — guard reduces it only 15% | Symbol accuracy is brittle |
| **Overdrive** | strike | 30 | −100 | 14–24 | ~2.4s | The payoff for a clean game | **Committed**, resets chain, spends all Focus |
| **Guard** | guard | — | +3 | 2–4 | ~0.3s | Halve incoming for 1200ms | Deals nothing; cedes tempo |
| **Parry** | guard | — | +10 | 3–5 | ~0.5s | Reflect a strike entirely | **Miss → exposed 600ms, incoming x1.25** |
| **Mend** | guard | — | −25 | 6–8 | ~1.1s | Restore 12 HP | **Committed** — incoming x1.50 |

*Focus for Jab, Slash, Crush and Shuriken is the value on a **clean** (0-error) completion — see §11.2 for the flat penalty applied when the card has errors. Guard, Parry, Overdrive and Mend's Focus values are unconditional; those cards' completion is binary (played or not) rather than a damage-bearing hit, so accuracy does not scale them.

### 10.2 Strike lane, in detail

**Jab** — the low-variance option, ~30% of strike slots. It is how a player protects a chain when the alternative is a Crush they may not finish. *Counterplay:* out-tempo it; a guarding opponent takes 3 HP from it. *Animation:* fast forward jab, ~180ms, minimal recoil.

**Slash** — the default, ~40% of strike slots. Balanced on every axis. *Counterplay:* Guard halves it; Parry erases it. *Animation:* arcing horizontal strike, ~320ms, arc trail in the striker's side colour.

**Crush** — ~18% of strike slots. **The `committed` flag is the whole design of this move**: from the first keystroke until completion, incoming damage is x1.50. Throwing a Crush is a read — it says *I do not believe you can hit me in the next 1.5 seconds*. *Counterplay:* the opponent sees card length as a bar width (§25.4) and strikes into it. *Animation:* a visible wind-up tell (~400ms), then an overhead slam with screen-shake at 60% amplitude.

**Shuriken** — ~12% of strike slots, the anti-turtle tool. Guard reduces it by only 15% instead of 50%. Low base damage, so it is not a substitute for Slash — it is the answer to an opponent who guards every card. Its text is symbols and digits, which is where most players' accuracy actually lives. *Animation:* a thrown projectile with **200ms travel** — the only move with travel time, so it can land *after* a guard expires.

**Overdrive** — appears in the strike lane **only when Focus is 100**, replacing whatever strike would have been there, and stays until played or the round ends. Spends all 100 Focus and resets chain to 0 whether it lands or not. *Counterplay:* the opponent can see Focus fill (§25.3), so an Overdrive is telegraphed by a full meter; the correct response is to guard, or to punish the commitment. *Animation:* 500ms charge, arena dims to 40%, then a full-width strike; ~900ms total.

### 10.3 Guard lane, in detail

**Guard** — ~45% of guard slots. Raises guard for **1200ms from completion**. Halves incoming (Shuriken excepted). Cheap and short, so it costs little tempo — but it deals nothing, and a player who guards every card loses to Shuriken and to Mend-stalling. *Animation:* defensive stance with a visible ring, held for the duration so the state is legible to both players.

**Parry** — ~25% of guard slots. **The highest-skill move in the game.**

- Succeeds if it *completes* while an opponent strike is in flight and unresolved — the opponent has committed to a strike card and not yet finished it, or a Shuriken is in travel.
- Success: incoming damage is **0**, and **60% of it is reflected** at the attacker, ignoring their guard state. Focus +10.
- Failure (no strike was in flight): the fighter is **exposed** for 600ms — incoming x1.25 — and Focus does not increase.
- The player cannot see with certainty whether a strike is in flight. They can see the opponent's card-progress bar and infer it. **This is the read the game is built around.**

*Animation:* a deflection with a bright spark at the contact point and a distinct audio cue; the reflected damage number travels *from* the parrier *to* the attacker, so causality is visible.

**Mend** — ~30% of guard slots, and only offered when `HP < 70` and `Focus >= 25`. Restores **12 HP** for 25 Focus. `committed` — incoming x1.50 for its ~1.1s. Healing while the opponent is attacking is usually wrong; healing in the gap after they whiff is usually right. *Animation:* a slow inward gather with a warm pulse — deliberately the least flashy move in the game, because it is not a moment of triumph.

### 10.4 Card pair composition

- **SB-MOV-1** SB-WRD-1 (distinct first characters) is enforced by re-rolling the guard word up to 8 times, then falling back to a curated distinct-initial word. The re-roll is inside the seeded derivation, so it stays deterministic.
- **SB-MOV-2** Overdrive replaces the strike card whenever Focus is exactly 100.
- **SB-MOV-3** Mend appears only under its HP/Focus conditions; otherwise the guard slot re-rolls between Guard and Parry.
- **SB-MOV-4** Crush never appears twice consecutively.
- **SB-MOV-5** The first card pair of every round is always `Jab | Guard` — the two shortest, safest options, so nobody loses a round to the first 700ms.

### 10.5 Timing constants

| Constant | Value | Rationale |
|---|---|---|
| Card deadline | `parMs * 2.5` | Generous enough that a 30 WPM player completes most cards; tight enough that stalling is not viable |
| Commit window | unlimited within the deadline | The first keystroke can come at any time; the deadline bounds it |
| Guard duration | 1200ms from completion | Roughly one Slash-length window |
| Parry window | while an opposing strike is unresolved | A *state* check, not a fixed millisecond value — which is what makes it a read rather than a reflex test |
| Exposed (failed parry) | 600ms | Half a guard |
| Stagger (card expired) | 700ms | Slightly longer than exposed |
| Shuriken travel | 200ms | Long enough to outlast a guard raised late |
| Inter-card gap | 120ms | Enough to register the resolution; short enough not to break flow |

### 10.6 Moves deferred, and where they went

The brief names eleven move categories. Eight ship; the other three are accounted for rather than dropped.

| Category in the brief | Disposition |
|---|---|
| Light Attack | **Jab** |
| Heavy Attack | **Crush** |
| Block | **Guard** |
| Counter | **Parry** |
| Combo | Not a move — an emergent state. **Chain** (§11.3). A "combo" you press a button for is a different genre. |
| Special Attack | **Shuriken** — the situational tool |
| Ultimate | **Overdrive** |
| Recovery | **Mend** |
| **Dash** | **V1.** A guard-lane move that cancels commitment and grants 400ms of evasion. Real depth, but it interacts with every other move's timing and needs its own balance pass. `[FUTURE]` |
| **Dodge** | Folded into Guard for MVP. V1 splits it out as a shorter, total-avoidance window with a tighter par. `[FUTURE]` |
| **Finisher** | **V1.** A cinematic execution when a strike would take the opponent below 0 from above 20 HP. Pure presentation, zero mechanical effect — which is exactly why it can wait. `[FUTURE]` |

### 10.7 Damage reflection detail

Reflection resolves as a **new strike event authored by the reducer**, never by a client. It carries the parrier as source, `base = 0.60 * the incoming strike's fully-computed damage`, `contest = 1.00` (a parry ignores the original attacker's guard state), and `critMul = 1.00`. Reflections never crit: a reflected critical would routinely one-shot at low HP and make the parry read binary rather than valuable.

---

## 11. Health, Focus and Chain

Three numbers. Not five. A new player must be able to read their entire state in one glance without a legend.

An earlier draft of this design carried five meters — Health, Energy, Combo, Shield and Ultimate. Shield collapsed into a *state* (you are guarding, for 1200ms) because a meter implies a resource you spend, and Guard is not spent. Ultimate collapsed into Focus because "Focus at 100" is a clearer trigger than a second bar that fills from the first.

### 11.1 Health

| Property | Value |
|---|---|
| Round start | **100** |
| Carry-over between rounds | **None** — each round starts fresh |
| Minimum | 0 (knockout) |
| Restored by | Mend only (+12, costs 25 Focus) |
| Displayed as | A bar plus the integer value |

**Why no carry-over:** carrying HP between rounds means round one effectively decides the match, which makes best-of-three a formality. Fresh HP is what gives the losing player a real reason to keep playing after round one — see §12.

**Low-health state:** at `HP <= 25` the fighter enters **Ragged**: the HP bar pulses (or, with reduced motion, switches to a hatched fill and a `LOW` label), a low-frequency tone enters the audio bed, and the arena vignette tightens. This is feedback, not a mechanic — Ragged changes no combat value. Both players see the other's Ragged state, because knowing your opponent is one Slash from death is information that should be available to both.

### 11.2 Focus — the energy meter

| Property | Value |
|---|---|
| Round start | **0** |
| Maximum | **100** |
| Carry-over between rounds | **None** |

**Generated by:**

| Action | Focus |
|---|---|
| Jab, Slash, Crush or Shuriken landed clean (0 errors) | **Move's Focus value, per §10.1** (+4 / +6 / +8 / +5) |
| Same, landed with 1+ errors | **+2** flat, regardless of move |
| Successful Parry | **+10** |
| Guard completed | **+3** |
| Chain milestone (every 5) | **+5 bonus** |

**Spent by:**

| Action | Focus |
|---|---|
| Mend | **−25** |
| Overdrive | **−100** (all of it) |
| Whiff (a keystroke matching neither card) | **−3** |
| Card expiry | **−5** |

Reaching 100 unlocks Overdrive in the strike lane. Focus does not decay over time — decay would punish thinking, and thinking is the point.

**Reading the numbers:** a player landing clean words at roughly one per second reaches 100 Focus in about 16 seconds of clean play. That is deliberately slower than a typical round's first exchange, so Overdrive arrives mid-round as a turning point rather than as an opener.

### 11.3 Chain — the combo system

Chain is a **count of consecutive clean word completions**, in either lane. Guarding cleanly builds chain. This is deliberate: a defensive player must have a route to the damage multiplier too, or the "correct" play degenerates into always attacking.

```
chain += 1        on any completion with 0 errors
chain  = 0        on: completion with 2+ errors
                      card expiry
                      taking a Critical hit
                      playing Overdrive
chain unchanged   on: completion with exactly 1 error
                      whiff
```

`chainMul = 1 + min(0.05 * chain, 0.50)`.

Three properties worth noting:

- **One error is forgiven** (chain holds but does not grow), two breaks it. This is the single most important tuning value for how the mode *feels*. A design where any error breaks the chain makes the game feel punitive at exactly the skill level that needs encouragement.
- **Taking a Critical breaks your chain.** This is the only way an opponent can directly attack your multiplier, and it is what makes a Critical feel like a moment rather than a bigger number.
- **Chain does not carry between rounds.**

**Display:** a numeral with a filled arc that completes at 10 (the cap). Milestones at 5 and 10 produce a distinct sound and a one-frame flash on the numeral. Never a screen-filling effect — chain milestones happen every few seconds and anything large becomes noise.

### 11.4 State summary the player can recite

> *My health is how long I last. My focus is my big move. My chain is how hard everything hits. Clean typing feeds all three.*

That sentence is the acceptance test for §11. If a playtester cannot produce something close to it after two matches, the meter design has failed.

---

## 12. Round system

### 12.1 The structure decision

Three structures were considered.

| Structure | Pros | Cons | Verdict |
|---|---|---|---|
| **One continuous fight** to 100 HP | Simplest; no interruptions | No comeback structure; a bad first 15 seconds is unrecoverable; no natural place to show stats; typing for 3 minutes without a break is genuinely fatiguing | Rejected |
| **Best of 3**, 100 HP per round, fresh each round | Comeback structure; natural stat breaks; caps match length; hands the losing player a reset | Adds a between-round screen; a 2-0 match ends in ~2 minutes | **Chosen** |
| **First to N knockdowns** in one continuous fight | Dramatic | Requires a knockdown/getup system, which is positional state we do not have (NG1) | Rejected |

> **Decision: best of three. 100 HP per round. First to two round wins takes the match.**

Typing fatigue is the deciding factor and it is not a soft consideration. Sustained high-accuracy typing under pressure is physically tiring in a way that holding a controller is not. The 8–12 second gap between rounds is a real rest, and it is where the product gets to teach — the round card shows *why* you lost the round, which is the mechanism behind G2.

### 12.2 Round parameters

| Parameter | Value |
|---|---|
| Rounds to win | 2 |
| Maximum rounds | 3, plus sudden death |
| HP per round | 100 |
| Round time cap | **90 seconds** |
| Inter-round interval | **8 seconds**, skippable by mutual ready |
| Countdown before round 1 | **3.5 seconds** (3 beats + 0.5s propagation budget, matching Battlefield) |
| Countdown before rounds 2, 3 | **2.0 seconds** |
| Word difficulty | R1 base band, R2 +1, R3 +2 (§9.5) |

### 12.3 Round outcomes

| Condition | Outcome |
|---|---|
| One fighter reaches HP <= 0 | The other wins the round |
| 90s cap reached, HP differs | Higher HP wins the round |
| 90s cap reached, HP identical | **Round draw** — neither player banks a round win; the match proceeds to the next round |
| Both fighters reach HP <= 0 within the same 120ms resolution window | **Double knockout** — round draw |
| A fighter disconnects past the grace window | Opponent wins all remaining rounds; match ends as a forfeit |

A round draw does not consume a round slot in the "maximum 3" count — but the match still hard-stops after 5 total rounds to bound the worst case, at which point the higher aggregate HP-remaining across all rounds wins. If that is also tied, the match is a draw.

### 12.4 Sudden death

Entered at **1–1–1** (one win each plus a draw), or at 1–1 after round three ended in a draw.

| Parameter | Value |
|---|---|
| HP | **40** |
| Focus at start | **50** |
| All damage | **x1.25** |
| Time cap | **45 seconds** |
| Word band | Damascus |
| Cap reached with HP tied | **Match draw** |

Both lanes remain available. An earlier draft removed the guard lane to force aggression; it was cut because removing a lane changes what the game *is* at the moment it matters most, and a player who has spent two rounds building parry reads should not have that skill deleted in the decider.

### 12.5 Round start and end

**Start.** Input is gated exactly as Battlefield gates it — `useTypingEngine`'s `gated` + `begin()` + `startAtMs` (`src/components/typing/useTypingEngine.js`) `[REUSE]`. Not a UI promise: no keystroke reaches the engine before GO. Elapsed time is measured from the server-chosen `starts_at`, not from the frame that painted GO, so two machines 80ms apart still agree.

**End.** On a knockout the arena holds for **1400ms** — the finishing blow plays out, the loser's fighter falls, and the HP bar settles at zero — before the round card. A round that cuts instantly to a results panel throws away the only moment of drama the mode has.

**The round card** (8 seconds) shows:

- Who won the round, and the deciding fact in one line: *"Knockout — Overdrive at 12s"* or *"Time — 34 HP to 18 HP"*
- Your typing for that round: WPM, accuracy, clean-word rate, longest chain, **each compared against your own 30-day baseline** from `src/lib/store.jsx`
- Lane split: how many strikes vs. guards you committed to, and the same for your opponent — this is the tactical feedback that teaches the game
- Match score, and a **Ready** control that skips the remaining wait when both press it

### 12.6 Rematch

**SB-RND-1** After a match, both players are offered **Rematch**. Accepting creates a **new room** with a new seed, reusing the roster — never a reset of the finished room, because a finished room's result rows are immutable (the same stance `battle_results` takes).
**SB-RND-2** Rematch requires both players to accept within 20 seconds.
**SB-RND-3** A rematch of a rated match is rated. A rematch of a private duel is unrated. The mode never changes under the players.
**SB-RND-4** Declining a rematch is a single action, is never penalised, and returns the player to the Shadow Battle landing screen with the opponent's outcome preserved in match history.

---

## 13. Bot system

### 13.1 The design principle

> **The bot plays the game. It does not fake the outcome.**

This is the credibility line of the entire mode, and it is architecturally enforced: the bot emits `CombatEvent` objects of the same shape a human emits, into the same reducer. There is no code path where a bot's damage is calculated differently, no difficulty knob that multiplies bot damage, and no rubber-banding that alters HP directly. A bot that is "harder" is a bot that types faster and chooses better — nothing else.

The consequence is that everything a player learns fighting a bot transfers directly to fighting a human, which is what makes Trial mode a genuine on-ramp rather than a separate toy.

### 13.2 Bot behaviour model

Each card, the bot runs:

```
1. REACT     wait reactionMs (+ jitter) before considering the pair
2. DECIDE    pick a lane from the policy, given observable state
3. TYPE      sample a completion time; sample whether errors occur
4. EMIT      emit a CombatEvent identical in shape to a human's
```

**Completion time** is sampled from a **log-normal** distribution around the bot's par-relative target, not a uniform one. Human typing times are right-skewed — occasional slow words, rarely impossibly fast ones — and a uniform sample produces a machine-like rhythm that players notice within one round.

```
targetMs   = parMs * (REF_WPM / botWpm)
actualMs   = targetMs * lognormal(mu = 0, sigma = botSigma)
```

**Errors** are sampled per-card against `cleanRate`, and when an error occurs the bot pays a realistic correction cost: `+ (140 + 90 * errors) ms`, because a human who mistypes backspaces and retypes. A bot that errs without paying for it is not simulating typing, it is simulating a damage penalty.

**Observable state only.** The decision policy may read: its own HP/Focus/Chain, the opponent's HP/Focus/Chain, the opponent's card-progress bar, and whether an opponent strike is currently in flight. It **may not** read the opponent's committed lane before it is observable, nor the opponent's upcoming cards beyond what the player can also see. This is a hard rule, stated so that a future implementer does not "improve" the bot by giving it the game state.

### 13.3 Bot profiles

| Profile | Difficulty | WPM (mean ± σ) | Clean rate | Reaction | Guard rate | Parry attempt | Overdrive discipline |
|---|---|---|---|---|---|---|---|
| **Recruit** | Easy | 28 ± 9 | 88% | 700ms | 15%, only at HP<30 | never | plays it 2s late, at random |
| **Adept** | Normal | 45 ± 11 | 94% | 450ms | 32% | 10%, poorly timed | plays it when available |
| **Ronin** | Hard | 65 ± 12 | 97% | 300ms | 52% | 30%, decent timing | holds for an opening |
| **Shade** | Expert | 88 ± 14 | 99% | 200ms | 68% | 45%, good timing | holds for a committed opponent |
| **Mirror** | Adaptive | tracks player | tracks player | 260ms | 45% | 25% | holds for an opening |

**Every profile makes visible mistakes.** Even Shade errs on 1 in 100 cards and occasionally guards into nothing. A bot that never errs reads as a script and removes the satisfaction of a win.

### 13.4 Mirror — the adaptive profile

Mirror is the profile most likely to be built badly, so its behaviour is specified rather than described.

```
observedRate  = trailing-10-card par-relative speed of the human player
observedClean = trailing-20-card clean rate of the human player

botWpm    = clamp(RECRUIT_WPM, SHADE_WPM, observedRate * 0.97)
cleanRate = clamp(0.86, 0.985, observedClean - 0.01)
```

- Recalculated at the **end of each round**, never mid-round. Mid-round adaptation makes the bot feel like it is cheating, because from the player's seat it is indistinguishable from rubber-banding.
- **Hard clamp:** Mirror never exceeds `1.05 x` the player's best observed rate in the match. Without this, a player who has one exceptional round is punished for it in the next.
- **Floor:** Mirror never drops below Recruit. A bot that plays down to a struggling player teaches nothing.
- Mirror deliberately targets **0.97x** — slightly below the player. A close loss to a bot is discouraging in a way a close win is not, and Mirror's job is to be the on-ramp.

### 13.5 What bots never do

**SB-BOT-7** Bot matches award **zero Forge Rating**. Rating is only meaningful between humans, and bot-farmable rating destroys the ladder on day one.
**SB-BOT-8** Bots are never presented as human. Live Games never lists a bot; match history labels the opponent `Recruit (bot)`.
**SB-BOT-9** No bot reads unobservable state (§13.2).
**SB-BOT-10** No bot has damage, HP, timing or word-difficulty modifiers. Difficulty lives entirely in the typing simulation and the decision policy.
**SB-BOT-11** The bot runs entirely client-side. Bot matches make no network calls during combat, and are the reason Trial works offline.

### 13.6 Bot unavailability

The bot is a local module with no dependencies, so "bot unavailable" is only reachable via a chunk-load failure. If `src/lib/shadow/bot.js` fails to load, the mode surfaces *"Could not start the trial — reload to try again"* with a reload action, and never falls back to a degraded opponent.

---

## 14. Fighter system

### 14.1 The structural guarantee

> **The fighter entity contains no numeric gameplay field.**

Not "fighters are balanced". Not "we will avoid pay-to-win". There is no column, no property, no config key anywhere in the fighter definition that combat reads. The reducer (§8) never receives a fighter id. It is impossible to ship an unbalanced fighter because there is nothing to unbalance.

```ts
type FighterProfile = {
  id:        string;
  name:      string;
  silhouette: string;   // key into the shared path set
  trail:     'blade' | 'ember' | 'dust' | 'none';
  strikeGlyph: string;  // the mark left by a landed hit
  rarity:    'standard' | 'earned' | 'rare';
  unlock:    UnlockCondition;
  // there is deliberately no `stats`, `bonus`, `modifier` or `power` field
};
```

All fighters share **one animation rig**: identical pose set, identical timings, identical hit-spark origins. A silhouette is a path swapped onto that rig. This is also why the render is cheap (§30).

### 14.2 Visual direction

Solid single-colour silhouettes, no interior detail, no faces, no rendered equipment. Proportions are stylised — long limbs, narrow torso, a suggestion of cloth in motion — read as a *shadow* rather than as a person.

**The side-colour rule, which overrides all cosmetics:**

> **Your fighter always renders in the `--brand` family. Your opponent always renders in the `--accent` family. Always. On both screens.**

Cosmetics change *form* — silhouette shape, trail, strike glyph. They never change side colour. Two players who both picked the same cosmetic are still instantly distinguishable, and a player's own fighter is always the same colour no matter who they are fighting. This is a competitive-clarity requirement, not a style choice: at a glance, in peripheral vision, mid-word, the only reliable channel is colour.

Both palettes already pass the product's contrast gate against both themes (`scripts/check-contrast.mjs`), and any new fighter accent must pass the same script before it ships.

### 14.3 The MVP roster

| Fighter | Rarity | Unlock | Character |
|---|---|---|---|
| **Ash** | standard | default | The base shadow. Clean lines, no trail. |
| **Cinder** | earned | Win 5 matches | Frayed edges, ember trail. |
| **Quench** | earned | Win a round without taking damage | Sharp, angular, a cold vapour trail. |
| **Wick** | earned | Reach a chain of 15 in a single round | Thin and fast-reading, blade trail. |
| **Damask** | rare | Reach 1800 FR | Patterned silhouette edge, the only fighter with an animated outline. |

Five at launch. Cosmetics are the reward economy (§20), so the roster grows with the mode rather than shipping complete.

### 14.4 Customisation

- **Silhouette** — from the unlocked roster.
- **Trail** — from unlocked trails, independent of silhouette, so combinations multiply the roster without new art.
- **Strike glyph** — the mark left by a landed hit. Purely decorative; must not obscure the HP bars, which is an art-review criterion.
- **Display name and avatar** — reuses the existing profile system (`src/lib/avatars.js`, `PRESET_AVATARS`) `[REUSE]`. Shadow Battle introduces no second identity.

### 14.5 Unlock rules

**SB-FTR-1** Every unlock is earned through play. No payment path exists in this product and none is added.
**SB-FTR-2** Rarity labels describe unlock difficulty, never power.
**SB-FTR-3** Unlock conditions are visible before they are met, so a cosmetic is a goal rather than a surprise.
**SB-FTR-4** Bot matches count toward unlock conditions that are about *your* performance (chain, flawless round) and never toward conditions about *winning* — otherwise every cosmetic is five minutes of Recruit farming.
**SB-FTR-5** Unlocks persist server-side in `shadow_unlocks` for signed-in users and in the local store for guests, merging on sign-in via the existing `src/lib/sync.js` path.
**SB-FTR-6** The fighter catalog is a **client-side constant**, not a database table. Only the unlock rows are persisted. The catalog must ship with the client anyway; a table for it would be an entity that exists to be read once (§26.6).

---

## 15. Multiplayer system

### 15.1 Transport

Shadow Battle inherits Battlefield's dual-transport design unchanged in principle (`src/lib/battle/useBattleRoom.js`), because the reasoning behind it applies identically here:

| Information | Transport | Why |
|---|---|---|
| **Durable state** — room status, roster, round outcomes, results | **Postgres Changes** | RLS-filtered by the server, and consistent with what a cold page load would fetch. This is what makes a mid-match refresh land on the right screen. |
| **Combat events** — the event log | **Broadcast, then persisted** | Needed within ~100ms for responsive combat; also written durably so the log is replayable. |
| **Card progress** — the opponent's bar | **Broadcast only** | Worthless one second later. Never touches Postgres. |

**The one difference from Battlefield:** Battlefield's Broadcast is purely advisory — a dropped tick costs a moment of staleness, never an outcome. Shadow Battle's combat events *are* the outcome, so they cannot be fire-and-forget. Combat events therefore travel **both** paths: Broadcast for immediacy, and an `INSERT` into `shadow_events` for durability. The reducer deduplicates on `(player, seq)`, so a Broadcast message and its durable twin collapse into one event.

**SB-MP-1** Combat events are written durably before their round settles. A Broadcast-only event that never reached Postgres does not exist as far as the result is concerned.
**SB-MP-2** Durable writes are **batched at ~500ms** rather than one row per event. A 90-second round produces roughly 90–140 events per player; batching turns ~250 inserts into ~180 across the match, comfortably inside the same envelope Battlefield's 5-second checkpoints occupy.
**SB-MP-3** If the Broadcast channel drops entirely, combat continues correctly at higher latency by reading events from Postgres Changes. Feel degrades; correctness does not. This must be verified by a test that disables Broadcast (§37).

### 15.2 Rate and payload budget

| Stream | Rate | Payload | Notes |
|---|---|---|---|
| Combat events | ~1–2/s per player, bursts to 4 | 60–80 bytes | Event-driven, not polled |
| Card progress | 6 Hz, delta-suppressed | ~20 bytes | `{u, i, p}` — seat, card index, chars done |
| Presence/heartbeat | 0.5 Hz | ~30 bytes | Drives the disconnect grace window |

Two players at these rates is roughly **a quarter** of the load Battlefield already carries at eight players, so no new quota headroom is required.

Card progress runs at 6 Hz rather than Battlefield's 1 Hz because it feeds a read that has to be made in under a second — inferring whether a strike is in flight for a Parry (§10.3). One-hertz granularity would make Parry a coin flip.

### 15.3 The typing-performance rule

`useBattleRoom.js` already documents the constraint and the reason: *"Rival ticks land in a ref and are exposed through `subscribeTicks`, NOT through React state."* Shadow Battle is stricter, because it adds a 60fps render.

**SB-MP-4** No network message may cause a React state update in the subtree containing the typing surface. Opponent state lands in refs; the arena reads those refs on its own `requestAnimationFrame`.
**SB-MP-5** The typing input path — `keydown` to painted glyph — must never await, poll or synchronise with anything. Budget: **p95 <= 16ms, p99 <= 33ms**, measured (§30).
**SB-MP-6** The arena renders on `<canvas>`, outside the React reconciliation path entirely. See §30.2.

### 15.4 Clock

`measureClockOffset()` (`src/lib/battle/clock.js`) is reused unchanged `[REUSE]`. It takes several `battle_server_time()` samples, keeps the three with the lowest round-trip, and uses the median offset — the NTP approach, for the NTP reason.

Combat needs this more than a race does: every `tStart` and `tEnd` in the event log is expressed in **milliseconds since the round's server-assigned `starts_at`**, so two clients disagreeing about wall time would produce two different fights.

**SB-MP-7** `battle_server_time()` is generalised to `arena_server_time()` and shared. Battlefield keeps its existing wrapper so `0009_battlefield.sql` is not touched.
**SB-MP-8** If the measured offset exceeds **2000ms**, the match does not start; the player is told their device clock is far out of sync and offered a retry. A silently wrong clock is worse than a refused match.

### 15.5 Connection lifecycle

| Event | Behaviour |
|---|---|
| **Heartbeat missed (2 consecutive, ~4s)** | Opponent shown as `Unstable` — an amber connection dot, no gameplay change |
| **Presence lost** | Combat **pauses within 400ms**. Both clocks stop, no cards expire, a full-width banner states *"Opponent lost connection — 20s"* with a live countdown |
| **Reconnect within 20s** | 2-second re-entry countdown, then combat resumes from the replayed log |
| **Grace expires** | Match ends as a forfeit. The remaining player wins all undecided rounds. Rating applies. |
| **Own connection lost** | Local combat **stops immediately** — no ghost typing into a void. *"Reconnecting…"* with a countdown and a **Leave** action |
| **Both disconnect** | Room settles to `abandoned` by the reaper; no rating change for either player |

**SB-MP-9** Pause is a **room-level state written to Postgres**, not a local UI condition. Both clients must agree that time has stopped, or the fighter who kept playing gains free damage.
**SB-MP-10** Reconnection is: refetch the event log, replay the reducer, resume. There is no bespoke resume path, and that is the payoff of §8.1.
**SB-MP-11** A player may pause-abuse by killing their network. Mitigation: **two pauses per match maximum per player**; a third disconnection is an immediate forfeit. Total paused time is capped at 40 seconds per match.

### 15.6 Duplicate connections

`01-PRD.md` §18.3 lists two-tab behaviour as `[UNVERIFIED]` for Battlefield. For Shadow Battle it is defined, because a duplicate connection in a combat mode is a live double-input bug rather than a cosmetic oddity.

**SB-MP-12** Each client generates a `session_id` on entering a room. `shadow_players.active_session_id` records the current one.
**SB-MP-13** A second session for the same user in the same room **takes over**. The first is shown *"This match moved to another tab"* and becomes read-only.
**SB-MP-14** `shadow_event_append` rejects any event whose `session_id` is not the active one. This makes the single-writer invariant a database constraint, not a client convention.

---

## 16. Matchmaking

Product behaviour is specified in §7.2. This section covers what makes it work.

### 16.1 The queue, without a queue server

There is no process to run a matchmaker. The queue is a table plus an RPC.

```
shadow_queue(user_id pk, fr int, band_started_at timestamptz,
             enqueued_at timestamptz, region text, session_id uuid)
```

`shadow_matchmake()` is a `SECURITY DEFINER` function called by the waiting client on a **backoff schedule — 1s, 2s, 3s, then every 4s** (not a tight poll). Each call:

1. Refreshes the caller's queue row (which doubles as a liveness heartbeat).
2. Computes the caller's current band width from `now() - enqueued_at` (§7.2 SB-MM-1).
3. Selects the closest-FR opponent whose own band also contains the caller — **matching must be symmetric**, or a wide-band waiter drags a fresh entrant into a mismatch.
4. Under `FOR UPDATE SKIP LOCKED`, claims both rows, creates the room, and deletes both queue entries **in one transaction**.

`FOR UPDATE SKIP LOCKED` is what makes concurrent matchmaking safe without a coordinator — two simultaneous calls cannot claim the same opponent. This is the same locking discipline `battle_join` already uses for capacity.

**SB-MM-7** Queue rows older than 90 seconds without a heartbeat are reaped. A closed browser must not sit in the queue.
**SB-MM-8** A user may hold at most one queue row. Re-entering replaces it.
**SB-MM-9** Match creation and queue removal are one transaction. A player matched into a room they never learn about is the worst failure this system can have.

### 16.2 Accept / decline

Both players must accept within 8 seconds. Declines and timeouts are distinguished:

| Case | Decliner | Other player |
|---|---|---|
| Explicit decline | Requeued, decline counter +1 | Requeued at their prior band width — they lose no waiting progress |
| Timeout | Requeued, no counter | Requeued at prior band width |
| Both accept, handshake fails | Both requeued at prior band width | — |

**SB-MM-10** Being declined never costs the other player queue position or band progress. Otherwise, declining becomes a way to grief.

### 16.3 What matchmaking uses, and does not

**Uses:** Forge Rating, queue wait time, recency of prior opponents.

**Does not use:** WPM, accuracy, level, XP, streak, or any typing metric. Stated as a rule (SB-MM-6) because it will be a recurring temptation: WPM is the most available number in the product and it is the wrong one. Two players at 70 WPM can be 400 FR apart, because judgement is most of the skill.

**V1:** Glicko-2 with rating deviation, so a new or returning player is matched by *confidence* as well as by rating, and placement converges faster. Elo with a dynamic K (§19.2) is the MVP because it is understandable, cheap and adequate at launch volume. `[FUTURE]`

---

## 17. Rooms and invites

Product behaviour is in §7.3. Mechanics here.

### 17.1 Codes

**SB-ROOM-1** Codes are minted by a shared `arena_mint_pin()`, generalised from `battle_mint_pin()` (`0009_battlefield.sql`), checking uniqueness against **both** `battle_rooms` and `shadow_rooms`.

This matters more than it appears. Without a shared namespace, one code could be a live Battlefield and a live Shadow room simultaneously, and a person reading six characters aloud has no way to say which. With it, a single **Join with code** control anywhere in the product resolves a code to exactly one live room and routes to the right mode. `arena_code_lookup(p_pin text)` returns `{ mode, room_id }` and nothing else.

**SB-ROOM-2** The alphabet is unchanged: 30 symbols excluding `0/O`, `1/I/L` and `U`. ~729M combinations.
**SB-ROOM-3** Uniqueness is a partial unique index over live rooms only, so finished codes are reissuable.
**SB-ROOM-4** Codes are case-insensitive on input, uppercase on display.
**SB-ROOM-5** Code entry uses the existing `src/components/battle/PinInput.jsx` `[REUSE]`.

### 17.2 Invite links

`https://<origin>/shadow/<CODE>`.

**SB-ROOM-6** Opening the link resolves the room, shows the host, and offers **Join**. It never joins automatically — a link in a group chat should not consume a slot when someone taps it to look.
**SB-ROOM-7** A signed-out visitor is offered a guest identity inline via `signInAnonymously` (`src/lib/supabase.js:99`) `[REUSE]`. Signing in is not a wall.
**SB-ROOM-8** Invalid, expired, full and already-started codes each produce a distinct message with a distinct next action. A single "cannot join" for four different situations is a bug.

| Condition | Message | Action offered |
|---|---|---|
| Not found | *No duel with that code. Check the six characters.* | Re-enter |
| Expired | *That duel expired. Rooms close after 30 minutes.* | Create one |
| Full | *That duel already has two fighters.* | Live Games |
| In progress | *That duel has already started.* | Live Games |
| Your own room | *That is your room.* | Open it |

### 17.3 Room lifecycle

| Property | Value |
|---|---|
| Capacity | Exactly 2 |
| Lobby expiry | 30 minutes |
| Concurrent open rooms per host | 3 |
| Visibility | `private` (code only) or `public` (listed in Live Games) |
| Post-match retention | Result rows permanent; event log purged after **7 days** |

**SB-ROOM-9** Host controls, in the waiting room: change fighter, toggle visibility private/public, kick the opponent (before ready only), close the room, start.
**SB-ROOM-10** If the host leaves before start, the room closes and the guest is told so plainly, with Quick Match offered.
**SB-ROOM-11** If the host leaves **after** start, it is a forfeit — host status confers no exit privilege once combat has begun.
**SB-ROOM-12** Event logs are purged after 7 days; `shadow_results` is permanent. The log's job is to produce and audit the result, and it has done that by then.

---

## 18. Live games — mechanics

Product behaviour is in §7.4. The security design is the part that needs specifying.

### 18.1 The problem

`0009_battlefield.sql` deliberately refuses to let clients select rooms by PIN: *"a client able to select by pin could walk the code space and harvest live rooms."* `01-PRD.md` §26.7 flags that any public room browser must not reintroduce that vulnerability.

### 18.2 The design

A **public projection that never contains a PIN**.

```sql
-- Conceptual shape. No pin column exists in this projection, by construction.
create view public.shadow_public_rooms as
  select r.id, r.created_at, r.status, r.current_round,
         p.display_name as host_name, p.avatar as host_avatar,
         rt.fr as host_fr, rt.wins, rt.losses
    from public.shadow_rooms r
    join public.shadow_players p on p.room_id = r.id and p.seat = 0
    left join public.shadow_ratings rt on rt.user_id = p.user_id
   where r.visibility = 'public'
     and r.status in ('lobby', 'active')
     and r.expires_at > now();
```

Joining is `shadow_join_public(p_room uuid)` — `SECURITY DEFINER`, which re-checks visibility, status, capacity and expiry under `FOR UPDATE`, then seats the caller. **The code never leaves the server for a public room.** A public room is joined by UUID; a private room is joined by code; neither path can enumerate the other's namespace.

**SB-LIVE-9** The projection exposes no PIN, no user id, no email, no profile settings — the same narrowness `public.leaderboard` (`0005_leaderboard.sql`) already applies for the same reason.
**SB-LIVE-10** `shadow_join_public` is granted to `authenticated` and revoked from `anon`, matching every RPC in `0009`.
**SB-LIVE-11** Room UUIDs are not guessable and are not secrets — the function's own checks are the gate, not the id.
**SB-LIVE-12** A host may flip a room between public and private at any time before start. Flipping to private removes it from the projection immediately.

---

## 19. Progression

### 19.1 XP — extending what exists

`xpForSession` (`src/lib/gamification.js`) already takes a `kind` factor with `code: 1.25` and `battle: 1.15`. Shadow Battle adds one entry `[EXTEND]`:

```js
kind === 'shadow' ? 1.20 : ...
```

Between Battlefield and code: higher-pressure than a race, but the text is ordinary English rather than syntax. **No other change to the XP function.**

On top of the per-match session XP, outcome bonuses:

| Outcome | Bonus XP |
|---|---|
| Match win | +40 |
| Match loss | **+15** |
| Round win | +10 each |
| Flawless round (won taking 0 damage) | +25 |
| Flawless match (2-0, no damage taken) | +60 |
| First match of the day | +20 |

**Losses always pay.** A competitive mode where losing is worth nothing teaches players to stop playing when they are behind, and 55% of matches in a two-player mode are losses by definition. Fifteen XP is small enough that losing is not a strategy and large enough that a session of close losses still moves the level bar.

Bot matches award session XP and the *round*-level bonuses, but **not** match win/loss bonuses — otherwise Recruit is the most XP-efficient content in the product.

### 19.2 Forge Rating

**Elo, K-factor by experience.** Start at **1200**.

```
expected = 1 / (1 + 10^((opponentFR - myFR) / 400))
newFR    = myFR + K * (score - expected)      // score: 1 win, 0.5 draw, 0 loss
```

| Matches played | K | Purpose |
|---|---|---|
| 0–14 | **40** | Placement — converge fast |
| 15–49 | 24 | Settling |
| 50+ | 16 | Stable |

**SB-PRG-1** Rating is computed **server-side only**, inside the settle function, from the authoritative result. Never client-submitted.
**SB-PRG-2** Bot matches and private duels produce **zero** rating change.
**SB-PRG-3** Forfeits count as losses at full K. A player who quits a losing match pays for it, or quitting becomes the correct play.
**SB-PRG-4** A confirmed anti-cheat flag (§21) **freezes** rating change pending review rather than applying and reversing it. Reversals cascade through every subsequent match and are effectively impossible to unwind correctly.
**SB-PRG-5** FR floors at 100. There is no ceiling.

Glicko-2, with rating deviation driving confidence-based matchmaking, is V1. Elo is the MVP because it is understandable by the people it ranks, cheap to compute in plpgsql, and adequate at launch volume. `[FUTURE]`

### 19.3 Rank tiers

Derived from FR, named from the product's existing metallurgical vocabulary — `--accent` is already documented in `src/index.css` as "quenched steel", and the product is called TypeForge.

| Tier | FR | Badge treatment |
|---|---|---|
| **Ember** | < 1000 | Dim orange, unfilled |
| **Cinder** | 1000–1199 | Orange, partial fill |
| **Steel** | 1200–1399 | Neutral, solid |
| **Quench** | 1400–1599 | Accent blue, solid |
| **Tempered** | 1600–1799 | Accent blue, ringed |
| **Damascus** | 1800–1999 | Patterned |
| **Shadowsmith** | 2000+ | Patterned, animated (respects reduced motion) |

Tier is shown; exact FR is available but secondary. A tier is a place you belong to; a number is a thing you check.

### 19.4 Records tracked

Per user, in `shadow_ratings`: FR, peak FR, matches, wins, losses, draws, win rate, current streak, best streak, rounds won/lost, total damage dealt/taken, best chain, best single-hit damage, flawless rounds, parries landed, Overdrives landed, average WPM in combat, average accuracy in combat, clean-word rate.

The last three are the ones that connect Shadow Battle back to the product's actual purpose: **combat performance is reported in typing terms**, so a player can see whether competing is improving their typing. Those three feed the existing `/dashboard` and `/profile` surfaces.

### 19.5 Match history

**SB-PRG-6** Every match — bot and PvP — produces a history row: opponent, outcome, score, rating delta, your WPM/accuracy/clean rate, longest chain, duration, date.
**SB-PRG-7** History is filterable by outcome and opponent type, and shows aggregate WPM/accuracy trends over the last 20 matches.
**SB-PRG-8** History appears both as a Shadow Battle surface and as a section on `/profile`.
**SB-PRG-9** Guest (anonymous) history lives in the local store and merges into the account on sign-in via the existing `src/lib/sync.js` path `[REUSE]`.

---

## 20. Rewards

### 20.1 Principle

> Rewards point at typing improvement, not at time served.

A daily challenge that says *play 10 matches* rewards sitting at a keyboard. One that says *land 20 clean words in a single round* rewards the thing the product exists to develop. Every reward in this section is written the second way.

### 20.2 Achievements — extending the existing array

`ACHIEVEMENTS` in `src/lib/gamification.js` is a flat array of `{ id, name, hint, icon, tier, test(s) }` and already contains three Battlefield entries. Shadow Battle appends to it `[EXTEND]` — same shape, same tiers (`bronze/silver/gold/legend`), same `TIER_STYLES`, rendered by the existing `/achievements` surface with no changes.

| id | Name | Condition | Tier |
|---|---|---|---|
| `shadow-first` | Into the Dark | Finish a Shadow Battle | bronze |
| `shadow-win` | First Shadow | Win a Shadow Battle | bronze |
| `shadow-flawless` | Untouched | Win a round without taking damage | silver |
| `shadow-parry-10` | Read the Blade | Land 10 parries | silver |
| `shadow-chain-15` | Unbroken Chain | Reach a chain of 15 in one round | gold |
| `shadow-overdrive` | Full Burn | Land an Overdrive for 50+ damage | gold |
| `shadow-comeback` | From the Ashes | Win a match after losing round one | gold |
| `shadow-rank-quench` | Quenched | Reach Quench tier | gold |
| `shadow-rank-damascus` | Folded Steel | Reach Damascus tier | legend |
| `shadow-win-25` | Duellist | Win 25 Shadow Battles | legend |

**SB-RWD-1** Achievement tests are pure functions of saved state, matching every existing entry. This requires Shadow aggregates in the store's derived stats, alongside the existing `battles` / `battleWins` derivations in `src/lib/store.jsx`.

### 20.3 Daily challenges

`MISSION_POOL` + `missionsForDay()` (deterministic per-day pick from a seeded shuffle) is reused as-is `[EXTEND]`. Four Shadow entries are added to the pool:

| id | Label | Goal | XP |
|---|---|---|---|
| `shadow-rounds-3` | Win 3 Shadow rounds | 3 | 60 |
| `shadow-clean-40` | Land 40 clean words in Shadow Battle | 40 | 55 |
| `shadow-parry-3` | Land 3 parries | 3 | 65 |
| `shadow-chain-10` | Reach a chain of 10 | 1 | 50 |

**SB-RWD-2** Shadow missions are satisfiable in Trial mode. A daily challenge that requires an opponent is a challenge that fails when the queue is empty.

### 20.4 Streaks and titles

**Win streaks** (consecutive PvP wins, reset on loss): 3 → +50 XP, 5 → +120 XP and the **Relentless** title, 10 → +300 XP and **Merciless**.

**Titles** are display strings shown beside the name in waiting rooms, results and Live Games. They are earned, cosmetic, and swappable. They sit alongside the existing `levelTitle()` ladder (Tapper → Phantom) rather than replacing it: level title is *how much you have practised*, Shadow title is *what you have done in the arena*.

**SB-RWD-3** No reward is time-gated, login-gated, or expires unclaimed. Daily missions rotate; nothing is lost by not playing on a given day. The product already takes this stance with streaks (a streak counts if you practised today *or* yesterday — `liveStreak()`), and Shadow Battle does not introduce a harsher one.

---

## 21. Anti-cheat

Because typing rate feeds combat, a script that types perfectly wins every rated match. This section is split into what ships and what waits, as the brief requires.

### 21.1 The foundation — server authority

The architecture does most of the work before any detection runs.

| Guarantee | Mechanism |
|---|---|
| HP, damage, Focus, Chain are never client-submitted | Only raw typing facts are (§8.2) |
| A client cannot claim a word it was not shown | `cardIndex` verifies against the seeded queue (§9.4) |
| A client cannot invent time | `tStart`/`tEnd` are bounded by the server's `starts_at` and round deadline |
| A client cannot replay or reorder | `(player, seq)` is unique and monotonic |
| A client cannot write for another player | RLS: `user_id = auth.uid()`, plus the `active_session_id` check (SB-MP-14) |
| A tampered client changes only its own screen | The server's replay is the result |

This is the same stance that makes Battlefield's WPM trustworthy — recomputed server-side, with `client_wpm` retained purely so divergence stays visible in the data. Shadow Battle keeps that trick: the client's locally-computed final HP is stored as `client_hp` and **compared** against the replay. A systematic mismatch is either a cheat or a reducer bug, and both are things you want to see.

### 21.2 MVP detection

Four checks, all cheap, all computed in the settle function.

**1. Per-word plausibility floor**
```
minPlausibleMs(card) = 55 + 18 * chars(card)
```
Roughly 250 WPM on a short word — above any human sustained rate, below scripted input. A single violation flags the event; three in a match flags the match.

**2. Rolling rate ceilings**

| Window | Threshold | Action |
|---|---|---|
| 1 card | > 300 WPM equivalent | flag event |
| 3 consecutive cards | > 220 WPM equivalent | flag match |
| 10 consecutive cards at 100% clean | > 180 WPM equivalent | flag for review |

Bursts are allowed; sustained superhuman rate is not. The current human record is ~216 WPM sustained, so the 3-card gate at 220 sits just above the best documented human performance and well below scripted speed.

**3. Keystroke-interval variance — the signal that actually catches scripts**

Human inter-keystroke intervals are irregular: σ/μ is typically above 0.25 even for expert typists, because bigram difficulty varies. A naive script produces near-constant intervals.

```
if (ikiStdev / ikiMean) < 0.08 across a round  →  flag
```

This is the highest-value MVP check, which is why `ikiStats` is in the event payload. It catches the common case (a script with a fixed or lightly-jittered delay) at essentially zero cost. It does **not** catch a sophisticated script that samples from a recorded human distribution — that is what §21.3 is for, and pretending otherwise would be dishonest.

**4. Impossible transitions**
Events out of sequence, outside the round window, referencing a card index beyond the queue position, or from a non-active session are **rejected**, not flagged. These are not suspicion, they are invalid input.

### 21.3 MVP response

**SB-AC-1** Flags are recorded on the result row in a `flags text[]` column — the same shape `battle_results.flags` already uses.
**SB-AC-2** A flagged match **freezes** rating change for the flagged player pending review (SB-PRG-4). The opponent's rating change applies normally — an innocent player must not be penalised for their opponent's flag.
**SB-AC-3** Flagged matches surface in the existing admin panel (`src/modules/admin/AdminPanel.jsx`) as a review queue with the full event log.
**SB-AC-4** No automated bans in MVP. False positives on a new detection system are certain, and an automated ban is not reversible in the user's memory.
**SB-AC-5** The flagged player is not told which check fired. Telling a cheater the threshold is telling them the workaround.

### 21.4 Advanced — V1 and beyond `[FUTURE]`

| Measure | Notes |
|---|---|
| `event.isTrusted` gate on the combat surface | Rejects naive synthetic `KeyboardEvent` dispatch. **Trivially bypassed** by CDP or a real driver — a speed bump, not a wall. Stated plainly rather than oversold. |
| Paste and IME blocking on the combat input | Cheap, closes an obvious hole |
| Per-account rolling anomaly score across matches | Individual matches are noisy; a distribution over 50 matches is not |
| Typing-signature drift detection | A player's IKI distribution is fairly stable; a sudden shift is a strong signal |
| Rate-limited progressive response | Shadow queue → separate matchmaking pool → rating reset → suspension |
| Community reporting | Only worth building once there is a community |
| Proof-of-work / attestation | Explicitly rejected. High cost, hostile to legitimate users, defeated by determined attackers. |

### 21.5 What is deliberately not attempted

Client integrity checking, obfuscation, and anti-debugging are not attempted. The client is a static bundle served to the user's own machine; treating it as trusted is a category error, and the architecture already assumes it is not. The defence is that **a compromised client cannot affect the recorded result** — only detection of implausible *input* is needed, and that runs on the server.

---

## 22. UI / UX

### 22.1 Design system compliance

Shadow Battle introduces **no new design primitives**. It is built from the tokens in `src/index.css` and `tailwind.config.js`:

| Element | Token |
|---|---|
| Your side, your fighter, your bars | `--brand` / `brand-solid` / `brand-wash` |
| Opponent side | `--accent` / `accent-wash` |
| Damage, low health, critical | `--bad` |
| Heal, clean word, round win | `--good` |
| Focus meter | `--warn` |
| Surfaces | `bg`, `surface`, `raised`, `line`, `line-strong` |
| Elevation | `e0`–`e4` only |
| Radius | `xs`–`2xl` only |
| Card text | `font-mono` at `type-l` (22px / 2) — the same face and scale as every other typing surface |
| Numbers | `font-mono`, `tnum` |
| Headings | `font-display` (Space Grotesk) |
| Motion | `DUR` + `EASE` from `src/lib/motion.js`; only `transform` and `opacity` animate |

**SB-UI-1** Every colour used in the combat HUD passes `scripts/check-contrast.mjs` in both themes. The script is extended to cover the new tokens; a failure blocks the build, as it does today.
**SB-UI-2** No arbitrary Tailwind values. The spacing scale is closed by design (`tailwind.config.js`) and Shadow Battle does not open it.
**SB-UI-3** Both themes are fully supported. Dark is primary; the arena's heat gradient is re-derived for light rather than dimmed.

### 22.2 Screen inventory

Seventeen screens. Routes in bold are real routes; the rest are phases of a route, following the pattern `BattleRoom.jsx` already establishes — *the phase is a function of the room's durable status, so a refresh reconstructs the right screen rather than trusting a URL that can disagree with the room.*

| # | Screen | Route / phase | Purpose |
|---|---|---|---|
| 1 | **Shadow Battle landing** | **`/shadow`** | Mode entry, your record, fighter, resume |
| 2 | Mode selection | `/shadow` (same screen) | Four cards; not a separate step |
| 3 | Trial setup | `/shadow/trial` | Bot profile choice |
| 4 | Finding opponent | `/shadow/find` | Queue states (§7.2) |
| 5 | Opponent found | `/shadow/find` phase | Accept / decline |
| 6 | Create private duel | `/shadow/create` | Settings, then code + link |
| 7 | Join with code | `/shadow` panel | Six-character entry |
| 8 | Live games | **`/shadow/live`** | Public room browser |
| 9 | Waiting room | **`/shadow/:code`** phase `lobby` | Roster, fighter swap, ready, start |
| 10 | Countdown | `/shadow/:code` phase `countdown` | 3 · 2 · 1 · FIGHT |
| 11 | **Live battle** | `/shadow/:code` phase `active` | The game (§25) |
| 12 | Paused / disconnected | `/shadow/:code` overlay | Grace countdown, leave |
| 13 | Round card | `/shadow/:code` phase `round_end` | Round result + typing feedback |
| 14 | Victory | `/shadow/:code` phase `result` | Win state |
| 15 | Defeat | `/shadow/:code` phase `result` | Loss state |
| 16 | Draw | `/shadow/:code` phase `result` | Draw state |
| 17 | Match history | **`/shadow/history`** | Record, trends, past matches |

Trial runs at `/shadow/trial` through the same phase machine with a local room object, so screens 10–16 have exactly one implementation.

### 22.3 The landing screen — the most important screen in the mode

This screen decides whether a curious visitor ever fights anything.

```
┌───────────────────────────────────────────────────────────────────┐
│  SHADOW BATTLE                          Steel · 1284 FR · 12–7 W  │
│  Type to strike. Type to survive.                                 │
├───────────────────────────────────────────────────────────────────┤
│                                                                    │
│   ┌──────────────────────────┐  ┌──────────────────────────┐      │
│   │  ▶  FIGHT A BOT          │  │  ⚔  FIND OPPONENT        │      │
│   │     No account. Instant. │  │     Ranked · ~14s wait   │      │
│   │     [ Adept ▾ ]          │  │                          │      │
│   └──────────────────────────┘  └──────────────────────────┘      │
│                                                                    │
│   ┌──────────────────────────┐  ┌──────────────────────────┐      │
│   │  ⬡  PRIVATE DUEL         │  │  ◉  LIVE GAMES      (7)  │      │
│   │     Invite a friend      │  │     Join an open duel    │      │
│   └──────────────────────────┘  └──────────────────────────┘      │
│                                                                    │
│   Join with code   [ _ _ _ _ _ _ ]                    → Join      │
│                                                                    │
├───────────────────────────────────────────────────────────────────┤
│  Your fighter: Ash ▾        Last: W 2–1 vs. Kestrel   History →   │
└───────────────────────────────────────────────────────────────────┘
```

**SB-UI-4** **Fight a bot** is the visually dominant action, positioned first. It is the only action with a zero-latency, zero-account, zero-dependency path to combat, and §4.3 turns on it.
**SB-UI-5** The queue estimate on **Find Opponent** is real, derived from recent match times, or absent. A fabricated estimate is worse than none.
**SB-UI-6** Live Games shows a live count. Zero shows as *"No open duels — open one"*, never as an empty badge.
**SB-UI-7** With cloud unconfigured or offline, the three PvP cards are visibly disabled with the reason stated, and Trial remains fully functional. The mode never renders as broken because the network is down.
**SB-UI-8** A match already in progress shows a persistent **Resume** banner at the top. Losing a rated match to a forgotten tab is the worst avoidable outcome in the mode.

### 22.4 Waiting room

Two fighter panels facing each other across the arena, in their final side colours, so the fight is legible before it starts.

- **Host panel:** name, avatar, tier badge, record, fighter, ready state
- **Guest panel:** the same, or an empty slot with the code and share controls
- **Centre:** the room code at 48px mono, **Copy code**, **Copy link**, **Share** (where supported)
- **Footer:** `Best of 3 · 100 HP · 90s rounds · Ranked/Unranked`, stated explicitly
- **Host action:** **Start**, disabled with its reason until both are ready
- **Guest action:** **Ready** toggle

**SB-UI-9** Opponent arrival is announced visually *and* via `aria-live="polite"`, and is impossible to miss — a host watching the code should not have to check whether someone joined.
**SB-UI-10** Fighter can be changed here. This is the free time (§6.1).
**SB-UI-11** Connection state per player, using the same honest treatment Battlefield uses: stated, not silently degraded.

### 22.5 Result screens

Victory, defeat and draw share one layout and differ in tone, colour and copy — not in information. A loss screen that hides the numbers is a loss screen people close immediately.

```
┌───────────────────────────────────────────────────────────────────┐
│                           VICTORY                                  │
│                      2 – 1  vs. Kestrel                            │
│                                                                    │
│   Forge Rating   1284 → 1301   (+17)      Quench in 99 FR         │
│   XP             +112                      Level 14 · 62%          │
│                                                                    │
│   ┌── Your combat ───────────┬── Kestrel ──────────────┐          │
│   │ WPM            74  ▲ +6  │ WPM            81       │          │
│   │ Accuracy    97.2%  ▲+1.1 │ Accuracy    94.0%       │          │
│   │ Clean words    88%       │ Clean words    79%      │          │
│   │ Longest chain   12       │ Longest chain    7      │          │
│   │ Damage dealt   214       │ Damage dealt   187      │          │
│   │ Parries          3       │ Parries          0      │          │
│   └──────────────────────────┴─────────────────────────┘          │
│                                                                    │
│   You were slower and won. Accuracy and three parries did it.     │
│                                                                    │
│   [ Rematch ]   [ Next opponent ]   [ Leave ]                     │
└───────────────────────────────────────────────────────────────────┘
```

**SB-UI-12** The `▲/▼` deltas compare against the player's **own 30-day baseline**, not against the opponent. The competitive frame is the match; the improvement frame is yourself.
**SB-UI-13** One plain-language sentence explains the deciding factor. This is the mechanism behind G2 and it is a P0 requirement, not decoration. It is generated from the match's own aggregates by a small rule set (largest contributing differential wins), never by a model — it must be instant and it must be true.
**SB-UI-14** Defeat states name what to work on, drawn from the same aggregates: *"Your accuracy dropped to 91% in round three. Chain breaks cost you about 40 damage."*
**SB-UI-15** No modal blocks the result. `Esc` and **Leave** always work.
**SB-UI-16** Confetti is not used. The product replaced it with `forge-sweep` (`tailwind.config.js`) — one sweep across the result, then gone. Shadow Battle uses the same.

---

## 23. Sidebar integration

### 23.1 The nav constraint, verified

`AppShell.jsx` documents a hard ceiling and the reason: *"The mobile tab bar renders each entry with `flex-1`, so at 360px a ninth item would give every tab 40px — eight is a hard ceiling."*

`NAV_GROUPS` currently holds **six** items across two groups. Adding Shadow Battle makes **seven**. Within budget, with one slot left.

### 23.2 The entry

```js
// AppShell.jsx — NAV_GROUPS, 'Compete' group
{ to: '/shadow', label: 'Shadow Battle', short: 'Shadow', icon: ShadowMark },
```

Placed in **Compete**, immediately after `Battle`, so the two competitive modes sit together and the pairing reads as a choice between them.

**SB-NAV-1 — the `short` field is required, not optional.** At 360px with seven tabs each item gets ~50px; "Shadow Battle" at `text-[10px]` needs roughly 68px and would wrap or clip. `NAV` entries gain an optional `short` used by the mobile tab bar, falling back to `label`. This is a small, real schema change to `NAV_GROUPS` and it must not be discovered during QA.

**SB-NAV-2** Label is **"Shadow Battle"**, not "Battle" or "Combat". "Battle" is taken by Battlefield, and two nav items that both say Battle is the clearest possible way to make a product feel unfinished. Shadow Battle is also the stronger identity — it names the fiction, not the genre.

### 23.3 The icon

**SB-NAV-3** An original mark, `src/components/brand/ShadowMark.jsx`, built the way `Logo.jsx` is built: expressed in a 0–100 box, scaled by `viewBox`, so a 17px tab-bar glyph and a 96px hero mark are the same shape rather than two drawings that drifted apart.

**Form:** two opposed angular blades meeting at a caret-like apex, echoing the TypeForge caret in `Logo.jsx` while reading as conflict. Rendered as strokes at `strokeWidth: 2.1`, matching every other rail icon, with a filled variant for the active state. No lucide icon is reused — `Swords` belongs to Battlefield, and a distinct mode deserves a distinct mark.

**Design constraints:** legible at 17px; distinguishable from `Swords` at 17px in peripheral vision (this is the actual art-review test); works as a single flat colour; no interior detail below 24px.

### 23.4 States

| State | Treatment |
|---|---|
| Default | `text-ink-3`, stroke variant |
| Hover | `bg-subtle`, `text-ink-2` |
| Active | `text-ink` + the shared `layoutId="nav-active"` pill `[REUSE]` — the same spring the existing rail uses, so the indicator slides between items rather than jumping |
| Match in progress | A **`--brand` dot** on the icon corner, plus `aria-label` "Shadow Battle, match in progress" |
| Queued | The same dot, pulsing (static under reduced motion) |
| Cloud unavailable | Normal. The item never disables — Trial always works. |

**SB-NAV-4** The in-progress dot is the mechanism behind SB-UI-8, and it must be visible in the collapsed rail, the expanded rail and the mobile tab bar.

### 23.5 Command palette and mobile

**SB-NAV-5** `CommandPalette.jsx` gains entries for *Shadow Battle*, *Fight a bot*, *Find opponent*, *Create private duel*, *Live games*, *Match history* — derived from the mode registry (`01-PRD.md` §25 MR-3), not hand-added, so the registry requirement is exercised rather than bypassed.
**SB-NAV-6** On mobile the tab item is present and functional; it routes to a surface that offers history, record and Trial-on-desktop guidance (§29). The nav item is never hidden — a missing item reads as a broken build.

---

## 24. Game feedback

### 24.1 Feedback table

Every state gets a visual channel and, where useful, an audio channel. **No state is communicated by colour alone** (§32).

| Event | Visual | Audio | Haptic |
|---|---|---|---|
| Correct character | Glyph fills to `--ink`, caret advances | Soft key click (`sfx.key`) `[REUSE]` | — |
| Incorrect character | Glyph turns `--bad` + underline; caret holds | `sfx.error` `[REUSE]` | — |
| Word completed | Card collapses toward the fighter, 140ms | Move-specific | — |
| Whiff | Both cards shake 3px, 90ms | Dull thud | — |
| Card expired | Card dissolves, `STAGGER` label | Descending tone | — |
| Light attack lands | Fighter lunges, impact spark, damage numeral | Sharp snap | — |
| Heavy attack lands | Screen shake 60%, larger spark, wider numeral | Deep impact | ✓ |
| **Critical** | White flash 80ms, `CRIT` label, numeral 1.6x, radial burst | Distinct two-note hit | ✓ |
| Blocked | Impact stops at a ring, `BLOCKED` label, reduced numeral | Metallic clang | — |
| **Parry** | Bright deflection spark, `PARRY` label, damage numeral travels back to the attacker | The most distinctive sound in the game | ✓ |
| Dodged/evaded (V1) | Silhouette after-image | Whoosh | — |
| Chain milestone (5, 10) | Numeral flashes once, arc completes | Ascending pip | — |
| Overdrive charging | Arena dims to 40%, fighter outline brightens | Rising tone | — |
| Overdrive lands | Full-width strike, 200ms hold, largest numeral | Sustained impact | ✓ |
| Mend | Warm pulse, green numeral with `+` | Soft chime | — |
| Damage taken | HP bar drops with a 200ms trailing ghost showing what was lost | Impact from the correct side | ✓ |
| Low health (<=25) | Bar pulses, vignette tightens, `LOW` label | Low tone enters the bed | — |
| Round won | Fighter pose, `ROUND` banner, score pip fills | Round chime | — |
| Round lost | Fighter falls, muted banner | Descending tone | — |
| Victory | `forge-sweep` across the result | Victory motif | — |
| Defeat | Slow fade to the result | Quiet resolve | — |
| Level up / achievement | Existing toast + badge `[REUSE]` | Existing | — |

**SB-FB-1** Damage numerals rise 24px over 500ms and fade. They never overlap the card area, and they are capped at three concurrent — beyond that, they merge into a single accumulating numeral. Uncapped floating numbers is the most common way a combat HUD becomes unreadable.
**SB-FB-2** Audio reuses `src/lib/sound.js` `[EXTEND]` — same synthesis approach, same global mute, same volume. No audio files are added; every cue is synthesised, keeping the bundle unchanged.
**SB-FB-3** Audio is **off by default** and respects the existing sound setting. Combat is not an argument for surprising someone with noise.
**SB-FB-4** Haptics fire only on `navigator.vibrate` where supported and only for the four marked events. Anything more is noise.
**SB-FB-5** No feedback effect may occlude the card text, the caret, or either HP bar. This is an art-review gate.

### 24.2 Reduced motion

`useReducedMotionSafe()` (`src/lib/motion.js`) governs everything. The module's own rule holds: *"Reduced motion means reduce, not remove."*

| Full motion | Reduced motion |
|---|---|
| Fighter interpolates between poses | Fighter **snaps** between poses — combat stays fully legible |
| Screen shake | **Removed entirely** |
| Damage numerals rise and fade | Fade in place |
| Arena dim on Overdrive | Instant step, no ramp |
| Chain arc animates | Steps to its new value |
| HP bar animates down | Steps, with the trailing ghost held 200ms so the loss is still visible |
| Radial burst on crit | Single-frame flash |
| Trails and after-images | Not rendered |
| Rank badge animation (Shadowsmith) | Static |

**SB-FB-6 — Reduced motion must not change a single game value.** Not damage, not timing, not card duration, not readability of any state. It is an accessibility requirement and, equally, an anti-cheat one: if reduced motion conferred any advantage, it would become mandatory at high level.

### 24.3 Calm Combat

**SB-FB-7** A **Calm Combat** toggle disables the arena render entirely. The fighters, arena and all combat effects are replaced by a compact state readout: both HP bars, both Focus meters, both chains, the card pair, and a text event log (*"Kestrel — Slash — 12 blocked"*).

Three things at once:

1. The strongest accessibility option in the mode — no motion, no colour dependency, no visual parsing under time pressure.
2. The low-end-device path (§30.4).
3. **A structural proof that the arena never affects gameplay.** If Calm Combat is competitively identical — and it must be — then the render provably cannot influence outcomes. It is a testable invariant, not a promise.

---

## 25. The live battle screen

### 25.1 The governing constraint

> **The card text is the only thing the eye must track. Everything else must be readable in peripheral vision without a saccade.**

Every layout decision below follows from that. The layout sketched in the brief puts the fighters between the HUD and the typing area, which forces the eye to travel over the animated region on every glance at the health bars. This design does not do that.

### 25.2 Layout

```
┌─────────────────────────────────────────────────────────────────────────┐
│ ①  YOU  Ash                              R1 ●○   90s   Kestrel  Steel   │ 56px
│    ██████████████████░░░  78            ⏱          64  ░░░████████████  │
│    ▓▓▓▓▓▓▓▓░░░░░░░  focus 42        chain x6       x2  focus 71 ░░░▓▓▓  │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│ ②                        ~ SHADOW ARENA ~                          38vh  │
│                                                                          │
│        ╱▚                                                    ▟╲         │
│       ▟█▛   ◀── brand-coloured (you)      (opponent) ──▶     ▜█▙        │
│      ╱  ╲                                                    ╱  ╲       │
│  ────────────────────────────────────────────────────────────────────   │
│                                                                          │
├─────────────────────────────────────────────────────────────────────────┤
│ ③  ┌──── STRIKE ─────────────┐   ┌──── GUARD ──────────────┐            │
│    │ ⚔ SLASH        base 10  │   │ ⛨ PARRY      reflect    │            │
│    │                          │   │                          │            │
│    │      t h r e s h o l d   │   │        v e i l           │            │
│    │      ▔▔▔▔▔▔▔             │   │                          │            │
│    │ ▰▰▰▰▰▰▰▰▱▱▱▱▱▱ 1.4s     │   │ ▰▰▰▰▰▰▰▰▱▱▱▱▱▱          │            │
│    └──────────────────────────┘   └──────────────────────────┘            │
│                                                                          │
│ ④   74 WPM      97% ACC      88% CLEAN        ▰▰▰▰▱ Kestrel typing      │
└─────────────────────────────────────────────────────────────────────────┘
```

**Four bands, each with one job:**

① **Status bar** (56px, fixed) — everything about *state*. Both HP bars, both Focus meters, both chains, round pips, clock. Symmetric: yours left and `--brand`, theirs right and `--accent`. Read without looking away from band ③, because it is a fixed distance above it and never moves.

② **Arena** (38vh, clamped 220–420px) — everything about *drama*. Fighters, effects, damage numerals. **Nothing here is required to play.** This is the band Calm Combat removes.

③ **Card pair** (fixed height) — everything about *action*. The two cards, side by side, at the visual centre of attention. This band never moves, never resizes, and never has anything animate across it.

④ **Telemetry strip** (32px) — your live WPM, accuracy, clean rate, plus the opponent's card-progress bar.

### 25.3 The status bar in detail

Each side carries, in a fixed order that never reflows:

| Element | Treatment |
|---|---|
| HP bar | Full-width segment, integer value in `tnum` mono. A 200ms trailing ghost shows what was just lost. |
| Focus meter | Thinner bar, `--warn`. At 100 it gains a solid ring and an `OVERDRIVE` label. |
| Chain | `x6` numeral with a completion arc, capped at 10. |
| Name, fighter, tier | Small, static, so the opponent is a person rather than a bar. |
| Connection dot | Green / amber / red. Amber and red carry text on hover and in the a11y tree. |

**SB-BS-1** The opponent's Focus meter is fully visible. Overdrive must be telegraphed, or the counterplay in §10.2 does not exist.
**SB-BS-2** Nothing in this band ever changes size or position. A meter that grows shifts its neighbours and pulls the eye off the card.

### 25.4 The card pair in detail

Each card shows:

- **Move name and icon** — so the mapping is never memorised
- **Its consequence in three words** — `base 10`, `reflect`, `halve incoming`, `+12 hp`
- **The word**, `font-mono` at `type-l` (22px, line-height 2), letter-spaced, using the exact per-character treatment the rest of the product uses (`TypingStage.jsx` conventions: pending `ink-3`, correct `ink`, wrong `bad` + underline, caret block) `[REUSE]`
- **A deadline bar** draining left to right, with the remaining seconds
- **The `committed` marker** on Crush, Mend and Overdrive — a corner glyph plus the word `COMMITTED`, because the risk must be visible *before* you commit, not discovered afterwards

**On commit,** the unchosen card dims to 25% and shrinks 4% over 120ms. It **does not unmount** — a card vanishing shifts the layout, and layout shift under the caret is unacceptable. The chosen card gains a `--brand` border and its lane label brightens.

**SB-BS-3** The first character of each word is visually emphasised (slightly heavier weight) because it is the commit key. This teaches the control without a tutorial.
**SB-BS-4** The opponent's card-progress bar (band ④) shows **fill and width** — width is proportional to their card's length, so a long bar filling slowly is a visible Crush tell. It never shows their word text.
**SB-BS-5** Cards are never re-laid-out mid-word. The pair is sized for the longest possible card at that band, and short cards are centred in the reserved space.

### 25.5 The arena in detail

- Two silhouettes, side-facing, at fixed positions. **No movement between positions** — there is no positional game (NG1), so fighters animate in place: poses, strikes, recoils, guards, falls.
- One flat ground line with a heat gradient beneath it, derived from `--brand-wash` in dark and a warm neutral in light.
- Damage numerals originate at the impact point and rise. Capped at three concurrent (SB-FB-1).
- **The arena is 38vh and clamps to 420px.** On a 13" laptop at 768px viewport height this yields ~290px of arena and leaves the card band comfortably above the fold. Verified against the smallest supported viewport (§29).

**SB-BS-6** No arena effect may extend into bands ① or ③. The arena is clipped to its own band.
**SB-BS-7** Fighters are rendered on `<canvas>` (§30.2). The canvas is `aria-hidden="true"`; all state it depicts is present in the DOM elsewhere.

### 25.6 Focus and input

**SB-BS-8** Keystrokes are captured at the document level while the battle phase is active, exactly as `useTypingEngine`'s `onKeyDown` contract expects. There is no input to click into and no way to lose focus by clicking the arena.
**SB-BS-9** `Shift+Tab` is **not** consumed — preserving the existing WCAG 2.1.2 escape (`useTypingEngine.js`). A keyboard-only player must always be able to leave the surface.
**SB-BS-10** `Esc` opens a leave confirmation. It does not pause. A single-player pause in a two-player match is not a thing that can exist.
**SB-BS-11** Browser find (`⌘F`/`Ctrl+F`), zoom and reload are not intercepted.
**SB-BS-12** Paste is blocked on the combat surface, and blocking is stated once via a toast rather than silently swallowing the keystroke.

### 25.7 Responsive behaviour

| Width | Layout |
|---|---|
| ≥1280px | As drawn. Arena 38vh. |
| 1024–1279px | Identical; arena clamps to 300px. |
| 768–1023px | Cards stack **only if** both exceed 12 characters; arena drops to 26vh. |
| <768px with a physical keyboard | Arena collapses to a 96px strip of HP bars and fighter poses; cards fill the rest. |
| <768px touch-only | Not playable — see §29. |

**SB-BS-13** The card band never scrolls. If content cannot fit, the arena shrinks first, then the telemetry strip is dropped, then the status bar compacts. **The cards are the last thing to give.**

---

## 26. Backend requirements

### 26.1 Constraints inherited

- Static Vite bundle on Vercel. No application server. **Postgres is the server** (`src/lib/battle/api.js`).
- The only trusted compute is plpgsql, so `SECURITY DEFINER` RPCs *are* the API.
- No client write path may exist where an RPC will do. `0009_battlefield.sql`: *"leaving no client-side write path is what makes that true by construction rather than by convention."*
- Every RPC is `revoke execute … from public, anon` then `grant … to authenticated`.
- `0009_battlefield.sql` is **not modified**. Shadow Battle ships as `0010_shadow_battle.sql`.

### 26.2 Why separate tables rather than a `mode` column on `battle_rooms`

`01-PRD.md` §17.2 already documented the mismatch, and inspection confirms it: `battle_rooms.passage_chars` is `NOT NULL`, its status `CHECK` does not contain combat states, `max_players` semantics differ, and its RLS is shaped around a shared-passage race. Widening a working, security-reviewed system to accommodate a different game risks regressing the mode that is live today, for the benefit of sharing four columns.

Shadow Battle therefore shares **patterns and helper functions**, not tables: the same `SECURITY DEFINER` discipline, the same scope-helper shape, the same revoke/grant posture, the same reaper approach, and a *generalised* PIN minter (SB-ROOM-1) so codes remain unique across the product.

The mode registry (`01-PRD.md` §25) is a product-level abstraction over modes. It does not require one physical table, and SC-A3 explicitly requires that room concepts not be hardcoded to "one shared passage, everyone finishes" — which separate tables satisfy directly.

### 26.3 Entities

Six tables. Each justified; two candidates deliberately rejected.

**`shadow_rooms`** — the room *and* the match. Merged because a room hosts exactly one match and a rematch mints a new room (SB-RND-1); a separate `matches` table would be 1:1 with `rooms` for the whole lifecycle.

```
id uuid pk · pin text · host_id uuid · visibility 'private'|'public'
status text check (lobby|countdown|active|round_end|paused|finished|abandoned|cancelled|expired)
seed bigint · word_table_version int · band text · rated boolean
current_round int · score_p0 int · score_p1 int
starts_at · round_starts_at · round_deadline_at · paused_at · pause_ms_total int
created_at · updated_at · expires_at
```

**`shadow_players`** — the two seats.

```
room_id uuid · user_id uuid · seat int check (seat in (0,1))
display_name text · avatar text · fighter_id text      -- snapshotted at join
is_host boolean · ready boolean · active_session_id uuid
connection text (connected|unstable|disconnected) · last_seen_at
joined_at · left_at
pk (room_id, user_id) · unique (room_id, seat)
```

Display name and avatar are **snapshotted at join**, exactly as `battle_players` does and for the same reason: `profiles` is owner-readable only, and loosening that policy to render a roster would expose goal settings and streak history to strangers.

**`shadow_events`** — the append-only combat log. **The source of truth.**

```
room_id uuid · seat int · seq int · round int
card_index int · lane text · outcome text
t_start int · t_end int · keystrokes int · errors int
iki_mean real · iki_stdev real
created_at
pk (room_id, seat, seq)
```

Insert-only. No update policy, no delete policy. `pk (room_id, seat, seq)` makes replay idempotent for free.

**`shadow_rounds`** — per-round outcome.

```
room_id uuid · round int · winner_seat int null    -- null = draw
hp_p0 int · hp_p1 int · reason text (knockout|time|forfeit|double_ko)
duration_ms int · settled_at
pk (room_id, round)
```

**`shadow_results`** — immutable match result, one row per player.

```
room_id uuid · user_id uuid · seat int
outcome text (win|loss|draw|forfeit) · rounds_won int · rounds_lost int
damage_dealt int · damage_taken int · best_chain int
wpm real · accuracy real · clean_rate real · client_hp int
fr_before int · fr_after int · fr_delta int
opponent_kind text (human|bot) · bot_profile text null
flags text[] default '{}' · created_at
pk (room_id, user_id)
```

`client_hp` mirrors `battle_results.client_wpm` — kept purely so divergence from the server replay stays visible in the data rather than being silently discarded.

**`shadow_ratings`** — one row per user.

```
user_id uuid pk · fr int default 1200 · peak_fr int default 1200
matches int · wins int · losses int · draws int
streak int · best_streak int
rounds_won int · rounds_lost int
damage_dealt bigint · damage_taken bigint
best_chain int · parries int · overdrives int
avg_wpm real · avg_accuracy real · clean_rate real
updated_at
```

**`shadow_unlocks`** — earned cosmetics.

```
user_id uuid · fighter_id text · unlocked_at
pk (user_id, fighter_id)
```

Plus **`shadow_queue`** (§16.1), which is transient infrastructure rather than a domain entity.

### 26.4 Row-level security

Directly modelled on `0009`:

| Table | Policy |
|---|---|
| `shadow_rooms` | Members read (`in_shadow(id)` or `host_id = auth.uid()`); admins read all. **No insert/update/delete policy at all.** |
| `shadow_players` | Members read. One narrow update policy: own row, `ready` and `fighter_id` only, lobby only. |
| `shadow_events` | Members read. Insert **only** through `shadow_event_append`. |
| `shadow_rounds` | Members read. No write policy. |
| `shadow_results` | Own rows read; members read for the shared room; admins read all. No write policy. |
| `shadow_ratings` | Own row read. Public tier/FR exposed only through the Live Games projection and a `shadow_leaderboard` view (`0005` pattern). |
| `shadow_unlocks` | Own rows, read and no direct write. |
| `shadow_public_rooms` | View, definer's rights, `select` to `authenticated` (§18.2). |

`in_shadow(room uuid)` and `is_shadow_host(room uuid)` are `SECURITY DEFINER` for the same reason `in_battle` and `is_admin` are: a policy on `shadow_players` that reads `shadow_players` re-enters itself.

### 26.5 RPC surface

| Function | Purpose |
|---|---|
| `arena_server_time()` | Clock handshake (generalised from `battle_server_time`) |
| `arena_mint_pin()` | Unique across both modes (SB-ROOM-1) |
| `arena_code_lookup(pin)` | Returns `{mode, room_id}` — the shared join box |
| `shadow_create(visibility, fighter_id, rated)` | Mints a room |
| `shadow_join(pin)` | Join by code |
| `shadow_join_public(room)` | Join from Live Games (§18.2) |
| `shadow_set_ready(room, ready)` | Ready toggle |
| `shadow_set_fighter(room, fighter_id)` | Lobby only |
| `shadow_start(room)` | Host only; writes `starts_at` **inside Postgres** |
| `shadow_event_append(room, events jsonb[])` | Batched append; validates session, sequence, window, card index |
| `shadow_heartbeat(room)` | Presence + pause detection |
| `shadow_pause(room)` / `shadow_resume(room)` | Room-level pause (SB-MP-9) |
| `shadow_settle_round(room, round)` | Replays the reducer; writes `shadow_rounds` |
| `shadow_settle_match(room)` | Writes `shadow_results`, applies rating, runs anti-cheat |
| `shadow_forfeit(room)` | Explicit quit |
| `shadow_leave(room)` | Lobby only |
| `shadow_close(room)` | Host closes a lobby |
| `shadow_matchmake()` | Queue step (§16.1) |
| `shadow_enqueue()` / `shadow_dequeue()` | Queue lifecycle |
| `shadow_reap()` | Expiry sweep |
| `shadow_match_history(limit, offset)` | Paged history |

**SB-BE-1** Every one of the above is `revoke execute … from public, anon; grant … to authenticated`, matching `0009` exactly. Internal functions (`shadow_settle_*`, `shadow_reap`, `arena_mint_pin`) are additionally revoked from `authenticated`.
**SB-BE-2** `shadow_start` writes `starts_at` server-side. It is unreachable from a browser, and that is what makes every timestamp in the event log worth anything.
**SB-BE-3** `shadow_event_append` rejects — not flags — events failing any structural check (§21.2 item 4).
**SB-BE-4** `shadow_settle_round` is **idempotent**. A retry after a flaky response must not double-settle. `on conflict do nothing`, as `battle_finish` does.
**SB-BE-5** Settlement is triggered by whichever client first observes the terminating condition, with `shadow_reap` as the backstop for rooms whose clients both vanished. Nobody owns the transition, because there is no timer process to own it — this is the same stance `useBattleRoom.js` takes for `countdown → active`.

### 26.6 Entities deliberately *not* created

The brief lists thirteen candidate entities. Six survive as tables. The rest:

| Candidate | Disposition |
|---|---|
| `Game` | Not an entity. The mode registry is a client-side constant. |
| `Match` | Merged into `shadow_rooms` (§26.3). |
| `Fighter` | **Client-side constant.** Only `shadow_unlocks` persists. The catalog ships with the client regardless; a table would exist to be read once. (SB-FTR-6) |
| `Move` | **Client-side constant**, shared with the plpgsql reducer as a literal table in the function body. Eight rows that change only on deploy are not data. |
| `WordChallenge` | **Not stored.** `derive(seed, index)` (§9.4). Storing ~250 cards per match to re-read them once would be pure waste, and a stored card is a card a client could dispute. |
| `PlayerState` | **Derived.** HP, Focus and Chain are outputs of the reducer, never rows. Storing them would create a second source of truth that can disagree with the log. |
| `CombatEvent` | Is `shadow_events`. |
| `BotProfile` | **Client-side constant.** Bots exist only within one client's session; a bot match writes one `shadow_results` row with `opponent_kind='bot'` and `rating_delta=0`. |
| `LeaderboardEntry` | A **view** over `shadow_ratings`, following the `0005_leaderboard.sql` pattern: display name and figures only, no ids, no settings. |
| `BattleRating` | Columns on `shadow_ratings`. A separate table would be 1:1 with it. |

### 26.7 Realtime

`0009` added `battle_rooms`, `battle_players` and `battle_results` to the `supabase_realtime` publication. `0010` adds `shadow_rooms`, `shadow_players`, `shadow_rounds` and `shadow_events`.

`shadow_events` is deliberately included so that Broadcast loss degrades to a slower but correct path (SB-MP-3).

**SB-BE-6** The Broadcast topic is the room **UUID**, never the code — the same rule `useBattleRoom.js` states: *"anyone who overheard one could otherwise subscribe to the telemetry of a room they were refused entry to."*

### 26.8 Retention

| Data | Retention |
|---|---|
| `shadow_events` | 7 days, then purged |
| `shadow_rooms`, `shadow_players` | 30 days after finish |
| `shadow_rounds` | 30 days |
| `shadow_results` | Permanent |
| `shadow_ratings`, `shadow_unlocks` | Permanent |
| `shadow_queue` | 90 seconds without a heartbeat |

---

## 27. Game state

### 27.1 The authoritative state

`shadow_rooms.status` is the authority. It is durable, so — following the pattern `BattleRoom.jsx` already establishes — **the screen is a function of the status**, not of the URL. A refresh mid-match reconstructs the correct phase rather than trusting a path that can disagree with the room.

Combat state within a round (HP, Focus, Chain, guard windows) is **never stored**. It is `reduce(initial, events)` (§8.1), so there is exactly one source of truth and no possibility of the two disagreeing.

### 27.2 States

| State | Meaning | Input gated? |
|---|---|---|
| `lobby` | Room open, waiting for two ready players | n/a |
| `countdown` | Both ready, `starts_at` written | **Yes** |
| `active` | A round is running | No |
| `round_end` | Round settled, inter-round card showing | **Yes** |
| `paused` | A player is disconnected within grace | **Yes** |
| `finished` | Match settled, results written | n/a |
| `abandoned` | Both players gone; no result | n/a |
| `cancelled` | Closed before start | n/a |
| `expired` | Reaped from lobby after 30 minutes | n/a |

Client-only states, not persisted: `matching` (in queue), `found` (accept/decline), `connecting` (handshake).

### 27.3 Transition table

| From | To | Trigger | Actor | Guard | Side effect |
|---|---|---|---|---|---|
| — | `lobby` | `shadow_create` | Host | < 3 open rooms | Mint code, seat 0, seed, band |
| `lobby` | `lobby` | `shadow_join` / `shadow_join_public` | Guest | Not full, not expired, not self | Seat 1 created |
| `lobby` | `lobby` | `shadow_set_ready` | Either | — | Broadcast roster |
| `lobby` | `countdown` | `shadow_start` | Host | 2 players, both ready | **`starts_at = now() + 3.5s`, written in Postgres** |
| `lobby` | `cancelled` | `shadow_close` / host leaves | Host | Not started | Guest notified |
| `lobby` | `expired` | `shadow_reap` | System | `expires_at < now()` | — |
| `countdown` | `active` | `starts_at` reached | First client past it | — | Round 1 begins; input ungated |
| `active` | `round_end` | HP ≤ 0, or 90s cap | First client to observe | `shadow_settle_round` | Reducer replay → `shadow_rounds` |
| `active` | `paused` | Heartbeat lost | System | Pauses used < 2 | Clocks stop; `paused_at` set |
| `paused` | `active` | Reconnect within 20s | Returning player | — | 2s re-entry countdown; `pause_ms_total` += |
| `paused` | `finished` | Grace expires | System | — | Forfeit; remaining rounds awarded |
| `round_end` | `countdown` | 8s elapsed or both ready | System / players | Neither at 2 wins | Next round; 2.0s countdown |
| `round_end` | `finished` | A player has 2 round wins | System | — | `shadow_settle_match` |
| `round_end` | `countdown` | Sudden death entered | System | 1–1–1 or 5 rounds | HP 40, Focus 50, ×1.25 |
| `active` | `finished` | `shadow_forfeit` | Either | — | Forfeit result; full-K rating loss |
| `active`/`paused` | `abandoned` | Both gone > 60s | `shadow_reap` | — | No result, no rating change |
| `finished` | — | terminal | — | — | Results immutable |

**SB-ST-1** Every transition is a database write. No transition exists purely in client memory.
**SB-ST-2** Transitions are idempotent. Two clients observing the same terminating condition simultaneously must produce one settlement (SB-BE-4).
**SB-ST-3** `finished`, `abandoned`, `cancelled` and `expired` are terminal. Rematch mints a new room.
**SB-ST-4** Input gating is a property of the state, enforced by `useTypingEngine`'s `gated` flag — structural, not a UI promise.

### 27.4 Client phase derivation

```js
phase =
  !room                          ? 'loading'
: room.status === 'lobby'        ? 'lobby'
: room.status === 'countdown'    ? (msUntil(room.round_starts_at) > 0 ? 'countdown' : 'fighting')
: room.status === 'active'       ? 'fighting'
: room.status === 'round_end'    ? 'roundCard'
: room.status === 'paused'       ? 'paused'
: room.status === 'finished'     ? 'result'
: 'closed';
```

The `countdown → fighting` fallthrough on an elapsed `round_starts_at` mirrors `useBattleRoom.js` exactly, and for the same reason: a client that loads cold after the countdown should not sit watching a countdown that already finished.

---

## 28. Edge cases

Every case below has a defined behaviour and a test (§37).

### 28.1 Lobby and joining

| Case | Behaviour |
|---|---|
| Player joins then leaves before start | Seat 1 freed; host sees the departure; room returns to waiting |
| Host leaves before start | Room `cancelled`; guest told plainly; Quick Match offered |
| Host leaves after start | **Forfeit.** Host status confers no exit privilege once combat begins |
| Invalid code | `Not found` + re-enter (§17.2) |
| Expired code | `Expired` + create-one |
| Same player joins twice (two tabs) | Second session takes over; first becomes read-only (SB-MP-13) |
| Player tries to join their own room | Blocked; *"That is your room"* + open it |
| Room fills during join | `FOR UPDATE` capacity check rejects race-free; Live Games offered |
| Guest with no profile row | Seat created with `'Player'`, matching `battle_join` |
| Signed-out visitor opens an invite link | Guest identity offered inline; RPCs revoked from `anon` |
| Cloud unconfigured | PvP disabled with the reason stated; Trial fully functional |
| Host opens a 4th room | Rejected at 3, matching Battlefield's cap |

### 28.2 During combat

| Case | Behaviour |
|---|---|
| Opponent disconnects | Pause within 400ms; 20s grace; forfeit on expiry (§15.5) |
| Own connection drops | Local combat stops immediately; *"Reconnecting…"*; no ghost typing |
| Browser refresh mid-match | Room status → phase; event log replayed; combat resumes. **Target: playable within 2s** |
| Tab closed and reopened | Same path as refresh |
| Tab backgrounded | Combat continues — it is a live match against a person. A warning banner shows on return. `rAF` throttling is handled by deriving all state from event timestamps, never from frame counts |
| Network partition | Events queue locally with their original timestamps and flush on reconnect. Events outside the round window are rejected — a long partition costs the round, honestly |
| Very high latency (>1s RTT) | Local combat is unaffected (input never awaits). The opponent's actions arrive late; the reducer resolves them at their true timestamps, so the *outcome* is correct even though the *feel* degrades |
| Both fighters reach 0 within 120ms | Double knockout → round draw (§12.3) |
| Both players go AFK | No events for 25s from both → round settles on the clock; a full match with zero events → `abandoned`, no rating |
| One player AFK | Their cards expire, Focus drains, they lose. No special handling — the rules already cover it |
| Card expires with no keystroke | Stagger, chain reset, Focus −5 |
| Keystroke matching neither card | Whiff: Focus −3, cards remain, no commit |
| Both cards somehow share a first letter | Cannot occur — SB-WRD-1 is enforced in the seeded derivation. A runtime assertion fires and the pair is re-derived; the assertion is logged as a defect |
| Focus hits 100 mid-card | Overdrive appears on the *next* pair. The current card is never swapped underneath the player |
| Pause abuse | Two pauses maximum per player; 40s total cap; third disconnect forfeits (SB-MP-11) |
| Clock offset > 2000ms | Match refuses to start; user told; retry offered (SB-MP-8) |

### 28.3 Settlement and results

| Case | Behaviour |
|---|---|
| Both clients call settle simultaneously | Idempotent; one row, one rating application |
| Settle fails (transient) | Retried with backoff; `shadow_reap` is the backstop |
| Client replay disagrees with server replay | **Server wins.** Client value stored as `client_hp`; a divergence beyond 2 HP is logged as a defect, not as cheating |
| Suspicious typing detected | Flags recorded; rating frozen pending review; opponent's rating applies normally (SB-AC-2) |
| Server restart mid-match | Clients reconnect via Realtime; state refetched; combat resumes. Postgres holds all durable state, so a restart costs latency, not a match |
| Rating write fails after result write | Result stands; rating reconciled by a repair job reading `shadow_results` where `fr_after is null`. **The result is never re-derived** |
| Match ends while a player is on the results screen of the previous match | Impossible: a room is terminal after `finished`, and rematch mints a new room |
| Bot match with no network | Fully supported; result written locally, synced on next sign-in |

### 28.4 Matchmaking

| Case | Behaviour |
|---|---|
| Matchmaking timeout | At 45s: bot at equivalent difficulty, private room, or keep waiting with a visible timer (SB-MM-2) |
| Opponent declines | Requeue at prior band width; no position lost (SB-MM-10) |
| Both accept, handshake fails | Both requeued at prior band width |
| Queue row orphaned by a closed browser | Reaped at 90s without heartbeat |
| Two matchmake calls claim the same opponent | `FOR UPDATE SKIP LOCKED` prevents it |
| Opponent-shopping | 3 declines in 5 minutes → 60s cooldown (SB-MM-4) |
| Only one player in the entire queue | They wait; the 45s offer fires; they never see an unexplained empty screen |

---

## 29. Mobile

### 29.1 The honest answer

> **Shadow Battle requires a physical keyboard. On a touch-only device it is not playable, and the product says so rather than shipping a worse version of itself.**

The reasoning, stated because a hedge here would produce a bad product:

- A soft keyboard occupies 40–50% of the viewport. What remains cannot hold a status bar, an arena and two cards at legible sizes.
- Soft-keyboard autocorrect, autocapitalisation and predictive input actively fight character-exact typing. They can be disabled per-input, but not reliably across every mobile browser and keyboard app.
- Soft-keyboard input latency and the absence of true key-down events make sub-100ms card completion impossible, which puts a touch player 2–3× off the pace of a keyboard player. In a **rated** mode, that is not a degraded experience — it is a broken ladder.
- Two-thumb typing cannot produce the inter-keystroke rhythm the anti-cheat variance check expects (§21.2), so touch players would generate false positives.

Forcing it would mean either a separate rating pool (fragmenting a small population) or a knowingly unfair one.

### 29.2 By device

| Device | Experience |
|---|---|
| Desktop, laptop | **Full.** The design target. |
| Tablet + physical keyboard | **Full.** Layout at the 768–1023px breakpoint. |
| Tablet, touch only | Companion surface |
| Phone | Companion surface |

### 29.3 The companion surface

The `/shadow` route on a touch-only device is **not an error page**. It renders:

- Your record: FR, tier, W–L, streak, best chain
- Match history with typing trends
- The fighter gallery and unlock progress
- A **Continue on desktop** panel — copies a link, or shows a QR
- (V1) Spectating, which is genuinely good on a phone
- A single honest line: *"Shadow Battle needs a physical keyboard. Everything else is here."*

**SB-MOB-1** The nav item is **never hidden** on mobile. A missing item reads as a broken build; a present item that explains itself reads as a decision.
**SB-MOB-2** Detection is capability-based, **never UA sniffing**: `matchMedia('(pointer: fine)')` and `(hover: hover)` plus viewport width. UA strings are unreliable and get worse every year.
**SB-MOB-3** A **Play anyway** override is always available. Detection has false negatives — a Surface in tablet mode, a Bluetooth keyboard connected after load — and locking a capable user out is worse than letting an incapable one try. The override is available for **Trial only**; rated modes stay keyboard-gated.
**SB-MOB-4** If a physical keydown is detected on a device classified as touch-only, the full experience is offered inline without a reload.
**SB-MOB-5** The companion surface meets the same quality bar as any other screen. It is a real surface, not a stub.

---

## 30. Performance

### 30.1 The governing rule

> **Nothing may come between a keystroke and its glyph.** Not an animation, not a network round trip, not the opponent, not the reducer.

This is `01-PRD.md` PR-3 restated for a mode that adds a 60fps render on top of the typing path.

### 30.2 Architecture that makes it true

The typing path and the render path share nothing but refs.

```
keydown ─▶ useTypingEngine (refs) ─▶ setState(typed) ─▶ card re-renders
             │
             └─▶ combatRef  ◀── reducer ◀── local events + remote events
                     │
                     └─▶ rAF loop ─▶ canvas draw        (no React)
                                  └─▶ HUD refs → throttled 10Hz DOM writes
```

**SB-PF-1** The arena is `<canvas>`, drawn in one `requestAnimationFrame` loop, **outside React entirely**. Two silhouettes, effects and damage numerals as DOM nodes under framer-motion would contend with the keystroke path at exactly the wrong moment — during a fast exchange, which is when both are busiest.
**SB-PF-2** Opponent state never enters React state (SB-MP-4). It lands in refs; the rAF loop reads them.
**SB-PF-3** The HUD (HP, Focus, chain) updates via direct style writes on refs at **10Hz**, not via React state at event rate. React re-render is reserved for the card pair, which genuinely changes.
**SB-PF-4** The reducer runs synchronously on event arrival and is O(events since last snapshot). A snapshot is taken each round, so a mid-match replay is bounded at one round of events (~140), which measures in single-digit milliseconds.
**SB-PF-5** No `filter`, `box-shadow` or `width` animations in the combat surface. Only `transform` and `opacity`, per `src/lib/motion.js`.

### 30.3 Budgets

| Path | p50 | p95 | p99 | How measured |
|---|---|---|---|---|
| Keystroke → glyph painted | ≤ 8ms | **≤ 16ms** | ≤ 33ms | `performance.mark` around keydown→paint, sampled in production |
| Word completion → local move resolution | ≤ 4ms | ≤ 10ms | ≤ 20ms | Reducer timing |
| Local event → opponent sees it | ≤ 120ms | ≤ 300ms | ≤ 800ms | Broadcast RTT |
| Arena frame | 16.7ms | ≤ 16.7ms | ≤ 25ms | `rAF` delta |
| Round settle | ≤ 300ms | ≤ 800ms | ≤ 2s | RPC timing |
| Match load / refresh → playable | ≤ 1s | ≤ 2s | ≤ 4s | Navigation timing |
| Route chunk (gz) | — | **≤ 45KB** | — | Build output |

**SB-PF-6** The keystroke budget is measured in production and reported, not asserted at review. The audit already flags `TypingStage` per-keystroke cost as *"structural, latency unmeasured"* (`07-migration-audit.md` §6.5) — Shadow Battle must not add a second unmeasured claim.

### 30.4 Degradation ladder

Applied automatically when the rAF loop reports a rolling average below 50fps for 2 seconds, and always reversible:

1. Damage numerals cap at 1 concurrent
2. Trails and after-images off
3. Screen shake off
4. Arena drops to 30fps (combat is unaffected — the reducer is not frame-driven)
5. **Calm Combat** (§24.3) offered, with the reason stated

**SB-PF-7** Degradation never changes a game value. It is presentation only, and Calm Combat is the proof (§24.3).
**SB-PF-8** The player is told when degradation engages, with a control to force full fidelity back on.

### 30.5 Bundle

**SB-PF-9** The whole mode is lazy-loaded, matching every route in `App.jsx`. It is not in the initial bundle, and the landing-page budget the audit already flags as at risk (`07-migration-audit.md` §6.2) must not move by a single byte.
**SB-PF-10** No new runtime dependency. Canvas is a platform API; the reducer is plain JavaScript; audio is synthesised via the existing `src/lib/sound.js`; there is no physics or game engine.
**SB-PF-11** The arena render and the bot are separate chunks from the combat core, so Trial does not pay for the multiplayer transport and Calm Combat does not pay for the renderer.

---

## 31. Analytics

### 31.1 Events

| Event | Key properties |
|---|---|
| `shadow_opened` | entry point (nav, palette, deep link, landing) |
| `shadow_mode_selected` | mode |
| `shadow_bot_started` | profile |
| `shadow_queue_entered` | fr, band |
| `shadow_queue_exited` | reason (matched, cancelled, timeout), wait_ms |
| `shadow_match_offered` | fr_gap, wait_ms |
| `shadow_match_accepted` / `_declined` | fr_gap, decision_ms |
| `shadow_room_created` | visibility, rated |
| `shadow_room_joined` | via (code, link, live, queue) |
| `shadow_invite_copied` | kind (code, link, share) |
| `shadow_match_started` | opponent_kind, fr_gap, band |
| `shadow_card_resolved` | **sampled at 5%** — move, lane, outcome, speed, precision, chain, damage |
| `shadow_move_landed` | move, damage, critical, contested |
| `shadow_overdrive_landed` | damage, round |
| `shadow_parry` | success |
| `shadow_round_ended` | round, winner, reason, duration_ms, hp_gap |
| `shadow_match_completed` | outcome, rounds, duration_ms, fr_delta, wpm, accuracy, clean_rate |
| `shadow_rematch_offered` / `_accepted` / `_declined` | — |
| `shadow_abandoned` | phase, elapsed_ms |
| `shadow_disconnected` | phase, reconnected, grace_used_ms |
| `shadow_paused` | reason, duration_ms |
| `shadow_flagged` | check, severity |
| `shadow_degraded` | step, fps_before |
| `shadow_calm_toggled` | on/off |
| `shadow_mobile_blocked` | override_used |
| `shadow_fighter_changed` | fighter_id |
| `shadow_unlock_earned` | fighter_id, condition |

**SB-AN-1** `shadow_card_resolved` is sampled at 5%. At ~250 cards per match, full capture would be the highest-volume event in the product by an order of magnitude, for a signal that is statistical rather than per-user.
**SB-AN-2** No card text, no keystroke content, no timing sequences leave the client beyond the aggregates already in the event log. The IKI summary is two numbers.

### 31.2 KPIs

**Adoption**

| KPI | Target |
|---|---|
| Shadow Battle reach (WAU touching the mode) | ≥ 30% |
| Time from `/shadow` open to first combat | **p50 ≤ 20s**, p90 ≤ 60s |
| Bot → PvP conversion within 7 days | ≥ 35% (G3) |

**Engagement**

| KPI | Target |
|---|---|
| Matches per session (median) | ≥ 3 (G4) |
| Rematch acceptance rate | ≥ 40% |
| Match completion rate | ≥ 92% |
| D7 return, players with ≥1 Shadow match vs. control | **+15pp** |

**Health**

| KPI | Target | If breached |
|---|---|---|
| **Median TTK per round** | **45–75s** | Balance defect — adjust base damage or HP |
| **Lane-choice split (strike : guard)** | **within 60:40** | One lane dominates — the fork is not a real choice |
| Parry attempt rate | 8–25% | Below 8%: too hard or unclear. Above 25%: too safe |
| Overdrive land rate | 45–70% of those thrown | Below: untelegraphed punishment. Above: no counterplay |
| Move usage spread | No move below 5% or above 40% of its lane | A dead move or a dominant one |
| Round draw rate | ≤ 4% | Time cap is doing too much work |
| Disconnect rate | ≤ 3% | Transport or grace-window problem |
| Flag rate | ≤ 0.5% | Above: false positives. Zero: the checks are not running |
| p95 keystroke latency | ≤ 16ms | The one budget that is never traded |

**Lane-choice split is the single most important balance metric in the mode.** A 90:10 split means the fork is decorative and the entire premise of §5.3 has failed. It is checked weekly.

**Quality**

| KPI | Target |
|---|---|
| Post-match "I understood why I won/lost" | ≥ 80% (G2) |
| Rage-quit rate (forfeit while behind) | ≤ 8% |
| Calm Combat adoption | Tracked, not targeted — it is an option, not a fallback |
| Accessibility-setting usage | Tracked |

---

## 32. Accessibility

Target: **WCAG 2.1 AA**, matching the rest of the product.

### 32.1 Keyboard

**SB-A11Y-1** The entire mode is operable by keyboard, which is trivially satisfied in combat and must be verified in every lobby, browser and result screen.
**SB-A11Y-2** `Shift+Tab` is never consumed on the combat surface, preserving the existing WCAG 2.1.2 escape (`useTypingEngine.js`). This is a regression risk on every change to that file and belongs in the test suite.
**SB-A11Y-3** Focus is managed on every phase transition: entering combat moves focus to the card region; the round card moves it to **Ready**; results move it to the primary action.
**SB-A11Y-4** Focus is always visible, using the existing `shadow-focus` ring token.
**SB-A11Y-5** No keyboard trap anywhere, including the paused overlay.

### 32.2 Screen readers

**SB-A11Y-6** The canvas is `aria-hidden="true"`. Everything it depicts exists in the DOM.
**SB-A11Y-7** Card pair semantics:
```html
<div role="group" aria-label="Choose your move">
  <div aria-label="Strike lane. Slash, base damage 10. Word: threshold, 9 characters.">
  <div aria-label="Guard lane. Parry, reflects damage. Word: veil, 4 characters.">
```
**SB-A11Y-8** An `aria-live="polite"` region reports combat outcomes, **throttled to at most one announcement every 2 seconds** and coalescing intervening events (*"Slash landed, 14 damage. Health 62."*). Unthrottled announcements in a mode producing 2–4 events per second would flood a screen reader into uselessness.
**SB-A11Y-9** `aria-live="assertive"` is reserved for four things only: round start, round end, match end, and disconnection.
**SB-A11Y-10** HP, Focus and Chain are `role="meter"` with `aria-valuenow`, `aria-valuemin`, `aria-valuemax` and `aria-valuetext`.
**SB-A11Y-11** A screen-reader user can complete a full Trial match. This is a manual acceptance test with a real user, not a checklist item.

### 32.3 Colour and contrast

**SB-A11Y-12** All text and meaningful graphics meet 4.5:1 (3:1 for large text), verified by `scripts/check-contrast.mjs`, extended to the new tokens. A failure blocks the build.
**SB-A11Y-13** **No state is communicated by colour alone.** Every one carries a second channel:

| State | Colour | Second channel |
|---|---|---|
| Your side / their side | brand / accent | Screen position (left/right) + name + fighter form |
| Damage taken | `--bad` | Downward arrow + numeral + `−` sign |
| Heal | `--good` | Upward arrow + `+` sign |
| Critical | white flash | `CRIT` text label |
| Blocked | dimmed numeral | `BLOCKED` text label |
| Parried | spark | `PARRY` label + reflected numeral direction |
| Low health | pulsing red | `LOW` label + hatched bar fill |
| Overdrive ready | full warn bar | `OVERDRIVE` label + solid ring |
| Committed move | corner glyph | `COMMITTED` text |
| Connection | dot colour | Text on hover + in the a11y tree |

**SB-A11Y-14** Verified against deuteranopia, protanopia and tritanopia simulation. Brand-orange and accent-blue remain distinguishable under all three, which is why they are the side colours.

### 32.4 Motion and cognition

**SB-A11Y-15** `prefers-reduced-motion` is fully honoured (§24.2) and changes no game value (SB-FB-6).
**SB-A11Y-16** **Calm Combat** (§24.3) is the strongest accessibility option in the mode and is discoverable from the combat surface, not buried in settings.
**SB-A11Y-17** No content flashes more than 3 times per second. The critical-hit flash is a single 80ms frame with a 400ms minimum interval — verified, because a fast exchange could otherwise chain flashes.
**SB-A11Y-18** All timing is generous relative to the task: `parMs × 2.5` means a 30 WPM typist completes most cards.
**SB-A11Y-19** Move names and consequences are always on screen. Nothing requires memorisation.
**SB-A11Y-20** Text scales to 200% without loss of function. The card band is the last element to give (SB-BS-13).

### 32.5 What is honestly not accessible

Stated plainly rather than claimed away: **Shadow Battle is a timed, competitive typing mode.** It is not accessible to someone who cannot type at speed, and no setting changes that. What the product owes such a user is not a pretence of access but an honest boundary and a full experience everywhere else — which is what Trial mode at Recruit difficulty (28 WPM, generous deadlines), Calm Combat, and the rest of TypeForge provide.

---

## 33. MVP scope

**The MVP test:** two strangers can find each other, fight three rounds, understand the result, and immediately want a rematch — and neither of them can cheat.

### 33.1 In scope

| Area | Included |
|---|---|
| **Modes** | Trial (5 bots) · Quick Match · Private Duel · Live Games |
| **Combat** | Full reducer, 8 moves, two-card fork, damage formula, criticals, parries, Overdrive |
| **Meters** | HP, Focus, Chain |
| **Rounds** | Best of 3, 90s cap, sudden death, round cards |
| **Words** | Seeded queue, 3 bands, round escalation, all 8 move word rules |
| **Fighters** | 5 silhouettes, 4 trails, side-colour rule, unlocks |
| **Multiplayer** | Dual transport, clock handshake, pause/grace/forfeit, reconnect by replay, duplicate-session takeover |
| **Rooms** | Codes, invite links, share, public/private, host controls, 30-min expiry, 3-room cap |
| **Matchmaking** | FR-banded queue, widening bands, accept/decline, 45s fallback offers |
| **Live Games** | Public projection with no PIN, live refresh, all card states |
| **Progression** | XP + outcome bonuses, Elo FR, 7 tiers, 10 achievements, 4 daily missions, match history |
| **Anti-cheat** | Server replay, 4 MVP checks, flags, rating freeze, admin review queue |
| **UI** | All 17 screens, both themes, full design-token compliance |
| **A11y** | All of §32, including Calm Combat |
| **Perf** | All §30 budgets, measured in production |
| **Backend** | `0010_shadow_battle.sql`: 6 tables + queue, RLS, ~20 RPCs, realtime, reaper |
| **Nav** | Rail + tab bar entry with `short`, original mark, in-progress dot, palette entries |
| **Mobile** | Capability detection, companion surface, Play-anyway override |
| **Analytics** | All §31 events and KPIs |

### 33.2 Explicitly out of MVP

Spectators · Dash, Dodge, Finisher · code/syntax combat text · Glicko-2 · seasons · tournaments · teams · custom arenas · in-match chat · replays · ghost matches · friends lists · voice · localisation beyond ASCII.

### 33.3 Dependencies

| Dependency | Status | Blocking? |
|---|---|---|
| Mode registry (`01-PRD.md` §25, MR-1…MR-7) | `[NEW]` — **verified absent from the codebase** | **Yes.** SC-A5 named the stickman entry as the registry's acceptance test. Shadow Battle is that test. |
| `useTypingEngine` gated mode | `[EXISTS]` | No |
| `measureClockOffset` | `[EXISTS]` | No |
| `signInAnonymously` | `[EXISTS]` | No |
| Supabase Realtime | `[EXISTS]` — publication live since `0009` | No |
| `arena_mint_pin` generalisation | `[NEW]` | Yes, for SB-ROOM-1 |
| Design tokens, motion, sound, toast, avatars, PinInput | `[EXISTS]` | No |
| `scripts/check-contrast.mjs` extension | `[EXTEND]` | Yes, for SB-UI-1 |

> **The registry dependency is real and should be sequenced first.** `01-PRD.md` §17.3 states: *"SC-A5 is the acceptance test for the entire extensibility programme. If the stickman entry cannot be expressed without changing core code, the registry has failed."* Building Shadow Battle before the registry means either building it twice or shipping the scattered mode knowledge the audit already flags as a defect.

---

## 34. V1 scope

Post-launch, driven by what §31 shows.

| # | Feature | Rationale |
|---|---|---|
| V1-1 | **Spectators** — read-only, cap 20, 3s delay | The audience exists once the mode does |
| V1-2 | **Dash** and **Dodge** as distinct guard-lane moves | The first depth addition; needs live balance data |
| V1-3 | **Finisher** — cinematic execution, zero mechanical effect | Pure payoff, cheap, high perceived value |
| V1-4 | **Syntax arena** — code-token cards, separate rating pool | Connects combat to the product's core differentiator |
| V1-5 | **Glicko-2** with rating deviation | Better matching for new and returning players |
| V1-6 | **Weakness-targeted queues** — cards drawn from your own weak keys (`keyStats`) | Makes combat *drill*. Arguably the highest-value item on this list. |
| V1-7 | **Replays** — the event log already makes this nearly free | Sharing, and self-review |
| V1-8 | **Ghost matches** against your own best recorded run | Answers the empty-queue case with a real opponent |
| V1-9 | **Advanced anti-cheat** — `isTrusted`, IME/paste hardening, anomaly scoring, signature drift | Scales with the ladder's value |
| V1-10 | **Rematch chains** — keep fighting the same opponent without returning to the landing screen | Directly serves G4 |
| V1-11 | **Shadow leaderboard** — global and friends, `0005` view pattern | The ladder needs a top |
| V1-12 | **Practice arena** — solo, no opponent, card drills | Learn the moves without pressure |
| V1-13 | More fighters and trails from live unlock data | Reward economy |

---

## 35. Future roadmap

`[FUTURE]` — architecture should not preclude these; nothing here is committed.

| Horizon | Feature | Note |
|---|---|---|
| **Seasons** | Ranked seasons with soft rating resets and seasonal cosmetics | The standard shape for keeping a ladder alive; needs a population first |
| **Tournaments** | Bracketed, scheduled, spectator-fronted | Depends on spectators (V1-1) and a real population |
| **Teams / clans** | Team rosters, team ratings, scheduled team matches | The largest social addition; conflicts with `01-PRD.md` §2's "not a social network" and needs an explicit product decision |
| **Custom arenas** | Community backdrops within the contrast rules | Cosmetic, safe, deferred |
| **Advanced combat** | Stances, move loadouts, per-round bans | **High risk.** Every one of these threatens the "no per-fighter advantage" guarantee (§14.1). Any such system must be provably symmetric. |
| **Richer fighter animation** | More poses, cloth simulation, contextual reactions | Bounded by §30 — the render must never contend with typing |
| **Events** | Weekend modifiers (double Focus, no guards, symbol-only) | Cheap variety once the reducer is parameterised |
| **3+ player modes** | Free-for-all, 2v2 | Requires rethinking the fork; a genuinely new design |
| **Cross-mode ladder** | A combined rating across Battlefield and Shadow Battle | Only if both populations are healthy |
| **Localisation** | Non-ASCII word banks, IME-aware input | See §36-Q4; a real market question, not a translation task |

---

## 36. Open questions

Genuine unknowns. Each has an owner and a decision point.

| # | Question | Why it is open | Decide by |
|---|---|---|---|
| **Q1** | Is a 60fps canvas arena affordable alongside the typing path on a 2019 laptop? | `07-migration-audit.md` §6.5 flags `TypingStage` per-keystroke cost as **structural and unmeasured**. Shadow Battle adds load on top of an un-baselined path. | **Prototype spike before UI work.** If it fails, Calm Combat becomes the default and the arena becomes opt-in. The architecture already supports that outcome. |
| **Q2** | Is the two-card fork learnable within one match without a tutorial? | The entire premise rests on it. It is simple to describe and untested with real players. | Playtest with 8 non-players before combat code is finalised |
| **Q3** | Are the §8 constants roughly right? | Every number is reasoned, none is measured. TTK, chain cap, guard duration and parry difficulty will all move. | Internal playtest, then the §31 health KPIs in the first four weeks |
| **Q4** | What happens to non-English and IME users? | MVP is ASCII-only (SB-WRD-2). A CJK-input player cannot compete, and TypeForge does not currently know its language distribution. | Measure the existing audience before committing to a localisation approach |
| **Q5** | Will the population support FR-banded matchmaking? | Banding needs concurrent players. Below ~20 concurrent, bands widen to meaninglessness. | Launch unbanded-with-preference; enable strict banding at a measured threshold |
| **Q6** | Is a plpgsql transliteration of the reducer maintainable? | Two implementations of one algorithm will drift. The fixture suite mitigates but does not eliminate this. | **Evaluate a Supabase Edge Function** running the same JavaScript module as an alternative to plpgsql. This is the single highest-leverage technical decision in the document. |
| **Q7** | Should private duels be optionally rated? | Unrated stops win-trading, but friends who genuinely want a rated match cannot have one. | Ship unrated; revisit if requested |
| **Q8** | Does the IKI variance check produce acceptable false positives? | The 0.08 threshold is reasoned from typing literature, not from this product's data. | Run in **shadow mode** (log, do not flag) for the first two weeks |
| **Q9** | Do bot matches cannibalise PvP? | If Trial is more fun than a real duel, G3 fails and the mode has no ladder. | Track bot:PvP ratio weekly; if bot share exceeds 70% after week 4, investigate |
| **Q10** | Best-of-3 at ~3 minutes — right length? | Reasoned from typing fatigue, not measured. | Session-depth and abandon-rate data in the first month |

---

## 37. Acceptance criteria

A feature is not complete because it works. Each area must satisfy every column.

### 37.1 Combat system

- [ ] **Functional** — JS and Postgres reducers produce **byte-identical** state across a 500-fixture suite covering every move, every contest state, both KO paths, draws, forfeits and sudden death
- [ ] **Functional** — Every §8.5 worked example reproduces exactly
- [ ] **Functional** — Damage arithmetic is integer-tenths throughout; no float accumulates across events
- [ ] **Functional** — A tampered client cannot alter a recorded result (adversarial test: modified bundle submitting fabricated events)
- [ ] **UX** — 8 of 10 first-time playtesters can state the §11.4 sentence after two matches
- [ ] **UX** — 8 of 10 correctly explain why they lost their last round
- [ ] **Perf** — Reducer p95 ≤ 10ms per event; full-round replay ≤ 50ms
- [ ] **Balance** — Median TTK 45–75s across ≥ 200 internal matches
- [ ] **Balance** — A 65 WPM / 99% clean / good-judgement profile beats a 95 WPM / 88% / poor-judgement profile in ≥ 60% of simulated matches (§5.4 verification)
- [ ] **Balance** — No move below 5% or above 40% of its lane's usage
- [ ] **Security** — No client-submitted value influences HP, damage, Focus, Chain or the outcome

### 37.2 The card fork

- [ ] SB-WRD-1 holds across 100,000 generated pairs — zero shared first characters
- [ ] Committing dims the other card without layout shift (visual regression test)
- [ ] A keystroke matching neither card whiffs correctly and never commits
- [ ] Both cards are fully announced by VoiceOver, NVDA and JAWS
- [ ] The first-character emphasis teaches the control: ≥ 8 of 10 playtesters commit correctly on their first card with no instruction

### 37.3 Multiplayer

- [ ] Two clients on the same match produce identical HP at every event boundary
- [ ] **A full match completes correctly with Broadcast disabled** (SB-MP-3)
- [ ] Mid-match refresh restores the correct phase and is playable within 2s
- [ ] Disconnect → 20s grace → reconnect resumes correctly, twice in one match
- [ ] Grace expiry forfeits correctly and applies rating
- [ ] Two tabs: takeover works; the first tab goes read-only; no double input reaches the log
- [ ] Simulated 800ms RTT: outcome is correct; typing latency is unchanged
- [ ] Clock offset > 2000ms refuses the match with a clear message
- [ ] Pause abuse capped at 2 per player, 40s total

### 37.4 Rooms, matchmaking, Live Games

- [ ] A code resolves to exactly one live room across both modes
- [ ] Every §17.2 error condition produces its distinct message and action
- [ ] **Live Games responses contain no PIN** — verified by network inspection, and by an automated test asserting the projection's column set
- [ ] A room filling under the cursor shows `Full` in place; it does not vanish
- [ ] Concurrent joins to a 1-slot room: exactly one succeeds
- [ ] Two simultaneous `shadow_matchmake` calls never claim the same opponent
- [ ] Matchmaking timeout offers all three fallbacks
- [ ] A queue row from a closed browser is reaped within 90s
- [ ] Invite link opens, shows the host, and **never auto-joins**

### 37.5 Bot

- [ ] Bot events are structurally indistinguishable from human events in the log (schema-level check)
- [ ] No bot code path reads unobservable state (code review + assertion in the policy layer)
- [ ] Each profile's measured WPM lands within ±5% of its spec over 100 matches
- [ ] Every profile makes visible mistakes, including Shade
- [ ] Mirror never exceeds 1.05× the player's best observed rate
- [ ] Mirror recalculates only between rounds
- [ ] Trial works fully offline with `SUPABASE_ENABLED = false`
- [ ] Bot matches award zero FR

### 37.6 UI, feedback, accessibility

- [ ] All 17 screens implemented in both themes
- [ ] `scripts/check-contrast.mjs` passes with the new tokens; failure blocks the build
- [ ] No arbitrary Tailwind values in the mode's source
- [ ] No feedback effect occludes card text, caret or HP bars
- [ ] Reduced motion changes no game value — verified by running the fixture suite with the flag set
- [ ] **Calm Combat is competitively identical** — the same fixtures produce the same outcomes
- [ ] Full keyboard operation of all 17 screens
- [ ] `Shift+Tab` escapes the combat surface
- [ ] A screen-reader user completes a full Trial match (manual, real user)
- [ ] `aria-live` throttling verified: no more than one announcement per 2s
- [ ] Every §32.3 state has a non-colour channel
- [ ] Colour-blindness simulation passes for all three types
- [ ] No flash exceeds 3/second
- [ ] 200% text zoom retains function

### 37.7 Performance

- [ ] **p95 keystroke → glyph ≤ 16ms**, measured in production, on a 2019-class laptop
- [ ] Arena holds 60fps with both fighters, 3 numerals and an active Overdrive
- [ ] Zero React state updates in the typing subtree from network messages (instrumented test)
- [ ] Route chunk ≤ 45KB gzipped
- [ ] Landing-page bundle unchanged to the byte
- [ ] Degradation ladder engages, informs the player, and is reversible
- [ ] No new runtime dependency

### 37.8 Backend and security

- [ ] `0009_battlefield.sql` is **unmodified**; all Battlefield tests still pass
- [ ] Every new RPC is revoked from `anon` and granted only to `authenticated`
- [ ] No client-side write path exists to `shadow_rooms`, `shadow_rounds` or `shadow_results`
- [ ] `shadow_events` accepts inserts only via `shadow_event_append`
- [ ] Structural validation **rejects** rather than flags
- [ ] `shadow_settle_round` and `shadow_settle_match` are idempotent under concurrent calls
- [ ] RLS verified by an adversarial suite: no cross-room reads, no PIN leakage, no profile exposure
- [ ] Realtime topics are room UUIDs, never codes
- [ ] All four MVP anti-cheat checks fire on synthetic cheat fixtures
- [ ] A flagged match freezes only the flagged player's rating

### 37.9 Progression

- [ ] XP matches the specified formula for every outcome combination
- [ ] Elo K-factor tiers apply at the correct match counts
- [ ] Rating is computed server-side only
- [ ] Forfeits count as full-K losses
- [ ] All 10 achievements trigger correctly and appear on `/achievements` with no changes to that surface
- [ ] All 4 daily missions are satisfiable in Trial
- [ ] Guest progression merges correctly on sign-in
- [ ] Match history is complete, paged and filterable

---

## 38. Risks

### 38.1 Product risks

| # | Risk | Impact | Likelihood | Mitigation |
|---|---|---|---|---|
| PR-1 | **The fork is not fun.** The core mechanic could read as an interruption rather than a decision. | Fatal — the mode has no reason to exist | Medium | Q2 playtest **before** combat code is finalised. This is the one risk that cannot be fixed after launch. |
| PR-2 | **Population too small for matchmaking.** An empty queue makes the mode a bot game. | High | **High** | Trial is a genuine product, not a placeholder. Fallback offers at 45s. Ghost matches (V1-8). Launch alongside a Battlefield cross-promotion. |
| PR-3 | **Skill gap frustration.** A 40 WPM player against a 90 WPM player loses every round. | High | Medium | FR banding; par-relative damage compresses the raw-speed advantage; Mirror bot as the on-ramp; loss XP keeps losing worthwhile |
| PR-4 | **Cannibalises Battlefield.** | Medium | Medium | They answer different questions and are positioned that way. Monitor both modes' engagement; a shift toward Shadow Battle is a success, an overall decline is not. |
| PR-5 | **Feels like a different product bolted on.** | Medium | Low | Zero new design primitives; existing XP, achievements, profile, avatars, sound and motion systems reused throughout |
| PR-6 | **Combat obscures typing improvement**, undermining the platform thesis. | Medium | Medium | Every result screen reports typing metrics against the player's own baseline; V1-6 makes combat *drill* |
| PR-7 | **Scope.** This is the largest feature in the product's history. | High | **High** | The MVP is already a hard cut. If it must shrink: Live Games first, then Quick Match (leaving Trial + Private), then fighters to one. **Never cut the fork, the reducer's server authority, or the a11y work** — those are what make it the product rather than a demo. |
| PR-8 | **Cosmetic-only unlocks under-motivate.** | Low | Medium | Titles, tiers and records carry most of the weight; the roster grows with the mode |

### 38.2 Technical risks

| # | Risk | Impact | Likelihood | Mitigation |
|---|---|---|---|---|
| TR-1 | **The two reducers drift.** JS and plpgsql diverge on an edge case; results stop matching what players saw. | **Critical** | **High** | 500-fixture cross-language suite in CI. **Q6: strongly evaluate a Supabase Edge Function running the same JS module instead of plpgsql** — one implementation is worth real cost to achieve. |
| TR-2 | **Canvas contends with typing.** | Critical | Medium | Q1 spike before UI work; refs-only data flow; degradation ladder; Calm Combat as a proven-equivalent fallback |
| TR-3 | **Postgres-only architecture cannot carry combat.** Event throughput or settle latency proves inadequate. | Critical | **Low–Medium** | Volumes are modest (~250 events/match, batched). Load-test at 100 concurrent matches **before** UI work. If it fails, an Edge Function absorbs settlement without changing the model. |
| TR-4 | **Realtime quota.** Two-player rooms are cheap, but many concurrent rooms are not. | High | Medium | Per-match cost is ~¼ of an 8-player Battlefield. Broadcast loss degrades correctly (SB-MP-3). Monitor quota from launch. |
| TR-5 | **Anti-cheat false positives** damage trust with legitimate fast typists. | High | Medium | Q8: shadow-mode logging for two weeks; freeze rather than reverse; human review; no automated bans in MVP |
| TR-6 | **Clock manipulation.** A client with a manipulated clock reports favourable timings. | High | Low | All timestamps are relative to a server-written `starts_at`; offset handshake; >2000ms refuses; plausibility floors catch the rest |
| TR-7 | **Mode registry not built first**, so mode knowledge scatters further. | Medium | **High** | Sequence the registry first. Shadow Battle *is* SC-A5, the registry's own acceptance test. |
| TR-8 | **Bundle regression** on a landing budget the audit already flags as unachievable. | Medium | Low | Lazy-loaded; chunk-split; zero new dependencies; byte-level CI check |
| TR-9 | **Guest-to-account merge loses Shadow progression.** | Medium | Medium | Reuse the existing `sync.js` merge path and extend its tests rather than writing a second merge |
| TR-10 | **Reconnect replay is slower than the 2s budget** on long matches. | Low | Low | Per-round snapshots bound replay to ~140 events |

---

## Appendix A — Brief-to-section mapping

Every numbered section of the originating brief, and where it is answered.

| Brief § | Topic | This document |
|---|---|---|
| 1 | Existing product context | §5, §22.1, §26.1, and inline `[EXISTS]` references throughout |
| 2 | Game concept | §5, §6 |
| 3 | Game modes (A–D) | §7 (all four), §13 (bot), §18 (live games) |
| 4 | Gameplay loop | §6.1 — corrected in two places, with reasons |
| 5 | Word-based combat system | §8, §9 |
| 6 | Combat moves | §10 — 8 shipped, 3 deferred with disposition (§10.6) |
| 7 | Fighter / avatar system | §14 |
| 8 | Health / energy / combo | §11 — five meters reduced to three, with reasoning |
| 9 | Round system | §12 — three structures evaluated, best-of-3 chosen |
| 10 | Multiplayer system | §15, §16, §17, §18 |
| 11 | Anti-cheat | §21 — MVP and advanced separated |
| 12 | Bot system | §13 |
| 13 | UI / UX | §22, §23 |
| 14 | Live battle UI | §25 — layout redesigned from the brief's sketch, with reasoning |
| 15 | Game feedback | §24 |
| 16 | Progression | §19 |
| 17 | Rewards | §20 |
| 18 | Mobile | §29 — explicit "not playable on touch", with a real companion surface |
| 19 | Accessibility | §32 |
| 20 | Performance | §30 |
| 21 | Data / backend | §26 — 6 entities, 7 candidates rejected with reasons |
| 22 | Game state | §27 — full transition table |
| 23 | Edge cases | §28 |
| 24 | Analytics | §31 |
| 25 | MVP vs future | §33, §34, §35 |
| 26 | Acceptance criteria | §37 |
| 27 | Final PRD output | This document |

## Appendix B — Requirement index

| Prefix | Area | Section |
|---|---|---|
| `SB-BOT-*` | Bot / Trial mode | §7.1, §13 |
| `SB-MM-*` | Matchmaking | §7.2, §16 |
| `SB-PVT-*` | Private duels | §7.3 |
| `SB-LIVE-*` | Live games | §7.4, §18 |
| `SB-CMB-*` | Combat reducer | §8 |
| `SB-WRD-*` | Word system | §9 |
| `SB-MOV-*` | Move system | §10 |
| `SB-RND-*` | Rounds and rematch | §12 |
| `SB-FTR-*` | Fighters | §14 |
| `SB-MP-*` | Multiplayer transport | §15 |
| `SB-ROOM-*` | Rooms and invites | §17 |
| `SB-PRG-*` | Progression | §19 |
| `SB-RWD-*` | Rewards | §20 |
| `SB-AC-*` | Anti-cheat | §21 |
| `SB-UI-*` | UI / UX | §22 |
| `SB-NAV-*` | Navigation | §23 |
| `SB-FB-*` | Feedback | §24 |
| `SB-BS-*` | Battle screen | §25 |
| `SB-BE-*` | Backend | §26 |
| `SB-ST-*` | Game state | §27 |
| `SB-MOB-*` | Mobile | §29 |
| `SB-PF-*` | Performance | §30 |
| `SB-AN-*` | Analytics | §31 |
| `SB-A11Y-*` | Accessibility | §32 |

## Appendix C — Verification of this document

**Read in source** for this PRD, at `typeforge` @ `980d633`:

`src/App.jsx` · `src/components/layout/AppShell.jsx` · `src/components/typing/useTypingEngine.js` · `src/lib/battle/api.js` · `src/lib/battle/clock.js` · `src/lib/battle/passage.js` · `src/lib/battle/useBattleRoom.js` · `src/lib/gamification.js` · `src/lib/content.js` · `src/lib/motion.js` · `src/lib/avatars.js` · `src/lib/store.jsx` · `src/lib/config.js` · `src/lib/ai.js` · `src/lib/supabase.js` · `src/index.css` · `tailwind.config.js` · `package.json` · `supabase/migrations/0005_leaderboard.sql` · `supabase/migrations/0009_battlefield.sql` · `src/modules/battle/Battle.jsx` · `src/modules/battle/BattleRoom.jsx` · `src/components/brand/Logo.jsx` · `scripts/` · `docs/01-PRD.md` · `docs/06-implementation-plan.md` · `docs/07-migration-audit.md`

**Claims verified by direct inspection:**

- No mode registry exists in `src/` — `grep` for `MODE_REGISTRY|modeRegistry|registry` returns nothing. §33.3's blocking dependency is therefore real, not assumed.
- `NAV_GROUPS` holds exactly 6 items in 2 groups; the 8-item ceiling and its 360px reasoning are documented in `AppShell.jsx`.
- The mobile tab bar renders `{item.label}` at `text-[10px]` with `flex-1` — the basis for SB-NAV-1.
- `battle_mint_pin`, `battle_server_time` and all 12 public `battle_*` RPCs are revoked from `public, anon` and granted to `authenticated`.
- `supabase_realtime` carries `battle_rooms`, `battle_players`, `battle_results`.
- `useTypingEngine` supports `gated`, `startAtMs` and `begin()`, and deliberately does not consume `Shift+Tab`.
- `xpForSession` takes a `kind` factor with `code: 1.25`, `battle: 1.15`.
- `ACHIEVEMENTS` is a flat array of `{id, name, hint, icon, tier, test}` including three `battle-*` entries.
- `scripts/check-contrast.mjs` exists.
- `signInAnonymously` exists in `src/lib/supabase.js:99` and is already used by both battle surfaces.
- `01-PRD.md` §17 reserves stickman combat as `[FUTURE]` with SC-A1…A5, and §26.7 flags the public-room RLS problem this document solves in §18.2.

**Not verified, and treated as open rather than assumed:** current production concurrency, Realtime quota headroom, the audience's language distribution, real keystroke latency on the existing typing surface (flagged as unmeasured by the audit itself), and every combat constant in §8 and §10 — all of which are §36 questions or §31 health KPIs, not claims.

---

*End of document.*
