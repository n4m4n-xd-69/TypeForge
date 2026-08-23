import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  ArrowRight, Check, EyeOff, Flame, Gauge, LogOut, Mail, ShieldCheck, Trash2,
  Trophy, Upload,
} from 'lucide-react';
import Button, { IconButton } from '../../components/ui/Button.jsx';
import { Card, Chip, ProgressBar } from '../../components/ui/Primitives.jsx';
import Avatar, { PresetTile } from '../../components/ui/Avatar.jsx';
import { Reveal } from '../../components/ui/Motion.jsx';
import { useToast } from '../../components/ui/Toast.jsx';
import { useAuth } from '../../lib/auth.jsx';
import { useStats, useStore } from '../../lib/store.jsx';
import { isGuest, signInWithGoogle, supabase } from '../../lib/supabase.js';
import { PRESET_AVATARS, fileToAvatarDataUrl, isPreset, toPresetValue } from '../../lib/avatars.js';
import { levelTitle } from '../../lib/gamification.js';
import { cx } from '../../lib/format.js';

/**
 * The account surface.
 *
 * Everything about "who you are" lives here — name, avatar, how your account is
 * secured, and whether you appear on the leaderboard — because those were
 * previously spread across an onboarding wizard you could not reopen and a
 * dropdown that did not exist without cloud sync.
 *
 * Writes go to local state first and mirror to `profiles`, matching the rest of
 * the app: signed out, everything here still works and simply stays on the
 * device.
 */
