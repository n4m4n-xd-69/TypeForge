import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { cx } from '../../lib/format.js';
import { FighterCanvas } from './FighterCanvas.jsx';
import { HpBar } from './HpBar.jsx';
import { FocusBar } from './FocusBar.jsx';
import { CardLane } from './CardLane.jsx';
import { NinjaScroll } from './NinjaScroll.jsx';
import { DamageFloater } from './DamageFloater.jsx';
import { MatchSummary } from './MatchSummary.jsx';
import { CombatAnnouncer } from './CombatAnnouncer.jsx';
import { ChainIndicator } from './ChainIndicator.jsx';
import NetworkIndicator from './NetworkIndicator.jsx';
import { getAvatar } from './avatars.js';
import {
  AVATARS, createSession, nextRound, press, restart, tick, view,
} from '../../lib/shadow/arenaSession.js';

/**
 * The arena.
 *
 * Every piece of game state comes from `arenaSession.view()`, and every state
 * transition comes from the discriminated union `press()` / `tick()` return.
 * This component does not know what a round state looks like and must not learn
 * — the previous version read `match.currentRoundState.hp`, a field that never
 * existed in the engine, which is why typing threw on every keystroke and the
 * opponent never moved. See
 * docs/superpowers/plans/2026-08-25-shadow-avatar-modes.md §2.
 *
 * The session lives in a ref, not in state: it changes on every keystroke and a
 * re-render per character would put React's reconciler on the typing hot path.
 * A version counter drives renders instead, so the component re-renders once per
 * *meaningful* transition rather than once per key.
 *
 * ## Scope: the session is always local
 *
 * `mode` only labels the network indicator and the summary. `arenaSession` runs
 * a local match against a bot in every case — live opponent transport is not
 * wired here, and `ShadowRoom.jsx` currently mounts this for a multiplayer room
 * without passing an avatar or a profile, so it gets a local Stickman session
 * against Adept. That is not a regression (the previous version guarded its
 * entire init on `mode === 'trial'`, so a multiplayer room rendered an arena
 * that never initialised at all) but it is not multiplayer either. Wiring
 * `useShadowRoom` into the facade is explicitly out of scope — see
 * docs/superpowers/plans/2026-08-25-shadow-avatar-modes.md §9.
 */
