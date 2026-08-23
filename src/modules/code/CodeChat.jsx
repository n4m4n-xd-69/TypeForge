import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowDown, Brain, Check, Copy, Eraser, Maximize2, Minimize2, Send, Sparkles, Square,
} from 'lucide-react';
import Button, { IconButton } from '../../components/ui/Button.jsx';
import { Chip, Skeleton } from '../../components/ui/Primitives.jsx';
import Markdown from '../../components/ui/Markdown.jsx';
import { aiConfigured, suggestQuestions } from '../../lib/ai.js';
import { useScrollAnchor, useStreamingChat } from '../../lib/useStreamingChat.js';
import { useCopyToClipboard } from '../../lib/useCopyToClipboard.js';
import { useReducedMotionSafe } from '../../lib/motion.js';
import { cx } from '../../lib/format.js';

/**
 * Free-form conversation about the snippet on screen.
 *
 * This sits alongside the structured tabs rather than replacing them: the tabs
 * answer their five fixed questions in a shape built for them — a flow diagram,
 * complexity cards, a rewrite — and this handles everything they cannot, which
 * is every other question. Openers are generated from the actual code, so the
 * blank state offers something worth clicking rather than four generic prompts.
 *
 * The snippet is pinned into the system prompt rather than into a user turn, so
 * it stays in context as the transcript grows and never has to be re-pasted.
 *
 * `embedded` drops the header, for when a parent panel already provides one.
 */

export default function CodeChat({ code, language, languageName, embedded = false, expanded = false, onToggleExpand }) {
  const reduce = useReducedMotionSafe();
  const ready = aiConfigured();
  const scrollRef = useRef(null);
  const endRef = useRef(null);
  const [draft, setDraft] = useState('');
  const [pinned, setPinned] = useState(true);

  /* The snippet travels in the system prompt, so every turn sees it without the
     user re-sending it and without it aging out of the history window. */
  const system = useMemo(
    () =>
      [
        `You are a senior ${languageName} engineer sitting beside someone who is typing this exact snippet to learn it.`,
        'Answer only about the code below unless asked otherwise. Be concrete and specific to it — never generic filler.',
        'Keep answers under 180 words unless asked to go deeper. Use a short fenced block only when it genuinely clarifies.',
        // The renderer handles fenced blocks, `inline code`, bold, italic, links
        // and bullet/numbered lists — deliberately, so model text can never
        // inject markup. It does NOT do tables, and a table would not fit this
        // rail regardless: asking for one back produced a row of stray pipes.
        'Formatting: never use markdown tables. For anything line-by-line, use a numbered list.',
        '',
        `\`\`\`${language}`,
        code,
        '```',
      ].join('\n'),
    [code, language, languageName],
  );

  const { messages, setMessages, busy, thinking, partial, ask, stop } = useStreamingChat({
    system,
    maxTokens: 900,
    surface: 'code-chat',
  });

  /* A new snippet is a new subject. Carrying the previous transcript over meant
     follow-ups silently resolved against code that was no longer on screen. */
  useEffect(() => {
    setMessages([]);
    setDraft('');
  }, [code, setMessages]);

  /**
   * Openers drawn from this snippet, not a fixed list.
   *
   * `suggestQuestions` is cached per code hash and falls back to a locally
   * derived set when no provider answers, so the blank state always has
   * something to offer — including with no key and no network.
   */
  const [openers, setOpeners] = useState([]);
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    setOpeners([]);
    suggestQuestions(code, languageName, { signal: controller.signal })
      .then((qs) => {
        if (!cancelled) setOpeners(Array.isArray(qs) ? qs : []);
      })
      .catch(() => {
        /* aborted, or nothing to suggest — the empty state copes */
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [code, languageName]);

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

  const send = () => {
    if (!draft.trim()) return;
    ask(draft);
    setDraft('');
  };

  const Shell = embedded ? 'div' : 'aside';

  return (
    <Shell
      className={cx(
        'flex h-full min-h-0 flex-col overflow-hidden',
        !embedded && 'rounded-lg border border-line bg-surface',
      )}
    >
      {!embedded ? (
        <header className="flex shrink-0 items-center gap-1 border-b border-line px-2 py-1.5">
          <span className="grid h-[26px] w-[26px] shrink-0 place-items-center rounded-[8px] bg-brand-wash text-brand">
            <Sparkles size={14} strokeWidth={2.4} aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-bold leading-tight">Ask about this code</p>
            <p className="truncate text-2xs text-ink-3">{languageName}</p>
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-0.5">
            {!ready ? <Chip tone="warn">no key</Chip> : null}
            {messages.length ? (
              <IconButton size="sm" label="Clear conversation" icon={Eraser} onClick={() => setMessages([])} />
            ) : null}
            {onToggleExpand ? (
              <IconButton
                size="sm"
                label={expanded ? 'Shrink panel' : 'Expand panel'}
                icon={expanded ? Minimize2 : Maximize2}
                onClick={onToggleExpand}
                className="hidden xl:inline-flex"
              />
            ) : null}
          </div>
        </header>
      ) : null}

      {embedded && messages.length ? (
        <div className="flex shrink-0 justify-end border-b border-line px-1 py-0.5">
          <button
            type="button"
            onClick={() => setMessages([])}
            className="flex items-center gap-0.5 rounded-xs px-1 py-0.5 text-2xs font-bold text-ink-3 transition-colors hover:bg-subtle hover:text-ink-2"
          >
            <Eraser size={11} aria-hidden /> Clear
          </button>
        </div>
      ) : null}

      <div ref={scrollRef} className="relative min-h-0 flex-1 space-y-2 overflow-y-auto px-2 py-2">
        {messages.length === 0 && !busy ? (
          <Empty ready={ready} reduce={reduce} openers={openers} onPick={ask} />
        ) : null}

        {messages.map((m, i) => (
          <Bubble key={i} message={m} language={language} />
        ))}

        {busy ? <Live thinking={thinking} partial={partial} /> : null}
        <div ref={endRef} />
      </div>

      {busy && !pinned ? (
        <button
          type="button"
          onClick={() => endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })}
          className="absolute bottom-[64px] left-1/2 z-10 flex -translate-x-1/2 items-center gap-0.5 rounded-full border border-line bg-surface px-1.5 py-1 text-2xs font-bold shadow-md"
        >
          <ArrowDown size={12} aria-hidden /> Latest
        </button>
      ) : null}

      <form
        className="flex shrink-0 items-end gap-1 border-t border-line px-1.5 py-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          rows={1}
          disabled={!ready}
          placeholder={ready ? 'Ask about this snippet…' : 'AI is not configured'}
          aria-label="Ask about this snippet"
          className="max-h-[120px] min-h-[34px] min-w-0 flex-1 resize-none rounded-sm bg-subtle/60 px-1.5 py-1 text-sm leading-relaxed outline-none transition-colors placeholder:text-ink-3 focus:bg-subtle disabled:opacity-50"
          onInput={(e) => {
            e.target.style.height = 'auto';
            e.target.style.height = `${Math.min(120, e.target.scrollHeight)}px`;
          }}
        />
        {busy ? (
          <Button type="button" size="sm" variant="ghost" icon={Square} onClick={stop} aria-label="Stop generating" />
        ) : (
          <Button type="submit" size="sm" variant="brand" icon={Send} disabled={!ready || !draft.trim()} aria-label="Send" />
        )}
      </form>
    </Shell>
  );
}

