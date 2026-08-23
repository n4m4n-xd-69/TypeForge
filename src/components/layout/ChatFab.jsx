import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Cat, Send, Sparkles, Square, X } from 'lucide-react';
import Button from '../ui/Button.jsx';
import { Chip, Skeleton } from '../ui/Primitives.jsx';
import Markdown from '../ui/Markdown.jsx';
import { aiConfigured } from '../../lib/ai.js';
import { useScrollAnchor, useStreamingChat } from '../../lib/useStreamingChat.js';
import { useReducedMotionSafe } from '../../lib/motion.js';
import { useStats, useStore } from '../../lib/store.jsx';
import { keyLabel, weakestKeys } from '../../lib/typing.js';
import { cx } from '../../lib/format.js';

/**
 * The floating coach.
 *
 * Bottom-right rather than bottom-left, because the rail and the mobile tab bar
 * both own the left corner. It sits above the rail and the top bar but below
 * modals, so a dialog still takes the keyboard cleanly.
 *
 * The system prompt is rebuilt from live stats on every open, so advice tracks
 * the run you just finished rather than whatever was true when the app booted.
 */
export default function ChatFab() {
  const reduce = useReducedMotionSafe();
  const ready = aiConfigured();
  const stats = useStats();
  const { state } = useStore();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const scrollRef = useRef(null);
  const endRef = useRef(null);
  const panelRef = useRef(null);

  const weak = weakestKeys(state.keyStats, 5).map((k) => keyLabel(k.key));
  const system = [
    'You are the coach inside KeyStroke, a typing and code-typing platform. Friendly and direct.',
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

  const { messages, busy, thinking, partial, ask, stop } = useStreamingChat({
    system,
    maxTokens: 700,
    surface: 'fab',
  });

  useScrollAnchor({ scrollRef, endRef, deps: [messages.length, partial, thinking], streaming: busy, reduce });

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

  /* Redundant on /chat, and its send button sits exactly where the FAB does. */
  if (pathname.startsWith('/chat')) return null;

  const starters = [
    stats.sessionCount === 0
      ? 'How should I start?'
      : `How do I get past ${Math.round(stats.wpm)} WPM?`,
    weak.length ? `Drill my weak keys: ${weak.slice(0, 3).join(', ')}` : 'What should I drill next?',
    'Explain a concept I keep forgetting',
  ];

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
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: 12, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: 8, scale: 0.98 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className={cx(
              'liquid-glass fixed bottom-[76px] right-2 z-[46] flex w-[min(380px,calc(100vw-16px))] flex-col',
              'rounded-2xl border border-line shadow-2xl',
              'h-[min(560px,calc(100dvh-140px))]',
            )}
            role="dialog"
            aria-label="AI coach"
          >
            <header className="flex shrink-0 items-center gap-1 border-b border-line/70 px-2 py-1.5">
              <span className="grid h-[28px] w-[28px] place-items-center rounded-[9px] bg-brand-wash text-brand">
                <Cat size={16} strokeWidth={2.2} aria-hidden />
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-extrabold leading-tight">Coach</p>
                <p className="truncate text-2xs text-ink-3">
                  {stats.sessionCount ? `${Math.round(stats.wpm)} WPM · ${Math.round(stats.accuracy)}%` : 'Ask me anything'}
                </p>
              </div>
              {!ready ? <Chip tone="warn" className="ml-auto">no key</Chip> : null}
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close coach"
                className={cx('rounded-full p-1 text-ink-3 transition-colors hover:bg-subtle hover:text-ink', ready && 'ml-auto')}
              >
                <X size={15} strokeWidth={2.4} aria-hidden />
              </button>
            </header>

            <div ref={scrollRef} className="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-2 py-2">
              {messages.length === 0 && !busy ? (
                <div className="py-2">
                  <p className="text-center text-xs leading-relaxed text-ink-3">
                    {ready
                      ? 'I can see your stats. Ask about technique, a concept, or what to practise next.'
                      : 'Set a provider key in .env.local to turn this on.'}
                  </p>
                  {ready ? (
                    <div className="mt-2 space-y-1">
                      {starters.map((s, i) => (
                        <motion.button
                          key={s}
                          type="button"
                          onClick={() => ask(s)}
                          initial={reduce ? false : { opacity: 0, x: -6 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: reduce ? 0 : 0.05 * i, duration: 0.25 }}
                          className="block w-full rounded-md border border-line bg-surface/50 px-1.5 py-1 text-left text-xs font-semibold text-ink-2 transition-colors hover:border-line-strong hover:bg-subtle hover:text-ink"
                        >
                          {s}
                        </motion.button>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}

              {messages.map((m, i) =>
                m.role === 'user' ? (
                  <p key={i} className="ml-5 rounded-lg rounded-br-sm bg-brand-solid px-1.5 py-1 text-xs font-semibold text-brand-ink">
                    {m.text}
                  </p>
                ) : (
                  <div key={i} className="mr-2 rounded-lg rounded-bl-sm border border-line bg-surface/60 px-1.5 py-1">
                    <Markdown text={typeof m.text === 'string' ? m.text : (m.text?.detail ?? '')} compact />
                  </div>
                ),
              )}

              {busy ? (
                <div className="mr-2 rounded-lg rounded-bl-sm border border-line bg-surface/60 px-1.5 py-1">
                  {partial ? (
                    <p className="whitespace-pre-wrap text-xs leading-relaxed text-ink-2">{partial}</p>
                  ) : (
                    <div className="space-y-1">
                      <Skeleton className="h-1.5 w-[60%]" />
                      <Skeleton className="h-1.5 w-[42%]" />
                    </div>
                  )}
                </div>
              ) : null}
              <div ref={endRef} />
            </div>

            <form
              className="flex shrink-0 items-center gap-1 border-t border-line/70 px-1.5 py-1.5"
              onSubmit={(e) => {
                e.preventDefault();
                send();
              }}
            >
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                disabled={!ready}
                placeholder={ready ? 'Ask your coach…' : 'AI is not configured'}
                aria-label="Ask the coach"
                className="h-[34px] min-w-0 flex-1 rounded-md bg-subtle/60 px-1.5 text-sm outline-none placeholder:text-ink-3 focus:bg-subtle disabled:opacity-50"
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

      <motion.button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={open ? 'Close AI coach' : 'Open AI coach'}
        title={open ? 'Close coach' : 'Ask the coach'}
        initial={reduce ? false : { opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: reduce ? 0 : 0.6, duration: 0.35, ease: [0.34, 1.56, 0.64, 1] }}
        whileHover={reduce ? undefined : { scale: 1.06, rotate: -6 }}
        whileTap={{ scale: 0.94 }}
        className={cx(
          'liquid-glass fixed bottom-2 right-2 z-[46] grid h-[52px] w-[52px] place-items-center',
          'rounded-full border border-line shadow-xl',
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
            >
              <X size={22} strokeWidth={2.4} className="text-ink" aria-hidden />
            </motion.span>
          ) : (
            <motion.span
              key="cat"
              initial={{ opacity: 0, rotate: 90 }}
              animate={{ opacity: 1, rotate: 0 }}
              exit={{ opacity: 0, rotate: -90 }}
              transition={{ duration: 0.16 }}
              className="relative"
            >
              <Cat size={24} strokeWidth={2.1} className="text-brand" aria-hidden />
              {/* A quiet "there is something here" cue, only before first use. */}
              {ready && messages.length === 0 ? (
                <motion.span
                  aria-hidden
                  animate={reduce ? undefined : { scale: [1, 1.35, 1], opacity: [0.9, 0.4, 0.9] }}
                  transition={reduce ? undefined : { duration: 2.2, repeat: Infinity, ease: 'easeInOut' }}
                  className="absolute -right-1 -top-1"
                >
                  <Sparkles size={11} className="text-brand" aria-hidden />
                </motion.span>
              ) : null}
            </motion.span>
          )}
        </AnimatePresence>
      </motion.button>
    </>
  );
}
