import React, { useEffect, useState } from 'react';
import Confetti from '../../components/ui/Confetti.jsx';
import Counter from '../../components/ui/Counter.jsx';
import Button from '../../components/ui/Button.jsx';
import { Card } from '../../components/ui/Primitives.jsx';
import { cx } from '../../lib/format.js';
import { Trophy, RefreshCcw, LogOut } from 'lucide-react';

/**
 * MatchSummary — Post-match victory/defeat modal with combat stats (PRD §19.5, §22.2).
 * Updated to use Counter, Confetti, and Battlefield UI patterns (SBR-RES, SBR-TH).
 */
export function MatchSummary({
  outcome = 'win',
  roundsWon = 0,
  roundsLost = 0,
  stats = {},
  frBefore = 1200,
  frAfter = 1200,
  frDelta = 0,
  opponentName = 'Opponent',
  isBot = false,
  onPlayAgain,
  onExit,
}) {
  const isWin = outcome === 'win';
  const isDraw = outcome === 'draw';

  const [showStats, setShowStats] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setShowStats(true), 600);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-bg/90 backdrop-blur-md animate-fade-in">
      {isWin && <Confetti count={150} duration={3000} />}
      
      <Card className="w-full max-w-lg p-6 sm:p-8 flex flex-col gap-8 text-center border-line-strong shadow-2xl bg-surface relative overflow-hidden">
        
        {/* Background ambient glow based on outcome */}
        <div 
          className={cx(
            'absolute inset-0 opacity-10 pointer-events-none transition-colors duration-1000',
            isWin ? 'bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-good via-surface to-surface' :
            isDraw ? 'bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-warn via-surface to-surface' :
            'bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-bad via-surface to-surface'
          )}
        />

        {/* Outcome Title Banner */}
        <div className="flex flex-col gap-2 items-center relative z-10">
          <span
            className={cx(
              'font-display text-5xl sm:text-6xl font-black uppercase tracking-wider',
              isWin
                ? 'text-good drop-shadow-[0_0_24px_rgba(var(--good),0.6)]'
                : isDraw
                ? 'text-warn drop-shadow-[0_0_24px_rgba(var(--warn),0.6)]'
                : 'text-bad drop-shadow-[0_0_24px_rgba(var(--bad),0.6)]'
            )}
          >
            {isWin ? 'Victory' : isDraw ? 'Draw' : 'Defeat'}
          </span>
          <span className="text-sm font-mono text-ink-3 uppercase tracking-widest mt-2">
            vs. {opponentName} {isBot ? '(Trial Bot)' : ''}
          </span>
          <div className="text-3xl font-mono font-black text-ink mt-2 tracking-widest">
            {roundsWon} <span className="text-ink-4 mx-2">—</span> {roundsLost}
          </div>
        </div>

        {/* Forge Rating Change Banner (if rated) */}
        {!isBot && frDelta !== 0 && (
          <div className="flex items-center justify-center gap-4 p-4 rounded-xl bg-surface border border-line-strong font-mono relative z-10">
            <Trophy className="text-brand w-5 h-5" />
            <div className="flex items-center gap-3">
              <span className="text-sm text-ink-3 uppercase tracking-wide">Forge Rating</span>
              <span className="text-lg font-bold text-ink">{frBefore}</span>
              <span className="text-ink-4">→</span>
              <span className="text-lg font-bold text-ink">{frAfter}</span>
            </div>
            <span
              className={cx(
                'text-sm font-black px-2 py-0.5 rounded-md ml-2',
                frDelta > 0 ? 'bg-good/20 text-good' : 'bg-bad/20 text-bad'
              )}
            >
              {frDelta > 0 ? `+${frDelta}` : frDelta}
            </span>
          </div>
        )}

        {/* Combat Stats Grid */}
        <div className={cx('grid grid-cols-2 sm:grid-cols-3 gap-3 text-left transition-opacity duration-700 relative z-10', showStats ? 'opacity-100' : 'opacity-0')}>
          <StatBox label="Speed" value={stats.wpm || 0} suffix="WPM" />
          <StatBox label="Accuracy" value={stats.accuracy || 100} suffix="%" />
          <StatBox label="Best Chain" value={stats.bestChain || 0} suffix="x" colorClass="text-warn" />
          <StatBox label="Damage Dealt" value={stats.damageDealt || 0} colorClass="text-brand" />
          <StatBox label="Damage Taken" value={stats.damageTaken || 0} colorClass="text-accent" />
          <StatBox label="Clean Rate" value={(stats.cleanRate || 1) * 100} suffix="%" colorClass="text-good" />
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-3 mt-4 relative z-10">
          {onPlayAgain && (
            <Button
              variant="primary"
              className="flex-1 h-12 text-base font-bold"
              icon={RefreshCcw}
              onClick={onPlayAgain}
            >
              Rematch
            </Button>
          )}
          {onExit && (
            <Button
              variant="secondary"
              className="flex-1 h-12 text-base font-bold"
              icon={LogOut}
              onClick={onExit}
            >
              Exit Arena
            </Button>
          )}
        </div>
      </Card>
    </div>
  );
}

function StatBox({ label, value, suffix = '', colorClass = 'text-ink' }) {
  return (
    <div className="p-3 bg-surface border border-line rounded-xl hover:border-line-strong transition-colors">
      <div className="text-[10px] font-mono text-ink-3 uppercase tracking-wider mb-1">{label}</div>
      <div className={cx('text-xl font-mono font-bold flex items-baseline gap-1', colorClass)}>
        <Counter value={value} duration={1200} />
        {suffix && <span className="text-xs text-ink-4">{suffix}</span>}
      </div>
    </div>
  );
}
