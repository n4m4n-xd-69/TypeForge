import React from 'react';
import { cx } from '../../lib/format.js';

/**
 * ChainIndicator — Visual badge for combo chains (SBR-VFX).
 * Grows in intensity and size as the chain increases.
 */
export function ChainIndicator({ chain = 0 }) {
  if (chain < 2) return null;

  const isHigh = chain >= 5;
  const isMax = chain >= 10;

  return (
    <div
      className={cx(
        'flex items-center justify-center font-display font-black italic tracking-tighter',
        isMax
          ? 'text-warn drop-shadow-[0_0_12px_rgba(var(--warn),0.8)] scale-110'
          : isHigh
            ? 'text-brand drop-shadow-[0_0_8px_rgba(var(--brand),0.6)] scale-105'
            : 'text-ink-2 drop-shadow-md',
      )}
    >
      <span className="text-[10px] mr-0.5">X</span>
      <span className="text-xl">{chain}</span>
    </div>
  );
}
