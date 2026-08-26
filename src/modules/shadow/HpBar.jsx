import { useEffect, useState } from 'react';
import { cx } from '../../lib/format.js';

/**
 * HP bar with a delayed ghost drain and round pips (PRD §19.2, SBR-TH).
 *
 * HP arrives in integer tenths (`roundState.MAX_HP_TENTHS = 1000` = 100.0 HP),
 * so the readout divides — showing "1000 / 1000" was reporting the engine's
 * internal unit to the player.
 *
 * On the closed spacing scale and the app type scale throughout: this used
 * `h-5` (40px on this config, not the 20px Tailwind's default scale implies),
 * `w-2.5 h-2.5` pips and a raw `text-[11px]`.
 */
export function HpBar({
  hp = 1000,
  maxHp = 1000,
  score = 0,
  isOpponent = false,
  playerName = 'Fighter',
  fighterId = '',
}) {
  const [ghostHp, setGhostHp] = useState(hp);

  /* The ghost bar lags a hit so the size of the hit is legible after it lands. */
  useEffect(() => {
    if (hp >= ghostHp) {
      setGhostHp(hp);
      return undefined;
    }
    const timer = setTimeout(() => setGhostHp(hp), 350);
    return () => clearTimeout(timer);
  }, [hp, ghostHp]);

  const pct = Math.max(0, Math.min(100, (hp / maxHp) * 100));
  const ghostPct = Math.max(0, Math.min(100, (ghostHp / maxHp) * 100));
  const critical = pct <= 25;
  const fill = isOpponent ? 'bg-accent' : 'bg-brand-solid';

  return (
    <div className={cx('flex w-full flex-col gap-0.5', isOpponent && 'items-end')}>
      <div className={cx('flex w-full items-center gap-1', isOpponent && 'flex-row-reverse')}>
        <span className="truncate font-display text-sm font-bold">{playerName}</span>
        {fighterId ? <span className="eyebrow shrink-0">{fighterId}</span> : null}

        {/* Best of three: two pips is the win condition, not three. */}
        <div className={cx('flex shrink-0 items-center gap-0.5', isOpponent ? 'mr-auto' : 'ml-auto')}>
          {[0, 1].map((pip) => (
            <span
              key={pip}
              aria-hidden
              className={cx(
                'h-1 w-1 rounded-full transition-colors duration-base',
                score > pip ? fill : 'bg-line',
              )}
            />
          ))}
        </div>
      </div>

      <div
        className="relative h-[18px] w-full overflow-hidden rounded-sm border border-line bg-raised"
        role="progressbar"
        aria-valuenow={Math.round(hp / 10)}
        aria-valuemin={0}
        aria-valuemax={Math.round(maxHp / 10)}
        aria-label={`${playerName} health`}
      >
        {/* Ghost drain — warn, so it reads as "this just happened". */}
        <span
          aria-hidden
          className={cx(
            'absolute inset-y-0 bg-warn/50 transition-[width] duration-slow ease-out',
            isOpponent ? 'right-0' : 'left-0',
          )}
          style={{ width: `${ghostPct}%` }}
        />
        <span
          aria-hidden
          className={cx(
            'absolute inset-y-0 transition-[width] duration-fast ease-out',
            fill,
            isOpponent ? 'right-0' : 'left-0',
            critical && 'animate-pulse',
          )}
          style={{ width: `${pct}%` }}
        />
        <span className="absolute inset-0 grid place-items-center">
          <span className="font-mono text-2xs font-bold text-ink tnum">
            {(hp / 10).toFixed(0)}
          </span>
        </span>
      </div>
    </div>
  );
}
