import React, { useEffect, useState } from 'react';

/**
 * CombatAnnouncer — Screen-reader live region for combat events (PRD §22, §27).
 *
 * Emits live accessibility speech for round starts, attacks landed, parries,
 * Overdrive state, and match victory/defeat.
 */

export function CombatAnnouncer({ message = '' }) {
  const [announcement, setAnnouncement] = useState('');

  useEffect(() => {
    if (message) {
      setAnnouncement(message);
    }
  }, [message]);

  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className="sr-only pointer-events-none"
    >
      {announcement}
    </div>
  );
}
