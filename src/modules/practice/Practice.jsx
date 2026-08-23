import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Clock, Eye, EyeOff, Hash, Keyboard as KeyboardIcon, KeyboardOff, Leaf, Maximize2,
  Minimize2, PenLine, Quote, RotateCcw, Settings2, SkipForward, Sparkles, Volume2, VolumeX,
} from 'lucide-react';
import Button, { IconButton } from '../../components/ui/Button.jsx';
import Segmented from '../../components/ui/Segmented.jsx';
import Select from '../../components/ui/Select.jsx';
import Modal from '../../components/ui/Modal.jsx';
import DecayCounter from '../../components/ui/DecayCounter.jsx';
import { Card, Chip, ProgressBar, SectionTitle } from '../../components/ui/Primitives.jsx';
import TypingStage from '../../components/typing/TypingStage.jsx';
import HandGuide from '../../components/typing/HandGuide.jsx';
import KeyboardViz from '../../components/typing/KeyboardViz.jsx';
import WeakKeyStrip from '../../components/typing/WeakKeyStrip.jsx';
import SessionSummary from '../../components/typing/SessionSummary.jsx';
import useTypingEngine from '../../components/typing/useTypingEngine.js';
import MissionStrip from '../../components/gamify/MissionStrip.jsx';
import { HAND_GUIDE_LIMIT, useStore, useStats } from '../../lib/store.jsx';
import { useToast } from '../../components/ui/Toast.jsx';
import { DRILLS, randomQuote, randomWords } from '../../lib/content.js';
import { aiConfigured, generatePassage } from '../../lib/ai.js';
import { cx, mmss, relativeTime } from '../../lib/format.js';

const MODES = [
  { value: 'time', label: 'Time', icon: Clock },
  { value: 'words', label: 'Words', icon: Hash },
  { value: 'quote', label: 'Quote', icon: Quote },
  { value: 'drill', label: 'Drill', icon: KeyboardIcon },
  { value: 'custom', label: 'Custom', icon: PenLine },
  { value: 'zen', label: 'Zen', icon: Leaf },
];

const DURATIONS = [15, 30, 60, 120];
const WORD_COUNTS = [10, 25, 50, 100];
const DIFFICULTIES = [
  { value: 'easy', label: 'Easy' },
  { value: 'normal', label: 'Normal' },
  { value: 'hard', label: 'Hard' },
  { value: 'expert', label: 'Expert' },
];

