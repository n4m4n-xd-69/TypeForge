import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowDown, Brain, Check, ChevronDown, Copy, MessageSquare, Pencil, Plus,
  RefreshCw, Search, Send, Square, Trash2,
} from 'lucide-react';
import Button, { IconButton } from '../../components/ui/Button.jsx';
import { Chip, Skeleton } from '../../components/ui/Primitives.jsx';
import Markdown from '../../components/ui/Markdown.jsx';
import { aiConfigured } from '../../lib/ai.js';
import { useScrollAnchor, useStreamingChat } from '../../lib/useStreamingChat.js';
import { useCopyToClipboard } from '../../lib/useCopyToClipboard.js';
import { useStats, useStore } from '../../lib/store.jsx';
import { useAuth } from '../../lib/auth.jsx';
import { keyLabel, weakestKeys } from '../../lib/typing.js';
import { cx } from '../../lib/format.js';
import { useReducedMotionSafe } from '../../lib/motion.js';
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

/**
 * Suggestions that track where the user actually is.
 *
 * A fixed starter list goes stale the moment someone improves: "where do I
 * start" is the wrong question at level 8. These are banded by level and seeded
 * with real figures, so the blank state stays worth reading as the numbers move.
 */
function startersFor(stats, weak, language) {
  const wpm = Math.round(stats.wpm);
  const acc = Math.round(stats.accuracy);
  const level = stats.level.level;
  const lang = language ?? 'JavaScript';

  if (!stats.sessionCount) {
    return [
      { icon: '⌨️', text: 'I have never touch-typed. Where do I start?' },
      { icon: '🎯', text: 'Build me a 15-minute daily practice plan.' },
      { icon: '🧠', text: 'Explain variables and types with a tiny example.' },
      { icon: '📐', text: 'Should I learn proper finger placement first?' },
    ];
  }

  const out = [];
  out.push(
    acc < 95
      ? { icon: '🎯', text: `My accuracy sits around ${acc}%. What should I change?` }
      : { icon: '⚡', text: `I am at ${wpm} WPM and ${acc}% accuracy. How do I go faster without losing accuracy?` },
  );
  if (weak.length) out.push({ icon: '🔤', text: `Design a drill for my weakest keys: ${weak.slice(0, 4).join(', ')}.` });
  out.push(
    level < 5
      ? { icon: '🧠', text: `Explain ${lang} functions with a tiny example.` }
      : level < 15
        ? { icon: '🧠', text: `Explain closures in ${lang} with a tiny example.` }
        : { icon: '🧠', text: `Give me an advanced ${lang} idiom worth drilling.` },
  );
  out.push({ icon: '📈', text: `What should I focus on to reach level ${level + 1}?` });
  return out.slice(0, 4);
}

