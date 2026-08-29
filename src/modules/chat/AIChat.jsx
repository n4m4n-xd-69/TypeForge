import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowDown, ArrowUpRight, Brain, Check, ChevronDown, Copy, Hand, Keyboard, Minimize2, Pencil,
  Plus, RefreshCw, Search, Send, Square, Target, Trash2, TrendingUp, Type, Zap,
} from 'lucide-react';
import Button, { IconButton } from '../../components/ui/Button.jsx';
import { Chip, Skeleton } from '../../components/ui/Primitives.jsx';
import Markdown from '../../components/ui/Markdown.jsx';
import ForgeAvatar from '../../components/brand/ForgeAvatar.jsx';
import { aiConfigured } from '../../lib/ai.js';
import { useScrollAnchor, useStreamingChat } from '../../lib/useStreamingChat.js';
import { useCopyToClipboard } from '../../lib/useCopyToClipboard.js';
import { useStats, useStore } from '../../lib/store.jsx';
import { useAuth } from '../../lib/auth.jsx';
import { keyLabel, weakestKeys } from '../../lib/typing.js';
import { cx } from '../../lib/format.js';
import { useReducedMotionSafe } from '../../lib/motion.js';
import { followUpsFor, languageName, startersFor, traceSteps } from '../../lib/coachPrompts.js';
import { readActiveId, readOrigin, requestPanelOpen, writeActiveId } from '../../lib/chatSession.js';
import {
  deleteThread, mergeThreads, newThreadId, pullThreads, pushMessages, readThreads,
  titleFrom, writeThreads,
} from '../../lib/chatStore.js';

const BASE_SYSTEM =
  'You are the coach inside TypeForge, a typing and code-typing platform. Answer in a friendly, ' +
  'direct voice. Prefer short paragraphs and concrete examples. When the question is about code, ' +
  'show a small runnable snippet in a fenced block. Keep answers under 250 words unless asked to ' +
  'go deeper. Use markdown headings only when an answer genuinely has sections. ' +
  'Never use markdown tables — the renderer here does not support them.';

/** Starter icons. Line icons rather than emoji: emoji render differently on
 *  every platform and pull the eye harder than the sentence beside them. */
const STARTER_ICON = {
  keyboard: Keyboard, target: Target, brain: Brain, hand: Hand,
  zap: Zap, type: Type, trend: TrendingUp,
};

