import { useCallback, useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  AlertTriangle, CheckCircle2, Gauge, GitBranch, Lightbulb, Maximize2,
  MessageSquare, Minimize2, RefreshCw, Sparkles, Wand2,
} from 'lucide-react';
import Button, { IconButton } from '../../components/ui/Button.jsx';
import { Chip, Skeleton } from '../../components/ui/Primitives.jsx';
import Markdown, { CodeBlock } from '../../components/ui/Markdown.jsx';
import CodeChat from './CodeChat.jsx';
import { AI_REASON_COPY, aiConfigured, optimiseCode } from '../../lib/ai.js';
import { cx } from '../../lib/format.js';

// Intro is deliberately absent: it moved to the block above the code, beside
// the snippet's name, where the briefing belongs before you start typing.
const TABS = [
  { id: 'explain', label: 'Explain', icon: Sparkles },
  { id: 'flow', label: 'Flow', icon: GitBranch },
  { id: 'complexity', label: 'Cost', icon: Gauge },
  { id: 'review', label: 'Review', icon: Lightbulb },
  // Chat is last and deliberately separate: the five before it answer fixed
  // questions in shapes built for them — a flow diagram, complexity cards, a
  // rewrite — and this one takes everything they cannot.
  { id: 'chat', label: 'Chat', icon: MessageSquare },
];

/** Colour and glyph per flow-step kind, so the diagram reads without labels. */
const FLOW_KIND = {
  start: { ring: 'bg-brand-solid', label: 'start' },
  process: { ring: 'bg-info', label: 'process' },
  decision: { ring: 'bg-warn', label: 'decision' },
  loop: { ring: 'bg-[#8a6ad6]', label: 'loop' },
  output: { ring: 'bg-good', label: 'output' },
};

export default function AISidebar({
  code, language, languageName, analysis, loading, onReload, expanded = false, onToggleExpand,
}) {
  const [tab, setTab] = useState('explain');
  const [optimised, setOptimised] = useState(null);
  const [optimising, setOptimising] = useState(false);
  const [optimiseError, setOptimiseError] = useState(null);

  /* A rewrite belongs to the snippet it rewrote. */
  useEffect(() => {
    setOptimised(null);
    setOptimiseError(null);
  }, [code]);

  const load = useCallback(({ force = false } = {}) => {
    setOptimised(null);
    setOptimiseError(null);
    onReload?.({ force });
  }, [onReload]);

  const runOptimise = async () => {
    setOptimising(true);
    setOptimiseError(null);
    try {
      setOptimised(await optimiseCode(code, languageName));
    } catch (err) {
      // The old version swallowed this into unrendered state, so the button
      // looked dead. Surface the real reason instead.
      setOptimiseError(AI_REASON_COPY[err.reason] ?? AI_REASON_COPY.network);
    } finally {
      setOptimising(false);
    }
  };

  // Both of these describe the one-shot analysis, so they stay out of the way
  // on the chat tab, which does not use it.
  const onChat = tab === 'chat';
  const degraded = !onChat && analysis?.source === 'offline';
  const reasonCopy = degraded ? (AI_REASON_COPY[analysis.reason] ?? AI_REASON_COPY.network) : null;

  return (
    <aside className="flex h-full flex-col overflow-hidden rounded-lg border border-line bg-surface">
      <header className="flex items-center gap-1 border-b border-line px-2 py-1.5">
        <span className="grid h-[26px] w-[26px] shrink-0 place-items-center rounded-[8px] bg-brand-wash text-brand">
          <Sparkles size={14} strokeWidth={2.4} aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-bold leading-tight">AI code visualiser</p>
          <p className="truncate text-2xs text-ink-3">{languageName}</p>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-0.5">
          {degraded ? (
            <Chip tone="warn" title={reasonCopy.detail}>
              {reasonCopy.label}
            </Chip>
          ) : null}
          {!onChat ? (
            <IconButton size="sm" label="Re-run analysis" icon={RefreshCw} onClick={() => load({ force: true })} />
          ) : null}
          {onToggleExpand ? (
            <IconButton
              size="sm"
              label={expanded ? 'Shrink AI panel' : 'Expand AI panel to half the screen'}
              icon={expanded ? Minimize2 : Maximize2}
              onClick={onToggleExpand}
              className="hidden xl:inline-flex"
            />
          ) : null}
        </div>
      </header>

      {/* A degraded panel says why, and what it would take to fix. */}
      {degraded ? (
        <div className="flex items-start gap-1 border-b border-line bg-warn/10 px-2 py-1.5">
          <AlertTriangle size={13} className="mt-px shrink-0 text-warn" aria-hidden />
          <p className="text-2xs leading-relaxed text-ink-2">{reasonCopy.detail}</p>
        </div>
      ) : null}

      <nav className="flex gap-px border-b border-line px-1 py-1" aria-label="Analysis sections">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            aria-current={tab === t.id}
            className={cx(
              'relative flex flex-1 items-center justify-center gap-0.5 rounded-xs px-0.5 py-1 text-2xs font-bold uppercase tracking-[0.05em] transition-colors',
              tab === t.id ? 'text-ink' : 'text-ink-3 hover:text-ink-2',
            )}
          >
            {tab === t.id ? (
              <motion.span
                layoutId="ai-tab"
                className="absolute inset-0 rounded-xs bg-subtle"
                transition={{ type: 'spring', stiffness: 420, damping: 34 }}
              />
            ) : null}
            <t.icon size={12} strokeWidth={2.4} className="relative" aria-hidden />
            <span className="relative hidden sm:inline">{t.label}</span>
          </button>
        ))}
      </nav>

      {/* Chat owns its own scroller and composer, so it replaces the body
          rather than sitting inside it. */}
      {tab === 'chat' ? (
        <CodeChat embedded code={code} language={language} languageName={languageName} />
      ) : (
      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {loading ? (
          <LoadingBody />
        ) : !analysis ? (
          <p className="text-sm text-ink-3">No analysis yet.</p>
        ) : (
          <AnimatePresence mode="wait">
            <motion.div
              key={tab}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.18 }}
              className={cx('space-y-2', expanded && 'mx-auto max-w-[70ch]')}
            >
              {tab === 'explain' ? <ExplainTab analysis={analysis} language={language} /> : null}
              {tab === 'flow' ? <FlowTab analysis={analysis} language={language} /> : null}
              {tab === 'complexity' ? <ComplexityTab analysis={analysis} language={language} /> : null}
              {tab === 'review' ? (
                <ReviewTab
                  analysis={analysis}
                  language={language}
                  optimised={optimised}
                  optimising={optimising}
                  error={optimiseError}
                  onOptimise={runOptimise}
                  canOptimise={aiConfigured()}
                />
              ) : null}
            </motion.div>
          </AnimatePresence>
        )}
      </div>
      )}
    </aside>
  );
}

