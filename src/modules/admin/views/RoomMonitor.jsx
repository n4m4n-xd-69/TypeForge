import { useEffect, useMemo, useState } from 'react';
import { Radio, ShieldAlert, Users, WifiOff, X } from 'lucide-react';
import Button, { IconButton } from '../../../components/ui/Button.jsx';
import { Chip, ProgressBar } from '../../../components/ui/Primitives.jsx';
import Avatar from '../../../components/ui/Avatar.jsx';
import { cx, mmss, relativeTime } from '../../../lib/format.js';
import { fetchLiveMatches, subscribeToTables } from '../api/console.js';

/**
 * One room, full screen, for watching.
 *
 * A monitoring view has different priorities from the console it launches from,
 * and they push in the opposite direction to the usual admin instinct to show
 * everything: the operator is watching a race that will be over in two minutes,
 * so the numbers have to be readable across a desk and the layout must not move
 * under them. Hence the large type, the fixed row order, and the deliberate
 * absence of anything that reflows as data arrives.
 *
 * Read-only apart from one action, and that action is behind a confirmation
 * that lives in the parent. Everything here reports; nothing here decides.
 *
 * It reuses `admin_live_matches` rather than adding a per-room subscription.
 * That function already returns the full roster with progress, WPM and
 * accuracy, it is already subscribed and polled by the Arena board, and one
 * shared feed cannot show two different truths on two screens the way two
 * feeds can.
 */
