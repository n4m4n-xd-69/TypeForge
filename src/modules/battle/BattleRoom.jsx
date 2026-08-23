import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, Check, Copy, Crown, DoorOpen, Loader2, Play, Users, X } from 'lucide-react';
import Button, { IconButton } from '../../components/ui/Button.jsx';
import { Card, Chip, EmptyState } from '../../components/ui/Primitives.jsx';
import Avatar from '../../components/ui/Avatar.jsx';
import { Reveal } from '../../components/ui/Motion.jsx';
import { useToast } from '../../components/ui/Toast.jsx';
import { useCopyToClipboard } from '../../lib/useCopyToClipboard.js';
import { useAuth } from '../../lib/auth.jsx';
import { useStore } from '../../lib/store.jsx';
import { signInAnonymously } from '../../lib/supabase.js';
import useBattleRoom from '../../lib/battle/useBattleRoom.js';
import { abortBattle, joinBattle, kickPlayer, leaveBattle, startBattle } from '../../lib/battle/api.js';
import RaceView from './RaceView.jsx';
import ResultsView from './ResultsView.jsx';
import { cx } from '../../lib/format.js';

/**
 * One route for every phase of a room.
 *
 * The phase is a function of `room.status`, which is durable, so a refresh at
 * any moment reconstructs the right screen — no history entries to get wrong,
 * and no way to deep-link into a phase the room is not actually in.
 */
export default function BattleRoom() {
  const { pin } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user, cloudEnabled, ready } = useAuth();

  const battle = useBattleRoom(pin, user?.id ?? null);
  const { room, roster, phase, isAdmin, loading, error, connected } = battle;
  const [busy, setBusy] = useState(false);

  /* Landing on /battle/:pin from a shared link, without having joined. The room
     read is member-scoped, so the only way in is to actually join — then
     re-resolve the pin, because no room id exists yet to refresh by. */
  const autoJoined = useRef(false);
  useEffect(() => {
    if (!ready || !user || !error || room) return;
    if (error.code !== 'BF016' || autoJoined.current) return;
    autoJoined.current = true;
    joinBattle(pin)
      .then(() => battle.retry())
      .catch((e) => toast(e.message, { tone: 'error' }));
  }, [ready, user, error, room, pin, battle, toast]);

  const onLeave = useCallback(async () => {
    if (!room) { navigate('/battle'); return; }
    setBusy(true);
    try {
      await leaveBattle(room.id);
      navigate('/battle');
    } catch (err) {
      toast(err.message, { tone: 'error' });
    } finally {
      setBusy(false);
    }
  }, [room, navigate, toast]);

  if (!cloudEnabled) return <Frame><EmptyState icon={Users} title="Battlefield needs the cloud" description="This build has no Supabase keys configured." /></Frame>;
  if (!ready) return <Frame><EmptyState icon={Loader2} title="Loading…" /></Frame>;

  // Arriving on a shared link with no account. Every read here is member-scoped
  // and every RPC is revoked from anon, so there is genuinely nothing to show
  // until they have one — but "you have been invited" is the honest framing, and
  // a guest account is one tap away.
  if (!user) return <Invite pin={pin} />;

  if (loading) return <Frame><EmptyState icon={Loader2} title="Finding that Battlefield…" /></Frame>;

  if (error && !room) {
    return (
      <Frame>
        <EmptyState
          icon={AlertTriangle}
          title="That Battlefield is not open"
          description={error.message}
          action={<Button as={Link} to="/battle" variant="primary" icon={ArrowLeft}>Back to Battlefield</Button>}
        />
      </Frame>
    );
  }

  if (!room) return <Frame><EmptyState icon={Loader2} title="Loading…" /></Frame>;

  if (phase === 'closed') {
    return (
      <Frame>
        <EmptyState
          icon={DoorOpen}
          title={room.status === 'aborted' ? 'The host closed this Battlefield' : 'This Battlefield has expired'}
          description="Open a new one, or join another code."
          action={<Button as={Link} to="/battle" variant="primary">Back to Battlefield</Button>}
        />
      </Frame>
    );
  }

  if (phase === 'results') return <ResultsView battle={battle} onLeave={onLeave} />;
  if (phase === 'countdown' || phase === 'racing') return <RaceView battle={battle} />;

  return (
    <Lobby
      battle={battle}
      busy={busy}
      setBusy={setBusy}
      onLeave={onLeave}
      isAdmin={isAdmin}
      connected={connected}
      roster={roster}
      me={user?.id}
    />
  );
}

