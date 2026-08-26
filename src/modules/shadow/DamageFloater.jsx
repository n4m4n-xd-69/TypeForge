import React, { useEffect, useState } from 'react';
import { cx } from '../../lib/format.js';

/**
 * DamageFloater — Floating combat text overlays (PRD §12.3).
 * Renders animated damage, parries, heals, Focus changes, and whiff alerts.
 * Updated to use design system tokens (SBR-TH).
 */

export function DamageFloater({ notifications = [] }) {
  const [items, setItems] = useState([]);

  useEffect(() => {
    if (!notifications || notifications.length === 0) return;
    const latest = notifications[notifications.length - 1];
    const id = `${Date.now()}-${Math.random()}`;

    setItems((prev) => [...prev, { ...latest, id }]);

    const timer = setTimeout(() => {
      setItems((prev) => prev.filter((it) => it.id !== id));
    }, 1200);

    return () => clearTimeout(timer);
  }, [notifications]);

  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden z-20">
      {items.map((item) => (
        <div
          key={item.id}
          className={cx(
            'absolute transform -translate-x-1/2 animate-float-fade font-display font-black tracking-wider text-center select-none',
            item.kind === 'damage'
              ? 'text-bad text-2xl drop-shadow-[0_2px_8px_rgba(var(--bad),0.8)]'
              : item.kind === 'parry'
                ? 'text-accent text-xl drop-shadow-[0_2px_8px_rgba(var(--accent),0.8)]'
                : item.kind === 'heal'
                  ? 'text-good text-xl drop-shadow-[0_2px_8px_rgba(var(--good),0.8)]'
                  : item.kind === 'whiff'
                    ? 'text-bad text-lg drop-shadow-[0_2px_8px_rgba(var(--bad),0.8)]'
                    : 'text-warn text-lg drop-shadow-[0_2px_8px_rgba(var(--warn),0.8)]'
          )}
          style={{
            left: item.seat === 0 ? '35%' : '65%',
            top: '40%',
          }}
        >
          {item.text}
        </div>
      ))}
    </div>
  );
}
