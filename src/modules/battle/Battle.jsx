import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Loader2, LogIn, Swords, Timer, Trophy, Users } from 'lucide-react';
import Button from '../../components/ui/Button.jsx';
import Segmented from '../../components/ui/Segmented.jsx';
import { Card, Chip } from '../../components/ui/Primitives.jsx';
import { Reveal } from '../../components/ui/Motion.jsx';
import PinInput from '../../components/battle/PinInput.jsx';
import { useToast } from '../../components/ui/Toast.jsx';
import { useAuth } from '../../lib/auth.jsx';
import { useStore } from '../../lib/store.jsx';
import { signInAnonymously } from '../../lib/supabase.js';
import { createBattle, joinBattle } from '../../lib/battle/api.js';
import { LENGTH_PRESETS, pickBattlePassage, presetById } from '../../lib/battle/passage.js';
import { cx } from '../../lib/format.js';

const DIFFICULTIES = [
  { value: 'easy', label: 'Easy' },
  { value: 'normal', label: 'Normal' },
  { value: 'hard', label: 'Hard' },
  { value: 'expert', label: 'Expert' },
];

/**
 * The Battlefield hub: open one, or join one.
 *
 * Signing in is not a wall. `signInAnonymously` already mints a real auth.users
 * row from nothing but a name — the same mechanism onboarding uses — so someone
 * handed a room code can be racing in two clicks without an email. Every RLS
 * policy keys on auth.uid() and does not care that the account is a guest.
 */
