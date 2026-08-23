import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ChevronDown, Maximize2, Minimize2, PanelRightClose, PanelRightOpen, RotateCcw,
  SkipForward, Sparkles,
} from 'lucide-react';
import Button, { IconButton } from '../../components/ui/Button.jsx';
import Segmented from '../../components/ui/Segmented.jsx';
import Select from '../../components/ui/Select.jsx';
import Markdown from '../../components/ui/Markdown.jsx';
import { Card, Chip, ProgressBar, Skeleton } from '../../components/ui/Primitives.jsx';
import TypingStage from '../../components/typing/TypingStage.jsx';
import SessionSummary from '../../components/typing/SessionSummary.jsx';
import LiveStats from '../../components/typing/LiveStats.jsx';
import useTypingEngine from '../../components/typing/useTypingEngine.js';
import AISidebar from './AISidebar.jsx';
import useCodeAnalysis from './useCodeAnalysis.js';
import { useStore, useStats } from '../../lib/store.jsx';
import { useToast } from '../../components/ui/Toast.jsx';
import { DIFFICULTIES, LANGUAGES, LANGUAGE_BY_ID, snippetsFor } from '../../lib/content.js';
import { AI_REASON_COPY, aiConfigured, generateSnippet } from '../../lib/ai.js';
import { tokenizeToChars } from '../../lib/prism.js';
import { cx } from '../../lib/format.js';