/* ── Invitation ────────────────────────────────────────────────────────── */

function Invite({ pin }) {
  const { toast } = useToast();
  const { state } = useStore();
  const { openAuthModal } = useAuth();
  const [busy, setBusy] = useState(false);

  const enter = async () => {
    setBusy(true);
    try {
      const guest = await signInAnonymously(state.profile.name || 'Player');
      if (!guest) { openAuthModal('sign-up'); return; }
      await joinBattle(pin);
      // useBattleRoom keys on the user id, so the room loads as soon as the
      // session lands — no navigation needed.
    } catch (err) {
      toast(err.message ?? 'Could not join.', { tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Frame>
      <Card className="mx-auto max-w-[440px] p-3 text-center">
        <span className="mx-auto grid h-[40px] w-[40px] place-items-center rounded-[13px] bg-brand-wash text-brand">
          <Users size={20} strokeWidth={2.2} aria-hidden />
        </span>
        <h1 className="mt-1.5 text-xl font-bold">You have been invited</h1>
        <p className="mt-0.5 text-sm text-ink-3">
          Battlefield <span className="font-mono font-bold tracking-[0.12em] text-ink">{pin?.toUpperCase()}</span>
        </p>
        <p className="mt-1.5 text-xs leading-relaxed text-ink-3">
          A name is enough — no email needed. Your progress saves straight away and you can attach an
          account later.
        </p>
        <Button variant="primary" className="mt-2.5 w-full" icon={busy ? Loader2 : Users} onClick={enter} disabled={busy}>
          {busy ? 'Joining…' : 'Enter the Battlefield'}
        </Button>
      </Card>
    </Frame>
  );
}

/* ── Lobby ─────────────────────────────────────────────────────────────── */

function Lobby({ battle, busy, setBusy, onLeave, isAdmin, connected, roster, me }) {
  const { room } = battle;
  const { toast } = useToast();
  const { copied, copy } = useCopyToClipboard();
  const shareUrl = `${window.location.origin}/battle/${room.pin}`;

  const onStart = async () => {
    setBusy(true);
    try {
      await startBattle(room.id);
    } catch (err) {
      toast(err.message, { tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const onKick = async (userId) => {
    try {
      await kickPlayer(room.id, userId);
    } catch (err) {
      toast(err.message, { tone: 'error' });
    }
  };

  const seats = Array.from({ length: room.max_players }, (_, i) => roster[i] ?? null);

  return (
    <Frame>
      <div className="grid gap-2.5 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
        {/* ── The code ───────────────────────────────────────────────── */}
        <Reveal>
          <Card className="p-3">
            <p className="eyebrow">Room code</p>
            <button
              type="button"
              onClick={() => { copy(room.pin); toast('Code copied', { tone: 'success' }); }}
              className="mt-1 flex w-full items-center justify-between gap-1 rounded-lg border border-line bg-subtle/50 px-2 py-2 transition-colors hover:border-line-strong"
              title="Copy the code"
            >
              <span className="font-mono text-4xl font-bold tracking-[0.18em]">{room.pin}</span>
              {copied ? <Check size={18} className="text-good" aria-hidden /> : <Copy size={18} className="text-ink-3" aria-hidden />}
            </button>

            <Button
              size="sm"
              variant="ghost"
              className="mt-1 w-full"
              icon={Copy}
              onClick={() => { copy(shareUrl); toast('Link copied', { tone: 'success' }); }}
            >
              Copy invite link
            </Button>

            <dl className="mt-2 space-y-1 border-t border-line pt-2 text-xs">
              <Row label="Players" value={`${roster.length} / ${room.max_players}`} />
              <Row label="Passage" value={`${room.passage_chars} characters`} />
              <Row label="Difficulty" value={room.difficulty} />
              <Row label="Time limit" value={`${Math.round(room.time_limit_sec / 60)} min`} />
              <Row label="Connection" value={connected ? 'Live' : 'Connecting…'} tone={connected ? 'good' : 'warn'} />
            </dl>

            {isAdmin ? (
              <>
                <Button
                  variant="primary"
                  className="mt-2.5 w-full"
                  icon={busy ? Loader2 : Play}
                  onClick={onStart}
                  disabled={busy || roster.length < 2}
                >
                  Start match
                </Button>
                {roster.length < 2 ? (
                  <p className="mt-1 text-center text-2xs text-ink-3">Waiting for one more player</p>
                ) : null}
                <Button
                  size="sm"
                  variant="ghost"
                  className="mt-1 w-full"
                  onClick={async () => { await abortBattle(room.id).catch(() => {}); onLeave(); }}
                >
                  Close this Battlefield
                </Button>
              </>
            ) : (
              <>
                <p className="mt-2.5 rounded-md border border-line bg-subtle/60 px-1.5 py-1.5 text-center text-xs text-ink-2">
                  Waiting for the host to start
                </p>
                <Button size="sm" variant="ghost" className="mt-1 w-full" onClick={onLeave} disabled={busy}>
                  Leave
                </Button>
              </>
            )}
          </Card>
        </Reveal>

        {/* ── The roster ─────────────────────────────────────────────── */}
        <Reveal delay={0.06}>
          <Card className="p-3">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold">Who is here</h2>
              <Chip tone={roster.length >= 2 ? 'good' : 'neutral'}>{roster.length} in</Chip>
            </div>

            <ul className="mt-2 grid gap-1.5 sm:grid-cols-2">
              {seats.map((p, i) => (
                <li key={p?.user_id ?? `empty-${i}`}>
                  {p ? (
                    <div className={cx(
                      'flex items-center gap-1.5 rounded-lg border px-1.5 py-1.5',
                      p.user_id === me ? 'border-brand bg-brand-wash/50' : 'border-line bg-surface',
                    )}
                    >
                      <Avatar value={p.avatar} name={p.display_name} size={34} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-bold">
                          {p.display_name || 'Player'}
                          {p.user_id === me ? <span className="ml-0.5 text-2xs text-brand">you</span> : null}
                        </p>
                        <p className="flex items-center gap-0.5 text-2xs text-ink-3">
                          {p.is_admin ? (<><Crown size={10} aria-hidden /> host</>) : 'ready'}
                        </p>
                      </div>
                      {isAdmin && p.user_id !== me ? (
                        <IconButton size="sm" label={`Remove ${p.display_name}`} icon={X} onClick={() => onKick(p.user_id)} />
                      ) : null}
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5 rounded-lg border border-dashed border-line px-1.5 py-1.5 opacity-60">
                      <span className="h-[34px] w-[34px] rounded-full border border-dashed border-line" aria-hidden />
                      <p className="text-sm text-ink-3">Empty seat</p>
                    </div>
                  )}
                </li>
              ))}
            </ul>

            <p className="mt-2 text-xs text-ink-3">
              The passage stays hidden until the countdown starts — nobody gets to read ahead.
            </p>
          </Card>
        </Reveal>
      </div>
    </Frame>
  );
}

function Row({ label, value, tone }) {
  return (
    <div className="flex items-center justify-between gap-1">
      <dt className="text-ink-3">{label}</dt>
      <dd className={cx('font-bold capitalize', tone === 'good' && 'text-good', tone === 'warn' && 'text-warn')}>{value}</dd>
    </div>
  );
}

function Frame({ children }) {
  return (
    <div className="space-y-3">
      <header className="flex items-center gap-1">
        <Button as={Link} to="/battle" size="sm" variant="ghost" icon={ArrowLeft}>Battlefield</Button>
      </header>
      {children}
    </div>
  );
}