/* ── Tabs ──────────────────────────────────────────────────────────────── */

function ExplainTab({ analysis, language }) {
  const steps = analysis.explanation ?? [];
  if (!steps.length) return <Empty>No explanation was returned.</Empty>;

  return (
    <Block title={`Step by step · ${steps.length} steps`}>
      <ol className="space-y-1.5">
        {steps.map((line, i) => (
          <motion.li
            key={i}
            initial={{ opacity: 0, x: -4 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.04 }}
            className="flex gap-1.5"
          >
            <span className="mt-px grid h-[20px] w-[20px] shrink-0 place-items-center rounded-full bg-brand-wash font-mono text-2xs font-bold text-brand">
              {i + 1}
            </span>
            <Markdown text={line} language={language} compact className="min-w-0 flex-1" />
          </motion.li>
        ))}
      </ol>
    </Block>
  );
}

/** Vertical flow diagram, colour-coded by step kind. */
function FlowTab({ analysis, language }) {
  const steps = analysis.flow ?? [];
  if (!steps.length) return <Empty>No flow was extracted for this snippet.</Empty>;

  return (
    <>
      <ol className="relative space-y-2 pl-3.5">
        <span className="absolute bottom-2 left-[9px] top-2 w-[2px] rounded-full bg-line" aria-hidden />
        {steps.map((s, i) => {
          const kind = FLOW_KIND[s.kind] ?? FLOW_KIND.process;
          return (
            <motion.li
              key={i}
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.06 }}
              className="relative"
            >
              <span
                className={cx(
                  'absolute -left-3.5 top-[5px] h-[12px] w-[12px] rounded-full border-2 border-surface',
                  kind.ring,
                )}
                aria-hidden
              />
              <div className="flex items-center gap-1">
                <p className="text-sm font-bold">{s.step}</p>
                <span className="text-2xs font-bold uppercase tracking-[0.08em] text-ink-3">{kind.label}</span>
                {s.branch ? <Chip tone="outline">{s.branch}</Chip> : null}
              </div>
              <Markdown text={s.detail} language={language} compact className="mt-px" />
              {/* A concrete value at this step. "Increments the counter" and
                  "i = 2" teach different things; the second is the one that
                  makes a loop click. */}
              {s.example ? (
                <div className="mt-1 flex items-start gap-1 rounded-sm border border-line bg-subtle/50 px-1 py-0.5">
                  <span className="mt-px shrink-0 text-2xs font-bold uppercase tracking-[0.07em] text-ink-3">
                    e.g.
                  </span>
                  <Markdown text={s.example} language={language} compact className="min-w-0 flex-1 text-xs" />
                </div>
              ) : null}
            </motion.li>
          );
        })}
      </ol>

      <ul className="flex flex-wrap gap-x-1.5 gap-y-0.5 border-t border-line pt-1.5">
        {Object.entries(FLOW_KIND).map(([id, k]) => (
          <li key={id} className="flex items-center gap-0.5 text-2xs font-bold uppercase tracking-[0.06em] text-ink-3">
            <span className={cx('h-[8px] w-[8px] rounded-full', k.ring)} aria-hidden />
            {k.label}
          </li>
        ))}
      </ul>
    </>
  );
}

