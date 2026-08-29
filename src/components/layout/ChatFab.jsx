import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowUpRight, Braces, Check, Hand, Maximize2, Plus, Send, Square, Target, TrendingUp, X,
} from 'lucide-react';
import { Chip, Skeleton } from '../ui/Primitives.jsx';
import Markdown from '../ui/Markdown.jsx';
import ForgeAvatar from '../brand/ForgeAvatar.jsx';
import { aiConfigured } from '../../lib/ai.js';
import { useScrollAnchor, useStreamingChat } from '../../lib/useStreamingChat.js';
import { useReducedMotionSafe } from '../../lib/motion.js';
import { useStats, useStore } from '../../lib/store.jsx';
import { keyLabel, weakestKeys } from '../../lib/typing.js';
import { capabilitiesFor, categorise, followUpsFor, traceSteps } from '../../lib/coachPrompts.js';
import { newThreadId, readThreads, titleFrom, writeThreads } from '../../lib/chatStore.js';
import { consumePanelOpen, readActiveId, writeActiveId, writeOrigin } from '../../lib/chatSession.js';
import { cx, relativeTime } from '../../lib/format.js';

const CAPABILITY_ICON = { hand: Hand, target: Target, braces: Braces, trend: TrendingUp };

/**
 * The floating coach.
 *
 * Bottom-right rather than bottom-left, because the rail and the mobile tab bar
 * both own the left corner. It sits above the rail and the top bar but below
 * modals, so a dialog still takes the keyboard cleanly.
 *
 * Two things make this the same assistant as /chat rather than a lookalike:
 *
 *   - It reads and writes the same threads, keyed by the id in `chatSession`.
 *     Expanding carries the conversation to the page; minimising carries it
 *     back. Neither is a hand-off, because there is only ever one transcript.
 *   - Its blank state is the coach's home: greeting, what it can see, what it
 *     can do, and what you have already asked. The page opens on a single
 *     prompt because you arrived there to talk; the panel opens on a menu
 *     because you arrived mid-task and need to choose.
 */