export default function RoomMonitor({ roomId, onClose, onRemove, canModerate }) {
  const [rooms, setRooms] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    let timer = null;

    const load = () => {
      fetchLiveMatches()
        .then((rows) => { if (!cancelled) { setRooms(rows ?? []); setError(null); } })
        .catch((e) => { if (!cancelled) setError(e); });
    };

    load();
    /* Faster than the board behind it: this screen exists to be watched, and a
       five-second board refresh is visible as staleness when it is the only
       thing on screen. Realtime still does the real work when enabled. */
    timer = setInterval(load, 2000);
    const stop = subscribeToTables(['battle_rooms', 'battle_players'], load);

    return () => {
      cancelled = true;
      clearInterval(timer);
      stop();
    };
  }, [roomId]);

  const room = useMemo(
    () => (rooms ?? []).find((r) => r.room_id === roomId) ?? null,
    [rooms, roomId],
  );

  /* Escape closes, the page behind stops scrolling, and focus goes back to
     whatever opened this. No focus *trap*: the surface is read-only and holds
     at most two controls, so trapping would cost more than it protects — but
     it does claim `aria-modal`, and a screen reader told the rest of the page
     is inert while it still scrolls is the inconsistency worth fixing. */
  useEffect(() => {
    const restoreTo = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
      restoreTo?.focus?.();
    };
  }, [onClose]);

  const roster = useMemo(() => {
    const list = Array.isArray(room?.roster) ? [...room.roster] : [];
    /* Sorted by progress, but only once per render from the server's own
       ordering — the rows are keyed by user id so React moves them rather than
       rebuilding, and a name never swaps places with a stale number. */
    return list.sort((a, b) => (Number(b.progress) || 0) - (Number(a.progress) || 0));
  }, [room]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-bg" role="dialog" aria-modal="true" aria-label="Room monitor">
      {/* ── header ─────────────────────────────────────────────────────── */}
      <header className="flex flex-wrap items-center gap-1.5 border-b border-line px-2.5 py-1.5">
        <Radio size={16} className="text-brand" aria-hidden />
        <span className="font-mono text-lg font-bold tracking-[0.12em]">{room?.pin ?? '······'}</span>
        {room ? <Chip tone={TONE[room.status] ?? 'neutral'}>{room.status}</Chip> : null}
        <span className="flex items-center gap-0.5 text-sm text-ink-3">
          <Users size={13} aria-hidden />
          {room ? `${room.players}/${room.capacity}` : '—'}
        </span>
        {room?.deadline_at ? <Remaining deadline={room.deadline_at} /> : null}
        {room?.started_at ? (
          <span className="text-xs text-ink-3">started {relativeTime(room.started_at)}</span>
        ) : null}

        <div className="ml-auto flex items-center gap-1">
          {canModerate && room ? (
            <Button size="sm" variant="ghost" icon={ShieldAlert} onClick={() => onRemove(room)}>
              Remove room
            </Button>
          ) : null}
          <IconButton label="Close monitor (Escape)" icon={X} onClick={onClose} />
        </div>
      </header>

      {/* ── the field ──────────────────────────────────────────────────── */}
      <div className="min-h-0 flex-1 overflow-y-auto px-2.5 py-2">
        {error ? (
          <p className="mx-auto mt-8 max-w-[40ch] text-center text-sm text-bad">
            Could not read the room: {error.message}
          </p>
        ) : rooms === null ? (
          <p className="mx-auto mt-8 text-center text-sm text-ink-3">Loading…</p>
        ) : !room ? (
          /* A room that leaves `admin_live_matches` has ended — settled,
             aborted or removed. Saying so beats an empty grid that looks like a
             loading state that never finished. */
          <div className="mx-auto mt-8 max-w-[44ch] text-center">
            <WifiOff size={24} className="mx-auto text-ink-3" aria-hidden />
            <p className="mt-1 text-base font-bold">This room is no longer live</p>
            <p className="mt-0.5 text-sm text-ink-3">
              It finished, was closed by its host, or was removed. Its results are on the Arena board.
            </p>
            <Button variant="secondary" className="mt-2" onClick={onClose}>Back to Arena</Button>
          </div>
        ) : roster.length === 0 ? (
          <p className="mx-auto mt-8 text-center text-sm text-ink-3">Nobody has joined this room yet.</p>
        ) : (
          <ul className="space-y-1">
            {roster.map((p, i) => (
              <li
                key={p.user_id}
                className="flex items-center gap-2 rounded-md border border-line bg-surface px-2 py-1.5"
              >
                <span className="w-[26px] shrink-0 text-center font-mono text-lg font-bold tnum text-ink-3">
                  {i + 1}
                </span>
                <Avatar value={p.avatar} name={p.name} size={38} />

                <div className="min-w-0 flex-[2]">
                  <p className="truncate text-base font-bold">{p.name || 'anon'}</p>
                  <p className="text-2xs text-ink-3">{p.status ?? 'racing'}</p>
                </div>

                <div className="min-w-0 flex-[3]">
                  <ProgressBar
                    value={(Number(p.progress) || 0) / 100}
                    tone={p.status === 'finished' ? 'good' : p.status === 'forfeit' ? 'warn' : 'brand'}
                    label={`${p.name} progress`}
                  />
                  <p className="mt-0.5 text-right font-mono text-2xs tnum text-ink-3">
                    {Math.round(Number(p.progress) || 0)}%
                  </p>
                </div>

                {/* Fixed-width, tabular figures: a monitoring readout that
                    shifts sideways as digits change is unreadable at a glance,
                    which is the only way this screen is ever read. */}
                <Readout label="WPM" value={Math.round(p.wpm ?? 0)} lead />
                <Readout label="ACC" value={`${Math.round(p.accuracy ?? 0)}%`} />
              </li>
            ))}
          </ul>
        )}
      </div>

      <footer className="border-t border-line px-2.5 py-1 text-2xs text-ink-3">
        Read-only monitor · refreshes every 2s and on change · press Escape to close
      </footer>
    </div>
  );
}

const TONE = { active: 'good', countdown: 'warn', lobby: 'neutral', finished: 'neutral' };

function Readout({ label, value, lead = false }) {
  return (
    <div className="w-[72px] shrink-0 text-right">
      <p className={cx('font-mono font-medium leading-none tnum', lead ? 'text-2xl text-brand' : 'text-lg')}>
        {value}
      </p>
      <p className="mt-0.5 text-2xs font-bold uppercase tracking-[0.09em] text-ink-3">{label}</p>
    </div>
  );
}

/** Time left on the server's deadline, ticked locally once a second. */
function Remaining({ deadline }) {
  const [left, setLeft] = useState(() => Date.parse(deadline) - Date.now());
  useEffect(() => {
    const id = setInterval(() => setLeft(Date.parse(deadline) - Date.now()), 1000);
    return () => clearInterval(id);
  }, [deadline]);

  return (
    <span className={cx('font-mono text-sm font-bold tnum', left <= 15_000 ? 'text-warn' : 'text-ink-2')}>
      {mmss(Math.max(0, left / 1000))}
    </span>
  );
}
