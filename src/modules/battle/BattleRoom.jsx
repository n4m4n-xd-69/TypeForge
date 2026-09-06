import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { toPresetValue } from '../../lib/avatars.js';
import useBattleRoom from '../../lib/battle/useBattleRoom.js';
import { abortBattle, joinBattle, kickPlayer, leaveBattle, startBattle } from '../../lib/battle/api.js';
import RaceView from './RaceView.jsx';
import ResultsView from './ResultsView.jsx';
import RoomRemoved from './RoomRemoved.jsx';
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

  /* Its own screen, not an error state — see RoomRemoved for why. Placed above
     the generic closed branch so a removed room can never fall through to
     "expired", which would be the wrong reason and offer no way to ask. */
  if (phase === 'removed') return <RoomRemoved roomId={room.id} pin={room.pin} />;

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

/**
 * The invite gate.
 *
 * An invite link already establishes everything about the context — which room,
 * which passage, which mode — so the only thing this screen may ask about is
 * the person. Two paths, and which one you get is decided by whether we
 * genuinely do not know your name:
 *
 *   Returning visitor  →  nothing at all. A stored name is enough to mint the
 *                         guest session and join, so the link resolves straight
 *                         into the room.
 *   Genuinely new      →  one screen: name and a face. Then the room.
 *
 * What is deliberately absent is the rest of onboarding. Someone arriving on a
 * Battlefield link has already said what they want to do by clicking it, and
 * asking them to pick a daily practice goal and a preferred discipline first is
 * a form standing between two people and a race.
 */
function Invite({ pin }) {
  const { toast } = useToast();
  const { state, updateProfile } = useStore();
  const { openAuthModal } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const known = (state.profile.name ?? '').trim();
  const [name, setName] = useState(known);
  const [avatar, setAvatar] = useState(state.profile.avatar ?? null);

  const enter = useCallback(async (displayName, chosenAvatar) => {
    const trimmed = (displayName ?? '').trim();
    if (!trimmed) return;
    setBusy(true);
    setError(null);
    try {
      updateProfile({ name: trimmed, avatar: chosenAvatar ?? null, onboarded: true });
      const guest = await signInAnonymously(trimmed);
      if (!guest) {
        // Anonymous sign-in is switched off for the project. Nothing this screen
        // can do about that, so hand over to the real sign-up rather than
        // failing silently on a button that looks like it should work.
        openAuthModal('sign-up');
        return;
      }
      await joinBattle(pin);
      // useBattleRoom keys on the user id, so the room loads as soon as the
      // session lands — no navigation needed.
    } catch (err) {
      setError(err.message ?? 'Could not join.');
      toast(err.message ?? 'Could not join.', { tone: 'error' });
    } finally {
      setBusy(false);
    }
  }, [pin, toast, updateProfile, openAuthModal]);

  /* A returning visitor is not asked anything — the link is the whole
     interaction. Guarded so a re-render cannot fire a second join. */
  const auto = useRef(false);
  useEffect(() => {
    if (auto.current || !known) return;
    auto.current = true;
    enter(known, state.profile.avatar ?? null);
  }, [known, enter, state.profile.avatar]);

  if (known && !error) {
    return (
      <Frame>
        <Card className="mx-auto max-w-[440px] p-3 text-center">
          <Loader2 size={20} className="mx-auto animate-spin text-brand" aria-hidden />
          <p className="mt-1.5 text-sm font-bold">Joining Battlefield {pin?.toUpperCase()}…</p>
          <p className="mt-0.5 text-xs text-ink-3">Entering as {known}</p>
        </Card>
      </Frame>
    );
  }

  return (
    <Frame>
      <Card className="mx-auto max-w-[440px] p-3">
        <div className="text-center">
          <span className="mx-auto grid h-[40px] w-[40px] place-items-center rounded-[13px] bg-brand-wash text-brand">
            <Users size={20} strokeWidth={2.2} aria-hidden />
          </span>
          <h1 className="mt-1.5 text-xl font-bold">You have been invited</h1>
          <p className="mt-0.5 text-sm text-ink-3">
            Battlefield <span className="font-mono font-bold tracking-[0.12em] text-ink">{pin?.toUpperCase()}</span>
          </p>
        </div>

        <form
          className="mt-2.5"
          onSubmit={(e) => { e.preventDefault(); enter(name, avatar); }}
        >
          <label htmlFor="invite-name" className="text-sm font-bold">Pick a name</label>
          <input
            id="invite-name"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={24}
            placeholder="Your name"
            className="mt-1 h-[44px] w-full rounded-md border border-line bg-subtle/50 px-1.5 text-base outline-none focus:border-brand"
          />

          <p className="mt-2 text-sm font-bold">And a face</p>
          <AvatarPicker value={avatar} onChange={setAvatar} name={name} />

          {error ? (
            <p className="mt-1.5 rounded-md border border-bad/40 bg-bad/10 px-1.5 py-1 text-xs text-bad" role="alert">
              {error}
            </p>
          ) : null}

          <Button
            type="submit"
            variant="primary"
            className="mt-2.5 w-full"
            icon={busy ? Loader2 : Users}
            disabled={busy || !name.trim()}
          >
            {busy ? 'Joining…' : 'Enter the Battlefield'}
          </Button>
          <p className="mt-1 text-center text-2xs text-ink-3">
            No email needed. You can attach an account later and keep everything.
          </p>
        </form>
      </Card>
    </Frame>
  );
}

/** A short row of preset faces — enough to feel chosen, not enough to browse. */
function AvatarPicker({ value, onChange, name }) {
  const choices = useMemo(() => INVITE_AVATARS.map(toPresetValue), []);
  return (
    <div className="mt-1 flex flex-wrap gap-1" role="radiogroup" aria-label="Choose an avatar">
      {choices.map((preset) => (
        <button
          key={preset}
          type="button"
          role="radio"
          aria-checked={value === preset}
          aria-label={preset.replace('preset:', '')}
          onClick={() => onChange(preset)}
          className={cx(
            'rounded-full p-px transition-colors',
            value === preset ? 'ring-2 ring-brand ring-offset-2 ring-offset-surface' : 'opacity-70 hover:opacity-100',
          )}
        >
          <Avatar value={preset} name={name} size={38} />
        </button>
      ))}
    </div>
  );
}

/* A deliberate handful rather than all twenty-four: this is a gate on the way
   into a race, and the full picker lives on the profile screen. */
const INVITE_AVATARS = ['cat', 'fox', 'panda', 'bunny', 'frog', 'dog', 'bear', 'kitten'];

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
