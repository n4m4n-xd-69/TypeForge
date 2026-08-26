import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, ArrowRight, Bot, Lock, Shield, Sparkles, Swords, Trophy, Users, Zap,
} from 'lucide-react';
import Button from '../../components/ui/Button.jsx';
import Segmented from '../../components/ui/Segmented.jsx';
import { Card, Chip } from '../../components/ui/Primitives.jsx';
import { Reveal } from '../../components/ui/Motion.jsx';
import PinInput from '../../components/battle/PinInput.jsx';
import { useToast } from '../../components/ui/Toast.jsx';
import { useAuth } from '../../lib/auth.jsx';
import { useStore } from '../../lib/store.jsx';
import { signInAnonymously } from '../../lib/supabase.js';
import { createShadowRoom, joinShadowRoom } from '../../lib/shadow/api.js';
import { BOT_PROFILES } from '../../lib/shadow/bot.js';
import { getStoredBotProfile, setStoredBotProfile } from '../../lib/shadow/trialSession.js';
import { useMatchmaking } from '../../lib/shadow/useMatchmaking.js';
import ShadowArena from './ShadowArena.jsx';
import { AVATAR_DEFS, AVATAR_OPTIONS, getAvatar } from './avatars.js';
import { cx } from '../../lib/format.js';

/**
 * Shadow Battle's entry point (PRD §22, SBR-HUB).
 *
 * Rebuilt to speak the same language as Arena and Battlefield: `Card` surfaces,
 * a tinted icon tile, `.eyebrow` mono labels, `font-display` headings,
 * `Segmented` pickers, the closed spacing scale and colour tokens throughout.
 * The previous version used ad-hoc `rounded-xl`/`gap-4`/`text-[11px]` values, a
 * hand-rolled tab strip, and three `variant="outline"` buttons — a variant
 * `Button.jsx` does not define, so those rendered with no background, border or
 * text colour at all. Two of them were the sign-in gates.
 *
 * See docs/superpowers/plans/2026-08-25-shadow-avatar-modes.md §6.
 */

const MODE_OPTIONS = [
  { value: 'trial', label: 'Trial', icon: Bot },
  { value: 'ranked', label: 'Ranked', icon: Trophy },
  { value: 'custom', label: 'Custom', icon: Users },
];

/** Chip tone from the profile's own difficulty, not from a hardcoded id. */
const DIFFICULTY_TONE = {
  easy: 'good', normal: 'brand', hard: 'warn', expert: 'bad', adaptive: 'accent',
};