export default function AIChat() {
  const reduce = useReducedMotionSafe();
  const stats = useStats();
  const { state } = useStore();
  const { user } = useAuth();
  const ready = aiConfigured();

  const scrollRef = useRef(null);
  const endRef = useRef(null);
  const [draft, setDraft] = useState('');
  const [pinned, setPinned] = useState(true);
  const [query, setQuery] = useState('');
  const [listOpen, setListOpen] = useState(false);

  /* ── Threads ─────────────────────────────────────────────────────────── */
  const [threads, setThreads] = useState(() => readThreads());
  const [activeId, setActiveId] = useState(() => readThreads()[0]?.id ?? newThreadId());
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

  const empty = messages.length === 0 && !busy;

  return (
    <div className="flex h-[calc(100dvh-150px)] min-h-[460px] gap-2">
      {/* ── Thread rail ─────────────────────────────────────────────── */}
      <aside className="glass hidden w-[230px] shrink-0 flex-col rounded-lg border border-line lg:flex">
        <div className="shrink-0 space-y-1 border-b border-line/70 p-1.5">
          <Button size="sm" variant="brand" icon={Plus} className="w-full" onClick={startNew}>
            New chat
          </Button>
          <label className="flex items-center gap-1 rounded-md bg-subtle/60 px-1.5">
            <Search size={13} className="shrink-0 text-ink-3" aria-hidden />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search"
              aria-label="Search chats"
              className="h-[30px] min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-ink-3"
            />
          </label>
        </div>

        <div className="min-h-0 flex-1 space-y-px overflow-y-auto p-1">
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
      </aside>

      {/* ── Conversation ────────────────────────────────────────────── */}
      <div className="glass relative flex min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-line">
        <header className="flex shrink-0 items-center gap-1 border-b border-line/70 px-2 py-1.5">
          <span className="grid h-[26px] w-[26px] shrink-0 place-items-center rounded-[8px] bg-brand-wash text-brand">
            <MessageSquare size={14} strokeWidth={2.4} aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-bold leading-tight">{active?.title ?? 'New chat'}</p>
            <p className="truncate text-2xs text-ink-3">
              {stats.sessionCount
                ? `Level ${stats.level.level} · ${Math.round(stats.wpm)} WPM · ${Math.round(stats.accuracy)}%`
                : 'Your coach, with your stats in hand'}
            </p>
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-0.5">
            {!ready ? <Chip tone="warn">no key</Chip> : null}
            {user ? null : <Chip tone="outline">local only</Chip>}
            {/* The rail is desktop-only; small screens get the same list inline. */}
            <IconButton
              size="sm"
              label="Your chats"
              icon={ChevronDown}
              onClick={() => setListOpen((v) => !v)}
              className="lg:hidden"
            />
            <IconButton size="sm" label="New chat" icon={Plus} onClick={startNew} className="lg:hidden" />
          </div>
        </header>

        <AnimatePresence>
          {listOpen ? (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="shrink-0 overflow-hidden border-b border-line/70 lg:hidden"
            >
              <div className="max-h-[210px] space-y-px overflow-y-auto p-1">
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

        <div ref={scrollRef} className="min-h-0 flex-1 space-y-2 overflow-y-auto px-2.5 py-3 sm:px-4">
          {empty ? <EmptyState ready={ready} onPick={ask} reduce={reduce} starters={starters} /> : null}

          {messages.map((m, i) => (
            <Bubble
              key={i}
              message={m}
              canRegenerate={i === lastAssistantIndex && !busy}
              canEdit={i === lastUserIndex && !busy}
              onRegenerate={regenerate}
              onEditResend={editLastUser}
            />
          ))}

          {busy ? <Live thinking={thinking} partial={partial} /> : null}
          <div ref={endRef} />
        </div>

        {busy && !pinned ? (
          <button
            type="button"
            onClick={() => endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })}
            className="absolute bottom-[68px] left-1/2 z-10 flex -translate-x-1/2 items-center gap-0.5 rounded-full border border-line bg-surface px-1.5 py-1 text-2xs font-bold shadow-md"
          >
            <ArrowDown size={12} aria-hidden /> Jump to latest
          </button>
        ) : null}

        <form
          className="flex shrink-0 items-end gap-1 border-t border-line/70 px-2.5 py-2 pb-[max(8px,env(safe-area-inset-bottom))] sm:px-4"
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
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
            placeholder={ready ? 'Ask anything…  (Shift+Enter for a new line)' : 'AI is not configured'}
            aria-label="Message"
            disabled={!ready}
            className="max-h-[140px] min-h-[40px] min-w-0 flex-1 resize-none rounded-md bg-subtle/60 px-2 py-1 text-sm leading-relaxed outline-none transition-colors placeholder:text-ink-3 focus:bg-subtle disabled:opacity-50"
            onInput={(e) => {
              e.target.style.height = 'auto';
              e.target.style.height = `${Math.min(140, e.target.scrollHeight)}px`;
            }}
          />
          {busy ? (
            <Button type="button" size="sm" variant="ghost" icon={Square} onClick={stop} aria-label="Stop generating">
              Stop
            </Button>
          ) : (
            <Button type="submit" size="sm" variant="brand" icon={Send} disabled={!ready || !draft.trim()} aria-label="Send" />
          )}
        </form>
      </div>
    </div>
  );
}

