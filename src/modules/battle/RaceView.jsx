import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Flag, Loader2, Wifi, WifiOff } from 'lucide-react';
import TypingStage from '../../components/typing/TypingStage.jsx';
import LiveStats from '../../components/typing/LiveStats.jsx';
import useTypingEngine from '../../components/typing/useTypingEngine.js';
import { Card, Chip, ProgressBar } from '../../components/ui/Primitives.jsx';
import { useToast } from '../../components/ui/Toast.jsx';
import { useStore } from '../../lib/store.jsx';
import { useReducedMotionSafe } from '../../lib/motion.js';
import { finishBattle } from '../../lib/battle/api.js';
import RaceTrack from './RaceTrack.jsx';
import { cx, mmss } from '../../lib/format.js';
import { buildSessionPayload } from '../../lib/modes/sessionContract.js';

/**
 * The race.
 *
 * Reuses the whole solo typing surface — TypingStage for the passage and caret,
 * LiveStats in its `compact` layout for the header readout — and adds exactly
 * two things: a start the player does not control, and everyone else.
 */
export default function RaceView({ battle }) {
  const {
    room, roster, passage, me, startsAtMs, publishTick, publishDone,
    publishCheckpoint, subscribeTicks, connected, phase, refresh,
  } = battle;
  const { toast } = useToast();
  const { recordSession } = useStore();
  const reduce = useReducedMotionSafe();

  const [countdown, setCountdown] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const submitted = useRef(false);

  const target = passage ?? '';

  /* Report the run, then let the room's status change carry us to results. */
  const onFinish = useCallback(async (run) => {
    if (submitted.current || !room) return;
    submitted.current = true;
    setSubmitting(true);

    publishDone({
      progressChars: run.correctChars,
      wpm: run.wpm,
      accuracy: run.accuracy,
      mistakes: run.errors,
    });

    try {
      await finishBattle(room.id, {
        correctChars: run.correctChars,
        typedChars: run.chars,
        mistakes: run.errors,
        accuracy: run.accuracy,
        consistency: run.consistency,
        wpm: run.wpm,
        finished: run.completed,
      });

      // Battlefield counts. Same reducer every other surface uses, so XP,
      // streak, daily missions and achievements all move without a special case.
      recordSession(buildSessionPayload({ modeId: 'battle', difficulty: room.difficulty, run }));
    } catch (err) {
      toast(err.message ?? 'Could not report your result.', { tone: 'error' });
    } finally {
      setSubmitting(false);
      refresh().catch(() => {});
    }
  }, [room, publishDone, recordSession, toast, refresh]);

  const engine = useTypingEngine({
    target,
    limitSeconds: room?.time_limit_sec ?? null,
    sound: false,
    gated: true,
    // The hook's prop is startAtMs; the room exposes startsAtMs. Spelling the
    // mapping out rather than relying on shorthand — the two names differ by one
    // letter, and the shorthand version silently referenced nothing.
    startAtMs: startsAtMs,
    onFinish,
  });

  const { begin } = engine;

  /* ── the countdown, driven by starts_at rather than a local timer ──── */
  useEffect(() => {
    if (!startsAtMs) return undefined;
    let raf;
    const tick = () => {
      const left = startsAtMs - Date.now();
      if (left <= 0) {
        setCountdown(0);
        return; // begin() is fired by the effect below, once
      }
      setCountdown(Math.ceil(left / 1000));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [startsAtMs]);

  /* GO. Guarded so a re-render cannot restart the run. */
  const begun = useRef(false);
  useEffect(() => {
    if (begun.current || !target || countdown === null) return;
    if (countdown > 0) return;
    begun.current = true;
    begin();
  }, [countdown, target, begin]);

  /* Telemetry. Called on every render of the live object, but both publishers
     rate-limit themselves and skip frames where nothing moved. */
  const live = engine.live;
  useEffect(() => {
    if (engine.status !== 'running') return;
    publishTick(live);
    publishCheckpoint(live);
  }, [live, engine.status, publishTick, publishCheckpoint]);

  /* The deadline is the server's. If it passes with the run unfinished, submit
     what there is rather than leaving the room hanging on one player. */
  useEffect(() => {
    if (!room?.deadline_at || submitted.current) return undefined;
    const left = Date.parse(room.deadline_at) - Date.now();
    if (left <= 0) { engine.finish('time'); return undefined; }
    const t = setTimeout(() => engine.finish('time'), left);
    return () => clearTimeout(t);
  }, [room?.deadline_at, engine]);

  const waiting = !target;
  const racing = countdown === 0 && !waiting;

  return (
    <div className="space-y-2">
      {/* ── header ─────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-1.5">
        <Chip tone="brand">{room.pin}</Chip>
        <LiveStats live={engine.live} limitSeconds={room.time_limit_sec} compact />
        <div className="ml-auto flex items-center gap-1">
          <span
            className={cx('flex items-center gap-0.5 text-2xs font-bold', connected ? 'text-good' : 'text-warn')}
            title={connected ? 'Connected' : 'Reconnecting'}
          >
            {connected ? <Wifi size={12} aria-hidden /> : <WifiOff size={12} aria-hidden />}
            {connected ? 'Live' : 'Reconnecting'}
          </span>
        </div>
      </div>

      <div className="grid gap-2.5 xl:grid-cols-[1fr_300px]">
        {/* ── stage ────────────────────────────────────────────────── */}
        <Card className="relative overflow-hidden">
          <div className="border-b border-line px-2.5 py-1.5">
            <div className="mb-1 flex items-center justify-between font-mono text-xs text-ink-3">
              <span>{room.passage_meta ?? 'Battlefield passage'}</span>
              <span className="tnum">{engine.index} / {target.length || room.passage_chars}</span>
            </div>
            <ProgressBar value={engine.live.progress} label="Your progress" />
          </div>

          <div className="px-3 py-2.5 sm:px-5">
            {waiting ? (
              <div className="grid h-[180px] place-items-center text-sm text-ink-3">
                <span className="flex items-center gap-1">
                  <Loader2 size={15} className="animate-spin" aria-hidden /> Fetching the passage…
                </span>
              </div>
            ) : (
              <TypingStage
                target={target}
                engine={engine}
                caretStyle="block"
                fontSize={22}
                visibleLines={6}
              />
            )}
          </div>

          {submitting ? (
            <div className="border-t border-line px-3 py-1.5 text-xs text-ink-3">
              <span className="flex items-center gap-1">
                <Loader2 size={13} className="animate-spin" aria-hidden /> Reporting your run…
              </span>
            </div>
          ) : null}

          {engine.status === 'done' && !submitting ? (
            <div className="border-t border-line px-3 py-1.5 text-xs">
              <span className="flex items-center gap-1 font-bold text-good">
                <Flag size={13} aria-hidden /> Finished — waiting for the others
              </span>
            </div>
          ) : null}

          {/* ── countdown ──────────────────────────────────────────── */}
          <AnimatePresence>
            {!racing && !waiting ? (
              <motion.div
                key="countdown"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="absolute inset-0 z-30 grid place-items-center bg-bg/85 backdrop-blur-sm"
                aria-live="assertive"
              >
                <div className="text-center">
                  <AnimatePresence mode="wait">
                    <motion.p
                      key={countdown}
                      initial={reduce ? { opacity: 0 } : { scale: 0.6, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      exit={reduce ? { opacity: 0 } : { scale: 1.4, opacity: 0 }}
                      transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
                      className="font-mono text-7xl font-bold text-brand"
                    >
                      {countdown === null ? '…' : countdown === 0 ? 'GO' : countdown}
                    </motion.p>
                  </AnimatePresence>
                  <p className="mt-1 text-sm font-bold text-ink-2">
                    {countdown === 0 ? 'Type!' : 'Hands on the home row'}
                  </p>
                </div>
              </motion.div>
            ) : null}
          </AnimatePresence>
        </Card>

        {/* ── rivals ───────────────────────────────────────────────── */}
        <aside className="space-y-2.5">
          <Card className="p-2.5">
            <div className="flex items-center justify-between">
              <p className="eyebrow">The field</p>
              <span className="font-mono text-2xs text-ink-3">{mmss(engine.live.remaining ?? room.time_limit_sec)}</span>
            </div>
            <RaceTrack
              className="mt-2"
              roster={roster}
              meId={me?.user_id ?? null}
              subscribeTicks={subscribeTicks}
              myLive={engine.live}
              passageChars={room.passage_chars}
            />
          </Card>

          <Card className="p-2.5">
            <p className="eyebrow">Scoring</p>
            <ol className="mt-1 space-y-0.5 text-xs text-ink-3">
              <li><span className="font-bold text-ink-2">1.</span> Fewest mistakes</li>
              <li><span className="font-bold text-ink-2">2.</span> Highest WPM</li>
              <li><span className="font-bold text-ink-2">3.</span> Highest accuracy</li>
              <li><span className="font-bold text-ink-2">4.</span> Earliest finish</li>
            </ol>
            <p className="mt-1.5 text-2xs leading-relaxed text-ink-3">
              A clean slow run beats a fast one with a typo. Accuracy is the whole game here.
            </p>
          </Card>
        </aside>
      </div>
    </div>
  );
}
