import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { AlertTriangle, ArrowLeft, RotateCcw } from 'lucide-react';
import Button from '../../components/ui/Button.jsx';
import { Card, Chip } from '../../components/ui/Primitives.jsx';
import Avatar from '../../components/ui/Avatar.jsx';
import Confetti from '../../components/ui/Confetti.jsx';
import Counter from '../../components/ui/Counter.jsx';
import { Reveal } from '../../components/ui/Motion.jsx';
import { useStore } from '../../lib/store.jsx';
import { cx, humanDuration } from '../../lib/format.js';

const MEDALS = ['🥇', '🥈', '🥉'];

/**
 * Who won, and why.
 *
 * The "why" is not decoration. Ranking is mistakes-first, so a 45 WPM run beats
 * a 56 WPM run with two typos — correct by the rules and genuinely surprising if
 * all you see is a table sorted by a column that is not WPM. Naming the
 * criterion that actually broke the tie turns a confusing result into a legible
 * one.
 */
export default function ResultsView({ battle, onLeave }) {
  const { room, me } = battle;
  const loadingResults = battle.results === null;
  const results = battle.results ?? [];
  const { state, recordBattleRank } = useStore();
  const [fire, setFire] = useState(false);

  const mine = useMemo(
    () => results.find((r) => r.user_id === me?.user_id) ?? null,
    [results, me],
  );

  /* The run was recorded when it finished; the placing only exists now. */
  useEffect(() => {
    if (mine?.rank) recordBattleRank(mine.rank);
  }, [mine?.rank, recordBattleRank]);

  useEffect(() => {
    if (mine && mine.rank <= 3 && state.settings.confetti) setFire(true);
  }, [mine, state.settings.confetti]);

  const podium = results.slice(0, 3);

  const stats = useMemo(() => {
    const finishers = results.filter((r) => r.finished);
    if (!results.length) return null;
    return {
      fastest: Math.max(0, ...results.map((r) => r.wpm ?? 0)),
      cleanest: Math.min(...results.map((r) => r.mistakes ?? 0)),
      average: results.reduce((a, r) => a + (r.wpm ?? 0), 0) / results.length,
      finishers: finishers.length,
      total: results.length,
    };
  }, [results]);

  return (
    <div className="space-y-3">
      {fire ? <Confetti fire onDone={() => setFire(false)} /> : null}

      <header className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="eyebrow">Battlefield {room.pin}</p>
          <h1 className="mt-0.5 text-3xl font-bold">
            {mine ? headline(mine.rank) : loadingResults ? 'Settling the match…' : 'Match over'}
          </h1>
          {mine ? (
            <p className="mt-0.5 text-sm text-ink-3">{whyWon(results, mine)}</p>
          ) : null}
        </div>
        <div className="flex gap-1">
          <Button as={Link} to="/battle" variant="primary" icon={RotateCcw}>Play again</Button>
          <Button variant="ghost" icon={ArrowLeft} onClick={onLeave}>Leave</Button>
        </div>
      </header>

      {/* ── podium ───────────────────────────────────────────────────── */}
      {podium.length ? (
        <Reveal>
          <div className="grid gap-2.5 sm:grid-cols-3">
            {podium.map((r, i) => (
              <motion.div
                key={r.user_id}
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.08 * i, duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
              >
                <Card className={cx(
                  'flex flex-col items-center p-3 text-center',
                  i === 0 && 'border-brand bg-brand-wash/40',
                  r.user_id === me?.user_id && 'ring-2 ring-brand ring-offset-2 ring-offset-bg',
                )}
                >
                  <span className="text-4xl" aria-hidden>{MEDALS[i]}</span>
                  <Avatar value={r.avatar} name={r.display_name} size={48} className="mt-1" ring={i === 0} />
                  <p className="mt-1 truncate text-sm font-bold">{r.display_name || 'Player'}</p>
                  <p className="mt-1 font-mono text-3xl font-medium tnum text-brand">
                    <Counter value={Math.round(r.wpm ?? 0)} />
                  </p>
                  <p className="text-2xs font-bold uppercase tracking-[0.09em] text-ink-3">wpm</p>
                  <p className="mt-1 text-xs text-ink-3">
                    {r.mistakes} mistakes · {Math.round(r.accuracy ?? 0)}%
                  </p>
                </Card>
              </motion.div>
            ))}
          </div>
        </Reveal>
      ) : null}

      {/* ── full table ───────────────────────────────────────────────── */}
      <Reveal delay={0.1}>
        <Card className="overflow-hidden">
          <div className="border-b border-line px-2.5 py-1.5">
            <h2 className="text-sm font-bold">Final ranking</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-2xs font-bold uppercase tracking-[0.08em] text-ink-3">
                  <Th className="w-[46px]">#</Th>
                  <Th>Player</Th>
                  <Th align="right">Mistakes</Th>
                  <Th align="right">WPM</Th>
                  <Th align="right">Accuracy</Th>
                  <Th align="right">Time</Th>
                </tr>
              </thead>
              <tbody>
                {results.map((r) => {
                  const dnf = !r.finished;
                  return (
                    <tr
                      key={r.user_id}
                      className={cx(
                        'border-b border-line last:border-0',
                        r.user_id === me?.user_id && 'bg-brand-wash/40',
                        dnf && 'opacity-70',
                      )}
                    >
                      <Td className="font-mono font-bold tnum">
                        {r.rank <= 3 ? MEDALS[r.rank - 1] : r.rank}
                      </Td>
                      <Td>
                        <span className="flex items-center gap-1">
                          <Avatar value={r.avatar} name={r.display_name} size={22} />
                          <span className="truncate font-bold">{r.display_name || 'Player'}</span>
                          {r.user_id === me?.user_id ? <span className="text-2xs text-brand">you</span> : null}
                          {dnf ? <Chip tone="warn">DNF</Chip> : null}
                          {r.flags?.length ? (
                            <span title={r.flags.join(', ')} className="text-warn">
                              <AlertTriangle size={12} aria-hidden />
                            </span>
                          ) : null}
                        </span>
                      </Td>
                      <Td align="right" className={cx('font-mono tnum', r.mistakes === 0 && 'font-bold text-good')}>
                        {r.mistakes}
                      </Td>
                      <Td align="right" className="font-mono tnum">{Math.round(r.wpm ?? 0)}</Td>
                      <Td align="right" className="font-mono tnum">{Math.round(r.accuracy ?? 0)}%</Td>
                      <Td align="right" className="font-mono tnum text-ink-3">
                        {dnf ? '—' : humanDuration(r.duration_sec ?? 0)}
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {results.length === 0 ? (
            <p className="px-2.5 py-3 text-sm text-ink-3">
              {loadingResults ? 'Loading the ranking…' : 'No results were recorded for this match.'}
            </p>
          ) : null}
        </Card>
      </Reveal>

      {/* ── match stats ──────────────────────────────────────────────── */}
      {stats ? (
        <Reveal delay={0.14}>
          <div className="grid gap-2.5 sm:grid-cols-4">
            <Stat label="Fastest" value={Math.round(stats.fastest)} suffix=" wpm" />
            <Stat label="Cleanest" value={stats.cleanest} suffix={stats.cleanest === 1 ? ' mistake' : ' mistakes'} />
            <Stat label="Field average" value={Math.round(stats.average)} suffix=" wpm" />
            <Stat label="Finished" value={stats.finishers} suffix={` of ${stats.total}`} />
          </div>
        </Reveal>
      ) : null}
    </div>
  );
}

function headline(rank) {
  if (rank === 1) return 'You won';
  if (rank === 2) return 'Second place';
  if (rank === 3) return 'Third place';
  return `Finished ${ordinal(rank)}`;
}

function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

/**
 * Which comparison actually decided it, walked in the same order the SQL uses.
 * Comparing against the player one rank above (or below, for the winner) is what
 * makes the answer specific rather than a restatement of the rules.
 */
function whyWon(results, mine) {
  const other = mine.rank === 1 ? results[1] : results[mine.rank - 2];
  if (!other) return 'The only run recorded.';

  if (!mine.finished && other.finished) return 'Every finisher outranks an unfinished run.';
  if (mine.finished && !other.finished) return 'You finished the passage and they did not.';

  const [a, b] = mine.rank === 1 ? [mine, other] : [other, mine];
  if (a.mistakes !== b.mistakes) {
    return mine.rank === 1
      ? `Won on mistakes — ${a.mistakes} against ${b.mistakes}.`
      : `Lost on mistakes — ${b.mistakes} against ${a.mistakes}.`;
  }
  if (Math.round(a.wpm) !== Math.round(b.wpm)) {
    return `Tied on ${a.mistakes} mistakes, decided on speed.`;
  }
  if (Math.round(a.accuracy) !== Math.round(b.accuracy)) {
    return 'Tied on mistakes and speed, decided on accuracy.';
  }
  return 'Decided on who finished first.';
}

function Stat({ label, value, suffix }) {
  return (
    <Card className="p-2.5">
      <p className="text-2xs font-bold uppercase tracking-[0.09em] text-ink-3">{label}</p>
      <p className="mt-0.5 font-mono text-2xl font-medium tnum">
        <Counter value={value} />
        <span className="text-sm text-ink-3">{suffix}</span>
      </p>
    </Card>
  );
}

function Th({ children, align = 'left', className }) {
  return <th className={cx('px-2 py-1.5', align === 'right' && 'text-right', align === 'left' && 'text-left', className)}>{children}</th>;
}

function Td({ children, align = 'left', className }) {
  return <td className={cx('px-2 py-1.5', align === 'right' && 'text-right', className)}>{children}</td>;
}