/* Memoised on identity: a token landing in the live bubble must not re-parse
   and re-highlight every settled message above it. */
const Bubble = memo(function Bubble({ message, language }) {
  if (message.role === 'user') {
    return (
      <p className="ml-4 rounded-lg rounded-br-sm bg-brand-solid px-1.5 py-1 text-xs font-semibold text-brand-ink">
        {message.text}
      </p>
    );
  }

  return (
    <div className="mr-1">
      <div
        className={cx(
          'rounded-lg rounded-bl-sm border px-1.5 py-1',
          message.failed ? 'border-warn/50 bg-warn/10' : 'border-line bg-surface',
        )}
      >
        <Markdown text={typeof message.text === 'string' ? message.text : message.text?.detail ?? ''} language={language} compact />
      </div>
      {typeof message.text === 'string' ? <CopyButton text={message.text} /> : null}
    </div>
  );
});

function CopyButton({ text }) {
  const { copied, copy } = useCopyToClipboard();
  return (
    <button
      type="button"
      onClick={() => copy(text)}
      className="mt-0.5 flex items-center gap-0.5 px-0.5 text-2xs font-bold text-ink-3 transition-colors hover:text-ink-2"
    >
      {copied ? <Check size={11} aria-hidden /> : <Copy size={11} aria-hidden />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

/** In-flight answer: plain text, not markdown. Re-parsing a growing string
 *  every frame is the single biggest cost in a streaming panel. */
function Live({ thinking, partial }) {
  return (
    <div className="mr-1 rounded-lg rounded-bl-sm border border-line bg-surface px-1.5 py-1">
      {thinking && !partial ? (
        <div className="flex gap-1">
          <Brain size={12} className="mt-0.5 shrink-0 animate-pulse text-brand" aria-hidden />
          <p className="text-2xs italic leading-relaxed text-ink-3">
            {thinking.replace(/\s+/g, ' ').trim().slice(-140) || 'Thinking…'}
          </p>
        </div>
      ) : partial ? (
        <p className="whitespace-pre-wrap text-xs leading-relaxed text-ink-2">{partial}</p>
      ) : (
        <div className="space-y-1">
          <Skeleton className="h-1.5 w-[62%]" />
          <Skeleton className="h-1.5 w-[44%]" />
        </div>
      )}
    </div>
  );
}

function Empty({ ready, reduce, openers, onPick }) {
  return (
    <AnimatePresence>
      <motion.div
        initial={reduce ? false : { opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
        className="px-1 py-3"
      >
        <div className="text-center">
          <span className="mx-auto grid h-[38px] w-[38px] place-items-center rounded-lg bg-brand-wash text-brand">
            <Sparkles size={18} aria-hidden />
          </span>
          <p className="mt-1.5 text-sm font-bold">
            {ready ? 'Ask about this snippet' : 'AI is not configured'}
          </p>
          <p className="mx-auto mt-0.5 max-w-[34ch] text-xs leading-relaxed text-ink-3">
            {ready
              ? 'These are drawn from the code on screen.'
              : 'Set a provider key in .env.local to turn this on. Typing works without it.'}
          </p>
        </div>

        {ready ? (
          <div className="mt-2 space-y-1">
            {openers.length
              ? openers.map((q, i) => (
                  <motion.button
                    key={q}
                    type="button"
                    onClick={() => onPick(q)}
                    initial={reduce ? false : { opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: reduce ? 0 : 0.05 * i, duration: 0.25 }}
                    whileHover={reduce ? undefined : { x: 2 }}
                    className="block w-full rounded-sm border border-line px-1.5 py-1 text-left text-xs font-semibold leading-relaxed text-ink-2 transition-colors hover:border-line-strong hover:bg-subtle hover:text-ink"
                  >
                    {q}
                  </motion.button>
                ))
              : [0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-4 w-full" />)}
          </div>
        ) : null}
      </motion.div>
    </AnimatePresence>
  );
}
