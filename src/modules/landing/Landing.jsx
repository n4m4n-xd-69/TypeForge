import { useCallback, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import useTypingEngine from '../../components/typing/useTypingEngine.js';
import Logo from '../../components/brand/Logo.jsx';
import { randomWords } from '../../lib/content.js';
import { CHAR_STATE } from '../../lib/typing.js';
import { cx } from '../../lib/format.js';

/**
 * The public front door.
 *
 * Deliberately imports none of the app's shared UI. Primitives.jsx, Motion.jsx
 * and the chart module all pull dependencies this page has no use for, and the
 * landing route has the tightest budget in the product — React and
 * framer-motion alone are most of it. Everything below is plain markup and the
 * typing engine, which is the one thing the page genuinely needs.
 *
 * The hero is not a screenshot of the product. It is the product: pressing any
 * key starts a real, scored thirty-second run against the same engine
 * /practice uses. That collapses "read about it, decide, navigate, configure,
 * type" into one action, and it demonstrates the only claim that matters
 * instead of asserting it.
 */

const DEMO_SECONDS = 30;

export default function Landing() {
  const navigate = useNavigate();

  /* One passage, fixed for the life of the page. Regenerating on re-render
     would swap the text out from under someone mid-word. */
  const passage = useMemo(() => randomWords(70, 'normal'), []);
  const [finished, setFinished] = useState(null);

  const onFinish = useCallback((run) => setFinished(run), []);

  const engine = useTypingEngine({
    target: passage,
    limitSeconds: DEMO_SECONDS,
    onFinish,
  });

  return (
    <main className="mx-auto w-full max-w-[1120px] px-2 pb-16 sm:px-4">
      <Nav />
      <Hero engine={engine} passage={passage} finished={finished} onContinue={() => navigate('/practice')} />
      <Pillars />
      <Proof />
      <Footer />
    </main>
  );
}

/* ── Chrome ────────────────────────────────────────────────────────────── */

/**
 * The landing page carries its own navigation rather than the app shell's.
 * A rail and a streak counter are answers to questions a first-time visitor
 * has not asked yet.
 */
function Nav() {
  return (
    <nav className="flex h-[72px] items-center justify-between">
      <span className="flex items-center gap-1">
        <Logo size={30} />
        <span className="font-display text-xl font-bold tracking-[-0.03em]">TypeForge</span>
      </span>
      <div className="flex items-center gap-1.5">
        <Link
          to="/about"
          className="hidden rounded-sm px-1.5 py-1 text-sm font-medium text-ink-2 transition-colors duration-fast hover:text-ink sm:block"
        >
          About
        </Link>
        <Link
          to="/practice"
          className="rounded-sm bg-brand-solid px-2 py-1 text-sm font-semibold text-brand-ink shadow-e1 transition-[filter] duration-fast hover:brightness-[1.08]"
        >
          Start typing
        </Link>
      </div>
    </nav>
  );
}

/* ── Hero ──────────────────────────────────────────────────────────────── */

function Hero({ engine, passage, finished, onContinue }) {
  return (
    <section className="pt-8 sm:pt-12">
      <h1 className="max-w-[15ch] font-display text-4xl font-bold leading-[1.02] tracking-[-0.035em] sm:text-5xl">
        Type faster.
        <br />
        <span className="text-brand">Prove it.</span>
      </h1>

      <p className="mt-2.5 max-w-[52ch] text-lg leading-relaxed text-ink-2">
        A typing-performance platform for people who type for a living. Drill prose and real code,
        find out which keys are costing you, and race other people on a clock nobody can cheat.
      </p>

      <TypingDemo engine={engine} passage={passage} finished={finished} onContinue={onContinue} />

      <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm text-ink-3">
        <span>No account needed</span>
        <Dot />
        <span>Works offline</span>
        <Dot />
        <span>Your data stays on your device</span>
      </p>
    </section>
  );
}

function Dot() {
  return <span className="text-ink-3/50" aria-hidden>·</span>;
}

/**
 * The demo.
 *
 * Uses the real engine, so the numbers on screen are the numbers the product
 * would record. When the run ends it shows the result and hands over to
 * /practice rather than looping — the point has been made, and repeating it
 * would keep someone on a marketing page instead of in the app.
 */
function TypingDemo({ engine, passage, finished, onContinue }) {
  const boxRef = useRef(null);
  const { states, status, live, onKeyDown } = engine;

  const focus = useCallback(() => boxRef.current?.focus(), []);

  if (finished) return <DemoResult result={finished} onContinue={onContinue} />;

  return (
    <div className="mt-4 overflow-hidden rounded-lg border border-line bg-surface shadow-e2">
      <div className="flex items-center justify-between border-b border-line px-2.5 py-1.5">
        <span className="eyebrow">30-second run</span>
        <LiveReadout live={live} running={status === 'running'} />
      </div>

      <div
        ref={boxRef}
        tabIndex={0}
        role="textbox"
        aria-label="Typing demo. Type the text shown to begin."
        onKeyDown={onKeyDown}
        onMouseDown={(e) => {
          e.preventDefault();
          focus();
        }}
        className="cursor-text px-2.5 py-3 outline-none sm:px-4"
      >
        <p className="max-w-[62ch] whitespace-pre-wrap break-words font-mono text-type-s sm:text-type-m">
          {[...passage].slice(0, 168).map((ch, i) => (
            <Char key={i} ch={ch} state={states[i]} />
          ))}
        </p>

        {/* In the flow rather than floating over the passage. Absolutely
            positioning it inside the box put it on top of the last line, so
            the prompt telling you to start obscured the thing you start on. */}
        <p className="mt-2 h-[20px] text-xs font-medium text-ink-3">
          {status === 'idle' ? 'Press any key to start' : status === 'running' ? 'Keep going' : ''}
        </p>
      </div>

      <div className="h-[2px] w-full bg-line">
        <div
          className="h-full origin-left bg-brand-solid transition-transform duration-slow ease-out"
          style={{ transform: `scaleX(${live.progress || 0})` }}
        />
      </div>
    </div>
  );
}

/**
 * A character.
 *
 * Every state carries something that is not colour. `wrong` and `pending`
 * separate by 1.06:1 on colour alone, so an underline does the work a hue
 * cannot — and it is an underline rather than a weight change because weight
 * reflows the line and would move the caret mid-word.
 */
function Char({ ch, state }) {
  return (
    <span
      className={cx(
        state === CHAR_STATE.CORRECT && 'text-ink',
        state === CHAR_STATE.WRONG &&
          'rounded-[2px] bg-bad/15 text-bad underline decoration-bad decoration-2 underline-offset-4',
        state === CHAR_STATE.CORRECTED &&
          'text-ink-2 underline decoration-warn decoration-dotted decoration-2 underline-offset-4',
        (state === CHAR_STATE.PENDING || !state) && 'text-ink-3',
      )}
    >
      {ch}
    </span>
  );
}

function LiveReadout({ live, running }) {
  return (
    <span className="flex items-center gap-2 font-mono text-sm tabular-nums">
      <Stat label="wpm" value={Math.round(live.wpm)} accent={running} />
      <Stat label="acc" value={`${Math.round(live.accuracy)}%`} />
      <Stat label="left" value={`${Math.ceil(live.remaining ?? 30)}s`} />
    </span>
  );
}

function Stat({ label, value, accent = false }) {
  return (
    <span className="flex items-baseline gap-0.5">
      <span className={cx('font-medium', accent ? 'text-brand' : 'text-ink')}>{value}</span>
      <span className="text-2xs uppercase tracking-[0.08em] text-ink-3">{label}</span>
    </span>
  );
}

/**
 * The result.
 *
 * Leads with the diagnosis rather than the score, because the score is what
 * every typing test already gives you and the diagnosis is the reason this
 * product exists.
 */
function DemoResult({ result, onContinue }) {
  const worst = useMemo(() => {
    const entries = Object.entries(result.keyStats ?? {})
      .map(([key, s]) => ({ key, rate: s.wrong / Math.max(1, s.total), wrong: s.wrong }))
      .filter((k) => k.wrong > 0)
      .sort((a, b) => b.rate - a.rate);
    return entries.slice(0, 3);
  }, [result]);

  return (
    <div className="mt-4 overflow-hidden rounded-lg border border-line bg-surface shadow-e2">
      <div className="grid gap-2 border-b border-line px-2.5 py-3 sm:grid-cols-4 sm:px-4">
        <Metric label="wpm" value={Math.round(result.wpm)} accent />
        <Metric label="accuracy" value={`${Math.round(result.accuracy)}%`} />
        <Metric label="consistency" value={`${Math.round(result.consistency)}%`} />
        <Metric label="errors" value={result.errors} />
      </div>

      <div className="px-2.5 py-2.5 sm:px-4">
        {worst.length ? (
          <p className="text-sm text-ink-2">
            <span className="font-semibold text-ink">Your weakest keys: </span>
            {worst.map((k, i) => (
              <span key={k.key}>
                {i > 0 ? ', ' : ''}
                <code className="rounded-xs bg-raised px-0.5 font-mono text-ink">
                  {k.key === ' ' ? 'space' : k.key}
                </code>{' '}
                <span className="text-bad">{Math.round(k.rate * 100)}%</span>
              </span>
            ))}
            . TypeForge drills those specifically.
          </p>
        ) : (
          <p className="text-sm text-ink-2">
            Clean run — no key missed more than once. TypeForge tracks every keystroke, so the
            moment one starts costing you it shows up here.
          </p>
        )}

        <button
          onClick={onContinue}
          className="mt-2.5 rounded-sm bg-brand-solid px-2.5 py-1.5 text-sm font-semibold text-brand-ink shadow-e1 transition-[filter] duration-fast hover:brightness-[1.08]"
        >
          Keep going →
        </button>
      </div>
    </div>
  );
}

function Metric({ label, value, accent = false }) {
  return (
    <div>
      <p className={cx('font-mono text-3xl font-medium leading-none tabular-nums', accent && 'text-brand')}>
        {value}
      </p>
      <p className="mt-0.5 text-2xs uppercase tracking-[0.09em] text-ink-3">{label}</p>
    </div>
  );
}

/* ── Explanation ───────────────────────────────────────────────────────── */

const PILLARS = [
  {
    name: 'Practice',
    line: 'Six modes',
    body: 'Timed sprints, fixed word counts, quotes, targeted drills, your own text, and an unscored zen mode for when you just want to type.',
  },
  {
    name: 'Code',
    line: 'Eleven languages',
    body: 'Real snippets with syntax highlighting and auto-indent. The characters that actually slow developers down are brackets, arrows and semicolons — so those are what you drill.',
  },
  {
    name: 'Compete',
    line: 'Live races',
    body: 'Two to eight players on one passage and one clock. The server owns the timer and recomputes every result, so a fast run is a fast run.',
  },
  {
    name: 'Progress',
    line: 'Per-key diagnosis',
    body: 'Every keystroke is recorded. Speed, accuracy and consistency over time, plus the specific keys costing you the most — and a drill that targets them.',
  },
];

function Pillars() {
  return (
    <section className="mt-16 border-t border-line pt-8">
      <h2 className="font-display text-2xl font-bold tracking-[-0.02em]">
        A loop, not a leaderboard.
      </h2>
      <p className="mt-1 max-w-[58ch] text-base text-ink-2">
        Measure, diagnose, drill, compete, measure again. Every part of the product sits on one of
        those steps — and anything that did not was removed.
      </p>

      <ul className="mt-4 grid gap-2 sm:grid-cols-2">
        {PILLARS.map((p) => (
          <li key={p.name} className="rounded-md border border-line bg-surface p-3">
            <p className="eyebrow">{p.line}</p>
            <h3 className="mt-0.5 font-display text-xl font-bold tracking-[-0.02em]">{p.name}</h3>
            <p className="mt-1 text-sm leading-relaxed text-ink-2">{p.body}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * The honest version of a social-proof band.
 *
 * No user counts, no testimonials, no logos. The product is new and inventing
 * any of those would be a lie told on the first screen. What it can say
 * truthfully is how it works, so that is what it says.
 */
function Proof() {
  return (
    <section className="mt-16 grid gap-2 border-t border-line pt-8 sm:grid-cols-3">
      {[
        ['Nothing to sign up for', 'Every mode, every statistic and your whole history work with no account and no network. Sign in only when you want it on a second device.'],
        ['The clock is not yours', 'In a race the start time and the final words-per-minute are both computed in the database. Your browser reports a number; it is kept, but it is not the one that ranks you.'],
        ['Accuracy is the multiplier', 'Experience points scale with how clean the run was, not how fast. Mashing keys cannot level you up, and a clean slow run beats a fast one with a typo.'],
      ].map(([title, body]) => (
        <div key={title}>
          <h3 className="text-base font-semibold">{title}</h3>
          <p className="mt-0.5 text-sm leading-relaxed text-ink-3">{body}</p>
        </div>
      ))}
    </section>
  );
}

function Footer() {
  return (
    <footer className="mt-16 flex flex-col gap-2 border-t border-line pt-6 sm:flex-row sm:items-center sm:justify-between">
      <span className="flex items-center gap-1 text-sm text-ink-3">
        <Logo size={20} />
        <span className="font-display font-bold text-ink-2">TypeForge</span>
      </span>
      <nav className="flex flex-wrap gap-x-3 gap-y-1 text-sm text-ink-3">
        <Link to="/practice" className="transition-colors duration-fast hover:text-ink-2">Typing</Link>
        <Link to="/code" className="transition-colors duration-fast hover:text-ink-2">Code</Link>
        <Link to="/battle" className="transition-colors duration-fast hover:text-ink-2">Battle</Link>
        <Link to="/about" className="transition-colors duration-fast hover:text-ink-2">About</Link>
      </nav>
    </footer>
  );
}
