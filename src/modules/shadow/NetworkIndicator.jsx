import { Wifi, WifiOff, Zap } from 'lucide-react';
import { cx } from '../../lib/format.js';

/**
 * NetworkIndicator — Connection status chip with ping display (SBR-NET).
 *
 * Modes:
 *   - 'local'   → Trial/Bot mode, no ping needed
 *   - 'live'    → Connected, shows ping in ms
 *   - 'slow'    → Connected but high latency (>150ms)
 *   - 'offline' → Disconnected
 */
export default function NetworkIndicator({ mode = 'local', pingMs = 0 }) {
  if (mode === 'local') {
    return (
      <span className="flex items-center gap-1 text-2xs font-bold text-ink-3" title="Playing locally">
        <Zap size={12} aria-hidden />
        Local
      </span>
    );
  }

  if (mode === 'offline') {
    return (
      <span className="flex items-center gap-1 text-2xs font-bold text-bad" title="Disconnected">
        <WifiOff size={12} aria-hidden />
        Offline
      </span>
    );
  }

  const isHigh = mode === 'slow' || pingMs > 150;

  return (
    <span
      className={cx(
        'flex items-center gap-1 text-2xs font-bold',
        isHigh ? 'text-warn' : 'text-good',
      )}
      title={`Ping: ${pingMs}ms`}
    >
      <Wifi size={12} aria-hidden />
      {isHigh ? 'Slow' : 'Live'}
      <span className="font-mono tnum">{pingMs}ms</span>
    </span>
  );
}
