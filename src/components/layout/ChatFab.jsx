import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowLeft, ArrowUpRight, Braces, Check, Copy, Ghost, LineChart, MessageSquare,
  RefreshCw, Send, Sparkles, Square, Swords, Target, X, Zap,
} from 'lucide-react';
import ForgeAvatar from '../brand/ForgeAvatar.jsx';
import Button from '../ui/Button.jsx';
import { Chip } from '../ui/Primitives.jsx';
import Markdown from '../ui/Markdown.jsx';
import { aiConfigured } from '../../lib/ai.js';
import { useScrollAnchor, useStreamingChat } from '../../lib/useStreamingChat.js';
import { useCopyToClipboard } from '../../lib/useCopyToClipboard.js';
import { useReducedMotionSafe } from '../../lib/motion.js';
import { useStats, useStore } from '../../lib/store.jsx';
import { keyLabel, weakestKeys } from '../../lib/typing.js';
import { cx, greeting } from '../../lib/format.js';
import { DRILLS } from '../../lib/content.js';
import './chat-glass.css';

/**
 * The floating agent — Forge AI.
 *
 * Bottom-right rather than bottom-left, because the rail and the mobile tab
 * bar both own the left corner. It sits above the rail and the top bar but
 * below modals, so a dialog still takes the keyboard cleanly.
 *
 * The system prompt is rebuilt from live stats on every open, so advice tracks
 * the run you just finished rather than whatever was true when the app booted.
 *
 * What makes it agentic rather than a chat box in a trench coat:
 *
 *   - Visible work. The context it genuinely gathers (session history, weak
 *     keys, streak) renders as a step trace while the first tokens are in
 *     flight — nothing invented, just the prompt's own inputs made visible.
 *   - Actions, not replies-only. When an answer settles, contextual chips
 *     offer the next move as navigation, plus regenerate/copy controls.
 *   - Capabilities up front. The empty state is a grid of surfaces it can
 *     send you to, not a "how can I help" shrug.
 *
 * Surface: LiqGlassX Tier-1 liquid glass (chat-glass.css), 14px radius —
 * instrument, not toy.
 */