export default function ShadowArena({
  mode = 'trial',
  avatar = AVATARS.STICKMAN,
  botProfile = 'adept',
  playerName = 'Player',
  opponentName,
  seed = 1,
  onExit,
}) {
  const canvasRef = useRef(null);
  const sessionRef = useRef(null);
  const startRef = useRef(0);
  const [, bump] = useState(0);
  const rerender = useCallback(() => bump((v) => v + 1), []);

  const [floaters, setFloaters] = useState([]);
  const [announce, setAnnounce] = useState('Arena loaded.');
  const [banner, setBanner] = useState(null);
  const [whiffAt, setWhiffAt] = useState(0);
  const [nowMs, setNowMs] = useState(0);

  const avatarDef = getAvatar(avatar) ?? getAvatar('stickman');

  /* ── session lifecycle ────────────────────────────────────────────── */

  useEffect(() => {
    startRef.current = performance.now();
    sessionRef.current = createSession({
      avatar,
      botProfile,
      seed,
      playerName,
      opponentName,
      startedAtMs: 0,
    });
    setFloaters([]);
    setBanner(null);
    setAnnounce(`${avatarDef.name} selected. Round one.`);
    rerender();
  }, [avatar, botProfile, seed, playerName, opponentName, avatarDef.name, rerender]);

  const clock = useCallback(() => performance.now() - startRef.current, []);

  const pushFloater = useCallback((floater) => {
    setFloaters((prev) => [...prev.slice(-6), { ...floater, key: `${Date.now()}-${Math.random()}` }]);
  }, []);

  /**
   * Apply one result from the session. Single place where a transition becomes
   * visible — VFX, floaters, announcements and banners all hang off this, so a
   * new result kind has exactly one place to be handled.
   */
  const applyResult = useCallback((result) => {
    const canvas = canvasRef.current;

    switch (result.kind) {
      case 'combat-start':
        setBanner(null);
        setAnnounce('Fight.');
        return true;

      case 'whiff':
        setWhiffAt(Date.now());
        pushFloater({ kind: 'whiff', text: `\u2212${result.focusLost} FOCUS`, seat: 0 });
        return true;

      case 'penalty':
        setWhiffAt(Date.now());
        pushFloater({ kind: 'damage', text: `\u2212${(result.hpLost / 10).toFixed(1)}`, seat: 0 });
        canvas?.triggerHit(0, result.hpLost);
        return true;

      case 'resolve': {
        const seat = result.seat;
        if (result.moveId) canvas?.triggerAction(seat, result.moveId);
        if (result.damage > 0) {
          const target = 1 - seat;
          pushFloater({ kind: 'damage', text: `\u2212${(result.damage / 10).toFixed(1)}`, seat: target });
          canvas?.triggerHit(target, result.damage);
        }
        if (result.healed > 0) {
          pushFloater({ kind: 'heal', text: `+${(result.healed / 10).toFixed(1)}`, seat });
        }
        if (result.moveId === 'evade') pushFloater({ kind: 'parry', text: 'EVADE', seat });
        if (result.moveId === 'parry') pushFloater({ kind: 'parry', text: 'DEFLECT', seat });
        if (result.moveId === 'overdrive') setAnnounce('Overdrive.');
        return true;
      }

      case 'round-end': {
        const text = result.winner === 0 ? 'ROUND WON' : result.winner === 1 ? 'ROUND LOST' : 'ROUND DRAW';
        setBanner(text);
        setAnnounce(`${text}. Score ${result.scores[0]} to ${result.scores[1]}.`);
        window.setTimeout(() => {
          if (!sessionRef.current) return;
          sessionRef.current = nextRound(sessionRef.current, clock());
          setBanner(null);
          rerender();
        }, 2200);
        return true;
      }

      case 'match-end':
        setBanner(null);
        setAnnounce(`Match over. ${result.outcome}.`);
        return true;

      case 'progress':
      case 'lane-commit':
        return true;

      default:
        return false;
    }
  }, [clock, pushFloater, rerender]);

  /* ── input ────────────────────────────────────────────────────────── */

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        onExit?.();
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key.length !== 1) return;
      const session = sessionRef.current;
      if (!session || session.phase !== 'combat') return;

      e.preventDefault();
      const { session: next, result } = press(session, e.key, clock());
      sessionRef.current = next;
      if (applyResult(result)) rerender();
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [applyResult, clock, onExit, rerender]);

  /* ── clock ────────────────────────────────────────────────────────── */

  useEffect(() => {
    const id = window.setInterval(() => {
      const session = sessionRef.current;
      if (!session) return;
      if (session.phase === 'round-over' || session.phase === 'match-over') {
        setNowMs(clock());
        return;
      }
      const { session: next, result } = tick(session, clock());
      sessionRef.current = next;
      setNowMs(clock());
      if (applyResult(result)) rerender();
    }, 100);
    return () => window.clearInterval(id);
  }, [applyResult, clock, rerender]);

  const session = sessionRef.current;
  const v = useMemo(() => (session ? view(session, nowMs) : null), [session, nowMs]);

  /* Keep the canvas' own copy of HP/Focus in step for its aura and stance. */
  useEffect(() => {
    if (!v) return;
    canvasRef.current?.updateState(v.hp[0], v.hp[1], v.focus[0], v.focus[1]);
  }, [v]);

  if (!v) return null;

  const canvasWidth = Math.min(typeof window !== 'undefined' ? window.innerWidth - 32 : 1200, 1200);
  const canvasHeight = Math.min(typeof window !== 'undefined' ? window.innerHeight * 0.4 : 360, 360);

  return (
    <div className="fixed inset-0 z-50 flex flex-col overflow-hidden bg-bg text-ink">
      {/* ── Chrome ───────────────────────────────────────────────────── */}
      <div className="flex shrink-0 items-center gap-1.5 px-2 pt-2">
        <button
          onClick={onExit}
          title="Leave the arena (Esc)"
          aria-label="Leave the arena"
          className="grid h-[36px] w-[36px] place-items-center rounded-sm border border-line bg-surface text-ink-3 transition-colors hover:text-ink"
        >
          <X size={17} strokeWidth={2.2} aria-hidden />
        </button>

        <div className="flex items-baseline gap-1">
          <span className="eyebrow">{avatarDef.name}</span>
          <span className="text-2xs font-bold uppercase tracking-[0.1em] text-ink-3">
            Round {v.round}
          </span>
        </div>

        <div className="ml-auto flex items-center gap-1.5">
          {v.avatar === AVATARS.NINJA ? (
            <div className="hidden items-center gap-1.5 sm:flex">
              <Readout label="WPM" value={v.wpm} />
              <Readout label="Acc" value={`${v.accuracy}%`} />
              <Readout
                label="Pressure"
                value={`\u00d7${v.pressure.toFixed(2)}`}
                tone={v.pressure >= 1 ? 'good' : 'warn'}
              />
            </div>
          ) : null}
          <div className="rounded-full border border-line bg-surface px-1.5 py-px">
            <NetworkIndicator mode={mode === 'trial' ? 'local' : 'live'} pingMs={0} />
          </div>
        </div>
      </div>

      {/* ── HUD ──────────────────────────────────────────────────────── */}
      <div className="mx-auto grid w-full max-w-[1200px] shrink-0 grid-cols-[1fr_auto_1fr] items-start gap-2 px-2 pt-2">
        <div className="relative min-w-0 space-y-1">
          <HpBar hp={v.hp[0]} score={v.scores[0]} playerName={v.playerName} fighterId={avatarDef.name} />
          <FocusBar focus={v.focus[0]} />
          <ChainIndicator chain={v.chain[0]} />
        </div>

        <div className="px-1 text-center">
          <p className="eyebrow">Time</p>
          <p className="font-mono text-2xl font-bold leading-none tnum">{v.secondsLeft}</p>
        </div>

        <div className="min-w-0 space-y-1">
          <HpBar hp={v.hp[1]} score={v.scores[1]} isOpponent playerName={v.opponentName} fighterId="Bot" />
          <FocusBar focus={v.focus[1]} isOpponent />
        </div>
      </div>

      {/* ── Stage ────────────────────────────────────────────────────── */}
      <div className="relative flex min-h-0 flex-1 flex-col items-center justify-end">
        <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex justify-center px-2">
          <div className="w-full max-w-[720px]">
            {v.avatar === AVATARS.NINJA ? (
              <NinjaScroll
                text={v.scroll.text}
                cursor={v.scroll.cursor}
                beats={v.scroll.beats}
                beatIndex={v.scroll.beatIndex}
                shakeKey={whiffAt}
              />
            ) : (
              <CardLane deck={v.deck} shakeKey={whiffAt} />
            )}
          </div>
        </div>

        <FighterCanvas
          ref={canvasRef}
          width={canvasWidth}
          height={canvasHeight}
          silhouettes={[avatarDef.silhouette, 'stick']}
        />
        <DamageFloater notifications={floaters} />

        {v.phase === 'countdown' ? (
          <Overlay>
            <p className="font-display text-6xl font-bold text-brand">
              {v.countdownLeft > 0 ? v.countdownLeft : 'FIGHT'}
            </p>
          </Overlay>
        ) : null}

        {banner ? (
          <Overlay>
            <p className="font-display text-4xl font-bold tracking-[-0.02em]">{banner}</p>
          </Overlay>
        ) : null}
      </div>

      {v.phase === 'match-over' && v.matchOutcome ? (
        <MatchSummary
          outcome={v.matchOutcome.outcome}
          roundsWon={v.scores[0]}
          roundsLost={v.scores[1]}
          opponentName={v.opponentName}
          isBot={mode === 'trial'}
          stats={{
            wpm: v.wpm ?? 0,
            accuracy: v.accuracy ?? 0,
            bestChain: Math.max(v.chain[0], 0),
            damageDealt: 1000 - v.hp[1],
            damageTaken: 1000 - v.hp[0],
          }}
          onPlayAgain={() => {
            sessionRef.current = restart(sessionRef.current, clock());
            startRef.current = performance.now();
            setFloaters([]);
            setBanner(null);
            rerender();
          }}
          onExit={onExit}
        />
      ) : null}

      <CombatAnnouncer message={announce} />
    </div>
  );
}

function Overlay({ children }) {
  return (
    <div className="absolute inset-0 z-30 grid place-items-center bg-bg/60 backdrop-blur-[2px]">
      {children}
    </div>
  );
}

function Readout({ label, value, tone = 'neutral' }) {
  return (
    <div className="rounded-sm border border-line bg-surface px-1.5 py-px text-center">
      <p className="text-2xs font-bold uppercase tracking-[0.08em] text-ink-3">{label}</p>
      <p
        className={cx(
          'font-mono text-sm font-bold leading-tight tnum',
          tone === 'good' && 'text-good',
          tone === 'warn' && 'text-warn',
        )}
      >
        {value}
      </p>
    </div>
  );
}