export default function Practice() {
  const [params, setParams] = useSearchParams();
  const { state, recordSession, setSetting, clearFresh } = useStore();
  const stats = useStats();
  const { toast } = useToast();
  const { settings } = state;

  const [mode, setMode] = useState(params.get('mode') ?? 'time');
  const [difficulty, setDifficulty] = useState('normal');
  const [duration, setDuration] = useState(60);
  const [wordCount, setWordCount] = useState(25);
  const [drillId, setDrillId] = useState(DRILLS[0].id);
  const [customText, setCustomText] = useState('');
  const [customOpen, setCustomOpen] = useState(false);
  const [seed, setSeed] = useState(0);
  const [result, setResult] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [focus, setFocus] = useState(settings.fullscreen);

  /**
   * The guide is decided once, when the page mounts — not on every render, so
   * it cannot flicker back after being dismissed, and the count is banked
   * immediately so a refresh cannot farm extra showings.
   */
  const [guideOpen, setGuideOpen] = useState(
    () => settings.handGuide && (settings.handGuideSeen ?? 0) < HAND_GUIDE_LIMIT,
  );
  const guideShowsLeft = HAND_GUIDE_LIMIT - (settings.handGuideSeen ?? 0) - 1;

  useEffect(() => {
    if (!guideOpen) return;
    setSetting('handGuideSeen', (settings.handGuideSeen ?? 0) + 1);
    // Runs once per mount; `settings.handGuideSeen` is read at that instant.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guideOpen]);

  /* Build the exercise. `seed` is the regenerate handle. */
  /**
   * AI-generated exercise, refreshed on every load and every regenerate.
   *
   * The bundled banks are the immediate answer so the stage is never blank;
   * when the model responds the text is swapped in. `seed` changes on refresh,
   * so the same settings never produce the same passage twice.
   */
  const [aiText, setAiText] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);

  /**
   * The openings of recent AI passages, so the next request can be told what
   * not to write again. A ref rather than state: it must survive the effect
   * re-running without itself triggering another run.
   */
  const recentPassages = useRef([]);

  useEffect(() => {
    if (!settings.aiText || mode === 'custom' || mode === 'drill') {
      setAiText(null);
      return;
    }

    const controller = new AbortController();
    setAiLoading(true);
    setAiText(null);

    generatePassage({
      mode,
      difficulty,
      words: mode === 'time' ? Math.max(60, duration * 2) : mode === 'words' ? wordCount : 70,
      // Openings only. The full text would eat the context window and pushes
      // the model toward paraphrasing what it is shown rather than avoiding it.
      avoid: recentPassages.current.slice(-4),
      signal: controller.signal,
    })
      .then((res) => {
        if (controller.signal.aborted) return;
        const label = mode === 'quote' && res.author ? `— ${res.author}` : res.label;
        recentPassages.current = [...recentPassages.current, res.text.slice(0, 70)].slice(-8);
        setAiText({ text: res.text, meta: `${label} · fresh` });
      })
      .catch(() => {
        /* bundled text stays on screen; nothing to report */
      })
      .finally(() => !controller.signal.aborted && setAiLoading(false));

    return () => controller.abort();
  }, [mode, difficulty, duration, wordCount, seed, settings.aiText]);

  const bundled = useMemo(() => {
    switch (mode) {
      case 'words':
        return { text: randomWords(wordCount, difficulty), meta: `${wordCount} words · ${difficulty}` };
      case 'quote': {
        const q = randomQuote('any');
        return { text: q.text, meta: `— ${q.author}` };
      }
      case 'drill': {
        const d = DRILLS.find((x) => x.id === drillId) ?? DRILLS[0];
        return { text: d.text, meta: `${d.name} · targeted drill` };
      }
      case 'custom':
        return {
          text: customText.trim() || 'Press Ctrl+V anywhere to paste your own text, or use Edit text to type it in.',
          meta: customText.trim() ? `Your text · ${customText.trim().length} characters` : 'Paste to begin',
        };
      case 'zen':
        return { text: randomWords(180, difficulty), meta: 'No clock. No pressure.' };
      case 'time':
      default:
        return { text: randomWords(Math.max(60, duration * 2), difficulty), meta: `${duration} second sprint · ${difficulty}` };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, difficulty, duration, wordCount, drillId, customText, seed]);

  /* AI text wins once it lands; the bundled passage covers the gap. */
  const exercise = aiText ?? bundled;

  const onFinish = useCallback(
    (run) => {
      setResult(run);
      if (mode === 'zen') return; // Zen deliberately does not score you
      recordSession({
        ts: new Date().toISOString(),
        kind: 'text',
        mode,
        difficulty,
        lang: null,
        wpm: run.wpm,
        accuracy: run.accuracy,
        consistency: run.consistency,
        durationSec: run.durationSec,
        chars: run.chars,
        errors: run.errors,
        keyStats: run.keyStats,
      });
    },
    [mode, difficulty, recordSession],
  );

  const engine = useTypingEngine({
    target: exercise.text,
    limitSeconds: mode === 'time' ? duration : null,
    stopOnError: settings.stopOnError,
    sound: settings.sound,
    onFinish,
  });

  const next = useCallback(() => {
    setResult(null);
    clearFresh();
    setSeed((s) => s + 1);
  }, [clearFresh]);

  const retry = useCallback(() => {
    setResult(null);
    clearFresh();
    engine.reset();
  }, [clearFresh, engine]);

  const toggleFocus = useCallback(() => {
    setFocus((f) => {
      setSetting('fullscreen', !f);
      return !f;
    });
  }, [setSetting]);

  /* Escape restarts; in focus mode it leaves full screen once the run is idle. */
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape' && !result) {
        engine.reset();
      } else if (e.key === 'Tab' && e.shiftKey) {
        e.preventDefault();
        next();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [engine, next, result]);

  useEffect(() => {
    if (params.get('mode')) setParams({}, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Paste anywhere on the page to practise your own text.
   *
   * The typing area is a focusable div, not an input, so Ctrl+V landed on it
   * and was simply discarded — nothing consumed the paste event. Pasting is an
   * obvious way to say "drill this text", so it now loads the clipboard into
   * Custom mode directly instead of requiring the Custom → Edit text detour.
   *
   * Real fields are left alone, so pasting into the custom editor, the command
   * palette or any future input still behaves normally.
   */
  useEffect(() => {
    const onPaste = (event) => {
      const el = event.target;
      const tag = el?.tagName;
      if (tag === 'TEXTAREA' || tag === 'INPUT' || el?.isContentEditable) return;

      const text = event.clipboardData?.getData('text')?.replace(/\r/g, '').trim();
      if (!text) return;

      event.preventDefault();
      setCustomText(text);
      setMode('custom');
      setSeed((s) => s + 1);
      setResult(null);
      toast(`Pasted ${text.length} characters — ready to type`, { tone: 'success' });
    };

    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [toast]);

  /* A full-screen surface must not leave the page behind it scrollable. */
  useEffect(() => {
    if (!focus) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [focus]);

  const history = useMemo(() => stats.sessions.slice(-12).map((s) => s.wpm), [stats.sessions]);
  const recent = stats.sessions.slice(-6).reverse();

  const controls = (
    <Controls
      mode={mode}
      setMode={setMode}
      difficulty={difficulty}
      setDifficulty={setDifficulty}
      duration={duration}
      setDuration={setDuration}
      wordCount={wordCount}
      setWordCount={setWordCount}
      drillId={drillId}
      setDrillId={setDrillId}
      settings={settings}
      setSetting={setSetting}
      onCustom={() => setCustomOpen(true)}
      onSettings={() => setSettingsOpen(true)}
      onRetry={retry}
      focus={focus}
      onToggleFocus={toggleFocus}
      onNext={next}
      onRegenerate={next}
      aiLoading={aiLoading}
      aiRegenerable={settings.aiText && mode !== 'custom' && mode !== 'drill'}
    />
  );

  const stage = (
    <TypingStage
      target={exercise.text}
      engine={engine}
      caretStyle={settings.caret}
      smoothCaret={settings.smoothCaret}
      blindMode={settings.blindMode}
      fontSize={focus ? 26 : 22}
      visibleLines={focus ? 7 : 5}
      loading={aiLoading}
    />
  );

  const runPanel = (
    <RunPanel
      live={engine.live}
      limitSeconds={mode === 'time' ? duration : null}
      target={exercise.text}
      index={engine.index}
      compact={focus}
    />
  );

  /* ── Full-screen focus surface ─────────────────────────────────────── */
  if (focus) {
    return (
      <>
        {/* Above the floating rail (z-30) and top bar (z-40), below modals (z-50). */}
        <div className="fixed inset-0 z-[45] flex flex-col bg-bg">
          {/* Focus mode covers the header, and it is on by default — which
              left this route with no heading at all, so a screen reader had
              nothing to orient by on the app's most-used screen. The heading
              is hidden rather than absent: sighted users get the stage, and
              the document keeps its structure. */}
          <h1 className="sr-only">Typing practice</h1>
          <div className="shrink-0 border-b border-line px-2 py-1.5">{controls}</div>

          <div className="flex min-h-0 flex-1 gap-2 p-2">
            {/* `my-auto` on the child rather than `justify-center` on the
                parent. justify-content: center distributes negative free space
                too, so once the passage plus keyboard outgrew the column the
                content bled *upward* and slid under the toolbar. Auto margins
                resolve to zero when free space is negative, so the overflow
                goes one way and the scroller takes it. */}
            <div className="flex min-w-0 flex-1 flex-col overflow-y-auto no-scrollbar">
              <div className="my-auto w-full shrink-0">
              <div className="mb-1.5 flex items-center justify-between gap-1 font-mono text-xs text-ink-3">
                <span className="flex items-center gap-0.5">
                  <span className="h-0.5 w-0.5 rounded-full bg-brand-solid" aria-hidden />
                  {exercise.meta}
                </span>
                <span className="tnum">
                  {engine.index} / {exercise.text.length}
                </span>
              </div>
              <ProgressBar value={engine.live.progress} className="mb-2" label="Exercise progress" />
              {stage}
              {/* The keyboard used to sit flush against the stage, so a passage
                  that filled its last visible line collided with the top row of
                  keys. A border plus real padding reserves the gap structurally
                  rather than relying on the stage never being full. */}
                {settings.showKeyboard ? (
                  <div className="mt-1.5 hidden flex-col items-center gap-1.5 md:flex">
                    <KeyboardViz nextChar={engine.nextChar} keyStats={stats.keyStats} />
                    <WeakKeyStrip keyStats={stats.keyStats} />
                  </div>
                ) : null}
              </div>
            </div>

            <aside className="hidden w-[260px] shrink-0 overflow-y-auto lg:block">{runPanel}</aside>
          </div>
        </div>

        {modals()}
      </>
    );
  }

  /* ── Windowed layout ───────────────────────────────────────────────── */
  return (
    <div className="space-y-3">
      <header className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="eyebrow">Train</p>
          <h1 className="mt-0.5 text-3xl font-bold">Typing practice</h1>
          <p className="mt-0.5 max-w-[52ch] text-sm text-ink-3">
            Pick a shape, then stop thinking about it. Accuracy first — speed is what accuracy turns into.
          </p>
        </div>
        <MissionStrip missions={stats.missions} compact />
      </header>

      <div className="grid gap-2.5 xl:grid-cols-[1fr_300px]">
        <Card className="overflow-hidden">
          <div className="border-b border-line px-2 py-1.5">{controls}</div>

          <div className="px-3 pt-2.5 sm:px-5">
            <div className="mb-1.5 flex items-center justify-between font-mono text-xs text-ink-3">
              <span className="flex items-center gap-0.5">
                <span className="h-0.5 w-0.5 rounded-full bg-brand-solid" aria-hidden />
                {exercise.meta}
              </span>
              <span className="tnum">
                {engine.index} / {exercise.text.length}
              </span>
            </div>
            <ProgressBar value={engine.live.progress} className="mb-2" label="Exercise progress" />
            {stage}
          </div>

          {/* Sits close under the passage now. The divider and generous
              padding were added to stop the keyboard colliding with the last
              line; the stage sizes itself to its content since then, so the
              gap was reserving space for a problem that no longer exists. */}
          {settings.showKeyboard ? (
            <div className="mx-3 mb-2 mt-1.5 hidden flex-col items-center gap-1.5 sm:mx-5 md:flex">
              <KeyboardViz nextChar={engine.nextChar} keyStats={stats.keyStats} />
              <WeakKeyStrip keyStats={stats.keyStats} />
            </div>
          ) : (
            <div className="pb-2" />
          )}
        </Card>

        <aside className="space-y-2.5">
          {runPanel}

          <Card className="p-2.5">
            <SectionTitle title="Recent sessions" hint={`${stats.sessionCount} logged`} />
            {recent.length ? (
              <ul className="mt-1.5 divide-y divide-line">
                {recent.map((s, i) => (
                  <li key={i} className="flex items-center gap-1 py-1">
                    <span className="font-mono text-lg font-medium tnum">{Math.round(s.wpm)}</span>
                    <span className="text-2xs uppercase tracking-[0.08em] text-ink-3">wpm</span>
                    <Chip tone={s.accuracy >= 97 ? 'good' : s.accuracy >= 92 ? 'neutral' : 'warn'} className="ml-auto">
                      {Math.round(s.accuracy)}%
                    </Chip>
                    <span className="w-[62px] text-right text-xs text-ink-3">{relativeTime(s.ts)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1.5 text-sm text-ink-3">Nothing logged yet. Your first run sets the baseline.</p>
            )}
          </Card>
        </aside>
      </div>

      {modals()}
    </div>
  );

  function modals() {
    return (
      <>
        <HandGuide
          show={guideOpen}
          remainingShows={guideShowsLeft}
          onDismiss={() => setGuideOpen(false)}
        />

        <SessionSummary
          open={Boolean(result) && mode !== 'zen'}
          result={result ? { ...result, isPB: state._lastAward?.isPB } : null}
          award={state._lastAward}
          freshAchievements={state._fresh ?? []}
          history={history}
          confettiEnabled={settings.confetti}
          onRetry={retry}
          onNext={next}
          onClose={() => {
            setResult(null);
            clearFresh();
          }}
        />

        <Modal
          open={customOpen}
          onClose={() => setCustomOpen(false)}
          title="Custom text"
          description="Paste anything you want to drill — lyrics, a paragraph you keep mistyping, terminology."
          footer={
            <div className="flex justify-end gap-1">
              <Button variant="ghost" onClick={() => setCustomOpen(false)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={() => {
                  setCustomOpen(false);
                  setMode('custom');
                  setSeed((s) => s + 1);
                  toast('Custom text loaded', { tone: 'success' });
                }}
              >
                Use this text
              </Button>
            </div>
          }
        >
          <div className="p-3">
            <textarea
              data-autofocus
              value={customText}
              onChange={(e) => setCustomText(e.target.value)}
              rows={8}
              placeholder="Paste your text here…"
              className="w-full resize-y rounded-md border border-line bg-subtle/50 p-1.5 font-mono text-sm outline-none focus:border-brand"
            />
            <p className="mt-1 text-xs text-ink-3">{customText.trim().length} characters</p>
          </div>
        </Modal>

        <Modal open={settingsOpen} onClose={() => setSettingsOpen(false)} title="Practice settings" size="sm">
          <div className="space-y-2 p-3">
            <SettingRow label="Caret style" hint="How the cursor is drawn">
              <Segmented
                size="sm"
                label="Caret style"
                options={[
                  { value: 'block', label: 'Block' },
                  { value: 'line', label: 'Line' },
                  { value: 'underline', label: 'Under' },
                ]}
                value={settings.caret}
                onChange={(v) => setSetting('caret', v)}
              />
            </SettingRow>
            <Toggle
              label="Hand guide"
              hint={
                settings.handGuide
                  ? `Full-screen home-row reminder · ${Math.max(0, HAND_GUIDE_LIMIT - (settings.handGuideSeen ?? 0))} of ${HAND_GUIDE_LIMIT} showings left`
                  : 'Off — switch on to see it again from the next visit'
              }
              checked={settings.handGuide}
              onChange={(v) => {
                setSetting('handGuide', v);
                // Turning it back on is an explicit request to see it again.
                if (v) setSetting('handGuideSeen', 0);
              }}
            />
            <Toggle
              label="Open in full screen"
              hint="Practice fills the window as soon as you arrive"
              checked={settings.fullscreen}
              onChange={(v) => {
                setSetting('fullscreen', v);
                setFocus(v);
              }}
            />
            <Toggle label="Smooth caret" checked={settings.smoothCaret} onChange={(v) => setSetting('smoothCaret', v)} />
            <Toggle label="Keyboard visualiser" checked={settings.showKeyboard} onChange={(v) => setSetting('showKeyboard', v)} />
            <Toggle label="Keystroke sound" checked={settings.sound} onChange={(v) => setSetting('sound', v)} />
            <Toggle
              label="Stop on error"
              hint="Refuse the keystroke until you type the right character"
              checked={settings.stopOnError}
              onChange={(v) => setSetting('stopOnError', v)}
            />
            <Toggle
              label="AI-generated text"
              hint="Fetch a fresh passage from the model on every load instead of using the bundled banks"
              checked={settings.aiText}
              onChange={(v) => setSetting('aiText', v)}
            />
            <Toggle label="Celebration effects" checked={settings.confetti} onChange={(v) => setSetting('confetti', v)} />
          </div>
        </Modal>
      </>
    );
  }
}

/* ── Controls ──────────────────────────────────────────────────────────── */

function Controls({
  mode, setMode, difficulty, setDifficulty, duration, setDuration, wordCount, setWordCount,
  drillId, setDrillId, settings, setSetting, onCustom, onSettings, onRetry, focus, onToggleFocus,
  onNext, onRegenerate, aiLoading, aiRegenerable,
}) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      <Segmented options={MODES} value={mode} onChange={setMode} size="sm" label="Practice mode" />

      <span className="mx-0.5 hidden h-2 w-px bg-line sm:block" aria-hidden />

      {mode === 'time' ? (
        <Segmented
          size="sm"
          label="Duration"
          options={DURATIONS.map((d) => ({ value: d, label: `${d}s` }))}
          value={duration}
          onChange={setDuration}
        />
      ) : null}
      {mode === 'words' ? (
        <Segmented
          size="sm"
          label="Word count"
          options={WORD_COUNTS.map((d) => ({ value: d, label: String(d) }))}
          value={wordCount}
          onChange={setWordCount}
        />
      ) : null}
      {mode === 'drill' ? (
        <Select
          label="Drill"
          value={drillId}
          onChange={setDrillId}
          options={DRILLS.map((d) => ({ value: d.id, label: d.name }))}
          minWidth={158}
        />
      ) : null}
      {mode === 'custom' ? (
        <Button size="sm" icon={PenLine} onClick={onCustom}>
          Edit text
        </Button>
      ) : null}
      {['time', 'words', 'zen'].includes(mode) ? (
        <Segmented size="sm" label="Difficulty" options={DIFFICULTIES} value={difficulty} onChange={setDifficulty} />
      ) : null}

      <div className="ml-auto flex items-center gap-0.5">
        {/* Mirrors the code-typing toolbar: same two actions, same order, same
            one-word labels. Regenerate is not offered for Custom or Drill —
            one is your own text and the other is a fixed targeted sequence, so
            there is nothing for the model to write. */}
        {aiRegenerable ? (
          <Button
            size="sm"
            variant="ghost"
            icon={Sparkles}
            onClick={onRegenerate}
            disabled={aiLoading || !aiConfigured()}
            title={
              aiConfigured()
                ? 'Write a fresh passage with AI'
                : 'Set a provider key in .env.local to enable'
            }
            className={cx('text-brand', aiLoading && 'animate-pulse')}
          >
            {aiLoading ? 'Writing' : 'AI'}
          </Button>
        ) : null}
        <Button size="sm" variant="ghost" icon={SkipForward} onClick={onNext} title="New text  (⇧ + Tab)">
          Next
        </Button>
        <span className="mx-0.5 h-2 w-px bg-line" aria-hidden />
        <IconButton
          size="sm"
          label={settings.showKeyboard ? 'Hide keyboard layout' : 'Show keyboard layout'}
          // Icon reflects the current state, not the action. It was showing a
          // struck-through keyboard *while* the keyboard was visible, which
          // reads as "the keyboard is off" — exactly backwards.
          icon={settings.showKeyboard ? KeyboardIcon : KeyboardOff}
          onClick={() => setSetting('showKeyboard', !settings.showKeyboard)}
          className={cx(settings.showKeyboard && 'text-brand')}
        />
        <IconButton
          size="sm"
          label={settings.sound ? 'Mute keystrokes' : 'Unmute keystrokes'}
          icon={settings.sound ? Volume2 : VolumeX}
          onClick={() => setSetting('sound', !settings.sound)}
        />
        <IconButton
          size="sm"
          label={settings.blindMode ? 'Show text' : 'Blind mode'}
          icon={settings.blindMode ? EyeOff : Eye}
          onClick={() => setSetting('blindMode', !settings.blindMode)}
        />
        <IconButton size="sm" label="Practice settings" icon={Settings2} onClick={onSettings} />
        <IconButton size="sm" label="Restart exercise" icon={RotateCcw} onClick={onRetry} />
        <IconButton
          size="sm"
          label={focus ? 'Leave full screen' : 'Enter full screen'}
          icon={focus ? Minimize2 : Maximize2}
          onClick={onToggleFocus}
          className={cx(focus && 'text-brand')}
        />
      </div>
    </div>
  );
}

/* ── Right-hand run panel ──────────────────────────────────────────────── */

/**
 * Every live figure lives here now. The old strip under the keyboard duplicated
 * these numbers and pushed the keyboard off-screen in full-screen mode.
 */
function RunPanel({ live, limitSeconds, target, index, compact }) {
  const rows = [
    // `decay` routes this through DecayCounter: WPM has to climb the instant you
    // speed up, but `reset()` zeroes typed-chars and elapsed-ms in the same
    // frame, so a raw value drops from 80 to 0 between two paints and reads as
    // a glitch rather than a run ending.
    { label: 'Words / min', value: live.wpm, lead: true, decay: true },
    { label: 'Accuracy', value: `${Math.round(live.accuracy)}%` },
    { label: 'Errors', value: live.errors, tone: live.errors > 0 ? 'bad' : undefined },
    limitSeconds
      ? { label: 'Time left', value: mmss(live.remaining ?? limitSeconds) }
      : { label: 'Elapsed', value: mmss(live.elapsedSec) },
    { label: 'Raw WPM', value: Math.round(live.rawWpm), quiet: true },
    { label: 'Characters', value: `${index} / ${target.length}`, quiet: true },
  ];

  return (
    <Card className={cx('p-2.5', compact && 'h-full')}>
      <p className="eyebrow">This run</p>

      <div className="mt-1.5 space-y-1.5">
        {rows.map((r) => (
          <div key={r.label} className={cx('flex items-baseline justify-between gap-1', r.lead && 'pb-1')}>
            <span className={cx('text-sm', r.quiet ? 'text-ink-3' : 'text-ink-2')}>{r.label}</span>
            <span
              className={cx(
                'font-mono font-medium tnum leading-none',
                r.lead ? 'text-4xl text-brand' : r.quiet ? 'text-base text-ink-2' : 'text-2xl text-ink',
                r.tone === 'bad' && 'text-bad',
              )}
            >
              {r.decay ? <DecayCounter value={r.value} /> : r.value}
            </span>
          </div>
        ))}
      </div>

      <div className="mt-2 rounded-sm border border-line bg-subtle/60 p-1.5">
        <p className="text-xs font-bold">Shortcuts</p>
        <ul className="mt-0.5 space-y-px text-xs text-ink-3">
          <li>
            <Kbd>esc</Kbd> restart · <Kbd>⇧</Kbd>+<Kbd>tab</Kbd> new text
          </li>
          <li>
            <Kbd>ctrl</Kbd>+<Kbd>⌫</Kbd> delete the last word
          </li>
          <li>
            <Kbd>ctrl</Kbd>+<Kbd>v</Kbd> practise pasted text
          </li>
        </ul>
      </div>
    </Card>
  );
}

function Kbd({ children }) {
  return <kbd className="rounded-[5px] border border-line bg-surface px-0.5 font-mono text-2xs text-ink-2">{children}</kbd>;
}

function SettingRow({ label, hint, children }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <div>
        <p className="text-sm font-bold">{label}</p>
        {hint ? <p className="text-xs text-ink-3">{hint}</p> : null}
      </div>
      {children}
    </div>
  );
}

function Toggle({ label, hint, checked, onChange }) {
  return (
    <SettingRow label={label} hint={hint}>
      <button
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={cx(
          'relative h-[24px] w-[42px] shrink-0 rounded-full transition-colors duration-200',
          checked ? 'bg-brand-solid' : 'bg-line-strong',
        )}
      >
        <span
          className={cx(
            'absolute top-px h-[22px] w-[22px] rounded-full bg-surface shadow-sm transition-transform duration-200 ease-out',
            checked ? 'translate-x-[19px]' : 'translate-x-px',
          )}
        />
      </button>
    </SettingRow>
  );
}