function ComplexityTab({ analysis, language }) {
  const items = [
    { label: 'Time', data: analysis.timeComplexity },
    { label: 'Space', data: analysis.spaceComplexity },
  ];

  return (
    <div className="space-y-1.5">
      {items.map(({ label, data }) => (
        <div key={label} className="rounded-md border border-line p-1.5">
          <div className="flex items-baseline justify-between">
            <p className="text-2xs font-bold uppercase tracking-[0.09em] text-ink-3">{label} complexity</p>
            <p className="font-mono text-xl font-medium text-brand">{data?.value ?? '—'}</p>
          </div>
          <Markdown text={data?.why ?? ''} language={language} compact className="mt-0.5" />
        </div>
      ))}
      <Block title="Best practices">
        <List items={analysis.bestPractices} icon={CheckCircle2} tone="text-good" language={language} />
      </Block>
    </div>
  );
}

/**
 * Review leads with the rewrite.
 *
 * The prose used to come first and the button sat under two lists, so pressing
 * it scrolled the result out of sight — you asked for a rewrite and got a wall
 * of text where the code should have been. The code is the answer, so it goes
 * at the top; the mistakes and improvements are the commentary and follow it.
 */
function ReviewTab({ analysis, language, optimised, optimising, error, onOptimise, canOptimise }) {
  return (
    <>
      {optimised ? (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-1">
          <div className="flex items-center justify-between gap-1">
            <p className="text-2xs font-bold uppercase tracking-[0.09em] text-ink-3">Rewritten</p>
            <Button size="sm" variant="ghost" icon={Wand2} onClick={onOptimise} disabled={optimising}>
              Again
            </Button>
          </div>
          <CodeBlock code={optimised.code} language={language} className="max-h-[300px]" />
          {optimised.verdict ? (
            <Markdown text={optimised.verdict} language={language} compact className="italic" />
          ) : null}
          <List items={optimised.changes} icon={CheckCircle2} tone="text-good" language={language} />
        </motion.div>
      ) : (
        <Button
          variant="brand"
          size="sm"
          icon={Wand2}
          className="w-full"
          onClick={onOptimise}
          disabled={optimising || !canOptimise}
        >
          {optimising ? 'Optimising…' : 'Optimise this snippet'}
        </Button>
      )}

      {optimising && !optimised ? (
        <div className="space-y-1">
          <Skeleton className="h-2 w-full" />
          <Skeleton className="h-2 w-[88%]" />
          <Skeleton className="h-2 w-[72%]" />
        </div>
      ) : null}

      {!canOptimise ? (
        <p className="text-2xs text-ink-3">Set a provider key in .env.local to enable this.</p>
      ) : null}

      {error ? (
        <div className="flex items-start gap-1 rounded-sm border border-warn/50 bg-warn/10 px-1.5 py-1">
          <AlertTriangle size={13} className="mt-px shrink-0 text-warn" aria-hidden />
          <div>
            <p className="text-2xs font-bold">{error.label}</p>
            <p className="text-2xs leading-relaxed text-ink-2">{error.detail}</p>
          </div>
        </div>
      ) : null}

      <Block title="Common mistakes">
        <List items={analysis.commonMistakes} icon={AlertTriangle} tone="text-warn" language={language} />
      </Block>
      <Block title="Suggested improvements">
        <List items={analysis.improvements} icon={Lightbulb} tone="text-info" language={language} />
      </Block>
    </>
  );
}

/* ── Pieces ────────────────────────────────────────────────────────────── */

function Block({ title, children }) {
  return (
    <section>
      <h3 className="mb-1 text-2xs font-bold uppercase tracking-[0.09em] text-ink-3">{title}</h3>
      {children}
    </section>
  );
}

function List({ items, icon: Icon, tone, language }) {
  if (!items?.length) return <Empty>Nothing flagged.</Empty>;
  return (
    <ul className="space-y-1">
      {items.map((item, i) => (
        <li key={i} className="flex gap-1">
          <Icon size={14} strokeWidth={2.2} className={cx('mt-1 shrink-0', tone)} aria-hidden />
          <Markdown text={item} language={language} compact className="min-w-0 flex-1" />
        </li>
      ))}
    </ul>
  );
}

function Empty({ children }) {
  return <p className="text-sm text-ink-3">{children}</p>;
}

function LoadingBody() {
  return (
    <div className="space-y-2">
      <Skeleton className="h-1 w-[40%]" />
      <Skeleton className="h-2 w-full" />
      <Skeleton className="h-2 w-[92%]" />
      <Skeleton className="h-2 w-[76%]" />
      <Skeleton className="mt-3 h-1 w-[30%]" />
      <Skeleton className="h-2 w-full" />
      <Skeleton className="h-2 w-[84%]" />
    </div>
  );
}
