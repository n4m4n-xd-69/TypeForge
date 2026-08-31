import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight, Braces, Check, Command, Copy, Heart, Instagram, Keyboard,
  LifeBuoy, Mail, Send, Sparkles, Swords, Trophy,
} from 'lucide-react';
import Button from '../../components/ui/Button.jsx';
import Segmented from '../../components/ui/Segmented.jsx';
import { Chip, Skeleton } from '../../components/ui/Primitives.jsx';
import Markdown from '../../components/ui/Markdown.jsx';
import Logo from '../../components/brand/Logo.jsx';
import { Reveal, Stagger, StaggerItem } from '../../components/ui/Motion.jsx';
import { aiConfigured } from '../../lib/ai.js';
import { useScrollAnchor, useStreamingChat } from '../../lib/useStreamingChat.js';
import { useReducedMotionSafe } from '../../lib/motion.js';
import { LANGUAGES, snippetCount } from '../../lib/content.js';
import { ACHIEVEMENTS } from '../../lib/gamification.js';
import { cx } from '../../lib/format.js';
import { useCopyToClipboard } from '../../lib/useCopyToClipboard.js';

const SECTIONS = [
  { value: 'about', label: 'About' },
  { value: 'guide', label: 'User guide' },
  { value: 'help', label: 'Ask for help' },
  { value: 'follow', label: 'Follow us' },
];

export default function About() {
  const [section, setSection] = useState('about');

  return (
    <div className="space-y-3">
      <header className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="eyebrow">About</p>
          <h1 className="mt-0.5 text-3xl font-bold">About</h1>
          <p className="mt-0.5 max-w-[52ch] text-sm text-ink-3">
            What TypeForge is, how to get the most out of it, and where to find us.
          </p>
        </div>
        <Segmented options={SECTIONS} value={section} onChange={setSection} label="About section" />
      </header>

      {section === 'about' ? <AboutTab /> : null}
      {section === 'guide' ? <GuideTab /> : null}
      {section === 'help' ? <HelpTab /> : null}
      {section === 'follow' ? <FollowTab /> : null}
    </div>
  );
}

/* ── About ─────────────────────────────────────────────────────────────── */

function AboutTab() {
  /* Counted from the real corpus rather than typed into copy, so the numbers
     cannot quietly go stale as content is added. */
  const facts = useMemo(() => {
    const snippets = LANGUAGES.reduce(
      (a, l) => a + ['easy', 'normal', 'hard', 'expert'].reduce((b, d) => b + snippetCount(l.id, d), 0),
      0,
    );
    return [
      { value: LANGUAGES.length, label: 'Languages' },
      { value: snippets, label: 'Code snippets' },
      { value: ACHIEVEMENTS.length, label: 'Achievements' },
      { value: '100%', label: 'Free & offline' },
    ];
  }, []);

  return (
    <div className="space-y-2.5">
      <Reveal>
        <div className="glass overflow-hidden rounded-lg border border-line">
          <div className="flex flex-col items-start gap-2 p-3 sm:flex-row sm:items-center sm:p-4">
            <Logo size={64} className="shrink-0 drop-shadow-md" />
            <div className="min-w-0">
              <h2 className="text-2xl font-bold tracking-[-0.02em]">TypeForge</h2>
              <p className="mt-0.5 max-w-[60ch] text-sm leading-relaxed text-ink-2">
                A typing trainer built for people who write code. Most typing sites drill prose and stop
                there — which is fine until the day your job is brackets, semicolons and indentation.
                TypeForge drills all three, with real-time multiplayer battles and AI assistance.
              </p>
            </div>
          </div>

          <Stagger className="grid gap-px border-t border-line bg-line sm:grid-cols-4">
            {facts.map((f) => (
              <StaggerItem key={f.label} className="bg-surface/60 px-2 py-2 text-center backdrop-blur-sm">
                <p className="font-mono text-2xl font-medium tnum">{f.value}</p>
                <p className="mt-0.5 text-2xs font-bold uppercase tracking-[0.08em] text-ink-3">{f.label}</p>
              </StaggerItem>
            ))}
          </Stagger>
        </div>
      </Reveal>

      <Stagger className="grid gap-2 md:grid-cols-3">
        {[
          {
            icon: Keyboard,
            title: 'Accuracy before speed',
            body: 'Accuracy counts every keypress you ever made, so a corrected mistake still costs you. Speed is what accuracy turns into — chasing it directly just teaches your hands to guess.',
          },
          {
            icon: Braces,
            title: 'Real code, real symbols',
            body: 'Eleven languages of genuine snippets. Indentation is handled for you, because proving you can hold the space bar is not a skill. Brackets are not.',
          },
          {
            icon: Trophy,
            title: 'Progress you can see',
            body: 'XP, levels, streaks and daily missions, plus per-key statistics that show exactly which fingers are letting you down.',
          },
        ].map((c) => (
          <StaggerItem key={c.title}>
            <div className="glass h-full rounded-lg border border-line p-2.5">
              <span className="grid h-[30px] w-[30px] place-items-center rounded-[10px] bg-brand-wash text-brand">
                <c.icon size={16} strokeWidth={2.2} aria-hidden />
              </span>
              <h3 className="mt-1.5 text-base font-bold">{c.title}</h3>
              <p className="mt-0.5 text-sm leading-relaxed text-ink-2">{c.body}</p>
            </div>
          </StaggerItem>
        ))}
      </Stagger>

      <Reveal delay={0.05}>
        <div className="glass flex flex-wrap items-center gap-2 rounded-lg border border-line p-2.5">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold">Everything works offline</p>
            <p className="text-xs leading-relaxed text-ink-3">
              Your progress lives on this device by default. Sign in only if you want it on more than one.
            </p>
          </div>
          <Button as={Link} to="/practice" variant="primary" iconRight={ArrowRight}>
            Start typing
          </Button>
        </div>
      </Reveal>
    </div>
  );
}