export default function ChatFab() {
  const reduce = useReducedMotionSafe();
  const ready = aiConfigured();
  const stats = useStats();
  const { state } = useStore();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  /* The panel has two faces: the agent home (greeting, capability grid) and
     the conversation. A transcript flips the default to conversation; the
     header's back arrow returns to home without discarding it. */
  const [showHome, setShowHome] = useState(false);
  const scrollRef = useRef(null);
  const endRef = useRef(null);
  const panelRef = useRef(null);

  const weak = weakestKeys(state.keyStats, 5).map((k) => keyLabel(k.key));
  const system = [
    'You are Forge AI, the agent inside TypeForge, a typing and code-typing platform. Friendly and direct.',
    'Answer in under 130 words. No preamble. Never use markdown tables.',
    '',
    'About this user — use it to make advice specific, but do not recite it back:',
    `- Averages ${Math.round(stats.wpm)} WPM at ${Math.round(stats.accuracy)}% accuracy over ${stats.sessionCount} sessions.`,
    `- Level ${stats.level.level}, ${stats.streak}-day streak.`,
    weak.length ? `- Weakest keys: ${weak.join(', ')}.` : '- No per-key weak spots recorded yet.',
    state.settings.lastLanguage ? `- Practising ${state.settings.lastLanguage} in code typing.` : null,
  ]
    .filter(Boolean)
    .join('\n');

  const { messages, busy, thinking, partial, ask, regenerate, stop } = useStreamingChat({
    system,
    maxTokens: 700,
    surface: 'fab',
  });

  const { copied, copy } = useCopyToClipboard();

  useScrollAnchor({ scrollRef, endRef, deps: [messages.length, partial, thinking], streaming: busy, reduce });

  /* Escape closes, and only when nothing else has claimed the key — a modal
     open over this should get it first. The check excludes this panel's own
     role="dialog" so Escape works when Forge AI is the topmost dialog. */
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      const otherDialog = document.querySelector('[role="dialog"]:not(.forge-panel)');
      if (otherDialog) return;
      e.preventDefault();
      setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  /* Typing surfaces listen on window for keystrokes, so a click into this panel
     must not leave them stealing what you type. Focus lands here on open. */
  useEffect(() => {
    if (open) panelRef.current?.querySelector('input')?.focus();
  }, [open]);

  /* Redundant on /chat, and its send button sits exactly where the FAB does. */
  if (pathname.startsWith('/chat')) return null;

  /** Map weak keys to the drill that targets them. */
  const drillForWeakKeys = (keys) => {
    const keySet = new Set(keys.map((k) => k.toLowerCase()));
    const drillScores = DRILLS.map((d) => {
      const drillKeys = d.keys.toLowerCase().split('');
      const matches = drillKeys.filter((k) => keySet.has(k)).length;
      return { id: d.id, name: d.name, matches };
    });
    drillScores.sort((a, b) => b.matches - a.matches);
    return drillScores[0]?.id ?? 'home-row';
  };

  /** Surfaces Forge AI can act on. The empty state shows them as a grid; the
      same set narrows to contextual picks once an answer has landed. */
  const weakDrillId = weak.length ? drillForWeakKeys(weak) : null;
  const capabilities = [
    weakDrillId
      ? { to: `/practice?mode=drill&drill=${weakDrillId}`, label: `Drill ${weak.slice(0, 2).join(' ')}`, icon: Target }
      : { to: '/practice', label: 'Take baseline', icon: Zap },
    { to: '/practice?mode=time&duration=30', label: '30s sprint', icon: Zap },
    state.settings.lastLanguage
      ? { to: '/code', label: `Code · ${state.settings.lastLanguage}`, icon: Braces }
      : { to: '/code', label: 'Code session', icon: Braces },
    { to: '/battle', label: 'Live battle', icon: Swords },
    { to: '/shadow', label: 'Shadow duel', icon: Ghost },
    { to: '/dashboard', label: 'Progress', icon: LineChart },
  ];

  /** After an answer: the two most relevant moves plus message controls. */
  const actions = [capabilities[0], state.settings.lastLanguage ? capabilities[2] : capabilities[5]].filter(Boolean);

  const starters = [
    stats.sessionCount === 0 ? 'How should I start?' : `How do I get past ${Math.round(stats.wpm)} WPM?`,
    weak.length ? `Drill my weak keys: ${weak.slice(0, 3).join(', ')}` : 'What should I drill next?',
    'Explain a concept I keep forgetting',
  ];

  const lastMsg = messages[messages.length - 1];
  const canAct =
    !busy && messages.length > 0 && lastMsg?.role === 'assistant' && !lastMsg.failed && !lastMsg.stopped;

  /** Home = no transcript yet, or the user backed out to the grid. */
  const atHome = messages.length === 0 || showHome;

  const askAndGo = (q) => {
    setShowHome(false);
    ask(q);
  };

  const send = () => {
    if (!draft.trim()) return;
    ask(draft);
    setDraft('');
  };

  return (
    <>
      <AnimatePresence>
        {open ? (
          <motion.div
            ref={panelRef}
            key="panel"
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: 12, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: 8, scale: 0.98 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            /* NOTE: no `.glass` here — that legacy class paints a near-opaque
               fill that would sit under the forge-panel optics and kill the
               translucency. forge-panel::before IS the surface. */
            className="forge-panel fixed bottom-[74px] right-2 z-[46] flex w-[min(440px,calc(100vw-16px))] flex-col h-[min(652px,calc(100dvh-132px))]"
            role="dialog"
            aria-label="Forge AI"
          >
            <header className="flex shrink-0 items-center gap-1.5 border-b border-line/60 px-2 py-2">
              {/* Back to agent home — only once a conversation exists to
                  return from. Flips to a conversation-return button while on
                  the home screen, so it never dead-ends. */}
              {messages.length > 0 ? (
                <button
                  type="button"
                  onClick={() => setShowHome((v) => !v)}
                  title={atHome ? 'Back to conversation' : 'Agent home'}
                  aria-label={atHome ? 'Back to conversation' : 'Agent home'}
                  className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-md text-ink-3 transition-colors hover:bg-subtle hover:text-brand"
                >
                  {atHome ? (
                    <MessageSquare size={16} strokeWidth={2.2} aria-hidden />
                  ) : (
                    <ArrowLeft size={17} strokeWidth={2.4} aria-hidden />
                  )}
                </button>
              ) : null}
              <span className="relative grid h-[40px] w-[40px] shrink-0 place-items-center">
                <ForgeAvatar size={38} />
                {busy ? (
                  <motion.span
                    aria-hidden
                    className="absolute -right-0.5 -top-0.5 h-[9px] w-[9px] rounded-full bg-brand"
                    animate={reduce ? undefined : { scale: [1, 0.6, 1], opacity: [1, 0.45, 1] }}
                    transition={reduce ? undefined : { duration: 1.1, repeat: Infinity, ease: 'easeInOut' }}
                  />
                ) : null}
              </span>
              <div className="min-w-0">
                <p className="flex items-center gap-1 truncate text-base font-bold leading-tight">
                  Forge AI
                  <span className="rounded-[5px] bg-brand/15 px-1 font-mono text-[8px] font-bold uppercase tracking-[0.14em] text-brand ring-1 ring-inset ring-brand/25">
                    agent
                  </span>
                </p>
                <p className="truncate text-2xs text-ink-3" aria-live="polite">
                  <AgentStatus busy={busy} partial={partial} thinking={thinking} stats={stats} weak={weak} />
                </p>
              </div>
              {!ready ? <Chip tone="warn" className="ml-auto">no key</Chip> : null}
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close Forge AI"
                className={cx('rounded-md p-1 text-ink-3 transition-colors hover:bg-subtle hover:text-ink', ready && 'ml-auto')}
              >
                <X size={15} strokeWidth={2.4} aria-hidden />
              </button>
            </header>

            <div ref={scrollRef} className="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-2 py-2">
              {atHome && !busy ? (
                <div className="py-2 text-center">
                  <div className="relative mx-auto w-fit">
                    <span aria-hidden className="absolute inset-x-4 bottom-0 h-4 rounded-full bg-brand/30 blur-lg" />
                    <ForgeAvatar size={86} className="relative" />
                  </div>
                  <p className="mt-1.5 text-sm font-bold">{greeting()} — I'm Forge AI.</p>
                  {/* Visible way back: the header arrow toggles this too, but a
                      transcript vanishing behind a grid deserves an obvious,
                      labelled door back to it. */}
                  {messages.length > 0 ? (
                    <button
                      type="button"
                      onClick={() => setShowHome(false)}
                      className="mx-auto mt-2 inline-flex items-center gap-1 rounded-[7px] border border-brand/30 bg-brand-wash/50 px-2 py-0.5 text-2xs font-bold text-brand transition-colors hover:bg-brand-wash"
                    >
                      <ArrowLeft size={11} strokeWidth={2.8} aria-hidden />
                      Back to conversation
                    </button>
                  ) : null}
                  <p className="mx-auto mt-0.5 max-w-[32ch] text-xs leading-relaxed text-ink-3">
                    {ready
                      ? 'I read your runs before I answer. Pick a mission or ask me anything.'
                      : 'Set a provider key in .env.local to turn me on.'}
                  </p>

                  {ready ? (
                    <>
                      {/* Capability grid — what the agent can do, one click each. */}
                      <div className="mt-2.5 grid grid-cols-3 gap-1 text-left">
                        {capabilities.map((c, i) => (
                          <motion.div
                            key={c.to + c.label}
                            initial={reduce ? false : { opacity: 0, y: 6 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: reduce ? 0 : 0.04 * i, duration: 0.25 }}
                          >
                            <Link
                              to={c.to}
                              onClick={() => setOpen(false)}
                              title={c.label}
                              className="group flex h-full flex-col items-start gap-1 rounded-lg border border-line bg-surface/40 px-1.5 py-1.5 transition-colors hover:border-brand/40 hover:bg-brand-wash/30"
                            >
                              <c.icon size={14} strokeWidth={2.2} className="text-ink-3 transition-colors group-hover:text-brand" aria-hidden />
                              <span className="w-full truncate text-[10px] font-bold leading-tight text-ink-2 group-hover:text-ink">
                                {c.label}
                              </span>
                            </Link>
                          </motion.div>
                        ))}
                      </div>

                      <p className="mt-2 text-left font-mono text-[8px] font-bold uppercase tracking-[0.18em] text-ink-3/70">
                        or ask
                      </p>
                      <div className="mt-1 space-y-1 text-left">
                        {starters.map((s, i) => (
                          <motion.button
                            key={s}
                            type="button"
                            onClick={() => askAndGo(s)}
                            initial={reduce ? false : { opacity: 0, x: -6 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ delay: reduce ? 0 : 0.05 * i, duration: 0.25 }}
                            className="group flex w-full items-center gap-1 rounded-md border border-line bg-surface/50 px-1.5 py-1 text-left text-xs font-semibold text-ink-2 transition-colors hover:border-brand/40 hover:bg-brand-wash/40 hover:text-ink"
                          >
                            <span className="min-w-0 flex-1">{s}</span>
                            <ArrowUpRight size={13} strokeWidth={2.2} aria-hidden className="shrink-0 text-ink-3 transition-colors group-hover:text-brand" />
                          </motion.button>
                        ))}
                      </div>
                    </>
                  ) : null}
                </div>
              ) : null}

              {!atHome ? (
                <>
                  {messages.map((m, i) =>
                    m.role === 'user' ? (
                      <p key={i} className="ml-5 rounded-md rounded-br-[3px] bg-brand-solid px-1.5 py-1 text-[13px] font-semibold text-brand-ink shadow-e1">
                        {m.text}
                      </p>
                    ) : (
                      <div key={i} className="mr-2 flex items-start gap-1.5">
                        <span className="mt-0.5 grid h-[24px] w-[24px] shrink-0 place-items-center">
                          <ForgeAvatar size={24} />
                        </span>
                        <div className="min-w-0 flex-1 rounded-md rounded-tl-none border border-white/[0.08] bg-white/[0.05] px-1.5 py-1 backdrop-blur-md">
                          <Markdown text={typeof m.text === 'string' ? m.text : (m.text?.detail ?? '')} compact />
                        </div>
                      </div>
                    ),
                  )}

                  {busy ? (
                    partial ? (
                      <>
                        <div className="mr-2 flex items-start gap-1.5">
                          <span className="mt-0.5 grid h-[24px] w-[24px] shrink-0 place-items-center">
                            <ForgeAvatar size={24} />
                          </span>
                          <div className="min-w-0 flex-1 rounded-md rounded-tl-none border border-white/[0.08] bg-white/[0.05] px-1.5 py-1 backdrop-blur-md">
                            <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-ink-2">
                              {partial}
                              <span
                                aria-hidden
                                className="ml-0.5 inline-block h-[13px] w-[7px] translate-y-[2px] rounded-[2px] bg-brand motion-safe:animate-pulse"
                              />
                            </p>
                          </div>
                        </div>
                        <div aria-live="polite" className="sr-only" role="status">
                          {partial}
                        </div>
                      </>
                    ) : (
                      /* Pre-first-token: the visible half of agentic behaviour —
                         the trace of context Forge AI actually gathers locally,
                         narrated Claude Code-style while it works. */
                      <AgentTrace weak={weak} stats={stats} reduce={reduce} />
                    )
                  ) : null}

                  {canAct ? (
                <motion.div
                  initial={reduce ? false : { opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.15, duration: 0.25 }}
                  className="mr-2 flex flex-wrap items-center gap-1 pt-0.5"
                >
                  {actions.map((a) => (
                    <Link
                      key={a.to + a.label}
                      to={a.to}
                      onClick={() => setOpen(false)}
                      className="group inline-flex items-center gap-0.5 rounded-[7px] border border-brand/30 bg-brand-wash/50 px-1.5 py-0.5 text-2xs font-bold text-brand transition-colors hover:bg-brand-wash"
                    >
                      <a.icon size={11} strokeWidth={2.4} aria-hidden />
                      {a.label}
                      <ArrowUpRight size={10} strokeWidth={2.6} aria-hidden className="transition-transform group-hover:-translate-y-px group-hover:translate-x-px" />
                    </Link>
                  ))}

                  {/* Agent controls: re-run the answer, take the text. */}
                  <span className="ml-auto inline-flex items-center gap-0.5">
                    <button
                      type="button"
                      onClick={regenerate}
                      title="Regenerate answer"
                      aria-label="Regenerate answer"
                      className="rounded-md p-1 text-ink-3 transition-colors hover:bg-subtle hover:text-ink"
                    >
                      <RefreshCw size={12} strokeWidth={2.4} aria-hidden />
                    </button>
                    <button
                      type="button"
                      onClick={() => copy(typeof lastMsg.text === 'string' ? lastMsg.text : (lastMsg.text?.detail ?? ''))}
                      title="Copy answer"
                      aria-label="Copy answer"
                      className="rounded-md p-1 text-ink-3 transition-colors hover:bg-subtle hover:text-ink"
                    >
                      {copied ? (
                        <Check size={12} strokeWidth={2.6} className="text-good" aria-hidden />
                      ) : (
                        <Copy size={12} strokeWidth={2.4} aria-hidden />
                      )}
                    </button>
                  </span>
                </motion.div>
) : null}
                <div ref={endRef} />
              </>
            ) : null}
            </div>

            <form
              className="flex shrink-0 items-center gap-1 border-t border-line/60 px-1.5 py-1.5"
              onSubmit={(e) => {
                e.preventDefault();
                send();
              }}
            >
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                disabled={!ready || busy}
                placeholder={ready ? (busy ? 'Forge AI is thinking…' : 'Task Forge AI…') : 'AI is not configured'}
                aria-label="Ask Forge AI"
                className="h-[34px] min-w-0 flex-1 rounded-md bg-subtle/60 px-1.5 text-sm outline-none placeholder:text-ink-3 focus:bg-subtle focus:ring-1 focus:ring-brand/30 disabled:opacity-50"
              />
              {busy ? (
                <Button type="button" size="sm" variant="ghost" icon={Square} onClick={stop} aria-label="Stop" />
              ) : (
                <Button type="submit" size="sm" variant="brand" icon={Send} disabled={!ready || !draft.trim()} aria-label="Send" />
              )}
            </form>
          </motion.div>
        ) : null}
      </AnimatePresence>

      {/* The launcher is the character itself — no button chrome, no disc.
          Transparency is the point: Forge AI floats over the page with only
          an orange ground-glow to seat it. Hit area stays a comfortable 56px;
          when open, the X gets a small frosted chip for legibility over any
          content. */}
      <motion.button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={open ? 'Close Forge AI' : 'Ask Forge AI'}
        title={open ? 'Close Forge AI' : 'Ask Forge AI'}
        initial={reduce ? false : { opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: reduce ? 0 : 0.6, duration: 0.35, ease: [0.34, 1.56, 0.64, 1] }}
        whileHover={reduce ? undefined : { y: -4, rotate: -6 }}
        whileTap={{ scale: 0.95 }}
        className="fixed bottom-2 right-2 z-[46] grid h-[62px] w-[62px] place-items-center mb-9 lg:mb-0"
      >
        <AnimatePresence mode="wait" initial={false}>
          {open ? (
            <motion.span
              key="close"
              initial={{ opacity: 0, rotate: -90 }}
              animate={{ opacity: 1, rotate: 0 }}
              exit={{ opacity: 0, rotate: 90 }}
              transition={{ duration: 0.16 }}
              className="glass grid h-[36px] w-[36px] place-items-center rounded-lg border border-line shadow-lg"
            >
              <X size={19} strokeWidth={2.4} className="text-ink" aria-hidden />
            </motion.span>
          ) : (
            <motion.span
              key="forge"
              initial={{ opacity: 0, rotate: 90 }}
              animate={{ opacity: 1, rotate: 0 }}
              exit={{ opacity: 0, rotate: -90 }}
              transition={{ duration: 0.16 }}
              className="relative"
            >
              {/* Ground glow as a sibling blur layer, NOT a drop-shadow filter
                  on the image — filters rasterize the asset and soften it. */}
              <span
                aria-hidden
                className="absolute inset-x-2 -bottom-1 h-4 rounded-full bg-brand/40 blur-lg"
              />
              <ForgeAvatar
                size={66}
                className="relative block"
                animate={reduce ? undefined : { y: [0, -5, 0] }}
                transition={reduce ? undefined : { duration: 2.6, repeat: Infinity, ease: 'easeInOut' }}
              />
              {/* A quiet "there is something here" cue, only before first use. */}
              {ready && messages.length === 0 ? (
                <motion.span
                  aria-hidden
                  animate={reduce ? undefined : { scale: [1, 1.35, 1], opacity: [0.9, 0.4, 0.9] }}
                  transition={reduce ? undefined : { duration: 2.2, repeat: Infinity, ease: 'easeInOut' }}
                  className="absolute -right-0.5 -top-0.5"
                >
                  <Sparkles size={12} className="text-brand drop-shadow" aria-hidden />
                </motion.span>
              ) : null}
            </motion.span>
          )}
        </AnimatePresence>
      </motion.button>
    </>
  );
}

