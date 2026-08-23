import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowRight, RotateCcw, Sparkles, TrendingUp } from 'lucide-react';
import Modal from '../ui/Modal.jsx';
import Button from '../ui/Button.jsx';
import Confetti from '../ui/Confetti.jsx';
import Counter from '../ui/Counter.jsx';
import { Chip, ProgressBar } from '../ui/Primitives.jsx';
import { Sparkline } from '../charts/Charts.jsx';
import { gradeRun, keyLabel, weakestKeys } from '../../lib/typing.js';
import { TIER_STYLES } from '../../lib/gamification.js';
import { cx, humanDuration } from '../../lib/format.js';

const GRADE_TONE = {
  S: 'text-brand',
  A: 'text-good',
  B: 'text-info',
  C: 'text-warn',
};

/**
 * Post-run screen. Shows the run, what it earned, and — the part that actually
 * changes behaviour — which keys cost you the most.
 */
export default function SessionSummary({ open, result, award, freshAchievements = [], history = [], onRetry, onNext, onClose, confettiEnabled = true }) {
  const [fire, setFire] = useState(false);

  useEffect(() => {
    if (open && confettiEnabled && (result?.isPB || freshAchievements.length)) {
      setFire(true);
    }
  }, [open, confettiEnabled, result?.isPB, freshAchievements.length]);

  if (!result) return null;

  const { grade, note } = gradeRun(result);
  const weak = weakestKeys(result.keyStats ?? {}, 5);

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="Session complete"
      description={note}
      footer={
        <div className="flex flex-wrap items-center justify-end gap-1">
          <Button variant="ghost" icon={RotateCcw} onClick={onRetry}>
            Retry
          </Button>
          <Button variant="primary" iconRight={ArrowRight} onClick={onNext} data-autofocus>
            Next exercise
          </Button>
        </div>
      }
    >
      <div className="relative">
        {fire ? <Confetti fire onDone={() => setFire(false)} /> : null}

        <div className="grid gap-2 p-3 sm:grid-cols-[auto_1fr]">
          {/* Grade */}
          <motion.div
            initial={{ scale: 0.7, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 300, damping: 18 }}
            className="grid h-[104px] w-[104px] place-items-center rounded-lg border border-line bg-subtle"
          >
            <span className={cx('font-mono text-5xl font-bold', GRADE_TONE[grade])}>{grade}</span>
          </motion.div>

          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
            <Metric label="WPM" value={Math.round(result.wpm)} accent />
            <Metric label="Accuracy" value={Math.round(result.accuracy)} suffix="%" />
            <Metric label="Consistency" value={Math.round(result.consistency)} suffix="%" />
            <Metric label="Raw" value={Math.round(result.rawWpm)} />
          </div>
        </div>

        {/* XP strip */}
        <div className="mx-3 mb-2 flex flex-wrap items-center gap-1.5 rounded-md border border-line bg-brand-wash/60 px-2 py-1.5">
          <Sparkles size={16} className="text-brand" aria-hidden />
          <p className="text-sm font-bold">
            +<Counter value={award?.xp ?? 0} /> XP
          </p>
          {result.isPB ? (
            <Chip tone="brand">
              <TrendingUp size={11} aria-hidden /> Personal best
            </Chip>
          ) : null}
          <span className="ml-auto text-xs text-ink-3">
            {humanDuration(result.durationSec)} · {result.chars} characters · {result.errors} errors
          </span>
        </div>

        {freshAchievements.length ? (
          <div className="mx-3 mb-2 space-y-1">
            {freshAchievements.map((a, i) => (
              <motion.div
                key={a.id}
                initial={{ opacity: 0, x: -12 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.15 + i * 0.1 }}
                className="flex items-center gap-1.5 rounded-md border px-2 py-1.5"
                style={{ borderColor: TIER_STYLES[a.tier].ring, background: TIER_STYLES[a.tier].wash }}
              >
                <span className="text-2xs font-bold uppercase tracking-[0.1em]" style={{ color: TIER_STYLES[a.tier].ring }}>
                  {a.tier}
                </span>
                <p className="text-sm font-bold">{a.name}</p>
                <p className="text-xs text-ink-3">{a.hint}</p>
              </motion.div>
            ))}
          </div>
        ) : null}

        <div className="grid gap-2 border-t border-line p-3 sm:grid-cols-2">
          <div>
            <h3 className="mb-1 text-sm font-bold">Keys that cost you</h3>
            {weak.length ? (
              <ul className="flex flex-wrap gap-0.5">
                {weak.map((k) => (
                  <li
                    key={k.key}
                    className="flex items-center gap-0.5 rounded-xs border border-line bg-subtle px-1 py-0.5 font-mono text-sm"
                    title={`${k.wrong} misses in ${k.total} attempts`}
                  >
                    <span className="font-bold">{keyLabel(k.key)}</span>
                    <span className="text-2xs text-bad tnum">{Math.round(k.rate * 100)}%</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-ink-3">No repeat offenders this run. Clean sheet.</p>
            )}
          </div>

          <div>
            <h3 className="mb-1 text-sm font-bold">Recent WPM</h3>
            {history.length > 1 ? (
              <div className="flex items-end gap-1.5">
                <Sparkline values={history} width={160} height={40} />
                <span className="text-2xs text-ink-3">last {history.length} runs</span>
              </div>
            ) : (
              <p className="text-sm text-ink-3">One more run and a trend line appears here.</p>
            )}
            <ProgressBar value={Math.min(1, result.accuracy / 100)} className="mt-1.5" label="Accuracy" />
          </div>
        </div>
      </div>
    </Modal>
  );
}

function Metric({ label, value, suffix = '', accent = false }) {
  return (
    <div className="rounded-md border border-line px-1.5 py-1">
      <p className={cx('font-mono text-2xl font-medium leading-none tnum', accent && 'text-brand')}>
        <Counter value={value} />
        {suffix}
      </p>
      <p className="mt-0.5 text-2xs font-bold uppercase tracking-[0.09em] text-ink-3">{label}</p>
    </div>
  );
}