/* ── User guide ────────────────────────────────────────────────────────── */

const GUIDE = [
  {
    icon: Keyboard,
    title: 'Typing practice',
    steps: [
      'Pick a mode: **Time** for a sprint, **Words** for a fixed count, **Quote** for something memorable, **Drill** to target one row, **Zen** for no clock at all.',
      'Just start typing — the stage takes focus on your first keystroke.',
      '`Esc` restarts the run. `⇧ + Tab` fetches new text. `Ctrl + ⌫` deletes the last word.',
      'Paste anything with `Ctrl + V` to drill your own text immediately.',
    ],
  },
  {
    icon: Braces,
    title: 'Code typing',
    steps: [
      'Choose a language and difficulty. **AI** generates a fresh snippet; **Next** steps through the bundled library.',
      'Newlines auto-consume the next line\'s indentation, so you never hand-type eight spaces.',
      'The panel beside the code explains it: **Explain**, **Flow**, **Cost**, **Review**, and **Chat** for anything else.',
      'Hit the expand icon for a full-screen surface with the chat still alongside.',
    ],
  },
  {
    icon: Swords,
    title: 'Battlefield',
    steps: [
      'Create a private or public match or join with a 4-digit PIN.',
      'Race against players in real-time on identical passages with live progress markers.',
      'Earn placement XP and unlock battle-exclusive achievements.',
    ],
  },
  {
    icon: Command,
    title: 'Shortcuts',
    steps: [
      '`Ctrl/⌘ + K` opens quick actions from anywhere.',
      '`Ctrl/⌘ + \\` collapses and expands the sidebar.',
      '`Esc` restarts a run, or leaves full screen.',
      '`⇧ + Tab` loads fresh text without touching the mouse.',
    ],
  },
];

function GuideTab() {
  return (
    <Stagger className="grid gap-2 lg:grid-cols-2">
      {GUIDE.map((g) => (
        <StaggerItem key={g.title}>
          <div className="glass h-full rounded-lg border border-line p-2.5">
            <div className="flex items-center gap-1">
              <span className="grid h-[28px] w-[28px] place-items-center rounded-[9px] bg-brand-wash text-brand">
                <g.icon size={15} strokeWidth={2.2} aria-hidden />
              </span>
              <h3 className="text-base font-bold">{g.title}</h3>
            </div>
            <ol className="mt-1.5 space-y-1">
              {g.steps.map((s, i) => (
                <li key={i} className="flex gap-1.5">
                  <span className="mt-px grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full bg-subtle font-mono text-2xs font-bold text-ink-2">
                    {i + 1}
                  </span>
                  <Markdown text={s} compact className="min-w-0 flex-1" />
                </li>
              ))}
            </ol>
          </div>
        </StaggerItem>
      ))}
    </Stagger>
  );
}

/* ── Ask for help ──────────────────────────────────────────────────────── */

const HELP_SYSTEM = [
  'You are the help assistant inside TypeForge, a typing and code-typing app.',
  'Answer questions about how to use the app, typing technique, and code practice.',
  'Be brief and concrete — under 140 words. Never invent features; if you are unsure whether',
  'something exists, say so and suggest the closest thing that does.',
  '',
  'What exists: Typing practice (Time, Words, Quote, Drill, Custom, Zen modes; difficulty easy to',
  'expert; live WPM, accuracy, consistency; a keyboard visualiser; per-key weak-spot tracking).',
  'Code typing (11 languages, 4 difficulties, AI-generated snippets, auto-indent, a side panel with',
  'Explain/Flow/Cost/Review/Chat, full-screen mode). Battlefield (real-time multiplayer typing race).',
  'Progress dashboard, achievements, XP, levels, daily missions and streaks. Everything works offline;',
  'progress is stored on the device.',
  'Formatting: never use markdown tables.',
].join('\n');