export default function AIChat() {
  const reduce = useReducedMotionSafe();
  const stats = useStats();
  const { state } = useStore();
  const { user } = useAuth();
  const navigate = useNavigate();
  const ready = aiConfigured();

  const scrollRef = useRef(null);
  const endRef = useRef(null);
  const [draft, setDraft] = useState('');
  const [pinned, setPinned] = useState(true);
  const [query, setQuery] = useState('');
  const [listOpen, setListOpen] = useState(false);

  /* ── Threads ─────────────────────────────────────────────────────────── */
  const [threads, setThreads] = useState(() => readThreads());
  /* Opens on the conversation the floating panel was last in — that is what
     makes its expand button a camera move rather than a hand-off. The shared id
     is trusted even when no thread carries it yet: the panel writes the id when
     the thread is created and the messages only land once a turn completes, so
     an unknown id is an empty thread, not a stale one. */
  const [activeId, setActiveId] = useState(
    () => readActiveId() ?? readThreads()[0]?.id ?? newThreadId(),
  );
  /** How many of each thread's messages the server already has. */
  const sentCounts = useRef(new Map());

  const active = threads.find((t) => t.id === activeId);

  /**
   * Who the coach is talking to, in ~40 tokens of aggregates.
   *
   * Aggregates only — never raw sessions or per-key detail. Rebuilt as the
   * numbers move, so advice tracks improvement rather than whatever was true
   * when the page mounted.
   */
  const weak = useMemo(() => weakestKeys(state.keyStats, 5).map((k) => keyLabel(k.key)), [state.keyStats]);

  const system = useMemo(
    () =>
      [
        BASE_SYSTEM,
        '',
        'About this user:',
        `- Averages ${Math.round(stats.wpm)} WPM at ${Math.round(stats.accuracy)}% accuracy over ${stats.sessionCount} sessions.`,
        `- Level ${stats.level.level}, ${stats.streak}-day streak.`,
        weak.length ? `- Weakest keys: ${weak.join(', ')}.` : null,
        state.settings.lastLanguage ? `- Currently practising ${state.settings.lastLanguage}.` : null,
      ]
        .filter(Boolean)
        .join('\n'),
    [
      stats.wpm, stats.accuracy, stats.sessionCount, stats.level.level, stats.streak,
      weak, state.settings.lastLanguage,
    ],
  );

  const chat = useStreamingChat({ system, surface: 'chat' });
  const { messages, setMessages, busy, thinking, partial, ask, regenerate, stop } = chat;

  /* Load a thread's transcript into the engine when the active thread changes.
     Guarded by a ref rather than depending on `threads`, which would clobber
     the live transcript every time a save wrote back to it. */
  const loadedFor = useRef(null);
  useEffect(() => {
    if (loadedFor.current === activeId) return;
    loadedFor.current = activeId;
    setMessages(readThreads().find((t) => t.id === activeId)?.messages ?? []);
  }, [activeId, setMessages]);

  /* Local save on every change. */
  useEffect(() => {
    if (!messages.length) return;
    setThreads((prev) => {
      const rest = prev.filter((t) => t.id !== activeId);
      return writeThreads([{ id: activeId, title: titleFrom(messages), updatedAt: Date.now(), messages }, ...rest]);
    });
  }, [messages, activeId]);

  /* Keep the panel pointed at whatever the page is showing. */
  useEffect(() => {
    writeActiveId(activeId);
  }, [activeId]);

  /* Cloud mirror once a turn settles — not per token, and only the tail. */
  useEffect(() => {
    if (busy || !user || !messages.length) return;
    const sent = sentCounts.current.get(activeId) ?? 0;
    if (messages.length <= sent) return;
    pushMessages(user.id, activeId, messages, sent).then((n) => sentCounts.current.set(activeId, n));
  }, [busy, messages, user, activeId]);

  /* Fold in whatever other devices have written. */
  useEffect(() => {
    if (!user) return undefined;
    let cancelled = false;
    pullThreads(user.id).then((remote) => {
      if (cancelled || !remote.length) return;
      setThreads((prev) => {
        const merged = mergeThreads(prev, remote);
        for (const t of merged) if (t.sentCount != null) sentCounts.current.set(t.id, t.sentCount);
        return writeThreads(merged);
      });
    });
    return () => {
      cancelled = true;
    };
  }, [user]);

  const atBottom = useScrollAnchor({
    scrollRef,
    endRef,
    deps: [messages.length, partial, thinking],
    streaming: busy,
    reduce,
  });

  useEffect(() => {
    if (!busy) return undefined;
    const id = setInterval(() => setPinned(atBottom.current), 250);
    return () => clearInterval(id);
  }, [busy, atBottom]);

  const lastUserIndex = messages.map((m) => m.role).lastIndexOf('user');
  const lastAssistantIndex = messages.map((m) => m.role).lastIndexOf('assistant');

  /** Loads the last question back into the composer and drops it (and the reply
   *  it got) from the transcript — sending the edit is then just a normal ask. */
  const editLastUser = useCallback(() => {
    if (lastUserIndex === -1) return;
    setDraft(messages[lastUserIndex].text);
    setMessages(messages.slice(0, lastUserIndex));
  }, [messages, lastUserIndex, setMessages]);

  const startNew = useCallback(() => {
    const id = newThreadId();
    loadedFor.current = id; // this thread is empty by construction
    setActiveId(id);
    setMessages([]);
    setDraft('');
    setListOpen(false);
  }, [setMessages]);

  const removeThread = (id) => {
    setThreads((prev) => writeThreads(prev.filter((t) => t.id !== id)));
    sentCounts.current.delete(id);
    if (user) deleteThread(user.id, id);
    if (id === activeId) startNew();
  };

  const send = () => {
    if (!draft.trim()) return;
    ask(draft);
    setDraft('');
  };

  /** Hands this conversation back to the floating panel on the route the user
   *  came from, so minimise is the exact inverse of the panel's expand. */
  const minimise = useCallback(() => {
    writeActiveId(activeId);
    requestPanelOpen();
    navigate(readOrigin());
  }, [activeId, navigate]);

  const visibleThreads = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return threads;
    return threads.filter(
      (t) => t.title.toLowerCase().includes(q) || t.messages.some((m) => m.text?.toLowerCase().includes(q)),
    );
  }, [threads, query]);

  const starters = useMemo(
    () => startersFor(stats, weak, state.settings.lastLanguage),
    [stats, weak, state.settings.lastLanguage],
  );

  /* The next moves, re-derived from the answer that just landed. Suppressed
     while streaming — offering a next question before this one has finished
     answering is noise. */
  const followUps = useMemo(
    () => (busy ? [] : followUpsFor(messages, { weak })),
    [busy, messages, weak],
  );

  const empty = messages.length === 0 && !busy;

  return (
    <div className="fap-shell flex h-[calc(100dvh-150px)] min-h-[460px] gap-1.5">
      {/* Glass needs something to refract. Without this the panes blur a flat
          fill and read grey — the depth below comes mostly from here. */}
      <span className="fap-aura" aria-hidden />

      {/* ── Thread rail ─────────────────────────────────────────────── */}
      <aside className="fap-rail hidden w-[236px] shrink-0 flex-col overflow-hidden rounded-lg lg:flex">
        <div className="fap-seam fap-seam-bottom shrink-0 space-y-1 p-1.5">
          <Button size="sm" variant="brand" icon={Plus} className="w-full !rounded-sm" onClick={startNew}>
            New chat
          </Button>
          <label className="fap-well flex items-center gap-1 rounded-sm px-1.5">
            <Search size={13} className="shrink-0 text-ink-3" aria-hidden />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search"
              aria-label="Search chats"
              className="h-[32px] min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-ink-3"
            />
          </label>
        </div>

        <div className="fap-scroll min-h-0 flex-1 space-y-px overflow-y-auto p-1">
          {visibleThreads.length === 0 ? (
            <p className="px-1 py-2 text-center text-2xs leading-relaxed text-ink-3">
              {threads.length ? 'Nothing matches.' : 'Your chats will appear here.'}
            </p>
          ) : null}
          {visibleThreads.map((t) => (
            <ThreadRow
              key={t.id}
              thread={t}
              active={t.id === activeId}
              onOpen={() => setActiveId(t.id)}
              onDelete={() => removeThread(t.id)}
            />
          ))}
        </div>

        {/* What the coach is actually given. Sitting at the foot of the rail
            it answers "how does it know that?" before the question is asked —
            and it is the literal content of the system prompt above, not a
            decorative summary. */}
        <ContextPanel stats={stats} weak={weak} language={state.settings.lastLanguage} />
      </aside>

      {/* ── Conversation ────────────────────────────────────────────── */}
      <div className="fap-pane relative flex min-w-0 flex-1 flex-col overflow-hidden rounded-lg">
        <header className="fap-seam fap-seam-bottom flex shrink-0 items-center gap-1.5 px-2 py-1.5 sm:px-2.5">
          <ForgeAvatar size={34} busy={busy} />
          <div className="min-w-0">
            <p className="truncate font-display text-sm font-bold leading-tight tracking-[-0.01em]">
              {active?.title ?? 'Forge AI'}
            </p>
            <p className="truncate text-2xs text-ink-3">
              {busy
                ? 'Working…'
                : stats.sessionCount
                  ? `Level ${stats.level.level} · ${Math.round(stats.wpm)} WPM · ${Math.round(stats.accuracy)}%`
                  : 'Your coach, with your stats in hand'}
            </p>
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-0.5">
            {!ready ? <Chip tone="warn">no key</Chip> : null}
            {/* "no key" is actionable and stays at every width. "local only"
                is a status note, and on a phone it cost the thread title more
                room than it was worth. */}
            {user ? null : <Chip tone="outline" className="hidden sm:inline-flex">local only</Chip>}
            {/* The rail is desktop-only; small screens get the same list inline. */}
            <IconButton
              size="sm"
              label="Your chats"
              icon={ChevronDown}
              onClick={() => setListOpen((v) => !v)}
              className="!rounded-sm lg:hidden"
            />
            <IconButton
              size="sm"
              label="New chat"
              icon={Plus}
              onClick={startNew}
              className="!rounded-sm lg:hidden"
            />
            <IconButton
              size="sm"
              label="Minimise to the corner"
              icon={Minimize2}
              onClick={minimise}
              className="!rounded-sm"
            />
          </div>
        </header>

        <AnimatePresence>
          {listOpen ? (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="fap-seam fap-seam-bottom shrink-0 overflow-hidden lg:hidden"
            >
              <div className="fap-scroll max-h-[210px] space-y-px overflow-y-auto p-1">
                {threads.length === 0 ? (
                  <p className="px-1 py-2 text-center text-2xs text-ink-3">Your chats will appear here.</p>
                ) : null}
                {threads.map((t) => (
                  <ThreadRow
                    key={t.id}
                    thread={t}
                    active={t.id === activeId}
                    onOpen={() => {
                      setActiveId(t.id);
                      setListOpen(false);
                    }}
                    onDelete={() => removeThread(t.id)}
                  />
                ))}
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>

        <div ref={scrollRef} className="fap-scroll min-h-0 flex-1 space-y-2 overflow-y-auto px-2 py-3 sm:px-4">
          {empty ? <EmptyState ready={ready} onPick={ask} reduce={reduce} starters={starters} /> : null}

          {messages.map((m, i) => (
            <Bubble
              key={i}
              message={m}
              /* Only the newest answer is badged. Thirty animated mascots down
                 a transcript is thirty decode loops and a lot of visual noise
                 for an identity the header already carries. */
              showAvatar={i === lastAssistantIndex && !busy}
              canRegenerate={i === lastAssistantIndex && !busy}
              canEdit={i === lastUserIndex && !busy}
              onRegenerate={regenerate}
              onEditResend={editLastUser}
            />
          ))}

          {busy ? (
            <Live thinking={thinking} partial={partial} hasContext={stats.sessionCount > 0} reduce={reduce} />
          ) : null}

          {followUps.length ? <FollowUps prompts={followUps} onPick={ask} reduce={reduce} /> : null}

          <div ref={endRef} />
        </div>

        {busy && !pinned ? (
          <motion.button
            type="button"
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            onClick={() => endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })}
            className="fap-float absolute bottom-[76px] left-1/2 z-10 flex -translate-x-1/2 items-center gap-0.5 rounded-sm px-1.5 py-1 text-2xs font-bold"
          >
            <ArrowDown size={12} aria-hidden /> Jump to latest
          </motion.button>
        ) : null}

        <form
          className="fap-seam fap-seam-top shrink-0 px-2 py-2 pb-[max(16px,env(safe-area-inset-bottom))] sm:px-4"
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          {/* One pill holds the field and the action. The old layout put a
              rectangular field beside a rectangular button and read like a
              form; this reads like a place to talk. */}
          <div className="fap-well flex items-end gap-1 rounded-md p-1 pl-2">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                // Enter sends, Shift+Enter breaks the line. Without this the
                // composer could not accept a multi-line question at all.
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              rows={1}
              placeholder={ready ? 'Ask anything…  (Shift+Enter for a new line)' : 'Add a provider key to start chatting'}
              aria-label="Message"
              disabled={!ready}
              className="max-h-[140px] min-h-[40px] min-w-0 flex-1 resize-none self-center bg-transparent py-1 text-sm leading-relaxed outline-none placeholder:text-ink-3 disabled:opacity-50"
              onInput={(e) => {
                e.target.style.height = 'auto';
                e.target.style.height = `${Math.min(140, e.target.scrollHeight)}px`;
              }}
            />
            {busy ? (
              <SendKey type="button" onClick={stop} label="Stop generating" tone="stop" icon={Square} />
            ) : (
              <SendKey type="submit" disabled={!ready || !draft.trim()} label="Send" icon={Send} />
            )}
          </div>
        </form>
      </div>
    </div>
  );
}