export default function ShadowHub() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user, cloudEnabled, openAuthModal } = useAuth();
  const { state } = useStore();

  const [mode, setMode] = useState('trial');
  const [avatar, setAvatar] = useState('stickman');
  const [selectedBot, setSelectedBot] = useState(() => getStoredBotProfile());
  const [inArena, setInArena] = useState(false);

  const [pin, setPin] = useState('');
  const [joining, setJoining] = useState(false);
  const [creating, setCreating] = useState(false);

  const matchmaking = useMatchmaking({
    rating: state.profile.rating || 1200,
    band: 'steel',
    onMatchFound: (room) => {
      toast('Opponent found. Entering the arena.', { tone: 'success' });
      navigate(`/shadow/${room.pin}`);
    },
  });

  const avatarDef = getAvatar(avatar);
  const botDef = BOT_PROFILES[selectedBot] ?? BOT_PROFILES.adept;

  const ensureAccount = async () => {
    if (user) return user;
    const guest = await signInAnonymously(state.profile.name || 'Fighter');
    if (!guest) {
      openAuthModal('sign-up');
      throw new Error('Sign in to duel online.');
    }
    return guest;
  };

  const onCreate = async () => {
    setCreating(true);
    try {
      await ensureAccount();
      const room = await createShadowRoom({ band: 'steel', isPrivate: true });
      navigate(`/shadow/${room.pin}`);
    } catch (err) {
      toast(err.message ?? 'Could not open a duel room.', { tone: 'error' });
    } finally {
      setCreating(false);
    }
  };

  const onJoin = async (code = pin) => {
    if (code.length !== 6 || joining) return;
    setJoining(true);
    try {
      await ensureAccount();
      const room = await joinShadowRoom(code);
      navigate(`/shadow/${room.pin}`);
    } catch (err) {
      toast(err.message ?? 'Could not join.', { tone: 'error' });
      setPin('');
    } finally {
      setJoining(false);
    }
  };

  if (inArena) {
    return (
      <ShadowArena
        mode="trial"
        avatar={avatar}
        botProfile={selectedBot}
        playerName={state.profile.name || 'Player'}
        opponentName={botDef.name}
        onExit={() => setInArena(false)}
      />
    );
  }

  return (
    <div className="space-y-3">
      <header>
        <Button as={Link} to="/arena" size="sm" variant="ghost" icon={ArrowLeft} className="-ml-1.5">
          Arena
        </Button>
        <p className="eyebrow mt-0.5">1v1 combat</p>
        <h1 className="mt-0.5 flex items-center gap-1 font-display text-3xl font-bold">
          Shadow Battle
          <Chip tone="accent">Duel</Chip>
        </h1>
        <p className="mt-0.5 max-w-[62ch] text-sm leading-relaxed text-ink-3">
          A tactical duel where every word is a move. Pick how you fight, pick who you fight,
          then go and take the round.
        </p>
      </header>

      {/* ── Avatar choice — the headline decision ──────────────────────── */}
      <Reveal>
        <section aria-labelledby="avatar-heading" className="space-y-1.5">
          <div className="flex flex-wrap items-center justify-between gap-1">
            <h2 id="avatar-heading" className="text-base font-bold">Choose your fighter</h2>
            <Segmented
              size="sm"
              label="Avatar"
              options={AVATAR_OPTIONS}
              value={avatar}
              onChange={setAvatar}
            />
          </div>

          <div className="grid gap-1.5 md:grid-cols-2">
            {AVATAR_DEFS.map((def) => (
              <AvatarCard
                key={def.id}
                def={def}
                selected={avatar === def.id}
                onSelect={() => setAvatar(def.id)}
              />
            ))}
          </div>
        </section>
      </Reveal>

      {/* ── How to play ───────────────────────────────────────────────── */}
      <Reveal delay={0.06}>
        <div className="grid gap-1.5 lg:grid-cols-[minmax(0,1fr)_300px]">
          <Card className="p-2.5">
            <div className="flex flex-wrap items-center justify-between gap-1">
              <p className="eyebrow">Opponent</p>
              <Segmented size="sm" label="Mode" options={MODE_OPTIONS} value={mode} onChange={setMode} />
            </div>

            {mode === 'trial' ? (
              <div className="mt-2 space-y-2">
                <p className="text-sm leading-relaxed text-ink-3">
                  Fight a simulated opponent offline. Five profiles, from a beginner who
                  fumbles to a mirror of your own best numbers. Results save locally and sync
                  when you next go online.
                </p>
                <Button
                  variant="primary"
                  size="lg"
                  className="w-full"
                  icon={Swords}
                  onClick={() => {
                    setStoredBotProfile(selectedBot);
                    setInArena(true);
                  }}
                >
                  Enter the arena as {avatarDef.name}
                </Button>
              </div>
            ) : null}

            {mode === 'ranked' ? (
              <div className="mt-2 space-y-2">
                <p className="text-sm leading-relaxed text-ink-3">
                  Queue against a live opponent near your rating in the Steel band.
                </p>
                {!cloudEnabled ? (
                  <Card className="bg-raised p-2">
                    <p className="text-sm text-ink-3">
                      Ranked needs the cloud, and this build has no Supabase keys. Trial mode
                      works fully offline.
                    </p>
                  </Card>
                ) : !user ? (
                  <Button variant="secondary" className="w-full" icon={Lock} onClick={() => openAuthModal('sign-in')}>
                    Sign in to play ranked
                  </Button>
                ) : (
                  <Button
                    variant={matchmaking.isSearching ? 'secondary' : 'primary'}
                    size="lg"
                    className="w-full"
                    loading={matchmaking.isSearching}
                    icon={matchmaking.isSearching ? undefined : Trophy}
                    onClick={() => (matchmaking.isSearching ? matchmaking.leaveQueue() : matchmaking.joinQueue())}
                  >
                    {matchmaking.isSearching ? 'Searching for an opponent…' : 'Find a match'}
                  </Button>
                )}
              </div>
            ) : null}

            {mode === 'custom' ? (
              <div className="mt-2 space-y-2">
                <p className="text-sm leading-relaxed text-ink-3">
                  Open a private room and share the code, or join one you were given.
                </p>
                {!cloudEnabled ? (
                  <Card className="bg-raised p-2">
                    <p className="text-sm text-ink-3">
                      Custom duels need the cloud, and this build has no Supabase keys.
                    </p>
                  </Card>
                ) : !user ? (
                  <Button variant="secondary" className="w-full" icon={Lock} onClick={() => openAuthModal('sign-in')}>
                    Sign in to open a duel
                  </Button>
                ) : (
                  <>
                    <Button
                      variant="primary"
                      className="w-full"
                      icon={Sparkles}
                      loading={creating}
                      disabled={joining}
                      onClick={onCreate}
                    >
                      {creating ? 'Opening…' : 'Open a private duel'}
                    </Button>

                    <div className="flex items-center gap-1" aria-hidden>
                      <span className="h-px flex-1 bg-line" />
                      <span className="eyebrow">or join</span>
                      <span className="h-px flex-1 bg-line" />
                    </div>

                    <div className="flex flex-col items-center gap-1.5">
                      <PinInput value={pin} onChange={setPin} onComplete={onJoin} disabled={joining || creating} />
                      <Button
                        variant="secondary"
                        className="w-full"
                        iconRight={ArrowRight}
                        loading={joining}
                        disabled={pin.length !== 6 || creating}
                        onClick={() => onJoin()}
                      >
                        Join duel
                      </Button>
                    </div>
                  </>
                )}
              </div>
            ) : null}
          </Card>

          {/* ── Side panel ───────────────────────────────────────────── */}
          <div className="space-y-1.5">
            {mode === 'trial' ? (
              <Card className="p-2.5">
                <p className="eyebrow">Bot profile</p>
                <div className="mt-1.5 space-y-1">
                  {Object.values(BOT_PROFILES).map((profile) => (
                    <button
                      key={profile.id}
                      type="button"
                      onClick={() => setSelectedBot(profile.id)}
                      aria-pressed={selectedBot === profile.id}
                      className={cx(
                        'flex w-full items-center justify-between gap-1 rounded-sm border p-1 text-left',
                        'transition-colors duration-fast ease-out',
                        selectedBot === profile.id
                          ? 'border-brand/50 bg-brand-wash'
                          : 'border-line bg-surface hover:border-line-strong',
                      )}
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-bold">{profile.name}</span>
                        <span className="block font-mono text-2xs text-ink-3 tnum">
                          {profile.wpmMean} wpm · {Math.round(profile.cleanRate * 100)}% acc
                        </span>
                      </span>
                      <Chip tone={DIFFICULTY_TONE[profile.difficulty] ?? 'neutral'}>
                        {profile.difficulty}
                      </Chip>
                    </button>
                  ))}
                </div>
              </Card>
            ) : null}

            {mode === 'ranked' ? (
              <Card className="p-2.5">
                <p className="eyebrow">Your record</p>
                <dl className="mt-1.5 space-y-1 text-sm">
                  <Row label="Rating" value={state.profile.rating || 1200} mono />
                  <Row label="Band" value="Steel" />
                  <Row label="Wins" value={state.profile.battleWins || 0} mono />
                </dl>
              </Card>
            ) : null}

            <Card className="p-2.5">
              <p className="eyebrow">Ruleset</p>
              <ul className="mt-1.5 space-y-1 text-sm text-ink-3">
                <li className="flex items-center gap-1">
                  <Shield size={14} className="shrink-0 text-accent" aria-hidden /> Best of three rounds
                </li>
                <li className="flex items-center gap-1">
                  <Zap size={14} className="shrink-0 text-brand" aria-hidden /> Overdrive at full Focus
                </li>
                <li className="flex items-center gap-1">
                  <Swords size={14} className="shrink-0 text-ink-3" aria-hidden /> 90 seconds a round
                </li>
              </ul>
            </Card>
          </div>
        </div>
      </Reveal>
    </div>
  );
}