const HELP_STARTERS = [
  'How do I stop looking at the keyboard?',
  'What do the caret styles do?',
  'How is consistency calculated?',
  'My accuracy drops when I speed up — what should I drill?',
];

function HelpTab() {
  const reduce = useReducedMotionSafe();
  const ready = aiConfigured();
  const scrollRef = useRef(null);
  const endRef = useRef(null);
  const [draft, setDraft] = useState('');

  const { messages, busy, thinking, partial, ask } = useStreamingChat({
    system: HELP_SYSTEM,
    maxTokens: 700,
    surface: 'about-help',
  });

  useScrollAnchor({ scrollRef, endRef, deps: [messages.length, partial, thinking], streaming: busy, reduce });

  const send = () => {
    if (!draft.trim()) return;
    ask(draft);
    setDraft('');
  };

  return (
    <div className="glass flex h-[calc(100dvh-260px)] min-h-[380px] flex-col overflow-hidden rounded-lg border border-line">
      <header className="flex shrink-0 items-center gap-1 border-b border-line px-2 py-1.5">
        <span className="grid h-[26px] w-[26px] place-items-center rounded-[8px] bg-brand-wash text-brand">
          <LifeBuoy size={14} strokeWidth={2.4} aria-hidden />
        </span>
        <p className="text-sm font-bold">Help assistant</p>
        {!ready ? <Chip tone="warn" className="ml-auto">no key</Chip> : null}
      </header>

      <div ref={scrollRef} className="min-h-0 flex-1 space-y-2 overflow-y-auto px-2.5 py-2">
        {messages.length === 0 && !busy ? (
          <div className="py-3 text-center">
            <p className="text-sm font-bold">{ready ? 'What can I help with?' : 'AI is not configured'}</p>
            <p className="mx-auto mt-0.5 max-w-[44ch] text-xs leading-relaxed text-ink-3">
              {ready
                ? 'Ask about any part of the app, or about getting faster.'
                : 'Set a provider key in .env.local to turn this on. The guide beside this tab covers the basics either way.'}
            </p>
            {ready ? (
              <div className="mx-auto mt-2 grid max-w-[520px] gap-1 sm:grid-cols-2">
                {HELP_STARTERS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => ask(s)}
                    className="rounded-sm border border-line px-1.5 py-1 text-left text-xs font-semibold leading-relaxed text-ink-2 transition-colors hover:border-line-strong hover:bg-subtle hover:text-ink"
                  >
                    {s}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        {messages.map((m, i) =>
          m.role === 'user' ? (
            <p key={i} className="ml-6 rounded-lg rounded-br-sm bg-brand-solid px-2 py-1 text-sm font-semibold text-brand-ink">
              {m.text}
            </p>
          ) : (
            <div key={i} className="mr-4 rounded-lg rounded-bl-sm border border-line px-2 py-1">
              <Markdown text={typeof m.text === 'string' ? m.text : (m.text?.detail ?? '')} compact />
            </div>
          ),
        )}

        {busy ? (
          <div className="mr-4 rounded-lg rounded-bl-sm border border-line px-2 py-1">
            {partial ? (
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink-2">{partial}</p>
            ) : (
              <div className="space-y-1">
                <Skeleton className="h-1.5 w-[62%]" />
                <Skeleton className="h-1.5 w-[44%]" />
              </div>
            )}
          </div>
        ) : null}
        <div ref={endRef} />
      </div>

      <form
        className="flex shrink-0 items-end gap-1 border-t border-line px-2 py-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          disabled={!ready}
          placeholder={ready ? 'Ask anything about TypeForge…' : 'AI is not configured'}
          aria-label="Ask the help assistant"
          className="h-[36px] min-w-0 flex-1 rounded-sm bg-subtle/60 px-1.5 text-sm outline-none placeholder:text-ink-3 focus:bg-subtle disabled:opacity-50"
        />
        <Button type="submit" size="sm" variant="brand" icon={Send} disabled={!ready || !draft.trim()} aria-label="Send" />
      </form>
    </div>
  );
}

/* ── Follow ────────────────────────────────────────────────────────────── */

/** The 34px rounded tile both cards lead with. */
function CardIcon({ icon: Icon }) {
  return (
    <span className="grid h-[34px] w-[34px] shrink-0 place-items-center rounded-[11px] bg-subtle text-ink-2">
      <Icon size={17} strokeWidth={2.2} aria-hidden />
    </span>
  );
}

/* Handles live here rather than scattered through the JSX so there is one place
   to correct when they change.

   These are the project's accounts, not a person's. Everything public about
   TypeForge goes through the brand — a maintainer's own handles are not a
   contact channel for it. */
const INSTAGRAM = 'https://www.instagram.com/keystroke.ai/';
const EMAIL = 'keystroke-ai@proton.me';

/**
 * The two cards do different things, so they are different elements.
 *
 * Instagram is a destination and stays an anchor. Email is not — a `mailto:`
 * opens whatever the OS thinks is a mail client, which on a lot of machines is
 * nothing at all, or the wrong thing. Copying the address is the action people
 * actually want, so the card is a button and says so.
 */
function FollowTab() {
  const { copied, copy } = useCopyToClipboard();

  return (
    <div className="space-y-2.5">
      <Stagger className="grid gap-2 sm:grid-cols-2">
        <StaggerItem>
          <a
            href={INSTAGRAM}
            target="_blank"
            rel="noreferrer noopener"
            className="glass flex h-full items-start gap-1.5 rounded-lg border border-line p-2.5 transition-transform duration-200 hover:-translate-y-px hover:border-line-strong"
          >
            <CardIcon icon={Instagram} />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold">Instagram</p>
              <p className="truncate font-mono text-2xs text-brand">@keystroke.ai</p>
              <p className="mt-0.5 text-xs leading-relaxed text-ink-3">
                Progress notes, new features, and the occasional typing-speed brag.
              </p>
              <p className="mt-1 flex items-center gap-0.5 text-xs font-bold text-brand">
                Follow us <ArrowRight size={13} strokeWidth={2.4} aria-hidden />
              </p>
            </div>
          </a>
        </StaggerItem>

        {/* Not a single clickable card like Instagram, deliberately. Copying is
            the action people want from an address, but navigator.clipboard can
            refuse — it needs a secure context and a permission the browser is
            free to deny. If the copy were the only affordance, a refusal would
            leave the address with nothing to do and no feedback. So the address
            itself stays a real mailto link and the copy sits beside it. */}
        <StaggerItem>
          <div className="glass flex h-full items-start gap-1.5 rounded-lg border border-line p-2.5 transition-transform duration-200 hover:-translate-y-px hover:border-line-strong">
            <CardIcon icon={Mail} />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold">Email</p>
              <a
                href={`mailto:${EMAIL}?subject=TypeForge%20feedback`}
                className="block truncate font-mono text-2xs text-brand hover:underline"
              >
                {EMAIL}
              </a>
              <p className="mt-0.5 text-xs leading-relaxed text-ink-3">
                Bugs, ideas, or anything you want to say directly. It gets read.
              </p>
              <button
                type="button"
                onClick={() => copy(EMAIL)}
                title={`Copy ${EMAIL}`}
                className={cx(
                  'mt-1 flex items-center gap-0.5 text-xs font-bold transition-colors',
                  copied ? 'text-good' : 'text-brand hover:underline',
                )}
              >
                <span aria-live="polite">{copied ? 'Copied' : 'Copy email'}</span>
                {copied
                  ? <Check size={13} strokeWidth={2.6} aria-hidden />
                  : <Copy size={13} strokeWidth={2.4} aria-hidden />}
              </button>
            </div>
          </div>
        </StaggerItem>
      </Stagger>

      <Reveal delay={0.05}>
        <div className="glass rounded-lg border border-line p-3 text-center">
          <span className="mx-auto grid h-[38px] w-[38px] place-items-center rounded-full bg-brand-wash">
            <Sparkles size={18} className="text-brand" aria-hidden />
          </span>
          <p className="mt-1.5 text-base font-bold">Tell us what&apos;s missing</p>
          <p className="mx-auto mt-0.5 max-w-[52ch] text-sm leading-relaxed text-ink-2">
            A language you want, a feature request, a drill that would help, or
            something that&apos;s simply broken — open an issue. It genuinely gets read, and most of
            what&apos;s here started as someone asking for it.
          </p>
          <Button
            as="a"
            href="https://github.com/n4m4n-xd-69/TypeForge/issues/new"
            target="_blank"
            rel="noreferrer noopener"
            variant="primary"
            size="sm"
            iconRight={ArrowRight}
            className="mt-2"
          >
            Open an issue
          </Button>
          <p className={cx('mt-2 flex items-center justify-center gap-0.5 text-2xs font-bold text-ink-3')}>
            Made with Love
            <Heart size={11} strokeWidth={0} className="fill-[#ff4d5e]" aria-hidden />
          </p>
        </div>
      </Reveal>
    </div>
  );
}