export default function ChatFab() {
  const reduce = useReducedMotionSafe();
  const ready = aiConfigured();
  const stats = useStats();
  const { state } = useStore();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [filter, setFilter] = useState('All');
  const scrollRef = useRef(null);
  const endRef = useRef(null);
  const panelRef = useRef(null);

  /* ── The shared session ──────────────────────────────────────────────── */
  const [activeId, setActiveId] = useState(() => readActiveId() ?? newThreadId());
  const [threads, setThreads] = useState(() => readThreads());

  const weak = weakestKeys(state.keyStats, 5).map((k) => keyLabel(k.key));
  const system = [
    'You are the coach inside TypeForge, a typing and code-typing platform. Friendly and direct.',
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

  const { messages, setMessages, busy, thinking, partial, ask, stop } = useStreamingChat({
    system,
    maxTokens: 700,
    surface: 'fab',
  });

  useScrollAnchor({ scrollRef, endRef, deps: [messages.length, partial, thinking], streaming: busy, reduce });

  /* Load the shared thread's transcript. Guarded by a ref rather than by a
     dependency on `threads`, which would clobber the live transcript every
     time a save wrote back to it — the same guard /chat uses. */
  const loadedFor = useRef(null);
  useEffect(() => {
    if (loadedFor.current === activeId) return;
    loadedFor.current = activeId;
    setMessages(readThreads().find((t) => t.id === activeId)?.messages ?? []);
  }, [activeId, setMessages]);

  /* Persist. Without this the panel's half of a conversation would vanish the
     moment it was expanded, which is the bug that made the two surfaces feel
     like separate products. */
  useEffect(() => {
    if (!messages.length) return;
    setThreads((prev) => {
      const rest = prev.filter((t) => t.id !== activeId);
      return writeThreads([
        { id: activeId, title: titleFrom(messages), updatedAt: Date.now(), messages },
        ...rest,
      ]);
    });
  }, [messages, activeId]);

  useEffect(() => {
    writeActiveId(activeId);
  }, [activeId]);

  /* Arriving from /chat's minimise button. */
  useEffect(() => {
    if (consumePanelOpen()) setOpen(true);
  }, [pathname]);

  /* Re-read on open: /chat may have moved the conversation on while the panel
     was closed. */
  useEffect(() => {
    if (!open) return;
    const shared = readActiveId();
    setThreads(readThreads());
    if (shared && shared !== activeId) setActiveId(shared);
    else loadedFor.current = null;
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  /* Escape closes, and only when nothing else has claimed the key — a modal
     open over this should get it first. */
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      if (document.querySelector('[role="dialog"]')) return;
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

  const expand = useCallback(() => {
    writeActiveId(activeId);
    writeOrigin(pathname);
    setOpen(false);
    navigate('/chat');
  }, [activeId, pathname, navigate]);

  const startNew = useCallback(() => {
    const id = newThreadId();
    loadedFor.current = id; // empty by construction
    setActiveId(id);
    setMessages([]);
    setDraft('');
  }, [setMessages]);

  const openThread = useCallback((id) => {
    setActiveId(id);
    setDraft('');
  }, []);

  /* Same rules as the full page, so both surfaces offer the same next step for
     the same answer. */
  const followUps = busy ? [] : followUpsFor(messages, { weak });

  const capabilities = useMemo(
    () => capabilitiesFor(stats, weak, state.settings.lastLanguage),
    [stats, weak, state.settings.lastLanguage],
  );

  /* History, grouped the way the chips read. Threads carry no category of
     their own, so it is derived from the title — which is the first thing the
     user said, and therefore what they would search for. */
  const history = useMemo(() => threads.filter((t) => t.id !== activeId || messages.length === 0), [threads, activeId, messages.length]);
  const categories = useMemo(() => {
    const seen = new Set(history.map((t) => categorise(t.title)));
    return ['All', ...[...seen].sort()];
  }, [history]);
  const visibleHistory = useMemo(
    () => (filter === 'All' ? history : history.filter((t) => categorise(t.title) === filter)).slice(0, 6),
    [history, filter],
  );

  /* Redundant on /chat, and its send button sits exactly where the FAB does.
     Placed after every hook so the hook order never changes between routes. */
  if (pathname.startsWith('/chat')) return null;

  const send = () => {
    if (!draft.trim()) return;
    ask(draft);
    setDraft('');
  };

  const name = state.profile.name?.trim();
  const home = messages.length === 0 && !busy;

  return (
    <>
      <AnimatePresence>
        {open ? (
          <motion.div
            ref={panelRef}
            key="panel"
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: 12, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: 8, scale: 0.98 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            style={{ transformOrigin: 'bottom right' }}
            className={cx(
              'fap-float fixed bottom-[86px] right-2 z-[46] flex w-[min(388px,calc(100vw-16px))] flex-col',
              'overflow-hidden rounded-lg',
              'h-[min(600px,calc(100dvh-160px))]',
            )}
            role="dialog"
            aria-label="Forge AI"
          >
            <header className="fap-seam fap-seam-bottom flex shrink-0 items-center gap-1.5 px-1.5 py-1.5">
              <ForgeAvatar size={30} busy={busy} />
              <div className="min-w-0">
                <p className="truncate font-display text-sm font-bold leading-tight tracking-[-0.01em]">Forge AI</p>
                <p className="truncate text-2xs text-ink-3">
                  {busy
                    ? 'Working…'
                    : stats.sessionCount
                      ? `${Math.round(stats.wpm)} WPM · ${Math.round(stats.accuracy)}%`
                      : 'Ask me anything'}
                </p>
              </div>
              <div className="ml-auto flex shrink-0 items-center gap-px">
                {!ready ? <Chip tone="warn" className="mr-0.5">no key</Chip> : null}
                {!home ? <PanelAction label="New chat" icon={Plus} onClick={startNew} /> : null}
                {/* Carries this exact conversation to the full page. */}
                <PanelAction label="Open in full page" icon={Maximize2} onClick={expand} />
                <PanelAction label="Close Forge AI" icon={X} onClick={() => setOpen(false)} />
              </div>
            </header>

            <div ref={scrollRef} className="fap-scroll min-h-0 flex-1 space-y-1.5 overflow-y-auto px-1.5 py-1.5">
              {home ? (
                <CoachHome
                  name={name}
                  ready={ready}
                  stats={stats}
                  weak={weak}
                  capabilities={capabilities}
                  categories={categories}
                  filter={filter}
                  onFilter={setFilter}
                  history={visibleHistory}
                  onOpenThread={openThread}
                  onPick={ask}
                  reduce={reduce}
                />
              ) : null}

              {messages.map((m, i) =>
                m.role === 'user' ? (
                  <div key={i} className="flex justify-end pl-5">
                    <p className="fap-user max-w-[88%] whitespace-pre-wrap rounded-md rounded-br-xs px-1.5 py-1 text-xs font-semibold">
                      {m.text}
                    </p>
                  </div>
                ) : (
                  <div key={i} className="fap-ai mr-2 rounded-md rounded-tl-xs px-1.5 py-1">
                    <Markdown text={typeof m.text === 'string' ? m.text : (m.text?.detail ?? '')} compact />
                  </div>
                ),
              )}

              {busy ? (
                <div className="fap-ai mr-2 rounded-md rounded-tl-xs px-1.5 py-1">
                  <MiniTrace steps={traceSteps({ thinking, partial, hasContext: stats.sessionCount > 0 })} />
                  {partial ? (
                    <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-ink-2">
                      {partial}
                      <span className="fap-caret" aria-hidden />
                    </p>
                  ) : (
                    <div className="mt-1 space-y-1">
                      <Skeleton className="h-1.5 w-[60%]" />
                      <Skeleton className="h-1.5 w-[42%]" />
                    </div>
                  )}
                </div>
              ) : null}

              {followUps.length ? (
                <div className="mr-2 space-y-1 pt-0.5">
                  <p className="eyebrow">Next</p>
                  {followUps.map((p, i) => (
                    <motion.button
                      key={p}
                      type="button"
                      onClick={() => ask(p)}
                      initial={reduce ? false : { opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: reduce ? 0 : 0.04 * i, duration: 0.24 }}
                      className="fap-chip flex w-full items-center gap-1 rounded-sm py-1 pl-1.5 pr-1 text-left text-xs font-semibold text-ink-2 hover:text-ink"
                    >
                      <span className="min-w-0 flex-1 truncate">{p}</span>
                      <ArrowUpRight size={12} className="shrink-0 text-ink-3" aria-hidden />
                    </motion.button>
                  ))}
                </div>
              ) : null}

              <div ref={endRef} />
            </div>

            <form
              className="fap-seam fap-seam-top shrink-0 px-1.5 py-1.5"
              onSubmit={(e) => {
                e.preventDefault();
                send();
              }}
            >
              <div className="fap-well flex items-center gap-1 rounded-md p-0.5 pl-1.5">
                <input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  disabled={!ready}
                  placeholder={ready ? 'Ask Forge AI…' : 'Add a provider key to chat'}
                  aria-label="Ask Forge AI"
                  className="h-[34px] min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-ink-3 disabled:opacity-50"
                />
                {busy ? (
                  <button
                    type="button"
                    onClick={stop}
                    aria-label="Stop"
                    title="Stop"
                    className="grid h-[34px] w-[34px] shrink-0 place-items-center rounded-sm bg-ink/10 text-ink-2 transition-all duration-fast ease-out hover:bg-ink/[0.16] hover:text-ink active:scale-[0.94]"
                  >
                    <Square size={15} strokeWidth={2.3} aria-hidden />
                  </button>
                ) : (
                  <button
                    type="submit"
                    disabled={!ready || !draft.trim()}
                    aria-label="Send"
                    title="Send"
                    className="fap-user grid h-[34px] w-[34px] shrink-0 place-items-center rounded-sm transition-all duration-fast ease-out hover:brightness-[1.07] active:scale-[0.94] disabled:pointer-events-none disabled:opacity-35"
                  >
                    <Send size={15} strokeWidth={2.3} aria-hidden />
                  </button>
                )}
              </div>
            </form>
          </motion.div>
        ) : null}
      </AnimatePresence>

      {/* The mascot is the button. No disc behind it, no ring around it — the
          blob's own silhouette is the affordance, and its contact shadow is
          what lifts it off the page. */}
      <motion.button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={open ? 'Close Forge AI' : 'Open Forge AI'}
        title={open ? 'Close Forge AI' : 'Ask Forge AI'}
        initial={reduce ? false : { opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: reduce ? 0 : 0.6, duration: 0.35, ease: [0.34, 1.56, 0.64, 1] }}
        whileHover={reduce ? undefined : { scale: 1.07 }}
        whileTap={{ scale: 0.93 }}
        className={cx(
          'fixed bottom-2 right-2 z-[46] grid h-[62px] w-[62px] place-items-center rounded-full',
          // Clear of the mobile tab bar, which owns the bottom strip under lg.
          'mb-9 lg:mb-0',
        )}
      >
        <AnimatePresence mode="wait" initial={false}>
          {open ? (
            <motion.span
              key="close"
              initial={{ opacity: 0, rotate: -90 }}
              animate={{ opacity: 1, rotate: 0 }}
              exit={{ opacity: 0, rotate: 90 }}
              transition={{ duration: 0.16 }}
              className="fap-float grid h-[52px] w-[52px] place-items-center rounded-full"
            >
              <X size={22} strokeWidth={2.4} className="text-ink" aria-hidden />
            </motion.span>
          ) : (
            <motion.span
              key="orb"
              initial={{ opacity: 0, scale: 0.7 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.7 }}
              transition={{ duration: 0.16 }}
              className="grid place-items-center"
            >
              <ForgeAvatar size={58} busy={busy} />
            </motion.span>
          )}
        </AnimatePresence>
      </motion.button>
    </>
  );
}

/** Header control. Square-ish to match the app's own icon buttons. */
function PanelAction({ label, icon: Icon, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="grid h-[28px] w-[28px] place-items-center rounded-sm text-ink-3 transition-colors hover:bg-ink/10 hover:text-ink"
    >
      <Icon size={14} strokeWidth={2.3} aria-hidden />
    </button>
  );
}

/**
 * The coach's home.
 *
 * Four cards, in the order the questions actually arrive: who am I talking to,
 * what can you see, what can you do, what did I ask before. The panel opens
 * here rather than on a bare prompt because it is reached mid-task — you are
 * on the dashboard, something occurred to you, and picking is faster than
 * composing.
 *
 * The reference this is modelled on had a "24 requests left · upgrade to pro"
 * card in the second slot. There is no quota and no pro tier here, so that slot
 * shows what the coach can actually see instead. A card that invents a limit
 * the product does not have is worse than no card.
 */
function CoachHome({
  name, ready, stats, weak, capabilities, categories, filter, onFilter, history,
  onOpenThread, onPick, reduce,
}) {
  const rise = (i) => ({
    initial: reduce ? false : { opacity: 0, y: 8 },
    animate: { opacity: 1, y: 0 },
    transition: { delay: reduce ? 0 : 0.04 * i, duration: 0.3, ease: [0.16, 1, 0.3, 1] },
  });

  return (
    <div className="space-y-1.5 pb-1">
      {/* Greeting */}
      <motion.div {...rise(0)} className="px-0.5 pt-0.5">
        <h2 className="font-display text-lg font-bold leading-tight tracking-[-0.02em]">
          {name ? `Hi, ${name}` : 'Hi there'}
        </h2>
        <p className="text-xs text-ink-3">How can I help you today?</p>
      </motion.div>

      {/* What the coach can see. The mascot rides this card, the way the
          reference put its orb on the promo. */}
      <motion.div {...rise(1)} className="fap-tile flex items-center gap-1.5 rounded-md p-1.5">
        <ForgeAvatar size={46} />
        <div className="min-w-0 flex-1">
          <p className="eyebrow mb-0.5">Context in use</p>
          <p className="truncate text-xs font-semibold text-ink-2">
            {stats.sessionCount
              ? `${Math.round(stats.wpm)} WPM · ${Math.round(stats.accuracy)}% · Level ${stats.level.level}`
              : 'No sessions yet — advice will be general'}
          </p>
          <p className="truncate text-2xs text-ink-3">
            {weak.length ? `Weak keys: ${weak.slice(0, 5).join(' ')}` : 'No per-key weak spots recorded'}
          </p>
        </div>
      </motion.div>

      {/* What it can do */}
      <motion.div {...rise(2)}>
        <p className="eyebrow mb-1 px-0.5">Start with</p>
        <div className="grid grid-cols-2 gap-1">
          {capabilities.map((c) => {
            const Icon = CAPABILITY_ICON[c.icon] ?? Target;
            return (
              <button
                key={c.label}
                type="button"
                onClick={() => onPick(c.prompt)}
                disabled={!ready}
                className="fap-tile flex flex-col gap-1 rounded-md p-1.5 text-left disabled:pointer-events-none disabled:opacity-45"
              >
                <span className="grid h-[26px] w-[26px] place-items-center rounded-sm bg-brand-solid/[0.16] text-brand">
                  <Icon size={14} strokeWidth={2.3} aria-hidden />
                </span>
                <span className="text-xs font-bold leading-tight">{c.label}</span>
                <span className="text-2xs leading-snug text-ink-3">{c.hint}</span>
              </button>
            );
          })}
        </div>
      </motion.div>

      {/* What you asked before */}
      {history.length ? (
        <motion.div {...rise(3)}>
          <p className="eyebrow mb-1 px-0.5">History</p>
          {categories.length > 2 ? (
            <div className="mb-1 flex flex-wrap gap-0.5">
              {categories.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => onFilter(c)}
                  aria-pressed={filter === c}
                  className={cx(
                    'rounded-sm px-1 py-px text-2xs font-bold uppercase tracking-[0.06em] transition-colors',
                    filter === c ? 'bg-brand-solid/[0.18] text-brand' : 'text-ink-3 hover:bg-ink/[0.06] hover:text-ink-2',
                  )}
                >
                  {c}
                </button>
              ))}
            </div>
          ) : null}
          <div className="space-y-px">
            {history.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => onOpenThread(t.id)}
                className="flex w-full items-center gap-1 rounded-sm px-1 py-1 text-left transition-colors hover:bg-ink/[0.06]"
              >
                <span className="min-w-0 flex-1 truncate text-xs font-semibold text-ink-2">{t.title}</span>
                <span className="shrink-0 text-2xs text-ink-3">{relativeTime(t.updatedAt)}</span>
              </button>
            ))}
          </div>
        </motion.div>
      ) : null}

      {!ready ? (
        <p className="px-0.5 pt-0.5 text-2xs leading-relaxed text-ink-3">
          Add a provider key to <span className="font-mono text-ink-2">.env.local</span> to start chatting.
        </p>
      ) : null}
    </div>
  );
}

/** The page's trace, at panel width: labels only, no reasoning tail. */
function MiniTrace({ steps }) {
  return (
    <ol className="space-y-0.5" aria-live="polite">
      {steps.map((s) => (
        <li
          key={s.id}
          className={cx(
            'fap-step',
            s.state === 'done' && 'fap-step-done',
            s.state === 'active' && 'fap-step-active',
          )}
        >
          <span className="fap-step-dot" aria-hidden>
            {s.state === 'done' ? <Check size={7} strokeWidth={4} className="text-brand-ink" aria-hidden /> : null}
          </span>
          <p
            className={cx(
              'text-2xs font-semibold normal-case tracking-normal',
              s.state === 'idle' ? 'text-ink-3/60' : s.state === 'active' ? 'text-ink-2' : 'text-ink-3',
            )}
          >
            {s.label}
          </p>
        </li>
      ))}
    </ol>
  );
}
