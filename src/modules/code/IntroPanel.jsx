import { useCallback, useEffect, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ChevronDown, CornerDownRight, FileCode2 } from 'lucide-react';
import Markdown from '../../components/ui/Markdown.jsx';
import { Chip, Skeleton } from '../../components/ui/Primitives.jsx';
import { cx } from '../../lib/format.js';
import { readSession, writeSession } from '../../lib/storage.js';

const KEY = 'keystroke.code.introOpen';

/**
 * The snippet's orientation card, above the stage.
 *
 * Collapsed — the default, and where most people will leave it — this is one
 * row: the program name and a one-line summary. That is deliberately the same
 * height as the title block it replaced, so the code does not move down the
 * page for a panel nobody opened.
 *
 * Expanded it answers the questions you actually have before typing something:
 * what problem is this, what does it do to an input, and what do I need to know
 * to follow it. The overview, concepts and size come from the snippet and its
 * source; the problem statement and worked example come from the model, so they
 * appear when the analysis lands and are simply absent when it cannot.
 */
export default function IntroPanel({ snippet, difficulty, language, analysis, loading, onOpenChange }) {
  const reduceMotion = useReducedMotion();
  const [open, setOpen] = useState(() => readSession(KEY) === '1');

  // Session-scoped: survives moving between snippets and a reload in this tab,
  // but a panel opened once to read something is not a permanent preference.
  const toggle = useCallback(() => {
    setOpen((v) => {
      writeSession(KEY, v ? '0' : '1');
      return !v;
    });
  }, []);

  useEffect(() => {
    onOpenChange?.(open);
  }, [open, onOpenChange]);

  const example = analysis?.example;
  const hasExample = Boolean(example && (example.input || example.output));
  const concepts = (analysis?.concepts ?? []).filter(Boolean).slice(0, 5);
  const lines = snippet.code.split('\n').length;

  /* Waiting only matters for the two model-sourced sections. */
  const awaitingModel = loading && !analysis;

  return (
    <section className="border-b border-line" aria-labelledby="intro-title">
      <h2
        className={cx(
          'flex items-center gap-1 px-2.5 sm:px-4',
          // Tighter when open: the body below supplies the breathing room.
          open ? 'pb-1 pt-2' : 'py-2',
        )}
      >
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          aria-controls="intro-body"
          className="group flex min-w-0 flex-1 items-center gap-1.5 rounded-sm text-left"
        >
          <span
            className="grid h-[26px] w-[26px] shrink-0 place-items-center rounded-[8px] bg-subtle text-ink-3 transition-colors group-hover:text-ink-2"
            aria-hidden
          >
            <FileCode2 size={14} strokeWidth={2.2} />
          </span>

          <span className="min-w-0 flex-1">
            <span id="intro-title" className="block truncate text-base font-bold tracking-[-0.01em]">
              {snippet.title}
            </span>
            {/* The one-line summary. Clamped closed, full open — so the row
                never wraps into a second line and shifts the code. */}
            <span className={cx('block text-xs leading-relaxed text-ink-3', !open && 'truncate')}>
              {snippet.intro ?? 'A snippet to type.'}
            </span>
          </span>

          <span
            className="ml-auto grid h-[26px] w-[26px] shrink-0 place-items-center rounded-[7px] text-ink-3 transition-colors group-hover:bg-subtle group-hover:text-ink"
            aria-hidden
          >
            <ChevronDown
              size={16}
              strokeWidth={2.4}
              className={cx('transition-transform duration-300 ease-out', open && 'rotate-180')}
            />
          </span>
        </button>
      </h2>

      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            id="intro-body"
            key="body"
            initial={reduceMotion ? false : { height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={reduceMotion ? { opacity: 0 } : { height: 0, opacity: 0 }}
            transition={{
              height: { duration: 0.3, ease: [0.16, 1, 0.3, 1] },
              opacity: { duration: 0.2, ease: 'easeOut' },
            }}
            className="overflow-hidden"
          >
            <div className="space-y-2 px-2.5 pb-2.5 sm:px-4">
              {/* Badges: what kind of snippet, how hard, what it leans on. */}
              <ul className="flex flex-wrap items-center gap-0.5">
                {snippet.topic ? (
                  <li>
                    <Chip tone="brand">{snippet.topic}</Chip>
                  </li>
                ) : null}
                <li>
                  <Chip tone="outline">{difficulty}</Chip>
                </li>
                {concepts.map((c) => (
                  <li key={c}>
                    <Chip tone="neutral">{c}</Chip>
                  </li>
                ))}
                <li className="ml-auto font-mono text-2xs text-ink-3 tnum">
                  {lines} lines · {snippet.code.length} chars
                </li>
              </ul>

              {awaitingModel ? (
                <div className="space-y-1" role="status" aria-label="Loading the problem statement">
                  <Skeleton className="h-1.5 w-[42%]" />
                  <Skeleton className="h-1.5 w-full" />
                  <Skeleton className="h-1.5 w-[78%]" />
                </div>
              ) : null}

              {analysis?.problem ? (
                <Field label="Problem">
                  <Markdown text={analysis.problem} language={language} compact />
                </Field>
              ) : null}

              {hasExample ? (
                <Field label="Example">
                  {/* `divide-y` rather than a border on the second row: when
                      only one side is present there is no divider to suppress. */}
                  <div className="divide-y divide-line overflow-hidden rounded-sm border border-line bg-subtle/50">
                    <IORow label="in" value={example.input} />
                    <IORow label="out" value={example.output} accent />
                  </div>
                  {example.note ? (
                    <p className="mt-0.5 flex items-start gap-0.5 text-2xs leading-relaxed text-ink-3">
                      <CornerDownRight size={11} className="mt-px shrink-0" aria-hidden />
                      {example.note}
                    </p>
                  ) : null}
                </Field>
              ) : null}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </section>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <p className="mb-0.5 text-2xs font-bold uppercase tracking-[0.09em] text-ink-3">{label}</p>
      {children}
    </div>
  );
}

/** One side of the worked example. Monospace, wraps rather than scrolls. */
function IORow({ label, value, accent = false }) {
  if (!value) return null;
  return (
    <div className="flex gap-1.5 px-1.5 py-1">
      <span className="w-[22px] shrink-0 pt-px font-mono text-2xs font-bold uppercase text-ink-3">{label}</span>
      <code
        className={cx(
          'min-w-0 flex-1 whitespace-pre-wrap break-words font-mono text-xs leading-relaxed',
          accent ? 'text-brand' : 'text-ink-2',
        )}
      >
        {value}
      </code>
    </div>
  );
}