/** One selectable fighter. A real button, so it is keyboard-reachable. */
function AvatarCard({ def, selected, onSelect }) {
  const Icon = def.icon;
  const tone = def.tone === 'accent'
    ? { tile: 'bg-accent-wash text-accent', rule: 'bg-accent', ring: 'border-accent/50 ring-1 ring-accent/25' }
    : { tile: 'bg-brand-wash text-brand', rule: 'bg-brand-solid', ring: 'border-brand/50 ring-1 ring-brand/25' };

  return (
    <Card
      as="button"
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cx(
        'relative w-full overflow-hidden p-2.5 text-left',
        'transition-[border-color,box-shadow,transform] duration-base ease-out hover:-translate-y-px',
        selected ? tone.ring : 'border-line',
      )}
    >
      <span className={cx('absolute inset-x-0 top-0 h-[3px]', tone.rule)} aria-hidden />

      <div className="flex items-center gap-1.5">
        <span className={cx('grid h-[36px] w-[36px] shrink-0 place-items-center rounded-md', tone.tile)}>
          <Icon size={19} strokeWidth={2.2} aria-hidden />
        </span>
        <div className="min-w-0">
          <h3 className="font-display text-lg font-bold tracking-[-0.02em]">{def.name}</h3>
          <p className="truncate text-xs text-ink-3">{def.tagline}</p>
        </div>
        {selected ? <Chip tone={def.tone} className="ml-auto shrink-0">Selected</Chip> : null}
      </div>

      <p className="mt-1.5 text-sm leading-relaxed text-ink-3">{def.description}</p>

      <ul className="mt-1.5 space-y-0.5">
        {def.beats.map((beat) => (
          <li key={beat} className="flex items-start gap-1 text-xs text-ink-2">
            <span
              className={cx('mt-[6px] h-1 w-1 shrink-0 rounded-full', def.tone === 'accent' ? 'bg-accent' : 'bg-brand')}
              aria-hidden
            />
            <span className="leading-relaxed">{beat}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function Row({ label, value, mono = false }) {
  return (
    <div className="flex items-center justify-between gap-1">
      <dt className="text-ink-3">{label}</dt>
      <dd className={cx('font-bold', mono && 'font-mono tnum')}>{value}</dd>
    </div>
  );
}