function ThreadRow({ thread, active, onOpen, onDelete }) {
  return (
    <div
      className={cx(
        'group flex items-center gap-0.5 rounded-md px-1 transition-colors',
        active ? 'bg-brand-wash' : 'hover:bg-subtle',
      )}
    >
      <button
        type="button"
        onClick={onOpen}
        className={cx('min-w-0 flex-1 truncate py-1 text-left text-xs font-semibold', active ? 'text-ink' : 'text-ink-2')}
      >
        {thread.title}
      </button>
      <button
        type="button"
        onClick={onDelete}
        aria-label={`Delete ${thread.title}`}
        className="shrink-0 rounded p-0.5 text-ink-3 opacity-0 transition-opacity hover:text-bad focus-visible:opacity-100 group-hover:opacity-100"
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
const Bubble = memo(function Bubble({ message, canRegenerate, canEdit, onRegenerate, onEditResend }) {
  if (message.role === 'user') {
    return (
      <div className="ml-6 flex flex-col items-end gap-0.5">
        <p className="whitespace-pre-wrap rounded-lg rounded-br-sm bg-brand-solid px-2 py-1.5 text-sm font-semibold text-brand-ink">
          {message.text}
        </p>
        {canEdit ? (
          <button
            type="button"
            onClick={onEditResend}
            className="flex items-center gap-0.5 px-0.5 text-2xs font-bold text-ink-3 transition-colors hover:text-ink-2"
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
    <div className="mr-6">
      <div
        className={cx(
          'rounded-lg rounded-bl-sm border px-2 py-1.5',
          message.failed ? 'border-warn/50 bg-warn/10' : 'border-line bg-surface/60',
        )}
      >
        <Markdown text={text} compact />
        {message.stopped ? (
          <p className="mt-1 text-2xs font-bold uppercase tracking-[0.08em] text-ink-3">Stopped</p>
        ) : null}
      </div>
      <div className="mt-0.5 flex items-center gap-1 px-0.5">
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
 * The in-flight answer.
 *
 * Rendered as plain preformatted text, not markdown. A streaming answer is read
 * as it arrives; nobody needs a half-built list, and parsing the whole
 * accumulated string every frame is the single biggest cost in this view. The
 * settled `Bubble` renders the same text properly a moment later.
 */
function Live({ thinking, partial }) {
  return (
    <div className="mr-6 rounded-lg rounded-bl-sm border border-line bg-surface/60 px-2 py-1.5">
      {thinking && !partial ? <LiveThinking text={thinking} /> : null}
      {partial ? (
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink-2">{partial}</p>
      ) : !thinking ? (
        <div className="space-y-1">
          <Skeleton className="h-1.5 w-[62%]" />
          <Skeleton className="h-1.5 w-[44%]" />
        </div>
      ) : null}
    </div>
  );
}

function EmptyState({ ready, onPick, reduce, starters }) {
  return (
    <div className="py-4 text-center">
      <span className="mx-auto grid h-[46px] w-[46px] place-items-center rounded-lg bg-brand-wash text-brand">
        <MessageSquare size={22} aria-hidden />
      </span>
      <h2 className="mt-1.5 text-lg font-bold">
        {ready ? 'What are we working on?' : 'AI is not configured'}
      </h2>
      <p className="mx-auto mt-0.5 max-w-[46ch] text-sm text-ink-3">
        {ready
          ? 'These come from your current stats, so they change as you improve.'
          : 'Add a provider key to .env.local to turn this on. Everything else in the app works without it.'}
      </p>

      {ready ? (
        <div className="mx-auto mt-2.5 grid max-w-[620px] gap-1 sm:grid-cols-2">
          {starters.map((s, i) => (
            <motion.button
              key={s.text}
              type="button"
              onClick={() => onPick(s.text)}
              initial={reduce ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: reduce ? 0 : 0.05 * i, duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
              whileHover={reduce ? undefined : { y: -2 }}
              className="flex items-start gap-1 rounded-md border border-line bg-surface/50 px-1.5 py-1.5 text-left text-xs font-semibold leading-relaxed text-ink-2 transition-colors hover:border-line-strong hover:bg-subtle hover:text-ink"
            >
              <span aria-hidden>{s.icon}</span>
              {s.text}
            </motion.button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** The tail of the model's reasoning, updating as it thinks. */
function LiveThinking({ text }) {
  const tail = text.replace(/\s+/g, ' ').trim().slice(-160);
  return (
    <div className="flex gap-1">
      <Brain size={13} className="mt-0.5 shrink-0 animate-pulse text-brand" aria-hidden />
      <p className="text-xs italic leading-relaxed text-ink-3">{tail || 'Thinking…'}</p>
    </div>
  );
}