export default function Battle() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user, cloudEnabled, openAuthModal } = useAuth();
  const { state } = useStore();

  const [pin, setPin] = useState('');
  const [joining, setJoining] = useState(false);
  const [creating, setCreating] = useState(false);
  const [difficulty, setDifficulty] = useState('normal');
  const [preset, setPreset] = useState('standard');
  const [maxPlayers, setMaxPlayers] = useState(8);

  if (!cloudEnabled) {
    return (
      <Shell>
        <Card className="p-3">
          <p className="text-sm leading-relaxed text-ink-3">
            Battlefield needs the cloud, and this build has no Supabase keys configured. Everything else
            in TypeForge keeps working on this device.
          </p>
        </Card>
      </Shell>
    );
  }

  /** A guest account is enough. Only reached when nobody is signed in. */
  const ensureAccount = async () => {
    if (user) return user;
    const guest = await signInAnonymously(state.profile.name || 'Player');
    if (!guest) {
      openAuthModal('sign-up');
      throw new Error('Sign in to use Battlefield.');
    }
    return guest;
  };

  const onCreate = async () => {
    setCreating(true);
    try {
      await ensureAccount();
      const p = presetById(preset);
      const passage = await pickBattlePassage({ difficulty, words: p.words });
      const room = await createBattle({
        passage: passage.text,
        passageMeta: passage.meta,
        difficulty,
        maxPlayers,
        timeLimitSec: p.timeLimitSec,
      });
      navigate(`/battle/${room.pin}`);
    } catch (err) {
      toast(err.message ?? 'Could not open a Battlefield.', { tone: 'error' });
    } finally {
      setCreating(false);
    }
  };

  const onJoin = async (code = pin) => {
    if (code.length !== 6 || joining) return;
    setJoining(true);
    try {
      await ensureAccount();
      const room = await joinBattle(code);
      navigate(`/battle/${room.pin}`);
    } catch (err) {
      toast(err.message ?? 'Could not join.', { tone: 'error' });
      setPin('');
    } finally {
      setJoining(false);
    }
  };

  return (
    <Shell>
      <Reveal>
        <div className="grid gap-2.5 lg:grid-cols-2">
          {/* ── Create ─────────────────────────────────────────────────── */}
          <Card className="flex flex-col p-3">
            <div className="flex items-center gap-1.5">
              <span className="grid h-[34px] w-[34px] place-items-center rounded-[11px] bg-brand-wash text-brand">
                <Swords size={18} strokeWidth={2.2} aria-hidden />
              </span>
              <div>
                <h2 className="text-base font-extrabold">Open a Battlefield</h2>
                <p className="text-xs text-ink-3">You host. Share the code and start when everyone is in.</p>
              </div>
            </div>

            <div className="mt-2.5 space-y-2">
              <Field label="Length">
                <Segmented
                  size="sm"
                  label="Match length"
                  options={LENGTH_PRESETS.map((p) => ({ value: p.id, label: p.label }))}
                  value={preset}
                  onChange={setPreset}
                />
              </Field>
              <p className="-mt-1 text-2xs text-ink-3">{presetById(preset).hint}</p>

              <Field label="Difficulty">
                <Segmented size="sm" label="Difficulty" options={DIFFICULTIES} value={difficulty} onChange={setDifficulty} />
              </Field>

              <Field label="Players">
                <Segmented
                  size="sm"
                  label="Max players"
                  options={[2, 4, 6, 8].map((n) => ({ value: n, label: String(n) }))}
                  value={maxPlayers}
                  onChange={setMaxPlayers}
                />
              </Field>
            </div>

            <Button
              variant="primary"
              className="mt-3 w-full"
              icon={creating ? Loader2 : Swords}
              onClick={onCreate}
              disabled={creating}
            >
              {creating ? 'Writing the passage…' : 'Open Battlefield'}
            </Button>
          </Card>

          {/* ── Join ───────────────────────────────────────────────────── */}
          <Card className="flex flex-col p-3">
            <div className="flex items-center gap-1.5">
              <span className="grid h-[34px] w-[34px] place-items-center rounded-[11px] bg-subtle text-ink-2">
                <LogIn size={18} strokeWidth={2.2} aria-hidden />
              </span>
              <div>
                <h2 className="text-base font-extrabold">Join with a code</h2>
                <p className="text-xs text-ink-3">Six characters from whoever is hosting.</p>
              </div>
            </div>

            <div className="mt-3 flex flex-1 flex-col items-center justify-center gap-2">
              <PinInput value={pin} onChange={setPin} onComplete={onJoin} disabled={joining} autoFocus />
              <p className="text-2xs text-ink-3">
                {joining ? 'Joining…' : 'It fills in as you type'}
              </p>
            </div>

            <Button
              variant="secondary"
              className="mt-2 w-full"
              iconRight={ArrowRight}
              onClick={() => onJoin()}
              disabled={pin.length !== 6 || joining}
            >
              Join
            </Button>
          </Card>
        </div>
      </Reveal>

      <Reveal delay={0.08}>
        <div className="grid gap-2.5 md:grid-cols-3">
          <Feature icon={Users} title="Up to eight" body="Everyone sees the roster fill in real time, and nobody can slip in once the countdown starts." />
          <Feature icon={Timer} title="One passage, one clock" body="The same text for the whole room, and a start time that belongs to the server rather than to anybody's laptop." />
          <Feature icon={Trophy} title="Cleanest run wins" body="Fewest mistakes first, then speed, then accuracy, then who finished soonest." />
        </div>
      </Reveal>
    </Shell>
  );
}

function Shell({ children }) {
  return (
    <div className="space-y-3">
      <header>
        <p className="eyebrow">Multiplayer</p>
        <h1 className="mt-0.5 flex items-center gap-1 text-3xl font-extrabold">
          Battlefield
          <Chip tone="brand">Live</Chip>
        </h1>
        <p className="mt-0.5 max-w-[54ch] text-sm text-ink-3">
          Every number this app gives you is measured against your own past. Battlefield adds the one
          thing that was missing: someone to beat.
        </p>
      </header>
      {children}
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-1">
      <span className="text-xs font-bold text-ink-2">{label}</span>
      {children}
    </div>
  );
}

function Feature({ icon: Icon, title, body }) {
  return (
    <Card className={cx('p-2.5')}>
      <span className="grid h-[28px] w-[28px] place-items-center rounded-[9px] bg-subtle text-ink-2">
        <Icon size={15} strokeWidth={2.2} aria-hidden />
      </span>
      <p className="mt-1.5 text-sm font-extrabold">{title}</p>
      <p className="mt-0.5 text-xs leading-relaxed text-ink-3">{body}</p>
    </Card>
  );
}
