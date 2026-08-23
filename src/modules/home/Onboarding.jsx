import { useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowRight, Braces, Keyboard, Mail, ShieldCheck, Sparkles, Swords } from 'lucide-react';
import Modal from '../../components/ui/Modal.jsx';
import Button from '../../components/ui/Button.jsx';
import Segmented from '../../components/ui/Segmented.jsx';
import { useStore } from '../../lib/store.jsx';
import { useAuth } from '../../lib/auth.jsx';
import { signInAnonymously, signInWithGoogle } from '../../lib/supabase.js';
import { cx } from '../../lib/format.js';

const GOALS = [
  { value: 5, label: '5 min', hint: 'Light touch' },
  { value: 15, label: '15 min', hint: 'Steady' },
  { value: 30, label: '30 min', hint: 'Serious' },
];

const FOCUS = [
  { id: 'speed', label: 'Type faster', icon: Keyboard, blurb: 'Prose, quotes and timed sprints.' },
  { id: 'code', label: 'Type code', icon: Braces, blurb: 'Real snippets in eleven languages.' },
  { id: 'battle', label: 'Battle players', icon: Swords, blurb: 'Real-time multiplayer race.' },
];

/**
 * Three-step first-run flow. Deliberately skippable — nothing here blocks the
 * app, it just makes the first Home screen less empty.
 */