export default function Profile() {
  const { state, updateProfile } = useStore();
  const stats = useStats();
  const { user, cloudEnabled, openAuthModal, signOut } = useAuth();
  const { toast } = useToast();

  const [name, setName] = useState(state.profile.name ?? '');
  const [saving, setSaving] = useState(false);
  const fileRef = useRef(null);

  useEffect(() => setName(state.profile.name ?? ''), [state.profile.name]);

  const guest = user ? isGuest(user) : false;
  const avatar = state.profile.avatar ?? null;
  const hidden = state.profile.hideFromLeaderboard === true;

  /** One writer for every profile field, so a change can never land locally and
   *  then fail to reach the row the leaderboard reads. */
  const persist = async (patch, message) => {
    setSaving(true);
    updateProfile(patch);
    try {
      if (user && supabase) {
        if ('name' in patch) await supabase.auth.updateUser({ data: { full_name: patch.name } });
        await supabase.from('profiles').upsert(
          {
            id: user.id,
            ...('name' in patch ? { display_name: patch.name || null } : {}),
            ...('avatar' in patch ? { avatar: patch.avatar } : {}),
            ...('hideFromLeaderboard' in patch ? { hide_from_leaderboard: patch.hideFromLeaderboard } : {}),
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'id' },
        );
      }
      if (message) toast(message, { tone: 'success' });
    } catch (err) {
      toast(err?.message ?? 'That did not save. It is kept on this device.', { tone: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const onUpload = async (file) => {
    if (!file) return;
    try {
      const dataUrl = await fileToAvatarDataUrl(file);
      await persist({ avatar: dataUrl }, 'Photo set.');
    } catch (err) {
      toast(err?.message ?? 'That image could not be used.', { tone: 'error' });
    }
  };

  return (
    <div className="space-y-3">
      <header>
        <p className="eyebrow">Account</p>
        <h1 className="mt-0.5 text-3xl font-extrabold">Your profile</h1>
        <p className="mt-0.5 max-w-[54ch] text-sm text-ink-3">
          How you appear across TypeForge, and where your progress is kept.
        </p>
      </header>

      {/* ── Identity and picker, side by side ────────────────────────────
          Two stacked full-width cards left the identity row mostly empty and
          pushed the picker below the fold. They share a row now, and the
          picker — the taller half — sets the height the other fills. */}
      <Reveal>
        <div className="grid gap-2.5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
          <div className="glass overflow-hidden rounded-lg border border-line">
            <div className="flex items-center gap-2 p-2.5">
              <div className="relative shrink-0">
                <Avatar value={avatar} name={name} size={72} ring />
                <IconButton
                  size="sm"
                  label="Upload a photo"
                  icon={Upload}
                  onClick={() => fileRef.current?.click()}
                  className="absolute -bottom-1 -right-1 !h-[26px] !w-[26px] rounded-full border border-line bg-surface shadow-md"
                />
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  hidden
                  onChange={(e) => {
                    onUpload(e.target.files?.[0]);
                    e.target.value = null; // so re-picking the same file still fires
                  }}
                />
              </div>

              <div className="min-w-0 flex-1">
                <label
                  htmlFor="profile-display-name"
                  className="text-2xs font-extrabold uppercase tracking-[0.08em] text-ink-3"
                >
                  Display name
                </label>
                <div className="mt-0.5 flex gap-1">
                  <input
                    id="profile-display-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    maxLength={40}
                    placeholder="Your name"
                    autoComplete="name"
                    className="h-[36px] min-w-0 flex-1 rounded-md border border-line bg-subtle/50 px-1.5 text-sm outline-none focus:border-brand"
                  />
                  <Button
                    size="sm"
                    variant="primary"
                    disabled={saving || name === (state.profile.name ?? '')}
                    onClick={() => persist({ name: name.trim() }, 'Name saved.')}
                  >
                    Save
                  </Button>
                </div>
                <p className="mt-0.5 truncate text-2xs text-ink-3">
                  Shown in the header and on the leaderboard.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-px border-t border-line bg-line">
              <MiniStat icon={Trophy} label="Level" value={stats.level.level} sub={levelTitle(stats.level.level)} />
              <MiniStat icon={Gauge} label="WPM" value={Math.round(stats.wpm)} sub={`${Math.round(stats.accuracy)}% acc`} />
              <MiniStat icon={Flame} label="Streak" value={stats.streak} sub={`best ${stats.bestStreak}`} />
            </div>

            <div className="border-t border-line px-2.5 py-1.5">
              <ProgressBar value={stats.level.progress} label="Progress to next level" />
              <p className="mt-0.5 text-2xs text-ink-3">
                {stats.xp.toLocaleString()} XP · {stats.level.toNext.toLocaleString()} to level{' '}
                {stats.level.level + 1}
              </p>
            </div>
          </div>

          <Card className="p-2.5">
            <div className="flex flex-wrap items-center justify-between gap-1">
              <div className="min-w-0">
                <h2 className="text-sm font-extrabold">Pick an avatar</h2>
                <p className="text-2xs text-ink-3">
                  {PRESET_AVATARS.length} to choose from, or upload a photo.
                </p>
              </div>
              {avatar ? (
                <Button size="sm" variant="ghost" icon={Trash2} onClick={() => persist({ avatar: null }, 'Avatar reset.')}>
                  Reset
                </Button>
              ) : null}
            </div>

            <div className="mt-1.5 grid grid-cols-6 gap-1 sm:grid-cols-8">
              {PRESET_AVATARS.map((p) => {
                const selected = isPreset(avatar) && avatar === toPresetValue(p.id);
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => persist({ avatar: toPresetValue(p.id) })}
                    aria-pressed={selected}
                    title={p.label}
                    aria-label={`Use the ${p.label} avatar`}
                    className={cx(
                      'relative block w-full overflow-hidden rounded-lg transition-transform duration-200',
                      'hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand',
                      selected && 'ring-2 ring-brand ring-offset-2 ring-offset-surface',
                    )}
                  >
                    <PresetTile preset={p} size="100%" />
                    {selected ? (
                      <motion.span
                        initial={{ scale: 0 }}
                        animate={{ scale: 1 }}
                        className="absolute bottom-0.5 right-0.5 grid h-[16px] w-[16px] place-items-center rounded-full bg-brand-solid text-brand-ink"
                      >
                        <Check size={10} strokeWidth={3.4} aria-hidden />
                      </motion.span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </Card>
        </div>
      </Reveal>

      {/* ── Account ─────────────────────────────────────────────────────── */}
      <Reveal delay={0.08}>
        <Card className="p-2.5 sm:p-3">
          <h2 className="text-base font-extrabold">Account</h2>

          {!cloudEnabled ? (
            <p className="mt-1 text-sm leading-relaxed text-ink-3">
              Cloud sync is not configured on this build, so everything here stays on this device.
            </p>
          ) : !user ? (
            <>
              <p className="mt-1 max-w-[60ch] text-sm leading-relaxed text-ink-2">
                Your progress is on this device only. Sign in to carry your streak, XP and stats to your
                phone — and to keep them if you clear your browser.
              </p>
              <div className="mt-2 flex flex-wrap gap-1">
                <Button variant="primary" icon={Mail} onClick={() => openAuthModal('sign-up')}>
                  Sign up with email
                </Button>
                <Button variant="secondary" onClick={() => signInWithGoogle().catch(() => openAuthModal('sign-in'))}>
                  <GoogleG /> Continue with Google
                </Button>
                <Button variant="ghost" onClick={() => openAuthModal('sign-in')}>
                  I already have an account
                </Button>
              </div>
            </>
          ) : (
            <>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <Chip tone={guest ? 'warn' : 'good'}>{guest ? 'Guest account' : 'Signed in'}</Chip>
                <span className="text-sm text-ink-2">{user.email ?? 'No email attached'}</span>
              </div>

              {guest ? (
                <>
                  <p className="mt-1.5 max-w-[60ch] text-sm leading-relaxed text-ink-2">
                    This account lives in this browser. Clear your site data, or open TypeForge anywhere
                    else, and there is no way back to it. Attaching an email or a Google account keeps the
                    same profile — nothing is lost or restarted.
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1">
                    <Button variant="primary" icon={ShieldCheck} onClick={() => openAuthModal('sign-up')}>
                      Attach an email
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() => signInWithGoogle().catch(() => openAuthModal('sign-up'))}
                    >
                      <GoogleG /> Merge with Google
                    </Button>
                  </div>
                </>
              ) : null}

              <div className="mt-2.5 border-t border-line pt-2">
                <Button
                  variant="ghost"
                  icon={LogOut}
                  onClick={async () => {
                    if (guest && !window.confirm(
                      'This is a guest account. Signing out leaves no way back to it, '
                        + 'and the progress synced under it cannot be recovered.\n\n'
                        + 'Attach an email first to keep it. Sign out anyway?',
                    )) return;
                    await signOut();
                    toast(guest ? 'Guest session ended.' : 'Signed out.', { tone: 'info' });
                  }}
                >
                  Sign out
                </Button>
              </div>
            </>
          )}
        </Card>
      </Reveal>

      {/* ── Privacy ─────────────────────────────────────────────────────── */}
      <Reveal delay={0.12}>
        <Card className="flex flex-wrap items-center gap-2 p-2.5 sm:p-3">
          <span className="grid h-[34px] w-[34px] shrink-0 place-items-center rounded-[11px] bg-subtle text-ink-2">
            <EyeOff size={17} strokeWidth={2.2} aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-extrabold">Hide me from the leaderboard</p>
            <p className="text-xs leading-relaxed text-ink-3">
              Your XP still counts and your stats still work — you simply stop appearing on the public
              board. The board only ever shows a name, an avatar and a total.
            </p>
          </div>
          <button
            role="switch"
            aria-checked={hidden}
            aria-label="Hide me from the leaderboard"
            disabled={saving}
            onClick={() => persist(
              { hideFromLeaderboard: !hidden },
              !hidden ? 'You are hidden from the leaderboard.' : 'You are back on the leaderboard.',
            )}
            className={cx(
              'relative h-[26px] w-[46px] shrink-0 rounded-full transition-colors duration-200 disabled:opacity-50',
              hidden ? 'bg-brand-solid' : 'bg-line-strong',
            )}
          >
            <span
              className={cx(
                'absolute top-px h-[24px] w-[24px] rounded-full bg-surface shadow-sm transition-transform duration-200 ease-out',
                hidden ? 'translate-x-[21px]' : 'translate-x-px',
              )}
            />
          </button>
        </Card>
      </Reveal>

      <Reveal delay={0.16}>
        <Card className="flex flex-wrap items-center gap-2 p-2.5">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-extrabold">See where you stand</p>
            <p className="text-xs text-ink-3">Ranked by total XP, updated as you earn it.</p>
          </div>
          <Button as={Link} to="/achievements" variant="secondary" iconRight={ArrowRight}>
            Leaderboard
          </Button>
        </Card>
      </Reveal>
    </div>
  );
}

function MiniStat({ icon: Icon, label, value, sub }) {
  return (
    <div className="bg-surface px-1.5 py-1">
      <p className="flex items-center gap-0.5 text-2xs font-extrabold uppercase tracking-[0.08em] text-ink-3">
        <Icon size={11} strokeWidth={2.4} aria-hidden /> {label}
      </p>
      <p className="mt-0.5 font-mono text-lg font-medium leading-none tnum">{value}</p>
      <p className="truncate text-2xs text-ink-3">{sub}</p>
    </div>
  );
}

function GoogleG() {
  return (
    <svg width="15" height="15" viewBox="0 0 48 48" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.1 8 3l5.7-5.7C34.6 6.1 29.6 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.7-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.6 15.1 18.9 12 24 12c3.1 0 5.9 1.1 8 3l5.7-5.7C34.6 6.1 29.6 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.5 0 10.4-2.1 14.1-5.6l-6.5-5.5C29.5 34.8 26.9 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.6 5.1C9.6 39.6 16.3 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.2 4.2-4.1 5.6l6.5 5.5C39.9 37.5 44 31.8 44 24c0-1.3-.1-2.7-.4-3.5z" />
    </svg>
  );
}