/**
 * The composer's single action.
 *
 * A circle rather than the app's rectangular Button: it is the only control
 * inside the pill, and matching the pill's own geometry is what keeps the
 * composer reading as one object instead of a field with a button parked on it.
 */
function SendKey({ type, onClick, disabled, label, icon: Icon, tone = 'brand' }) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={cx(
        'grid h-[40px] w-[40px] shrink-0 place-items-center rounded-sm transition-all duration-fast ease-out',
        'active:scale-[0.94] active:duration-instant disabled:pointer-events-none disabled:opacity-35',
        tone === 'brand'
          ? 'fap-user hover:brightness-[1.07]'
          : 'bg-ink/10 text-ink-2 hover:bg-ink/[0.16] hover:text-ink',
      )}
    >
      <Icon size={17} strokeWidth={2.3} aria-hidden />
    </button>
  );
}

/** The aggregates handed to the model on every turn, shown as read. */
function ContextPanel({ stats, weak, language }) {
  const rows = [
    stats.sessionCount
      ? { label: 'Pace', value: `${Math.round(stats.wpm)} WPM · ${Math.round(stats.accuracy)}%` }
      : { label: 'Pace', value: 'No sessions yet' },
    { label: 'Level', value: `${stats.level.level} · ${stats.streak}-day streak` },
    weak.length ? { label: 'Weak keys', value: weak.slice(0, 5).join(' ') } : null,
    /* Stored lowercase by the language picker. Uses the same name table the
       prompts do, so the panel and the questions never disagree about whether
       it is "Javascript" or "JavaScript". */
    language ? { label: 'Language', value: languageName(language) } : null,
  ].filter(Boolean);

  return (
    <div className="fap-seam fap-seam-top shrink-0 p-1.5">
      <p className="eyebrow mb-1 px-0.5">Context in use</p>
      <dl className="space-y-0.5">
        {rows.map((r) => (
          <div key={r.label} className="flex items-baseline justify-between gap-1 px-0.5">
            <dt className="shrink-0 text-2xs text-ink-3">{r.label}</dt>
            <dd className="truncate text-2xs font-semibold text-ink-2">{r.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function ThreadRow({ thread, active, onOpen, onDelete }) {
  return (
    <div
      className={cx(
        'group flex items-center gap-0.5 rounded-sm px-1 transition-colors duration-fast',
        active ? 'bg-brand-solid/[0.14]' : 'hover:bg-ink/[0.05]',
      )}
    >
      <button
        type="button"
        onClick={onOpen}
        className={cx(
          'min-w-0 flex-1 truncate py-1 pl-0.5 text-left text-xs font-semibold',
          active ? 'text-ink' : 'text-ink-2',
        )}
      >
        {thread.title}
      </button>
      <button
        type="button"
        onClick={onDelete}
        aria-label={`Delete ${thread.title}`}
        className="shrink-0 rounded-xs p-0.5 text-ink-3 opacity-0 transition-opacity hover:text-bad focus-visible:opacity-100 group-hover:opacity-100"
      >
        <Trash2 size={12} aria-hidden />
      </button>
    </div>
  );
}

/**
 * Settled message. Memoised on identity so a token arriving in the live bubble
 * does not re-render — and therefore re-parse and re-highlight — the whole
 * transcript above it. The action props only change value at the same cadence
 * as `message` itself, so accepting them does not reintroduce that cost.
 */
const Bubble = memo(function Bubble({
  message, showAvatar, canRegenerate, canEdit, onRegenerate, onEditResend,
}) {
  if (message.role === 'user') {
    return (
      <div className="flex flex-col items-end gap-0.5 pl-6">
        <p className="fap-user max-w-[min(560px,88%)] whitespace-pre-wrap rounded-md rounded-br-xs px-2 py-1.5 text-sm font-semibold">
          {message.text}
        </p>
        {canEdit ? (
          <button
            type="button"
            onClick={onEditResend}
            className="flex items-center gap-0.5 px-1 text-2xs font-bold text-ink-3 transition-colors hover:text-ink-2"
          >
            <Pencil size={11} aria-hidden /> Edit
          </button>
        ) : null}
      </div>
    );
  }

  // A failed turn stores the reason object rather than a string.
  const text = typeof message.text === 'string' ? message.text : (message.text?.detail ?? '');

  return (
    <div className="flex gap-1 pr-4">
      {/* The gutter is always reserved, avatar or not, so answers stay on one
          left edge instead of stepping in and out as the newest one changes. */}
      <div className="w-[30px] shrink-0 pt-0.5">
        {showAvatar ? <ForgeAvatar size={26} /> : null}
      </div>
      <div className="min-w-0 flex-1">
        <div
          className={cx(
            'max-w-[min(720px,100%)] rounded-md rounded-tl-xs px-2 py-1.5',
            message.failed ? 'bg-warn/10' : 'fap-ai',
          )}
        >
          <Markdown text={text} compact />
          {message.stopped ? (
            <p className="mt-1 text-2xs font-bold uppercase tracking-[0.08em] text-ink-3">Stopped</p>
          ) : null}
        </div>
        <div className="mt-0.5 flex items-center gap-1 px-1">
          <CopyButton text={text} />
          {canRegenerate ? (
            <button
              type="button"
              onClick={onRegenerate}
              className="flex items-center gap-0.5 text-2xs font-bold text-ink-3 transition-colors hover:text-ink-2"
            >
              <RefreshCw size={11} aria-hidden /> Regenerate
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
});

/** Local "copied" flash, not a toast — copying is frequent enough on a chat
 * page that a toast for every click would be noise. */
function CopyButton({ text }) {
  const { copied, copy } = useCopyToClipboard();

  return (
    <button
      type="button"
      onClick={() => copy(text)}
      className="flex items-center gap-0.5 text-2xs font-bold text-ink-3 transition-colors hover:text-ink-2"
    >
      {copied ? <Check size={11} aria-hidden /> : <Copy size={11} aria-hidden />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

/**
 * The in-flight answer, with the run shown above it.
 *
 * The answer itself is plain preformatted text, not markdown. A streaming
 * answer is read as it arrives; nobody needs a half-built list, and parsing the
 * whole accumulated string every frame is the single biggest cost in this view.
 * The settled `Bubble` renders the same text properly a moment later.
 */
function Live({ thinking, partial, hasContext, reduce }) {
  const steps = traceSteps({ thinking, partial, hasContext });

  return (
    <div className="flex gap-1 pr-4">
      <div className="w-[30px] shrink-0 pt-0.5">
        <ForgeAvatar size={26} busy />
      </div>
      <div className="fap-ai min-w-0 max-w-[min(720px,100%)] flex-1 rounded-md rounded-tl-xs px-2 py-1.5">
        <AgentTrace steps={steps} thinking={thinking} reduce={reduce} />

        {partial ? (
          <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-ink-2">
            {partial}
            <span className="fap-caret" aria-hidden />
          </p>
        ) : (
          <div className="mt-1.5 space-y-1">
            <Skeleton className="h-1.5 w-[62%]" />
            <Skeleton className="h-1.5 w-[44%]" />
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * The run, as steps.
 *
 * Every state here is read from the stream — nothing advances on a timer. The
 * reasoning tail is shown under its own step while that step is the active
 * one, which is the only place it is genuinely informative.
 */
function AgentTrace({ steps, thinking, reduce }) {
  const tail = thinking ? thinking.replace(/\s+/g, ' ').trim().slice(-140) : '';

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
          <AnimatePresence>
            {s.id === 'reason' && s.state === 'active' && tail ? (
              <motion.p
                initial={reduce ? { opacity: 0 } : { opacity: 0, y: -2 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="mt-px line-clamp-2 text-2xs italic normal-case leading-relaxed tracking-normal text-ink-3"
              >
                {tail}
              </motion.p>
            ) : null}
          </AnimatePresence>
        </li>
      ))}
    </ol>
  );
}

/**
 * The next move.
 *
 * Rebuilt from the answer that just landed rather than fixed, so the second
 * question the page offers is about what was actually discussed. Sits under
 * the transcript, in the flow, so it scrolls away with the turn it belongs to
 * instead of hovering over the composer.
 */
function FollowUps({ prompts, onPick, reduce }) {
  return (
    <div className="pl-[34px] pr-4">
      <p className="eyebrow mb-1">Next</p>
      <div className="flex flex-wrap gap-1">
        {prompts.map((p, i) => (
          <motion.button
            key={p}
            type="button"
            onClick={() => onPick(p)}
            initial={reduce ? false : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: reduce ? 0 : 0.04 * i, duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
            className="fap-chip flex items-center gap-0.5 rounded-sm py-1 pl-1.5 pr-1 text-xs font-semibold text-ink-2 hover:text-ink"
          >
            {p}
            <ArrowUpRight size={12} className="shrink-0 text-ink-3" aria-hidden />
          </motion.button>
        ))}
      </div>
    </div>
  );
}

function EmptyState({ ready, onPick, reduce, starters }) {
  return (
    <div className="flex flex-col items-center px-1 py-1 text-center">
      {/* The hero beat, and the only place the mascot is given real size.
          Sized so the whole blank state — mascot, headline and all four
          starters — clears the fold on a 900px window. It is the first thing
          anyone sees on this page; making them scroll to find the prompts
          would defeat the point of having them. */}
      <motion.div
        initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.9, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      >
        <ForgeAvatar size={92} label="Forge AI" />
      </motion.div>

      <motion.h2
        initial={reduce ? { opacity: 0 } : { opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: reduce ? 0 : 0.08, duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
        className="mt-1.5 font-display text-xl font-bold tracking-[-0.02em] sm:text-2xl"
      >
        What are we <span className="text-brand">forging</span> today?
      </motion.h2>

      <motion.p
        initial={reduce ? { opacity: 0 } : { opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: reduce ? 0 : 0.12, duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
        className="mx-auto mt-0.5 max-w-[52ch] text-xs leading-relaxed text-ink-3 sm:text-sm"
      >
        These come from your current stats, so they change as you improve.
      </motion.p>

      {/* The starters render whether or not a key is set: they are the shape of
          the page, and hiding them left an unconfigured install looking broken
          rather than unconfigured. Sending is what needs the key, so that is
          what the notice below is attached to. */}
      <div className="mx-auto mt-2 grid w-full max-w-[660px] gap-1 sm:grid-cols-2">
        {starters.map((s, i) => {
          const Icon = STARTER_ICON[s.icon] ?? Brain;
          return (
            <motion.button
              key={s.text}
              type="button"
              onClick={() => onPick(s.text)}
              disabled={!ready}
              initial={reduce ? false : { opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: reduce ? 0 : 0.16 + 0.05 * i, duration: 0.34, ease: [0.16, 1, 0.3, 1] }}
              whileHover={reduce || !ready ? undefined : { y: -2 }}
              className="fap-tile flex items-start gap-1.5 rounded-md px-1.5 py-1.5 text-left text-xs font-semibold leading-relaxed text-ink-2 hover:text-ink disabled:pointer-events-none disabled:opacity-45"
            >
              <Icon size={14} strokeWidth={2.2} className="mt-0.5 shrink-0 text-brand" aria-hidden />
              {s.text}
            </motion.button>
          );
        })}
      </div>

      {!ready ? (
        <p className="mt-2 max-w-[48ch] text-2xs leading-relaxed text-ink-3">
          Add a provider key to <span className="font-mono text-ink-2">.env.local</span> to start chatting.
          Everything else in the app works without it.
        </p>
      ) : null}
    </div>
  );
}