export default function Onboarding({ open, onClose, onStart }) {
  const { state, updateProfile } = useStore();
  const { user, cloudEnabled, openAuthModal } = useAuth();
  const [step, setStep] = useState(0);
  const [name, setName] = useState(state.profile.name);
  const [goal, setGoal] = useState(state.profile.goalMinutes ?? 15);
  const [focus, setFocus] = useState('speed');

  const finish = () => {
    const trimmed = name.trim();
    updateProfile({ name: trimmed, goalMinutes: goal, onboarded: true });

    /**
     * A name is enough to get a database row.
     *
     * Creating a guest account here is what lets progress sync without asking
     * for an email first — the id it returns owns every session, key stat and
     * achievement from this point on, and signing up later converts that same
     * account rather than starting a second one.
     *
     * Deliberately not awaited and deliberately silent on failure: onboarding
     * must close instantly, and a project without anonymous sign-in enabled
     * should fall back to local-only rather than block anyone at the door.
     */
    if (trimmed && cloudEnabled && !user) signInAnonymously(trimmed);

    onClose();
    onStart?.(focus);
  };

  const skip = () => {
    updateProfile({ onboarded: true });
    onClose();
  };

  return (
    <Modal open={open} onClose={skip} size="md" dismissable>
      <div className="relative overflow-hidden">
        <div className="relative px-3 pb-2 pt-4">
          <div className="relative">
            <span className="inline-flex items-center gap-0.5 rounded-full border border-line bg-surface px-1 py-px text-2xs font-extrabold uppercase tracking-[0.1em] text-brand">
              <Sparkles size={11} aria-hidden /> Welcome
            </span>
            <h2 className="mt-1 text-3xl font-extrabold tracking-[-0.03em]">
              Let's set up your <span className="text-brand">practice</span>.
            </h2>
            <p className="mt-0.5 text-sm text-ink-3">Three quick questions. You can change all of them later.</p>
          </div>
        </div>

        <div className="px-3 pb-1">
          <div className="mb-2 flex gap-0.5" aria-hidden>
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className={cx('h-0.5 flex-1 rounded-full transition-colors', i <= step ? 'bg-brand-solid' : 'bg-line')}
              />
            ))}
          </div>

          <motion.div key={step} initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.22 }}>
            {step === 0 ? (
              <div>
                <label htmlFor="ob-name" className="text-sm font-extrabold">
                  What should we call you?
                </label>
                <input
                  id="ob-name"
                  data-autofocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Your name"
                  className="mt-1 h-[44px] w-full rounded-md border border-line bg-subtle/50 px-1.5 text-base outline-none focus:border-brand"
                />
                <p className="mt-0.5 text-xs text-ink-3">
                  {cloudEnabled
                    ? 'A name is enough to start — your progress saves straight away.'
                    : "Stored on this device only. Leave it blank if you'd rather not."}
                </p>

                {/* The honest trade-off, stated where the decision is made.
                    A name alone creates a guest account that lives and dies
                    with this browser; an email or Google makes it portable.
                    Saying so here beats discovering it after a month of
                    progress is stranded. */}
                {cloudEnabled ? (
                  <div className="mt-2 rounded-md border border-line bg-subtle/40 p-1.5">
                    <p className="flex items-start gap-1 text-xs leading-relaxed text-ink-2">
                      <ShieldCheck size={14} strokeWidth={2.2} className="mt-px shrink-0 text-brand" aria-hidden />
                      <span>
                        <strong className="font-extrabold text-ink">Want it on your phone too?</strong>{' '}
                        Add an email or continue with Google, and your streak, XP and stats follow you
                        anywhere. You can also do this later.
                      </span>
                    </p>
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      <Button
                        size="sm"
                        variant="secondary"
                        icon={Mail}
                        onClick={() => {
                          if (name.trim()) updateProfile({ name: name.trim() });
                          onClose();
                          openAuthModal('sign-up');
                        }}
                      >
                        Add an email
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={async () => {
                          if (name.trim()) updateProfile({ name: name.trim() });
                          try {
                            await signInWithGoogle();
                          } catch {
                            /* the modal below is the fallback route */
                            onClose();
                            openAuthModal('sign-up');
                          }
                        }}
                      >
                        <GoogleG /> Continue with Google
                      </Button>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}

            {step === 1 ? (
              <div>
                <p className="text-sm font-extrabold">How much do you want to practise a day?</p>
                <div className="mt-1.5">
                  <Segmented options={GOALS} value={goal} onChange={setGoal} label="Daily goal" />
                </div>
                <p className="mt-1 text-xs text-ink-3">
                  This sets the ring on your home screen. Consistency beats volume — 15 minutes daily outruns two hours on a Sunday.
                </p>
              </div>
            ) : null}

            {step === 2 ? (
              <div>
                <p className="text-sm font-extrabold">What are you here for first?</p>
                <div className="mt-1.5 grid gap-1">
                  {FOCUS.map((f) => (
                    <button
                      key={f.id}
                      onClick={() => setFocus(f.id)}
                      className={cx(
                        'flex items-center gap-1.5 rounded-md border px-1.5 py-1.5 text-left transition-colors',
                        focus === f.id ? 'border-brand bg-brand-wash' : 'border-line hover:bg-subtle',
                      )}
                    >
                      <span
                        className={cx(
                          'grid h-[34px] w-[34px] place-items-center rounded-[10px]',
                          focus === f.id ? 'bg-brand-solid text-brand-ink' : 'bg-subtle text-ink-2',
                        )}
                        aria-hidden
                      >
                        <f.icon size={17} strokeWidth={2.2} />
                      </span>
                      <span>
                        <span className="block text-sm font-extrabold">{f.label}</span>
                        <span className="block text-xs text-ink-3">{f.blurb}</span>
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </motion.div>
        </div>

        <footer className="mt-2 flex items-center justify-between border-t border-line px-3 py-2">
          <Button variant="quiet" onClick={skip}>
            Skip
          </Button>
          <div className="flex gap-1">
            {step > 0 ? (
              <Button variant="ghost" onClick={() => setStep((s) => s - 1)}>
                Back
              </Button>
            ) : null}
            {step < 2 ? (
              <Button variant="primary" iconRight={ArrowRight} onClick={() => setStep((s) => s + 1)}>
                Continue
              </Button>
            ) : (
              <Button variant="primary" iconRight={ArrowRight} onClick={finish}>
                Start practising
              </Button>
            )}
          </div>
        </footer>
      </div>
    </Modal>
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