export default function CodeTyping() {
  const [params, setParams] = useSearchParams();
  const { state, recordSession, clearFresh, setSetting } = useStore();
  const stats = useStats();
  const { toast } = useToast();

  /* URL wins, then whatever you picked last time, then the default. */
  const [languageId, setLanguageId] = useState(() => {
    const fromUrl = params.get('lang');
    if (LANGUAGE_BY_ID[fromUrl]) return fromUrl;
    const remembered = state.settings.lastLanguage;
    return LANGUAGE_BY_ID[remembered] ? remembered : 'javascript';
  });
  const [difficulty, setDifficulty] = useState('normal');
  const [snippet, setSnippet] = useState(() => snippetsFor(languageId, 'normal')[0]);
  const [generating, setGenerating] = useState(false);
  const [railOpen, setRailOpen] = useState(true);
  const [railExpanded, setRailExpanded] = useState(false);
  const [result, setResult] = useState(null);
  const [focus, setFocus] = useState(false);

  const introOpen = state.settings.codeIntroOpen !== false;

  const toggleFocus = useCallback(() => setFocus((f) => !f), []);

  /**
   * How many code lines the full-screen stage can show.
   *
   * Derived from the viewport rather than fixed: the stage's height is
   * fontSize × lineHeight × visibleLines, so a hardcoded count overflows a
   * short window and gets clipped. `chrome` is the toolbar, intro, progress bar
   * and padding that share the column.
   */
  const [viewportH, setViewportH] = useState(() => (typeof window === 'undefined' ? 900 : window.innerHeight));
  useEffect(() => {
    const onResize = () => setViewportH(window.innerHeight);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const fullscreenLines = useMemo(() => {
    const chrome = 210;
    const lineBox = 19 * 1.9;
    return Math.max(6, Math.min(20, Math.floor((viewportH - chrome) / lineBox)));
  }, [viewportH]);

  /* A full-screen surface must not leave the page behind it scrollable. */
  useEffect(() => {
    if (!focus) return undefined;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [focus]);

  /* Escape leaves full screen — the same reflex every other full-screen
     surface on the web trains. It must not also reset the run. */
  useEffect(() => {
    if (!focus) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setFocus(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [focus]);

  const language = LANGUAGE_BY_ID[languageId];
  const available = useMemo(() => snippetsFor(languageId, difficulty), [languageId, difficulty]);

  /* Swap the snippet whenever language or difficulty changes, and remember the
     language so the next visit opens where you left off. */
  useEffect(() => {
    const first = snippetsFor(languageId, difficulty)[0];
    setSnippet(first);
    setResult(null);
    setSetting('lastLanguage', languageId);
  }, [languageId, difficulty, setSetting]);

  useEffect(() => {
    if (params.get('lang')) setParams({}, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const tokens = useMemo(
    () => tokenizeToChars(snippet.code, language.prism),
    [snippet.code, language.prism],
  );

  /* Owned here so the intro above the code and the tabs beside it render the
     same reading, settling together rather than independently. */
  const { analysis, loading: analysing, reload: reloadAnalysis } = useCodeAnalysis(snippet.code, language.name);

  const onFinish = useCallback(
    (run) => {
      setResult(run);
      recordSession({
        ts: new Date().toISOString(),
        kind: 'code',
        mode: 'code',
        difficulty,
        lang: languageId,
        wpm: run.wpm,
        accuracy: run.accuracy,
        consistency: run.consistency,
        durationSec: run.durationSec,
        chars: run.chars,
        errors: run.errors,
        keyStats: run.keyStats,
      });
    },
    [difficulty, languageId, recordSession],
  );

  const engine = useTypingEngine({
    target: snippet.code,
    limitSeconds: null,
    autoIndent: true,
    stopOnError: state.settings.stopOnError,
    sound: state.settings.sound,
    onFinish,
  });

  const choose = useCallback(
    (title) => {
      const found = available.find((s) => s.title === title);
      if (!found) return;
      setSnippet(found);
      setResult(null);
      clearFresh();
    },
    [available, clearFresh],
  );

  /** Steps to the next snippet in order — deterministic, so nothing repeats. */
  const nextSnippet = useCallback(() => {
    const i = available.findIndex((s) => s.title === snippet.title);
    choose(available[(i + 1) % available.length].title);
  }, [available, snippet.title, choose]);

  const generate = useCallback(async () => {
    setGenerating(true);
    try {
      const fresh = await generateSnippet(language.name, difficulty);
      setSnippet({ ...fresh, difficulty, language: languageId, intro: fresh.intro ?? 'Generated for this session.' });
      setResult(null);
      clearFresh();
      toast('Fresh snippet generated', { tone: 'success' });
    } catch (err) {
      // Say which failure it was — "could not reach the model" sent people
      // looking for a network problem when the real answer was a spent quota.
      const copy = AI_REASON_COPY[err.reason] ?? AI_REASON_COPY.network;
      toast(`${copy.label} — using the bundled library instead`, { tone: 'warn', duration: 4200 });
      nextSnippet();
    } finally {
      setGenerating(false);
    }
  }, [language.name, difficulty, languageId, toast, nextSnippet, clearFresh]);

  const history = useMemo(
    () => stats.sessions.filter((s) => s.kind === 'code').slice(-12).map((s) => s.wpm),
    [stats.sessions],
  );

  const toolbar = (
    <div className="flex flex-wrap items-center gap-1">
            <span
              className="grid h-[26px] w-[26px] shrink-0 place-items-center rounded-[8px] font-mono text-2xs font-extrabold text-white"
              style={{ background: language.hue }}
              aria-hidden
            >
              {language.icon}
            </span>
            <Select
              label="Language"
              value={languageId}
              onChange={setLanguageId}
              options={LANGUAGES.map((l) => ({ value: l.id, label: l.name, swatch: l.hue }))}
            />

            <span className="mx-0.5 hidden h-2 w-px bg-line sm:block" aria-hidden />

            <Segmented
              size="sm"
              label="Difficulty"
              options={DIFFICULTIES.map((d) => ({ value: d.id, label: d.name, hint: d.note }))}
              value={difficulty}
              onChange={setDifficulty}
            />

            {/* Every snippet action lives in one icon cluster. Full-width
                labelled buttons sat between the intro and the code and pushed
                the snippet itself below the fold, which is the wrong thing to
                spend vertical space on in a typing surface. */}
            <div className="ml-auto flex items-center gap-0.5">
              {/* Labelled, because a bare sparkle and a bare skip glyph do not
                  say what they do — but kept to one word each so they stay in
                  the toolbar instead of claiming a row of their own. */}
              <Button
                size="sm"
                variant="ghost"
                icon={Sparkles}
                onClick={generate}
                disabled={generating || !aiConfigured()}
                title={aiConfigured() ? 'Generate a fresh snippet with AI' : 'Set a provider key in .env.local to enable'}
                className={cx('text-brand', generating && 'animate-pulse')}
              >
                {generating ? 'Generating' : 'AI'}
              </Button>
              <Button size="sm" variant="ghost" icon={SkipForward} onClick={nextSnippet} title="Next snippet">
                Next
              </Button>
              <span className="mx-0.5 h-2 w-px bg-line" aria-hidden />
              <IconButton size="sm" label="Restart snippet" icon={RotateCcw} onClick={() => engine.reset()} />
              <IconButton
                size="sm"
                label={focus ? 'Leave full screen' : 'Enter full screen'}
                icon={focus ? Minimize2 : Maximize2}
                onClick={toggleFocus}
                className={cx(focus && 'text-brand')}
              />
              <IconButton
                size="sm"
                label={railOpen ? 'Hide AI chat' : 'Show AI chat'}
                icon={railOpen ? PanelRightClose : PanelRightOpen}
                onClick={() => setRailOpen((v) => !v)}
                className="hidden xl:inline-flex"
              />
            </div>
    </div>
  );

  /* Intro sits on top of the code in both layouts, so it is built once. */
  const stage = (fullscreen) => (
    <>
      <SnippetIntro
        snippet={snippet}
        difficulty={difficulty}
        typed={engine.index}
        language={languageId}
        analysis={analysis}
        loading={analysing}
        open={introOpen}
        onToggle={() => setSetting('codeIntroOpen', !introOpen)}
      />
      <div className={cx('px-2.5 sm:px-4', fullscreen ? 'pt-3' : 'pt-2.5')}>
        <ProgressBar value={engine.live.progress} className="mb-2" label="Snippet progress" />
        <TypingStage
          target={snippet.code}
          tokens={tokens}
          engine={engine}
          caretStyle={state.settings.caret}
          smoothCaret={state.settings.smoothCaret}
          fontSize={fullscreen ? 19 : 17}
          lineHeight={1.9}
          visibleLines={fullscreen ? fullscreenLines : 9}
          showLineNumbers
          loading={generating}
        />
      </div>
    </>
  );

  const chat = (
    <AISidebar
      code={snippet.code}
      language={languageId}
      languageName={language.name}
      analysis={analysis}
      loading={analysing}
      onReload={reloadAnalysis}
      expanded={railExpanded}
      onToggleExpand={() => setRailExpanded((v) => !v)}
    />
  );

  const summary = (
    <SessionSummary
        open={Boolean(result)}
        result={result ? { ...result, isPB: state._lastAward?.isPB } : null}
        award={state._lastAward}
        freshAchievements={state._fresh ?? []}
        history={history}
        confettiEnabled={state.settings.confetti}
        onRetry={() => {
          setResult(null);
          clearFresh();
          engine.reset();
        }}
        onNext={nextSnippet}
        onClose={() => {
          setResult(null);
          clearFresh();
        }}
      />
  );

  /* ── Full-screen focus surface ───────────────────────────────────────── */
  if (focus) {
    return (
      <>
        {/* Above the rail (z-30) and top bar (z-40), below modals (z-50). */}
        <div className="fixed inset-0 z-[45] flex flex-col bg-bg">
          <div className="shrink-0 border-b border-line px-2 py-1.5">{toolbar}</div>
          <div className="flex min-h-0 flex-1 gap-2 p-2">
            {/* overflow-hidden, not auto: TypingStage already scrolls itself by
                shifting the passage to keep the caret parked. An outer scroller
                on top of that gave two competing scroll positions, which pushed
                the intro off-screen and clipped the first line. */}
            <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-line bg-surface">
              {stage(true)}
            </div>
            {railOpen ? <aside className="hidden w-[380px] shrink-0 lg:block">{chat}</aside> : null}
          </div>
        </div>
        {summary}
      </>
    );
  }

  /* ── Windowed layout ─────────────────────────────────────────────────── */
  return (
    <div className="space-y-3">
      <header className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="eyebrow">Train</p>
          <h1 className="mt-0.5 text-3xl font-extrabold">Code typing</h1>
          <p className="mt-0.5 max-w-[52ch] text-sm text-ink-3">
            Real snippets, real syntax, real punctuation. Indentation is handled for you — brackets are not.
          </p>
        </div>
        {/* The header used to hold "Next snippet" and "AI snippet". Both are
            icons in the toolbar now, beside the reset they belong with; the
            header carries the numbers you want in your eyeline while typing. */}
        <LiveStats live={engine.live} compact />
      </header>

      <div
        className={cx(
          'grid gap-2.5',
          railOpen ? (railExpanded ? 'xl:grid-cols-2' : 'xl:grid-cols-[1fr_380px]') : 'xl:grid-cols-1',
        )}
      >
        <Card className="overflow-hidden">
          <div className="border-b border-line px-2 py-1.5">{toolbar}</div>
          {stage(false)}
          <div className="pb-2" />
        </Card>

        {railOpen ? (
          <div className="min-h-[560px] xl:sticky xl:top-[80px] xl:h-[calc(100dvh-120px)]">{chat}</div>
        ) : null}
      </div>

      {summary}
    </div>
  );
}

/* ── Snippet intro ─────────────────────────────────────────────────────────
   The name is permanent; the prose is not. Hiding keeps the row that anchors
   the code — title, topic, difficulty, progress — and removes only the
   paragraph, so the collapse costs one line of layout rather than a jump. */

function SnippetIntro({ snippet, difficulty, typed, language, analysis, loading, open, onToggle }) {
  const lines = snippet.code.split('\n').length;

  return (
    <div className="border-b border-line bg-gradient-to-b from-subtle/40 to-transparent px-2.5 py-2 sm:px-4">
      <div className="flex flex-wrap items-center gap-1">
        <h2 className="text-lg font-extrabold tracking-[-0.01em]">{snippet.title}</h2>
        <Chip tone="brand">{snippet.topic ?? 'snippet'}</Chip>
        <Chip tone="outline">{difficulty}</Chip>

        <div className="ml-auto flex items-center gap-1">
          <span className="font-mono text-xs text-ink-3 tnum">
            {typed} / {snippet.code.length}
          </span>
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={open}
            title={open ? 'Hide the briefing' : 'Show the briefing'}
            className="flex items-center gap-0.5 rounded-xs px-1 py-0.5 text-2xs font-extrabold uppercase tracking-[0.07em] text-ink-3 transition-colors hover:bg-subtle hover:text-ink-2"
          >
            {open ? 'Hide' : 'About'}
            <ChevronDown
              size={12}
              strokeWidth={2.6}
              className={cx('transition-transform duration-200', open && 'rotate-180')}
              aria-hidden
            />
          </button>
        </div>
      </div>

      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            key="intro"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden"
          >
            <div className="mt-1.5 grid gap-2 lg:grid-cols-[1fr_auto]">
              <div className="min-w-0 max-w-[80ch]">
                {/* The bundled one-liner is instant and always right; the model's
                    reading replaces it when it lands. Showing the short one
                    first is what keeps this area from opening as a skeleton. */}
                <Markdown
                  text={analysis?.intro ?? snippet.intro ?? analysis?.summary ?? ''}
                  language={language}
                  compact
                  className="text-sm"
                />
                {loading && !analysis ? (
                  <div className="mt-1 space-y-1">
                    <Skeleton className="h-1.5 w-[72%]" />
                    <Skeleton className="h-1.5 w-[54%]" />
                  </div>
                ) : null}
              </div>

              <div className="flex shrink-0 gap-1 lg:flex-col">
                <Stat label="Lines" value={lines} />
                <Stat label="Chars" value={snippet.code.length} />
                <Stat label="Time" value={analysis?.timeComplexity?.value ?? '—'} />
              </div>
            </div>

            <Examples items={analysis?.examples} language={language} />
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function Stat({ label, value }) {
  // Complexity comes back as free text and can be far longer than "O(n)" —
  // "O(retries * T)" overflowed a fixed box. Shrink past a threshold and clip
  // with the full value on hover, rather than letting it break the row.
  const long = String(value).length > 7;

  return (
    <div className="min-w-0 flex-1 rounded-md border border-line bg-surface/60 px-1.5 py-1 text-center lg:w-[104px] lg:flex-none">
      <p
        title={String(value)}
        className={cx('truncate font-mono font-bold leading-none tnum', long ? 'text-2xs' : 'text-base')}
      >
        {value}
      </p>
      <p className="mt-0.5 text-2xs font-bold uppercase tracking-[0.07em] text-ink-3">{label}</p>
    </div>
  );
}

/** Worked cases. Absent offline, because the only honest way to know what a
 *  snippet returns is to run it — see the note in `localAnalysis`. */
function Examples({ items, language }) {
  if (!items?.length) return null;

  return (
    <div className="mt-2">
      <p className="text-2xs font-extrabold uppercase tracking-[0.09em] text-ink-3">Worked examples</p>
      <div className="mt-1 grid gap-1 md:grid-cols-2 xl:grid-cols-3">
        {items.slice(0, 3).map((ex, i) => (
          <div key={i} className="rounded-md border border-line bg-surface/60 p-1.5">
            <p className="text-xs font-extrabold">{ex.title}</p>
            <div className="mt-1 space-y-0.5 font-mono text-2xs leading-relaxed">
              <p className="truncate text-ink-2" title={ex.input}>
                <span className="text-ink-3">in </span>
                {ex.input}
              </p>
              <p className="truncate text-brand" title={ex.output}>
                <span className="text-ink-3">out </span>
                {ex.output}
              </p>
            </div>
            {ex.note ? <p className="mt-1 text-2xs leading-relaxed text-ink-3">{ex.note}</p> : null}
          </div>
        ))}
      </div>
    </div>
  );
}