/* ── Agentic chrome ────────────────────────────────────────────────────── */

/**
 * The status line under the name. It narrates state rather than sitting
 * static: what is being gathered pre-stream, that writing is happening
 * mid-stream, and its read on your numbers when idle.
 */
function AgentStatus({ busy, partial, thinking, stats, weak }) {
  if (busy) {
    if (partial) return <span className="text-brand">writing…</span>;
    if (thinking) return <span className="text-brand">reasoning…</span>;
    return <span className="text-brand">reading your runs…</span>;
  }
  return stats.sessionCount
    ? `${Math.round(stats.wpm)} WPM · ${Math.round(stats.accuracy)}%${weak.length ? ` · watching ${weak[0]}` : ''}`
    : 'ready when you are';
}

/**
 * Simple loading indicator shown between "sent" and "first token".
 *
 * Since the AI provider doesn't expose granular progress events, we show a
 * single shimmering verb rather than simulating step completion. The verb
 * rotates through a small set while the request is in flight.
 */
const LOADER_VERBS = ['Thinking', 'Reading your runs', 'Forging', 'Checking patterns', 'Polishing'];

function AgentTrace({ reduce }) {
  const [verb, setVerb] = useState(0);

  useEffect(() => {
    if (reduce) return undefined;
    const verbTimer = setInterval(() => {
      setVerb((v) => (v + 1) % LOADER_VERBS.length);
    }, 950);
    return () => clearInterval(verbTimer);
  }, [reduce]);

  return (
    <div className="mr-2 flex items-start gap-1.5">
      <span className="mt-0.5 grid h-[24px] w-[24px] shrink-0 place-items-center">
        <ForgeAvatar size={24} />
      </span>
      <div className="min-w-0 flex-1 rounded-md rounded-tl-none border border-white/[0.08] bg-white/[0.04] px-1.5 py-1.5 backdrop-blur-md" aria-label="Gathering context">
        <p className="flex items-center gap-1 text-2xs font-bold">
          <motion.span
            aria-hidden
            className="inline-flex text-brand"
            animate={reduce ? undefined : { rotate: 360 }}
            transition={reduce ? undefined : { duration: 2.2, repeat: Infinity, ease: 'linear' }}
          >
            <Sparkles size={11} strokeWidth={2.4} />
          </motion.span>
          <span className="forge-shimmer">{LOADER_VERBS[verb]}…</span>
        </p>
      </div>
    </div>
  );
}
